// lib/dcNumbering.ts
//
// Per-scope, per-financial-year Delivery Challan numbering. Same shape as the
// Billing module's invoice counter (see app/api/bills/generate/route.ts) -
// atomic $inc against the scope's own counter, with a MANUAL entry allowed to
// jump ahead and drag the counter with it so the next AUTO number always
// continues past it.
//
// A "scope" is either a firm or no firm at all, since picking a firm is
// optional on a challan:
//
//   firm chosen  -> companies.dcNumbering.history  (that firm's own series)
//   no firm      -> dc_counters/__NO_FIRM__.history (one shared series)
//
// Firm counters live on the company document rather than in dc_counters
// because that is where they already are - moving them would mean migrating
// live, already-issued numbers for no gain. Both paths run through the same
// generic code below, keyed by `counterTarget`.
//
// The DC counter is separate from invoiceNumbering in every case: a challan is
// not an invoice, and the two series must never advance each other.
//
// Printed format is "SequenceNo/FY" with the sequence zero-padded to two
// digits and the FY in short form - e.g. 1 in FY 2026-27 prints as "01/26-27".

const NO_FIRM_COUNTER_ID = "__NO_FIRM__";

/** "2026-27" for any date on/after 1 April 2026, otherwise the prior FY. */
export function getFinancialYear(date: Date = new Date()): string {
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

/** "2026-27" -> "26-27", the short form printed on the challan. */
export function shortFinancialYear(fy: string): string {
  return fy.length > 5 ? fy.slice(2) : fy;
}

/** 1, "26-27" -> "01/26-27". Sequences past 99 simply widen ("100/26-27"). */
export function formatDcNumber(sequence: number, shortFy: string): string {
  return `${String(sequence).padStart(2, "0")}/${shortFy}`;
}

/** Where this scope's counter lives, and whether its holding document may be
 * created on demand. A company document always exists already (it was looked
 * up before we got here); the shared no-firm counter may not. */
function counterTarget(firmCode: string | null | undefined) {
  const code = (firmCode || "").trim();
  return code
    ? { collection: "companies", filter: { firmCode: code } as Record<string, any>, field: "dcNumbering.history", createIfMissing: false }
    : { collection: "dc_counters", filter: { _id: NO_FIRM_COUNTER_ID } as Record<string, any>, field: "history", createIfMissing: true };
}

function entryFor(doc: any, field: string, fy: string) {
  const history = field.split(".").reduce((node: any, key) => node?.[key], doc);
  return Array.isArray(history) ? history.find((h: any) => h.fy === fy) : undefined;
}

/** Highest number already issued in this scope + FY (0 if none). Reads only -
 * it never consumes a number, so it is safe for the screen's header preview. */
export async function readLastDcNumber(db: any, firmCode: string | null | undefined, fy: string): Promise<number> {
  const target = counterTarget(firmCode);
  const doc = await db.collection(target.collection).findOne(target.filter);
  return entryFor(doc, target.field, fy)?.lastNumber || 0;
}

/** Atomically advances (or creates) this scope's counter for `fy` and returns
 * the sequence number claimed. */
export async function claimNextDcNumber(
  db: any,
  firmCode: string | null | undefined,
  fy: string,
  attempt = 0
): Promise<number> {
  const target = counterTarget(firmCode);

  const incremented = await db.collection(target.collection).findOneAndUpdate(
    { ...target.filter, [`${target.field}.fy`]: fy },
    { $inc: { [`${target.field}.$.lastNumber`]: 1 } },
    { returnDocument: "after" }
  );
  const doc = incremented?.value || incremented;
  const entry = entryFor(doc, target.field, fy);
  if (entry) return entry.lastNumber;

  // No entry for this FY yet - create it starting at 1. The filter re-checks
  // that it is still absent, so two challans finalized at the same instant
  // can't both create a "1": the loser matches nothing and retries through the
  // $inc path above.
  const created = await db.collection(target.collection).updateOne(
    { ...target.filter, [`${target.field}.fy`]: { $ne: fy } },
    { $push: { [target.field]: { fy, lastNumber: 1 } } } as any,
    target.createIfMissing ? { upsert: true } : {}
  );
  if (created.modifiedCount === 1 || created.upsertedCount === 1) return 1;

  // Lost the race. Retry, but never spin: a handful of contenders is realistic,
  // an endless loop is a bug.
  if (attempt >= 5) {
    throw new Error("Could not claim a DC number - too many challans were finalized at once. Try again.");
  }
  return claimNextDcNumber(db, firmCode, fy, attempt + 1);
}

/** Validates a manually-entered sequence number and advances the counter past
 * it, so the next AUTO challan continues from there. Throws if the number is
 * already used or behind the counter. */
export async function claimManualDcNumber(
  db: any,
  firmCode: string | null | undefined,
  fy: string,
  manualNumber: number
): Promise<number> {
  if (!Number.isFinite(manualNumber) || manualNumber < 1 || !Number.isInteger(manualNumber)) {
    throw new Error("Manual DC number must be a whole number of 1 or more.");
  }

  const target = counterTarget(firmCode);
  const currentLast = await readLastDcNumber(db, firmCode, fy);

  if (manualNumber <= currentLast) {
    const scope = (firmCode || "").trim() ? `firm ${firmCode}` : "the no-firm series";
    throw new Error(
      `DC number ${manualNumber} is already used or behind ${scope}'s counter for FY ${fy} (last used: ${currentLast}).`
    );
  }

  const advanced = await db.collection(target.collection).updateOne(
    { ...target.filter, [`${target.field}.fy`]: fy },
    { $set: { [`${target.field}.$.lastNumber`]: manualNumber } }
  );
  if (advanced.matchedCount === 0) {
    await db.collection(target.collection).updateOne(
      { ...target.filter, [`${target.field}.fy`]: { $ne: fy } },
      { $push: { [target.field]: { fy, lastNumber: manualNumber } } } as any,
      target.createIfMissing ? { upsert: true } : {}
    );
  }

  return manualNumber;
}
