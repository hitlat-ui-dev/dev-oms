# GeM Bill Auto-Submit — DEV GROUP

Manifest V3 extension, triggered from the OMS webapp (`lib/triggerGemSubmit.ts`
via `chrome.runtime.sendMessage` + `externally_connectable`), that opens the
GeM portal, attaches the generated bill PDF against a contract, submits it,
and auto-fills the OTP fetched from the firm's linked Gmail account.

## Folder structure

```
manifest.json                       Extension config (MV3, oauth2 scope)
background/background.js            Multi-account OAuth, OTP fetch, file attach
content/content-gem.js              GeM page automation (full step-by-step flow, see its header comment)
popup/popup.html + popup.js         Firm list (from /api/companies) + Gmail link/status UI
icons/                              Extension icon (add one, then re-add the "icons" key to manifest.json)
```

The OMS-side trigger helper lives in `lib/triggerGemSubmit.ts` (not here,
since it runs inside the Next.js app, not the extension) and is already
wired into the "Submit to GeM" button on the Generate Bill success banner
(`app/dashboard/account/bills/page.tsx`).

## The real GeM flow (mapped live, 20-Aug-2026, against a real order)

Turned out much bigger than the original 8-selector guess — it's a 3-step
wizard, not a single form:

```
Orders list (search contract No.) -> PROCESS ORDER -> Order Details
  -> GENERATE INVOICE (per consignee) -> Order Summary wizard:
       1. Upload Documents/Bill  - PDF file input
       2. Invoice Details        - invoice number, dates, dispatch mode, place of supply
       3. Product Details        - per line: qty, tax rate, HSN, GST UQ name
  -> Invoice Preview (declaration checkbox + CREATE)
  -> Success modal -> "Proceed to e-verify"
  -> e-Verification (eSign / DSC / OTP radio) -> OTP box -> VERIFY
```

All selectors for this are filled in in `content/content-gem.js` (its header
comment has the full list). A few fields without a stable captured
class/id (Billing Address, and Product Details' Qty/Tax Rate/HSN inputs)
are matched by their `<label>` text instead, which is more resilient to
GeM changing internal CSS classes but hasn't been end-to-end verified —
watch the console log if a run fails partway through Invoice/Product Details.

Confirmed business rules baked into the automation:
- **Supplied Qty** is always the full pending/contract quantity, never a
  partial shipment amount, even if goods went out in batches.
- **Invoice Date** and **Date of Dispatch** both = the GeM contract date.
- **Mode of Dispatch** is always `"Manual"`.
- **Place of Supply (State/UT Code)** = the buyer's state (already stored
  on the `Seller` model's `state` field in this OMS).
- **GST UQ Name** is always `"NUMBERS"`.
- Bill of Supply / unregistered firms only need Qty + GST UQ Name on
  Product Details (everything else auto-computes); Tax Invoice also needs
  Tax Rate % and HSN Code per line.

Confirmed Gmail OTP format (`background.js`'s `fetchLatestOtpFromGmail`):
- Sender: `noreply@gem.gov.in`
- Subject: `OTP for your transaction on GeM.`
- Body: `...Your OTP for transaction on the Government e-Marketplace is 396507. This OTP is valid for 10 minutes...`
- OTP also arrives via SMS to the registered mobile in parallel — only the
  email copy is used here.

## STILL PENDING

1. **Google verification / test user cap** — the OAuth client (`Web client
   1`, project `my-app-506111`) is in Testing publishing status, capped at
   100 test users lifetime. Each firm's Gmail account must be added under
   Test users (`console.cloud.google.com/auth/audience?project=my-app-506111`)
   before it can be linked. Moving to Published/Verified needs a Google
   review (sensitive `gmail.readonly` scope) — not done yet.
2. **End-to-end test of the full automated run** — every step was mapped
   and clicked through manually to capture selectors, but the script itself
   (`content-gem.js`) hasn't yet been run start-to-finish unattended.
3. Multi-consignee orders: `stepGenerateInvoice` currently clicks the
   *first* "GENERATE INVOICE" button it finds — fine for the common
   single-consignee case, but worth revisiting if a multi-consignee order
   needs billing.

## Setup

`manifest.json` has a fixed `"key"` field (an embedded public key), so the
extension's ID is **always the same** — `lcadakplnhlmmkgajnojaaiimojnhbap` —
on every computer that loads this folder, regardless of path. That ID is
already wired into `GEM_EXTENSION_ID` in `lib/triggerGemSubmit.ts` and
registered as an OAuth redirect URI in Google Cloud Console, so a fresh
install on a new machine needs none of the old per-computer ID steps.

1. `chrome://extensions` → Developer mode ON → Load Unpacked → select this folder.
2. Confirm the Extension ID shown matches `lcadakplnhlmmkgajnojaaiimojnhbap`
   (if it doesn't, the `"key"` field got dropped/edited — check `manifest.json`).
3. Set each firm's "GeM OTP Gmail Account" field on the My Company page —
   the popup's "Link Gmail" button is disabled for firms without it.
4. That Gmail address must be added as a **Test user** in the Google Cloud
   OAuth consent screen (project `my-app-506111`, since the OAuth client is
   in Testing publishing status, capped at 100 test users) — see
   `console.cloud.google.com/auth/audience?project=my-app-506111`.
5. Test end-to-end on a real order, watching the browser console
   (`[GeM Bill Auto-Submit]` log lines) for where it succeeds/fails.

Note: the private key generated alongside this manifest key is not needed
for unpacked loading (Chrome derives the ID from the public `"key"` field
alone) — only keep it if this extension ever gets packaged/published to the
Chrome Web Store.
