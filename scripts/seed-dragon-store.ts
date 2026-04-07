#!/usr/bin/env node
/**
 * Dragon Store Seeding Script
 * 
 * Registers Dragon Store seller and seeds inventory from CSV
 * 
 * Usage: npx tsx scripts/seed-dragon-store.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { parse } from 'csv-parse/sync';

// Initialize clients
const dynamoClient = new DynamoDBClient({ region: 'ap-south-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: 'ap-south-1' });

const TABLE_NAME = 'dev-vyapargyan-main';
const BUCKET_NAME = 'dev-vyapargyan-documents';
const SELLER_ID = 'seller-dragon-001';

const now = new Date();

/**
 * Dragon Store seller profile
 */
const dragonStoreSeller = {
  PK: `USER#${SELLER_ID}`,
  SK: 'PROFILE',
  // GSI1: Phone lookup — getUserByPhone() queries GSI1PK = PHONE#{normalized}
  GSI1PK: 'PHONE#8927049085',
  GSI1SK: `USER#${SELLER_ID}`,
  // GSI2: Role-based queries
  GSI2PK: 'ROLE#seller',
  GSI2SK: `USER#${SELLER_ID}`,
  id: SELLER_ID,
  userId: SELLER_ID,
  role: 'seller',
  status: 'active',
  sellerStatus: 'approved',
  displayName: 'Dragon Store Owner',
  businessName: 'Dragon Store',
  ownerName: 'Dragon Store Owner',
  email: 'owner@dragonstore.com',
  phone: '+918927049085',
  phoneNumber: '+918927049085',
  phoneVerificationStatus: 'verified',
  preferredChannel: 'whatsapp',
  whatsappConnected: true,
  businessAddress: {
    addressLine1: 'Dragon Street',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
  },
  gstNumber: 'GSTDRAGON123',
  cognitoId: 'seed-dragon-001',
  totalRevenue: 0,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};

/**
 * Parse CSV and create product items
 */
function parseInventoryCSV(csvPath: string) {
  console.log(`📄 Reading CSV from: ${csvPath}`);
  
  const csvContent = readFileSync(csvPath, 'utf-8');
  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  });

  console.log(`📊 Found ${records.length} products in CSV`);

  const items: any[] = [];
  const categoryMap = new Map<string, string>();

  // Map categories to IDs
  categoryMap.set('Grains & Pulses', 'cat-groceries');
  categoryMap.set('Beverages', 'cat-groceries');
  categoryMap.set('Oils & Fats', 'cat-groceries');
  categoryMap.set('Dairy', 'cat-groceries');
  categoryMap.set('Bakery', 'cat-groceries');
  categoryMap.set('Instant Food', 'cat-groceries');
  categoryMap.set('Spices & Condiments', 'cat-groceries');
  categoryMap.set('Personal Care', 'cat-groceries');

  records.forEach((record: any, index: number) => {
    const productId = `prod-dragon-${String(index + 1).padStart(3, '0')}`;
    const categoryId = categoryMap.get(record.Category) || 'cat-groceries';
    const price = parseFloat(record.Unit_Price);
    const stockQuantity = parseInt(record.Stock_Quantity, 10);

    // Main product item
    items.push({
      PK: `PRODUCT#${productId}`,
      SK: 'METADATA',
      GSI1PK: `SELLER#${SELLER_ID}`,
      GSI1SK: `PRODUCT#${productId}`,
      id: productId,
      sellerId: SELLER_ID,
      categoryId: categoryId,
      name: record.Product_Name,
      description: record.Description || '',
      price: price,
      originalPrice: price,
      stockQuantity: stockQuantity,
      stockAddedDate: now.toISOString(),
      isActive: true,
      isDeadStock: false,
      imageUrls: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    // Seller index entry
    items.push({
      PK: `SELLER#${SELLER_ID}`,
      SK: `PRODUCT#${productId}`,
      productId: productId,
      name: record.Product_Name,
      price: price,
      stockQuantity: stockQuantity,
      isActive: true,
    });
  });

  return items;
}

/**
 * Upload CSV to S3 for inventory processing
 */
async function uploadCSVToS3(csvPath: string) {
  console.log('\n📤 Uploading CSV to S3...');
  
  const csvContent = readFileSync(csvPath);
  const s3Key = `sellers/${SELLER_ID}/inventory/dragon-store-inventory-${Date.now()}.csv`;

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: csvContent,
        ContentType: 'text/csv',
      })
    );

    console.log(`✅ CSV uploaded to: s3://${BUCKET_NAME}/${s3Key}`);
    return s3Key;
  } catch (error) {
    console.error('❌ Failed to upload CSV to S3:', error);
    throw error;
  }
}

/**
 * Seed Dragon Store data to DynamoDB
 */
async function seedDragonStore() {
  console.log('🐉 Starting Dragon Store seeding...\n');
  
  // Log AWS configuration
  console.log('🔧 AWS Configuration:');
  console.log(`   Region: ap-south-1`);
  console.log(`   Table: ${TABLE_NAME}\n`);

  // Parse inventory CSV
  const csvPath = 'test csv/dragon-store-inventory.csv';
  const productItems = parseInventoryCSV(csvPath);

  // Combine all items
  const allItems = [dragonStoreSeller, ...productItems];
  console.log(`\n📦 Total items to seed: ${allItems.length}`);
  console.log(`   - 1 Seller profile`);
  console.log(`   - ${productItems.length} Product items (products + indexes)`);

  // Batch write to DynamoDB (max 25 items per request)
  const batchSize = 25;
  const batches = [];
  
  for (let i = 0; i < allItems.length; i += batchSize) {
    batches.push(allItems.slice(i, i + batchSize));
  }

  console.log(`\n📊 Split into ${batches.length} batches\n`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`⏳ Processing batch ${i + 1}/${batches.length} (${batch.length} items)...`);

    const command = new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: batch.map(item => ({
          PutRequest: {
            Item: item,
          },
        })),
      },
    });

    try {
      const response = await docClient.send(command);

      if (response.UnprocessedItems && Object.keys(response.UnprocessedItems).length > 0) {
        console.warn(`⚠️  Batch ${i + 1} has unprocessed items:`, response.UnprocessedItems);
      } else {
        console.log(`✅ Batch ${i + 1} completed successfully`);
      }
    } catch (error) {
      console.error(`❌ Error processing batch ${i + 1}:`, error);
      throw error;
    }
  }

  console.log('\n🎉 DynamoDB seeding completed successfully!');
  
  // Verify writes with GetItem
  console.log('\n🔍 Verifying writes...');
  
  try {
    const { GetCommand } = await import('@aws-sdk/lib-dynamodb');
    
    // Verify seller
    const sellerResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `USER#${SELLER_ID}`,
          SK: 'PROFILE',
        },
      })
    );
    
    if (sellerResult.Item) {
      console.log(`✅ Seller verified: ${sellerResult.Item.businessName} (${sellerResult.Item.phone})`);
    } else {
      console.error('❌ Seller NOT FOUND after write!');
      throw new Error('Seller verification failed');
    }
    
    // Verify Tata Salt product (7th product, index 6)
    const tataSaltId = 'prod-dragon-007';
    const productResult = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: {
          PK: `PRODUCT#${tataSaltId}`,
          SK: 'METADATA',
        },
      })
    );
    
    if (productResult.Item) {
      console.log(`✅ Product verified: ${productResult.Item.name} (${productResult.Item.stockQuantity} units @ ₹${productResult.Item.price})`);
    } else {
      console.error(`❌ Product ${tataSaltId} NOT FOUND after write!`);
      throw new Error('Product verification failed');
    }
  } catch (error) {
    console.error('❌ Verification failed:', error);
    throw error;
  }

  // Upload CSV to S3 (optional - for inventory upload handler testing)
  try {
    await uploadCSVToS3(csvPath);
  } catch (error) {
    console.warn('⚠️  CSV upload to S3 failed (optional step)');
  }

  console.log('\n📋 Summary:');
  console.log('  ✅ Dragon Store seller registered');
  console.log(`  ✅ Phone: +918927049085`);
  console.log(`  ✅ Seller ID: ${SELLER_ID}`);
  console.log(`  ✅ ${productItems.length / 2} products added to inventory`);
  console.log(`  ✅ Tata Salt 1kg: prod-dragon-007 (100 units @ ₹22)`);
  console.log('\n🚀 Ready to test WhatsApp Seller Copilot!');
  console.log('\n📱 Send a WhatsApp message to +19472349399:');
  console.log('   "How much Tata Salt do I have?"');
  console.log('\n📝 Note: Use MCP tool get_inventory with productId="prod-dragon-007" to verify');
}

// Run the seeding script
seedDragonStore()
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Seeding failed:', error);
    process.exit(1);
  });
