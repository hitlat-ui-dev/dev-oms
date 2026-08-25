// popup/popup.js
//
// Shows Gmail link status for the CURRENT OMS user's own GeM Login Setup
// entries (per user, per firm - see app/dashboard/orders/gem-credentials),
// not a shared per-firm list anymore. currentOmsUsername is kept in sync by
// syncCurrentUserToExtension() (lib/triggerGemSubmit.ts), called from every
// OMS dashboard page load - if it's missing, no OMS page has been visited
// in this browser yet.
//
// Testing localhost pe kar rahe ho to neeche wali line "http://localhost:3000"
// pe badal do.
const OMS_ORIGIN = "https://dev-oms-blush.vercel.app";

let credsCache = [];
let firmNameByCode = {};

init();

async function init() {
  const listEl = document.getElementById("firmList");

  try {
    const { currentOmsUsername } = await chrome.storage.local.get("currentOmsUsername");
    if (!currentOmsUsername) {
      listEl.innerHTML = `<p style="color:#666;font-size:12px;">OMS me pehle login karo aur koi bhi dashboard page kholo, phir yahan wapas aao.</p>`;
      return;
    }

    const [credsRes, firmsRes] = await Promise.all([
      fetch(`${OMS_ORIGIN}/api/gem-credentials?username=${encodeURIComponent(currentOmsUsername)}`),
      fetch(`${OMS_ORIGIN}/api/companies`),
    ]);
    credsCache = await credsRes.json();
    const firms = await firmsRes.json();
    firmNameByCode = Object.fromEntries((Array.isArray(firms) ? firms : []).map((f) => [f.firmCode, f.firmName]));

    const { gmailTokensByEmail = {} } = await chrome.storage.local.get("gmailTokensByEmail");

    listEl.innerHTML = "";
    (Array.isArray(credsCache) ? credsCache : []).forEach((cred) => {
      const email = (cred.gemMailId || "").toLowerCase();
      const tokenData = email ? gmailTokensByEmail[email] : null;
      const isLinked = tokenData && Date.now() < tokenData.expiresAt;

      const row = document.createElement("div");
      row.className = "firmRow";
      row.innerHTML = `
        <div>
          <div class="firmName">${firmNameByCode[cred.firmCode] || cred.firmCode}</div>
          <div class="${isLinked ? "linkedEmail" : "notLinked"}">
            ${
              isLinked
                ? "Linked: " + tokenData.email
                : cred.gemMailId
                ? "Not linked (target: " + cred.gemMailId + ")"
                : "⚠️ GeM Login Setup me is firm ka Mail ID save nahi hai"
            }
          </div>
        </div>
        <button data-firm-code="${cred.firmCode}" ${!cred.gemMailId && !isLinked ? "disabled" : ""}>
          ${isLinked ? "Re-link" : "Link Gmail"}
        </button>
      `;
      listEl.appendChild(row);
    });

    if (!Array.isArray(credsCache) || credsCache.length === 0) {
      listEl.innerHTML = `<p style="color:#666;font-size:12px;">Koi GeM login nahi mila — pehle OMS ke "GeM Login Setup" page se firm add karo.</p>`;
    }

    listEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => handleLink(btn.dataset.firmCode));
    });
  } catch (err) {
    listEl.innerHTML = `<p style="color:#C5221F;font-size:12px;">Load nahi hua: ${err.message}</p>`;
  }
}

async function handleLink(firmCode) {
  const statusEl = document.getElementById("status");
  const cred = credsCache.find((c) => c.firmCode === firmCode);
  const email = cred?.gemMailId;
  statusEl.textContent = `${firmNameByCode[firmCode] || firmCode} ke liye Gmail check ho raha hai...`;

  chrome.runtime.sendMessage(
    { type: "LINK_GMAIL_ACCOUNT", payload: { firmCode, knownEmail: email } },
    (response) => {
      if (response?.success) {
        statusEl.textContent = `✅ ${firmNameByCode[firmCode] || firmCode} → ${response.email} link ho gaya.`;
        setTimeout(init, 1000); // list refresh
      } else {
        statusEl.textContent = `❌ Link fail: ${response?.error || "unknown error"}`;
      }
    }
  );
}
