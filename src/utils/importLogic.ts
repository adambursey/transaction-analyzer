/**
 * Generates a unique signature string for a transaction based on its date, description, and amount.
 * This signature is used for deduplication to prevent importing the same transaction multiple times.
 *
 * @param transaction - The raw transaction object.
 * @returns A unique string signature (e.g., "2023-10-27|grocery store|45.67").
 */
export function generateSignature(transaction: any): string {
  let dateStr = '';
  const rawDate = transaction.Date;

  if (rawDate) {
    let d: Date | null = null;
    if (rawDate instanceof Date) {
      d = rawDate;
    } else if (typeof rawDate.toDate === 'function') {
      // Handle Firestore Timestamp objects
      d = rawDate.toDate();
    } else if (typeof rawDate === 'object' && rawDate._seconds) {
      // Handle serialized Firestore Timestamps (often occurs when passed via IPC or API)
      d = new Date(rawDate._seconds * 1000);
    } else {
      // Fallback to standard JS Date parsing for strings
      const fallback = new Date(rawDate);
      if (!isNaN(fallback.getTime())) {
        d = fallback;
      }
    }

    if (d) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dateStr = `${year}-${month}-${day}`;
    } else {
      dateStr = String(rawDate).trim();
    }
  }

  const desc = String(transaction.Description || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  let parsedAmount = 0;
  if (typeof transaction.Amount === 'number') {
    parsedAmount = transaction.Amount;
  } else if (typeof transaction.Amount === 'string') {
    parsedAmount = Number(transaction.Amount.replace(/[^0-9.-]+/g, ''));
  }
  const amount = isNaN(parsedAmount) ? '' : parsedAmount;

  return `${dateStr}|${desc}|${amount}`;
}

/**
 * Deduplicates an array of incoming transactions against a set of existing signatures.
 *
 * @param incoming - An array of raw transaction objects to be deduplicated.
 * @param existingSignatures - A Set of strings representing signatures of transactions that have already been imported.
 * @returns An array of transactions that do not match any existing signatures.
 */
export function deduplicateTransactions(incoming: any[], existingSignatures: Set<string>): any[] {
  return incoming.filter((tx) => {
    const signature = generateSignature(tx);
    if (!existingSignatures.has(signature)) {
      existingSignatures.add(signature);
      return true;
    }
    return false;
  });
}

/**
 * Matches incoming transactions against a known mapping of descriptions to categories/subcategories.
 *
 * @param incoming - An array of deduplicated transaction objects.
 * @param knownMapping - A dictionary mapping transaction descriptions to known Category and Subcategory.
 * @returns An object containing arrays of exactly matched transactions and fuzzy (unmatched) transactions.
 */
export function exactMatchTransactions(
  incoming: any[],
  knownMapping: Record<string, { Category: string; Subcategory: string }>
): { exactMatches: any[]; fuzzyMatches: any[] } {
  const exactMatches: any[] = [];
  const fuzzyMatches: any[] = [];

  for (const tx of incoming) {
    const desc = tx.Description || '';
    const match = knownMapping[desc];

    if (match) {
      exactMatches.push({
        ...tx,
        Category: match.Category,
        Subcategory: match.Subcategory,
        status: 'reviewed',
      });
    } else {
      fuzzyMatches.push(tx);
    }
  }

  return { exactMatches, fuzzyMatches };
}
