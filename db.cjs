const { Firestore } = require('@google-cloud/firestore');

async function checkDb() {
  const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
  const txCollection = firestore.collection('transactions');
  
  const allTx = await txCollection.orderBy('Date', 'desc').limit(20).get();
  
  console.log("Top 20 newest transactions in DB:");
  allTx.forEach(doc => {
      const data = doc.data();
      const date = data.Date && data.Date.toDate ? data.Date.toDate() : data.Date;
      console.log(`[${date}] ${data.Description} | Account: ${data.Account} | Amount: ${data.Amount} | Balance: ${data.Balance}`);
  });
}

checkDb().catch(console.error);
