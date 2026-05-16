import { Firestore } from "@google-cloud/firestore";

async function verifyDates() {
  const firestore = new Firestore({ projectId: "tx-analyzer-1777844550" });
  const transactionsCollection = firestore.collection("transactions");
  const snapshot = await transactionsCollection.get();

  let invalidCount = 0;
  let nullCount = 0;
  let undefinedCount = 0;
  let validCount = 0;
  
  const invalidExamples = [];

  snapshot.docs.forEach(doc => {
    const data = doc.data();
    const dateVal = data.Date;

    if (dateVal === undefined) {
      undefinedCount++;
      if (invalidExamples.length < 5) invalidExamples.push({ id: doc.id, ...data });
    } else if (dateVal === null) {
      nullCount++;
      if (invalidExamples.length < 5) invalidExamples.push({ id: doc.id, ...data });
    } else {
      // It's a string, timestamp, or something else
      let isValid = false;
      if (typeof dateVal === 'string') {
        const d = new Date(dateVal);
        isValid = !isNaN(d.getTime());
      } else if (dateVal && typeof dateVal.toDate === 'function') {
        isValid = true;
      } else if (dateVal && dateVal._seconds) {
        isValid = true;
      }

      if (isValid) {
        validCount++;
      } else {
        invalidCount++;
        if (invalidExamples.length < 5) invalidExamples.push({ id: doc.id, ...data });
      }
    }
  });

  console.log("--- Date Verification Report ---");
  console.log(`Total Transactions: ${snapshot.docs.length}`);
  console.log(`Valid Dates: ${validCount}`);
  console.log(`Invalid Strings: ${invalidCount}`);
  console.log(`Null Dates: ${nullCount}`);
  console.log(`Undefined Dates: ${undefinedCount}`);
  
  if (invalidExamples.length > 0) {
    console.log("\nExamples of transactions with invalid/null/undefined dates:");
    invalidExamples.forEach((ex, i) => {
      console.log(`\nExample ${i + 1}:`);
      console.log(JSON.stringify(ex, null, 2));
    });
  }
}

verifyDates().catch(console.error);
