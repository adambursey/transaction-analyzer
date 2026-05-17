import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportModal } from '../../src/components/ImportModal';

describe('ImportModal Component', () => {
  const mockOnClose = jest.fn();
  const mockOnImportComplete = jest.fn();
  const mockOnImportStarted = jest.fn();
  const mockOnImportProgress = jest.fn();

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ exists: false }),
    });
    jest.clearAllMocks();
  });

  it('renders correctly when open', async () => {
    render(
      <ImportModal
        isOpen={true}
        onClose={mockOnClose}
        onImportComplete={mockOnImportComplete}
        onImportStarted={mockOnImportStarted}
        onImportProgress={mockOnImportProgress}
      />
    );
    expect(screen.getByText('Import Transactions')).toBeInTheDocument();

    // Wait for the initial saved mapping fetch to complete
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it('does not render when closed', () => {
    const { container } = render(
      <ImportModal
        isOpen={false}
        onClose={mockOnClose}
        onImportComplete={mockOnImportComplete}
        onImportStarted={mockOnImportStarted}
        onImportProgress={mockOnImportProgress}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('handles CSV upload and import process', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ message: '10 auto-categorized', skippedCount: 0 }),
    });

    render(
      <ImportModal
        isOpen={true}
        onClose={mockOnClose}
        onImportComplete={mockOnImportComplete}
        onImportStarted={mockOnImportStarted}
        onImportProgress={mockOnImportProgress}
      />
    );

    const file = new File(
      ['Date,Description,Amount,Balance\n2026-05-01,Test,100,"$1,234.56"'],
      'test.csv',
      { type: 'text/csv' }
    );
    const input = screen.getByLabelText(/Click to select a CSV file/i);

    await userEvent.upload(input, file);

    expect(screen.getByText('test.csv')).toBeInTheDocument();

    const importBtn = screen.getByText('Import CSV');
    await userEvent.click(importBtn);

    await waitFor(() => {
      expect(mockOnImportStarted).toHaveBeenCalledWith(1); // 1 unique transaction
    });

    await waitFor(() => {
      // The body should contain the properly parsed float balance
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/import',
        expect.objectContaining({
          body: expect.stringMatching(/"Balance":1234\.56/),
        })
      );
      expect(mockOnImportComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });
  });
});
