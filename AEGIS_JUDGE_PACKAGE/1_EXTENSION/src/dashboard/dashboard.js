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
    if (entries.length === 0) {
      pBody.innerHTML = '<tr><td colspan="3" style="color:#64748b; text-align:center;">No data stored in this profile yet.</td></tr>';
    } else {
      for (const [k, v] of entries) {
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
  }

  const aBody = document.getElementById("audit-table-body");
  if (aBody) {
    aBody.innerHTML = "";
    const logs = stored.aegisAuditLogs || [];

    if (logs.length === 0) {
      aBody.innerHTML = '<tr><td colspan="4" style="color:#64748b; text-align:center;">No audit logs yet. Run a scan or fill to start tracking.</td></tr>';
    } else {
      for (const log of logs) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${log.domain}</strong></td>
          <td><span class="badge">${log.action}</span></td>
          <td>${log.fields} fields</td>
          <td style="color:#64748b; font-size:12px;">${log.time}</td>
        `;
        aBody.appendChild(tr);
      }
    }
  }
}

document.getElementById("refresh-btn")?.addEventListener("click", renderDashboard);

renderDashboard();
