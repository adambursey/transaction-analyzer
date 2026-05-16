export function generateSignature(transaction: any): string {
  let dateStr = "";
  const rawDate = transaction.Date;
  
  if (rawDate) {
    let d: Date | null = null;
    if (rawDate instanceof Date) {
      d = rawDate;
    } else if (typeof rawDate.toDate === 'function') {
      d = rawDate.toDate();
    } else if (typeof rawDate === 'object' && rawDate._seconds) {
      d = new Date(rawDate._seconds * 1000);
    } else {
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

  const desc = transaction.Description || "";
  let parsedAmount = 0;
  if (typeof transaction.Amount === 'number') {
    parsedAmount = transaction.Amount;
  } else if (typeof transaction.Amount === 'string') {
    parsedAmount = Number(transaction.Amount.replace(/[^0-9.-]+/g, ""));
  }
  const amount = isNaN(parsedAmount) ? "" : parsedAmount;

  return `${dateStr}|${desc}|${amount}`;
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
