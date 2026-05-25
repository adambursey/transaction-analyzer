import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { ThisMonthView } from '../../src/components/ThisMonthView.tsx';

// Mock Recharts to render simple HTML components and expose the data dataset for assertions
jest.mock('recharts', () => {
  const Original = jest.requireActual('recharts');
  return {
    ...Original,
    ResponsiveContainer: ({ children }: any) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    LineChart: ({ data, children }: any) => (
      <div data-testid="this-month-line-chart" data-chart-data={JSON.stringify(data)}>
        {children}
      </div>
    ),
    Line: () => <div data-testid="line-element" />,
    XAxis: () => <div data-testid="xaxis-element" />,
    YAxis: () => <div data-testid="yaxis-element" />,
    CartesianGrid: () => <div data-testid="grid-element" />,
    Tooltip: () => <div data-testid="tooltip-element" />,
    Legend: () => <div data-testid="legend-element" />,
  };
});

jest.mock('../../src/utils/projectionLogic', () => {
  const actual = jest.requireActual('../../src/utils/projectionLogic');
  return {
    ...actual,
    getUnmatchedRecurringInstances: jest.fn().mockImplementation((...args) => {
      if ((global as any).mockUnmatchedOverride) {
        return (global as any).mockUnmatchedOverride;
      }
      return actual.getUnmatchedRecurringInstances(...args);
    }),
  };
});

// Mock the fetch call
global.fetch = jest.fn();

// Mock only runMatchingEngine, keeping other pure math helpers actual
jest.mock('../../src/utils/matchingLogic', () => ({
  ...jest.requireActual('../../src/utils/matchingLogic'),
  runMatchingEngine: jest.fn().mockReturnValue([]),
}));

import { runMatchingEngine } from '../../src/utils/matchingLogic';

describe('ThisMonthView Component', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const mockTransactions = [
    {
      id: 'tx1',
      Description: 'Netflix',
      Amount: -15.99,
      Date: new Date('2026-05-10T12:00:00Z'),
    },
  ];

  const mockRecurring = [
    {
      id: 'r1',
      description: 'Netflix',
      amountAverage: -15.99,
      projectedOccurrence: 'Day 10',
      status: 'active',
    },
    {
      id: 'r2',
      description: 'Rent',
      amountAverage: -1500,
      projectedOccurrence: 'Day 1',
      frequency: 'monthly',
      status: 'active',
    },
    {
      id: 'r3',
      description: 'Salary',
      amountAverage: 3000,
      projectedOccurrence: 'Day 15',
      frequency: 'monthly',
      status: 'active',
    },
  ];

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: mockRecurring }),
    });
  });

  it('renders loading state initially', () => {
    render(<ThisMonthView transactions={mockTransactions} currentBalance={5000} />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('filters out matched recurring transactions and displays unmatched', async () => {
    // Mock runMatchingEngine to say Netflix (r1) matched tx1
    (runMatchingEngine as jest.Mock).mockReturnValue([
      {
        transaction: mockTransactions[0],
        matches: [{ recurringId: 'r1', score: 100 }],
        isAutoMatch: true,
        isConflict: false,
      },
    ]);

    render(<ThisMonthView transactions={mockTransactions} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Netflix should NOT be in the unmatched list
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();

    // Rent and Salary should be in the list
    expect(screen.getByText('Rent')).toBeInTheDocument();
    expect(screen.getByText('Salary')).toBeInTheDocument();
  });

  it('calculates the projected end of month balance correctly', async () => {
    (runMatchingEngine as jest.Mock).mockReturnValue([
      {
        transaction: mockTransactions[0],
        matches: [{ recurringId: 'r1', score: 100 }],
      },
    ]);

    // Current balance: 5000
    // Unmatched expected: Rent (-1500) + Salary (3000) = +1500
    // Projected = 5000 + 1500 = 6500

    render(<ThisMonthView transactions={mockTransactions} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.getByText('$6,500.00')).toBeInTheDocument();
    });
  });

  it('matches early posting monthly transactions from the previous month', async () => {
    // Rent (r2) is expected on Day 1.
    // If a transaction in the previous month (April 30) matches r2, it should be marked as matched for May.
    (runMatchingEngine as jest.Mock).mockImplementation((txs, rec, yr, mo) => {
      // If mo is the previous month (April, which is 3)
      if (mo === 3) {
        return [
          {
            transaction: {
              id: 'tx_early_rent',
              Description: 'Rent Payment',
              Amount: -1500,
              Date: new Date('2026-04-30T12:00:00Z'),
            },
            matches: [{ recurringId: 'r2', score: 100 }],
          },
        ];
      }
      return [];
    });

    render(<ThisMonthView transactions={mockTransactions} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Rent should NOT be in the unmatched list because it posted early in late April
    expect(screen.queryByText('Rent')).not.toBeInTheDocument();
  });

  it('matches early posting monthly transactions with relaxed amount variance (e.g. utilities)', async () => {
    // Rent (r2) is expected on Day 1 with average amount -1500.
    // We mock a transaction in April with amount -1050 (30% variance) and matching description.
    // runMatchingEngine will return [] because of strict amount limits.
    // The fallback logic should successfully identify and match it using relaxed bounds.
    (runMatchingEngine as jest.Mock).mockReturnValue([]);

    const transactionsWithEarlyVar = [
      {
        id: 'tx_var_rent',
        Description: 'Rent Payment',
        Amount: -1050,
        Date: new Date('2026-04-30T12:00:00Z'),
      },
    ];

    const mockRecurringWithExample = [
      {
        id: 'r2',
        description: 'Rent',
        amountAverage: -1500,
        projectedOccurrence: 'Day 1',
        frequency: 'monthly',
        status: 'active',
        exampleTransactionIds: ['tx_var_rent'],
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: mockRecurringWithExample }),
    });

    render(<ThisMonthView transactions={transactionsWithEarlyVar} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Rent should NOT be in the unmatched list because it was matched by the early-posting fallback logic
    expect(screen.queryByText('Rent')).not.toBeInTheDocument();
  });

  it('lists remaining unmatched instances for multiple-instance recurring profiles (e.g. bi-weekly paycheck)', async () => {
    // Paycheck (r_pay) is expected 2 times per month (instancesPerPeriod = 2).
    // 1 paycheck matched a transaction, meaning 1 paycheck remains unmatched.
    // The unmatched paycheck should show up in the "Remaining to Occur" list.
    const mockTxs = [
      {
        id: 'tx_pay1',
        Description: 'PAYROLL GOOGLE',
        Amount: 4383.54,
        Date: new Date('2026-05-08T12:00:00Z'),
      },
    ];

    const mockRecurringBiWeekly = [
      {
        id: 'r_pay',
        description: 'Paycheck',
        amountAverage: 4383.54,
        projectedOccurrence: 'Friday',
        frequency: 'bi-weekly',
        instancesPerPeriod: 1,
        exampleTransactionIds: ['tx_pay1'],
        status: 'active',
      },
    ];

    (runMatchingEngine as jest.Mock).mockReturnValue([
      {
        transaction: mockTxs[0],
        matches: [{ recurringId: 'r_pay', score: 100 }],
        isAutoMatch: true,
        isConflict: false,
      },
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: mockRecurringBiWeekly }),
    });

    render(<ThisMonthView transactions={mockTxs} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // The remaining unmatched Paycheck instance SHOULD be listed
    expect(screen.getByText('Paycheck')).toBeInTheDocument();
  });

  it('handles multi-instance profiles where one instance matches in the current month and another posts early in the previous month', async () => {
    // ATVs (r_atv) is expected 2 times per month (instancesPerPeriod = 2), expected on Day 5.
    // 1 transaction in May (May 5) matches r_atv.
    // 1 transaction in late April (April 30) posts early and matches r_atv via relaxed fallback.
    const mockTxs = [
      {
        id: 'tx_atv_may',
        Description: 'ATVs Payment',
        Amount: -200,
        Date: new Date('2026-05-05T12:00:00Z'),
      },
      {
        id: 'tx_atv_early',
        Description: 'ATVs Payment',
        Amount: -200,
        Date: new Date('2026-04-30T12:00:00Z'),
      },
    ];

    const mockRecurringATVs = [
      {
        id: 'r_atv',
        description: 'ATVs Payment',
        amountAverage: -200,
        projectedOccurrence: 'Day 5',
        frequency: 'monthly',
        instancesPerPeriod: 2,
        status: 'active',
      },
    ];

    // Standard May engine matches the May 5 transaction
    (runMatchingEngine as jest.Mock).mockImplementation((txs, rec, yr, mo) => {
      if (mo === 4) {
        // May (0-indexed 4)
        return [
          {
            transaction: mockTxs[0],
            matches: [{ recurringId: 'r_atv', score: 100 }],
            isAutoMatch: true,
            isConflict: false,
          },
        ];
      }
      return [];
    });

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: mockRecurringATVs }),
    });

    render(<ThisMonthView transactions={mockTxs} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Both instances should be matched (one in May, one early in April).
    // So ATVs should NOT be in the unmatched list.
    expect(screen.queryByText('ATVs Payment')).not.toBeInTheDocument();
  });

  it('renders collapsible Upcoming Transactions and Pending Matches sections', async () => {
    (runMatchingEngine as jest.Mock).mockReturnValue([
      {
        transaction: mockTransactions[0],
        matches: [{ recurringId: 'r1', recurringName: 'Netflix', score: 100 }],
        isAutoMatch: true,
        isConflict: false,
      },
    ]);

    render(<ThisMonthView transactions={mockTransactions} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Both collapsible headers should exist
    const remainingBtn = screen.getByRole('button', { name: /Upcoming Transactions/i });
    const matchedBtn = screen.getByRole('button', { name: /Pending Matches/i });

    expect(remainingBtn).toBeInTheDocument();
    expect(matchedBtn).toBeInTheDocument();

    // Upcoming Transactions is expanded by default, so Rent should be visible initially
    expect(screen.getByText('Rent')).toBeInTheDocument();

    // Pending Matches is collapsed by default, so Netflix should NOT be visible initially
    expect(screen.queryByText('Netflix')).not.toBeInTheDocument();

    // Click Pending Matches header to expand it
    matchedBtn.click();
    await waitFor(() => {
      // Netflix should now be visible in the matched list!
      expect(screen.getAllByText('Netflix').length).toBeGreaterThan(0);
    });

    // Click Upcoming Transactions header to collapse it
    remainingBtn.click();
    await waitFor(() => {
      // Rent should no longer be visible
      expect(screen.queryByText('Rent')).not.toBeInTheDocument();
    });
  });

  /**
   * Test that clicking the "Save" button on a matched transaction candidate
   * correctly marks it as matched, updates the recurring profile's example transaction IDs,
   * and triggers the refresh callback.
   */
  it('allows saving a candidate match which updates recurring profile examples, transaction matched state, and triggers onRefresh', async () => {
    // Mock the callback refresh function
    const mockOnRefresh = jest.fn();
    // Mock global fetch for PATCH /api/recurring/r1 and POST /api/transaction/update
    const fetchMock = jest.fn().mockImplementation((url, _options) => {
      if (url === '/api/recurring') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ recurring: mockRecurring }),
        });
      }
      if (url === '/api/recurring/r1') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      if (url === '/api/transaction/update') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    global.fetch = fetchMock;

    // Mock runMatchingEngine to return Netflix candidate for tx1
    (runMatchingEngine as jest.Mock).mockReturnValue([
      {
        transaction: mockTransactions[0], // id: 'tx1'
        matches: [{ recurringId: 'r1', recurringName: 'Netflix', score: 100 }],
        isAutoMatch: true,
        isConflict: false,
      },
    ]);

    render(
      <ThisMonthView
        transactions={mockTransactions}
        currentBalance={5000}
        onRefresh={mockOnRefresh}
      />
    );

    // Wait for the loader to clear
    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Expand Pending Matches
    const matchedBtn = screen.getByRole('button', { name: /Pending Matches/i });
    matchedBtn.click();

    // The Save button should exist inside the expanded candidate Netflix card
    let saveBtn: HTMLElement;
    await waitFor(() => {
      saveBtn = screen.getByRole('button', { name: /^Save$/i });
      expect(saveBtn).toBeInTheDocument();
    });

    // Click Save
    saveBtn!.click();

    // Assert that the PATCH api for recurring profile was called
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/recurring/r1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ exampleTransactionIds: ['tx1'] }),
        })
      );
    });

    // Assert that the POST api to update transaction was called
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/transaction/update',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          id: 'tx1',
          amount: -15.99,
          category: 'Uncategorized',
          subcategory: '',
          status: 'reviewed',
          date: '2026-05-10',
          matched: true,
        }),
      })
    );

    // Assert that onRefresh was triggered
    expect(mockOnRefresh).toHaveBeenCalled();
  });

  /**
   * Test that recurring transactions satisfied by already matched transactions (matched: true)
   * are correctly excluded from the "Remaining to Occur" unmatched list.
   */
  it('filters out recurring transactions that are satisfied by already matched transactions (matched: true)', async () => {
    // Mock recurring profile Netflix (r1) having exampleTransactionIds: ['tx1']
    const recurringWithExample = [
      {
        id: 'r1',
        description: 'Netflix',
        amountAverage: -15.99,
        projectedOccurrence: 'Day 10',
        frequency: 'monthly',
        status: 'active',
        exampleTransactionIds: ['tx1'],
      },
      {
        id: 'r2',
        description: 'Rent',
        amountAverage: -1500,
        projectedOccurrence: 'Day 1',
        frequency: 'monthly',
        status: 'active',
      },
    ];

    // Mock global fetch to return this profile
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: recurringWithExample }),
    });

    // Mock transaction tx1 having matched: true
    const txs = [
      {
        id: 'tx1',
        Description: 'Netflix',
        Amount: -15.99,
        Date: new Date('2026-05-10T12:00:00Z'),
        matched: true,
      },
    ];

    // runMatchingEngine on unmatched transactions will return [] since all txs are matched: true
    (runMatchingEngine as jest.Mock).mockReturnValue([]);

    render(<ThisMonthView transactions={txs} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Netflix should NOT be in the unmatched list ("Upcoming Transactions") because it is already matched
    const upcomingContainer = screen
      .getByRole('button', { name: /Upcoming Transactions/i })
      .closest('div')!;
    expect(within(upcomingContainer).queryByText('Netflix')).not.toBeInTheDocument();

    // Rent should be in the list
    expect(within(upcomingContainer).getByText('Rent')).toBeInTheDocument();
  });

  /**
   * Test that recurring transactions satisfied by dynamically matched already matched transactions (matched: true)
   * are correctly excluded from the "Remaining to Occur" unmatched list, even when not in exampleTransactionIds.
   */
  it('filters out recurring transactions that are satisfied by dynamically matched already matched transactions (matched: true) even when not in exampleTransactionIds', async () => {
    // Mock recurring profile Netflix (r1) without exampleTransactionIds
    const recurringWithoutExample = [
      {
        id: 'r1',
        description: 'Netflix',
        amountAverage: -15.99,
        projectedOccurrence: 'Day 10',
        frequency: 'monthly',
        status: 'active',
      },
      {
        id: 'r2',
        description: 'Rent',
        amountAverage: -1500,
        projectedOccurrence: 'Day 1',
        frequency: 'monthly',
        status: 'active',
      },
    ];

    // Mock global fetch to return this profile
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: recurringWithoutExample }),
    });

    // Mock transaction tx1 having matched: true
    const txs = [
      {
        id: 'tx1',
        Description: 'Netflix',
        Amount: -15.99,
        Date: new Date('2026-05-10T12:00:00Z'),
        matched: true,
      },
    ];

    // runMatchingEngine mock implementation:
    // When allowMatched is true, return the match for Netflix.
    (runMatchingEngine as jest.Mock).mockImplementation(
      (txsInput, rec, yr, mo, day, all, allowMatched) => {
        if (allowMatched) {
          return [
            {
              transaction: txs[0],
              isConflict: false,
              isAutoMatch: true,
              matches: [{ recurringId: 'r1', recurringName: 'Netflix', score: 100 }],
            },
          ];
        }
        return [];
      }
    );

    render(<ThisMonthView transactions={txs} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Netflix should NOT be in the unmatched list ("Upcoming Transactions") because it is already matched dynamically
    const upcomingContainer = screen
      .getByRole('button', { name: /Upcoming Transactions/i })
      .closest('div')!;
    expect(within(upcomingContainer).queryByText('Netflix')).not.toBeInTheDocument();

    // Rent should be in the list
    expect(within(upcomingContainer).getByText('Rent')).toBeInTheDocument();
  });

  /**
   * Test that a "Save All Matches" button exists in the Matched Transactions list
   * and triggers sequential saves for all suggestions.
   */
  it('renders a "Save All" button and allows saving all candidates sequentially', async () => {
    const mockOnRefresh = jest.fn();

    // Mock profiles: Netflix (r1) and Spotify (r2)
    const recurring = [
      {
        id: 'r1',
        description: 'Netflix',
        amountAverage: -15.99,
        projectedOccurrence: 'Day 10',
        frequency: 'monthly',
        status: 'active',
        exampleTransactionIds: [],
      },
      {
        id: 'r2',
        description: 'Spotify',
        amountAverage: -10.99,
        projectedOccurrence: 'Day 15',
        frequency: 'monthly',
        status: 'active',
        exampleTransactionIds: [],
      },
    ];

    // Mock global fetch to return profiles
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring }),
    });

    // Mock candidate transactions: tx1 (Netflix) and tx2 (Spotify)
    const txs = [
      {
        id: 'tx1',
        Description: 'Netflix Inc',
        Amount: -15.99,
        Date: new Date('2026-05-10T12:00:00Z'),
        matched: false,
      },
      {
        id: 'tx2',
        Description: 'Spotify Premium',
        Amount: -10.99,
        Date: new Date('2026-05-15T12:00:00Z'),
        matched: false,
      },
    ];

    // Mock runMatchingEngine to return suggestions for both txs
    (runMatchingEngine as jest.Mock).mockReturnValue([
      {
        transaction: txs[0],
        isConflict: false,
        isAutoMatch: true,
        matches: [{ recurringId: 'r1', recurringName: 'Netflix', score: 100 }],
      },
      {
        transaction: txs[1],
        isConflict: false,
        isAutoMatch: true,
        matches: [{ recurringId: 'r2', recurringName: 'Spotify', score: 100 }],
      },
    ]);

    render(<ThisMonthView transactions={txs} currentBalance={5000} onRefresh={mockOnRefresh} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Expand Pending Matches section
    const matchedBtn = screen.getByRole('button', { name: /Pending Matches/i });
    fireEvent.click(matchedBtn);

    // Verify "Save All Matches" button exists
    const saveAllBtn = screen.getByRole('button', { name: /Save All Matches/i });
    expect(saveAllBtn).toBeInTheDocument();

    // Mock sequential fetch responses
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ recurring }) }) // Fetch in init
      .mockResolvedValueOnce({ ok: true }) // PATCH Netflix
      .mockResolvedValueOnce({ ok: true }) // POST Netflix tx
      .mockResolvedValueOnce({ ok: true }) // PATCH Spotify
      .mockResolvedValueOnce({ ok: true }); // POST Spotify tx

    // Click "Save All Matches"
    fireEvent.click(saveAllBtn);

    // Wait for the operations to complete and onRefresh to be called
    await waitFor(() => {
      expect(mockOnRefresh).toHaveBeenCalled();
    });
  });

  it('does not duplicate rows or leak nodes when changing sort order for recurring profiles with multiple expected occurrences in the same month', async () => {
    const weeklyProfile = [
      {
        id: 'r_weekly',
        description: 'Weekly Coffee',
        amountAverage: -5.0,
        projectedOccurrence: 'Friday',
        frequency: 'weekly',
        status: 'active',
        exampleTransactionIds: [],
      },
    ];

    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: weeklyProfile }),
    });

    (global as any).mockUnmatchedOverride = [
      {
        id: 'r_weekly',
        description: 'Weekly Coffee',
        amountAverage: -5.0,
        projectedOccurrence: 'May 1',
        frequency: 'weekly',
        status: 'active',
        _instanceIndex: 0,
        _projectedDate: new Date('2026-05-01T12:00:00Z'),
      },
      {
        id: 'r_weekly',
        description: 'Weekly Coffee',
        amountAverage: -5.0,
        projectedOccurrence: 'May 8',
        frequency: 'weekly',
        status: 'active',
        _instanceIndex: 0,
        _projectedDate: new Date('2026-05-08T12:00:00Z'),
      },
      {
        id: 'r_weekly',
        description: 'Weekly Coffee',
        amountAverage: -5.0,
        projectedOccurrence: 'May 15',
        frequency: 'weekly',
        status: 'active',
        _instanceIndex: 0,
        _projectedDate: new Date('2026-05-15T12:00:00Z'),
      },
      {
        id: 'r_weekly',
        description: 'Weekly Coffee',
        amountAverage: -5.0,
        projectedOccurrence: 'May 22',
        frequency: 'weekly',
        status: 'active',
        _instanceIndex: 0,
        _projectedDate: new Date('2026-05-22T12:00:00Z'),
      },
      {
        id: 'r_weekly',
        description: 'Weekly Coffee',
        amountAverage: -5.0,
        projectedOccurrence: 'May 29',
        frequency: 'weekly',
        status: 'active',
        _instanceIndex: 0,
        _projectedDate: new Date('2026-05-29T12:00:00Z'),
      },
    ];

    render(<ThisMonthView transactions={[]} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Verify there are multiple rows for Weekly Coffee
    const coffeeRows = screen.getAllByText('Weekly Coffee');
    expect(coffeeRows.length).toBe(5);

    // Let's get the number of table row elements (tr) in the table body
    const tableBody = screen.getByRole('table').querySelector('tbody');
    const initialRowCount = tableBody ? tableBody.querySelectorAll('tr').length : 0;
    expect(initialRowCount).toBe(5);

    // Now, find the "Date" header and click it to change the sort order
    const dateHeader = screen.getByRole('columnheader', { name: /Date/i });
    fireEvent.click(dateHeader);

    // Verify the row count remains exactly the same and does not double or increase!
    const rowCountAfterSort = tableBody ? tableBody.querySelectorAll('tr').length : 0;
    expect(rowCountAfterSort).toBe(5);

    // Click it again to toggle sorting direction
    fireEvent.click(dateHeader);
    const rowCountAfterSecondSort = tableBody ? tableBody.querySelectorAll('tr').length : 0;
    expect(rowCountAfterSecondSort).toBe(5);

    // Clean up override
    (global as any).mockUnmatchedOverride = null;
  });

  it('default sorts the upcoming transactions in date ascending (chronological) order', async () => {
    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: [] }),
    });

    (global as any).mockUnmatchedOverride = [
      {
        id: 'r1',
        description: 'Netflix',
        amountAverage: -15.99,
        projectedOccurrence: 'May 15',
        frequency: 'monthly',
        status: 'active',
        _instanceIndex: 0,
        _projectedDate: new Date('2026-05-15T12:00:00Z'),
      },
      {
        id: 'r2',
        description: 'Rent',
        amountAverage: -1500,
        projectedOccurrence: 'May 1',
        frequency: 'monthly',
        status: 'active',
        _instanceIndex: 0,
        _projectedDate: new Date('2026-05-01T12:00:00Z'),
      },
      {
        id: 'r3',
        description: 'Salary',
        amountAverage: 3000,
        projectedOccurrence: 'May 25',
        frequency: 'monthly',
        status: 'active',
        _instanceIndex: 0,
        _projectedDate: new Date('2026-05-25T12:00:00Z'),
      },
    ];

    render(<ThisMonthView transactions={[]} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Check that upcoming transactions are rendered in chronological ascending order:
    // 1. Rent (May 1)
    // 2. Netflix (May 15)
    // 3. Salary (May 25)
    const tableBody = screen.getByRole('table').querySelector('tbody');
    const rows = tableBody ? tableBody.querySelectorAll('tr') : [];
    expect(rows.length).toBe(3);

    // Verify first row is Rent (May 1)
    expect(rows[0].textContent).toContain('Rent');
    expect(rows[0].textContent).toContain('5/1/2026');

    // Verify second row is Netflix (May 15)
    expect(rows[1].textContent).toContain('Netflix');
    expect(rows[1].textContent).toContain('5/15/2026');

    // Verify third row is Salary (May 25)
    expect(rows[2].textContent).toContain('Salary');
    expect(rows[2].textContent).toContain('5/25/2026');

    (global as any).mockUnmatchedOverride = null;
  });

  it('populates the category and subcategory fields of upcoming transactions based on their example transactions', async () => {
    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: [] }),
    });

    const mockTxs = [
      {
        id: 'tx_example_rent',
        Description: 'Apartment Rent',
        Amount: -1500,
        Date: new Date('2026-04-01T12:00:00Z'),
        Category: 'Housing',
        Subcategory: 'Rent Payment',
        matched: true,
      },
    ];

    (global as any).mockUnmatchedOverride = [
      {
        id: 'r_rent',
        description: 'Apartment Rent',
        amountAverage: -1500,
        projectedOccurrence: 'Day 1',
        frequency: 'monthly',
        status: 'active',
        exampleTransactionIds: ['tx_example_rent'],
        category: '', // Empty in profile
        subcategory: '', // Empty in profile
        _instanceIndex: 0,
        _projectedDate: new Date('2026-05-01T12:00:00Z'),
      },
    ];

    render(<ThisMonthView transactions={mockTxs} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Check that upcoming transactions populated category ('Housing') and subcategory ('Rent Payment')
    const tableBody = screen.getByRole('table').querySelector('tbody');
    const rows = tableBody ? tableBody.querySelectorAll('tr') : [];
    expect(rows.length).toBe(1);

    expect(rows[0].textContent).toContain('Housing');
    expect(rows[0].textContent).toContain('Rent Payment');

    (global as any).mockUnmatchedOverride = null;
  });

  it('renders "Matched Transactions" section containing matched transactions in the current month sorted ascending', async () => {
    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: [] }),
    });

    const mockTxs = [
      {
        id: 'tx_netflix_may',
        Description: 'Netflix Inc',
        Amount: -15.99,
        Date: new Date('2026-05-10T12:00:00Z'),
        Category: 'Entertainment',
        matched: true,
      },
      {
        id: 'tx_groceries_may',
        Description: 'Whole Foods',
        Amount: -120.5,
        Date: new Date('2026-05-02T12:00:00Z'),
        Category: 'Groceries',
        matched: true,
      },
      {
        id: 'tx_unmatched_may',
        Description: 'Uber Ride',
        Amount: -25.0,
        Date: new Date('2026-05-15T12:00:00Z'),
        Category: 'Transit',
        matched: false,
      },
      {
        id: 'tx_matched_april',
        Description: 'Spotify',
        Amount: -10.99,
        Date: new Date('2026-04-15T12:00:00Z'),
        Category: 'Entertainment',
        matched: true,
      },
    ];

    render(<ThisMonthView transactions={mockTxs} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // Verify collapsible matched transactions section header and count
    const occurredHeader = screen.getByRole('button', { name: /Matched Transactions/i });
    expect(occurredHeader).toBeInTheDocument();
    expect(occurredHeader.textContent).toContain('2 Items');

    // Retrieve Matched Transactions table rows
    const occurredContainer = occurredHeader.closest('div');
    const tableBody = occurredContainer ? occurredContainer.querySelector('tbody') : null;
    const rows = tableBody ? tableBody.querySelectorAll('tr') : [];

    // Should contain exactly 2 matched transactions of May:
    // 1. Whole Foods (May 2)
    // 2. Netflix Inc (May 10)
    expect(rows.length).toBe(2);

    // Verify chronological date ascending order (Whole Foods on May 2 first, then Netflix on May 10 second)
    expect(rows[0].textContent).toContain('Whole Foods');
    expect(rows[0].textContent).toContain('5/2/2026');

    expect(rows[1].textContent).toContain('Netflix Inc');
    expect(rows[1].textContent).toContain('5/10/2026');
  });

  it('renders Cash Flow Projection line chart with correct actual vs projected balance math', async () => {
    // Override the mock fetches
    (global.fetch as jest.Mock).mockReset();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ recurring: [] }),
    });

    // Today is May 24, 2026.
    // Set up mock database ledger transactions for May
    const mockTxs = [
      {
        id: 'tx_matched_groceries',
        Description: 'Whole Foods',
        Amount: -120.5,
        Date: new Date('2026-05-02T12:00:00Z'),
        Category: 'Groceries',
        matched: true,
      },
      {
        id: 'tx_unmatched_transit',
        Description: 'Uber Ride',
        Amount: -25.0,
        Date: new Date('2026-05-05T12:00:00Z'),
        Category: 'Transit',
        matched: false,
      },
      {
        id: 'tx_matched_netflix',
        Description: 'Netflix Inc',
        Amount: -15.99,
        Date: new Date('2026-05-10T12:00:00Z'),
        Category: 'Entertainment',
        matched: true,
      },
    ];

    // Set up mock unmatched projected expected recurring transactions
    // (returns an expected instance on May 15 with expected amount -100)
    (global as any).mockUnmatchedOverride = [
      {
        id: 'rec_rent_projected',
        description: 'Rent Payment',
        amountAverage: -100.0,
        projectedOccurrence: '15',
        _projectedDate: new Date('2026-05-15T12:00:00Z'),
        _instanceIndex: 0,
        exampleTransactionIds: [],
      },
    ];

    render(<ThisMonthView transactions={mockTxs} currentBalance={5000} />);

    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });

    // 1. Verify "Cash Flow Projection" section header exists
    expect(screen.getByText('Cash Flow Projection')).toBeInTheDocument();

    // 2. Retrieve Recharts line chart container and parse chart dataset
    const chart = screen.getByTestId('this-month-line-chart');
    expect(chart).toBeInTheDocument();
    const dataRaw = chart.getAttribute('data-chart-data');
    expect(dataRaw).toBeTruthy();
    const dailyData = JSON.parse(dataRaw!);

    // Should contain exactly 31 data points (one for each day of May)
    expect(dailyData.length).toBe(31);

    // Let's assert on the computed math:
    // startingBalance back-calculated from currentBalance (5000) on today (May 24)
    // Ledger transactions in May:
    // - May 2: -120.50
    // - May 5: -25.00
    // - May 10: -15.99
    // Sum is -161.49, so startingBalance = 5000 - (-161.49) = 5161.49

    // Day 1 (May 1)
    expect(dailyData[0].day).toBe(1);
    expect(dailyData[0].actualBalance).toBeCloseTo(5161.49, 2);
    expect(dailyData[0].projectedBalance).toBeCloseTo(5161.49, 2);

    // Day 2 (May 2) - Whole Foods (-120.50) occurs (both actual and projected matched)
    expect(dailyData[1].day).toBe(2);
    expect(dailyData[1].actualBalance).toBeCloseTo(5161.49 - 120.5, 2); // 5040.99
    expect(dailyData[1].projectedBalance).toBeCloseTo(5161.49 - 120.5, 2);

    // Day 3 & 4 (May 3 & 4) - Holds flat
    expect(dailyData[2].actualBalance).toBeCloseTo(5040.99, 2);
    expect(dailyData[2].projectedBalance).toBeCloseTo(5040.99, 2);

    // Day 5 (May 5) - Uber Ride (-25.00) occurs in actual ledger (unmatched) but not in projected/recurring
    expect(dailyData[4].day).toBe(5);
    expect(dailyData[4].actualBalance).toBeCloseTo(5040.99 - 25.0, 2); // 5015.99
    expect(dailyData[4].projectedBalance).toBeCloseTo(5040.99, 2); // Projected remains 5040.99 (Coffee isn't recurring)

    // Day 10 (May 10) - Netflix (-15.99) occurs (both actual and projected matched)
    expect(dailyData[9].day).toBe(10);
    expect(dailyData[9].actualBalance).toBeCloseTo(5015.99 - 15.99, 2); // 5000.00
    expect(dailyData[9].projectedBalance).toBeCloseTo(5040.99 - 15.99, 2); // 5025.00

    // Day 15 (May 15) - Rent Payment (-100.00) occurs in projected (upcoming) but not actual
    expect(dailyData[14].day).toBe(15);
    expect(dailyData[14].actualBalance).toBeCloseTo(5000.0, 2); // Actual holds flat
    expect(dailyData[14].projectedBalance).toBeCloseTo(5025.0 - 100.0, 2); // 4925.00

    // Day 24 (May 24) - Today's actual balance is currentBalance (5000)
    expect(dailyData[23].actualBalance).toBeCloseTo(5000.0, 2);

    // Day 25 (May 25) - Future day, actual balance should be undefined/null (so it's not plotted)
    expect(dailyData[24].actualBalance).toBeUndefined();
    // Projected balance continues to be plotted through the end of the month
    expect(dailyData[24].projectedBalance).toBeCloseTo(4925.0, 2);
    expect(dailyData[30].projectedBalance).toBeCloseTo(4925.0, 2);

    // Clean up global mock override
    (global as any).mockUnmatchedOverride = null;
  });
});
