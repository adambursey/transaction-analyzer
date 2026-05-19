import {
  getTokens,
  calculateIdfWeights,
  calculateTokenOverlap,
  getLongestCommonSubstring,
  runMatchingEngine,
} from '../../src/utils/matchingLogic';

describe('Matching Engine Utils', () => {
  describe('getTokens', () => {
    it('should strip words under 3 characters', () => {
      const tokens = getTokens('A BIG TV');
      expect(tokens).toEqual(['BIG']);
    });

    it('should strip special pending/auth prefixes', () => {
      const tokens = getTokens('PENDING - TARGET PENDING AUTH - WALMART');
      expect(tokens).toEqual(['TARGET', 'WALMART']);
    });

    it('should preserve exactly 4-digit numbers and strip others', () => {
      const tokens = getTokens('TRANSFER TO CHK 1234 TXN 987654321');
      expect(tokens).toContain('1234');
      expect(tokens).not.toContain('987654321');
      expect(tokens).toContain('TXN');
      expect(tokens).toContain('TRANSFER');
      expect(tokens).toContain('CHK');
    });
  });

  describe('TF-IDF Logic', () => {
    it('should calculate lower weights for common words', () => {
      const transactions = [
        { Description: 'PAYMENT TO SPOTIFY' },
        { Description: 'PAYMENT TO NETFLIX' },
        { Description: 'PAYMENT TO HULU' },
      ];
      const weights = calculateIdfWeights(transactions);

      const paymentWeight = weights.get('PAYMENT') || 0;
      const spotifyWeight = weights.get('SPOTIFY') || 0;

      expect(paymentWeight).toBeLessThan(spotifyWeight);
    });

    it('should correctly score token overlaps with IDF weights', () => {
      const transactions = [
        { Description: 'UNIQUE_MERCHANT LOCATION_A' },
        { Description: 'COMMON_WORD LOCATION_B' },
        { Description: 'COMMON_WORD LOCATION_C' },
      ];
      const weights = calculateIdfWeights(transactions);

      // Candidate with the unique word should score highly against an example with the unique word
      const scoreHigh = calculateTokenOverlap(
        'UNIQUE_MERCHANT OTHER',
        ['UNIQUE_MERCHANT LOCATION_A'],
        weights,
        3
      );

      // Candidate with the common word should score lower against an example with the common word
      const scoreLow = calculateTokenOverlap(
        'COMMON_WORD OTHER',
        ['COMMON_WORD LOCATION_B'],
        weights,
        3
      );

      expect(scoreHigh).toBeGreaterThan(scoreLow);
    });
  });

  describe('getLongestCommonSubstring', () => {
    it('should strip non-alphanumeric chars and find longest contiguous match', () => {
      const str1 = 'SPOTIFY*P420362 WEB ID';
      const str2 = 'SPOTIFY P420362';
      const len = getLongestCommonSubstring(str1, str2);
      expect(len).toBe(14); // 'SPOTIFYP420362'
    });
  });

  describe('runMatchingEngine', () => {
    const mockTx = [
      { id: '1', Description: 'NETFLIX COM', Amount: -15.99, Date: new Date('2026-05-01') },
      {
        id: '2',
        Description: 'ONLINE TRANSFER TO SAV 5329',
        Amount: -500.0,
        Date: new Date('2026-05-02'),
      },
      {
        id: '3',
        Description: 'ONLINE TRANSFER TO SAV 9999',
        Amount: -500.0,
        Date: new Date('2026-05-02'),
      },
      { id: '4', Description: 'SPOTIFY', Amount: -10.99, Date: new Date('2026-05-03') },
    ];

    const mockProfiles = [
      {
        id: 'p1',
        description: 'Netflix',
        projectedOccurrence: 'Day 1',
        amountAverage: -15.99,
        exampleTransactionIds: ['1'],
      },
      {
        id: 'p2',
        description: 'Transfer to Savings 5329',
        projectedOccurrence: 'Day 2',
        amountAverage: -500.0,
        exampleTransactionIds: ['2'], // Contains '5329'
      },
      {
        id: 'p3',
        description: 'Spotify',
        projectedOccurrence: 'Day 15', // Will be filtered out if we test on May 1st (Day 1 + 3 < 15)
        amountAverage: -10.99,
        exampleTransactionIds: ['4'],
      },
    ];

    it('should ignore recurring items projected more than 3 days in the future', () => {
      // Running on May 1st
      const results = runMatchingEngine(mockTx, mockProfiles, 2026, 4, 1, mockTx);

      // Spotify (Day 15) should NOT be evaluated.
      const spotifyMatch = results.find((r) => r.transaction.Description === 'SPOTIFY');
      expect(spotifyMatch).toBeUndefined(); // The transaction had no valid candidates so it isn't in the results.
    });

    it('should strictly filter out transfers with mismatched 4-digit tails', () => {
      const results = runMatchingEngine(mockTx, mockProfiles, 2026, 4, 15, mockTx);

      const tx9999 = results.find((r) => r.transaction.Description.includes('9999'));
      expect(tx9999).toBeUndefined(); // The transfer 9999 generates 0 candidates because 5329 is instantly rejected.
    });

    it('should successfully match the correct transfer', () => {
      const results = runMatchingEngine(mockTx, mockProfiles, 2026, 4, 15, mockTx);

      const tx5329 = results.find((r) => r.transaction.Description.includes('5329'));
      expect(tx5329).toBeDefined();

      const matchTo5329 = tx5329?.matches.find((m) => m.recurringId === 'p2');
      expect(matchTo5329).toBeDefined();
      expect(matchTo5329?.score).toBeGreaterThan(65);
    });

    it('should apply greedy assignment to prevent duplicate top matches', () => {
      // We add another identical Spotify transaction to prove greedy assignment
      const multipleSpotifyTx = [
        ...mockTx,
        { id: '5', Description: 'SPOTIFY', Amount: -10.99, Date: new Date('2026-05-10') },
      ];

      const profilesWithOneInstance = [
        {
          ...mockProfiles[2],
          instancesPerPeriod: 1, // Only one spotify charge expected
        },
      ];

      const results = runMatchingEngine(
        multipleSpotifyTx,
        profilesWithOneInstance,
        2026,
        4,
        15,
        multipleSpotifyTx
      );

      // Because it's greedy, the first evaluated tx gets it, the second shouldn't.
      // Both tx4 and tx5 are Spotify. tx5 is newer (May 10 vs May 3), but greedy sorts by score. They have the same score.
      const matchCount = results.filter((r) =>
        r.matches.some((m) => m.recurringId === 'p3')
      ).length;
      expect(matchCount).toBe(1); // Only one of them should get the match!
    });
  });
});
