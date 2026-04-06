#!/usr/bin/env node
/**
 * Comprehensive Demo Data Seeding Script
 * 
 * Extends the base seed-db.ts with the full demo dataset:
 *   - 8 sellers (3 pending, 4 active, 1 suspended)
 *   - 50+ products across 6 categories
 *   - 5 AI insights (3 pending, 1 approved, 1 executed)
 *   - 3 approval items
 *   - 2 completed campaigns
 *   - 10 orders across different statuses
 *   - 5 WhatsApp conversation threads
 *   - Audit log entries for last 7 days
 * 
 * Usage: npx tsx scripts/seed-demo-data.ts
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: 'ap-south-1' });
const docClient = DynamoDBDocumentClient.from(client);
const TABLE_NAME = 'dev-vyapargyan-main';

const now = new Date();
const d = (daysAgo: number) => {
  const dt = new Date(now);
  dt.setDate(dt.getDate() - daysAgo);
  return dt.toISOString();
};
const future = (daysAhead: number) => {
  const dt = new Date(now);
  dt.setDate(dt.getDate() + daysAhead);
  return dt.toISOString();
};

// ============================================
// CATEGORIES (6)
// ============================================
const categories = [
  { id: 'cat-electronics', name: 'Electronics', order: 1 },
  { id: 'cat-textiles', name: 'Textiles & Fashion', order: 2 },
  { id: 'cat-groceries', name: 'Groceries', order: 3 },
  { id: 'cat-hardware', name: 'Hardware & Tools', order: 4 },
  { id: 'cat-beauty', name: 'Beauty & Personal Care', order: 5 },
  { id: 'cat-home', name: 'Home & Kitchen', order: 6 },
].map(c => ({
  PK: 'CATEGORY', SK: `CATEGORY#${c.id}`,
  id: c.id, name: c.name, description: `${c.name} products`,
  displayOrder: c.order, isActive: true,
  createdAt: d(90), updatedAt: d(90),
}));

// ============================================
// SELLERS (8: 4 active, 3 pending, 1 suspended)
// ============================================
const sellers = [
  // Active sellers
  { id: 'seller-123', name: 'Rajesh Gupta', biz: 'Gupta General Store', phone: '+919876543210', city: 'Mumbai', state: 'Maharashtra', status: 'active', revenue: 45000, created: 60 },
  { id: 'seller-789', name: 'Priya Patel', biz: 'Patel Textiles', phone: '+919876543212', city: 'Ahmedabad', state: 'Gujarat', status: 'active', revenue: 78000, created: 90 },
  { id: 'seller-aaa', name: 'Deepak Singh', biz: 'Singh Hardware', phone: '+919876543213', city: 'Delhi', state: 'Delhi', status: 'active', revenue: 62000, created: 45 },
  { id: 'seller-bbb', name: 'Meena Kumari', biz: 'Meena Beauty Hub', phone: '+919876543214', city: 'Jaipur', state: 'Rajasthan', status: 'active', revenue: 34000, created: 30 },
  // Pending sellers
  { id: 'seller-456', name: 'Amit Sharma', biz: 'Sharma Electronics', phone: '+919876543211', city: 'Bangalore', state: 'Karnataka', status: 'pending', revenue: 0, created: 7 },
  { id: 'seller-ccc', name: 'Ravi Verma', biz: 'Verma Traders', phone: '+919876543215', city: 'Lucknow', state: 'Uttar Pradesh', status: 'pending', revenue: 0, created: 3 },
  { id: 'seller-ddd', name: 'Anita Joshi', biz: 'Joshi Kitchen World', phone: '+919876543216', city: 'Pune', state: 'Maharashtra', status: 'pending', revenue: 0, created: 1 },
  // Suspended seller
  { id: 'seller-eee', name: 'Fake Store', biz: 'Suspicious Deals', phone: '+919876543217', city: 'Chennai', state: 'Tamil Nadu', status: 'suspended', revenue: 1200, created: 120 },
].map(s => ({
  PK: `USER#${s.id}`, SK: 'PROFILE',
  id: s.id, userId: s.id, role: 'seller', status: s.status,
  businessName: s.biz, ownerName: s.name, phone: s.phone,
  businessAddress: { addressLine1: '123 Main Road', city: s.city, state: s.state, pincode: '400001' },
  gstNumber: `GST${s.id.replace('seller-', '').toUpperCase()}`,
  totalRevenue: s.revenue,
  createdAt: d(s.created), updatedAt: d(0),
}));

// Also link demo-seller-002 to seller-123 data (so the demo seller login sees Gupta General Store)
const demoSellerLink = {
  PK: 'USER#demo-seller-002', SK: 'PROFILE',
  id: 'demo-seller-002', userId: 'demo-seller-002', role: 'seller', status: 'active',
  businessName: 'Gupta General Store', ownerName: 'Demo Seller', phone: '+919000000002',
  businessAddress: { addressLine1: '123 MG Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
  gstNumber: 'GSTDEMO002', totalRevenue: 45000,
  createdAt: d(60), updatedAt: d(0),
};

// ============================================
// PRODUCTS (50+ across sellers and categories)
// ============================================
const productDefs = [
  // Gupta General Store (seller-123) - Groceries
  { id: 'prod-001', seller: 'seller-123', cat: 'cat-groceries', name: 'Tata Salt 1kg', price: 25, stock: 100, dead: false, age: 7 },
  { id: 'prod-002', seller: 'seller-123', cat: 'cat-groceries', name: 'Britannia Biscuits 500g', price: 120, stock: 45, dead: true, age: 65 },
  { id: 'prod-003', seller: 'seller-123', cat: 'cat-groceries', name: 'Amul Milk 1L', price: 60, stock: 50, dead: false, age: 3 },
  { id: 'prod-004', seller: 'seller-123', cat: 'cat-groceries', name: 'Aashirvaad Atta 5kg', price: 280, stock: 30, dead: false, age: 14 },
  { id: 'prod-005', seller: 'seller-123', cat: 'cat-groceries', name: 'Fortune Sunflower Oil 1L', price: 165, stock: 25, dead: false, age: 10 },
  { id: 'prod-006', seller: 'seller-123', cat: 'cat-groceries', name: 'Maggi Noodles 12-pack', price: 144, stock: 60, dead: false, age: 5 },
  { id: 'prod-007', seller: 'seller-123', cat: 'cat-groceries', name: 'Parle-G Biscuits 800g', price: 55, stock: 80, dead: true, age: 70 },
  { id: 'prod-008', seller: 'seller-123', cat: 'cat-groceries', name: 'Red Label Tea 500g', price: 245, stock: 15, dead: false, age: 20 },
  // Patel Textiles (seller-789)
  { id: 'prod-101', seller: 'seller-789', cat: 'cat-textiles', name: 'Cotton Saree - Blue', price: 1200, stock: 8, dead: false, age: 14 },
  { id: 'prod-102', seller: 'seller-789', cat: 'cat-textiles', name: 'Cotton Saree - Red', price: 1350, stock: 5, dead: false, age: 14 },
  { id: 'prod-103', seller: 'seller-789', cat: 'cat-textiles', name: 'Silk Dupatta', price: 800, stock: 12, dead: true, age: 75 },
  { id: 'prod-104', seller: 'seller-789', cat: 'cat-textiles', name: 'Men Kurta - White', price: 650, stock: 20, dead: false, age: 21 },
  { id: 'prod-105', seller: 'seller-789', cat: 'cat-textiles', name: 'Men Kurta - Black', price: 700, stock: 18, dead: false, age: 21 },
  { id: 'prod-106', seller: 'seller-789', cat: 'cat-textiles', name: 'Chiffon Scarf', price: 350, stock: 30, dead: true, age: 80 },
  { id: 'prod-107', seller: 'seller-789', cat: 'cat-textiles', name: 'Linen Shirt - Blue', price: 950, stock: 10, dead: false, age: 10 },
  { id: 'prod-108', seller: 'seller-789', cat: 'cat-textiles', name: 'Palazzo Pants', price: 550, stock: 15, dead: false, age: 7 },
  // Singh Hardware (seller-aaa)
  { id: 'prod-201', seller: 'seller-aaa', cat: 'cat-hardware', name: 'Hammer 500g', price: 350, stock: 25, dead: false, age: 30 },
  { id: 'prod-202', seller: 'seller-aaa', cat: 'cat-hardware', name: 'Screwdriver Set (6pc)', price: 450, stock: 15, dead: false, age: 20 },
  { id: 'prod-203', seller: 'seller-aaa', cat: 'cat-hardware', name: 'PVC Pipe 1 inch (10ft)', price: 180, stock: 40, dead: false, age: 14 },
  { id: 'prod-204', seller: 'seller-aaa', cat: 'cat-hardware', name: 'Wall Paint White 4L', price: 850, stock: 8, dead: true, age: 90 },
  { id: 'prod-205', seller: 'seller-aaa', cat: 'cat-hardware', name: 'Electrical Wire 30m', price: 620, stock: 12, dead: false, age: 7 },
  { id: 'prod-206', seller: 'seller-aaa', cat: 'cat-hardware', name: 'Door Lock Set', price: 780, stock: 6, dead: false, age: 45 },
  { id: 'prod-207', seller: 'seller-aaa', cat: 'cat-hardware', name: 'Measuring Tape 5m', price: 120, stock: 35, dead: false, age: 10 },
  { id: 'prod-208', seller: 'seller-aaa', cat: 'cat-hardware', name: 'Cement 50kg Bag', price: 380, stock: 20, dead: false, age: 5 },
  // Meena Beauty Hub (seller-bbb)
  { id: 'prod-301', seller: 'seller-bbb', cat: 'cat-beauty', name: 'Lakme Foundation', price: 450, stock: 20, dead: false, age: 14 },
  { id: 'prod-302', seller: 'seller-bbb', cat: 'cat-beauty', name: 'Himalaya Face Wash', price: 180, stock: 35, dead: false, age: 7 },
  { id: 'prod-303', seller: 'seller-bbb', cat: 'cat-beauty', name: 'Dove Shampoo 650ml', price: 340, stock: 25, dead: false, age: 10 },
  { id: 'prod-304', seller: 'seller-bbb', cat: 'cat-beauty', name: 'Nivea Body Lotion 400ml', price: 290, stock: 18, dead: true, age: 65 },
  { id: 'prod-305', seller: 'seller-bbb', cat: 'cat-beauty', name: 'Maybelline Lipstick', price: 550, stock: 12, dead: false, age: 21 },
  { id: 'prod-306', seller: 'seller-bbb', cat: 'cat-beauty', name: 'Biotique Hair Oil 200ml', price: 220, stock: 28, dead: false, age: 14 },
  { id: 'prod-307', seller: 'seller-bbb', cat: 'cat-beauty', name: 'Colgate Toothpaste 200g', price: 95, stock: 50, dead: false, age: 5 },
  { id: 'prod-308', seller: 'seller-bbb', cat: 'cat-beauty', name: 'Dettol Soap 4-pack', price: 160, stock: 40, dead: false, age: 7 },
  // Sharma Electronics (seller-456) - pending but has some products
  { id: 'prod-401', seller: 'seller-456', cat: 'cat-electronics', name: 'Boat Earbuds', price: 1299, stock: 30, dead: false, age: 7 },
  { id: 'prod-402', seller: 'seller-456', cat: 'cat-electronics', name: 'Mi Power Bank 10000mAh', price: 899, stock: 20, dead: false, age: 14 },
  { id: 'prod-403', seller: 'seller-456', cat: 'cat-electronics', name: 'USB-C Cable 1m', price: 199, stock: 50, dead: false, age: 3 },
  { id: 'prod-404', seller: 'seller-456', cat: 'cat-electronics', name: 'LED Bulb 9W (Pack of 4)', price: 320, stock: 40, dead: false, age: 10 },
  { id: 'prod-405', seller: 'seller-456', cat: 'cat-electronics', name: 'Phone Case - Universal', price: 149, stock: 60, dead: true, age: 80 },
  { id: 'prod-406', seller: 'seller-456', cat: 'cat-electronics', name: 'Wireless Mouse', price: 599, stock: 15, dead: false, age: 21 },
  // Home & Kitchen (seller-123 cross-category)
  { id: 'prod-501', seller: 'seller-123', cat: 'cat-home', name: 'Steel Water Bottle 1L', price: 350, stock: 20, dead: false, age: 14 },
  { id: 'prod-502', seller: 'seller-123', cat: 'cat-home', name: 'Pressure Cooker 3L', price: 1450, stock: 5, dead: false, age: 30 },
  { id: 'prod-503', seller: 'seller-123', cat: 'cat-home', name: 'Non-stick Tawa', price: 650, stock: 10, dead: true, age: 70 },
  { id: 'prod-504', seller: 'seller-123', cat: 'cat-home', name: 'Glass Set (6pc)', price: 280, stock: 15, dead: false, age: 21 },
  { id: 'prod-505', seller: 'seller-123', cat: 'cat-home', name: 'Plastic Storage Container Set', price: 420, stock: 12, dead: false, age: 10 },
  { id: 'prod-506', seller: 'seller-123', cat: 'cat-home', name: 'Dinner Plate Set (4pc)', price: 560, stock: 8, dead: false, age: 14 },
  // More groceries for variety
  { id: 'prod-601', seller: 'seller-789', cat: 'cat-groceries', name: 'Basmati Rice 5kg', price: 450, stock: 20, dead: false, age: 7 },
  { id: 'prod-602', seller: 'seller-aaa', cat: 'cat-groceries', name: 'Sugar 1kg', price: 45, stock: 100, dead: false, age: 5 },
  { id: 'prod-603', seller: 'seller-bbb', cat: 'cat-groceries', name: 'Ghee 500ml', price: 320, stock: 15, dead: false, age: 10 },
  { id: 'prod-604', seller: 'seller-123', cat: 'cat-groceries', name: 'Turmeric Powder 200g', price: 65, stock: 40, dead: false, age: 14 },
  { id: 'prod-605', seller: 'seller-123', cat: 'cat-groceries', name: 'Chilli Powder 200g', price: 55, stock: 35, dead: false, age: 14 },
  { id: 'prod-606', seller: 'seller-123', cat: 'cat-groceries', name: 'Cumin Seeds 100g', price: 85, stock: 25, dead: false, age: 7 },
];

const products = productDefs.flatMap(p => [
  // Product metadata
  {
    PK: `PRODUCT#${p.id}`, SK: 'METADATA',
    id: p.id, sellerId: p.seller, categoryId: p.cat,
    name: p.name, description: p.name, price: p.price, originalPrice: p.price,
    stockQuantity: p.stock, stockAddedDate: d(p.age),
    isActive: true, isDeadStock: p.dead, imageUrls: [],
    createdAt: d(p.age), updatedAt: d(0),
  },
  // Seller index entry
  {
    PK: `SELLER#${p.seller}`, SK: `PRODUCT#${p.id}`,
    productId: p.id, name: p.name, price: p.price,
    stockQuantity: p.stock, isActive: true,
  },
]);

// ============================================
// ORDERS (10 across different statuses)
// ============================================
const orderDefs = [
  { id: 'order-001', cust: 'cust-001', phone: '+919876543220', seller: 'seller-123', status: 'PAID', prod: 'Tata Salt 1kg', price: 25, qty: 2, age: 7 },
  { id: 'order-002', cust: 'cust-002', phone: '+919876543221', seller: 'seller-123', status: 'PAID', prod: 'Amul Milk 1L', price: 60, qty: 3, age: 6 },
  { id: 'order-003', cust: 'cust-003', phone: '+919876543222', seller: 'seller-123', status: 'PENDING', prod: 'Britannia Biscuits 500g', price: 120, qty: 1, age: 0 },
  { id: 'order-004', cust: 'cust-001', phone: '+919876543220', seller: 'seller-789', status: 'SHIPPED', prod: 'Cotton Saree - Blue', price: 1200, qty: 1, age: 3 },
  { id: 'order-005', cust: 'cust-002', phone: '+919876543221', seller: 'seller-aaa', status: 'PAID', prod: 'Hammer 500g', price: 350, qty: 1, age: 5 },
  { id: 'order-006', cust: 'cust-003', phone: '+919876543222', seller: 'seller-bbb', status: 'DELIVERED', prod: 'Lakme Foundation', price: 450, qty: 2, age: 10 },
  { id: 'order-007', cust: 'cust-004', phone: '+919876543223', seller: 'seller-123', status: 'PAID', prod: 'Pressure Cooker 3L', price: 1450, qty: 1, age: 2 },
  { id: 'order-008', cust: 'cust-005', phone: '+919876543224', seller: 'seller-789', status: 'CANCELLED', prod: 'Silk Dupatta', price: 800, qty: 1, age: 4 },
  { id: 'order-009', cust: 'cust-004', phone: '+919876543223', seller: 'seller-aaa', status: 'PAID', prod: 'Screwdriver Set (6pc)', price: 450, qty: 1, age: 1 },
  { id: 'order-010', cust: 'cust-005', phone: '+919876543224', seller: 'seller-123', status: 'PENDING', prod: 'Red Label Tea 500g', price: 245, qty: 2, age: 0 },
];

const orders = orderDefs.flatMap(o => {
  const subtotal = o.price * o.qty;
  const commission = subtotal * 0.15;
  return [
    {
      PK: `ORDER#${o.id}`, SK: 'METADATA',
      id: o.id, orderId: o.id, orderUUID: o.id,
      customerId: o.cust, customerPhone: o.phone, sellerId: o.seller,
      status: o.status,
      items: [{ productId: o.id, name: o.prod, price: o.price, quantity: o.qty }],
      subtotal, commissionRate: 0.15, commissionAmount: commission, sellerAmount: subtotal - commission,
      shippingAddress: { name: 'Customer', phone: o.phone, addressLine1: '101 Main St', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
      paymentId: o.status !== 'PENDING' ? `pay_${o.id}` : null,
      createdAt: d(o.age), updatedAt: d(0),
    },
    {
      PK: `SELLER#${o.seller}`, SK: `ORDER#${d(o.age)}#${o.id}`,
      orderUUID: o.id, status: o.status, amount: subtotal, createdAt: d(o.age),
    },
  ];
});

// ============================================
// AI INSIGHTS (5: 3 pending, 1 approved, 1 executed)
// ============================================
const insights = [
  {
    PK: 'SELLER#seller-123', SK: 'INSIGHT#insight-001',
    id: 'insight-001', sellerId: 'seller-123', productId: 'prod-002',
    insightType: 'dead_stock_alert', priority: 'high',
    title: 'Dead Stock Alert: Britannia Biscuits',
    description: '45 units in stock for 65+ days with zero sales',
    actionRecommended: 'Apply 20% discount to liquidate inventory',
    suggestedDiscountPercent: 20,
    marketInsights: 'Similar products selling at ₹95-100 in nearby markets',
    status: 'pending', createdAt: d(7), expiresAt: future(7),
  },
  {
    PK: 'SELLER#seller-123', SK: 'INSIGHT#insight-002',
    id: 'insight-002', sellerId: 'seller-123', productId: 'prod-001',
    insightType: 'pricing_recommendation', priority: 'medium',
    title: 'Price Increase Opportunity: Tata Salt',
    description: 'Market demand is high, competitors pricing at ₹28-30',
    actionRecommended: 'Increase price by ₹3-5',
    suggestedPriceIncrease: 4,
    marketInsights: 'Competitors selling at ₹28-30 per kg',
    status: 'pending', createdAt: d(5), expiresAt: future(7),
  },
  {
    PK: 'SELLER#seller-123', SK: 'INSIGHT#insight-003',
    id: 'insight-003', sellerId: 'seller-123', productId: 'prod-007',
    insightType: 'dead_stock_alert', priority: 'high',
    title: 'Dead Stock Alert: Parle-G Biscuits',
    description: '80 units unsold for 70+ days',
    actionRecommended: 'Apply 25% discount campaign',
    suggestedDiscountPercent: 25,
    marketInsights: 'Demand is seasonal — clear before monsoon',
    status: 'pending', createdAt: d(3), expiresAt: future(7),
  },
  {
    PK: 'SELLER#seller-789', SK: 'INSIGHT#insight-004',
    id: 'insight-004', sellerId: 'seller-789', productId: 'prod-103',
    insightType: 'dead_stock_alert', priority: 'medium',
    title: 'Dead Stock: Silk Dupatta',
    description: '12 units unsold for 75 days',
    actionRecommended: 'Bundle with sarees at 15% discount',
    suggestedDiscountPercent: 15,
    status: 'approved', createdAt: d(10), expiresAt: future(4),
  },
  {
    PK: 'SELLER#seller-aaa', SK: 'INSIGHT#insight-005',
    id: 'insight-005', sellerId: 'seller-aaa', productId: 'prod-204',
    insightType: 'dead_stock_alert', priority: 'low',
    title: 'Slow Moving: Wall Paint White',
    description: '8 units in stock for 90 days',
    actionRecommended: '30% discount clearance',
    suggestedDiscountPercent: 30,
    status: 'executed', createdAt: d(14), expiresAt: future(0),
  },
];

// ============================================
// APPROVAL ITEMS (3)
// ============================================
const approvals = [
  {
    PK: 'SELLER#seller-123', SK: 'APPROVAL#approval-001',
    id: 'approval-001', sellerId: 'seller-123', type: 'discount_campaign',
    title: 'Dead Stock Discount: Britannia Biscuits 20% Off',
    description: 'AI recommends 20% discount campaign targeting 45 past customers',
    insightId: 'insight-001', priority: 85, status: 'pending',
    affectedProducts: ['prod-002'], estimatedImpact: '₹4,320 potential recovery',
    createdAt: d(7), updatedAt: d(7),
  },
  {
    PK: 'SELLER#seller-123', SK: 'APPROVAL#approval-002',
    id: 'approval-002', sellerId: 'seller-123', type: 'price_adjustment',
    title: 'Price Increase: Tata Salt ₹25 → ₹29',
    description: 'Market analysis supports ₹4 price increase',
    insightId: 'insight-002', priority: 60, status: 'pending',
    affectedProducts: ['prod-001'], estimatedImpact: '₹400/month additional revenue',
    createdAt: d(5), updatedAt: d(5),
  },
  {
    PK: 'SELLER#seller-123', SK: 'APPROVAL#approval-003',
    id: 'approval-003', sellerId: 'seller-123', type: 'discount_campaign',
    title: 'Clearance: Parle-G Biscuits 25% Off',
    description: 'Seasonal clearance before monsoon',
    insightId: 'insight-003', priority: 72, status: 'pending',
    affectedProducts: ['prod-007'], estimatedImpact: '₹3,300 potential recovery',
    createdAt: d(3), updatedAt: d(3),
  },
];

// ============================================
// CAMPAIGNS (2 completed)
// ============================================
const campaigns = [
  {
    PK: 'SELLER#seller-123', SK: 'CAMPAIGN#campaign-001',
    id: 'campaign-001', sellerId: 'seller-123', productId: 'prod-002',
    campaignType: 'discount_promotion', status: 'completed',
    title: 'Britannia Biscuits - 20% Off',
    message: '🎉 Special Offer! Britannia Biscuits now at ₹96 (20% off). Limited stock!',
    discountPercent: 20, targetCustomers: 45, messagesSent: 45, messagesDelivered: 42, conversions: 8,
    createdAt: d(14), completedAt: d(13),
  },
  {
    PK: 'SELLER#seller-aaa', SK: 'CAMPAIGN#campaign-002',
    id: 'campaign-002', sellerId: 'seller-aaa', productId: 'prod-204',
    campaignType: 'discount_promotion', status: 'completed',
    title: 'Wall Paint Clearance - 30% Off',
    message: '🏠 Home Improvement Sale! Wall Paint White 4L now at ₹595 (30% off)',
    discountPercent: 30, targetCustomers: 20, messagesSent: 20, messagesDelivered: 18, conversions: 3,
    createdAt: d(10), completedAt: d(9),
  },
];

// ============================================
// CUSTOMERS (5)
// ============================================
const customers = [
  { id: 'cust-001', phone: '+919876543220', name: 'Ramesh Kumar', age: 30 },
  { id: 'cust-002', phone: '+919876543221', name: 'Sunita Devi', age: 30 },
  { id: 'cust-003', phone: '+919876543222', name: 'Vikram Singh', age: 7 },
  { id: 'cust-004', phone: '+919876543223', name: 'Pooja Mehta', age: 14 },
  { id: 'cust-005', phone: '+919876543224', name: 'Arjun Reddy', age: 10 },
].map(c => ({
  PK: `CUSTOMER#${c.phone}`, SK: 'PROFILE',
  id: c.id, phoneNumber: c.phone, profileName: c.name, whatsappId: c.phone,
  createdAt: d(c.age), updatedAt: d(0),
}));

// ============================================
// WHATSAPP SESSIONS (5)
// ============================================
const sessions = [
  { id: 'session-001', cust: 'cust-001', phone: '+919876543220', state: 'browsing', age: 7 },
  { id: 'session-002', cust: 'cust-002', phone: '+919876543221', state: 'cart', age: 5 },
  { id: 'session-003', cust: 'cust-003', phone: '+919876543222', state: 'browsing', age: 3 },
  { id: 'session-004', cust: 'cust-004', phone: '+919876543223', state: 'checkout', age: 1 },
  { id: 'session-005', cust: 'cust-005', phone: '+919876543224', state: 'browsing', age: 2 },
].map(s => ({
  PK: `SESSION#${s.cust}`, SK: `WHATSAPP#${s.phone}`,
  id: s.id, customerId: s.cust, phoneNumber: s.phone, channelType: 'whatsapp',
  state: s.state, context: { cart: [], selectedCategory: null },
  createdAt: d(s.age), updatedAt: d(s.age), lastActivityAt: d(s.age),
}));

// ============================================
// AUDIT LOG ENTRIES (last 7 days)
// ============================================
const auditEntries = [
  { id: 'audit-001', actor: 'system', resource: 'SELLER#seller-ccc', action: 'SELLER_REGISTERED', desc: 'New seller registered: Verma Traders', age: 3 },
  { id: 'audit-002', actor: 'admin', resource: 'SELLER#seller-123', action: 'SELLER_APPROVED', desc: 'Seller approved: Gupta General Store', age: 5 },
  { id: 'audit-003', actor: 'system', resource: 'INSIGHT#insight-001', action: 'INSIGHT_GENERATED', desc: 'Dead stock alert generated for Britannia Biscuits', age: 7 },
  { id: 'audit-004', actor: 'seller-123', resource: 'CAMPAIGN#campaign-001', action: 'CAMPAIGN_EXECUTED', desc: 'Discount campaign sent to 45 customers', age: 6 },
  { id: 'audit-005', actor: 'system', resource: 'ORDER#order-001', action: 'ORDER_PAID', desc: 'Order #001 payment confirmed via Razorpay', age: 7 },
  { id: 'audit-006', actor: 'admin', resource: 'SELLER#seller-eee', action: 'SELLER_SUSPENDED', desc: 'Seller suspended: Suspicious Deals', age: 2 },
  { id: 'audit-007', actor: 'system', resource: 'INSIGHT#insight-005', action: 'INSIGHT_EXECUTED', desc: 'Wall Paint clearance campaign auto-executed', age: 1 },
  { id: 'audit-008', actor: 'system', resource: 'ORDER#order-004', action: 'ORDER_SHIPPED', desc: 'Order #004 marked as shipped', age: 3 },
  { id: 'audit-009', actor: 'system', resource: 'ORDER#order-006', action: 'ORDER_DELIVERED', desc: 'Order #006 delivered successfully', age: 4 },
  { id: 'audit-010', actor: 'cust-001', resource: 'ORDER#order-007', action: 'ORDER_PLACED', desc: 'New order placed: Pressure Cooker 3L', age: 2 },
].map(a => ({
  PK: `AUDIT#${d(a.age).slice(0, 10)}`, SK: `AUDIT#${d(a.age)}#${a.id}`,
  id: a.id, actorId: a.actor, resourceId: a.resource,
  action: a.action, description: a.desc,
  timestamp: d(a.age), createdAt: d(a.age),
}));

// ============================================
// DRAGON STORE DEMO DATA (Order Confirmation Flow)
// ============================================

// Dragon Store products for order flow demo
const dragonStoreProducts = [
  {
    PK: 'PRODUCT#demo-amul-butter', SK: 'METADATA',
    id: 'demo-amul-butter', sellerId: 'seller-dragon', categoryId: 'cat-groceries',
    name: 'Amul Butter 500g', description: 'Amul Butter 500g',
    price: 280, originalPrice: 280, stockQuantity: 45, reserved_stock: 0,
    stockAddedDate: d(7), isActive: true, isDeadStock: false, imageUrls: [],
    createdAt: d(7), updatedAt: d(0),
  },
  {
    PK: 'PRODUCT#demo-surf-excel', SK: 'METADATA',
    id: 'demo-surf-excel', sellerId: 'seller-dragon', categoryId: 'cat-groceries',
    name: 'Surf Excel 1kg', description: 'Surf Excel 1kg',
    price: 199, originalPrice: 199, stockQuantity: 30, reserved_stock: 0,
    stockAddedDate: d(7), isActive: true, isDeadStock: false, imageUrls: [],
    createdAt: d(7), updatedAt: d(0),
  },
  {
    PK: 'PRODUCT#demo-usbc-cable', SK: 'METADATA',
    id: 'demo-usbc-cable', sellerId: 'seller-dragon', categoryId: 'cat-electronics',
    name: 'USB-C Cable 1m', description: 'USB-C Cable 1m',
    price: 149, originalPrice: 149, stockQuantity: 100, reserved_stock: 0,
    stockAddedDate: d(7), isActive: true, isDeadStock: false, imageUrls: [],
    createdAt: d(7), updatedAt: d(0),
  },
];

// Seller index entries for Dragon Store products
const dragonStoreProductIndex = dragonStoreProducts.map(p => ({
  PK: 'SELLER#seller-dragon', SK: `PRODUCT#${p.id}`,
  productId: p.id, name: p.name, price: p.price,
  stockQuantity: p.stockQuantity, isActive: true,
}));

// Dragon Store seller profile
const dragonSeller = {
  PK: 'USER#seller-dragon', SK: 'PROFILE',
  id: 'seller-dragon', userId: 'seller-dragon', role: 'seller', status: 'active',
  businessName: 'Dragon Store', ownerName: 'Dragon Store Owner',
  phone: '+918927049085', razorpayAccountId: 'acc_test_dragon',
  businessAddress: { addressLine1: '42 Market Road', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
  gstNumber: 'GSTDRAGON', totalRevenue: 0,
  createdAt: d(30), updatedAt: d(0),
};

// Enigma customer profile
const enigmaCustomer = {
  PK: 'CUSTOMER#+917001124396', SK: 'PROFILE',
  id: 'cust-enigma', phoneNumber: '+917001124396',
  profileName: 'Enigma', displayName: 'Enigma', whatsappId: '+917001124396',
  phoneVerificationStatus: 'verified', preferredChannel: 'both',
  createdAt: d(14), updatedAt: d(0),
};

// All Dragon Store items that need conditional (idempotent) writes
const dragonStoreItems = [
  ...dragonStoreProducts,
  ...dragonStoreProductIndex,
  dragonSeller,
  enigmaCustomer,
];

// ============================================
// COMBINE ALL DATA (batch-written, existing data)
// ============================================
const allItems = [
  ...categories,
  ...sellers,
  demoSellerLink,
  ...products,
  ...orders,
  ...insights,
  ...approvals,
  ...campaigns,
  ...customers,
  ...sessions,
  ...auditEntries,
];

/**
 * Seed a single item with conditional write for idempotency.
 * Uses attribute_not_exists(PK) to skip if already present.
 */
async function seedItemIdempotent(item: Record<string, unknown>): Promise<'created' | 'already_exists'> {
  try {
    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    return 'created';
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'ConditionalCheckFailedException') {
      return 'already_exists';
    }
    throw err;
  }
}

async function seedDatabase() {
  console.log('🌱 Starting comprehensive demo data seeding...');
  console.log(`📊 Total batch items to seed: ${allItems.length}`);
  console.log(`📊 Total Dragon Store items (idempotent): ${dragonStoreItems.length}`);

  // --- Phase 1: Batch write existing demo data ---
  const batchSize = 25;
  const batches: typeof allItems[] = [];
  for (let i = 0; i < allItems.length; i += batchSize) {
    batches.push(allItems.slice(i, i + batchSize));
  }

  console.log(`📦 Split into ${batches.length} batches`);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`⏳ Batch ${i + 1}/${batches.length} (${batch.length} items)...`);

    const command = new BatchWriteCommand({
      RequestItems: {
        [TABLE_NAME]: batch.map(item => ({ PutRequest: { Item: item } })),
      },
    });

    try {
      const response = await docClient.send(command);
      if (response.UnprocessedItems && Object.keys(response.UnprocessedItems).length > 0) {
        console.warn(`  ⚠️ Unprocessed items in batch ${i + 1}`);
      } else {
        console.log(`  ✅ Batch ${i + 1} done`);
      }
    } catch (error) {
      console.error(`  ❌ Batch ${i + 1} failed:`, error);
      throw error;
    }
  }

  // --- Phase 2: Idempotent Dragon Store demo data ---
  console.log('\n🐉 Seeding Dragon Store demo data (idempotent)...');
  for (const item of dragonStoreItems) {
    const pk = item.PK as string;
    const sk = item.SK as string;
    const status = await seedItemIdempotent(item);
    console.log(`  ${status === 'created' ? '✅' : '⏭️'} PK=${pk}, SK=${sk} — ${status}`);
  }

  console.log('\n🎉 Demo data seeding complete!');
  console.log(`\n📋 Summary:`);
  console.log(`  - ${categories.length} Categories`);
  console.log(`  - ${sellers.length + 1} Sellers (4 active, 3 pending, 1 suspended) + Dragon Store`);
  console.log(`  - ${productDefs.length + dragonStoreProducts.length} Products across 6 categories (incl. Dragon Store)`);
  console.log(`  - ${orderDefs.length} Orders across multiple statuses`);
  console.log(`  - ${insights.length} AI Insights (3 pending, 1 approved, 1 executed)`);
  console.log(`  - ${approvals.length} Approval Items`);
  console.log(`  - ${campaigns.length} Completed Campaigns`);
  console.log(`  - ${customers.length + 1} Customers (incl. Enigma)`);
  console.log(`  - ${sessions.length} WhatsApp Sessions`);
  console.log(`  - ${auditEntries.length} Audit Log Entries`);
}

seedDatabase()
  .then(() => { console.log('\n✨ All done!'); process.exit(0); })
  .catch((err) => { console.error('\n💥 Failed:', err); process.exit(1); });
