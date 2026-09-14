// Shared encode/decode for the QR code printed on a dispatch label.
//
// Nothing is saved to OMS when a label is printed - the record is only
// created later, when someone scans the parcel and picks a transporter (see
// app/dashboard/dispatch-scan/page.tsx). So the QR has to CARRY the parcel's
// own details rather than just point at a database row that doesn't exist yet.
//
// That makes payload size the binding constraint, and on real hardware it
// turned out to be a harder one than the theory suggested: even a "should
// scan fine" QR (~65-70 modules, comfortably above the usual 2 dots/module
// rule of thumb) came out visibly patchy on an actual thermal label printer,
// while the surrounding TEXT on the same label printed crisp - the QR's fine
// module grid was simply finer than that print head could physically
// resolve, independent of the raster-vs-vector fix that solved a different,
// earlier failure. The only real lever left at that point is fewer modules,
// so every byte here is deliberate:
//   - fields are packed positionally ("a|b|c"), not as JSON ({"i":"a",...}) -
//     no keys, quotes, colons or braces, ~25% shorter for the same data,
//   - printedAt travels as a base36 epoch instead of a 24-char ISO string,
//   - the SENDER's address/mobile are left out entirely (that is our own
//     firm, always recoverable from the Companies directory), while the
//     recipient's address/mobile - the actual destination, the thing worth
//     recording - stay in.
// Keep this in mind before adding a field here: it isn't free, and the
// budget is tighter than a "modules per inch" calculation implies.
export interface DispatchLabelPayload {
  /** Generated at print time, identifies this physical label - used to stop the same parcel being saved twice. */
  id: string;
  fromFirmCode: string;
  fromFirmName: string;
  toInstituteName: string;
  toBuyerName: string;
  toAddress: string;
  toMobile: string;
  toPlace: string;
  /** ISO timestamp the label was printed at (travels base36-compacted). */
  printedAt: string;
}

// Fixed field order for the "|"-delimited payload - positional, so no keys
// are spent naming each field. Append-only: inserting or reordering a field
// breaks every QR already printed but not yet scanned.
const FIELD_ORDER: readonly Exclude<keyof DispatchLabelPayload, "printedAt">[] = [
  "id", "fromFirmCode", "fromFirmName", "toInstituteName", "toBuyerName", "toAddress", "toMobile", "toPlace",
];

function toBase64Url(raw: string): string {
  const b64 = typeof window === "undefined"
    ? Buffer.from(raw, "utf-8").toString("base64")
    : btoa(unescape(encodeURIComponent(raw)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return typeof window === "undefined"
    ? Buffer.from(padded, "base64").toString("utf-8")
    : decodeURIComponent(escape(atob(padded)));
}

// "|" is the field delimiter below - strip any stray one out of typed data
// so it can never misalign the decode (nothing here legitimately needs one).
function sanitizeField(v: string): string {
  return (v || "").replace(/\|/g, " ");
}

export function encodeDispatchPayload(payload: DispatchLabelPayload): string {
  const ms = Date.parse(payload.printedAt);
  const printedAtCompact = Number.isNaN(ms) ? "" : ms.toString(36);
  const parts = [...FIELD_ORDER.map((k) => sanitizeField(payload[k])), printedAtCompact];
  return toBase64Url(parts.join("|"));
}

export function decodeDispatchPayload(encoded: string): DispatchLabelPayload | null {
  try {
    const parts = fromBase64Url(encoded).split("|");
    // Unlike the old JSON.stringify/JSON.parse format, a plain "|"-split
    // never throws on garbage input - any scanned QR/text that happens to
    // base64url-decode at all would otherwise come back looking like a
    // "valid" payload with nonsense field values. Every id this app ever
    // generates starts with "lbl_" (see newLabelId) and the field count is
    // fixed, so require both before trusting the rest of the split.
    if (parts.length !== FIELD_ORDER.length + 1 || !parts[0].startsWith("lbl_")) return null;
    const out = {} as DispatchLabelPayload;
    FIELD_ORDER.forEach((k, i) => { out[k] = parts[i] || ""; });
    const ms = parts[FIELD_ORDER.length] ? parseInt(parts[FIELD_ORDER.length], 36) : NaN;
    out.printedAt = Number.isNaN(ms) ? "" : new Date(ms).toISOString();
    return out;
  } catch {
    return null;
  }
}

/** "lbl_<time>_<random>" - unique enough for one firm's labels without needing a server round-trip at print time. */
export function newLabelId(): string {
  return `lbl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** The URL a printed QR points at: a public read-only receipt that works even before the parcel is scanned. */
export function dispatchScanUrl(origin: string, payload: DispatchLabelPayload): string {
  return `${origin}/dispatch?d=${encodeDispatchPayload(payload)}`;
}
