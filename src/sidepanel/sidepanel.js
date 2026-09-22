// sidepanel.js — Chat tab with multi-session management + quick commands
import { createSpeechSession, requestMicrophone } from "../shared/speech-listen.js";

// ── Tab init: open Chat tab by default ────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const chatTab  = document.querySelector('.tab[data-tab="chat"]');
    const chatPane = document.getElementById('tab-chat');
    if (chatTab)  chatTab.classList.add('active');
    if (chatPane) chatPane.classList.add('active');
  }, 50);
});

// ── DOM refs ───────────────────────────────────────────────
const chatContainer   = document.getElementById('chat-container');
const chatInput       = document.getElementById('chat-input');
const btnSend         = document.getElementById('btn-send');
const btnMic          = document.getElementById('btn-mic');
const btnClearChat    = document.getElementById('btn-clear-chat');
const btnNewChat      = document.getElementById('btn-new-chat');
const btnSessionsToggle = document.getElementById('btn-sessions-toggle');
const sessionsPanel   = document.getElementById('sessions-panel');
const sessionsList    = document.getElementById('sessions-list');
const currentChatName = document.getElementById('current-chat-name');
const chatStatus      = document.getElementById('chat-status');
const chatStatusText  = document.getElementById('chat-status-text');
const welcomeMsg      = document.getElementById('welcome-msg');
const modelSelect     = document.getElementById('model-select');

// Settings Input Bindings
const vlmApiKeyInput = document.getElementById('vlm-api-key');
const vlmEndpointInput = document.getElementById('vlm-endpoint');

if (vlmApiKeyInput && vlmEndpointInput) {
  chrome.storage.local.get(['vlmApiKey', 'vlmEndpoint']).then(r => {
    if (r.vlmApiKey) vlmApiKeyInput.value = r.vlmApiKey;
    if (r.vlmEndpoint) vlmEndpointInput.value = r.vlmEndpoint;
  });
  vlmApiKeyInput.addEventListener('input', () => {
    chrome.storage.local.set({ vlmApiKey: vlmApiKeyInput.value.trim() });
  });
  vlmEndpointInput.addEventListener('input', () => {
    chrome.storage.local.set({ vlmEndpoint: vlmEndpointInput.value.trim() });
  });
}

// ── Model Selector: auto-switch endpoint when model changes ────────
const CLOUD_MODEL_VAL  = 'secure-cloud-hf';

if (modelSelect) {
  // Restore last-chosen model from storage
  chrome.storage.local.get('aegisSelectedModel').then(r => {
    if (r.aegisSelectedModel) modelSelect.value = r.aegisSelectedModel;
  });

  modelSelect.addEventListener('change', async () => {
    const val = modelSelect.value;
    await chrome.storage.local.set({ aegisSelectedModel: val });
  });
}

const SESSION_STORAGE_KEY = 'aegisChatSessions';
const ACTIVE_SESSION_KEY  = 'aegisActiveChatId';

async function getSessions() {
  try {
    const data = await chrome.storage.local.get(SESSION_STORAGE_KEY);
    return data[SESSION_STORAGE_KEY] || [];
  } catch {
    return [];
  }
}

async function saveSessions(sessions) {
  try {
    await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: sessions });
  } catch {
    /* storage unavailable (non-extension preview) */
  }
}

async function getActiveSessionId() {
  try {
    const data = await chrome.storage.local.get(ACTIVE_SESSION_KEY);
    return data[ACTIVE_SESSION_KEY] || null;
  } catch {
    return null;
  }
}

async function setActiveSessionId(id) {
  try {
    await chrome.storage.local.set({ [ACTIVE_SESSION_KEY]: id });
  } catch {
    /* storage unavailable (non-extension preview) */
  }
}

function generateId() {
  return 'chat-' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
}

function generateName(messages) {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'New chat';
  const text = firstUser.content.replace(/[📸🔒]/g, '').trim();
  return text.length > 30 ? text.slice(0, 30) + '…' : text;
}

async function pruneEmptySessions() {
  const sessions = await getSessions();
  const activeId = await getActiveSessionId();
  const kept = [];
  let keptEmpty = false;
  for (const session of sessions) {
    if (session.messages.length > 0) {
      kept.push(session);
      continue;
    }
    if (!keptEmpty) {
      kept.push(session);
      keptEmpty = true;
    }
  }
  if (kept.length !== sessions.length) {
    await saveSessions(kept);
  }
  if (activeId && !kept.some((s) => s.id === activeId)) {
    await setActiveSessionId(kept[0] ? kept[0].id : null);
  }
}

async function createNewSession() {
  const sessions = await getSessions();
  const empty = sessions.find((s) => s.messages.length === 0);
  if (empty) {
    await setActiveSessionId(empty.id);
    return empty;
  }
  const newSession = {
    id: generateId(),
    name: 'New chat',
    created: Date.now(),
    messages: []
  };
  sessions.unshift(newSession);
  await saveSessions(sessions);
  await setActiveSessionId(newSession.id);
  return newSession;
}

async function getActiveSession() {
  const sessions = await getSessions();
  const activeId = await getActiveSessionId();
  if (activeId) {
    const found = sessions.find(s => s.id === activeId);
    if (found) return found;
  }
  // No active session — create one
  return await createNewSession();
}

async function saveMessageToSession(sessionId, message) {
  const sessions = await getSessions();
  const idx = sessions.findIndex(s => s.id === sessionId);
  if (idx === -1) return;
  sessions[idx].messages.push(message);
  // Auto-name from first user message
  if ((sessions[idx].name === 'New Chat' || sessions[idx].name === 'New chat') && message.role === 'user') {
    sessions[idx].name = generateName(sessions[idx].messages);
  }
  await saveSessions(sessions);
}

async function deleteSession(sessionId) {
  let sessions = await getSessions();
  sessions = sessions.filter(s => s.id !== sessionId);
  await saveSessions(sessions);
  const activeId = await getActiveSessionId();
  if (activeId === sessionId) {
    if (sessions.length > 0) {
      await setActiveSessionId(sessions[0].id);
    } else {
      await createNewSession();
    }
  }
}

function closeSessionsPanel() {
  if (!sessionsPanel) return;
  sessionsPanel.hidden = true;
  if (btnSessionsToggle) btnSessionsToggle.setAttribute('aria-expanded', 'false');
}

function isSessionsPanelOpen() {
  return sessionsPanel && !sessionsPanel.hidden;
}

async function renderSessionsList() {
  const sessions = await getSessions();
  const activeId = await getActiveSessionId();
  const visible = sessions.filter((s) => s.messages.length > 0);
  sessionsList.innerHTML = '';
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'sessions-empty';
    empty.textContent = 'No earlier chats';
    sessionsList.appendChild(empty);
  } else {
    visible.forEach((session) => {
      const item = document.createElement('div');
      item.className = 'session-item' + (session.id === activeId ? ' active' : '');
      item.innerHTML = `
      <div class="session-info">
        <div class="session-name">${escapeHtml(session.name)}</div>
        <div class="session-meta">${session.messages.length} · ${formatDate(session.created)}</div>
      </div>
      <button type="button" class="session-delete" data-id="${session.id}" aria-label="Delete chat" title="Delete">×</button>
    `;
      item.querySelector('.session-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteSession(session.id);
        await loadActiveSession();
        await renderSessionsList();
      });
      item.addEventListener('click', () => switchSession(session.id));
      sessionsList.appendChild(item);
    });
  }
  const active = sessions.find((s) => s.id === activeId);
  if (btnClearChat) btnClearChat.hidden = !(active && active.messages.length > 0);
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function switchSession(sessionId) {
  await setActiveSessionId(sessionId);
  await loadActiveSession();
  closeSessionsPanel();
}

let activeSessionId = null;

async function loadActiveSession() {
  const session = await getActiveSession();
  activeSessionId = session.id;
  currentChatName.textContent = session.name;
  // Clear and re-render messages
  chatContainer.innerHTML = '';
  if (session.messages.length === 0) {
    if (welcomeMsg) {
      welcomeMsg.style.display = '';
      chatContainer.appendChild(welcomeMsg);
    }
  } else {
    session.messages.forEach(m => renderMessage(m.role, m.content, m.image, false));
  }
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ── UI State ───────────────────────────────────────────────
function setStatus(text, show) {
  if (!chatStatusText || !chatStatus) return;
  chatStatusText.textContent = text;
  chatStatus.hidden = !show;
}

function formatMarkdownContent(container, rawText) {
  if (!rawText) return;
  // Match code blocks ```lang\ncode```
  const parts = rawText.split(/(```[a-zA-Z0-9_+-]*\n[\s\S]*?```)/g);
  for (const part of parts) {
    if (!part) continue;
    const match = part.match(/^```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```$/);
    if (match) {
      const lang = (match[1] || "code").toUpperCase();
      const code = match[2];

      const blockWrap = document.createElement("div");
      blockWrap.className = "code-block-wrapper";

      const header = document.createElement("div");
      header.className = "code-block-header";
      header.innerHTML = `
        <span class="code-lang">${escapeHtml(lang)}</span>
        <div class="code-block-actions">
          <button type="button" class="code-btn code-insert-btn" title="Insert into on-screen editor">Insert into Editor</button>
          <button type="button" class="code-btn code-copy-btn" title="Copy code">Copy</button>
        </div>
      `;

      const insertBtn = header.querySelector(".code-insert-btn");
      insertBtn.addEventListener("click", async () => {
        try {
          insertBtn.textContent = "Inserting…";
          const res = await chrome.runtime.sendMessage({ type: "EXECUTE_WRITE_CODE", code });
          if (res?.ok || res?.length) {
            insertBtn.textContent = "✓ Inserted!";
            setTimeout(() => { insertBtn.textContent = "Insert into Editor"; }, 2000);
          } else {
            insertBtn.textContent = "Failed";
            setTimeout(() => { insertBtn.textContent = "Insert into Editor"; }, 2000);
          }
        } catch {
          insertBtn.textContent = "Error";
          setTimeout(() => { insertBtn.textContent = "Insert into Editor"; }, 2000);
        }
      });

      const copyBtn = header.querySelector(".code-copy-btn");
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(code);
          copyBtn.textContent = "✓ Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
        } catch {
          copyBtn.textContent = "Failed";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
        }
      });

      const pre = document.createElement("pre");
      const codeEl = document.createElement("code");
      codeEl.textContent = code;
      pre.appendChild(codeEl);

      blockWrap.appendChild(header);
      blockWrap.appendChild(pre);
      container.appendChild(blockWrap);
    } else {
      const textDiv = document.createElement("div");
      textDiv.className = "message-text-segment";
      textDiv.textContent = part;
      container.appendChild(textDiv);
    }
  }
}

function renderMessage(role, text, imageUrl, animate = true) {
  if (welcomeMsg) welcomeMsg.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = `message ${role === 'user' ? 'user' : 'assistant'}`;
  if (animate) wrap.style.animation = 'fadeIn 0.2s ease';

  if (imageUrl) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'message-img-wrap';
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'message-img';
    img.title = 'Sanitized screenshot — faces and PII already hidden';
    const lbl = document.createElement('div');
    lbl.className = 'message-img-label';
    lbl.textContent = '🔒 Sanitized (what SARA saw)';
    imgWrap.appendChild(img);
    imgWrap.appendChild(lbl);
    wrap.appendChild(imgWrap);
  }

  const body = document.createElement('div');
  body.className = 'message-content';
  formatMarkdownContent(body, text);
  wrap.appendChild(body);
  chatContainer.appendChild(wrap);
  chatContainer.scrollTop = chatContainer.scrollHeight;
  return wrap;
}

// ── Quick Commands (no VLM needed) ────────────────────────
const FILL_PATTERNS     = /\bfill\s*(the\s*)?(form|fields?|page|all|it)\b|\bauto.?fill\b/i;
const SCAN_PATTERNS     = /\b(privacy\s*scan|scan\s*page|check\s*(privacy|risks?)|run\s*scan)\b/i;
const PROFILE_PATTERNS  = /\b(my\s*profile|what('s|\s*is)\s*my\s*(name|info|data)|show\s*(my\s*)?profile)\b/i;

async function runFillCommand() {
  setStatus('Filling form with your profile…', true);
  try {
    const res = await chrome.runtime.sendMessage({ type: 'FILL_MATCHING_FIELDS' });
    if (res?.error) return `❌ Could not fill: ${res.error}`;
    const n = res?.filled || 0;
    return `✅ Filled ${n} field${n === 1 ? '' : 's'} using your saved profile. Passwords and sensitive fields were kept private.`;
  } catch (e) {
    return `❌ Fill failed: ${e.message}`;
  }
}

async function runScanCommand() {
  setStatus('Running privacy scan…', true);
  try {
    await chrome.runtime.sendMessage({ type: 'SCAN_AND_OVERLAY' });
    const img = await chrome.runtime.sendMessage({ type: 'GET_LAST_SANITIZED_IMAGE' });
    return { text: '🔒 Privacy scan complete. The sanitized view shows what any AI is allowed to see.', image: img };
  } catch (e) {
    return { text: `❌ Scan failed: ${e.message}` };
  }
}

async function runProfileCommand() {
  const data = await chrome.storage.local.get('userProfile');
  const profile = data.userProfile || {};
  const fields = Object.entries(profile).filter(([,v]) => v);
  if (!fields.length) return '❌ No profile saved yet. Go to the Profile tab to add your details.';
  const lines = fields.map(([k, v]) => `• ${k}: ${String(v).slice(0, 40)}`).join('\n');
  return `👤 Your saved profile (${fields.length} fields):\n${lines}`;
}

// ── Send Handler ───────────────────────────────────────────
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = chatInput.scrollHeight + 'px';
  btnSend.classList.toggle('active', chatInput.value.trim().length > 0);
});

chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

btnSend.addEventListener('click', handleSend);

async function handleSend() {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  btnSend.classList.remove('active');

  // Render user message
  renderMessage('user', text + ' 📸');

  // Save to session
  const userMsg = { role: 'user', content: text, created: Date.now() };
  await saveMessageToSession(activeSessionId, userMsg);
  currentChatName.textContent = (await getActiveSession()).name;

  // ── Quick commands (instant, no VLM required) ──────────
  if (FILL_PATTERNS.test(text)) {
    setStatus('Filling form…', true);
    const reply = await runFillCommand();
    setStatus('', false);
    renderMessage('assistant', reply);
    await saveMessageToSession(activeSessionId, { role: 'assistant', content: reply });
    return;
  }

  if (SCAN_PATTERNS.test(text)) {
    const result = await runScanCommand();
    setStatus('', false);
    const replyText = typeof result === 'string' ? result : result.text;
    const replyImg  = typeof result === 'object' ? result.image : null;
    renderMessage('assistant', replyText, replyImg);
    await saveMessageToSession(activeSessionId, { role: 'assistant', content: replyText, image: replyImg });
    return;
  }

  if (PROFILE_PATTERNS.test(text)) {
    const reply = await runProfileCommand();
    setStatus('', false);
    renderMessage('assistant', reply);
    await saveMessageToSession(activeSessionId, { role: 'assistant', content: reply });
    return;
  }

  // ── Full VLM path (screen capture + AI) ───────────────
  const sessions = await getSessions();
  const session = sessions.find(s => s.id === activeSessionId);
  const history = session ? session.messages.map(m => ({ role: m.role, content: m.content, image: m.image })) : [];

  setStatus('Capturing screen & thinking…', true);

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'CHAT_REQUEST',
      history,
      model: modelSelect ? modelSelect.value : 'SARA-Distillation-0.5B',
      attachScreenshot: true
    });

    if (res.error) throw new Error(res.error);

    const sanitizedImg = res.sanitizedImage || null;
    if (sanitizedImg) {
      // Update the user message we already saved with the sanitized image
      const sessions2 = await getSessions();
      const s2 = sessions2.find(s => s.id === activeSessionId);
      if (s2 && s2.messages.length > 0) {
        s2.messages[s2.messages.length - 1].image = sanitizedImg;
        await saveSessions(sessions2);
      }
      // Show the sanitized screenshot INLINE so judges can see what the AI actually saw
      const proofEl = document.createElement('div');
      proofEl.className = 'privacy-proof-bubble';
      proofEl.innerHTML = `
        <div class="privacy-proof-header">
          <svg width="10" height="12" viewBox="0 0 10 12" fill="none"><path d="M5 1L9 2.5V6C9 8.761 7.209 11.206 5 12C2.791 11.206 1 8.761 1 6V2.5L5 1Z" fill="#22c55e" fill-opacity="0.3" stroke="#22c55e" stroke-width="1"/></svg>
          <span>What the AI saw — faces &amp; PII already removed on-device</span>
        </div>
        <img src="${sanitizedImg}" class="privacy-proof-img" title="Sanitized on your device before sending to AI" />
      `;
      chatContainer.appendChild(proofEl);
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    const reply = res.reply || '✅ Done.';
    renderMessage('assistant', reply);
    await saveMessageToSession(activeSessionId, { role: 'assistant', content: reply });

    if (res.actionExecuted) {
      const note = `[✅ Action executed: ${res.actionExecuted}]`;
      renderMessage('assistant', note);
      await saveMessageToSession(activeSessionId, { role: 'assistant', content: note });
    }

  } catch (err) {
    const errMsg = `⚠️ ${err.message}`;
    renderMessage('assistant', errMsg);
    await saveMessageToSession(activeSessionId, { role: 'assistant', content: errMsg });
  } finally {
    setStatus('', false);
  }
}

// ── Session panel toggle ───────────────────────────────────
btnSessionsToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  if (isSessionsPanelOpen()) {
    closeSessionsPanel();
    return;
  }
  sessionsPanel.hidden = false;
  btnSessionsToggle.setAttribute('aria-expanded', 'true');
  renderSessionsList();
});

document.addEventListener('click', (e) => {
  if (!isSessionsPanelOpen()) return;
  const toolbar = document.querySelector('.chat-toolbar');
  if (toolbar && toolbar.contains(e.target)) return;
  if (sessionsPanel.contains(e.target)) return;
  closeSessionsPanel();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSessionsPanel();
});

// ── New Chat ───────────────────────────────────────────────
btnNewChat.addEventListener('click', async (e) => {
  e.stopPropagation();
  await createNewSession();
  await loadActiveSession();
  closeSessionsPanel();
});

// ── Clear current chat ─────────────────────────────────────
btnClearChat.addEventListener('click', async () => {
  const sessions = await getSessions();
  const idx = sessions.findIndex(s => s.id === activeSessionId);
  if (idx !== -1) {
    sessions[idx].messages = [];
    sessions[idx].name = 'New chat';
    await saveSessions(sessions);
  }
  await loadActiveSession();
  await renderSessionsList();
});

// ── Example chips ──────────────────────────────────────────
document.querySelectorAll('.example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chatInput.value = chip.dataset.msg || '';
    chatInput.dispatchEvent(new Event('input'));
    handleSend();
  });
});

// ── Privacy Risk Score ─────────────────────────────────────
// Mirrors popup.js renderRiskScore — runs inside the sidepanel

function renderRiskScore(report) {
  const gradeEl   = document.getElementById('risk-grade-badge');
  const scoreEl   = document.getElementById('risk-score-num');
  const hostEl    = document.getElementById('risk-host');
  const factorsEl = document.getElementById('risk-factors');
  if (!gradeEl) return; // Fill tab not yet in DOM

  if (!report) {
    gradeEl.className = 'risk-grade-badge loading';
    gradeEl.textContent = '\u00a0';
    if (scoreEl)   { scoreEl.textContent = '--'; scoreEl.style.color = '#94a3b8'; }
    if (hostEl)    hostEl.textContent = 'Scanning\u2026';
    if (factorsEl) factorsEl.innerHTML = '';
    return;
  }

  if (report.unscannable) {
    gradeEl.className = 'risk-grade-badge';
    gradeEl.style.background = '#94a3b8';
    gradeEl.textContent = '?';
    if (scoreEl)   { scoreEl.textContent = '--'; scoreEl.style.color = '#94a3b8'; }
    if (hostEl)    hostEl.textContent = 'Navigate to a website to scan';
    if (factorsEl) {
      factorsEl.innerHTML = '';
      const msg = document.createElement('div');
      msg.className = 'risk-safe-msg';
      msg.style.color = '#94a3b8';
      msg.textContent = 'Open any website and re-scan';
      factorsEl.appendChild(msg);
    }
    return;
  }

  const { grade, score, color, risks = [], host } = report;

  // Swap badge node to replay pop animation
  const nb = gradeEl.cloneNode(false);
  nb.id = 'risk-grade-badge';
  nb.className = 'risk-grade-badge';
  nb.style.background = color;
  nb.textContent = grade;
  gradeEl.parentNode.replaceChild(nb, gradeEl);

  if (scoreEl)   { scoreEl.textContent = String(score); scoreEl.style.color = color; }
  if (hostEl)    hostEl.textContent = host || 'this page';
  if (factorsEl) {
    factorsEl.innerHTML = '';
    if (risks.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'risk-safe-msg';
      msg.textContent = 'No threats detected on this page';
      factorsEl.appendChild(msg);
    } else {
      risks.forEach(({ label, severity }) => {
        const row = document.createElement('div');
        row.className = 'risk-factor';
        row.innerHTML = `<span class="rf-dot ${severity}"></span>${label}`;
        factorsEl.appendChild(row);
      });
    }
  }
}

async function loadRiskScore() {
  try {
    const report = await chrome.runtime.sendMessage({ type: 'GET_PAGE_RISK_SCORE' });
    renderRiskScore(report);
  } catch {
    renderRiskScore(null);
  }
}

// Wire refresh button
document.getElementById('risk-refresh-btn')?.addEventListener('click', async function () {
  this.classList.add('spinning');
  const gradeEl = document.getElementById('risk-grade-badge');
  const scoreEl = document.getElementById('risk-score-num');
  const hostEl  = document.getElementById('risk-host');
  const facEl   = document.getElementById('risk-factors');
  if (gradeEl) { gradeEl.className = 'risk-grade-badge loading'; gradeEl.textContent = '\u00a0'; }
  if (scoreEl) { scoreEl.textContent = '--'; scoreEl.style.color = '#94a3b8'; }
  if (hostEl)  hostEl.textContent = 'Scanning\u2026';
  if (facEl)   facEl.innerHTML = '';
  await loadRiskScore();
  setTimeout(() => this.classList.remove('spinning'), 700);
});

// Re-run score whenever user switches to the Fill tab
document.querySelectorAll('.tab[data-tab="fill"]').forEach(t => {
  t.addEventListener('click', () => {
    // Slight delay so popup.js tab switch finishes first
    setTimeout(loadRiskScore, 120);
  });
});

// ── Boot ───────────────────────────────────────────────────
(async () => {
  await pruneEmptySessions();
  await loadActiveSession();
  // Load risk score in background (needed if Fill tab is already active)
  loadRiskScore().catch(() => {});
})();



// ── Speech-To-Text (STT) ────────────────────────────────────
let speechSession = null;
let interimPrefix = "";

if (btnMic) {
  btnMic.addEventListener('click', async () => {
    if (!speechSession) {
      speechSession = createSpeechSession({
        lang: "en-US",
        onStart: () => {
          interimPrefix = chatInput.value;
          if (interimPrefix && !interimPrefix.endsWith(" ")) {
            interimPrefix += " ";
          }
          btnMic.classList.add('active');
          chatInput.placeholder = "Listening...";
        },
        onInterim: (text) => {
          chatInput.value = interimPrefix + text;
          chatInput.style.height = 'auto';
          chatInput.style.height = chatInput.scrollHeight + 'px';
        },
        onFinal: (text) => {
          chatInput.value = interimPrefix + text;
          interimPrefix = chatInput.value + " ";
          chatInput.dispatchEvent(new Event('input'));
        },
        onEnd: () => {
          btnMic.classList.remove('active');
          chatInput.placeholder = "Message AEGIS…";
          chatInput.dispatchEvent(new Event('input'));
        },
        onError: (err) => {
          console.error("Speech error:", err);
          btnMic.classList.remove('active');
          chatInput.placeholder = "Message AEGIS…";
        }
      });
    }

    if (speechSession.isRecording()) {
      speechSession.stop();
    } else {
      try {
        await requestMicrophone();
        speechSession.start();
      } catch (err) {
        console.error("Microphone access denied:", err);
        alert("Microphone access is required for Voice Input.");
      }
    }
  });
}
