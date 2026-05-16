import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminView } from '../../src/components/AdminView';

describe('AdminView Component', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();
    // Mock window.confirm
    window.confirm = jest.fn(() => true);
    window.alert = jest.fn();
  });

  it('renders loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
    render(<AdminView />);
    expect(screen.getByText('Loading admin data...')).toBeInTheDocument();
  });

  it('fetches and displays admin data', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          transactions: [{ id: '1', Description: 'Test Archive TX', Amount: 100 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ imports: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ count: 5 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          exists: true,
          transactionCount: 15,
          savedAt: new Date().toISOString(),
        }),
      });

    render(<AdminView transactions={[{ id: 'u1', _category: 'Uncategorized' }]} />);

    await waitFor(() => {
      expect(screen.getByText('Admin Controls')).toBeInTheDocument();
    });

    expect(screen.getByText('5')).toBeInTheDocument(); // Duplicate count
    expect(screen.getByText('Test Archive TX')).toBeInTheDocument();
  });

  it('handles deduplication click', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ transactions: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ imports: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ count: 2 }) }) // Initial load
      .mockResolvedValueOnce({ ok: true, json: async () => ({ exists: false }) }) // Mapping status
      .mockResolvedValueOnce({ ok: true, json: async () => ({ deletedCount: 2 }) }) // Deduplicate action
      .mockResolvedValueOnce({ ok: true, json: async () => ({ transactions: [] }) }) // Reload
      .mockResolvedValueOnce({ ok: true, json: async () => ({ imports: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ count: 0 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ exists: false }) });

    render(<AdminView />);
    await waitFor(() => expect(screen.getByText('Admin Controls')).toBeInTheDocument());

    const dedupeBtn = screen.getByText('Archive Duplicates');
    await userEvent.click(dedupeBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith('/api/admin/deduplicate', { method: 'POST' });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Moved 2 duplicate'));
    });
  });
});
