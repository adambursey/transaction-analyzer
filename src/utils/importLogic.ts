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

export const POTENTIAL_DUPLICATE_THRESHOLD = 0.35;

/**
 * String similarity function (Dice's Coefficient)
 * Returns a value between 0.0 and 1.0
 */
export function stringSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return 0.0;

  const getBigrams = (str: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.slice(i, i + 2));
    }
    return bigrams;
  };

  const b1 = getBigrams(s1.toLowerCase());
  const b2 = getBigrams(s2.toLowerCase());

  let intersection = 0;
  for (const bi of b1) {
    if (b2.has(bi)) intersection++;
  }

  return (2.0 * intersection) / (b1.size + b2.size);
}

/**
 * Special case handler for structured transactions like "Online Transfer" and "Online Payment".
 *
 * If BOTH strings match a specific known structured pattern, extracts and compares the critical components.
 * If any of the critical components differ, returns false (not a valid duplicate).
 * Otherwise returns true.
 */
export function isCustomDuplicateValid(desc1: string, desc2: string): boolean {
  // 1. Online Transfers
  const transferRegex =
    /Online Transfer\s+(to|from)\s+([a-zA-Z]{3})\s+\.\.\.(\d{4})\s+transaction#:\s+(\d+)(?:\s+(.{5}))?/i;
  const matchT1 = desc1.match(transferRegex);
  const matchT2 = desc2.match(transferRegex);

  if (matchT1 && matchT2) {
    if (matchT1[1].toLowerCase() !== matchT2[1].toLowerCase()) return false; // Direction (to/from)
    if (matchT1[2].toUpperCase() !== matchT2[2].toUpperCase()) return false; // Account Type
    if (matchT1[3] !== matchT2[3]) return false; // Last 4
    if (matchT1[4] !== matchT2[4]) return false; // TX #

    // Only compare dates if BOTH strings actually contain the date substring.
    if (matchT1[5] && matchT2[5]) {
      if (matchT1[5] !== matchT2[5]) return false; // Date
    }
    return true;
  }

  // 2. Online Payments
  const paymentRegex = /Online Payment (\d+) To (.*)(?: (.{5}))?/i;
  const matchP1 = desc1.match(paymentRegex);
  const matchP2 = desc2.match(paymentRegex);

  if (matchP1 && matchP2) {
    if (matchP1[1] !== matchP2[1]) return false; // TX #
    if (matchP1[2].trim().toLowerCase() !== matchP2[2].trim().toLowerCase()) return false; // Payee

    // Only compare dates if BOTH strings actually contain the date substring.
    if (matchP1[3] && matchP2[3]) {
      if (matchP1[3] !== matchP2[3]) return false; // Date
    }
    return true;
  }

  // 3. Checks
  const checkRegex = /(?:^|\s)Check\s+(\d+)\s*$/i;
  const matchC1 = desc1.match(checkRegex);
  const matchC2 = desc2.match(checkRegex);

  if (matchC1 && matchC2) {
    if (matchC1[1] !== matchC2[1]) return false; // Check number
    return true;
  }

  // 4. Trailing Dates
  // Valid trailing date like MM/DD (e.g. "04/10" or "12/31")
  const trailingDateRegex = /^(.*?)\s+(\d{2}\/\d{2})\s*$/i;
  const matchD1 = desc1.match(trailingDateRegex);
  const matchD2 = desc2.match(trailingDateRegex);

  if (matchD1 && matchD2) {
    const prefix1 = matchD1[1].trim().toLowerCase().replace(/\s+/g, ' ');
    const prefix2 = matchD2[1].trim().toLowerCase().replace(/\s+/g, ' ');

    if (prefix1 === prefix2) {
      if (matchD1[2] !== matchD2[2]) return false; // Date
      return true;
    }
  }

  return true;
}
