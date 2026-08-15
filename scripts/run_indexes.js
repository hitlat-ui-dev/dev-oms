const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

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
console.log('Connecting to MongoDB Atlas...');

async function run() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log('Connected to MongoDB successfully!');
    const db = client.db();

    console.log('\nCreating indexes for performance optimization...');

    // 1. sellerorders
    console.log('Building indexes for sellerorders...');
    const sellerorders = db.collection('sellerorders');
    await sellerorders.createIndex({ firmCode: 1, createdAt: -1 });
    await sellerorders.createIndex({ sellerId: 1, createdAt: -1 });
    await sellerorders.createIndex({ sku: 1, status: 1 });
    await sellerorders.createIndex({ paymentStatus: 1, firmCode: 1 });
    await sellerorders.createIndex({ createdAt: -1 });

    // 2. Received purchase
    console.log('Building indexes for Received purchase...');
    const receivedPurchase = db.collection('Received purchase');
    await receivedPurchase.createIndex({ sku: 1 });
    await receivedPurchase.createIndex({ receivedAt: -1 });

    // 3. Order place Purchase
    console.log('Building indexes for Order place Purchase...');
    const orderPlacePurchase = db.collection('Order place Purchase');
    await orderPlacePurchase.createIndex({ sku: 1 });
    await orderPlacePurchase.createIndex({ orderNo: 1 });

    // 4. account_statements
    console.log('Building indexes for account_statements...');
    const accountStatements = db.collection('account_statements');
    await accountStatements.createIndex({ firmCode: 1, date: -1 });
    await accountStatements.createIndex({ processed: 1 });

    // 5. bank_reconciliation_matches
    console.log('Building indexes for bank_reconciliation_matches...');
    const matches = db.collection('bank_reconciliation_matches');
    await matches.createIndex({ firmCode: 1, matchStatus: 1 });
    await matches.createIndex({ sellerId: 1 });

    // 6. gem_catalogue_links
    console.log('Building indexes for gem_catalogue_links...');
    const gemLinks = db.collection('gem_catalogue_links');
    await gemLinks.createIndex({ firmCode: 1 });
    await gemLinks.createIndex({ masterItemId: 1 });

    // 7. sellers
    console.log('Building indexes for sellers...');
    const sellers = db.collection('sellers');
    await sellers.createIndex({ instituteName: 1 });
    await sellers.createIndex({ createdAt: -1 });

    // 8. items
    console.log('Building indexes for items...');
    const items = db.collection('items');
    await items.createIndex({ category: 1 });

    console.log('\n✅ ALL INDEXES CREATED SUCCESSFULLY ON MONGODB ATLAS!');
  } catch (err) {
    console.error('Error creating indexes:', err);
  } finally {
    await client.close();
  }
}

run();
