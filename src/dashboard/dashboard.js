// Aegis Privacy & Audit Dashboard Script

const KEY_LABELS = {
  fullName: "Full Name", firstName: "First Name", lastName: "Last Name",
  email: "Email Address", phone: "Phone Number", dob: "Date of Birth", gender: "Gender",
  addressLine1: "Address Line 1", addressLine2: "Address Line 2",
  city: "City", state: "State", pincode: "PIN Code", country: "Country",
  nationality: "Nationality", college: "College / Institution",
  rollNumber: "Roll Number", course: "Course", branch: "Branch",
  guardianName: "Guardian Name", occupation: "Occupation", annualIncome: "Annual Income",
};

function labelFor(k) { return KEY_LABELS[k] || k; }

async function renderDashboard() {
  const stored = await chrome.storage.local.get([
    "aegisCurrentProfile", "aegisProfiles", "userProfile",
    "aegisAuditLogs"
  ]);

  const activeName = stored.aegisCurrentProfile || "Personal";
  const profiles = stored.aegisProfiles || {};
  const activeProfile = profiles[activeName] || stored.userProfile || {};

  const badgeEl = document.getElementById("active-profile-badge");
  if (badgeEl) badgeEl.textContent = `Profile: ${activeName}`;

  const pBody = document.getElementById("profile-table-body");
  if (pBody) {
    pBody.innerHTML = "";
    const entries = Object.entries(activeProfile).filter(([k]) => k !== "_skipped");
    let maxTime = 0;
    if (entries.length === 0) {
      pBody.innerHTML = '<tr><td colspan="3" style="color:#64748b; text-align:center;">No data stored in this profile yet.</td></tr>';
    } else {
      for (const [k, v] of entries) {
        if (v && typeof v === 'object' && v.updatedAt) {
          const t = new Date(v.updatedAt).getTime();
          if (t > maxTime) maxTime = t;
        }
        const tr = document.createElement("tr");
        const val = typeof v === "object" ? v.value : v;
        const time = typeof v === "object" && v.updatedAt ? new Date(v.updatedAt).toLocaleString() : "Recently";
        tr.innerHTML = `
          <td><strong>${labelFor(k)}</strong></td>
          <td><code>${val}</code></td>
          <td style="color:#64748b; font-size:12px;">${time}</td>
        `;
        pBody.appendChild(tr);
      }
    }
    const profileStatsSummary = document.getElementById("profile-stats-summary");
    if (profileStatsSummary) {
      const lastUpdatedStr = maxTime > 0 ? new Date(maxTime).toLocaleString() : "Never";
      profileStatsSummary.textContent = `(${entries.length} fields, Last updated: ${lastUpdatedStr})`;
    }
  }

  const aBody = document.getElementById("audit-table-body");
  if (aBody) {
    aBody.innerHTML = "";
    const logs = stored.aegisAuditLogs || [];
    let totalScans = logs.length;
    let totalFields = 0;
    let totalFaces = 0;

    if (logs.length === 0) {
      aBody.innerHTML = '<tr><td colspan="4" style="color:#64748b; text-align:center;">No scans yet &mdash; click the extension icon and run a privacy scan.</td></tr>';
    } else {
      for (const log of logs) {
        const fieldsRedacted = log.fieldsRedacted || log.fields || 0;
        const facesDetected = log.facesDetected || 0;
        totalFields += parseInt(fieldsRedacted, 10) || 0;
        totalFaces += parseInt(facesDetected, 10) || 0;
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${log.domain || 'Unknown'}</strong></td>
          <td><span class="badge">${fieldsRedacted} fields</span></td>
          <td>${facesDetected} faces</td>
          <td style="color:#64748b; font-size:12px;">${log.timestamp || log.time || 'Unknown'}</td>
        `;
        aBody.appendChild(tr);
      }
    }
    const auditCountEl = document.getElementById('audit-count');
    if (auditCountEl) auditCountEl.textContent = `${logs.length} entries`;
    
    const statScans = document.getElementById("stat-scans");
    if (statScans) statScans.textContent = totalScans;
    const statFields = document.getElementById("stat-fields");
    if (statFields) statFields.textContent = totalFields;
    const statFaces = document.getElementById("stat-faces");
    if (statFaces) statFaces.textContent = totalFaces;
  }
  
  try {
    chrome.runtime.sendMessage({ action: "GET_PAGE_RISK_SCORE" }, (response) => {
      const riskEl = document.getElementById("stat-risk-score");
      if (chrome.runtime.lastError || !response || !response.score) {
        if (riskEl) riskEl.innerHTML = `<span style="font-size:12px;">Grade: N/A &mdash; open the extension on a webpage to see risk score</span>`;
      } else {
        if (riskEl) riskEl.textContent = `Grade: ${response.score}`;
      }
    });
  } catch(e) {
    const riskEl = document.getElementById("stat-risk-score");
    if (riskEl) riskEl.innerHTML = `<span style="font-size:12px;">Grade: N/A &mdash; open the extension on a webpage to see risk score</span>`;
  }
}

document.getElementById("refresh-btn")?.addEventListener("click", renderDashboard);

document.getElementById("btn-clear-profile")?.addEventListener("click", async () => {
  await chrome.storage.local.remove('userProfile');
  renderDashboard();
});

document.getElementById('btn-export-audit')?.addEventListener('click', async () => {
  const { aegisAuditLogs = [] } = await chrome.storage.local.get('aegisAuditLogs');
  const blob = new Blob([JSON.stringify(aegisAuditLogs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aegis-audit-log-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-export-csv')?.addEventListener('click', async () => {
  const { aegisAuditLogs = [] } = await chrome.storage.local.get('aegisAuditLogs');
  const header = ['timestamp','domain','fieldsRedacted','facesDetected'].join(',');
  const rows = aegisAuditLogs.map(e =>
    [e.timestamp || e.time, e.domain, e.fieldsRedacted || e.fields, e.facesDetected].map(v =>
      JSON.stringify(v ?? '').replace(/^"(.*)"$/, '$1')
    ).join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aegis-audit-log-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

chrome.storage.local.get('aegisAuditLogs').then(({ aegisAuditLogs = [] }) => {
  const el = document.getElementById('audit-count');
  if (el) el.textContent = `${aegisAuditLogs.length} entries`;
});

renderDashboard();
