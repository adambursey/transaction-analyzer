import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';

describe('App Component', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();

    // Mock Google auth check
    (global.fetch as jest.Mock).mockImplementation((url) => {
      if (url === '/api/auth/status') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ authenticated: true }),
        });
      }
      if (url === '/api/sheet') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [
              {
                id: '1',
                Date: '2026-05-01',
                Description: 'Test TX',
                Amount: 100,
                Balance: 500,
                Account: 'Checking',
                status: 'reviewed',
              },
              {
                id: '2',
                Date: '2026-05-02',
                Description: 'Savings TX',
                Amount: 50,
                Balance: 100,
                Account: 'Savings',
                status: 'reviewed',
              },
            ],
            headers: ['Date', 'Description', 'Amount'],
            budget: [],
          }),
        });
      }
      if (url === '/api/taxonomy') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ taxonomy: { Income: ['Salary'] } }),
        });
      }
      if (url === '/api/imports') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ imports: [] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
  });

  it('renders application successfully after authentication', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Analyzer')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Transactions')).toBeInTheDocument();
    });
  });

  it('filters transactions by selected account', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Analyzer')).toBeInTheDocument();
    });

    // Switch to Transactions view to see the full list
    let transactionsTab: HTMLElement;
    await waitFor(() => {
      transactionsTab = screen.getByText('Transactions');
    });
    await userEvent.click(transactionsTab!);

    // Default account is 'Checking', so 'Test TX' should be visible
    await waitFor(() => {
      const testTxElements = screen.getAllByText('Test TX');
      expect(testTxElements.length).toBeGreaterThan(0);
      // 'Savings TX' should NOT be visible because it's filtered out
      const savingsTxElements = screen.queryAllByText('Savings TX');
      expect(savingsTxElements.length).toBe(0);
    });

    // Change account to 'Savings' via the Transactions dropdown
    const accountSelect = screen.getAllByLabelText(/Account/i)[0];
    await userEvent.selectOptions(accountSelect, 'Savings');

    // Now 'Savings TX' should be visible, and 'Test TX' should be hidden
    await waitFor(() => {
      const savingsTxElements = screen.getAllByText('Savings TX');
      expect(savingsTxElements.length).toBeGreaterThan(0);

      const testTxElements = screen.queryAllByText('Test TX');
      expect(testTxElements.length).toBe(0);
    });
  });
});
