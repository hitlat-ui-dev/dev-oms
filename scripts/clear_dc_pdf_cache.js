// scripts/clear_dc_pdf_cache.js
//
// Drops the cached-PDF pointer (r2Key) from every stored Delivery Challan, so
// the next download re-renders it from the challan document instead of serving
// the copy that was uploaded to R2 when it was issued.
//
// Why this exists: a challan's PDF is rendered once at finalize and stored in
// R2, and /api/delivery-challans/[id]/pdf serves that stored copy whenever
// r2Key is set. That is the right behaviour day to day, but it also means a
// change to the RENDERER (layout, type scale, field order) never reaches a
// challan that was already issued. Clearing the pointer is how an existing
// challan picks up a renderer change.
//
// It is deliberately non-destructive:
//   - only r2Key is touched; no challan content, number or status changes
//   - the R2 objects themselves are left alone (a later regenerate overwrites
//     them at the same key, so nothing is orphaned permanently)
//   - re-running it is harmless
//
// Usage:  node scripts/clear_dc_pdf_cache.js
//         node scripts/clear_dc_pdf_cache.js --dry-run

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const DRY_RUN = process.argv.includes('--dry-run');

const envPath = path.join(__dirname, '..', '.env.local');
let envContent = '';
try {
  envContent = fs.readFileSync(envPath, 'utf8');
} catch (e) {
  console.error('Could not read .env.local:', e.message);
  process.exit(1);
}

const match = envContent.match(/MONGODB_URI=["']?([^"'\r\n]+)["']?/);
if (!match || !match[1]) {
  console.error('MONGODB_URI not found in .env.local');
  process.exit(1);
}

const uri = match[1];

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log('Connected to MongoDB.');
    const db = client.db();
    const challans = db.collection('delivery_challans');

    const total = await challans.countDocuments({});
    const cached = await challans.countDocuments({ r2Key: { $nin: ['', null] } });

    console.log(`\n${total} delivery challan(s) stored, ${cached} holding a cached PDF.`);

    if (cached === 0) {
      console.log('Nothing to clear - every challan already re-renders on download.');
      return;
    }

    const sample = await challans
      .find({ r2Key: { $nin: ['', null] } }, { projection: { dcNumberFormatted: 1, firmCode: 1, r2Key: 1 } })
      .limit(5)
      .toArray();
    console.log('\nFor example:');
    for (const c of sample) {
      console.log(`  ${(c.dcNumberFormatted || '(draft)').padEnd(11)} ${c.firmCode || '(no firm)'}  ->  ${c.r2Key}`);
    }

    if (DRY_RUN) {
      console.log(`\n--dry-run: would clear r2Key on ${cached} challan(s). Nothing written.`);
      return;
    }

    const result = await challans.updateMany(
      { r2Key: { $nin: ['', null] } },
      { $set: { r2Key: '', updatedAt: new Date() } }
    );

    console.log(`\nCleared the cached-PDF pointer on ${result.modifiedCount} challan(s).`);
    console.log('Each will re-render from its stored content the next time it is downloaded.');
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.close();
    console.log('Connection closed.');
  }
}

run();
