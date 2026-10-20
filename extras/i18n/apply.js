// node i18n/apply.js MAP.js FILE [FILE...]  - replace every English string in the map with its Polish
// version, in place. Fails loudly (exit 1) on any string it could not find, so nothing is half-translated.
const fs = require('fs'), path = require('path');
const [, , mapFile, ...files] = process.argv;
const pairs = require(path.resolve(mapFile));
let missing = 0;
for (const f of files) {
  let s = fs.readFileSync(f, 'utf8');
  for (const [en, pl] of pairs) {
    if (s.includes(en)) s = s.split(en).join(pl);
    else if (!s.includes(pl)) { console.log('MISSING in ' + f + ': ' + en.slice(0, 70)); missing++; }
  }
  fs.writeFileSync(f, s);
}
console.log(missing ? missing + ' strings not found' : 'all strings applied');
process.exit(missing ? 1 : 0);
