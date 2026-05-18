export const COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#6366f1',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#06b6d4',
  '#84cc16',
  '#a855f7',
  '#f43f5e',
  '#0ea5e9',
  '#10b981',
  '#64748b',
  '#d946ef',
  '#f59e0b',
  '#3b82f6',
  '#ef4444',
];

export const getCategoryColor = (categoryName: string) => {
  if (categoryName === 'Reconciliation Discrepancy') return '#64748b'; // slate-500
  let hash = 0;
  for (let i = 0; i < categoryName.length; i++) {
    hash = categoryName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COLORS.length;
  return COLORS[index];
};
