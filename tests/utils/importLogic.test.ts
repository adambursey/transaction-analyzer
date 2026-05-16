import {
  generateSignature,
  deduplicateTransactions,
  exactMatchTransactions,
  stringSimilarity,
  isCustomDuplicateValid,
} from '../../src/utils/importLogic';

describe('importLogic', () => {
  describe('generateSignature', () => {
    it('should generate a consistent signature for a transaction', () => {
      const tx = { Date: '05/01/2026', Description: 'UBER EATS', Amount: -20.5 };
      const sig1 = generateSignature(tx);
      const sig2 = generateSignature({ ...tx, id: 'ignore-me', status: 'reviewed' });
      expect(sig1).toBe(sig2);
      // We expect the signature to be a deterministic concatenation
      expect(sig1).toBe('2026-05-01|uber eats|-20.5');
    });

    it('should handle missing fields gracefully', () => {
      const tx = { Description: 'UBER EATS' };
      const sig = generateSignature(tx);
      expect(sig).toBe('|uber eats|0');
    });
  });

  describe('deduplicateTransactions', () => {
    it('should filter out transactions that exist in the signatures set', () => {
      const existingSignatures = new Set(['2026-05-01|uber eats|-20.5']);
      const incoming = [
        { Date: '05/01/2026', Description: 'UBER EATS', Amount: -20.5 }, // Duplicate
        { Date: '05/01/2026', Description: 'AMAZON', Amount: -100 }, // New
      ];

      const unique = deduplicateTransactions(incoming, existingSignatures);

      expect(unique.length).toBe(1);
      expect(unique[0].Description).toBe('AMAZON');
    });
  });

  describe('exactMatchTransactions', () => {
    it('should correctly split exact matches and fuzzy matches', () => {
      const incoming = [
        { Description: 'UBER EATS' },
        { Description: 'UBER EATS 1234' }, // Close but not exact
        { Description: 'AMAZON' },
      ];

      // Known exact mapping dictionary
      const knownMapping = {
        'UBER EATS': { Category: 'Food', Subcategory: 'Delivery' },
      };

      const result = exactMatchTransactions(incoming, knownMapping);

      // One exact match should be categorized and marked as reviewed
      expect(result.exactMatches.length).toBe(1);
      expect(result.exactMatches[0].Description).toBe('UBER EATS');
      expect(result.exactMatches[0].Category).toBe('Food');
      expect(result.exactMatches[0].Subcategory).toBe('Delivery');
      expect(result.exactMatches[0].status).toBe('reviewed');

      // Two fuzzy matches remain
      expect(result.fuzzyMatches.length).toBe(2);
      expect(result.fuzzyMatches[0].Description).toBe('UBER EATS 1234');
      expect(result.fuzzyMatches[1].Description).toBe('AMAZON');
    });
  });

  describe('stringSimilarity', () => {
    it('should return 1.0 for identical strings', () => {
      expect(stringSimilarity('hello world', 'hello world')).toBe(1.0);
    });

    it('should return 0.0 for completely different strings', () => {
      expect(stringSimilarity('abc', 'xyz')).toBe(0.0);
    });

    it('should calculate Dice coefficient correctly for similar strings', () => {
      // "night" -> bigrams: ni, ig, gh, ht
      // "nacht" -> bigrams: na, ac, ch, ht
      // intersection: "ht" (1)
      // total bigrams: 4 + 4 = 8
      // Dice = 2 * 1 / 8 = 0.25
      expect(stringSimilarity('night', 'nacht')).toBe(0.25);
    });

    it('should handle case insensitivity', () => {
      expect(stringSimilarity('UBER EATS', 'uber eats')).toBe(1.0);
    });
  });

  describe('isCustomDuplicateValid', () => {
    it('should return true if both strings match the exact pattern and all fields are identical', () => {
      const desc1 = 'Online Transfer to CHK ...1108 transaction#: 29158066672 05/11';
      const desc2 = 'Online Transfer to CHK ...1108 transaction#: 29158066672 05/11';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(true);
    });

    it('should return false if the Account Type differs', () => {
      const desc1 = 'Online Transfer to CHK ...1108 transaction#: 29158066672 05/11';
      const desc2 = 'Online Transfer to SAV ...1108 transaction#: 29158066672 05/11';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should return false if the Direction differs', () => {
      const desc1 = 'Online Transfer to CHK ...1108 transaction#: 29158066672 05/11';
      const desc2 = 'Online Transfer from CHK ...1108 transaction#: 29158066672 05/11';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should return true if "from" is used and fields match', () => {
      const desc1 = 'Online Transfer from CHK ...1108 transaction#: 29158066672 05/11';
      const desc2 = 'Online Transfer from CHK ...1108 transaction#: 29158066672 05/11';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(true);
    });

    it('should return true if one is missing the date but other fields match', () => {
      const desc1 = 'Online Transfer from CHK ...0459 transaction#: 27738497894';
      const desc2 = 'Online Transfer from CHK ...0459 transaction#: 27738497894 06/12';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(true);
    });

    it('should return false if the Last 4 differs', () => {
      const desc1 = 'Online Transfer to CHK ...1108 transaction#: 29158066672 05/11';
      const desc2 = 'Online Transfer to CHK ...9999 transaction#: 29158066672 05/11';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should return false if the Transaction ID differs', () => {
      const desc1 = 'Online Transfer to CHK ...1108 transaction#: 29158066672 05/11';
      const desc2 = 'Online Transfer to CHK ...1108 transaction#: 99999999999 05/11';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should return false if the Date differs', () => {
      const desc1 = 'Online Transfer to CHK ...1108 transaction#: 29158066672 05/11';
      const desc2 = 'Online Transfer to CHK ...1108 transaction#: 29158066672 06/12';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should return true if one or both strings do NOT match the very strict pattern', () => {
      // The function is meant to explicitly reject strict matches that differ.
      // If they don't both match the strict pattern, it defaults to true (meaning the rest of the deduplication pipeline evaluates them)
      const desc1 = 'Online Transfer to CHK ...1108 transaction#: 29158066672 05/11';
      const desc2 = 'Just a regular transfer';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(true);
    });

    it('should handle extra padding spaces used by the bank', () => {
      const desc1 = 'Online Transfer to  SAV ...5337 transaction#: 28721294108';
      const desc2 = 'Online Transfer to  SAV ...5329 transaction#: 28721331055';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should handle Online Payments successfully', () => {
      const desc1 = 'Online Payment 27172616709 To Northwest 12/30';
      const desc2 = 'Online Payment 27172616709 To Northwest 12/30';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(true);
    });

    it('should reject Online Payments with differing transaction IDs', () => {
      const desc1 = 'Online Payment 27172616709 To Northwest 12/30';
      const desc2 = 'Online Payment 27185550180 To Northwest 01/05';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should reject CHECK transactions with differing check numbers', () => {
      const desc1 = 'CHECK 1806';
      const desc2 = 'CHECK 1808';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should reject CHECK transactions even with trailing whitespace', () => {
      const desc1 = 'CHECK 1806  ';
      const desc2 = 'CHECK 1808  ';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should accept CHECK transactions with identical check numbers', () => {
      const desc1 = 'CHECK 1806';
      const desc2 = 'CHECK 1806';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(true);
    });

    it('should reject transactions identical except for trailing date', () => {
      const desc1 = 'TARGET STORE 04/10';
      const desc2 = 'TARGET STORE 04/11';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should handle extra whitespace in transactions with trailing dates', () => {
      const desc1 = 'TARGET   STORE  04/10';
      const desc2 = 'TARGET STORE 04/11';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(false);
    });

    it('should accept trailing date transactions if dates are identical', () => {
      const desc1 = 'TARGET STORE 04/10';
      const desc2 = 'TARGET STORE 04/10';
      expect(isCustomDuplicateValid(desc1, desc2)).toBe(true);
    });
  });
});
