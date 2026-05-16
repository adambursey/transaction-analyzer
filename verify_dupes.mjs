import { Firestore } from '@google-cloud/firestore';

async function run() {
  const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
  const snapshot = await firestore.collection("transactions").get();
  
  const matches = snapshot.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(t => typeof t.Description === 'string' && (t.Description.includes("WOOFLES PREMIER") || t.Description.includes("009161 02/251163")));
    
  console.log(`Found ${matches.length} Woofles/ATM transactions.`);
  for (const m of matches) {
    const d = m.Date && m.Date.toDate ? m.Date.toDate() : m.Date;
    console.log(`ID: ${m.id} | Date: ${d} | Amount: ${m.Amount} | Desc: "${m.Description}"`);
  }
}

run();
