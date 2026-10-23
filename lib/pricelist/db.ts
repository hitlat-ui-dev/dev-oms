import clientPromise from "@/lib/mongodb";
import { PRICELIST_DB } from "./normalize";

let indexesReady: Promise<void> | null = null;

// Opens the DB and (once per server process) makes sure the pricelist indexes exist.
export async function getPricelistDb() {
  const client = await clientPromise;
  const db = client.db(PRICELIST_DB);
  if (!indexesReady) {
    indexesReady = (async () => {
      await db.collection("pricelist_items").createIndex({ sku_key: 1 }, { unique: true });
      await db.collection("pricelist_items").createIndex({ is_active: 1, brand: 1, category: 1 });
      await db.collection("pricelist_items").createIndex({ supplier_code: 1, is_active: 1 });
      await db.collection("pricelists").createIndex({ supplier_code: 1, status: 1 });
      await db.collection("pricelist_tags").createIndex({ tag_key: 1, sku_key: 1 }, { unique: true });
      await db.collection("pricelist_tags").createIndex({ tag_key: 1 });
      await db.collection("pricelist_tags").createIndex({ sku_key: 1 });
      await db.collection("received_purchase_tags").createIndex({ tag_key: 1, sku: 1 }, { unique: true });
      await db.collection("received_purchase_tags").createIndex({ sku: 1 });
      await db.collection("pricelist_staging").createIndex({ created_at: 1 }, { expireAfterSeconds: 7200 });
    })().catch((e) => {
      indexesReady = null;
      throw e;
    });
  }
  await indexesReady;
  return { client, db };
}
