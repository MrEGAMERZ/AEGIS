const fs = require('fs');
let js = fs.readFileSync('src/popup/popup.js', 'utf8');

const additionalCode = `
// ── Privacy Consent ───────────────────────────────────────────────
async function checkPrivacyConsent() {
  const { localDataConsent } = await chrome.storage.local.get("localDataConsent");
  const consentBox = document.getElementById("privacy-consent-box");
  const mainContent = document.getElementById("profile-main-content");
  
  if (consentBox && mainContent) {
    if (localDataConsent === true) {
      consentBox.style.display = "none";
      mainContent.style.display = "block";
    } else {
      consentBox.style.display = "block";
      mainContent.style.display = "none";
    }
  }
}

document.getElementById("privacy-accept-btn")?.addEventListener("click", async () => {
  await chrome.storage.local.set({ localDataConsent: true });
  checkPrivacyConsent();
});

document.getElementById("privacy-decline-btn")?.addEventListener("click", () => {
  document.querySelector('.tab[data-tab="chat"]')?.click();
});

checkPrivacyConsent();
`;

fs.writeFileSync('src/popup/popup.js', js + additionalCode);
