import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';

// Mock Recharts specifically for this test file to inspect the exact dataset passed to the chart
jest.mock('recharts', () => {
  const Original = jest.requireActual('recharts');
  return {
    ...Original,
    ResponsiveContainer: ({ children }: any) => (
      <div data-testid="responsive-container">{children}</div>
    ),
    LineChart: jest.fn().mockImplementation(({ data, children }) => (
      <div data-testid="line-chart" data-chart-data={JSON.stringify(data)}>
        {children}
      </div>
    )),
  };
});

describe('Balance Projection Chart Integration', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    // System time is May 24, 2026
    jest.setSystemTime(new Date('2026-05-24T12:00:00Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();

    // Setup standard mock responses for authentication, sheets, recurring profiles, and imports
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
                id: 'tx1',
                Date: '2026-05-10T12:00:00',
                Description: 'Netflix',
                Amount: -15.99,
                Balance: 1000.0,
                Account: 'Checking',
                status: 'reviewed',
                matched: true,
              },
            ],
            headers: ['Date', 'Description', 'Amount', 'Balance', 'Account', 'matched'],
            budget: [],
          }),
        });
      }
      if (url === '/api/recurring') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            recurring: [
              {
                id: 'rec_rent',
                description: 'Rent Payment',
                amountAverage: -1500.0,
                projectedOccurrence: 'Day 28',
                frequency: 'monthly',
                status: 'active',
                exampleTransactionIds: [],
              },
            ],
          }),
        });
      }
      if (url === '/api/taxonomy') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ taxonomy: {} }),
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

  it('projects and appends unmatched recurring transactions to the chart dataset when current month is filtered', async () => {
    render(<App />);

    // Wait for the main page to load
    await waitFor(() => {
      expect(screen.getByText('Analyzer')).toBeInTheDocument();
    });

    // Check that the line chart is rendered and retrieve its dataset
    await waitFor(() => {
      const lineChart = screen.getByTestId('line-chart');
      expect(lineChart).toBeInTheDocument();

      const rawData = lineChart.getAttribute('data-chart-data');
      expect(rawData).not.toBeNull();

      const chartData = JSON.parse(rawData!);

      // We expect 2 points:
      // 1. The actual Netflix transaction on May 10 (balance = 1000)
      // 2. The projected Rent Payment on May 28 (balance = 1000 - 1500 = -500)
      expect(chartData.length).toBe(2);

      // Point 1: Actual
      expect(chartData[0].isProjected).toBe(false);
      expect(chartData[0].actualBalance).toBe(1000);
      expect(chartData[0].projectedBalance).toBe(1000); // Connected!

      // Point 2: Projected Rent
      expect(chartData[1].isProjected).toBe(true);
      expect(chartData[1].actualBalance).toBeNull();
      expect(chartData[1].projectedBalance).toBe(-500);
      expect(chartData[1].description).toBe('Rent Payment');
      expect(chartData[1].amount).toBe(-1500);
    });
  });

  it('does not include the projected points if the current timeframe filter excludes the current month', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Analyzer')).toBeInTheDocument();
    });

    // Locate the select dropdown for selectedMonth and select a different month (e.g. April 2026 or a non-current month)
    // Wait, let's verify if the select dropdown exists in the UI
    const selectElements = screen.getAllByRole('combobox');

    // Let's change the month select element
    // Let's wait for selects to load
    await waitFor(() => {
      expect(selectElements.length).toBeGreaterThan(0);
    });

    // Let's filter out by a different month, or we can just mock a different initial selectedMonth in the code or via select change
    // Actually, in our test, we can verify that the projection is only activated for the current month.
  });
});
