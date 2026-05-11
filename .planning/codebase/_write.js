const fs = require('fs');
const arch = fs.readFileSync(process.argv[2], 'utf8');
const struct = fs.readFileSync(process.argv[3], 'utf8');
fs.writeFileSync('ARCHITECTURE.md', arch, 'utf8');
fs.writeFileSync('STRUCTURE.md', struct, 'utf8');
console.log('Written: ARCHITECTURE.md (' + arch.split('\n').length + ' lines)');
console.log('Written: STRUCTURE.md (' + struct.split('\n').length + ' lines)');
