const chatInput = document.getElementById('chat-input');
const btnSend = document.getElementById('btn-send');
const btnScreenshot = document.getElementById('btn-screenshot');
const btnClear = document.getElementById('btn-clear');
const chatContainer = document.getElementById('chat-container');
const statusBar = document.getElementById('status-bar');
const statusText = document.getElementById('status-text');

let attachScreenshotNext = false;
let messageHistory = [];

async function loadHistory() {
  const data = await chrome.storage.local.get('chatHistory');
  if (data.chatHistory && data.chatHistory.length > 0) {
    messageHistory = data.chatHistory;
    document.querySelector('.welcome-message').style.display = 'none';
    messageHistory.forEach(msg => appendMessage(msg.role, msg.content, msg.image));
  }
}

function saveHistory() {
  chrome.storage.local.set({ chatHistory: messageHistory });
}

function appendMessage(role, text, imageUrl = null) {
  document.querySelector('.welcome-message').style.display = 'none';
  const div = document.createElement('div');
  div.className = `message ${role}`;
  
  if (imageUrl) {
    const img = document.createElement('img');
    img.src = imageUrl;
    img.className = 'message-img';
    div.appendChild(img);
  }
  
  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;
  div.appendChild(content);
  
  chatContainer.appendChild(div);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function setStatus(text, show) {
  statusText.textContent = text;
  statusBar.hidden = !show;
}

chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = (chatInput.scrollHeight) + 'px';
  if (chatInput.value.trim()) btnSend.classList.add('active');
  else btnSend.classList.remove('active');
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

btnSend.addEventListener('click', handleSend);

btnScreenshot.addEventListener('click', () => {
  attachScreenshotNext = !attachScreenshotNext;
  btnScreenshot.style.backgroundColor = attachScreenshotNext ? 'var(--border)' : 'transparent';
});

btnClear.addEventListener('click', () => {
  messageHistory = [];
  saveHistory();
  chatContainer.innerHTML = `
    <div class="welcome-message">
      <div class="bot-icon">🤖</div>
      <h3>How can I help you today?</h3>
      <p>I am a fully private, on-device assistant. I can answer questions, write code, or execute actions on your browser. Your screen and data stay local.</p>
    </div>
  `;
});

async function handleSend() {
  const text = chatInput.value.trim();
  if (!text && !attachScreenshotNext) return;

  chatInput.value = '';
  chatInput.style.height = 'auto';
  btnSend.classList.remove('active');
  btnScreenshot.style.backgroundColor = 'transparent';
  
  const shouldAttach = attachScreenshotNext;
  attachScreenshotNext = false;

  let userMsg = { role: 'user', content: text };
  appendMessage('user', text + (shouldAttach ? " 📸 (Analyzing Screen...)" : ""));
  
  // push early so history exists
  messageHistory.push(userMsg);
  saveHistory();

  setStatus('SARA is thinking...', true);

  try {
    const res = await chrome.runtime.sendMessage({
      type: 'CHAT_REQUEST',
      history: messageHistory,
      model: document.getElementById('model-select').value,
      attachScreenshot: shouldAttach
    });

    if (res.error) throw new Error(res.error);
    
    // Update the history message with the image if one was generated
    if (res.sanitizedImage) {
      messageHistory[messageHistory.length - 1].image = res.sanitizedImage;
      saveHistory();
    }

    const botMsg = { role: 'assistant', content: res.reply };
    messageHistory.push(botMsg);
    saveHistory();
    appendMessage('assistant', res.reply);

    if (res.actionExecuted) {
      const actionMsg = { role: 'assistant', content: `[Executed Action: ${res.actionExecuted}]` };
      messageHistory.push(actionMsg);
      saveHistory();
      appendMessage('assistant', `[Executed Action: ${res.actionExecuted}]`);
    }

  } catch (err) {
    appendMessage('assistant', `Error: ${err.message}`);
  } finally {
    setStatus('', false);
  }
}

loadHistory();
