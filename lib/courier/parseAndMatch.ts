// Courier PDF line parsing + institute matching - kept isolated from
// fetch (gmailFetch.ts) and from any future WhatsApp-sending step, so a
// courier format change only ever touches this file.
//
// processNewCourierParcels() is the orchestrator that ties fetch +
// parse + match together. WhatsApp sending is deferred (Phase 2, once a
// WhatsApp Business Cloud API account exists) - "matched" here means
// "confidently identified," not "sent."
//
// Confirmed line format (MOHIT ENTERPRISE / Shree Mahavir Courier booking
// register, verified against a real "1465 (13).pdf" sample): a 12-digit
// docket number anchors each row, followed by destination city (can be
// multiple words, e.g. "SAYLA DIST - SU. NAGAR"), then one of our own known
// firm names ("S S ENTERPRISE"), then the "Reciver Name" column - e.g.:
//   123220046997 HAZIRA SURAT S S ENTERPRISE JAY SHAH
//   123220047073 DEODAR S S ENTERPRISE ITI SIHORI
//
// The real data is messier than a clean "first name only" column: some rows
// are a person's name ("JAY SHAH", "PINAL BHAI"), some are a shop name
// ("LALIT BEUTY COLLECTION"), and some are institute-shorthand text
// ("ITI SIHORI" - not a person at all). So matching tries BOTH patterns per
// seller and keeps whichever scores higher:
//   (a) first word of the receiver text vs Seller.buyerName (contact name)
//   (b) the full receiver text vs Seller.instituteName (handles "ITI SIHORI"-
//       style rows where the whole phrase names the institute, not a person)
// - plus city vs Seller.place in both cases, at the lower weight.

export interface ParsedParcel {
  docketNo: string;
  city: string;
  receiverFirstName: string;
  receiverFullText: string;
  firmName: string;
  rawLine: string;
}

export interface SellerForCourierMatch {
  _id: any;
  instituteName: string;
  buyerName?: string;
  place?: string;
  whatsappNumber?: string;
}

export interface CourierMatchResult {
  seller: SellerForCourierMatch | null;
  score: number;
}

/** Default confidence threshold - a match at or above this is auto-sendable;
 * below it (or no firm-name anchor found in the line at all) goes to review. */
export const MATCH_THRESHOLD = 0.6;
const NAME_WEIGHT = 0.65;
const CITY_WEIGHT = 0.35;

function normalize(s: string): string {
  return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ").trim();
}

/** Plain Levenshtein edit distance. */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/** Levenshtein distance normalized into a 0..1 similarity ratio (1 = identical). */
export function levenshteinSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const distance = levenshteinDistance(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

/** Docket numbers on this courier's register are 10-15 digits. */
const DOCKET_RE = /\b(\d{10,15})\b/;

/**
 * Splits one parcel line into { city, receiverFirstName } by locating a
 * known firm name within it - everything before the firm name is the
 * destination city, everything after is the receiver's first name.
 * Returns null if no docket number or no matching firm name is found (the
 * line can't be reliably parsed, so it isn't a false match - it's simply
 * not a parcel line, or our firm-name list is stale).
 */
export function parseCourierPdfText(text: string, firmNames: string[]): ParsedParcel[] {
  const normalizedFirmNames = firmNames
    .map((f) => ({ raw: f, norm: normalize(f) }))
    .filter((f) => f.norm.length > 0)
    .sort((a, b) => b.norm.length - a.norm.length); // longest first, avoids a short firm name matching inside a longer one

  const parcels: ParsedParcel[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const docketMatch = DOCKET_RE.exec(line);
    if (!docketMatch) continue;
    const docketNo = docketMatch[1];

    const normLine = normalize(line);
    let firmMatch: { raw: string; norm: string } | null = null;
    let firmIndex = -1;
    for (const f of normalizedFirmNames) {
      const idx = normLine.indexOf(f.norm);
      if (idx !== -1) {
        firmMatch = f;
        firmIndex = idx;
        break;
      }
    }
    if (!firmMatch) continue; // can't split city vs receiver name without an anchor

    const beforeFirm = normLine.slice(0, firmIndex).replace(docketMatch[1], "").trim();
    const afterFirm = normLine.slice(firmIndex + firmMatch.norm.length).trim();

    // City is everything before the firm name once the docket digits are
    // stripped - kept whole (not truncated) since real destination cities
    // run several words, e.g. "SAYLA DIST - SU. NAGAR".
    const city = beforeFirm.trim();
    const receiverFullText = afterFirm.trim();
    const receiverFirstName = receiverFullText.split(" ").filter(Boolean)[0] || "";

    if (!city && !receiverFullText) continue;

    parcels.push({ docketNo, city, receiverFirstName, receiverFullText, firmName: firmMatch.raw, rawLine: line });
  }

  return parcels;
}

/**
 * Scores every Seller against a parsed parcel and returns the best match.
 * Each seller is scored three ways, and the highest wins, since we don't
 * know in advance which pattern a given row (or a given institute's data
 * entry) follows:
 *   1. first word of the receiver text vs buyerName - the documented case
 *      (buyerName holds just a first name, e.g. "UMANGBHAI")
 *   2. the full receiver text vs buyerName - in case some institute's
 *      buyerName was instead entered as a fuller name (e.g. "JAY SHAH"),
 *      which pattern (1) alone would under-score
 *   3. the full receiver text vs instituteName - covers "ITI SIHORI"-style
 *      rows that aren't a person's name at all
 */
export function matchParcelToInstitute(
  parcel: ParsedParcel,
  sellers: SellerForCourierMatch[]
): CourierMatchResult {
  let best: SellerForCourierMatch | null = null;
  let bestScore = 0;

  for (const seller of sellers) {
    const cityScore = levenshteinSimilarity(parcel.city, seller.place || "");

    const firstNameVsBuyer = levenshteinSimilarity(parcel.receiverFirstName, seller.buyerName || "");
    const fullTextVsBuyer = levenshteinSimilarity(parcel.receiverFullText, seller.buyerName || "");
    const fullTextVsInstitute = levenshteinSimilarity(parcel.receiverFullText, seller.instituteName || "");
    const bestNameScore = Math.max(firstNameVsBuyer, fullTextVsBuyer, fullTextVsInstitute);

    const score = NAME_WEIGHT * bestNameScore + CITY_WEIGHT * cityScore;
    if (score > bestScore) {
      bestScore = score;
      best = seller;
    }
  }

  return { seller: best, score: bestScore };
}

export interface ProcessedMatchedParcel {
  docketNo: string;
  instituteName: string;
  sellerId: string;
  city: string;
  receiverName: string;
  firmName: string;
  buyerName?: string;
  score: number;
  whatsappNumber?: string;
  whatsappStatus: "NOT_SENT" | "NO_NUMBER";
  emailDate: string; // YYYY-MM-DD - the courier email's own date, not the run date
}

export interface ProcessedReviewParcel {
  docketNo: string;
  parsedCity: string;
  parsedReceiverName: string;
  bestGuessInstituteName?: string;
  bestGuessSellerId?: string;
  score: number;
  reason: string;
  emailDate: string; // YYYY-MM-DD
}

export interface ProcessResult {
  matched: ProcessedMatchedParcel[];
  needsReview: ProcessedReviewParcel[];
  totalParcels: number;
}

// Single-document checkpoint tracking the newest courier email we've
// successfully fetched+parsed so far. Lets a run pick up "everything new
// since last time" instead of a fixed "yesterday" window - if the courier
// forgets to mail one day, the next run's window automatically widens to
// cover the gap instead of silently skipping it.
const FETCH_STATE_ID = "courier_checkpoint";

function toDateOnly(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** Fetch + parse + match, tied together. No WhatsApp send here (deferred). */
export async function processNewCourierParcels(db: any): Promise<ProcessResult> {
  const { fetchNewCourierPdfsSince } = await import("./gmailFetch");

  // Some courier PDFs (Type3-font glyph paths, pattern fills) make
  // pdfjs-dist reach for the browser-only DOMMatrix class even during plain
  // text extraction, which throws "DOMMatrix is not defined" outside a
  // browser (confirmed live: the 2026-08-21/08-23/08-27 automated runs all
  // failed with exactly this). pdfjs-dist has its own fallback for this -
  // it tries to load the optional `@napi-rs/canvas` native package - but
  // that check runs ONCE, at module-import time (node_utils.js), and only
  // if globalThis.DOMMatrix isn't already set; it never re-checks later.
  // @napi-rs/canvas's platform-specific prebuilt binary loads fine on this
  // Windows dev machine but fails on Vercel's Linux serverless runtime, so
  // this MUST install before "pdf-parse" (and therefore pdfjs-dist) is even
  // imported below - installing it after, like the first attempt at this
  // fix did, is too late: pdfjs-dist's own (failing, on Vercel) attempt has
  // already run and given up by then. See domMatrixPolyfill.ts for why.
  const { installDOMMatrixPolyfillIfMissing } = await import("./domMatrixPolyfill");
  installDOMMatrixPolyfillIfMissing();

  // pdf-parse v2 is a class-based API (PDFParse), not the old v1
  // require("pdf-parse")(buffer) function-call style. It's built on
  // pdfjs-dist, which normally resolves its worker script (pdf.worker.mjs)
  // relative to its own package location - a lookup that breaks once
  // Next.js/Turbopack bundles this into .next's chunk output (the worker
  // file doesn't get copied to the expected relative path). Pointing
  // GlobalWorkerOptions.workerSrc at the real on-disk file in node_modules
  // sidesteps the bundler entirely.
  const { PDFParse } = await import("pdf-parse");
  const path = await import("path");
  const { pathToFileURL } = await import("url");
  PDFParse.setWorker(pathToFileURL(path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs")).href);

  const fetchState = await db.collection("courier_fetch_state").findOne({ _id: FETCH_STATE_ID });
  const sinceDate: Date | null = fetchState?.lastProcessedEmailDate ? new Date(fetchState.lastProcessedEmailDate) : null;

  const pdfs = await fetchNewCourierPdfsSince(sinceDate);

  const [sellersRaw, companiesRaw] = await Promise.all([
    db.collection("sellers").find({}, { projection: { instituteName: 1, buyerName: 1, place: 1, whatsappNumber: 1 } }).toArray(),
    db.collection("companies").find({}, { projection: { firmName: 1 } }).toArray(),
  ]);
  const sellers: SellerForCourierMatch[] = sellersRaw.map((s: any) => ({
    _id: s._id,
    instituteName: s.instituteName,
    buyerName: s.buyerName,
    place: s.place,
    whatsappNumber: s.whatsappNumber,
  }));
  const firmNames = companiesRaw.map((c: any) => c.firmName).filter(Boolean);

  const matched: ProcessedMatchedParcel[] = [];
  const needsReview: ProcessedReviewParcel[] = [];
  let totalParcels = 0;

  let maxEmailDate: Date | null = null;

  for (const pdf of pdfs) {
    if (!maxEmailDate || pdf.emailDate > maxEmailDate) maxEmailDate = pdf.emailDate;
    const emailDate = toDateOnly(pdf.emailDate);

    const parser = new PDFParse({ data: pdf.buffer });
    let text: string;
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
    const parcels = parseCourierPdfText(text, firmNames);
    totalParcels += parcels.length;

    for (const parcel of parcels) {
      const { seller, score } = matchParcelToInstitute(parcel, sellers);

      if (seller && score >= MATCH_THRESHOLD) {
        const whatsappNumber = (seller.whatsappNumber || "").trim();
        matched.push({
          docketNo: parcel.docketNo,
          instituteName: seller.instituteName,
          sellerId: String(seller._id),
          city: parcel.city,
          receiverName: parcel.receiverFullText,
          firmName: parcel.firmName,
          buyerName: seller.buyerName || undefined,
          score,
          whatsappNumber: whatsappNumber || undefined,
          // NOT_SENT (not PENDING) - sending is a manual, per-parcel choice
          // made on the Courier Tracking page, never automatic at match time.
          whatsappStatus: whatsappNumber ? "NOT_SENT" : "NO_NUMBER",
          emailDate,
        });
      } else {
        needsReview.push({
          docketNo: parcel.docketNo,
          parsedCity: parcel.city,
          parsedReceiverName: parcel.receiverFullText,
          bestGuessInstituteName: seller?.instituteName,
          bestGuessSellerId: seller ? String(seller._id) : undefined,
          score,
          reason: seller ? `Best match "${seller.instituteName}" scored ${score.toFixed(2)}, below the ${MATCH_THRESHOLD} threshold.` : "No institute matched at all.",
          emailDate,
        });
      }
    }
  }

  // Only advance the checkpoint once everything above has succeeded - if
  // parsing/matching had thrown partway through, this line is never reached,
  // so a retried run naturally re-covers the same window instead of skipping
  // whatever wasn't processed.
  if (maxEmailDate) {
    await db.collection("courier_fetch_state").updateOne(
      { _id: FETCH_STATE_ID },
      { $set: { lastProcessedEmailDate: maxEmailDate } },
      { upsert: true }
    );
  }

  return { matched, needsReview, totalParcels };
}
