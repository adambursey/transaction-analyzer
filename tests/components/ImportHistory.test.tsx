import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportHistory } from '../../src/components/ImportHistory';

describe('ImportHistory Component', () => {
  const mockOnRollbackComplete = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn();
    jest.clearAllMocks();
    window.confirm = jest.fn(() => true);
    window.alert = jest.fn();
  });

  it('renders nothing when there are no imports', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ imports: [] }),
    });

    const { container } = render(<ImportHistory onRollbackComplete={mockOnRollbackComplete} />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/imports');
    });

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('fetches and displays import history', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        imports: [
          {
            importId: 'imp1',
            filename: 'bank.csv',
            date: '2026-05-01T12:00:00Z',
            count: 10,
            reclassification: false,
          },
        ],
      }),
    });

    render(<ImportHistory onRollbackComplete={mockOnRollbackComplete} />);

    await waitFor(() => {
      expect(screen.getByText('Import History')).toBeInTheDocument();
      expect(screen.getByText('bank.csv')).toBeInTheDocument();
    });
  });

  it('handles rollback correctly', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        // Initial fetch
        ok: true,
        json: async () => ({
          imports: [
            {
              importId: 'imp1',
              filename: 'bank.csv',
              date: '2026-05-01T12:00:00Z',
              count: 10,
              reclassification: false,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        // Rollback post
        ok: true,
      })
      .mockResolvedValueOnce({
        // Refetch after rollback
        ok: true,
        json: async () => ({ imports: [] }),
      });

    render(<ImportHistory onRollbackComplete={mockOnRollbackComplete} />);

    await waitFor(() => expect(screen.getByText('bank.csv')).toBeInTheDocument());

    const rollbackBtn = screen.getByTitle('Rollback Import');
    await userEvent.click(rollbackBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/import/rollback',
      expect.objectContaining({ method: 'POST' })
    );

    await waitFor(() => {
      expect(mockOnRollbackComplete).toHaveBeenCalled();
    });
  });
});
