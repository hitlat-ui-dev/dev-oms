// popup/popup.js
//
// Har firm ke liye Gmail account link/status dikhata hai. Firm list OMS ke
// /api/companies se fetch hoti hai (jo saara Firm Master data — GSTIN/PAN/bank/
// gmailAccountEmail sab — return karta hai, public/unauthenticated hai).
//
// Testing localhost pe kar rahe ho to neeche wali line "http://localhost:3000"
// pe badal do.
const OMS_COMPANIES_API = "https://dev-oms-blush.vercel.app/api/companies";

let firmsCache = [];

init();

async function init() {
  const listEl = document.getElementById("firmList");

  try {
    const res = await fetch(OMS_COMPANIES_API);
    const firms = await res.json();
    firmsCache = Array.isArray(firms) ? firms : [];

    const { gmailTokens = {} } = await chrome.storage.local.get("gmailTokens");

    listEl.innerHTML = "";
    firmsCache.forEach((firm) => {
      const tokenData = gmailTokens[firm.firmCode];
      const isLinked = tokenData && Date.now() < tokenData.expiresAt;

      const row = document.createElement("div");
      row.className = "firmRow";
      row.innerHTML = `
        <div>
          <div class="firmName">${firm.firmName}</div>
          <div class="${isLinked ? "linkedEmail" : "notLinked"}">
            ${
              isLinked
                ? "Linked: " + tokenData.email
                : firm.gmailAccountEmail
                ? "Not linked (target: " + firm.gmailAccountEmail + ")"
                : "⚠️ Firm Master me Gmail email set nahi hai"
            }
          </div>
        </div>
        <button data-firm-code="${firm.firmCode}" data-firm-name="${firm.firmName}" ${
        !firm.gmailAccountEmail && !isLinked ? "disabled" : ""
      }>
          ${isLinked ? "Re-link" : "Link Gmail"}
        </button>
      `;
      listEl.appendChild(row);
    });

    if (firmsCache.length === 0) {
      listEl.innerHTML = `<p style="color:#666;font-size:12px;">Koi firm nahi mili — pehle OMS ke "My Company" page se firm add karo.</p>`;
    }

    listEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => handleLink(btn.dataset.firmCode, btn.dataset.firmName));
    });
  } catch (err) {
    listEl.innerHTML = `<p style="color:#C5221F;font-size:12px;">Firms load nahi hui: ${err.message}</p>`;
  }
}

async function handleLink(firmCode, firmName) {
  const statusEl = document.getElementById("status");
  statusEl.textContent = `${firmName} ke liye Gmail check ho raha hai...`;

  chrome.runtime.sendMessage(
    { type: "LINK_GMAIL_ACCOUNT", payload: { firmCode, knownEmail: currentKnownEmail(firmCode) } },
    (response) => {
      if (response?.success) {
        statusEl.textContent = `✅ ${firmName} → ${response.email} link ho gaya.`;
        setTimeout(init, 1000); // list refresh
      } else {
        statusEl.textContent = `❌ Link fail: ${response?.error || "unknown error"}`;
      }
    }
  );
}

function currentKnownEmail(firmCode) {
  const firm = firmsCache.find((f) => f.firmCode === firmCode);
  return firm?.gmailAccountEmail || null;
}
