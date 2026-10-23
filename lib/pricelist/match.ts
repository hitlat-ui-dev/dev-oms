import { normalizeName } from "./normalize";

// Bid item name <-> tag name matching beyond the exact normalized key.
//  1. compactKey: normalized name with every non-alphanumeric (spaces, dots, slashes...) removed, so
//     "PVC Elbow 3/4" == "pvcelbow 3.4" counts as the SAME name (auto-match).
//  2. similarity: 0..1 score used only for "Suggested" hints (never auto-links).

export const compactKey = (s: unknown) => normalizeName(s).replace(/[^a-z0-9]/g, "");

const bigrams = (s: string) => {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
};

// Sorensen-Dice on character bigrams of the compact strings: robust to spacing/dots/word order slips.
function dice(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

const tokens = (s: string) => normalizeName(s).split(" ").filter(Boolean);
const numberTokens = (s: string) => (normalizeName(s).match(/\d+(?:\.\d+)?/g) || []).sort().join(",");

export function similarity(a: string, b: string): number {
  const ca = compactKey(a);
  const cb = compactKey(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;

  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  let common = 0;
  ta.forEach((t) => tb.has(t) && common++);
  const tokenScore = common / Math.max(ta.size, tb.size, 1);

  let score = Math.max(dice(ca, cb), tokenScore);
  // "500 g" vs "250 g" are different items even if the words look alike
  if (numberTokens(a) !== numberTokens(b)) score *= 0.6;
  return Math.round(score * 1000) / 1000;
}

export const SUGGEST_MIN_SCORE = 0.7;
