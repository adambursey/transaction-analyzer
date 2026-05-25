import { Firestore } from '@google-cloud/firestore';
import dotenv from 'dotenv';

dotenv.config();

async function listMayTransactions() {
  const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
  const snapshot = await firestore.collection('transactions').get();

  const txs = snapshot.docs
    .map((doc) => {
      const data = doc.data();
      let dateStr = '';
      if (data.Date && data.Date.toDate) {
        dateStr = data.Date.toDate().toISOString();
      } else if (data.Date && data.Date._seconds) {
        dateStr = new Date(data.Date._seconds * 1000).toISOString();
      } else {
        dateStr = String(data.Date || '');
      }
      return {
        id: doc.id,
        Date: dateStr,
        Description: data.Description,
        Amount: data.Amount,
        Balance: data.Balance,
        Account: data.Account,
        Category: data.Category,
        status: data.status,
      };
    })
    .filter((tx) => tx.Date.startsWith('2026-05') && tx.status !== 'archived')
    .sort((a, b) => a.Date.localeCompare(b.Date));

  console.log(`Found ${txs.length} active transactions in May 2026:`);
  let sumAmount = 0;
  txs.forEach((tx) => {
    console.log(
      `[${tx.Account}] ${tx.Date.slice(0, 10)} | ${tx.Description.padEnd(45)} | Amt: ${String(tx.Amount).padStart(9)} | Bal: ${String(tx.Balance).padStart(9)} | Cat: ${tx.Category}`
    );
    sumAmount += tx.Amount;
  });
  console.log(`Sum of all May transaction amounts: ${sumAmount.toFixed(2)}`);
}

listMayTransactions();
