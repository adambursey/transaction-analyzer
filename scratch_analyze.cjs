const { Firestore } = require('@google-cloud/firestore');

async function analyze() {
  const db = new Firestore({ projectId: 'tx-analyzer-1777844550' });

  // Fetch transactions for July 2026 (Checking account)
  const txSnapshot = await db.collection('transactions')
    .where('Account', '==', 'Checking')
    .get();

  const transactions = [];
  txSnapshot.forEach(doc => {
    const data = doc.data();
    if (!data.Date) return;
    const date = data.Date.toDate ? data.Date.toDate() : new Date(data.Date);
    // Filter for June 25 to July 5
    if (date.getFullYear() === 2026 && ((date.getMonth() === 6 && date.getDate() <= 5) || (date.getMonth() === 5 && date.getDate() >= 25))) {
        transactions.push({
            id: doc.id,
            ...data,
            dateStr: date.toISOString().split('T')[0]
        });
    }
  });

  transactions.sort((a, b) => new Date(a.dateStr) - new Date(b.dateStr));

  console.log("--- Actual Transactions near early July 2026 ---");
  transactions.forEach(t => {
      console.log(`[${t.dateStr}] $${(t.Amount||0).toFixed(2).padStart(8)} | ${t.Description?.substring(0, 40)}`);
  });

  // Now let's fetch recurring transactions
  const recSnapshot = await db.collection('recurring_transactions').get();
  console.log("\n--- Active Recurring Transactions ---");
  recSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.active) {
          console.log(`[Expected Day: ${String(data.expectedDate).padStart(2)}] $${(data.averageAmount||0).toFixed(2).padStart(8)} | ${data.merchantName} | ${data.frequency}`);
      }
  });
}

analyze().catch(console.error);
