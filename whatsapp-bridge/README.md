# Courier WhatsApp Bridge

Standalone service (not part of the Next.js app, not deployed to Vercel) that sends courier-tracking WhatsApp messages via a real WhatsApp Web session (`whatsapp-web.js` — free, unofficial). It **polls** dev-oms for pending sends rather than being pushed to, because Vercel can't reach this PC directly.

## First-time setup

```
cd whatsapp-bridge
npm install
```

`.env` is already filled in for local testing (points at `http://localhost:3000`). Before real daily use, change `DEV_OMS_BASE_URL` to `https://dev-oms-blush.vercel.app`.

## Run it once manually first (to scan the QR code)

```
node index.js
```

A QR code prints in the terminal — scan it with the WhatsApp account that should send these messages (Settings → Linked Devices → Link a Device). The session saves to `.wwebjs_auth/` so future restarts don't need a re-scan. Leave it running a minute, confirm it logs "WhatsApp bridge ready."

## Running for real, every day (PM2)

Once the manual run above works:

```
npm install -g pm2
pm2 start index.js --name whatsapp-courier-bridge
pm2 save
```

To make it come back automatically after this PC restarts/logs in:

```
npm install -g pm2-windows-startup
pm2-startup install
```

Useful PM2 commands:
- `pm2 status` — is it running?
- `pm2 logs whatsapp-courier-bridge` — see what it's doing
- `pm2 restart whatsapp-courier-bridge` — restart after an `.env` change
