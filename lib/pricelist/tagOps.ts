import type { Db } from "mongodb";
import { normalizeName } from "./normalize";

// Moves every link of tag `fromKey` onto `toName` (renamed or merged target). Links that would
// duplicate an existing (tag_key, sku_key) are dropped instead of violating the unique index.
export async function moveTag(db: Db, fromKey: string, toName: string) {
  const toKey = normalizeName(toName);
  if (!toKey) throw new Error("New tag name is required");
  const col = db.collection("pricelist_tags");
  const targetExisting: any = toKey !== fromKey ? await col.findOne({ tag_key: toKey }) : null;
  const finalName = targetExisting?.tag_name || toName.trim();

  if (toKey === fromKey) {
    await col.updateMany({ tag_key: fromKey }, { $set: { tag_name: finalName } });
    return { moved: 0, toKey };
  }
  const links = await col.find({ tag_key: fromKey }).toArray();
  const targetSkus = new Set((await col.find({ tag_key: toKey }).project({ sku_key: 1 }).toArray()).map((d: any) => d.sku_key));
  const dupIds = links.filter((l: any) => targetSkus.has(l.sku_key)).map((l: any) => l._id);
  if (dupIds.length) await col.deleteMany({ _id: { $in: dupIds } });
  const res = await col.updateMany({ tag_key: fromKey }, { $set: { tag_key: toKey, tag_name: finalName } });
  return { moved: res.modifiedCount, toKey };
}
