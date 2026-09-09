/**
 * Aegis — Content-script inject + retry after extension reload
 * eval/harness/content-script-inject.test.js
 *
 * INVARIANT
 * ---------
 * chrome.tabs.sendMessage failing with "Receiving end does not exist"
 * (orphaned content script after unpacked Reload, including file:// test
 * pages) must not surface as [UNKNOWN]. Background injects
 * src/content/content.js once via chrome.scripting.executeScript, retries
 * once, then maps remaining failures to NO_CONTENT_SCRIPT.
 *
 * Loads the REAL src/background/background.js into a sandboxed Node VM.
 *
 * USAGE: node eval/harness/content-script-inject.test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const BACKGROUND_PATH = path.join(ROOT, "src", "background", "background.js");
const POPUP_JS = path.join(ROOT, "src", "popup", "popup.js");
const CONTENT_PATH = path.join(ROOT, "src", "content", "content.js");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");

const backgroundSrc = fs.readFileSync(BACKGROUND_PATH, "utf8");
const popupJs = fs.readFileSync(POPUP_JS, "utf8");
const contentSrc = fs.readFileSync(CONTENT_PATH, "utf8");
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

function loadBackground(overrides = {}) {
  const sendCalls = [];
  const injectCalls = [];
  let remainingFails = overrides.failCount ?? 0;
  const failMessage =
    overrides.failMessage ||
    "Could not establish connection. Receiving end does not exist.";
  const injectError = overrides.injectError;

  const sandbox = {
    URL,
    Map,
    chrome: {
      runtime: {
        getURL: () => "chrome-extension://fake-id/",
        onMessage: { addListener: () => {} },
        onInstalled: { addListener: () => {} },
      },
      storage: { local: { set: async () => {} } },
      tabs: {
        sendMessage: async (tabId, message) => {
          sendCalls.push({ tabId, message });
          if (remainingFails > 0) {
            remainingFails--;
            throw new Error(failMessage);
          }
          return overrides.response || { fields: [], dpr: 1, visibleText: [] };
        },
      },
      scripting: {
        executeScript: async (opts) => {
          injectCalls.push(opts);
          if (injectError) throw new Error(injectError);
          return [{ result: undefined }];
        },
      },
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    backgroundSrc +
      "\n;globalThis.__EXPORTS__ = { sendTabMessage, classifyError, isMissingReceiver, isInjectableTabUrl, injectContentScript, noContentScriptError };",
    sandbox,
    { filename: BACKGROUND_PATH }
  );
  return { ...sandbox.__EXPORTS__, sendCalls, injectCalls, sandbox };
}

console.log("Content-script inject after extension reload\n");

console.log("1. Manifest + content-script coverage");
check("scripting permission is declared", manifest.permissions.includes("scripting"));
const cs = manifest.content_scripts && manifest.content_scripts[0];
check("content_scripts declared", !!cs);
check(
  "matches include <all_urls>",
  Array.isArray(cs?.matches) && cs.matches.includes("<all_urls>")
);
check(
  "matches include file://*/*",
  Array.isArray(cs?.matches) && cs.matches.includes("file://*/*")
);
check("content script path is src/content/content.js", cs?.js?.includes("src/content/content.js"));
check(
  "content.js re-inject guard is present",
  contentSrc.includes("__AEGIS_CONTENT_SCRIPT__")
);

console.log("\n2. classifyError maps the Chrome disconnect");
{
  const { classifyError } = loadBackground();
  check(
    "Receiving end does not exist → NO_CONTENT_SCRIPT",
    classifyError({ message: "Could not establish connection. Receiving end does not exist." }) ===
      "NO_CONTENT_SCRIPT"
  );
  check(
    "NO_CONTENT_SCRIPT prefix → NO_CONTENT_SCRIPT",
    classifyError({ message: "NO_CONTENT_SCRIPT: refresh the tab" }) === "NO_CONTENT_SCRIPT"
  );
  check(
    "FACE_MODEL still FACE_REDACTION_REQUIRED",
    classifyError({ message: "FACE_MODEL_UNAVAILABLE" }) === "FACE_REDACTION_REQUIRED"
  );
  check(
    "NER_MODEL still NER_REDACTION_REQUIRED",
    classifyError({ message: "NER_MODEL_UNAVAILABLE" }) === "NER_REDACTION_REQUIRED"
  );
  check(
    "INIT worker failure still INIT_FAILED",
    classifyError({ message: "Inference worker failed to load: boom" }) === "INIT_FAILED"
  );
  check(
    "ORT no-available-backend still INIT_FAILED",
    classifyError({
      message:
        "no available backend found. ERR: [wasm] TypeError: Failed to fetch dynamically imported module",
    }) === "INIT_FAILED"
  );
}

console.log("\n3. sendTabMessage injects once then retries");
{
  const { sendTabMessage, sendCalls, injectCalls } = loadBackground({ failCount: 1 });
  sendTabMessage({ id: 42, url: "file:///Users/x/eval/test-pages/tp01-login-form.html" }, { type: "DOM_SCAN" })
    .then((res) => {
      check("retry returns DOM_SCAN payload", res && res.dpr === 1);
      check("sendMessage called twice (fail + retry)", sendCalls.length === 2);
      check("executeScript called once", injectCalls.length === 1);
      check(
        "injects src/content/content.js",
        injectCalls[0]?.files?.[0] === "src/content/content.js"
      );
      check("inject target is the same tabId", injectCalls[0]?.target?.tabId === 42);
    })
    .catch((err) => {
      check("retry returns DOM_SCAN payload", false, err.message);
      check("sendMessage called twice (fail + retry)", false);
      check("executeScript called once", false);
      check("injects src/content/content.js", false);
      check("inject target is the same tabId", false);
    })
    .then(() => runRestrictedAndFailureCases());
}

function runRestrictedAndFailureCases() {
  console.log("\n4. Restricted URLs and inject failures");

  const restricted = loadBackground({ failCount: 1 });
  return restricted
    .sendTabMessage({ id: 7, url: "chrome://extensions/" }, { type: "DOM_SCAN" })
    .then(() => {
      check("chrome:// does not succeed silently", false);
    })
    .catch((err) => {
      check(
        "chrome:// maps to NO_CONTENT_SCRIPT",
        String(err.message).includes("NO_CONTENT_SCRIPT")
      );
      check(
        "chrome:// does not call executeScript",
        restricted.injectCalls.length === 0
      );
    })
    .then(() => {
      const other = loadBackground({ failCount: 1, failMessage: "Tab not found" });
      return other
        .sendTabMessage({ id: 3, url: "https://example.com/" }, { type: "DOM_SCAN" })
        .then(() => check("non-receiver errors are not swallowed", false))
        .catch((err) => {
          check(
            "non-receiver errors propagate unchanged",
            String(err.message) === "Tab not found"
          );
          check("non-receiver errors do not inject", other.injectCalls.length === 0);
        });
    })
    .then(() => {
      const injFail = loadBackground({
        failCount: 1,
        injectError: "Cannot access contents of url",
      });
      return injFail
        .sendTabMessage(
          { id: 9, url: "file:///tmp/tp01-login-form.html" },
          { type: "DOM_SCAN" }
        )
        .then(() => check("inject failure becomes NO_CONTENT_SCRIPT", false))
        .catch((err) => {
          check(
            "inject failure becomes NO_CONTENT_SCRIPT",
            String(err.message).includes("NO_CONTENT_SCRIPT")
          );
          check(
            "file:// hint mentions Allow access to file URLs",
            String(err.message).includes("Allow access to file URLs")
          );
        });
    })
    .then(() => {
      const ok = loadBackground({ failCount: 0 });
      return ok
        .sendTabMessage({ id: 1, url: "https://example.com/form" }, { type: "DOM_SCAN" })
        .then(() => {
          check("healthy tab does not inject", ok.injectCalls.length === 0);
          check("healthy tab sendMessage once", ok.sendCalls.length === 1);
        });
    })
    .then(() => {
      console.log("\n5. URL helpers + popup copy");
      const { isInjectableTabUrl, isMissingReceiver, noContentScriptError } = loadBackground();
      check("http is injectable", isInjectableTabUrl("http://localhost:8080/x"));
      check("https is injectable", isInjectableTabUrl("https://example.com/"));
      check("file is injectable", isInjectableTabUrl("file:///Users/x/tp01-login-form.html"));
      check("chrome:// is not injectable", !isInjectableTabUrl("chrome://extensions/"));
      check("empty url is not injectable", !isInjectableTabUrl(""));
      check(
        "isMissingReceiver detects lastError text",
        isMissingReceiver({ message: "Could not establish connection. Receiving end does not exist." })
      );
      check(
        "file:// error tells user to refresh",
        String(noContentScriptError({ url: "file:///x.html" }).message).includes("Refresh this tab")
      );

      check("popup maps NO_CONTENT_SCRIPT", popupJs.includes("NO_CONTENT_SCRIPT"));
      check("popup tells user to refresh the tab", popupJs.includes("Refresh this tab"));
      check("popup uses formatAgentError", popupJs.includes("formatAgentError"));
      check(
        "Run Agent still blocks FACE_REDACTION_REQUIRED copy",
        popupJs.includes("FACE_REDACTION_REQUIRED") &&
          popupJs.includes("unredacted faces cannot leave the device")
      );
      check(
        "Run Agent still blocks NER_REDACTION_REQUIRED copy",
        popupJs.includes("NER_REDACTION_REQUIRED") &&
          popupJs.includes("unredacted PII cannot leave the device")
      );

      check(
        "CAPTURE uses sendTabMessage for DOM_SCAN",
        backgroundSrc.includes('sendTabMessage(tab, { type: "DOM_SCAN" })')
      );
      check(
        "SCAN_AND_OVERLAY catch includes errorCode",
        /SCAN_AND_OVERLAY[\s\S]*errorCode:\s*classifyError/.test(backgroundSrc)
      );
      check(
        "onInstalled best-effort re-injects",
        backgroundSrc.includes("reinjectContentScriptsBestEffort")
      );

      check(
        "content overlay repositions on scroll via rAF",
        contentSrc.includes("repositionOverlays") &&
          contentSrc.includes("requestAnimationFrame") &&
          contentSrc.includes('addEventListener("scroll"')
      );
      check(
        "content overlay anchors to live elements via selector",
        contentSrc.includes("overlayAnchors") &&
          contentSrc.includes("getBoundingClientRect") &&
          contentSrc.includes("field.selector")
      );
      check(
        "content keyword match uses tokens (not postal_code⊃pin)",
        contentSrc.includes("attributeTokens") &&
          contentSrc.includes("tokens.has")
      );
      check(
        "DOM_SCAN also lists fillable form fields for batch fill",
        contentSrc.includes("scanFillableFormFields") &&
          contentSrc.includes("fillableFields")
      );

      console.log("");
      if (fail) {
        console.log(`${pass} passed, ${fail} failed.`);
        process.exit(1);
      }
      console.log(`${pass} passed, 0 failed.`);
    });
}
