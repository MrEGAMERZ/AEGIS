const fs = require('fs');
let code = fs.readFileSync('src/background/background.js', 'utf8');

// Replace the fallback logic outside the loop and the early return.
const search = `  // Check if reply contains a markdown code block:
  const codeBlockMatch = rawReply.match(/\`\`\`(?:[a-zA-Z0-9_+-]+)?\\s*\\n([\\s\\S]*?)\\n\`\`\`/);
  const userWantsCode = /\\b(code|program|script|function|algorithm|sort|write|implement|c\\b|python\\b|cpp\\b|java\\b|js\\b|html\\b|sql\\b)/i.test(latest?.content || "");

  // If no action object was returned, but code was generated for a coding request:
  if (!parsedAction && codeBlockMatch && userWantsCode) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let actionExecuted = null;
    if (activeTab?.id) {
      const codeToInsert = codeBlockMatch[1];
      const res = await executeWriteCodeInTab(activeTab.id, codeToInsert);
      if (res?.ok) {
        actionExecuted = \`inserted code into \${res.editor || 'editor'}\`;
      }
    }
    const cleanReply = stripActionBlock(rawReply) || rawReply;
    return { reply: cleanReply, actionExecuted, sanitizedImage: firstSanitizedImage };
  }

  // Plain text reply — simple Q&A, no agent loop needed
  if (!parsedAction) {
    const cleanReply = stripActionBlock(rawReply) || rawReply;
    return { reply: cleanReply, actionExecuted: null, sanitizedImage: firstSanitizedImage };
  }`;

const replace = `  const userWantsCode = /\\b(code|program|script|function|algorithm|sort|write|implement|c\\b|python\\b|cpp\\b|java\\b|js\\b|html\\b|sql\\b)/i.test(latest?.content || "");

  const resolveAction = (reply) => {
    let action = parseActionFromReply(reply);
    if (!action) {
      const codeBlockMatch = reply.match(/\`\`\`(?:[a-zA-Z0-9_+-]+)?\\s*\\n([\\s\\S]*?)\\n\`\`\`/);
      if (codeBlockMatch) {
        const textInside = codeBlockMatch[1];
        if (textInside.trim().startsWith('{') && textInside.includes('"action"')) {
          action = { action: 'error', error: 'Malformed JSON action block. Please ensure newlines in strings are escaped as \\\\n and output valid JSON.' };
        } else if (userWantsCode) {
          action = { action: 'write_code', code: textInside };
        }
      }
    }
    return action;
  };

  parsedAction = resolveAction(rawReply);

  // Plain text reply — simple Q&A, no agent loop needed
  if (!parsedAction) {
    const cleanReply = stripActionBlock(rawReply) || rawReply;
    return { reply: cleanReply, actionExecuted: null, sanitizedImage: firstSanitizedImage };
  }`;

code = code.replace(search, replace);

const search2 = `    rawReply = await callVlm(messages, model);
    parsedAction = parseActionFromReply(rawReply);

    if (!parsedAction) {
      const finalText = stripActionBlock(rawReply);
      if (finalText) stepLog.push(\`Result: \${finalText}\`);
      break;
    }`;

const replace2 = `    rawReply = await callVlm(messages, model);
    parsedAction = resolveAction(rawReply);

    if (!parsedAction) {
      const lower = rawReply.toLowerCase();
      if (lower.includes('done') || lower.includes('finished') || lower.includes('complete')) {
        stepLog.push(\`Done: \${stripActionBlock(rawReply)}\`);
        break;
      }
      parsedAction = { action: 'error', error: 'Please output a valid JSON action block or {"action":"done"}' };
    }`;

code = code.replace(search2, replace2);

// Handle execution for 'error'
const search3 = `    let execResult = { error: 'not executed' };
    try {
      execResult = await handleExecuteAction(action, activeTab?.id);
    } catch (e) {
      execResult = { error: e.message };
    }`;

const replace3 = `    let execResult = { error: 'not executed' };
    if (action.action === 'error') {
      execResult = { error: action.error };
    } else {
      try {
        execResult = await handleExecuteAction(action, activeTab?.id);
      } catch (e) {
        execResult = { error: e.message };
      }
    }`;

code = code.replace(search3, replace3);

const search4 = `const MAX_STEPS = 8;`;
const replace4 = `const MAX_STEPS = 15;`;

code = code.replace(search4, replace4);

fs.writeFileSync('src/background/background.js', code);
