// @/lib/ddMatching.ts
// DD refund-matching: scores account_statements transaction lines against a
// returned_cancelled DDEntry (DD number / payee name / credited amount).
// Deliberately independent of lib/reconciliation/matchingEngine.ts (per the
// DD module spec) so the two never interfere with each other, even though
// the UI pattern (score-ranked candidates) looks the same.
import type { Transaction } from "@/app/api/account-statements/route";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const normalize = (text?: string) =>
  (text || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Same fingerprint formula as txnKey() in app/api/account-statements/route.ts,
// duplicated locally (not imported) so this module has no dependency on that
// route file's export surface.
export const computeTxnKey = (t: Transaction) =>
  `${t.date}|${t.description.trim().toLowerCase()}|${round2(t.debit)}|${round2(t.credit)}|${round2(t.balance)}`;

export function parseTxnDate(dateStr: string): Date {
  const s = (dateStr || "").trim();
  let m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/); // YYYY-MM-DD
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/); // DD-MM-YYYY
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/); // DD-MM-YY
  if (m) return new Date(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return new Date();
}

export interface DDMatchCandidate {
  txnKey: string;
  date: string;
  description: string;
  credit: number;
  balance: number;
  score: number;
  reasons: string[];
}

interface ScorableDD {
  ddNumber: string;
  payeeName: string;
  amount: number;
  cancellationCharge?: number;
}

// 0-100 score: DD number substring match (strongest signal), payee name
// token overlap, and amount closeness (full DD amount, or DD amount minus
// cancellation charge — banks sometimes net the charge off before crediting).
export function scoreTransaction(txn: Transaction, dd: ScorableDD): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const desc = normalize(txn.description);
  const ddNum = normalize(dd.ddNumber);
  const payee = normalize(dd.payeeName);

  if (ddNum && ddNum.length >= 3 && desc.includes(ddNum)) {
    score += 50;
    reasons.push("DD number found in narration");
  }

  const payeeTokens = payee.split(" ").filter((t) => t.length >= 3);
  const matchedTokens = payeeTokens.filter((t) => desc.includes(t));
  if (payeeTokens.length > 0 && matchedTokens.length > 0) {
    score += Math.min(30, (matchedTokens.length / payeeTokens.length) * 30);
    reasons.push(`Payee name match: ${matchedTokens.join(", ")}`);
  }

  const netAfterCharge = dd.amount - (dd.cancellationCharge || 0);
  if (Math.abs(txn.credit - dd.amount) < 1) {
    score += 20;
    reasons.push("Credit = full DD amount");
  } else if (dd.cancellationCharge && Math.abs(txn.credit - netAfterCharge) < 1) {
    score += 20;
    reasons.push("Credit = DD amount minus cancellation charge");
  } else if (dd.amount > 0) {
    const diffPct = Math.abs(txn.credit - dd.amount) / dd.amount;
    if (diffPct < 0.05) {
      score += 8;
      reasons.push("Credit amount close to DD amount");
    }
  }

  return { score: Math.round(Math.min(100, score)), reasons };
}

export function findMatchCandidates(
  transactions: Transaction[],
  dd: ScorableDD,
  excludeTxnKeys: Set<string>,
  limit = 15
): DDMatchCandidate[] {
  const candidates: DDMatchCandidate[] = [];
  for (const t of transactions) {
    if (!t.credit || t.credit <= 0) continue;
    const txnKey = computeTxnKey(t);
    if (excludeTxnKeys.has(txnKey)) continue;
    const { score, reasons } = scoreTransaction(t, dd);
    if (score <= 0) continue;
    candidates.push({ txnKey, date: t.date, description: t.description, credit: t.credit, balance: t.balance, score, reasons });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, limit);
}
