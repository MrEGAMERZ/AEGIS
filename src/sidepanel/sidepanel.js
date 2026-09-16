// sidepanel.js — Chat tab logic (Fill/Profile/Settings run via popup.js)
// The popup.js module bootstraps the Fill/Profile/Settings tabs via DOM IDs.
// This file handles: tab switching, chat messaging, screen-share button.

// ── Tab switching ─────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const pane = document.getElementById(target);
    if (pane) pane.classList.add('active');
  });
});

// ── Chat state ────────────────────────────────────────────
const chatContainer   = document.getElementById('chat-container');
const chatInput       = document.getElementById('chat-input');
const btnSend         = document.getElementById('btn-send');
const btnScreenshot   = document.getElementById('btn-screenshot');
const btnClearChat    = document.getElementById('btn-clear-chat');
const chatStatus      = document.getElementById('chat-status');
const chatStatusText  = document.getElementById('chat-status-text');
const screenshotHint  = document.getElementById('screenshot-hint');
const welcomeMsg      = document.getElementById('welcome-msg');
const modelSelect     = document.getElementById('model-select');

let attachScreenshot = false;
let messageHistory   = [];

// Load persisted chat history
(async () => {
  const data = await chrome.storage.local.get('chatHistory');
  if (data.chatHistory && data.chatHistory.length) {
    messageHistory = data.chatHistory;
    welcomeMsg.style.display = 'none';
    messageHistory.forEach(m => renderMessage(m.role, m.content, m.image));
  }
})();

function saveHistory() {
  // Trim to last 40 turns to avoid hitting storage limits
  if (messageHistory.length > 40) messageHistory = messageHistory.slice(-40);
  chrome.storage.local.set({ chatHistory: messageHistory });
}

function renderMessage(role, text, imageUrl) {
  welcomeMsg.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = `message ${role}`;
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl; img.className = 'message-img';
    wrap.appendChild(img);
  }
  const body = document.createElement('div');
  body.className = 'message-content';
  body.textContent = text;
  wrap.appendChild(body);
  chatContainer.appendChild(wrap);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function setStatus(text, show) {
  chatStatusText.textContent = text;
  chatStatus.hidden = !show;
}

// Auto-grow textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = chatInput.scrollHeight + 'px';
  btnSend.classList.toggle('active', chatInput.value.trim().length > 0);
});
chatInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

// Screenshot toggle
btnScreenshot.addEventListener('click', () => {
  attachScreenshot = !attachScreenshot;
  btnScreenshot.style.background = attachScreenshot ? '#dbeafe' : '';
  screenshotHint.classList.toggle('hidden', !attachScreenshot);
});

// Clear chat
btnClearChat.addEventListener('click', () => {
  messageHistory = [];
  saveHistory();
  chatContainer.innerHTML = '';
  welcomeMsg.style.display = '';
  chatContainer.appendChild(welcomeMsg);
});

// Example chips
document.querySelectorAll('.example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chatInput.value = chip.dataset.msg;
    chatInput.dispatchEvent(new Event('input'));
    handleSend();
  });
});

btnSend.addEventListener('click', handleSend);

async function handleSend() {
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  btnSend.classList.remove('active');

  const shouldAttach = attachScreenshot;
  attachScreenshot = false;
  btnScreenshot.style.background = '';
  screenshotHint.classList.add('hidden');

  const userMsg = { role: 'user', content: text };
  renderMessage('user', text + (shouldAttach ? ' 📸' : ''));
  messageHistory.push(userMsg);
  saveHistory();

  setStatus('SARA is thinking…', true);

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'CHAT_REQUEST',
      history: messageHistory,
      model: modelSelect.value,
      attachScreenshot: shouldAttach
    });

    if (res.error) throw new Error(res.error);

    if (res.sanitizedImage) {
      messageHistory[messageHistory.length - 1].image = res.sanitizedImage;
    }

    const reply = res.reply || '✅ Action performed.';
    const botMsg = { role: 'assistant', content: reply };
    messageHistory.push(botMsg);
    saveHistory();
    renderMessage('assistant', reply);

    if (res.actionExecuted) {
      const note = `[Executed: ${res.actionExecuted}]`;
      messageHistory.push({ role: 'assistant', content: note });
      saveHistory();
      renderMessage('assistant', note);
    }

  } catch (err) {
    renderMessage('assistant', `⚠️ Error: ${err.message}`);
  } finally {
    setStatus('', false);
  }
}
