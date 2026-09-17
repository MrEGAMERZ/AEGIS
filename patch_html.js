const fs = require('fs');
let html = fs.readFileSync('src/sidepanel/sidepanel.html', 'utf8');

const micBtnHTML = `
        <button class="mic-btn" id="btn-mic" type="button" title="Voice Input">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
        </button>
`;

html = html.replace(
  '<button class="send-btn" id="btn-send">',
  micBtnHTML + '        <button class="send-btn" id="btn-send">'
);

const cssToAdd = `
.mic-btn { color: #64748b; background: transparent; border: none; cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; transition: color 0.2s; }
.mic-btn:hover { color: #2563eb; }
.mic-btn.active { color: #ef4444; animation: pulse-dot 1.5s infinite; }
body.dark-mode .mic-btn { color: #94a3b8; }
body.dark-mode .mic-btn:hover { color: #60a5fa; }
body.dark-mode .mic-btn.active { color: #f87171; }
`;

html = html.replace(
  '.send-btn { color: #2563eb; opacity: 0.4; }',
  cssToAdd + '\n.send-btn { color: #2563eb; opacity: 0.4; }'
);

fs.writeFileSync('src/sidepanel/sidepanel.html', html);
