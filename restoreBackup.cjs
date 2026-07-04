const { Firestore } = require('@google-cloud/firestore');
const fs = require('fs');

async function restore() {
  const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
  const txCollection = firestore.collection('transactions');
  
  const backupData = JSON.parse(fs.readFileSync('transactions_backup.json', 'utf8'));
  
  console.log(`Restoring ${backupData.length} transactions...`);
  
  let batch = firestore.batch();
  let count = 0;
  
  for (const item of backupData) {
      const docRef = txCollection.doc(item.id);
      
      // Convert timestamps back
      if (item.data.Date && item.data.Date._seconds !== undefined) {
          item.data.Date = new Firestore.Timestamp(item.data.Date._seconds, item.data.Date._nanoseconds);
      }
      if (item.data.createdAt && item.data.createdAt._seconds !== undefined) {
          item.data.createdAt = new Firestore.Timestamp(item.data.createdAt._seconds, item.data.createdAt._nanoseconds);
      }
      
      batch.set(docRef, item.data);
      count++;
      
      if (count >= 400) {
          await batch.commit();
          batch = firestore.batch();
          count = 0;
      }
  }
  
  if (count > 0) {
      await batch.commit();
  }
  
  console.log('Restore complete!');
}

restore().catch(console.error);
