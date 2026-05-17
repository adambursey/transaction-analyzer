import { Firestore } from '@google-cloud/firestore';
import dotenv from 'dotenv';
dotenv.config();

async function migrate() {
  try {
    const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
    const transactionsCollection = firestore.collection('transactions');

    const snapshot = await transactionsCollection.get();
    let count = 0;

    const batchSize = 400;
    let batch = firestore.batch();
    let operationsInBatch = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (!data.Account) {
        batch.update(doc.ref, { Account: 'Checking' });
        operationsInBatch++;
        count++;

        if (operationsInBatch >= batchSize) {
          await batch.commit();
          batch = firestore.batch();
          operationsInBatch = 0;
        }
      }
    }

    if (operationsInBatch > 0) {
      await batch.commit();
    }

    console.log(`Migration successful! Updated ${count} transactions.`);
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

migrate();
