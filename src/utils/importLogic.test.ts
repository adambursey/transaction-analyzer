import { describe, it, expect } from "vitest";
import { generateSignature, deduplicateTransactions, exactMatchTransactions } from "./importLogic";

describe("importLogic", () => {
  describe("generateSignature", () => {
    it("should generate a consistent signature for a transaction", () => {
      const tx = { Date: "2026-05-01", Description: "UBER EATS", Amount: -20.5 };
      const sig1 = generateSignature(tx);
      const sig2 = generateSignature({ Date: "2026-05-01", Description: "UBER EATS", Amount: -20.5 });
      expect(sig1).toBe(sig2);
      // We expect the signature to be a deterministic concatenation
      expect(sig1).toBe("2026-05-01|UBER EATS|-20.5");
    });

    it("should handle missing fields gracefully", () => {
      const tx = { Description: "UBER EATS" };
      const sig = generateSignature(tx);
      expect(sig).toBe("|UBER EATS|");
    });
  });

  describe("deduplicateTransactions", () => {
    it("should filter out transactions that exist in the signatures set", () => {
      const incoming = [
        { Date: "2026-05-01", Description: "UBER EATS", Amount: -20.5 },
        { Date: "2026-05-02", Description: "AMAZON", Amount: -100 },
      ];
      // Simulate that UBER EATS already exists in the database
      const existingSignatures = new Set(["2026-05-01|UBER EATS|-20.5"]);
      const unique = deduplicateTransactions(incoming, existingSignatures);
      
      expect(unique.length).toBe(1);
      expect(unique[0].Description).toBe("AMAZON");
    });
  });

  describe("exactMatchTransactions", () => {
    it("should correctly split exact matches and fuzzy matches", () => {
      const incoming = [
        { Description: "UBER EATS" },
        { Description: "UBER EATS 1234" }, // Close but not exact
        { Description: "AMAZON" }
      ];
      
      // Known exact mapping dictionary
      const knownMapping = {
        "UBER EATS": { Category: "Food", Subcategory: "Delivery" }
      };

      const result = exactMatchTransactions(incoming, knownMapping);
      
      // One exact match should be categorized and marked as reviewed
      expect(result.exactMatches.length).toBe(1);
      expect(result.exactMatches[0].Description).toBe("UBER EATS");
      expect(result.exactMatches[0].Category).toBe("Food");
      expect(result.exactMatches[0].Subcategory).toBe("Delivery");
      expect(result.exactMatches[0].status).toBe("reviewed");

      // Two fuzzy matches remain
      expect(result.fuzzyMatches.length).toBe(2);
      expect(result.fuzzyMatches[0].Description).toBe("UBER EATS 1234");
      expect(result.fuzzyMatches[1].Description).toBe("AMAZON");
    });
  });
});
