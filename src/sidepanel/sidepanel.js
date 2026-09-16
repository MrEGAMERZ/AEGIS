// sidepanel.js — Chat tab logic only.
// Fill/Profile/Settings tabs and tab switching are handled by popup.js.
// This file adds:
//   1. Chat tab button click support (since popup.js doesn't know about "chat")
//   2. Chat messaging (send/receive messages from SARA via background.js)

// ── Give Chat tab its own click handler ──────────────────
// popup.js handles fill/profile/settings tabs via querySelectorAll('.tab')
// It will also wire the chat tab since it uses the same .tab class.
// No extra tab handling needed here.

// Show Chat tab on load (override popup.js which tries to make fill active)
document.addEventListener('DOMContentLoaded', () => {
  // popup.js runs as a module so it fires after DOMContentLoaded order.
  // We set chat active via a tiny timeout to run after popup.js init.
  setTimeout(() => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const chatTab = document.querySelector('.tab[data-tab="chat"]');
    const chatPane = document.getElementById('tab-chat');
    if (chatTab) chatTab.classList.add('active');
    if (chatPane) chatPane.classList.add('active');
  }, 50);
});

// ── Chat State ────────────────────────────────────────────
const chatContainer  = document.getElementById('chat-container');
const chatInput      = document.getElementById('chat-input');
const btnSend        = document.getElementById('btn-send');
const btnScreenshot  = document.getElementById('btn-screenshot');
const btnClearChat   = document.getElementById('btn-clear-chat');
const chatStatus     = document.getElementById('chat-status');
const chatStatusText = document.getElementById('chat-status-text');
const screenshotHint = document.getElementById('screenshot-hint');
const welcomeMsg     = document.getElementById('welcome-msg');
const modelSelect    = document.getElementById('model-select');

let attachScreenshot = false;
let messageHistory = [];

// Load persisted chat history
(async () => {
  const data = await chrome.storage.local.get('chatHistory');
  if (data.chatHistory && data.chatHistory.length) {
    messageHistory = data.chatHistory;
    if (welcomeMsg) welcomeMsg.style.display = 'none';
    messageHistory.forEach(m => renderMessage(m.role, m.content, m.image));
  }
})();

function saveHistory() {
  if (messageHistory.length > 40) messageHistory = messageHistory.slice(-40);
  chrome.storage.local.set({ chatHistory: messageHistory });
}

function renderMessage(role, text, imageUrl) {
  if (welcomeMsg) welcomeMsg.style.display = 'none';
  const wrap = document.createElement('div');
  wrap.className = `message ${role === 'user' ? 'user' : 'assistant'}`;
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'message-img';
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
  if (!chatStatusText || !chatStatus) return;
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
  if (screenshotHint) screenshotHint.classList.toggle('hidden', !attachScreenshot);
});

// Clear chat
btnClearChat.addEventListener('click', () => {
  messageHistory = [];
  saveHistory();
  chatContainer.innerHTML = '';
  if (welcomeMsg) {
    welcomeMsg.style.display = '';
    chatContainer.appendChild(welcomeMsg);
  }
});

// Example chips
document.querySelectorAll('.example-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    chatInput.value = chip.dataset.msg || '';
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
  if (screenshotHint) screenshotHint.classList.add('hidden');

  const userMsg = { role: 'user', content: text };
  renderMessage('user', text + (shouldAttach ? ' 📸' : ''));
  messageHistory.push(userMsg);
  saveHistory();

  setStatus('SARA is thinking…', true);

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'CHAT_REQUEST',
      history: messageHistory,
      model: modelSelect ? modelSelect.value : 'SARA-Distillation-0.5B',
      attachScreenshot: shouldAttach
    });

    if (res.error) throw new Error(res.error);

    if (res.sanitizedImage) {
      messageHistory[messageHistory.length - 1].image = res.sanitizedImage;
    }

    const reply = res.reply || '✅ Done.';
    messageHistory.push({ role: 'assistant', content: reply });
    saveHistory();
    renderMessage('assistant', reply);

    if (res.actionExecuted) {
      const note = `[✅ Executed: ${res.actionExecuted}]`;
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
