const fs = require('fs');
let code = fs.readFileSync('src/background/background.js', 'utf8');

code = code.replace(
  'model: vlmModel,',
  'model: vlmModel,\n      stream: false,'
);

fs.writeFileSync('src/background/background.js', code);
