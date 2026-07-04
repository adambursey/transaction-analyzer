const fs = require('fs');
const Papa = require('papaparse');

async function run() {
  const csvContent = fs.readFileSync('/Users/adambursey/Documents/local repository/transaction-analyzer/csv/Chase4765_Activity_20260703.csv', 'utf8');
  const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });

  const transactions = parsed.data.map(row => ({
    Date: row['Posting Date'] || row['Date'],
    Description: row['Description'],
    Amount: row['Amount'],
    Balance: row['Balance'],
    Account: 'Checking'
  }));

  const response = await fetch('http://localhost:3000/api/admin/backfill-and-reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions, account: 'Checking' })
  });

  const result = await response.json();
  console.log('API Response:', result);
}

run().catch(console.error);
