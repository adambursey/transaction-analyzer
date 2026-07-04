const fs = require('fs');
const Papa = require('papaparse');
const csvContent = fs.readFileSync(
  '/Users/adambursey/Documents/local repository/transaction-analyzer/csv/Chase4765_Activity_20260703.csv',
  'utf8'
);
const parsed = Papa.parse(csvContent, { header: true, skipEmptyLines: true });
const tx = parsed.data[10]; // PayPal Instacart
console.log(tx);

function generateSignature(transaction) {
  let dateStr = '';
  const rawDate = transaction.Date;
  if (typeof rawDate === 'string') {
    const parts = rawDate.split('/');
    if (parts.length === 3) {
      dateStr = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    }
  }
  const desc = String(transaction.Description || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
  let parsedAmount = 0;
  if (typeof transaction.Amount === 'string') {
    parsedAmount = Number(transaction.Amount.replace(/[^0-9.-]+/g, ''));
  }
  const amount = isNaN(parsedAmount) ? '' : parsedAmount;
  const account = String(transaction.Account || 'Checking');
  return `${account}|${dateStr}|${desc}|${amount}`;
}

console.log(generateSignature(tx));
