import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
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
});
