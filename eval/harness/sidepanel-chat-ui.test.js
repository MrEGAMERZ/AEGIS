/**
 * Sidepanel Chat chrome: one title, one new-chat control, history in a panel.
 *
 * USAGE: node eval/harness/sidepanel-chat-ui.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const html = fs.readFileSync(path.join(ROOT, "src/sidepanel/sidepanel.html"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "src/sidepanel/sidepanel.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "src/sidepanel/sidepanel.css"), "utf8");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

console.log("Sidepanel Chat UI — history menu\n");

const chatStart = html.indexOf('id="tab-chat"');
const fillStart = html.indexOf('id="tab-fill"');
const chatHtml = html.slice(chatStart, fillStart);

check("Chat tab uses a single toolbar", chatHtml.includes("chat-toolbar") && chatHtml.includes("btn-sessions-toggle"));
const newChatBtn = chatHtml.match(/id="btn-new-chat"[\s\S]*?<\/button>/);
check(
  "New chat is an icon button, not a second label",
  newChatBtn &&
    /aria-label="New chat"/.test(newChatBtn[0]) &&
    !/>\s*New chat\s*</.test(newChatBtn[0])
);
check("visible hamburger Chats label is gone", !chatHtml.includes(">Chats<") && !chatHtml.includes("chat-sessions-bar"));
check("history panel starts hidden", /id="sessions-panel"[^>]*hidden/.test(chatHtml));
check("Clear lives in the history panel, not the composer", chatHtml.indexOf("btn-clear-chat") > chatHtml.indexOf("sessions-panel") && chatHtml.indexOf("btn-clear-chat") < chatHtml.indexOf("chat-input-area"));
check("composer footer has no Clear button", !/chat-footer[\s\S]*btn-clear-chat/.test(chatHtml));
check("sidepanel.css is linked", html.includes('href="sidepanel.css"'));
check("CSS hides the history panel with [hidden]", css.includes(".sessions-panel[hidden]") && html.includes(".sessions-panel[hidden]"));
check("creating a chat reuses an empty session", js.includes("s.messages.length === 0") && js.includes("pruneEmptySessions"));
check(
  "boot does not dump the session list onto the welcome screen",
  /await pruneEmptySessions\(\);\s*await loadActiveSession\(\);/.test(js) &&
    !/\(async \(\) => \{\s*await loadActiveSession\(\);\s*await renderSessionsList/.test(js)
);
check("empty chats are omitted from the history list", js.includes("No earlier chats") && js.includes("s.messages.length > 0"));
check("delete control is a quiet ×, not a trash emoji", js.includes('aria-label="Delete chat"') && !js.includes("🗑"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
