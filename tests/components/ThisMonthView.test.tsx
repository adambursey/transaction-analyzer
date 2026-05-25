import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThisMonthView } from '../../src/components/ThisMonthView';

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
});
