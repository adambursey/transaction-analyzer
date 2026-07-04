const { generateSignature } = require('./dist/utils/importLogic.js');
console.log(generateSignature({ Date: '07/02/2026', Description: 'Test', Amount: -100, Account: 'Checking' }));
