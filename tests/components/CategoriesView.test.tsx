import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoriesView } from '../../src/components/CategoriesView';

describe('CategoriesView Component', () => {
  const mockTaxonomy = {
    Income: ['Salary', 'Bonus'],
    Expense: ['Food', 'Utilities'],
  };
  const mockTransactions = [
    { _category: 'Expense', _subcategory: 'Food' },
    { _category: 'Income', _subcategory: 'Salary' },
  ];
  const mockOnUpdate = jest.fn();

  beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    jest.clearAllMocks();
  });

  it('renders categories correctly', () => {
    render(
      <CategoriesView
        taxonomy={mockTaxonomy}
        transactions={mockTransactions}
        analysis={{}}
        onUpdate={mockOnUpdate}
      />
    );
    expect(screen.getByText('Income')).toBeInTheDocument();
    expect(screen.getByText('Expense')).toBeInTheDocument();
  });

  it('renders Recurring Transactions section before Categories section', () => {
    render(
      <CategoriesView
        taxonomy={mockTaxonomy}
        transactions={mockTransactions}
        analysis={{}}
        onUpdate={mockOnUpdate}
      />
    );
    const headings = screen.getAllByRole('heading', { level: 2 });
    const headingTexts = headings.map((h) => h.textContent);
    expect(headingTexts[0]).toBe('Recurring Transactions');
    expect(headingTexts[1]).toBe('Categories');
  });

  it('allows adding a new category', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

    render(
      <CategoriesView
        taxonomy={mockTaxonomy}
        transactions={mockTransactions}
        analysis={{}}
        onUpdate={mockOnUpdate}
      />
    );

    const input = screen.getByPlaceholderText('New Category Name...');
    await userEvent.type(input, 'Investment');

    const addBtn = screen.getByText('Add Category');
    await userEvent.click(addBtn);

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/taxonomy/update',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"Investment":[]'),
      })
    );

    await waitFor(() => {
      expect(mockOnUpdate).toHaveBeenCalled();
    });
  });

  it('prevents deleting a category if it is in use', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ inUse: true }),
    });

    render(
      <CategoriesView
        taxonomy={mockTaxonomy}
        transactions={mockTransactions}
        analysis={{}}
        onUpdate={mockOnUpdate}
      />
    );

    // The delete button is hidden until hovered, but testing-library can find it.
    // However, the delete button is an icon. Let's find by title "Delete".
    const deleteBtns = screen.getAllByTitle('Delete');
    await userEvent.click(deleteBtns[0]); // Click first delete button (Expense or Income)

    await waitFor(() => {
      expect(screen.getByText(/Cannot delete .* because it is assigned/)).toBeInTheDocument();
    });

    expect(mockOnUpdate).not.toHaveBeenCalled();
  });

  it('persists and loads section expanded state in localStorage', async () => {
    localStorage.setItem('isCategoriesExpanded', 'false');
    localStorage.setItem('isRecurringExpanded', 'false');

    render(
      <CategoriesView
        taxonomy={mockTaxonomy}
        transactions={mockTransactions}
        analysis={{}}
        onUpdate={mockOnUpdate}
      />
    );

    expect(screen.queryByPlaceholderText('New Category Name...')).not.toBeInTheDocument();
    expect(screen.queryByText('Add Recurring Transaction')).not.toBeInTheDocument();

    const recurringHeader = screen.getByText('Recurring Transactions');
    await userEvent.click(recurringHeader);

    expect(screen.getByText('Add Recurring Transaction')).toBeInTheDocument();
    expect(localStorage.getItem('isRecurringExpanded')).toBe('true');

    localStorage.clear();
  });
});
