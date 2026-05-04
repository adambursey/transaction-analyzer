export function generateSignature(transaction: any): string {
  const date = transaction.Date || "";
  const desc = transaction.Description || "";
  const amount = transaction.Amount !== undefined ? transaction.Amount : "";
  return `${date}|${desc}|${amount}`;
}

export function deduplicateTransactions(incoming: any[], existingSignatures: Set<string>): any[] {
  return incoming.filter(tx => {
    const signature = generateSignature(tx);
    return !existingSignatures.has(signature);
  });
}

export function exactMatchTransactions(
  incoming: any[], 
  knownMapping: Record<string, { Category: string; Subcategory: string }>
): { exactMatches: any[]; fuzzyMatches: any[] } {
  const exactMatches: any[] = [];
  const fuzzyMatches: any[] = [];

  for (const tx of incoming) {
    const desc = tx.Description || "";
    const match = knownMapping[desc];
    
    if (match) {
      exactMatches.push({
        ...tx,
        Category: match.Category,
        Subcategory: match.Subcategory,
        status: "reviewed"
      });
    } else {
      fuzzyMatches.push(tx);
    }
  }

  return { exactMatches, fuzzyMatches };
}
