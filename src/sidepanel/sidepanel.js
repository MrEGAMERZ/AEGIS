// sidepanel.js — Chat tab with multi-session management + quick commands

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

// ── Session Management ─────────────────────────────────────
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
  body.textContent = text;
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

// ── Boot ───────────────────────────────────────────────────
(async () => {
  await pruneEmptySessions();
  await loadActiveSession();
})();
