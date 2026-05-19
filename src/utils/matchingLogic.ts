export interface MatchingBreakdown {
  tokenScore: number;
  lcsChars: number;
  categoryBonus: number;
  amountExpected: string;
  amountActual: number;
}

export interface MatchCandidate {
  recurringId: string;
  recurringName: string;
  score: number;
  breakdown: MatchingBreakdown;
}

export interface MatchingResult {
  transaction: any;
  matches: MatchCandidate[];
  isConflict: boolean;
  isAutoMatch: boolean;
}

export function getTokens(str: string): string[] {
  if (!str) return [];
  const sanitized = str
    .toUpperCase()
    .replace(/PENDING - /g, '')
    .replace(/PENDING/g, '')
    .replace(/AUTH - /g, '')
    .replace(/[^A-Z0-9\s]/g, ' ') // Keep numbers for account tails, replace special chars
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized.split(' ').filter((t) => {
    if (t.length < 3) return false;
    // If it's a pure number, only keep it if it's exactly 4 digits (e.g. account tail "5329")
    if (/^\d+$/.test(t)) {
      return t.length === 4;
    }
    return true;
  });
}

export function calculateIdfWeights(transactions: any[]): Map<string, number> {
  const docCount = transactions.length;
  const df = new Map<string, number>();

  transactions.forEach((tx) => {
    const tokens = new Set(getTokens(tx.Description || ''));
    tokens.forEach((t) => {
      df.set(t, (df.get(t) || 0) + 1);
    });
  });

  const idf = new Map<string, number>();
  df.forEach((count, token) => {
    idf.set(token, Math.log(docCount / count) + 0.1);
  });

  return idf;
}

export function getIdf(token: string, idfWeights: Map<string, number>, totalDocs: number): number {
  return idfWeights.get(token) || Math.log(totalDocs || 1) + 0.1;
}

export function calculateTokenOverlap(
  candidateStr: string,
  exampleStrs: string[],
  idfWeights: Map<string, number>,
  totalDocs: number
): number {
  const candidateTokens = new Set(getTokens(candidateStr));

  if (candidateTokens.size === 0) return 0;

  let maxOverlap = 0;

  for (const ex of exampleStrs) {
    const exTokens = new Set(getTokens(ex));
    if (exTokens.size === 0) continue;

    let intersectionWeight = 0;
    let candidateWeight = 0;
    let exWeight = 0;

    candidateTokens.forEach((t) => {
      const w = getIdf(t, idfWeights, totalDocs);
      candidateWeight += w;
      if (exTokens.has(t)) {
        intersectionWeight += w;
      }
    });

    exTokens.forEach((t) => {
      exWeight += getIdf(t, idfWeights, totalDocs);
    });

    const unionWeight = candidateWeight + exWeight - intersectionWeight;
    const overlap = unionWeight > 0 ? intersectionWeight / unionWeight : 0;
    if (overlap > maxOverlap) maxOverlap = overlap;
  }

  return maxOverlap;
}

export function getLongestCommonSubstring(str1: string, str2: string): number {
  const s1 = str1.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const s2 = str2.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s1 || !s2) return 0;

  let maxLen = 0;
  for (let i = 0; i < s1.length; i++) {
    for (let j = 0; j < s2.length; j++) {
      let len = 0;
      while (i + len < s1.length && j + len < s2.length && s1[i + len] === s2[j + len]) {
        len++;
      }
      if (len > maxLen) maxLen = len;
    }
  }
  return maxLen;
}

export function runMatchingEngine(
  transactions: any[],
  recurringTransactions: any[],
  year: number,
  month: number,
  todayDate: number,
  allTransactions: any[] // Used for calculating global IDF weights and finding examples
): MatchingResult[] {
  const monthTx = transactions.filter((tx) => {
    const txDate = tx.Date?.toDate
      ? tx.Date.toDate()
      : new Date(tx.Date || tx['Posting Date'] || tx.date);
    return txDate.getFullYear() === year && txDate.getMonth() === month;
  });

  const idfWeights = calculateIdfWeights(allTransactions);
  const totalDocs = allTransactions.length;

  // 1. Build Target Profiles
  const profiles = recurringTransactions
    .filter((rt) => {
      if (rt.projectedOccurrence && rt.projectedOccurrence !== 'Unknown') {
        const match = rt.projectedOccurrence.match(/(?:Day\s+)?(\d+)/i);
        if (match) {
          const projDay = parseInt(match[1]);
          if (projDay > todayDate + 3) {
            return false;
          }
        }
      }
      return true;
    })
    .map((rt) => {
      const examples = (rt.exampleTransactionIds || [])
        .map((id: string) => allTransactions.find((t: any) => t.id === id))
        .filter(Boolean);

      let baseMin = 0,
        baseMax = 0;
      if (examples.length > 0) {
        const amounts = examples.map((e: any) => Math.abs(e.Amount));
        baseMin = Math.min(...amounts);
        baseMax = Math.max(...amounts);
      } else {
        baseMin = Math.abs(rt.amountAverage || 0);
        baseMax = Math.abs(rt.amountAverage || 0);
      }

      const expectedMin = baseMin * 0.85;
      const expectedMax = baseMax * 1.15;

      const exampleDescriptions = examples.map((e: any) => e.Description || '');
      if (exampleDescriptions.length === 0 && rt.description) {
        exampleDescriptions.push(rt.description);
      }

      const exampleCategories = new Set(examples.map((e: any) => e.Category).filter(Boolean));
      const exampleSubcategories = new Set(examples.map((e: any) => e.Subcategory).filter(Boolean));

      return {
        ...rt,
        examples,
        expectedMin,
        expectedMax,
        exampleDescriptions,
        exampleCategories,
        exampleSubcategories,
      };
    });

  const allPairwise: any[] = [];

  // 2. Evaluate Candidates
  monthTx.forEach((tx) => {
    const txAmount = Math.abs(tx.Amount || 0);
    const txCategory = tx.Category;
    const txSubcategory = tx.Subcategory;
    const txDesc = tx.Description || '';
    const txTokens = new Set(getTokens(txDesc));

    profiles.forEach((profile) => {
      if (txAmount < profile.expectedMin || txAmount > profile.expectedMax) return;

      let profileHas4Digit = false;
      let txHas4Digit = false;
      let intersection4Digit = false;

      const profileTokens = new Set<string>();
      profile.exampleDescriptions.forEach((ex: string) => {
        getTokens(ex).forEach((t) => profileTokens.add(t));
      });

      profileTokens.forEach((t) => {
        if (/^\d{4}$/.test(t)) profileHas4Digit = true;
      });
      txTokens.forEach((t) => {
        if (/^\d{4}$/.test(t)) txHas4Digit = true;
      });

      if (profileHas4Digit && txHas4Digit) {
        txTokens.forEach((t) => {
          if (/^\d{4}$/.test(t) && profileTokens.has(t)) {
            intersection4Digit = true;
          }
        });
        if (!intersection4Digit) return;
      }

      const tokenScore = calculateTokenOverlap(
        txDesc,
        profile.exampleDescriptions,
        idfWeights,
        totalDocs
      );

      let maxLcs = 0;
      profile.exampleDescriptions.forEach((exDesc: string) => {
        const lcs = getLongestCommonSubstring(txDesc, exDesc);
        if (lcs > maxLcs) maxLcs = lcs;
      });

      const lcsScore = Math.min(1, maxLcs / 8);

      let categoryBonus = 0;
      if (txCategory && profile.exampleCategories.has(txCategory)) {
        categoryBonus += 0.15;
        if (txSubcategory && profile.exampleSubcategories.has(txSubcategory)) {
          categoryBonus += 0.1;
        }
      }

      let finalScore = tokenScore * 0.5 + lcsScore * 0.5 + categoryBonus;
      finalScore = Math.min(1, finalScore);

      if (finalScore >= 0.65) {
        allPairwise.push({
          tx,
          profile,
          score: Math.round(finalScore * 100),
          breakdown: {
            tokenScore: Math.round(tokenScore * 100),
            lcsChars: maxLcs,
            categoryBonus: Math.round(categoryBonus * 100),
            amountExpected: `[${profile.expectedMin.toFixed(2)} - ${profile.expectedMax.toFixed(2)}]`,
            amountActual: txAmount,
          },
        });
      }
    });
  });

  // 3. Greedy Assignment & Conflict Detection
  allPairwise.sort((a, b) => b.score - a.score);

  const txMatchesMap = new Map();
  const profileMatchCount = new Map();
  profiles.forEach((p) => profileMatchCount.set(p.id, 0));

  allPairwise.forEach((pair) => {
    const pId = pair.profile.id;
    const maxInstances = pair.profile.instancesPerPeriod || 1;

    if (profileMatchCount.get(pId) >= maxInstances) return;

    if (!txMatchesMap.has(pair.tx)) {
      txMatchesMap.set(pair.tx, []);
    }

    const matchesForTx = txMatchesMap.get(pair.tx);

    if (matchesForTx.length === 0) {
      matchesForTx.push(pair);
      profileMatchCount.set(pId, profileMatchCount.get(pId) + 1);
    } else {
      const bestScore = matchesForTx[0].score;
      if (bestScore - pair.score < 15) {
        matchesForTx.push(pair);
        profileMatchCount.set(pId, profileMatchCount.get(pId) + 1);
      }
    }
  });

  // 4. Format for Output
  const matchResults: MatchingResult[] = [];
  txMatchesMap.forEach((matches, tx) => {
    matchResults.push({
      transaction: tx,
      matches: matches.map((m: any) => ({
        recurringId: m.profile.id,
        recurringName: m.profile.description,
        score: m.score,
        breakdown: m.breakdown,
      })),
      isConflict: matches.length > 1,
      isAutoMatch: matches.length === 1 && matches[0].score >= 70,
    });
  });

  matchResults.sort((a, b) => {
    const dateA = a.transaction.Date?.toDate
      ? a.transaction.Date.toDate()
      : new Date(a.transaction.Date || a.transaction['Posting Date'] || a.transaction.date);
    const dateB = b.transaction.Date?.toDate
      ? b.transaction.Date.toDate()
      : new Date(b.transaction.Date || b.transaction['Posting Date'] || b.transaction.date);
    return dateB.getTime() - dateA.getTime();
  });

  return matchResults;
}
