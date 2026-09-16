const fs = require('fs');
let bg = fs.readFileSync('src/background/background.js', 'utf8');

// Add side panel click listener
const listener = `
// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});
`;

if (!bg.includes('chrome.sidePanel.open')) {
  bg += '\n' + listener;
  fs.writeFileSync('src/background/background.js', bg);
  console.log('Added side panel listener.');
}
