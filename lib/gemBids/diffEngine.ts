import { DATA_FIELD_KEYS } from "./columns";

/** Collapses cosmetic whitespace differences so they never register as a change. */
export function normalizeForCompare(v: unknown): string {
  return (v == null ? "" : String(v)).replace(/\s+/g, " ").trim();
}

export interface ChangedField {
  field: string;
  oldValue: string;
  newValue: string;
}

/**
 * Field-by-field diff between a stored bid and a freshly fetched row for the same Bid No.
 * A blank field becoming filled (or vice versa) counts as a change, same as any other value change.
 */
export function diffBidFields(existing: Record<string, any>, incoming: Record<string, any>): ChangedField[] {
  const changed: ChangedField[] = [];
  for (const key of DATA_FIELD_KEYS) {
    const oldNormalized = normalizeForCompare(existing?.[key]);
    const newNormalized = normalizeForCompare(incoming?.[key]);
    if (oldNormalized !== newNormalized) {
      changed.push({ field: key, oldValue: existing?.[key] ?? "", newValue: incoming?.[key] ?? "" });
    }
  }
  return changed;
}
