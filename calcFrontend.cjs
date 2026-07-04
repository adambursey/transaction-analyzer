const { Firestore } = require('@google-cloud/firestore');

async function calculateFrontendBalance() {
  const firestore = new Firestore({ projectId: 'tx-analyzer-1777844550' });
  const txCollection = firestore.collection('transactions');

  const allTxSnapshot = await txCollection.where('Account', '==', 'Checking').get();
  const allTx = allTxSnapshot.docs.map((d) => d.data());

  allTx.sort((a, b) => {
    const dateA = a.Date && a.Date.toDate ? a.Date.toDate().getTime() : 0;
    const dateB = b.Date && b.Date.toDate ? b.Date.toDate().getTime() : 0;
    return dateA - dateB;
  });

  let currentBalance = 0;
  let hasSetInitial = false;

  for (const tx of allTx) {
    const oldBal = currentBalance;
    if (tx.Balance !== undefined && tx.Balance !== null && tx.Balance !== '') {
      currentBalance = Number(tx.Balance);
      hasSetInitial = true;
    } else if (hasSetInitial) {
      currentBalance = Number((currentBalance + Number(tx.Amount || 0)).toFixed(2));
    }

    const date = tx.Date && tx.Date.toDate ? tx.Date.toDate() : tx.Date;
    if (date >= new Date('2026-06-29')) {
      console.log(
        `[${date}] ${tx.Description} | Amt: ${tx.Amount} | CSV Bal: ${tx.Balance} => Calc Bal: ${currentBalance}`
      );
    }
  }
}

calculateFrontendBalance().catch(console.error);
