// Courier Tracking WhatsApp Bridge
// ---------------------------------
// Standalone service, NOT part of the dev-oms Next.js app and NOT deployed
// to Vercel - runs persistently on this PC (via PM2, see README.md).
//
// Why this exists: whatsapp-web.js needs a real, continuously-logged-in
// browser session. Vercel's serverless functions can't hold that (they spin
// up per-request and don't stay alive). So the actual "decide what needs
// sending" work happens on Vercel (dev-oms's /api/courier/* routes); this
// script only POLLS Vercel for pending sends and does the actual sending.
// Vercel can't reach into this PC directly (no public inbound access), so
// this deliberately pulls work rather than being pushed to - no tunnel/ngrok
// needed, nothing on this PC is exposed to the internet.
//
// One-time setup: `npm install` in this folder, fill in .env (copy from
// .env.example), then `node index.js` - a QR code prints to the terminal,
// scan it with the WhatsApp account that should send these messages. The
// session is saved to .wwebjs_auth/ (gitignored - it's equivalent to being
// logged into WhatsApp, treat it like a credential) so future restarts
// don't need a re-scan. Once confirmed working, switch to running it under
// PM2 (see README.md) so it survives PC restarts.

require("dotenv").config();
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcodeTerminal = require("qrcode-terminal");
const qrcodePng = require("qrcode");
const path = require("path");

const DEV_OMS_BASE_URL = process.env.DEV_OMS_BASE_URL;
const COURIER_BRIDGE_SECRET = process.env.COURIER_BRIDGE_SECRET;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 60000);

if (!DEV_OMS_BASE_URL || !COURIER_BRIDGE_SECRET) {
  console.error("Missing DEV_OMS_BASE_URL or COURIER_BRIDGE_SECRET in .env - see .env.example.");
  process.exit(1);
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// A bare 10-digit Indian mobile number gets "91" prepended - matches how
// numbers are entered elsewhere in dev-oms (e.g. Seller.mobile). A number
// that already has a country code (11+ digits) is left as-is.
function normalizeNumber(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

function buildMessage({ instituteName, buyerName, docketNo }) {
  return (
    `Namaste ${buyerName || instituteName},\n\n` +
    `Your Parcel Dispatch From Our Side,\n` +
    `Tracking\n` +
    `Docket No: ${docketNo}\n\n` +
    `Track at shreemahavircourier.com with this docket number.\n\n` +
    `*DEV ENTERPRISE GROUPS (FIRMS)*`
  );
}

async function fetchPending() {
  const res = await fetch(`${DEV_OMS_BASE_URL}/api/courier/pending-whatsapp`, {
    headers: { "x-bridge-secret": COURIER_BRIDGE_SECRET },
  });
  if (!res.ok) throw new Error(`pending-whatsapp fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.pending || [];
}

async function markSent(date, docketNo, status) {
  const res = await fetch(`${DEV_OMS_BASE_URL}/api/courier/mark-whatsapp-sent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bridge-secret": COURIER_BRIDGE_SECRET },
    body: JSON.stringify({ date, docketNo, status }),
  });
  if (!res.ok) log(`  Warning: mark-whatsapp-sent failed for ${docketNo}: ${res.status} ${await res.text()}`);
}

// ===== Delivery Challan WhatsApp queue (Orders page "Send DC WhatsApp") =====
// Separate queue from the courier-tracking one above - one document per
// institute's Delivery Challan PDF, not per parcel - but the same pull model.
async function fetchPendingChallans() {
  const res = await fetch(`${DEV_OMS_BASE_URL}/api/delivery-challan/pending-whatsapp`, {
    headers: { "x-bridge-secret": COURIER_BRIDGE_SECRET },
  });
  if (!res.ok) throw new Error(`delivery-challan pending-whatsapp fetch failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.pending || [];
}

async function markChallanSent(id, status, errorMessage) {
  const res = await fetch(`${DEV_OMS_BASE_URL}/api/delivery-challan/mark-whatsapp-sent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-bridge-secret": COURIER_BRIDGE_SECRET },
    body: JSON.stringify({ id, status, errorMessage }),
  });
  if (!res.ok) log(`  Warning: delivery-challan mark-whatsapp-sent failed for ${id}: ${res.status} ${await res.text()}`);
}

async function pollChallansOnce(client) {
  try {
    const pending = await fetchPendingChallans();
    if (pending.length === 0) return;
    log(`${pending.length} pending Delivery Challan WhatsApp send(s) found.`);

    for (const item of pending) {
      const number = normalizeNumber(item.whatsappNumber);
      try {
        const numberId = await client.getNumberId(number);
        if (!numberId) {
          throw new Error(`"${number}" is not registered on WhatsApp (or lookup failed).`);
        }
        const media = new MessageMedia("application/pdf", item.pdfBase64, item.fileName);
        await client.sendMessage(numberId._serialized, media, {
          caption: `Delivery Challan - ${item.instituteName}\nOrder(s): ${(item.orderNos || []).join(", ")}`,
        });
        await markChallanSent(item._id, "SENT");
        log(`  Sent Delivery Challan to ${item.instituteName} (${number})`);
      } catch (err) {
        await markChallanSent(item._id, "FAILED", err.message);
        log(`  FAILED sending Delivery Challan to ${item.instituteName} (${number}): ${err.message}`);
      }
    }
  } catch (err) {
    log(`Delivery Challan poll cycle error: ${err.message}`);
  }
}

// Pushes connection state (and the QR itself, when re-login is needed) to
// dev-oms so the Courier Tracking page can show it - Vercel can't reach this
// PC directly, so this is a push (unlike the pending-sends queues above,
// which the bridge polls FOR).
async function pushStatus(status, qrDataUrl) {
  try {
    const res = await fetch(`${DEV_OMS_BASE_URL}/api/whatsapp-bridge/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-bridge-secret": COURIER_BRIDGE_SECRET },
      body: JSON.stringify({ status, qrDataUrl: qrDataUrl || null }),
    });
    if (!res.ok) log(`  Warning: whatsapp-bridge/status push failed: ${res.status} ${await res.text()}`);
  } catch (err) {
    log(`  Warning: whatsapp-bridge/status push error: ${err.message}`);
  }
}

let polling = false;

async function pollOnce(client) {
  if (polling) return; // don't overlap a slow cycle with the next tick
  polling = true;
  try {
    const pending = await fetchPending();
    if (pending.length === 0) return;
    log(`${pending.length} pending WhatsApp send(s) found.`);

    for (const item of pending) {
      const number = normalizeNumber(item.whatsappNumber);
      try {
        // Resolving the real chat ID via getNumberId first (rather than
        // assuming `${number}@c.us`) is required now - confirmed live
        // 25-Aug-2026: WhatsApp has moved at least some numbers onto a
        // newer "@lid" (linked ID) addressing scheme, and sendMessage()
        // against a stale/guessed "@c.us" id throws
        // "Cannot read properties of undefined (reading 'id')" instead of
        // actually sending.
        const numberId = await client.getNumberId(number);
        if (!numberId) {
          throw new Error(`"${number}" is not registered on WhatsApp (or lookup failed).`);
        }
        await client.sendMessage(numberId._serialized, buildMessage(item));
        await markSent(item.date, item.docketNo, "SENT");
        log(`  Sent to ${item.instituteName} (${number}) - docket ${item.docketNo}`);
      } catch (err) {
        await markSent(item.date, item.docketNo, "FAILED");
        log(`  FAILED sending to ${item.instituteName} (${number}) - docket ${item.docketNo}: ${err.message}`);
      }
    }
  } catch (err) {
    log(`Poll cycle error: ${err.message}`);
  } finally {
    polling = false;
  }
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: __dirname + "/.wwebjs_auth" }),
  puppeteer: { headless: true },
  // WhatsApp regularly retires old Web client versions, which is a common
  // cause of "Couldn't link device / Try again later" on the QR scan even
  // with a fresh QR - pin to a known-working recent version via a
  // community-maintained remote cache instead of whatever's bundled.
  webVersionCache: {
    type: "remote",
    remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1023044142-alpha.html",
  },
});

client.on("qr", async (qr) => {
  log("Scan this QR code with WhatsApp (Linked Devices):");
  qrcodeTerminal.generate(qr, { small: true });

  // Also save as a PNG - a terminal that closes on its own can't be scanned
  // from, but a plain image file opened by double-click always works.
  const qrPath = path.join(__dirname, "login-qr.png");
  try {
    await qrcodePng.toFile(qrPath, qr, { width: 400 });
    log(`QR also saved to ${qrPath} - open that file and scan it if the terminal QR isn't scannable.`);
  } catch (err) {
    log(`Could not save QR PNG: ${err.message}`);
  }

  // Pushed to dev-oms as a data: URL so the Courier Tracking page can render
  // it directly in an <img> - scan it from there, no PC/terminal access needed.
  try {
    const qrDataUrl = await qrcodePng.toDataURL(qr, { width: 400 });
    await pushStatus("NEEDS_QR", qrDataUrl);
  } catch (err) {
    log(`Could not push QR status: ${err.message}`);
  }
});

let pollIntervalHandle = null;

client.on("ready", () => {
  log("WhatsApp bridge ready. Polling dev-oms every " + POLL_INTERVAL_MS / 1000 + "s for pending sends.");
  pushStatus("CONNECTED", null);
  // "ready" can fire more than once per process (e.g. after a reconnect) -
  // without clearing the previous timer first, each re-fire stacks another
  // interval on top of the existing one, so the same pending items get
  // polled (and sent) by multiple overlapping timers at once.
  if (pollIntervalHandle) clearInterval(pollIntervalHandle);
  pollOnce(client);
  pollChallansOnce(client);
  pollIntervalHandle = setInterval(() => {
    pollOnce(client);
    pollChallansOnce(client);
  }, POLL_INTERVAL_MS);
});

client.on("auth_failure", (msg) => {
  log(`Auth failure: ${msg}`);
  pushStatus("DISCONNECTED", null);
});
client.on("disconnected", (reason) => {
  log(`Disconnected: ${reason}`);
  pushStatus("DISCONNECTED", null);
});

client.initialize();
