const fs = require('fs');
let code = fs.readFileSync('src/background/background.js', 'utf8');

code = code.replace(
  'const vlmData = await vlmResponse.json();',
  `const responseText = await vlmResponse.text();
      let vlmData;
      try {
        vlmData = JSON.parse(responseText);
      } catch (err) {
        throw new Error("Invalid JSON from VLM: " + responseText.slice(0, 100));
      }`
);

fs.writeFileSync('src/background/background.js', code);
