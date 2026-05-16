import { Firestore } from "@google-cloud/firestore";

async function investigateDuplicate() {
  const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
  const transactionsCollection = firestore.collection("transactions");
  const snapshot = await transactionsCollection.get();

  const suspects = [];

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    // Parse out amount safely to compare
    let amountNum = 0;
    if (typeof data.Amount === 'number') {
      amountNum = data.Amount;
    } else if (typeof data.Amount === 'string') {
      amountNum = Number(data.Amount.replace(/[^0-9.-]+/g, ""));
    }

    if (amountNum === 15781.91 || data.Amount === "$15,781.91" || data.Amount === 15781.91) {
      suspects.push({ id: doc.id, ...data });
    }
  });

  console.log(`Found ${suspects.length} transactions with amount ~15781.91:`);
  suspects.forEach((s, i) => {
    console.log(`\n--- Suspect ${i + 1} ---`);
    console.log(`ID: ${s.id}`);
    console.log(`Date: ${s.Date}`);
    if (s.Date && s.Date._seconds) {
        console.log(`Date is serialized timestamp: ${new Date(s.Date._seconds * 1000).toISOString()}`);
    } else if (s.Date && typeof s.Date.toDate === 'function') {
        console.log(`Date is native timestamp: ${s.Date.toDate().toISOString()}`);
    }
    console.log(`Description: ${s.Description}`);
    console.log(`Amount: ${s.Amount}`);
    console.log(`Signature: ${s.signature}`);
  });
}

investigateDuplicate().catch(console.error);
