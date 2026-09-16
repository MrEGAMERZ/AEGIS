const fs = require('fs');
let bg = fs.readFileSync('src/background/background.js', 'utf8');

const setup = `
// Enable opening the side panel on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
`;

if (!bg.includes('setPanelBehavior')) {
  bg += '\n' + setup;
  fs.writeFileSync('src/background/background.js', bg);
  console.log('Added setPanelBehavior.');
}
