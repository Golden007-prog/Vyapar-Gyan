#!/usr/bin/env node
/**
 * Database Seeding Script for VyaparGyan MVP
 * 
 * Seeds the dev-vyapargyan-main DynamoDB table with realistic mock data:
 * - Active and pending sellers
 * - Products (including dead stock)
 * - Orders
 * - Insights
 * - Categories
 * 
 * Usage: npx tsx scripts/seed-db.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: 'ap-south-1' });
const docClient = DynamoDBDocumentClient.from(client);

const TABLE_NAME = 'dev-vyapargyan-main';

// Calculate dates
const now = new Date();
const twoMonthsAgo = new Date(now);
twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60);
const oneMonthAgo = new Date(now);
oneMonthAgo.setDate(oneMonthAgo.getDate() - 30);
const oneWeekAgo = new Date(now);
oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

/**
 * Mock data items to seed
 */
const mockData = [
  // ============================================
  // SELLERS
  // ============================================
  
  // Active Seller 1
  {
    PK: 'USER#seller-123',
    SK: 'PROFILE',
    id: 'seller-123',
    userId: 'seller-123',
    role: 'seller',
    status: 'active',
    businessName: 'Gupta General Store',
    ownerName: 'Rajesh Gupta',
    email: 'rajesh@guptastore.com',
    phone: '+919876543210',
    businessAddress: {
      addressLine1: '123 MG Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    },
    gstNumber: 'GST123456789',
    totalRevenue: 45000,
    createdAt: oneMonthAgo.toISOString(),
    updatedAt: now.toISOString(),
  },
  
  // Pending Seller 2
  {
    PK: 'USER#seller-456',
    SK: 'PROFILE',
    id: 'seller-456',
    userId: 'seller-456',
    role: 'seller',
    status: 'pending',
    businessName: 'Sharma Electronics',
    ownerName: 'Amit Sharma',
    email: 'amit@sharmaelectronics.com',
    phone: '+919876543211',
    businessAddress: {
      addressLine1: '456 Brigade Road',
      city: 'Bangalore',
      state: 'Karnataka',
      pincode: '560001',
    },
    gstNumber: 'GST987654321',
    totalRevenue: 0,
    createdAt: oneWeekAgo.toISOString(),
    updatedAt: oneWeekAgo.toISOString(),
  },
  
  // Active Seller 3
  {
    PK: 'USER#seller-789',
    SK: 'PROFILE',
    id: 'seller-789',
    userId: 'seller-789',
    role: 'seller',
    status: 'active',
    businessName: 'Patel Textiles',
    ownerName: 'Priya Patel',
    email: 'priya@pateltextiles.com',
    phone: '+919876543212',
    businessAddress: {
      addressLine1: '789 Ashram Road',
      city: 'Ahmedabad',
      state: 'Gujarat',
      pincode: '380009',
    },
    gstNumber: 'GST456789123',
    totalRevenue: 78000,
    createdAt: twoMonthsAgo.toISOString(),
    updatedAt: now.toISOString(),
  },

  // ============================================
  // CATEGORIES
  // ============================================
  
  {
    PK: 'CATEGORY',
    SK: 'CATEGORY#cat-electronics',
    id: 'cat-electronics',
    name: 'Electronics',
    description: 'Electronic items and gadgets',
    displayOrder: 1,
    isActive: true,
    createdAt: twoMonthsAgo.toISOString(),
    updatedAt: twoMonthsAgo.toISOString(),
  },
  
  {
    PK: 'CATEGORY',
    SK: 'CATEGORY#cat-textiles',
    id: 'cat-textiles',
    name: 'Textiles',
    description: 'Clothing and fabrics',
    displayOrder: 2,
    isActive: true,
    createdAt: twoMonthsAgo.toISOString(),
    updatedAt: twoMonthsAgo.toISOString(),
  },
  
  {
    PK: 'CATEGORY',
    SK: 'CATEGORY#cat-groceries',
    id: 'cat-groceries',
    name: 'Groceries',
    description: 'Daily essentials and food items',
    displayOrder: 3,
    isActive: true,
    createdAt: twoMonthsAgo.toISOString(),
    updatedAt: twoMonthsAgo.toISOString(),
  },

  // ============================================
  // PRODUCTS (Seller 123 - Gupta General Store)
  // ============================================
  
  // Product 1 - Normal stock
  {
    PK: 'PRODUCT#prod-001',
    SK: 'METADATA',
    id: 'prod-001',
    sellerId: 'seller-123',
    categoryId: 'cat-groceries',
    name: 'Tata Salt 1kg',
    description: 'Premium iodized salt',
    price: 25,
    originalPrice: 25,
    stockQuantity: 100,
    stockAddedDate: oneWeekAgo.toISOString(),
    isActive: true,
    isDeadStock: false,
    imageUrls: [],
    createdAt: oneWeekAgo.toISOString(),
    updatedAt: oneWeekAgo.toISOString(),
  },
  
  // Product 2 - Dead stock (>60 days old)
  {
    PK: 'PRODUCT#prod-002',
    SK: 'METADATA',
    id: 'prod-002',
    sellerId: 'seller-123',
    categoryId: 'cat-groceries',
    name: 'Britannia Biscuits 500g',
    description: 'Assorted biscuits pack',
    price: 120,
    originalPrice: 120,
    stockQuantity: 45,
    stockAddedDate: twoMonthsAgo.toISOString(),
    isActive: true,
    isDeadStock: true,
    imageUrls: [],
    createdAt: twoMonthsAgo.toISOString(),
    updatedAt: twoMonthsAgo.toISOString(),
  },

  // Product 3 - Normal stock
  {
    PK: 'PRODUCT#prod-003',
    SK: 'METADATA',
    id: 'prod-003',
    sellerId: 'seller-123',
    categoryId: 'cat-groceries',
    name: 'Amul Milk 1L',
    description: 'Fresh full cream milk',
    price: 60,
    originalPrice: 60,
    stockQuantity: 50,
    stockAddedDate: oneWeekAgo.toISOString(),
    isActive: true,
    isDeadStock: false,
    imageUrls: [],
    createdAt: oneWeekAgo.toISOString(),
    updatedAt: oneWeekAgo.toISOString(),
  },

  // ============================================
  // SELLER INDEX ENTRIES FOR PRODUCTS
  // ============================================
  
  {
    PK: 'SELLER#seller-123',
    SK: 'PRODUCT#prod-001',
    productId: 'prod-001',
    name: 'Tata Salt 1kg',
    price: 25,
    stockQuantity: 100,
    isActive: true,
  },
  
  {
    PK: 'SELLER#seller-123',
    SK: 'PRODUCT#prod-002',
    productId: 'prod-002',
    name: 'Britannia Biscuits 500g',
    price: 120,
    stockQuantity: 45,
    isActive: true,
  },
  
  {
    PK: 'SELLER#seller-123',
    SK: 'PRODUCT#prod-003',
    productId: 'prod-003',
    name: 'Amul Milk 1L',
    price: 60,
    stockQuantity: 50,
    isActive: true,
  },

  // ============================================
  // ORDERS (Seller 123)
  // ============================================
  
  // Order 1 - Paid
  {
    PK: 'ORDER#order-001',
    SK: 'METADATA',
    id: 'order-001',
    orderId: 'order-001',
    orderUUID: 'order-001',
    customerId: 'cust-001',
    customerPhone: '+919876543220',
    sellerId: 'seller-123',
    status: 'PAID',
    items: [
      {
        productId: 'prod-001',
        name: 'Tata Salt 1kg',
        price: 25,
        quantity: 2,
      },
    ],
    subtotal: 50,
    commissionRate: 0.15,
    commissionAmount: 7.5,
    sellerAmount: 42.5,
    shippingAddress: {
      name: 'Ramesh Kumar',
      phone: '+919876543220',
      addressLine1: '101 Park Street',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400002',
    },
    paymentId: 'pay_001',
    createdAt: oneWeekAgo.toISOString(),
    updatedAt: oneWeekAgo.toISOString(),
  },
  
  // Order 2 - Paid
  {
    PK: 'ORDER#order-002',
    SK: 'METADATA',
    id: 'order-002',
    orderId: 'order-002',
    orderUUID: 'order-002',
    customerId: 'cust-002',
    customerPhone: '+919876543221',
    sellerId: 'seller-123',
    status: 'PAID',
    items: [
      {
        productId: 'prod-003',
        name: 'Amul Milk 1L',
        price: 60,
        quantity: 3,
      },
    ],
    subtotal: 180,
    commissionRate: 0.15,
    commissionAmount: 27,
    sellerAmount: 153,
    shippingAddress: {
      name: 'Sunita Devi',
      phone: '+919876543221',
      addressLine1: '202 Marine Drive',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400003',
    },
    paymentId: 'pay_002',
    createdAt: oneWeekAgo.toISOString(),
    updatedAt: oneWeekAgo.toISOString(),
  },
  
  // Order 3 - Pending
  {
    PK: 'ORDER#order-003',
    SK: 'METADATA',
    id: 'order-003',
    orderId: 'order-003',
    orderUUID: 'order-003',
    customerId: 'cust-003',
    customerPhone: '+919876543222',
    sellerId: 'seller-123',
    status: 'PENDING',
    items: [
      {
        productId: 'prod-002',
        name: 'Britannia Biscuits 500g',
        price: 120,
        quantity: 1,
      },
    ],
    subtotal: 120,
    commissionRate: 0.15,
    commissionAmount: 18,
    sellerAmount: 102,
    shippingAddress: {
      name: 'Vikram Singh',
      phone: '+919876543222',
      addressLine1: '303 Linking Road',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400004',
    },
    paymentId: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  },

  // ============================================
  // SELLER INDEX ENTRIES FOR ORDERS
  // ============================================
  
  {
    PK: 'SELLER#seller-123',
    SK: `ORDER#${oneWeekAgo.toISOString()}#order-001`,
    orderUUID: 'order-001',
    status: 'PAID',
    amount: 50,
    createdAt: oneWeekAgo.toISOString(),
  },
  
  {
    PK: 'SELLER#seller-123',
    SK: `ORDER#${oneWeekAgo.toISOString()}#order-002`,
    orderUUID: 'order-002',
    status: 'PAID',
    amount: 180,
    createdAt: oneWeekAgo.toISOString(),
  },
  
  {
    PK: 'SELLER#seller-123',
    SK: `ORDER#${now.toISOString()}#order-003`,
    orderUUID: 'order-003',
    status: 'PENDING',
    amount: 120,
    createdAt: now.toISOString(),
  },

  // ============================================
  // AI INSIGHTS (Seller 123)
  // ============================================
  
  {
    PK: 'SELLER#seller-123',
    SK: 'INSIGHT#insight-001',
    id: 'insight-001',
    sellerId: 'seller-123',
    productId: 'prod-002',
    insightType: 'dead_stock_alert',
    priority: 'high',
    title: 'Dead Stock Alert: Britannia Biscuits',
    description: 'This product has been in stock for 60+ days with 45 units remaining',
    actionRecommended: 'Apply 20% discount to liquidate inventory',
    suggestedDiscountPercent: 20,
    marketInsights: 'Similar products are selling at ₹95-100 in the market',
    status: 'pending',
    createdAt: oneWeekAgo.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  
  {
    PK: 'SELLER#seller-123',
    SK: 'INSIGHT#insight-002',
    id: 'insight-002',
    sellerId: 'seller-123',
    productId: 'prod-001',
    insightType: 'pricing_recommendation',
    priority: 'medium',
    title: 'Price Increase Opportunity: Tata Salt',
    description: 'Market analysis shows demand is high for this product',
    actionRecommended: 'Consider increasing price by ₹3-5',
    suggestedPriceIncrease: 4,
    marketInsights: 'Competitors are selling at ₹28-30 per kg',
    status: 'pending',
    createdAt: oneWeekAgo.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  },

  // ============================================
  // CAMPAIGNS (Seller 123)
  // ============================================
  
  {
    PK: 'SELLER#seller-123',
    SK: 'CAMPAIGN#campaign-001',
    id: 'campaign-001',
    sellerId: 'seller-123',
    productId: 'prod-002',
    campaignType: 'discount_promotion',
    status: 'completed',
    title: 'Britannia Biscuits - 20% Off',
    message: '🎉 Special Offer! Britannia Biscuits now at ₹96 (20% off). Limited stock!',
    discountPercent: 20,
    targetCustomers: 15,
    messagesSent: 15,
    messagesDelivered: 14,
    conversions: 3,
    createdAt: oneWeekAgo.toISOString(),
    completedAt: oneWeekAgo.toISOString(),
  },

  // ============================================
  // CUSTOMERS
  // ============================================
  
  {
    PK: 'CUSTOMER#+919876543220',
    SK: 'PROFILE',
    id: 'cust-001',
    phoneNumber: '+919876543220',
    profileName: 'Ramesh Kumar',
    whatsappId: '+919876543220',
    createdAt: oneMonthAgo.toISOString(),
    updatedAt: oneWeekAgo.toISOString(),
  },
  
  {
    PK: 'CUSTOMER#+919876543221',
    SK: 'PROFILE',
    id: 'cust-002',
    phoneNumber: '+919876543221',
    profileName: 'Sunita Devi',
    whatsappId: '+919876543221',
    createdAt: oneMonthAgo.toISOString(),
    updatedAt: oneWeekAgo.toISOString(),
  },
  
  {
    PK: 'CUSTOMER#+919876543222',
    SK: 'PROFILE',
    id: 'cust-003',
    phoneNumber: '+919876543222',
    profileName: 'Vikram Singh',
    whatsappId: '+919876543222',
    createdAt: oneWeekAgo.toISOString(),
    updatedAt: now.toISOString(),
  },

  // ============================================
  // WHATSAPP SESSIONS
  // ============================================
  
  {
    PK: 'SESSION#cust-001',
    SK: 'WHATSAPP#+919876543220',
    id: 'session-001',
    customerId: 'cust-001',
    phoneNumber: '+919876543220',
    channelType: 'whatsapp',
    state: 'browsing',
    context: {
      cart: [],
      selectedCategory: null,
    },
    createdAt: oneWeekAgo.toISOString(),
    updatedAt: oneWeekAgo.toISOString(),
    lastActivityAt: oneWeekAgo.toISOString(),
  },
];

/**
 * Batch write items to DynamoDB
 */
async function seedDatabase() {
  console.log('🌱 Starting database seeding...');
  console.log(`📊 Total items to seed: ${mockData.length}`);
  
  // DynamoDB BatchWrite supports max 25 items per request
  const batchSize = 25;
  const batches = [];
  
  for (let i = 0; i < mockData.length; i += batchSize) {
    batches.push(mockData.slice(i, i + batchSize));
  }
  
  console.log(`📦 Split into ${batches.length} batches`);
  
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`\n⏳ Processing batch ${i + 1}/${batches.length} (${batch.length} items)...`);
    
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
  
  console.log('\n🎉 Database seeding completed successfully!');
  console.log('\n📋 Summary:');
  console.log('  - 3 Sellers (2 active, 1 pending)');
  console.log('  - 3 Categories');
  console.log('  - 3 Products (1 dead stock)');
  console.log('  - 3 Orders (2 paid, 1 pending)');
  console.log('  - 2 AI Insights');
  console.log('  - 1 Campaign');
  console.log('  - 3 Customers');
  console.log('  - 1 WhatsApp Session');
}

// Run the seeding script
seedDatabase()
  .then(() => {
    console.log('\n✨ All done! You can now test the dashboards with realistic data.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Seeding failed:', error);
    process.exit(1);
  });
