export function normalizeMatchText(s: string) {
  return s.toString().trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
}

export function tokenizeMatchText(s: string) {
  return normalizeMatchText(s).split(/[^a-z0-9]+/).filter(Boolean);
}

// Similarity of two token sets: word overlap (Jaccard), heavily penalized if numeric
// tokens (sizes like 40, 38, 6) don't agree — a "40 MM" item must not match a "38 MM" one.
export function scoreTokenSimilarity(tokensA: string[], tokensB: string[]) {
  if (tokensA.length === 0 || tokensB.length === 0) return { score: 0, overlap: 0 };
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let overlap = 0;
  setA.forEach((t) => { if (setB.has(t)) overlap++; });
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = overlap / union;

  const numsA = tokensA.filter((t) => /\d/.test(t));
  const numsB = tokensB.filter((t) => /\d/.test(t));
  let numericPenalty = 0;
  if (numsA.length > 0 || numsB.length > 0) {
    const numSetB = new Set(numsB);
    const numOverlap = numsA.filter((n) => numSetB.has(n)).length;
    const numUnion = new Set([...numsA, ...numsB]).size;
    const numericMatch = numUnion > 0 ? numOverlap / numUnion : 1;
    numericPenalty = (1 - numericMatch) * 0.5;
  }

  return { score: Math.max(0, jaccard - numericPenalty), overlap };
}

export function formatDate(dateInput: Date | string) {
  if (!dateInput) return "—";
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const month = months[d.getMonth()].toLowerCase();
  const year = String(d.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}
