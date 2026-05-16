import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewQueue } from '../../src/components/ReviewQueue';

describe('ReviewQueue Component', () => {
  const mockTaxonomy = {
    Income: ['Salary', 'Bonus'],
    Expense: ['Food', 'Utilities'],
  };
  const mockTransactions = [
    {
      id: '1',
      status: 'pending_review',
      Description: 'Test TX 1',
      Amount: 100,
      Category: 'Income',
      Subcategory: 'Salary',
      Date: '2026-05-01',
    },
    {
      id: '2',
      status: 'pending_review',
      Description: 'Test TX 2',
      Amount: -50,
      Category: 'Expense',
      Subcategory: 'Food',
      Date: '2026-05-02',
    },
    {
      id: '3',
      status: 'reviewed',
      Description: 'Test TX 3',
      Amount: 200,
      Category: 'Income',
      Subcategory: 'Bonus',
      Date: '2026-05-03',
    },
  ];
  const mockOnApprove = jest.fn();
  const mockOnBulkApprove = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders pending transactions only', () => {
    render(
      <ReviewQueue
        transactions={mockTransactions}
        taxonomy={mockTaxonomy}
        onApprove={mockOnApprove}
        onBulkApprove={mockOnBulkApprove}
      />
    );
    expect(screen.getByText('Test TX 1')).toBeInTheDocument();
    expect(screen.getByText('Test TX 2')).toBeInTheDocument();
    expect(screen.queryByText('Test TX 3')).not.toBeInTheDocument();
  });

  it('filters transactions', async () => {
    render(
      <ReviewQueue
        transactions={mockTransactions}
        taxonomy={mockTaxonomy}
        onApprove={mockOnApprove}
        onBulkApprove={mockOnBulkApprove}
      />
    );

    const searchInput = screen.getByPlaceholderText('Filter transactions...');
    await userEvent.type(searchInput, 'TX 1');

    expect(screen.getByText('Test TX 1')).toBeInTheDocument();
    expect(screen.queryByText('Test TX 2')).not.toBeInTheDocument();
  });

  it('handles single approval', async () => {
    render(
      <ReviewQueue
        transactions={mockTransactions}
        taxonomy={mockTaxonomy}
        onApprove={mockOnApprove}
        onBulkApprove={mockOnBulkApprove}
      />
    );

    const approveBtns = screen.getAllByTitle('Approve Suggestion');
    await userEvent.click(approveBtns[0]);

    expect(mockOnApprove).toHaveBeenCalledWith('1', 'Income', 'Salary');
  });
});
