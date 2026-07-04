const { Firestore } = require('@google-cloud/firestore');
const fs = require('fs');

async function backup() {
  const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
  const txCollection = firestore.collection('transactions');
  
  console.log('Fetching all transactions for backup...');
  const snapshot = await txCollection.get();
  
  const backupData = [];
  snapshot.forEach(doc => {
      backupData.push({
          id: doc.id,
          data: doc.data()
      });
  });
  
  fs.writeFileSync('transactions_backup.json', JSON.stringify(backupData, null, 2));
  console.log(`Successfully backed up ${backupData.length} transactions to transactions_backup.json`);
}

backup().catch(console.error);
