/**
 * Seed Dragon Store products into DynamoDB from CSV data.
 * Updates existing products with missing attributes and adds new ones.
 *
 * Usage: node scripts/seed-dragon-store-products.js
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const fs = require('fs');
const path = require('path');

const TABLE_NAME = 'dev-vyapargyan-main';
const REGION = 'ap-south-1';
const SELLER_ID = 'seller-dragon-001';

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

// Products from dragon-store-inventory.csv
const CSV_PRODUCTS = [
  { id: 'prod-dragon-001', name: 'Basmati Rice 5kg', category: 'Grains & Pulses', stock: 50, price: 450, description: 'Premium quality basmati rice' },
  { id: 'prod-dragon-002', name: 'Tata Tea Gold 1kg', category: 'Beverages', stock: 30, price: 420, description: 'Premium tea leaves' },
  { id: 'prod-dragon-003', name: 'Fortune Sunflower Oil 1L', category: 'Oils & Fats', stock: 40, price: 180, description: 'Refined sunflower oil' },
  { id: 'prod-dragon-004', name: 'Amul Butter 500g', category: 'Dairy', stock: 45, price: 280, description: 'Fresh salted butter' },
  { id: 'prod-dragon-005', name: 'Britannia Good Day 200g', category: 'Bakery', stock: 60, price: 40, description: 'Butter cookies' },
  { id: 'prod-dragon-006', name: 'Maggi Noodles 12 Pack', category: 'Instant Food', stock: 80, price: 144, description: 'Masala noodles pack' },
  { id: 'prod-dragon-007', name: 'Tata Salt 1kg', category: 'Spices & Condiments', stock: 100, price: 22, description: 'Iodized salt' },
  { id: 'prod-dragon-008', name: 'Red Label Tea 500g', category: 'Beverages', stock: 35, price: 210, description: 'Strong tea blend' },
  { id: 'prod-dragon-009', name: 'Aashirvaad Atta 10kg', category: 'Grains & Pulses', stock: 45, price: 380, description: 'Whole wheat flour' },
  { id: 'prod-dragon-010', name: 'Colgate Toothpaste 200g', category: 'Personal Care', stock: 50, price: 120, description: 'Dental care' },
];

// Additional demo products
const DEMO_PRODUCTS = [
  { id: 'prod-dragon-011', name: 'Surf Excel 1kg', category: 'Home & Kitchen', stock: 30, price: 199, description: 'Detergent powder' },
  { id: 'prod-dragon-012', name: 'Nivea Body Lotion 200ml', category: 'Beauty & Personal Care', stock: 18, price: 245, description: 'Moisturizing body lotion' },
  { id: 'prod-dragon-013', name: 'Vim Dishwash Bar', category: 'Home & Kitchen', stock: 200, price: 35, description: 'Dishwashing bar' },
  { id: 'prod-dragon-014', name: 'USB-C Cable 1m', category: 'Electronics', stock: 120, price: 149, description: 'Fast charging cable' },
  { id: 'prod-dragon-015', name: 'Phone Case iPhone 15', category: 'Electronics', stock: 6, price: 299, description: 'Protective phone case' },
];

const ALL_PRODUCTS = [...CSV_PRODUCTS, ...DEMO_PRODUCTS];

async function seedProducts() {
  console.log(`Seeding ${ALL_PRODUCTS.length} products for ${SELLER_ID}...`);
  const now = new Date().toISOString();

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const p of ALL_PRODUCTS) {
    const pk = `SELLER#${SELLER_ID}`;
    const sk = `PRODUCT#${p.id}`;

    try {
      // Use PutCommand with all required attributes
      await docClient.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: pk,
          SK: sk,
          productId: p.id,
          name: p.name,
          productName: p.name,  // Some code uses 'productName', some uses 'name'
          price: p.price,
          stockQuantity: p.stock,
          category: p.category,
          description: p.description,
          sellerId: SELLER_ID,
          status: 'Active',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      }));
      created++;
      console.log(`  ✓ ${p.name} (${p.category}) - ₹${p.price}, stock: ${p.stock}`);
    } catch (err) {
      errors++;
      console.error(`  ✗ ${p.name}: ${err.message}`);
    }
  }

  console.log(`\nDone: ${created} created/updated, ${errors} errors`);

  // Verify
  const res = await docClient.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: {
      ':pk': `SELLER#${SELLER_ID}`,
      ':prefix': 'PRODUCT#',
    },
    Select: 'COUNT',
  }));
  console.log(`Verification: ${res.Count} products under SELLER#${SELLER_ID}`);
}

seedProducts().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
