/**
 * @jest-environment node
 */
import request from 'supertest';
import { createApp, removeTransactionIdsFromRecurringExamples } from '../server';

// --- MOCKING ---

// Mock Firestore
const mockDbCollection = jest.fn();
const mockDbBatch = jest.fn();
const mockDbDoc = jest.fn();

jest.mock('@google-cloud/firestore', () => {
  return {
    Firestore: jest.fn().mockImplementation(() => {
      return {
        collection: mockDbCollection,
        batch: mockDbBatch,
        doc: mockDbDoc,
      };
    }),
    FieldValue: {
      serverTimestamp: jest.fn(() => 'MOCK_TIMESTAMP'),
      increment: jest.fn((val) => val),
    },
    Timestamp: {
      fromDate: jest.fn((date) => ({ toDate: () => date })),
      now: jest.fn(() => ({ toDate: () => new Date() })),
    },
  };
});

// Mock Gemini AI
const mockGenerateContent = jest.fn();
jest.mock('@google/genai', () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => {
      return {
        models: {
          generateContent: mockGenerateContent,
        },
      };
    }),
  };
});

// Avoid writing actual cookies during tests via express session/cookie-parser mocking if needed
// Or just let cookie-parser do its thing (it doesn't persist).

// We'll also mock the fs logic since /api/auth/google reads/writes google_tokens.json
jest.mock('fs', () => {
  const actualFs = jest.requireActual('fs');
  return {
    ...actualFs,
    existsSync: jest.fn(() => true),
    readFileSync: jest.fn(() => JSON.stringify({ refresh_token: 'mock_token' })),
    writeFileSync: jest.fn(),
  };
});

jest.mock('googleapis', () => {
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({
          setCredentials: jest.fn(),
          generateAuthUrl: jest.fn(() => 'http://mock-auth-url'),
          getToken: jest.fn().mockResolvedValue({ tokens: { refresh_token: 'mock_token' } }),
        })),
      },
      oauth2: jest.fn().mockImplementation(() => ({
        userinfo: {
          get: jest.fn().mockResolvedValue({ data: { email: 'test@example.com' } }),
        },
      })),
    },
  };
});

// Setup express app before tests
let app: any;

beforeAll(async () => {
  app = await createApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default fallback mock to prevent "is not a function" errors
  mockDbCollection.mockImplementation((_name) => {
    return {
      doc: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ exists: false }),
        set: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      }),
      where: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({ docs: [] }),
    };
  });
});

describe('Backend API Endpoints (Hermetic)', () => {
  describe('GET /api/taxonomy', () => {
    it('should return taxonomy from Firestore', async () => {
      mockDbCollection.mockImplementationOnce((_name) => {
        if (_name === 'taxonomy') {
          return {
            doc: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({ mapping: { Income: ['Salary'], Expense: ['Food'] } }),
              }),
            }),
          };
        }
        // Fallback for other collections that might be queried
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: false }),
          }),
          where: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue({ docs: [] }),
        };
      });

      const response = await request(app)
        .get('/api/taxonomy')
        .set('Cookie', ['google_tokens={"refresh_token":"mock"}']);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ taxonomy: { Income: ['Salary'], Expense: ['Food'] } });
    });

    it('should return empty object if taxonomy does not exist', async () => {
      const mockGet = jest.fn().mockResolvedValue({ exists: false });
      mockDbCollection.mockReturnValue({
        doc: jest.fn().mockReturnValue({ get: mockGet }),
      });

      const response = await request(app)
        .get('/api/taxonomy')
        .set('Cookie', ['google_tokens={"refresh_token":"mock"}']);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ taxonomy: {} });
    });
  });

  describe('POST /api/import', () => {
    it('should successfully import transactions, checking duplicates', async () => {
      // Mock /api/taxonomy
      const mockTaxonomyGet = jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ Income: ['Salary'] }),
      });

      // Mock existing transactions query
      const mockTransactionsGet = jest.fn().mockResolvedValue({
        docs: [], // No existing transactions
      });

      // Mock the collection and batch behavior
      mockDbCollection.mockImplementation((_name) => {
        if (_name === 'metadata') {
          return { doc: jest.fn().mockReturnValue({ get: mockTaxonomyGet }) };
        }
        if (_name === 'transactions') {
          return {
            get: mockTransactionsGet,
            doc: jest.fn().mockReturnValue({ id: 'mock-doc-id' }),
          };
        }
        if (_name === 'imports') {
          return { doc: jest.fn().mockReturnValue({ set: jest.fn() }) };
        }
        if (_name === 'system') {
          return {
            doc: jest.fn().mockReturnValue({
              get: jest.fn().mockResolvedValue({ exists: false }),
            }),
          };
        }
        return {
          doc: jest.fn().mockReturnValue({
            get: jest.fn().mockResolvedValue({ exists: false }),
          }),
        };
      });

      const mockBatchSet = jest.fn();
      const mockBatchCommit = jest.fn().mockResolvedValue([]);
      mockDbBatch.mockReturnValue({
        set: mockBatchSet,
        commit: mockBatchCommit,
      });

      // We need to bypass the google auth check since auth check fails in supertest unless we mock cookies
      // In server.ts, req.cookies.admin_authenticated is checked for the frontend statically, but the API routes don't strictly require it! Let's see...
      // Wait, server.ts has `app.use(cookieParser())` but no global middleware blocking /api. Wait, let me double check server.ts.

      const payload = {
        file_name: 'test.csv',
        importId: 'import_123',
        account: 'Checking',
        transactions: [{ Date: '2026-05-01', Description: 'Test TX', Amount: 100, Balance: 250.5 }],
      };

      const response = await request(app)
        .post('/api/import')
        .set('Cookie', ['google_tokens={"refresh_token":"mock"}'])
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain('Imported 1 transactions');
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ Balance: 250.5 })
      );
      expect(mockBatchCommit).toHaveBeenCalled();
    });
  });

  describe('POST /api/admin/deduplicate', () => {
    it('should deduplicate transactions', async () => {
      const mockDoc1 = {
        id: 'doc1',
        data: () => ({ _signature: 'Checking|sig1', Amount: 10, Account: 'Checking' }),
      };
      const mockDoc2 = {
        id: 'doc2',
        data: () => ({ _signature: 'Checking|sig1', Amount: 10, Account: 'Checking' }),
      }; // Duplicate
      const mockGet = jest.fn().mockResolvedValue({
        docs: [mockDoc1, mockDoc2],
      });

      mockDbCollection.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: mockGet,
        doc: jest.fn(),
      });

      const mockBatchUpdate = jest.fn();
      const mockBatchCommit = jest.fn().mockResolvedValue([]);
      mockDbBatch.mockReturnValue({
        update: mockBatchUpdate,
        commit: mockBatchCommit,
      });

      const response = await request(app)
        .post('/api/admin/deduplicate')
        .set('Cookie', ['google_tokens={"refresh_token":"mock"}'])
        .send({ account: 'Checking' });

      expect(response.status).toBe(200);
      expect(response.body.deletedCount).toBe(1);
      expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
      expect(mockBatchCommit).toHaveBeenCalled();
    });
  });

  describe('POST /api/admin/backfill-and-reconcile', () => {
    it('should update existing balances and generate discrepancy transactions', async () => {
      // Mock existing transactions:
      // tx1: Date 1, Amount 100, Balance 100 (Anchor)
      // tx2: Date 2, Amount 50 (no balance) -> Expected: 150
      // tx3: Date 3, Amount 20, Balance 200 -> Expected 170. Gap = 30.
      const mockDoc1 = {
        id: 'doc1',
        data: () => ({
          Date: { toDate: () => new Date('2026-05-01') },
          Amount: 100,
          Balance: 100,
          Account: 'Checking',
          _signature: 'Checking|sig1',
        }),
      };
      const mockDoc2 = {
        id: 'doc2',
        data: () => ({
          Date: { toDate: () => new Date('2026-05-02') },
          Amount: 50,
          Account: 'Checking',
          _signature: 'Checking|sig2',
        }),
      };
      const mockDoc3 = {
        id: 'doc3',
        data: () => ({
          Date: { toDate: () => new Date('2026-05-03') },
          Amount: 20,
          Balance: 200,
          Account: 'Checking',
          _signature: 'Checking|sig3',
        }),
      };

      const mockGet = jest.fn().mockResolvedValue({
        docs: [mockDoc1, mockDoc2, mockDoc3],
      });

      mockDbCollection.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        get: mockGet,
        doc: jest.fn().mockReturnValue({ id: 'new-discrepancy-id' }),
      });

      const mockBatchUpdate = jest.fn();
      const mockBatchSet = jest.fn();
      const mockBatchDelete = jest.fn();
      const mockBatchCommit = jest.fn().mockResolvedValue([]);
      mockDbBatch.mockReturnValue({
        update: mockBatchUpdate,
        set: mockBatchSet,
        delete: mockBatchDelete,
        commit: mockBatchCommit,
      });

      const payload = {
        transactions: [
          // Sending backfill for doc2
          { Date: '2026-05-02', Description: 'Tx 2', Amount: 50, Balance: 150 },
        ],
        account: 'Checking',
      };

      const response = await request(app)
        .post('/api/admin/backfill-and-reconcile')
        .set('Cookie', ['google_tokens={"refresh_token":"mock"}'])
        .send(payload);

      expect(response.status).toBe(200);

      // Batch should commit
      expect(mockBatchCommit).toHaveBeenCalled();

      // Batch set should have been called to insert the reconciliation discrepancy (Gap = 30)
      // Wait, if doc2 gets balance 150, current_balance at doc2 is 150.
      // At doc3, current_balance + 20 = 170. But doc3 Balance = 200. Gap = 30.
      expect(mockBatchSet).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Amount: 30,
          _category: 'Reconciliation Discrepancy',
        })
      );
    });
  });

  describe('POST /api/admin/match-transfers', () => {
    it('should successfully match and update paired transfers', async () => {
      const mockCheckingTx = {
        id: 'chk1',
        ref: { id: 'chk1' },
        data: () => ({
          Account: 'Checking',
          Amount: -50,
          Description: 'Online Transfer to SAV ...9301',
          Date: '2026-05-10T12:00:00.000Z',
          status: 'reviewed',
        }),
      };

      const mockSavingsTx = {
        id: 'sav1',
        ref: { id: 'sav1' },
        data: () => ({
          Account: 'Savings',
          Amount: 50,
          Description: 'Online Transfer from CHK ...4765',
          Date: '2026-05-10T15:00:00.000Z',
          status: 'reviewed',
        }),
      };

      const mockGet = jest.fn().mockResolvedValue({
        docs: [mockCheckingTx, mockSavingsTx],
      });

      mockDbCollection.mockReturnValue({
        get: mockGet,
      });

      const mockBatchUpdate = jest.fn();
      const mockBatchCommit = jest.fn().mockResolvedValue([]);
      mockDbBatch.mockReturnValue({
        update: mockBatchUpdate,
        commit: mockBatchCommit,
      });

      // Override env variables for test
      process.env.CHECKING_ACCOUNT_NUMBER = '4765';
      process.env.SAVINGS_ACCOUNT_NUMBER = '9301';

      const response = await request(app)
        .post('/api/admin/match-transfers')
        .set('Cookie', ['google_tokens={"refresh_token":"mock"}']);

      expect(response.status).toBe(200);
      expect(response.body.matchCount).toBe(1);

      expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
      expect(mockBatchUpdate).toHaveBeenCalledWith(
        mockCheckingTx.ref,
        expect.objectContaining({
          Category: 'Internal Transfer',
          linkedTransferId: 'sav1',
        })
      );
      expect(mockBatchUpdate).toHaveBeenCalledWith(
        mockSavingsTx.ref,
        expect.objectContaining({
          Category: 'Internal Transfer',
          linkedTransferId: 'chk1',
        })
      );
      expect(mockBatchCommit).toHaveBeenCalled();
    });
  });

  describe('POST /api/transaction/update', () => {
    /**
     * Test successful update of a transaction with the "matched" field.
     */
    it('should successfully update a transaction including matched status', async () => {
      // Mock the Firestore doc update method
      const mockUpdate = jest.fn();
      mockDbCollection.mockReturnValue({
        doc: jest.fn().mockReturnValue({
          update: mockUpdate,
        }),
      });

      // Prepare updated payload including the new boolean 'matched' field
      const payload = {
        id: 'tx123',
        amount: '-150.00',
        category: 'Utilities',
        subcategory: 'Electricity',
        status: 'reviewed',
        date: '2026-05-15',
        matched: true,
      };

      // Perform POST request to single update API route
      const response = await request(app)
        .post('/api/transaction/update')
        .set('Cookie', ['google_tokens={"refresh_token":"mock"}'])
        .send(payload);

      // Verify server responded with 200 OK and success: true
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });

      // Assert that update was called on the correct Firestore doc with correct fields
      expect(mockUpdate).toHaveBeenCalledWith({
        Amount: -150.0,
        Category: 'Utilities',
        Subcategory: 'Electricity',
        status: 'reviewed',
        matched: true,
        Date: expect.objectContaining({ toDate: expect.any(Function) }),
        EffectiveDate: expect.objectContaining({ toDate: expect.any(Function) }),
      });
    });

    /**
     * Test failure validation check for missing fields.
     */
    it('should return 400 if required fields are missing', async () => {
      // Send a payload missing required fields (Amount and Category)
      const response = await request(app)
        .post('/api/transaction/update')
        .set('Cookie', ['google_tokens={"refresh_token":"mock"}'])
        .send({ id: 'tx123' });

      // Verify that 400 Bad Request error is returned
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Missing required fields');
    });
  });

  describe('removeTransactionIdsFromRecurringExamples Utility', () => {
    it('should query recurring transactions and update exampleTransactionIds when matched', async () => {
      const mockDoc = {
        ref: 'mock-recurring-doc-ref',
        data: () => ({
          exampleTransactionIds: ['tx_deleted', 'tx_kept'],
        }),
      };

      const mockGet = jest.fn().mockResolvedValue({
        empty: false,
        docs: [mockDoc],
      });

      mockDbCollection.mockImplementation((name) => {
        if (name === 'recurring_transactions') {
          return { get: mockGet };
        }
        return {};
      });

      const mockBatchUpdate = jest.fn();
      const mockBatchCommit = jest.fn().mockResolvedValue([]);
      mockDbBatch.mockReturnValue({
        update: mockBatchUpdate,
        commit: mockBatchCommit,
      });

      const firestoreMock = {
        collection: mockDbCollection,
        batch: mockDbBatch,
      } as any;

      await removeTransactionIdsFromRecurringExamples(firestoreMock, ['tx_deleted']);

      expect(mockBatchUpdate).toHaveBeenCalledWith('mock-recurring-doc-ref', {
        exampleTransactionIds: ['tx_kept'],
      });
      expect(mockBatchCommit).toHaveBeenCalled();
    });
  });
});
