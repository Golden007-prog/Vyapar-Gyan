#!/usr/bin/env node
/**
 * Seed script for GOLDEN Store seller
 * Registers seller profile and test inventory for WhatsApp Seller Copilot testing
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = 'dev-vyapargyan-main';
const REGION = 'ap-south-1';

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

async function seedGoldenStore() {
  console.log('🌟 Seeding GOLDEN Store seller...');

  const now = new Date();
  const sellerId = 'seller-golden-001';

  const items = [
    // Seller Profile
    {
      PK: `USER#${sellerId}`,
      SK: 'PROFILE',
      GSI1PK: 'ROLE#seller',
      GSI1SK: `USER#${sellerId}`,
      id: sellerId,
      userId: sellerId,
      role: 'seller',
      status: 'active',
      businessName: 'GOLDEN Store',
      ownerName: 'Golden Store Owner',
      email: 'golden@example.com',
      phone: '+918927049085',
      phoneNumber: '+918927049085',
      businessAddress: {
        addressLine1: 'Golden Street',
        city: 'Kolkata',
        state: 'West Bengal',
        pincode: '700001',
      },
      totalRevenue: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    // Test Product 1: Tata Salt (Main entry)
    {
      PK: 'PRODUCT#prod-g-001',
      SK: 'METADATA',
      GSI1PK: `SELLER#${sellerId}`,
      GSI1SK: 'PRODUCT#prod-g-001',
      id: 'prod-g-001',
      productId: 'prod-g-001',
      sellerId: sellerId,
      categoryId: 'cat-groceries',
      name: 'Tata Salt 1kg',
      description: 'Premium iodized salt',
      price: 24,
      originalPrice: 24,
      stockQuantity: 200,
      stockAddedDate: now.toISOString(),
      isActive: true,
      isDeadStock: false,
      imageUrls: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    // Test Product 1: Seller index
    {
      PK: `SELLER#${sellerId}`,
      SK: 'PRODUCT#prod-g-001',
      productId: 'prod-g-001',
      name: 'Tata Salt 1kg',
      price: 24,
      stockQuantity: 200,
      isActive: true,
    },
    // Test Product 2: Amul Butter (Main entry)
    {
      PK: 'PRODUCT#prod-g-002',
      SK: 'METADATA',
      GSI1PK: `SELLER#${sellerId}`,
      GSI1SK: 'PRODUCT#prod-g-002',
      id: 'prod-g-002',
      productId: 'prod-g-002',
      sellerId: sellerId,
      categoryId: 'cat-groceries',
      name: 'Amul Butter 500g',
      description: 'Fresh dairy butter',
      price: 280,
      originalPrice: 280,
      stockQuantity: 45,
      stockAddedDate: now.toISOString(),
      isActive: true,
      isDeadStock: false,
      imageUrls: [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    // Test Product 2: Seller index
    {
      PK: `SELLER#${sellerId}`,
      SK: 'PRODUCT#prod-g-002',
      productId: 'prod-g-002',
      name: 'Amul Butter 500g',
      price: 280,
      stockQuantity: 45,
      isActive: true,
    },
  ];

  try {
    // Batch write items
    const command = new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: items.map((item) => ({
          PutRequest: {
            Item: item,
          },
        })),
      },
    });

    await docClient.send(command);

    console.log('✅ Successfully seeded GOLDEN Store!');
    console.log('\n📋 Seeded Records:');
    console.log('  - Seller: GOLDEN Store (seller-golden-001)');
    console.log('  - Phone: +918927049085');
    console.log('  - Product 1: Tata Salt 1kg (200 units @ ₹24)');
    console.log('  - Product 2: Amul Butter 500g (45 units @ ₹280)');
    console.log('\n🎯 Ready for WhatsApp Seller Copilot testing!');
    console.log('\n📱 Send a WhatsApp message from +918927049085 to test seller routing');
  } catch (error) {
    console.error('❌ Error seeding GOLDEN Store:', error);
    throw error;
  }
}

// Execute
seedGoldenStore()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
