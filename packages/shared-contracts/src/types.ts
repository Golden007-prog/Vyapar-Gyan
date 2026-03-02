/**
 * Shared TypeScript types and interfaces for VyaparGyan platform
 * These types align with the DynamoDB schema and API contracts
 */

// ============================================================================
// Common Types
// ============================================================================

export type EntityId = string;
export type Timestamp = string; // ISO 8601 format
export type PhoneNumber = string; // E.164 format (e.g., "919876543210")

// ============================================================================
// Product Types
// ============================================================================

export interface Product {
  id: EntityId;
  sellerId: EntityId;
  categoryId: EntityId;
  name: string;
  description: string;
  price: number;
  originalPrice: number;
  discountedPrice: number | null;
  isDeadStock: boolean;
  stockQuantity: number;
  stockAddedDate: Timestamp;
  imageUrls: string[];
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateProductInput {
  sellerId: EntityId;
  categoryId: EntityId;
  name: string;
  description: string;
  price: number;
  stockQuantity: number;
  imageUrls?: string[];
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  price?: number;
  originalPrice?: number;
  discountedPrice?: number | null;
  isDeadStock?: boolean;
  stockQuantity?: number;
  imageUrls?: string[];
  isActive?: boolean;
}

// ============================================================================
// Order Types
// ============================================================================

export type OrderStatus = 
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export interface OrderItem {
  productId: EntityId;
  name: string;
  price: number;
  quantity: number;
}

export interface ShippingAddress {
  name: string;
  phone: PhoneNumber;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
}

export interface Order {
  id: EntityId;
  customerId: EntityId;
  sellerId: EntityId;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  commissionRate: number;
  commissionAmount: number;
  sellerAmount: number;
  shippingAddress: ShippingAddress;
  paymentId: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface CreateOrderInput {
  customerId: EntityId;
  sellerId: EntityId;
  items: OrderItem[];
  shippingAddress: ShippingAddress;
  commissionRate?: number; // Default from platform config
}

// ============================================================================
// Seller Metrics Types
// ============================================================================

export interface SellerMetrics {
  sellerId: EntityId;
  year: number;
  month: number;
  totalRevenue: number;
  totalOrders: number;
  totalCommission: number;
  netRevenue: number;
  productsSold: number;
  averageOrderValue: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// Category Types
// ============================================================================

export interface Category {
  id: EntityId;
  name: string;
  description: string;
  imageUrl: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// Customer Types
// ============================================================================

export interface Customer {
  id: EntityId;
  phoneNumber: PhoneNumber;
  profileName: string;
  whatsappId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// Session Types
// ============================================================================

export type SessionState = 
  | 'greeting'
  | 'browsing'
  | 'viewing_product'
  | 'cart'
  | 'checkout'
  | 'order_placed';

export type ChannelType = 'whatsapp' | 'web';

export interface SessionContext {
  cart?: OrderItem[];
  selectedCategory?: EntityId;
  selectedProduct?: EntityId;
  shippingDraft?: Partial<ShippingAddress>;
  [key: string]: any;
}

export interface Session {
  id: EntityId;
  customerId: EntityId;
  phoneNumber: PhoneNumber;
  channelType: ChannelType;
  state: SessionState;
  context: SessionContext;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastActivityAt: Timestamp;
}

// ============================================================================
// Message Types
// ============================================================================

export type MessageDirection = 'inbound' | 'outbound';
export type MessageType = 'text' | 'interactive' | 'image' | 'audio';
export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface Message {
  sessionId: EntityId;
  waMessageId: string;
  direction: MessageDirection;
  messageType: MessageType;
  content: any; // Flexible content structure
  waStatus?: MessageStatus;
  createdAt: Timestamp;
  ttl?: number;
}

// ============================================================================
// Seller Types
// ============================================================================

export type SellerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface Seller {
  id: EntityId;
  userId: EntityId;
  businessName: string;
  ownerName: string;
  phoneNumber: PhoneNumber;
  email: string;
  status: SellerStatus;
  documentUrls: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// User Types
// ============================================================================

export type UserRole = 'admin' | 'seller' | 'customer';

export interface User {
  id: EntityId;
  email: string;
  phoneNumber: PhoneNumber;
  role: UserRole;
  cognitoId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
