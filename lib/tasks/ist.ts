// Asia/Kolkata helpers. IST is a fixed UTC+5:30 (no DST), so plain offset
// arithmetic on UTC getters is exact and never depends on the server's local
// timezone (Vercel runs UTC, the dev machine runs IST).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** [start, end) of the IST calendar day containing `now`, as UTC instants. */
export function istDayBounds(now: Date = new Date()) {
  const startMs = Math.floor((now.getTime() + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
  return { start: new Date(startMs), end: new Date(startMs + DAY_MS) };
}

/** "YYMM" of the IST month containing `now`, e.g. "2610". */
export function istYYMM(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const yy = String(ist.getUTCFullYear()).slice(-2);
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}${mm}`;
}
