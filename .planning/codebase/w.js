const fs = require('fs');
fs.writeFileSync('ARCHITECTURE.md', fs.readFileSync(process.argv[2], 'utf8'), 'utf8');
fs.writeFileSync('STRUCTURE.md', fs.readFileSync(process.argv[3], 'utf8'), 'utf8');
console.log('Written');
