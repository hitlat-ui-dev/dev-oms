// lib/dcNumbering.ts
//
// Per-firm, per-financial-year Delivery Challan numbering. Same shape as the
// Billing module's invoice counter (companies.invoiceNumbering, see
// app/api/bills/generate/route.ts) - atomic $inc against the firm's own
// counter, with a MANUAL entry allowed to jump ahead and drag the counter with
// it so the next AUTO number always continues past it.
//
// It runs on its OWN counter (companies.dcNumbering) rather than sharing the
// invoice one: a challan is not an invoice, and the two series must never
// advance each other.
//
// Printed format is "SequenceNo/FY" with the sequence zero-padded to two
// digits and the FY in short form - e.g. 1 in FY 2026-27 prints as "01/26-27".

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

/** Reads (without consuming) the number the next AUTO challan would get, for
 * the header preview on the entry screen. */
export function peekNextDcNumber(company: any, fy: string): number {
  const entry = company?.dcNumbering?.history?.find((h: any) => h.fy === fy);
  return (entry?.lastNumber || 0) + 1;
}

/** Atomically advances (or creates) this firm's DC counter for `fy` and
 * returns the sequence number claimed. */
export async function claimNextDcNumber(db: any, firmCode: string, fy: string): Promise<number> {
  const incremented = await db.collection("companies").findOneAndUpdate(
    { firmCode, "dcNumbering.history.fy": fy },
    { $inc: { "dcNumbering.history.$.lastNumber": 1 } },
    { returnDocument: "after" }
  );
  const doc = incremented?.value || incremented;
  if (doc?.dcNumbering?.history) {
    const entry = doc.dcNumbering.history.find((h: any) => h.fy === fy);
    if (entry) return entry.lastNumber;
  }

  // No history entry for this FY yet - create it starting at 1. The filter
  // re-checks that the entry is still absent, so two challans finalized at the
  // same instant can't both create a "1": the loser's update matches nothing
  // and it retries through the $inc path above.
  const created = await db.collection("companies").updateOne(
    { firmCode, "dcNumbering.history.fy": { $ne: fy } },
    { $push: { "dcNumbering.history": { fy, lastNumber: 1 } } as any }
  );
  if (created.modifiedCount === 1) return 1;

  return claimNextDcNumber(db, firmCode, fy);
}

/** Validates a manually-entered sequence number and advances the counter past
 * it, so the next AUTO challan continues from there. Throws if the number is
 * already used or behind the counter. */
export async function claimManualDcNumber(
  db: any,
  firmCode: string,
  fy: string,
  manualNumber: number
): Promise<number> {
  if (!Number.isFinite(manualNumber) || manualNumber < 1 || !Number.isInteger(manualNumber)) {
    throw new Error("Manual DC number must be a whole number of 1 or more.");
  }

  const company = await db.collection("companies").findOne({ firmCode });
  const entry = company?.dcNumbering?.history?.find((h: any) => h.fy === fy);
  const currentLast = entry?.lastNumber || 0;

  if (manualNumber <= currentLast) {
    throw new Error(
      `DC number ${manualNumber} is already used or behind this firm's counter for FY ${fy} (last used: ${currentLast}).`
    );
  }

  if (entry) {
    await db.collection("companies").updateOne(
      { firmCode, "dcNumbering.history.fy": fy },
      { $set: { "dcNumbering.history.$.lastNumber": manualNumber } }
    );
  } else {
    await db.collection("companies").updateOne(
      { firmCode },
      { $push: { "dcNumbering.history": { fy, lastNumber: manualNumber } } as any }
    );
  }

  return manualNumber;
}
