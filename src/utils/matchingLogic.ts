/**
 * @file matchingLogic.ts
 * @description Core engine for matching bank transactions to user-defined recurring profiles.
 * This file contains pure functions implementing algorithms like TF-IDF token weighting,
 * Longest Common Substring evaluation, and Greedy Assignment logic to intelligently
 * link variable transactions to expected recurring entries.
 */

export interface MatchingBreakdown {
  /** Score (0-100) representing TF-IDF weighted token overlap */
  tokenScore: number;
  /** Number of contiguous characters matching between the transaction and profile */
  lcsChars: number;
  /** Score boost applied if category/subcategory match (0-100) */
  categoryBonus: number;
  /** String representation of the accepted numeric range (e.g., "[15.00 - 25.00]") */
  amountExpected: string;
  /** The actual absolute numeric amount of the transaction evaluated */
  amountActual: number;
}

export interface MatchCandidate {
  /** The ID of the recurring profile that is a potential match */
  recurringId: string;
  /** The human-readable name of the recurring profile */
  recurringName: string;
  /** The final combined confidence score (0-100) */
  score: number;
  /** Detailed breakdown of how the final score was computed */
  breakdown: MatchingBreakdown;
}

export interface MatchingResult {
  /** The actual transaction object being evaluated */
  transaction: any;
  /** A list of all recurring profiles that scored above the minimum threshold */
  matches: MatchCandidate[];
  /** True if multiple recurring profiles matched with very close top scores (within 15 points) */
  isConflict: boolean;
  /** True if there is only one match and its score is >= 70% */
  isAutoMatch: boolean;
}

/**
 * Sanitizes and tokenizes a string into discrete words, preserving critical identifiers.
 *
 * @param str - The raw transaction description.
 * @returns An array of sanitized string tokens.
 *
 * @example
 * // Returns ["TRANSFER", "SAV", "5329"]
 * getTokens("ONLINE TRANSFER TO SAV 5329 TXN 123456789")
 */
export function getTokens(str: string): string[] {
  if (!str) return [];

  // Clean the string: uppercase, remove standard bank prefixes, and strip special characters
  const sanitized = str
    .toUpperCase()
    .replace(/PENDING - /g, '')
    .replace(/PENDING/g, '')
    .replace(/AUTH - /g, '')
    // We intentionally keep numbers [0-9] so we can preserve 4-digit account tails
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return sanitized.split(' ').filter((t) => {
    // Drop very short tokens (e.g., "TO", "A", "OF") as they add noise
    if (t.length < 3) return false;

    // Non-obvious choice: If a token is entirely numbers, we ONLY keep it if it's exactly 4 digits.
    // Why? Banks often append massive, shifting transaction IDs (e.g., "TXN 982317391283").
    // However, they also include 4-digit account tails (e.g., "...5329") for transfers.
    // 4-digit tails are vital for matching transfers correctly, while massive IDs ruin matches.
    if (/^\d+$/.test(t)) {
      return t.length === 4;
    }
    return true;
  });
}

/**
 * Calculates the Inverse Document Frequency (IDF) weights for all tokens across all transactions.
 *
 * Background: TF-IDF (Term Frequency - Inverse Document Frequency) is a statistical measure
 * used to evaluate how important a word is to a document in a collection or corpus.
 * See: https://en.wikipedia.org/wiki/Tf%E2%80%93idf
 *
 * In this context, common bank words like "PAYMENT", "PURCHASE", or "TRANSFER" appear in almost
 * every transaction, meaning they are useless for distinguishing *which* transaction is which.
 * This function assigns low weights to common words, and high weights to unique words (like a merchant name).
 *
 * @param transactions - The array of all transactions in the database (the "corpus").
 * @returns A Map where the key is the token string, and the value is its numeric IDF weight.
 */
export function calculateIdfWeights(transactions: any[]): Map<string, number> {
  const docCount = transactions.length;
  const df = new Map<string, number>();

  // Step 1: Document Frequency (DF) - Count how many transactions contain each token
  transactions.forEach((tx) => {
    // We use a Set here so a token isn't double-counted if it appears twice in the SAME description
    const tokens = new Set(getTokens(tx.Description || ''));
    tokens.forEach((t) => {
      df.set(t, (df.get(t) || 0) + 1);
    });
  });

  const idf = new Map<string, number>();

  // Step 2: Calculate the actual Inverse Document Frequency weight
  df.forEach((count, token) => {
    // Formula: log(Total Documents / Documents containing token)
    // We add +0.1 to ensure that even a word appearing in 100% of documents gets a non-zero weight.
    idf.set(token, Math.log(docCount / count) + 0.1);
  });

  return idf;
}

/**
 * Helper to retrieve a token's IDF weight, with a fallback for unseen words.
 *
 * @param token - The token to look up.
 * @param idfWeights - The map of pre-computed weights.
 * @param totalDocs - Total number of transactions (used to calculate maximum possible fallback weight).
 * @returns The IDF weight for the token.
 */
export function getIdf(token: string, idfWeights: Map<string, number>, totalDocs: number): number {
  // If a token wasn't in the original corpus (e.g. a brand new merchant), we assume it's extremely unique
  // and give it the maximum possible weight (log of total docs / 1).
  return idfWeights.get(token) || Math.log(totalDocs || 1) + 0.1;
}

/**
 * Calculates a weighted Jaccard-like similarity score between a candidate string and a set of example strings.
 *
 * Background: The Jaccard index measures similarity between finite sample sets (Intersection over Union).
 * See: https://en.wikipedia.org/wiki/Jaccard_index
 * Here, we modify it to be a "Weighted" Jaccard index, where the weights are our IDF scores.
 *
 * @param candidateStr - The new transaction description being evaluated.
 * @param exampleStrs - An array of previously known description strings for a recurring profile.
 * @param idfWeights - The TF-IDF weight map.
 * @param totalDocs - Total transactions in corpus (used for fallback weights).
 * @returns A decimal score from 0.0 to 1.0 representing the highest overlap found.
 */
export function calculateTokenOverlap(
  candidateStr: string,
  exampleStrs: string[],
  idfWeights: Map<string, number>,
  totalDocs: number
): number {
  const candidateTokens = new Set(getTokens(candidateStr));

  if (candidateTokens.size === 0) return 0;

  let maxOverlap = 0;

  // We evaluate the candidate against EVERY known example for this recurring profile,
  // and we keep the highest score.
  for (const ex of exampleStrs) {
    const exTokens = new Set(getTokens(ex));
    if (exTokens.size === 0) continue;

    let intersectionWeight = 0;
    let candidateWeight = 0;
    let exWeight = 0;

    // Calculate the weight of the Candidate tokens and the Intersection
    candidateTokens.forEach((t) => {
      const w = getIdf(t, idfWeights, totalDocs);
      candidateWeight += w;
      if (exTokens.has(t)) {
        intersectionWeight += w; // Token exists in both strings!
      }
    });

    // Calculate the weight of the Example tokens
    exTokens.forEach((t) => {
      exWeight += getIdf(t, idfWeights, totalDocs);
    });

    // Weighted Intersection over Union (IoU)
    const unionWeight = candidateWeight + exWeight - intersectionWeight;
    const overlap = unionWeight > 0 ? intersectionWeight / unionWeight : 0;

    if (overlap > maxOverlap) maxOverlap = overlap;
  }

  return maxOverlap;
}

/**
 * Finds the Longest Common Substring (LCS) between two strings.
 *
 * Background: The LCS algorithm finds the longest contiguous sequence of characters shared by two strings.
 * See: https://en.wikipedia.org/wiki/Longest_common_substring_problem
 *
 * Why do we use this alongside TF-IDF? Because banks often append or prepend data without spaces
 * (e.g. "NETFLIX.COM" vs "PENDINGNETFLIX"), which breaks tokenization. LCS catches these contiguous overlaps.
 *
 * @param str1 - First string to compare.
 * @param str2 - Second string to compare.
 * @returns The integer length of the longest matching contiguous substring.
 */
export function getLongestCommonSubstring(str1: string, str2: string): number {
  // Strip absolutely everything except letters and numbers to ensure we are comparing pure contiguous strings.
  const s1 = str1.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const s2 = str2.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s1 || !s2) return 0;

  let maxLen = 0;
  // Standard dynamic programming or nested loop approach for LCS
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

/**
 * The main orchestrator function. Evaluates an entire month of transactions against
 * all recurring profiles, calculates heuristic scores, resolves conflicts via greedy assignment,
 * and outputs the finalized list of candidates.
 *
 * @param transactions - The full array of transactions in the system.
 * @param recurringTransactions - The array of all configured recurring profiles.
 * @param year - The specific year being evaluated (e.g., 2026).
 * @param month - The specific month being evaluated (0-indexed, e.g., 4 for May).
 * @param todayDate - The current calendar day (1-31), used to filter out future projections.
 * @param allTransactions - The entire global corpus of transactions, used to build accurate TF-IDF weights.
 * @returns An array of `MatchingResult` objects representing matched pairs and flags.
 */
export function runMatchingEngine(
  transactions: any[],
  recurringTransactions: any[],
  year: number,
  month: number,
  todayDate: number,
  allTransactions: any[]
): MatchingResult[] {
  // Filter candidates down to ONLY the current month being evaluated.
  // We do not want to match a transaction from January to a May recurring projection.
  const monthTx = transactions.filter((tx) => {
    const txDate = tx.Date?.toDate
      ? tx.Date.toDate()
      : new Date(tx.Date || tx['Posting Date'] || tx.date);
    return txDate.getFullYear() === year && txDate.getMonth() === month;
  });

  // Pre-compute the TF-IDF corpus weights to save performance inside the loop
  const idfWeights = calculateIdfWeights(allTransactions);
  const totalDocs = allTransactions.length;

  // ----------------------------------------------------------------------
  // STEP 1: Build Target Profiles
  // We transform the raw recurring profiles into rich "Target" objects
  // containing calculated numeric ranges and sets of known categories.
  // ----------------------------------------------------------------------
  const profiles = recurringTransactions
    .filter((rt) => {
      // Look-ahead filter: If a recurring item is expected on the 30th, and today is the 5th,
      // the transaction simply hasn't happened yet. Don't try to match it.
      // We allow a generous 3-day look-ahead to account for weekend posting delays.
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
      // Hydrate the profile with the actual raw example transactions using their IDs
      const examples = (rt.exampleTransactionIds || [])
        .map((id: string) => allTransactions.find((t: any) => t.id === id))
        .filter(Boolean);

      // Determine the expected numeric boundaries.
      // Non-obvious choice: We strictly enforce a +/- 15% range from the known examples.
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

  // ----------------------------------------------------------------------
  // STEP 2: Evaluate Candidates
  // Loop through every transaction and compare it against every profile.
  // ----------------------------------------------------------------------
  monthTx.forEach((tx) => {
    const txAmount = Math.abs(tx.Amount || 0);
    const txCategory = tx.Category;
    const txSubcategory = tx.Subcategory;
    const txDesc = tx.Description || '';
    const txTokens = new Set(getTokens(txDesc));

    profiles.forEach((profile) => {
      // Step 2A: Strict Amount Filter
      // If the transaction amount doesn't fit the +/- 15% expected window, instantly reject it.
      if (txAmount < profile.expectedMin || txAmount > profile.expectedMax) return;

      // Step 2B: The "Anti-Match Penalty" for Transfers
      // Transfers to different accounts often have the exact same amounts and common words
      // (e.g. "ONLINE TRANSFER TO CHK"). This causes immense conflicts.
      // If the profile AND the transaction both contain a 4-digit number (an account tail),
      // but they DO NOT MATCH, we instantly reject the pair to prevent cross-account contamination.
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

        // Both contain a 4 digit tail, but they are different!
        if (!intersection4Digit) return;
      }

      // Step 2C: Calculate Text Similarity
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

      // Max out the LCS score if they share an 8-character continuous string.
      const lcsScore = Math.min(1, maxLcs / 8);

      // Step 2D: Apply Category Classification Bonus
      // If a transaction has already been categorized by the generic rules engine,
      // and it perfectly aligns with our expected category, we give it a flat bonus.
      let categoryBonus = 0;
      if (txCategory && profile.exampleCategories.has(txCategory)) {
        categoryBonus += 0.15;
        if (txSubcategory && profile.exampleSubcategories.has(txSubcategory)) {
          categoryBonus += 0.1;
        }
      }

      // Step 2E: Final Weighted Math
      // We weight Token Overlap at 50% and Substring Match at 50%, plus the bonus.
      let finalScore = tokenScore * 0.5 + lcsScore * 0.5 + categoryBonus;
      finalScore = Math.min(1, finalScore); // Cap at 100%

      // Step 2F: Minimum Viability Threshold
      // Only keep candidate pairs that reach a 65% confidence interval.
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

  // ----------------------------------------------------------------------
  // STEP 3: Greedy Assignment & Conflict Detection
  // Background: A Greedy Algorithm builds a solution piece by piece, always
  // choosing the next piece that offers the most obvious and immediate benefit.
  // See: https://en.wikipedia.org/wiki/Greedy_algorithm
  //
  // If we have 1 "Spotify" profile, and 5 separate transactions scored > 65%,
  // we sort ALL global candidate pairs by score (Highest -> Lowest).
  // The first (highest) match for Spotify "consumes" the profile's instance slot.
  // Lower scoring transactions attempting to claim Spotify are then ignored.
  // ----------------------------------------------------------------------
  allPairwise.sort((a, b) => b.score - a.score);

  const txMatchesMap = new Map();
  const profileMatchCount = new Map();
  profiles.forEach((p) => profileMatchCount.set(p.id, 0));

  allPairwise.forEach((pair) => {
    const pId = pair.profile.id;
    // How many times can this recurring profile occur in a single month? Defaults to 1.
    const maxInstances = pair.profile.instancesPerPeriod || 1;

    // If the profile's slots are fully consumed by higher-confidence matches, ignore this weaker attempt.
    if (profileMatchCount.get(pId) >= maxInstances) return;

    if (!txMatchesMap.has(pair.tx)) {
      txMatchesMap.set(pair.tx, []);
    }

    const matchesForTx = txMatchesMap.get(pair.tx);

    if (matchesForTx.length === 0) {
      // This is the absolute best match for this transaction so far! Claim the slot.
      matchesForTx.push(pair);
      profileMatchCount.set(pId, profileMatchCount.get(pId) + 1);
    } else {
      // This transaction already claimed a different top match.
      // Are two profiles fighting over the same transaction?
      const bestScore = matchesForTx[0].score;
      if (bestScore - pair.score < 15) {
        // If the new profile's score is within 15 points of the top score, it's a conflict!
        // We push it so the UI can render the "Conflict Flagged" warning to the user.
        matchesForTx.push(pair);
        profileMatchCount.set(pId, profileMatchCount.get(pId) + 1);
      }
    }
  });

  // ----------------------------------------------------------------------
  // STEP 4: Format for Output
  // Restructure the Map into a clean, typed array for the frontend to consume.
  // ----------------------------------------------------------------------
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

  // Sort final array by Date descending (newest transactions first)
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
