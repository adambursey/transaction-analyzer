/**
 * @file migrate_created_at.ts
 * @description Standalone database migration script that backfills the `createdAt`
 * creation timestamp metadata attribute for all transaction records in the Firestore database.
 * This runs as a one-time operation, updating transaction documents in atomic batches.
 */

import { Firestore, Timestamp } from '@google-cloud/firestore';
import dotenv from 'dotenv';

// Initialize environment variables from .env file
dotenv.config();

/**
 * Main migration function that retrieves all transactions from Firestore,
 * identifies documents missing the `createdAt` timestamp, and backfills
 * them using Firestore batch updates.
 */
async function migrateCreatedAt() {
  try {
    console.log('[Migration] Connecting to Firestore...');
    const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
    const transactionsCollection = firestore.collection('transactions');

    console.log('[Migration] Fetching transactions snapshot...');
    const snapshot = await transactionsCollection.get();
    let count = 0;

    const batchSize = 400;
    let batch = firestore.batch();
    let operationsInBatch = 0;

    console.log(
      `[Migration] Scanning ${snapshot.docs.length} transactions for missing createdAt metadata...`
    );

    // Iterate through all fetched transaction documents
    for (const doc of snapshot.docs) {
      const data = doc.data();

      // If the transaction is missing the createdAt attribute, we backfill it with now
      if (!data.createdAt) {
        batch.update(doc.ref, {
          createdAt: Timestamp.now(),
        });
        operationsInBatch++;
        count++;

        // Commit batched updates in chunks of 400 to comply with Firestore batch limits
        if (operationsInBatch >= batchSize) {
          console.log(`[Migration] Committing batch of ${operationsInBatch} updates...`);
          await batch.commit();
          batch = firestore.batch();
          operationsInBatch = 0;
        }
      }
    }

    // Commit any remaining operations in the final batch
    if (operationsInBatch > 0) {
      console.log(`[Migration] Committing final batch of ${operationsInBatch} updates...`);
      await batch.commit();
    }

    console.log(`Successfully backfilled createdAt timestamps for ${count} transactions.`);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

// Execute the migration script
migrateCreatedAt();
