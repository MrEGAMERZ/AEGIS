const fs = require('fs');
let html = fs.readFileSync('src/popup/popup.html', 'utf8');

// Insert dark mode CSS for privacy-notice
html = html.replace(
  '    body.dark-mode .hint { color: #64748b; }',
  '    body.dark-mode .hint { color: #64748b; }\n    body.dark-mode .privacy-notice { color: #60a5fa !important; background: rgba(59, 130, 246, 0.1) !important; border-color: rgba(59, 130, 246, 0.2) !important; }'
);

// Wrap profile content and insert consent box
const search = `  <!-- Profile -->
  <div class="tab-content" id="tab-profile">
    <div class="card">`;

const replace = `  <!-- Profile -->
  <div class="tab-content" id="tab-profile">
    <div class="card" id="privacy-consent-box" style="display: none; text-align: center; padding: 24px 16px;">
      <div style="font-size: 16px; font-weight: 600; margin-bottom: 12px;">Local Storage Permission</div>
      <div style="font-size: 13px; margin-bottom: 16px; line-height: 1.5;" class="hint">
        To act as a local brain and memory, AEGIS needs permission to save your profile data in JSON format on this device.
      </div>
      <div style="font-size: 12px; margin-bottom: 24px; line-height: 1.5; padding: 12px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: 6px; color: #2563eb;" class="privacy-notice">
        <strong>Zero Privacy Compromise:</strong> Your data is stored strictly locally. There are no leaks and nothing is ever uploaded to the cloud.
      </div>
      <div class="btn-row" style="justify-content: center; gap: 16px;">
        <button class="btn-sm" id="privacy-decline-btn" type="button">Decline</button>
        <button class="btn-sm btn-accent" id="privacy-accept-btn" type="button">Accept & Save Locally</button>
      </div>
    </div>
    <div id="profile-main-content" style="display: none;">
      <div class="card">`;

html = html.replace(search, replace);

const endSearch = `      <p class="hint" style="display:block;">Saved text stays on this device so Fill Form — and later personal memory — can use it without uploading again.</p>
      <div id="vault-list" class="vault-list"></div>
    </div>
  </div>`;

const endReplace = `      <p class="hint" style="display:block;">Saved text stays on this device so Fill Form — and later personal memory — can use it without uploading again.</p>
      <div id="vault-list" class="vault-list"></div>
    </div>
    </div>
  </div>`;

html = html.replace(endSearch, endReplace);

fs.writeFileSync('src/popup/popup.html', html);
