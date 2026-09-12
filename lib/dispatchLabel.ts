// Shared encode/decode for the QR code printed on a dispatch label.
//
// Nothing is saved to OMS when a label is printed - the record is only
// created later, when someone scans the parcel and picks a transporter (see
// app/dashboard/dispatch-scan/page.tsx). So the QR has to CARRY the parcel's
// own details rather than just point at a database row that doesn't exist yet.
//
// That makes payload size the binding constraint, and it is a hard physical
// one: a QR's module count grows with the data, and a module has to survive
// both the printer and a phone camera. Measured on real label text, the full
// From+To detail came to 85x85 modules - about 0.13mm per module on a 0.45in
// sticker QR, i.e. roughly ONE dot on a 203dpi thermal printer. Unprintable,
// let alone scannable. So:
//   - keys are one or two letters,
//   - printedAt travels as a base36 epoch instead of a 24-char ISO string,
//   - the SENDER's address/mobile are left out entirely (that is our own firm,
//     always recoverable from the Companies directory), while the recipient's
//     address/mobile - the actual destination, the thing worth recording -
//     stay in.
// That lands at ~77 modules, which at the 1.1in QR the label now prints is
// ~0.35mm per module. Keep this in mind before adding a field here.
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

const KEY_MAP: Record<Exclude<keyof DispatchLabelPayload, "printedAt">, string> = {
  id: "i",
  fromFirmCode: "fc",
  fromFirmName: "f",
  toInstituteName: "t",
  toBuyerName: "tb",
  toAddress: "ta",
  toMobile: "tm",
  toPlace: "tp",
};
const PRINTED_AT_KEY = "p";

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

export function encodeDispatchPayload(payload: DispatchLabelPayload): string {
  const short: Record<string, string> = {};
  (Object.keys(KEY_MAP) as (keyof typeof KEY_MAP)[]).forEach((k) => {
    const value = payload[k];
    if (value) short[KEY_MAP[k]] = value;
  });
  const ms = Date.parse(payload.printedAt);
  if (!Number.isNaN(ms)) short[PRINTED_AT_KEY] = ms.toString(36);
  return toBase64Url(JSON.stringify(short));
}

export function decodeDispatchPayload(encoded: string): DispatchLabelPayload | null {
  try {
    const short = JSON.parse(fromBase64Url(encoded)) as Record<string, string>;
    const out = {} as DispatchLabelPayload;
    (Object.keys(KEY_MAP) as (keyof typeof KEY_MAP)[]).forEach((k) => {
      out[k] = short[KEY_MAP[k]] || "";
    });
    const ms = short[PRINTED_AT_KEY] ? parseInt(short[PRINTED_AT_KEY], 36) : NaN;
    out.printedAt = Number.isNaN(ms) ? "" : new Date(ms).toISOString();
    return out.id ? out : null;
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
