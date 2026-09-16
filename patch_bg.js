const fs = require('fs');
let bg = fs.readFileSync('src/background/background.js', 'utf8');

const handlerStr = `
  if (msg.type === "CHAT_REQUEST") {
    handleChatRequest(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
`;

// Insert the handler into the message listener
bg = bg.replace('if (msg.type === "CAPTURE_AND_SANITIZE") {', handlerStr + '\n  if (msg.type === "CAPTURE_AND_SANITIZE") {');

const functionStr = `
// ── Chat Assistant Logic ──────────────────────────────────────────

async function handleChatRequest(msg) {
  const { history, model, attachScreenshot } = msg;
  const config = await chrome.storage.local.get(["vlmEndpoint"]);
  const vlmEndpoint = await resolveVlmEndpoint(config.vlmEndpoint);
  
  let sanitizedImage = null;
  let pageStructure = null;
  
  if (attachScreenshot) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");
    
    // Quick DOM scan
    const domScan = await sendTabMessage(tab, { type: "DOM_SCAN" }).catch(()=>({fields:[]}));
    pageStructure = domScan;
    
    // Capture & sanitize
    const rawDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
    await ensureOffscreen();
    const sanitizeResponse = await chrome.runtime.sendMessage({
      type: "SANITIZE",
      dataUrl: rawDataUrl,
      fields: domScan.fields || [],
      includeFaces: true
    });
    sanitizedImage = scanPreviewDataUrl(sanitizeResponse);
    
    // Append to the last user message
    const lastMsg = history[history.length - 1];
    if (lastMsg && lastMsg.role === "user") {
      lastMsg.image = sanitizedImage;
      lastMsg.dom = domScan;
    }
  }

  // Format messages for OpenAI API
  const messages = [
    {
      role: "system",
      content: "You are AEGIS Assistant, a private on-device AI for government employees (like ISRO). " +
               "Answer questions intelligently in plain text. " +
               "If the user asks you to perform an action on the screen (like filling a form or clicking), " +
               "you MUST return a JSON action object inside a markdown code block starting with \`\`\`json. " +
               "Valid JSON actions are: {\\"action\\": \\"type\\", \\"field\\": \\"Field Name\\", \\"value\\": \\"text\\"} " +
               "or {\\"action\\": \\"click\\", \\"selector\\": \\"#id\\"}."
    }
  ];

  for (const item of history) {
    if (item.role === "user" && item.image) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: item.content + (item.dom ? "\\n\\nDOM Structure:\\n" + JSON.stringify(item.dom.fillableFields) : "") },
          { type: "image_url", image_url: { url: item.image } }
        ]
      });
    } else {
      messages.push({ role: item.role, content: item.content });
    }
  }

  const vlmPayload = {
    model: model || "SARA-Distillation-0.5B",
    messages: messages,
    temperature: 0.1
  };

  const rawReply = await requestVlmContent(vlmEndpoint, { "Content-Type": "application/json" }, vlmPayload);
  
  let actionExecuted = null;
  // Check if there is a JSON block in the reply
  const jsonMatch = rawReply.match(/\`\`\`json\\s*(\\{.*?\\})\\s*\`\`\`/s) || rawReply.match(/(\\{"action":.*?\\})/s);
  
  if (jsonMatch) {
    try {
      const actionObj = JSON.parse(jsonMatch[1]);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        await handleExecuteAction(actionObj, tab.id);
        actionExecuted = actionObj.action + (actionObj.field ? " " + actionObj.field : "");
      }
    } catch(e) {
      console.error("Action parse/execute error:", e);
    }
  }
  
  return { reply: rawReply.replace(/\`\`\`json.*?\`\`\`/gs, "").trim() || "Action performed.", actionExecuted, sanitizedImage };
}
`;

bg += '\n' + functionStr;
fs.writeFileSync('src/background/background.js', bg);
console.log('Background updated.');
