import MatchFeedbackLog from "@/models/MatchFeedbackLog";
import { extractKeywords, DeductionType } from "./matchingEngine";

// These hooks operate on a live (non-lean) Mongoose Seller document so callers
// can `.save()` it once after learning has been applied.

interface FeedbackContext {
  firmId?: string;
  firmCode?: string;
  transactionDescription: string;
  billAmount?: number;
  creditedAmount?: number;
  deductionAmount?: number;
  userId?: string;
  userName?: string;
}

/** HOOK 1 — an unmatched transaction was manually linked to an institute. */
export async function learnFromManualMatch(
  seller: any,
  ctx: FeedbackContext
): Promise<string[]> {
  const candidates = extractKeywords(ctx.transactionDescription);
  const existingKeywords = new Set(
    (seller.statementDescriptionName || []).map((k: string) => k.trim().toLowerCase())
  );

  let added = false;
  for (const keyword of candidates) {
    if (existingKeywords.has(keyword.toLowerCase())) continue;
    seller.statementDescriptionName = seller.statementDescriptionName || [];
    seller.statementDescriptionName.push(keyword);
    seller.aliasMeta = seller.aliasMeta || [];
    seller.aliasMeta.push({ keyword, confidence: 1, lastUsed: new Date(), source: "learned" });
    added = true;
  }
  if (added) await seller.save();

  await MatchFeedbackLog.create({
    firmId: ctx.firmId,
    firmCode: ctx.firmCode,
    instituteName: seller.instituteName,
    sellerId: seller._id,
    transactionDescription: ctx.transactionDescription,
    billAmount: ctx.billAmount,
    creditedAmount: ctx.creditedAmount,
    action: "manual_match",
    userId: ctx.userId,
    userName: ctx.userName,
  });

  return candidates;
}

/** HOOK 2 — engine's suggestion was confirmed as-is; reinforces the keyword + deduction history. */
export async function reinforceOnConfirm(
  seller: any,
  ctx: FeedbackContext & { matchedKeyword?: string; deductionType?: DeductionType | null }
): Promise<void> {
  if (ctx.matchedKeyword) {
    seller.aliasMeta = seller.aliasMeta || [];
    const alias = seller.aliasMeta.find(
      (a: any) => (a.keyword || "").trim().toLowerCase() === ctx.matchedKeyword!.trim().toLowerCase()
    );
    if (alias) {
      alias.confidence += 1;
      alias.lastUsed = new Date();
    } else {
      // First time this manual-seed keyword led to a real confirmed match
      seller.aliasMeta.push({
        keyword: ctx.matchedKeyword,
        confidence: 2,
        lastUsed: new Date(),
        source: "manual_seed",
      });
    }
  }

  if (ctx.deductionType) {
    updateDeductionProfile(seller, ctx.deductionType, ctx.deductionAmount || 0, ctx.billAmount || 0);
  }

  await seller.save();

  await MatchFeedbackLog.create({
    firmId: ctx.firmId,
    firmCode: ctx.firmCode,
    instituteName: seller.instituteName,
    sellerId: seller._id,
    transactionDescription: ctx.transactionDescription,
    billAmount: ctx.billAmount,
    creditedAmount: ctx.creditedAmount,
    deductionAmount: ctx.deductionAmount,
    suggestedType: ctx.deductionType,
    correctedType: ctx.deductionType,
    action: "confirm",
    userId: ctx.userId,
    userName: ctx.userName,
  });
}

/** HOOK 3 — engine's suggested deduction type was wrong; user corrected it on Confirm. */
export async function learnFromDeductionCorrection(
  seller: any,
  ctx: FeedbackContext & { suggestedType?: string | null; correctedType: DeductionType }
): Promise<void> {
  updateDeductionProfile(seller, ctx.correctedType, ctx.deductionAmount || 0, ctx.billAmount || 0);
  await seller.save();

  await MatchFeedbackLog.create({
    firmId: ctx.firmId,
    firmCode: ctx.firmCode,
    instituteName: seller.instituteName,
    sellerId: seller._id,
    transactionDescription: ctx.transactionDescription,
    billAmount: ctx.billAmount,
    creditedAmount: ctx.creditedAmount,
    deductionAmount: ctx.deductionAmount,
    suggestedType: ctx.suggestedType,
    correctedType: ctx.correctedType,
    action: "edit",
    userId: ctx.userId,
    userName: ctx.userName,
  });
}

/** HOOK 4 — engine suggested the wrong institute/bill; user rejected it. */
export async function learnFromRejection(
  seller: any,
  ctx: FeedbackContext & { matchedKeyword?: string }
): Promise<void> {
  if (ctx.matchedKeyword) {
    const keyword = ctx.matchedKeyword.trim();
    seller.negativeKeywords = seller.negativeKeywords || [];
    const existing = seller.negativeKeywords.find(
      (n: any) => (n.keyword || "").trim().toLowerCase() === keyword.toLowerCase()
    );
    if (existing) {
      existing.rejectedCount += 1;
    } else {
      seller.negativeKeywords.push({ keyword, rejectedCount: 1 });
    }

    seller.aliasMeta = seller.aliasMeta || [];
    const alias = seller.aliasMeta.find(
      (a: any) => (a.keyword || "").trim().toLowerCase() === keyword.toLowerCase()
    );
    if (alias) alias.confidence = Math.max(0, alias.confidence - 2);
  }

  await seller.save();

  await MatchFeedbackLog.create({
    firmId: ctx.firmId,
    firmCode: ctx.firmCode,
    instituteName: seller.instituteName,
    sellerId: seller._id,
    transactionDescription: ctx.transactionDescription,
    action: "reject",
    userId: ctx.userId,
    userName: ctx.userName,
  });
}

/** Updates TDS/TDS+GST/Kasar counters and the Kasar min-max range for an institute. */
export function updateDeductionProfile(
  seller: any,
  type: string,
  deductionAmount: number,
  billAmount: number
): void {
  if (!seller.deductionProfile) {
    seller.deductionProfile = {
      tdsOnlyCount: 0,
      tdsGstCount: 0,
      kasarCount: 0,
      kasarRange: { min: null, max: null },
      lastConfirmedType: null,
    };
  }
  const profile = seller.deductionProfile;

  if (type === "TDS") {
    profile.tdsOnlyCount = (profile.tdsOnlyCount || 0) + 1;
  } else if (type === "TDS+GST") {
    profile.tdsGstCount = (profile.tdsGstCount || 0) + 1;
  } else if (type === "Kasar") {
    profile.kasarCount = (profile.kasarCount || 0) + 1;
    const pct = billAmount ? (deductionAmount / billAmount) * 100 : null;
    if (pct !== null) {
      profile.kasarRange = profile.kasarRange || { min: null, max: null };
      profile.kasarRange.min =
        profile.kasarRange.min === null || profile.kasarRange.min === undefined
          ? pct
          : Math.min(profile.kasarRange.min, pct);
      profile.kasarRange.max =
        profile.kasarRange.max === null || profile.kasarRange.max === undefined
          ? pct
          : Math.max(profile.kasarRange.max, pct);
    }
  }

  profile.lastConfirmedType = type;
}
