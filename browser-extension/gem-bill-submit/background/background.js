// background/background.js
// MV3 service worker — extension ka "brain"
//
// Har firm ka ALAG Gmail account ho sakta hai OTP ke liye, isliye
// chrome.identity.getAuthToken() (single Chrome-profile account) ki jagah
// chrome.identity.launchWebAuthFlow() use kiya hai — jisse user EXPLICITLY
// choose kar sake kaunsa Google account authorize karna hai, per firm.
//
// Token storage: chrome.storage.local me { gmailTokens: { [firmCode]: { accessToken, expiresAt, email } } }
//
// STILL PENDING (see GeM-Extension-Data-Collection-Checklist.md):
//   1. OAUTH_CLIENT_ID placeholder below AND in manifest.json.
//
// CONFIRMED live on 20-Aug-2026 against a real order (see content-gem.js's
// header for the full step-by-step flow this drives):
//   - host: fulfilment.gem.gov.in, Orders workspace URL below
//   - Gmail sender/subject/body format used in fetchLatestOtpFromGmail()

const GEM_BASE_URL = "https://fulfilment.gem.gov.in";
const GEM_ORDERS_URL = `${GEM_BASE_URL}/fulfilment/home#WORKSPACE_ID=ORDERS_WS`;
// The actual GeM SSO login form (User ID + Captcha, then Password on a
// follow-up page) - confirmed live 24-Aug-2026 via DevTools inspection.
// client_id/state here are the SSO app's own identifiers, not a per-visit
// nonce - this exact URL was confirmed to reach the login form directly.
const GEM_LOGIN_URL = "https://sso.gem.gov.in/ARXSSO/oauth/doLogin?redirect_uri=https%3A%2F%2Fmkp.gem.gov.in%2Fauth%2Farx%2Fcallback&client_id=131804060198305&state=4e4b6dfa72e45b4249f6ccef0b50be7a83693c9d080cf7ae";

// Manifest me daale gaye OAuth client ID ko yahan bhi use karenge (launchWebAuthFlow ke liye
// alag se URL banana padta hai, chrome.identity.getAuthToken jaisa seedha nahi hota).
// A "Web application" type client (not "Chrome Extension" type) - required
// because launchWebAuthFlow() (used below for per-firm login_hint support)
// needs an explicitly-registered redirect URI, which the Chrome Extension
// client type doesn't support configuring.
const OAUTH_CLIENT_ID = "414179983606-4vspofchn2qe0hnvov9iabj35pg1cfoo.apps.googleusercontent.com";
const REDIRECT_URI = chrome.identity.getRedirectURL(); // extension khud generate karega

// ---------------------------------------------------------------------------
// 1. OMS SE TRIGGER RECEIVE KARNA
// ---------------------------------------------------------------------------
// payload shape:
// {
//   firmCode: "DEV01",                    // IMPORTANT — kis firm ka bill hai (Gmail account pehchaan ne ke liye)
//   billType: "TAX_INVOICE" | "BILL_OF_SUPPLY",
//   contractNo: "GEMC-511687...",
//   contractDate: "20/08/2026",           // dd/mm/yyyy - GeM's Invoice Date + Dispatch Date both use this
//   buyerState: "Gujarat",                // for the Place of Supply (State/UT Code) dropdown
//   billId: "<mongo _id>",                // used to upload GeM's own e-signed invoice back to OMS
//   billNo: "DEV048",
//   billPdfUrl: "https://dev-oms-blush.vercel.app/api/bills/<id>/pdf",
//   firmName: "DEV ENTERPRISE",
//   items: [{ qty, hsnSac, gstPercent }]  // one per Product Details row, same order as the contract
// }
// From OUTSIDE the extension only (the OMS webapp, via externally_connectable).
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === "SUBMIT_BILL_TO_GEM") {
    handleSubmitBillToGem(message.payload)
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "RETRY_GEM_DOCUMENT") {
    handleRetryGemDocument(message.payload)
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "GEM_LOGIN") {
    handleGemLogin(message.payload)
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

// GeM Login Setup page's "Login" button - stashes the saved Username/
// Password/Mail so content-gem.js can fill them in (and fetch the login OTP
// from gemMailId, if given) once the login page loads, then opens/focuses
// that tab. Captcha is the only thing left for the user.
async function handleGemLogin(payload) {
  const { gemUserId, gemPassword, gemMailId } = payload || {};
  if (!gemUserId || !gemPassword) {
    throw new Error("gemUserId aur gemPassword zaroori hain.");
  }

  await chrome.storage.local.set({
    pendingGemLogin: { gemUserId, gemPassword, gemMailId: gemMailId || "", step: "USERNAME", startedAt: Date.now() },
  });

  const tab = await chrome.tabs.create({ url: GEM_LOGIN_URL, active: true });
  return { tabId: tab.id, message: "GeM login tab khola gaya." };
}

async function handleSubmitBillToGem(payload) {
  const {
    firmCode, contractNo, billNo, billPdfUrl, firmName, gmailAccountEmail,
    billType, contractDate, buyerState, items, billId,
  } = payload;

  if (!firmCode || !contractNo || !billNo || !billPdfUrl) {
    throw new Error("firmCode, contractNo, billNo, aur billPdfUrl zaroori hain.");
  }

  // OMS's own origin (localhost vs the deployed domain), derived from the
  // PDF URL it already sent - used later to upload GeM's own invoice back.
  const omsOrigin = new URL(billPdfUrl).origin;

  // Gmail account ab email se link/store hota hai (gmailTokensByEmail), na
  // ki firmCode se - GeM Login Setup ke gemMailId aur is e-verify OTP ke
  // beech ek hi linked account share hota hai, do alag jagah link nahi
  // karna padta. OMS ab gmailAccountEmail me GeM Login Setup ka gemMailId
  // bhejta hai (Company Setup ka purana field ab yahan use nahi hota).
  if (!gmailAccountEmail) {
    throw new Error(
      `Firm "${firmName}" ka Mail ID GeM Login Setup me save nahi hai - pehle wahan is firm ka Mail ID save karo.`
    );
  }

  let tokenData = await getStoredTokenForEmail(gmailAccountEmail);

  if (!tokenData) {
    // Token nahi hai ya expire ho gaya — AUTOMATICALLY silent re-link try
    // karo, user ko kahi jaane ki zaroorat na pade.
    try {
      await linkGmailAccountForEmail(gmailAccountEmail); // silent-first, interactive fallback internally
      tokenData = await getStoredTokenForEmail(gmailAccountEmail);
    } catch {
      // silent bhi fail hua, interactive bhi cancel/fail hua - error neeche throw hoga
    }
  }

  if (!tokenData) {
    throw new Error(
      `"${gmailAccountEmail}" ka Gmail account link nahi ho paya. GeM Login Setup se ek baar "Login" chala ke Google consent confirm karo.`
    );
  }

  await chrome.storage.local.set({
    pendingBillSubmission: {
      firmCode, contractNo, billNo, billPdfUrl, firmName, gmailAccountEmail,
      billType, contractDate, buyerState, items, billId, omsOrigin,
      step: "SEARCH",
      startedAt: Date.now(),
    },
  });

  const tab = await chrome.tabs.create({ url: GEM_ORDERS_URL, active: true });

  return { tabId: tab.id, message: "GeM tab khola gaya, content script automation shuru karega." };
}

// Bill already fully submitted+verified on GeM, but OMS ke paas uski copy
// nahi hai (SUBMIT_BILL_TO_GEM ke GEM_DOCUMENT step ka pehla attempt fail ho
// gaya tha, jo non-fatal hai). Poora flow dobara chalane ke bajaye seedha
// order tak jaake, jo invoice already generated hai uska download link utha
// ke upload karta hai - GENERATE INVOICE/UPLOAD/E-VERIFY dobara chalane se
// already-invoiced order pe error ya duplicate invoice ka risk hota.
async function handleRetryGemDocument(payload) {
  const { firmCode, contractNo, billNo, billId, billPdfUrl } = payload;

  if (!firmCode || !contractNo || !billNo || !billId || !billPdfUrl) {
    throw new Error("firmCode, contractNo, billNo, billId, aur billPdfUrl zaroori hain.");
  }

  const omsOrigin = new URL(billPdfUrl).origin;

  await chrome.storage.local.set({
    pendingBillSubmission: {
      firmCode, contractNo, billNo, billId, omsOrigin,
      documentOnly: true,
      step: "SEARCH",
      startedAt: Date.now(),
    },
  });

  const tab = await chrome.tabs.create({ url: GEM_ORDERS_URL, active: true });

  return { tabId: tab.id, message: "GeM tab khola gaya, sirf invoice document fetch hoga." };
}

// ---------------------------------------------------------------------------
// 2. INTERNAL MESSAGES — content script + the extension's OWN popup
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "LINK_GMAIL_ACCOUNT") {
    // payload: { firmCode, knownEmail } — sent from popup/popup.js
    linkGmailAccountForFirm(message.payload.firmCode, message.payload.knownEmail)
      .then((email) => sendResponse({ success: true, email }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "FETCH_OTP_FROM_GMAIL") {
    fetchLatestOtpFromGmail(message.gmailAccountEmail)
      .then((otp) => sendResponse({ success: true, otp }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "ATTACH_FILE_TO_INPUT") {
    attachFileToInput(sender.tab.id, message.selector, message.fileUrl, message.fileName)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "FETCH_AND_UPLOAD_GEM_DOCUMENT") {
    fetchAndUploadGemDocument(message.gemDocumentUrl, message.billId, message.omsOrigin)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_PENDING_SUBMISSION") {
    chrome.storage.local.get("pendingBillSubmission").then((data) => {
      sendResponse({ success: true, data: data.pendingBillSubmission || null });
    });
    return true;
  }

  if (message.type === "GET_PENDING_LOGIN") {
    chrome.storage.local.get("pendingGemLogin").then((data) => {
      sendResponse({ success: true, data: data.pendingGemLogin || null });
    });
    return true;
  }

  if (message.type === "CLEAR_PENDING_LOGIN") {
    chrome.storage.local.remove("pendingGemLogin").then(() => sendResponse({ success: true }));
    return true;
  }

  if (message.type === "FETCH_LOGIN_OTP") {
    // payload: { gemMailId, sinceTs } - sent from content-gem.js's GeM
    // Login OTP step (distinct from the bill-submission OTP fetch above,
    // which is keyed by firmCode against an already-linked Gmail account).
    fetchLoginOtp(message.gemMailId, message.sinceTs)
      .then((otp) => sendResponse({ success: true, otp }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "SET_PENDING_LOGIN_STEP") {
    chrome.storage.local.get("pendingGemLogin").then(({ pendingGemLogin }) => {
      if (pendingGemLogin) {
        pendingGemLogin.step = message.step;
        chrome.storage.local.set({ pendingGemLogin }).then(() => sendResponse({ success: true }));
      } else {
        sendResponse({ success: false });
      }
    });
    return true;
  }
});

// ---------------------------------------------------------------------------
// 3. PER-FIRM GMAIL ACCOUNT LINKING
// ---------------------------------------------------------------------------
// Firm Master me pehle se stored gmailAccountEmail use karke login_hint se
// account-chooser SKIP karne ki koshish karta hai. Agar us email se Chrome
// me already session hai aur pehle consent diya ja chuka hai, to SILENTLY
// (bina kisi popup ke) naya token mil jata hai.

// Silent attempt — koi UI nahi dikhta agar successful ho
async function trySilentAuth(email) {
  const authUrl = buildAuthUrl(email, /* interactive */ false);
  try {
    const responseUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: false }, (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message || "Silent auth fail."));
        } else {
          resolve(responseUrl);
        }
      });
    });
    return parseTokenFromRedirect(responseUrl);
  } catch {
    return null; // silent fail hua — interactive fallback chalega
  }
}

// Interactive attempt — login_hint se email PRE-FILLED hoga, poori account list nahi dikhegi
async function tryInteractiveAuth(email) {
  const authUrl = buildAuthUrl(email, /* interactive */ true);
  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(new Error(chrome.runtime.lastError?.message || "Authorization cancel/fail hua."));
      } else {
        resolve(responseUrl);
      }
    });
  });
  return parseTokenFromRedirect(responseUrl);
}

function buildAuthUrl(email, interactive) {
  const params = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    response_type: "token",
    redirect_uri: REDIRECT_URI,
    scope: "https://www.googleapis.com/auth/gmail.readonly email",
    login_hint: email, // YE KEY CHANGE HAI — email pehle se pata hai to pre-fill/skip ho jata hai
    prompt: interactive ? "consent" : "none",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function parseTokenFromRedirect(redirectUrl) {
  const params = new URLSearchParams(new URL(redirectUrl).hash.slice(1));
  const accessToken = params.get("access_token");
  const expiresIn = parseInt(params.get("expires_in") || "3600", 10);
  if (!accessToken) throw new Error("Access token nahi mila.");
  return { accessToken, expiresIn };
}

// Popup se ya OMS se call hota hai — firm ke saath uska pehle se pata Gmail email bhi aata hai
async function linkGmailAccountForFirm(firmCode, knownEmail) {
  if (!knownEmail) {
    throw new Error("Is firm ka Gmail email Firm Master me set nahi hai — pehle wahan daalo.");
  }

  // Pehle SILENT try karo — agar already logged in + consented hai to koi popup nahi dikhega
  let tokenResult = await trySilentAuth(knownEmail);

  // Silent fail hua to interactive (email pre-filled, poori list nahi) try karo
  if (!tokenResult) {
    tokenResult = await tryInteractiveAuth(knownEmail);
  }

  const { accessToken, expiresIn } = tokenResult;

  // Verify karo ki jo account authorize hua wahi email hai jo expect kiya tha
  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await profileRes.json();

  if (profile.email.toLowerCase() !== knownEmail.toLowerCase()) {
    throw new Error(
      `Authorize hua account (${profile.email}) Firm Master me set email (${knownEmail}) se MATCH nahi karta. Sahi account select karo.`
    );
  }

  const tokenData = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    email: profile.email,
  };

  const { gmailTokens = {} } = await chrome.storage.local.get("gmailTokens");
  gmailTokens[firmCode] = tokenData;
  await chrome.storage.local.set({ gmailTokens });

  // Also saved under the unified by-email store (gmailTokensByEmail) - a
  // link done here (via the extension's own popup) is then immediately
  // usable by GeM Login Setup's "Login" button and the bill-submission
  // e-verify OTP too, since both now look up by email, not firmCode.
  const { gmailTokensByEmail = {} } = await chrome.storage.local.get("gmailTokensByEmail");
  gmailTokensByEmail[profile.email.toLowerCase()] = tokenData;
  await chrome.storage.local.set({ gmailTokensByEmail });

  return profile.email;
}

async function getStoredTokenForFirm(firmCode) {
  const { gmailTokens = {} } = await chrome.storage.local.get("gmailTokens");
  const tokenData = gmailTokens[firmCode];
  if (!tokenData) return null;

  // Token expire ho gaya ho to null return karo — dobara link karna padega
  // (implicit-grant tokens ke paas refresh token nahi hota, re-authorization hi tareeka hai)
  if (Date.now() >= tokenData.expiresAt) return null;

  return tokenData;
}

// Same silent-then-interactive linking as linkGmailAccountForFirm, but keyed
// by the email address itself rather than a firmCode - used for the GeM
// Login Setup page's OTP step, which has a gemMailId but no firm-master
// Gmail link. Kept in a separate storage key (gmailTokensByEmail) so it can
// never collide with or disturb the firmCode-keyed bill-submission tokens.
async function getStoredTokenForEmail(email) {
  const { gmailTokensByEmail = {} } = await chrome.storage.local.get("gmailTokensByEmail");
  const tokenData = gmailTokensByEmail[email.toLowerCase()];
  if (!tokenData) return null;
  if (Date.now() >= tokenData.expiresAt) return null;
  return tokenData;
}

async function linkGmailAccountForEmail(email) {
  let tokenResult = await trySilentAuth(email);
  if (!tokenResult) {
    tokenResult = await tryInteractiveAuth(email);
  }

  const { accessToken, expiresIn } = tokenResult;

  const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const profile = await profileRes.json();

  if (profile.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error(
      `Authorize hua account (${profile.email}) is credential ke Mail ID (${email}) se MATCH nahi karta. Sahi account select karo.`
    );
  }

  const tokenData = { accessToken, expiresAt: Date.now() + expiresIn * 1000, email: profile.email };

  const { gmailTokensByEmail = {} } = await chrome.storage.local.get("gmailTokensByEmail");
  gmailTokensByEmail[email.toLowerCase()] = tokenData;
  await chrome.storage.local.set({ gmailTokensByEmail });

  return profile.email;
}

// GeM Login Setup's OTP step - "Generate OTP" was just clicked on the GeM
// login page, this polls gemMailId's inbox for it. NOT YET CONFIRMED: the
// login OTP email's exact sender/subject - reuses the same
// "from:noreply@gem.gov.in subject:OTP" query confirmed for the
// bill-submission e-verify OTP, since it's the same institution and both are
// GeM OTP mails, but this specific email hasn't been seen live yet.
async function fetchLoginOtp(email, sinceTs) {
  if (!email) {
    throw new Error("Is credential ka Mail ID save nahi hai - GeM Login Setup me pehle wo bhi bharo.");
  }

  let tokenData = await getStoredTokenForEmail(email);
  if (!tokenData) {
    // First time for this email (or expired) - this pops the Google
    // consent screen right there on the GeM tab, one-time only.
    await linkGmailAccountForEmail(email);
    tokenData = await getStoredTokenForEmail(email);
  }
  if (!tokenData) {
    throw new Error(`"${email}" ka Gmail account link nahi ho paya.`);
  }

  return pollGmailForOtp(tokenData.accessToken, sinceTs);
}

// ---------------------------------------------------------------------------
// 4. GMAIL OTP FETCH (email ke hisaab se sahi account ka token use karta hai -
//    same gmailTokensByEmail store as GeM Login Setup's OTP fetch)
// ---------------------------------------------------------------------------
async function fetchLatestOtpFromGmail(email) {
  if (!email) {
    throw new Error("Is bill ke firm ka Mail ID GeM Login Setup me save nahi hai.");
  }
  const tokenData = await getStoredTokenForEmail(email);
  if (!tokenData) {
    throw new Error(`"${email}" ka Gmail account link nahi hai ya token expire ho gaya — GeM Login Setup se "Login" chala ke dobara link karo.`);
  }
  // Confirmed live: without a time cutoff, an OLD OTP email (from an
  // earlier test/attempt) got picked up and GeM rejected it ("OTP does not
  // match"). Only messages received from just before this fetch started are
  // accepted - a small negative buffer covers clock skew between this
  // machine and Gmail's servers, not a real waiting window.
  return pollGmailForOtp(tokenData.accessToken, Date.now() - 30 * 1000);
}

// Shared by both OTP flows (bill-submission e-verify, GeM Login OTP) - only
// the token and the "accept mail received after this time" cutoff differ.
async function pollGmailForOtp(accessToken, acceptAfterMs) {
  // Gmail's search index can lag a brand-new message by well over the
  // ~45s this used to allow for - widened to ~2 minutes.
  const maxAttempts = 40;
  const pollIntervalMs = 3000;

  // Confirmed live: from:noreply@gem.gov.in ALONE isn't enough - GeM sends
  // plenty of other mail from that same address too (order/contract
  // notifications), which were crowding out the actual OTP email from the
  // most-recent-N results. subject:OTP (a single word, not the full phrase
  // in quotes - that failed once before, possibly a tokenization/
  // punctuation mismatch) narrows it back down reliably.
  const query = encodeURIComponent("from:noreply@gem.gov.in subject:OTP");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const listRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=5`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const listData = await listRes.json();

    if (listData.error) {
      // Surface the real Gmail API error instead of masking it as a plain
      // "email not found" timeout - a bad/expired token or missing scope
      // looks identical to "no email yet" otherwise, wasting the whole
      // retry window on something a retry can't fix.
      throw new Error(`Gmail API error: ${listData.error.message || JSON.stringify(listData.error)}`);
    }

    console.log(
      `[GeM Bill Auto-Submit] OTP poll attempt ${attempt + 1}/${maxAttempts}: ${listData.messages?.length || 0} message(s) matched query "from:noreply@gem.gov.in subject:OTP".`
    );

    if (listData.messages && listData.messages.length > 0) {
      for (const { id: msgId } of listData.messages) {
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const msgData = await msgRes.json();

        const receivedAt = Number(msgData.internalDate); // epoch ms
        if (receivedAt < acceptAfterMs) {
          console.log(
            `[GeM Bill Auto-Submit] Message ${msgId} skipped - received ${new Date(receivedAt).toISOString()}, older than this fetch's cutoff.`
          );
          continue;
        }

        const bodyText = extractEmailBodyText(msgData);
        const otp = extractOtpFromText(bodyText);
        console.log(
          `[GeM Bill Auto-Submit] Message ${msgId} (received ${new Date(receivedAt).toISOString()}) body (first 200 chars): ${bodyText.slice(0, 200)} | OTP extracted: ${otp || "none"}`
        );
        if (otp) return otp;
      }
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`${(maxAttempts * pollIntervalMs) / 1000} second me OTP email nahi mila.`);
}

function extractEmailBodyText(gmailMessage) {
  function decodePart(part) {
    if (part.body?.data) {
      return atob(part.body.data.replace(/-/g, "+").replace(/_/g, "/"));
    }
    if (part.parts) {
      return part.parts.map(decodePart).join(" ");
    }
    return "";
  }
  return decodePart(gmailMessage.payload || {});
}

function extractOtpFromText(rawText) {
  // The email body is HTML (confirmed live: "<!DOCTYPE html><head>...<table
  // ..."), not plain text - a tag sitting right between "is" and the digits
  // (e.g. "is <b>530446</b>") would otherwise break a direct match, so tags
  // are stripped first.
  const text = rawText.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ");

  // Confirmed live 20-Aug-2026 body: "Your OTP for transaction on the
  // Government e-Marketplace is 396507. This OTP is valid for 10 minutes."
  // Matching "is <6 digits>" (rather than a bare \d{6}) avoids accidentally
  // grabbing an unrelated 6-digit number elsewhere in the email/footer.
  const match = text.match(/\bis\s+(\d{6})\b/i);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// 5. FILE INPUT ME PDF ATTACH KARNA (chrome.debugger API se, kyunki normal JS
//    se file input set nahi ho sakta security restriction ki wajah se)
// ---------------------------------------------------------------------------
async function attachFileToInput(tabId, selector, fileUrl, fileName) {
  const downloadId = await new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: fileUrl,
        filename: fileName || "gem-bill-temp.pdf",
        // Without this, Chrome appends " (1)", " (2)", etc. on a repeat run
        // with the same filename - and GeM rejects uploaded filenames
        // containing spaces/parentheses, so re-runs would keep failing.
        conflictAction: "overwrite",
      },
      (id) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      }
    );
  });

  const filePath = await waitForDownloadComplete(downloadId);

  await new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));

      chrome.debugger.sendCommand({ tabId }, "DOM.getDocument", {}, (doc) => {
        chrome.debugger.sendCommand(
          { tabId },
          "DOM.querySelector",
          { nodeId: doc.root.nodeId, selector },
          (result) => {
            chrome.debugger.sendCommand(
              { tabId },
              "DOM.setFileInputFiles",
              { files: [filePath], nodeId: result.nodeId },
              () => {
                chrome.debugger.detach({ tabId });
                resolve();
              }
            );
          }
        );
      });
    });
  });
}

function waitForDownloadComplete(downloadId) {
  return new Promise((resolve, reject) => {
    chrome.downloads.onChanged.addListener(function listener(delta) {
      if (delta.id === downloadId && delta.state?.current === "complete") {
        chrome.downloads.onChanged.removeListener(listener);
        chrome.downloads.search({ id: downloadId }, (results) => {
          if (results[0]) resolve(results[0].filename);
          else reject(new Error("Downloaded file ka path nahi mila."));
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 6. GeM KA APNA OFFICIAL INVOICE PDF FETCH KARKE OMS ME UPLOAD KARNA
// ---------------------------------------------------------------------------
// Runs after a successful OTP-verified submission. content-gem.js finds the
// "Download Invoice" button's URL and hands it here - fetched directly
// (credentials: "include" sends the GeM session cookies, since
// fulfilment.gem.gov.in is in this extension's host_permissions) rather than
// via chrome.downloads, so the bytes never touch disk and can go straight to
// OMS's upload endpoint.
async function fetchAndUploadGemDocument(gemDocumentUrl, billId, omsOrigin) {
  if (!billId || !omsOrigin) {
    throw new Error("billId ya omsOrigin missing hai - purane bill ke liye ye feature available nahi hai.");
  }

  const pdfRes = await fetch(gemDocumentUrl, { credentials: "include" });
  if (!pdfRes.ok) {
    throw new Error(`GeM se document fetch fail hua (status ${pdfRes.status}).`);
  }
  const pdfBytes = await pdfRes.arrayBuffer();
  if (pdfBytes.byteLength === 0) {
    throw new Error("GeM se khaali file mili.");
  }

  const uploadRes = await fetch(`${omsOrigin}/api/bills/${billId}/gem-document`, {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: pdfBytes,
  });
  if (!uploadRes.ok) {
    const errData = await uploadRes.json().catch(() => ({}));
    throw new Error(errData.error || `OMS upload fail hua (status ${uploadRes.status}).`);
  }
}
