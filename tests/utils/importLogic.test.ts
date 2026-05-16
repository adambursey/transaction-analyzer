import {
  generateSignature,
  deduplicateTransactions,
  exactMatchTransactions,
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
});
