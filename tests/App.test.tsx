import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';

describe('App Component', () => {
  beforeEach(() => {
    localStorage.clear();
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
                Date: '2026-05-15T12:00:00',
                Description: 'Test TX',
                Amount: 100,
                Balance: 500,
                Account: 'Checking',
                status: 'reviewed',
                matched: true,
              },
              {
                id: '2',
                Date: '2026-05-15T12:00:00',
                Description: 'Savings TX',
                Amount: 50,
                Balance: 100,
                Account: 'Savings',
                status: 'reviewed',
                matched: false,
              },
              {
                id: '3',
                Date: '2026-05-15T12:00:00',
                Description: 'Unmatched Checking TX',
                Amount: 150,
                Balance: 650,
                Account: 'Checking',
                status: 'reviewed',
                matched: false,
              },
            ],
            headers: ['Date', 'Description', 'Amount', 'matched'],
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
      expect(screen.getByText('Our Money')).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Transactions')).toBeInTheDocument();
    });
  });

  it('filters transactions by selected account', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Our Money')).toBeInTheDocument();
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

  it('filters transactions by matched status', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Our Money')).toBeInTheDocument();
    });

    let transactionsTab: HTMLElement;
    await waitFor(() => {
      transactionsTab = screen.getByText('Transactions');
    });
    await userEvent.click(transactionsTab!);

    // Default: both Test TX (matched) and Unmatched Checking TX should be visible
    await waitFor(() => {
      expect(screen.getAllByText('Test TX').length).toBeGreaterThan(0);
      const unmatchedTxCells = screen
        .getAllByText('Unmatched Checking TX')
        .filter((el) => el.tagName === 'TD' || el.closest('td'));
      expect(unmatchedTxCells.length).toBeGreaterThan(0);
    });

    // Select "Matched Only"
    const matchedSelect = screen.getByLabelText(/Matched Status/i);
    await userEvent.selectOptions(matchedSelect, 'matched');

    await waitFor(() => {
      expect(screen.getAllByText('Test TX').length).toBeGreaterThan(0);
      const unmatchedTxCells = screen
        .getAllByText('Unmatched Checking TX')
        .filter((el) => el.tagName === 'TD' || el.closest('td'));
      expect(unmatchedTxCells.length).toBe(0);
    });

    // Select "Unmatched Only"
    await userEvent.selectOptions(matchedSelect, 'unmatched');

    await waitFor(() => {
      const testTxCells = screen
        .getAllByText('Test TX')
        .filter((el) => el.tagName === 'TD' || el.closest('td'));
      expect(testTxCells.length).toBe(0);
      const unmatchedTxCells = screen
        .getAllByText('Unmatched Checking TX')
        .filter((el) => el.tagName === 'TD' || el.closest('td'));
      expect(unmatchedTxCells.length).toBeGreaterThan(0);
    });
  });

  it('opens edit modal, toggles matched state and updates transaction successfully', async () => {
    let lastUpdatePayload: any = null;
    (global.fetch as jest.Mock).mockImplementation((url, init) => {
      if (url === '/api/auth/status') {
        return Promise.resolve({ ok: true, json: async () => ({ authenticated: true }) });
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
                matched: false, // Start as unmatched
              },
            ],
            headers: ['Date', 'Description', 'Amount', 'matched'],
            budget: [],
          }),
        });
      }
      if (url === '/api/transaction/update') {
        lastUpdatePayload = JSON.parse(init.body);
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Our Money')).toBeInTheDocument();
    });

    let transactionsTab: HTMLElement;
    await waitFor(() => {
      transactionsTab = screen.getByText('Transactions');
    });
    await userEvent.click(transactionsTab!);

    // Wait for the table to load
    await waitFor(() => {
      expect(screen.getAllByText('Test TX').length).toBeGreaterThan(0);
    });

    // Click the Amount cell to open the edit modal (avoiding description/category click filter)
    const cellEl = screen.getByText('$100.00');
    await userEvent.click(cellEl);

    // Verify modal is open and shows "Matched to Recurring Profile" checkbox
    await waitFor(() => {
      expect(screen.getByText('Edit Transaction')).toBeInTheDocument();
    });

    const checkbox = screen.getByLabelText(/Matched to Recurring Profile/i);
    expect(checkbox).not.toBeChecked();

    // Toggle the checkbox
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Click Save
    const saveBtn = screen.getByText('OK');
    await userEvent.click(saveBtn);

    // Verify update API was called with matched: true
    await waitFor(() => {
      expect(lastUpdatePayload).not.toBeNull();
      expect(lastUpdatePayload.matched).toBe(true);
    });
  });

  it('correctly filters transactions passed to ThisMonthView based on selectedAccount', async () => {
    const currentMonthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date());

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Our Money')).toBeInTheDocument();
    });

    // Default account selected in App is 'Checking'.
    // Under checking, 'Test TX' (id: '1', Checking) should be rendered in Matched Transactions (since it is Checking and matched).
    // Let's first navigate to "This Month" view to see Checking.
    let thisMonthTab: HTMLElement;
    await waitFor(() => {
      thisMonthTab = screen.getByRole('button', { name: currentMonthName });
    });
    await userEvent.click(thisMonthTab!);

    await waitFor(() => {
      expect(screen.getByText('Matched Transactions')).toBeInTheDocument();
    });

    await waitFor(() => {
      const occurredContainer = screen
        .getByRole('button', { name: /Matched Transactions/i })
        .closest('div')!;
      expect(within(occurredContainer).getByText('Test TX')).toBeInTheDocument();
      expect(within(occurredContainer).queryByText('Savings TX')).not.toBeInTheDocument();
    });

    // Switch to Transactions view to see the selector and select 'Savings'
    let transactionsTab: HTMLElement;
    await waitFor(() => {
      transactionsTab = screen.getByText('Transactions');
    });
    await userEvent.click(transactionsTab!);

    // Change account to 'Savings' via the Transactions dropdown
    const accountSelect = screen.getAllByLabelText(/Account/i)[0];
    await userEvent.selectOptions(accountSelect, 'Savings');

    // Navigate back to "This Month" view
    await userEvent.click(thisMonthTab!);

    // Under Savings, there are no matched Savings transactions. So 'Test TX' should be hidden,
    // and "No Matched Transactions" should be shown.
    await waitFor(() => {
      const occurredContainer = screen
        .getByRole('button', { name: /Matched Transactions/i })
        .closest('div')!;
      expect(within(occurredContainer).queryByText('Test TX')).not.toBeInTheDocument();
      expect(within(occurredContainer).getByText('No Matched Transactions')).toBeInTheDocument();
    });
  });
});
