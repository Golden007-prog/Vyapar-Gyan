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


// ============================================================================
// Omnichannel Commerce — Enums & Shared Types
// ============================================================================

export type PhoneVerificationStatus = 'unverified' | 'pending_otp' | 'verified' | 'failed';

export type PreferredChannel = 'whatsapp' | 'web' | 'both';

export type UnifiedSessionState =
  | 'greeting'
  | 'browsing'
  | 'product_inquiry'
  | 'ordering'
  | 'payment'
  | 'tracking'
  | 'idle'
  | 'closed';

export type UnifiedChannelType = 'whatsapp' | 'web';

// MessageDirection already defined above as 'inbound' | 'outbound'

export type UnifiedMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'interactive'
  | 'product_card'
  | 'system';

export type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export type SenderRole = 'customer' | 'seller' | 'system';

export type ApprovalType =
  | 'discount'
  | 'campaign'
  | 'price_change'
  | 'stock_alert'
  | 'reorder_suggestion';

export type ApprovalStatus =
  | 'draft'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'edited_approved'
  | 'executed';

export type ConsentOptInMethod = 'registration' | 'user_initiated' | 'settings';

export type TemplateCategory = 'marketing' | 'utility' | 'authentication';

export type TemplateApprovalStatus = 'approved' | 'pending' | 'rejected';

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';

export type AuditActorRole = 'admin' | 'seller' | 'system';

export type ExtendedSellerStatus = 'pending_approval' | 'approved' | 'rejected' | 'suspended';

export type UserAccountStatus = 'active' | 'deleted';

// ============================================================================
// 1.1 User Profile Entity
// ============================================================================

export interface UserProfile {
  userId: string;
  role: UserRole;
  displayName: string;
  phoneNumber: string;
  phoneVerificationStatus: PhoneVerificationStatus;
  preferredChannel: PreferredChannel;
  whatsappConnected: boolean;
  businessName?: string;
  businessAddress?: string;
  gstNumber?: string;
  sellerStatus?: ExtendedSellerStatus;
  cognitoId: string;
  status: UserAccountStatus;
  deletedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// 1.2 Unified Session Entity
// ============================================================================

export interface UnifiedSession {
  userId: string;
  state: UnifiedSessionState;
  lastActiveChannel: UnifiedChannelType;
  lastActivityAt: Timestamp;
  phoneNumber: string;
  createdAt: Timestamp;
  expiresAt: number; // TTL epoch seconds
}

// ============================================================================
// 1.3 Cart Entity
// ============================================================================

export interface UnifiedCartItem {
  productId: string;
  sellerId: string;
  name: string;
  price: number;
  quantity: number;
  thumbnailUrl?: string;
}

export interface Cart {
  userId: string;
  items: UnifiedCartItem[];
  subtotal: number;
  itemCount: number;
  cartVersion: number;
  updatedAt: Timestamp;
  expiresAt: number; // TTL epoch seconds
}

// ============================================================================
// 1.4 Message Thread Entity
// ============================================================================

export interface MessageThread {
  userId: string;
  messageId: string;
  direction: MessageDirection;
  channel: UnifiedChannelType;
  senderRole: SenderRole;
  messageType: UnifiedMessageType;
  content: unknown;
  deliveryStatus: DeliveryStatus;
  sentAt?: Timestamp;
  deliveredAt?: Timestamp;
  readAt?: Timestamp;
  failedAt?: Timestamp;
  errorCode?: string;
  createdAt: Timestamp;
  expiresAt: number; // TTL 30 days epoch seconds
}

// ============================================================================
// 1.5 OTP Entity
// ============================================================================

export interface OTPRecord {
  phoneNumber: string;
  otpHash: string; // SHA-256 hash
  failureCount: number;
  lockoutUntil?: Timestamp;
  createdAt: Timestamp;
  expiresAt: number; // TTL 10 min epoch seconds
}

// ============================================================================
// 1.6 Approval Record Entity
// ============================================================================

export interface ApprovalRecord {
  approvalId: string;
  sellerId: string;
  type: ApprovalType;
  status: ApprovalStatus;
  payload: Record<string, unknown>;
  originalPayload?: Record<string, unknown>;
  aiRationale: string;
  estimatedImpact: number;
  affectedProductIds: string[];
  priorityScore: number;
  approvedAt?: Timestamp;
  approvedBy?: string;
  rejectionReason?: string;
  scheduledFor?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// 1.7 Consent Record Entity
// ============================================================================

export interface WhatsAppOptInConsent {
  optedIn: boolean;
  optedInAt?: Timestamp;
  optInMethod: ConsentOptInMethod;
  optedOut: boolean;
  optedOutAt?: Timestamp;
  optOutMethod?: string;
  suppressPromotional: boolean;
}

export interface ServiceWindowConsent {
  serviceWindowExpiresAt: Timestamp;
  promotionalMessageCount: number;
  lastPromotionalResetAt: Timestamp;
}

export type ConsentRecord = WhatsAppOptInConsent | ServiceWindowConsent;

// ============================================================================
// 1.8 Template Registry Entity
// ============================================================================

export interface TemplateRegistry {
  templateSid: string;
  templateName: string;
  category: TemplateCategory;
  language: string;
  parameterSchema: Record<string, unknown>;
  approvalStatus: TemplateApprovalStatus;
  createdAt: Timestamp;
}

// ============================================================================
// 1.9 Campaign Entity (extended)
// ============================================================================

export interface AudienceFilters {
  pastPurchasers?: string[];
  cartAbandoners?: boolean;
  highSpenders?: boolean;
  categoryInterest?: string[];
}

export interface CampaignRecord {
  campaignId: string;
  sellerId: string;
  approvalId?: string;
  status: CampaignStatus;
  messageText: string;
  templateSid?: string;
  audienceFilters: AudienceFilters;
  estimatedReach: number;
  sentCount: number;
  deliveredCount: number;
  readCount: number;
  conversionCount: number;
  scheduledAt?: Timestamp;
  executedAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// 1.10 Audit Log Entity
// ============================================================================

export interface AuditLog {
  auditId: string;
  actorId: string;
  actorRole: AuditActorRole;
  actionType: string;
  resourceType: string;
  resourceId: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  approvalId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Timestamp;
  // No TTL — permanent retention
}

// ============================================================================
// 1.11 Restock Notification Entity
// ============================================================================

export interface RestockNotification {
  productId: string;
  userId: string;
  createdAt: Timestamp;
  expiresAt: number; // TTL 30 days epoch seconds
}

// ============================================================================
// AI Processing Types (Voice & Image)
// ============================================================================

export interface VoiceTranscription {
  transcript: string;
  products: Array<{ name: string; quantity: number; confidence: number }>;
  detectedLanguage: string;
}

export interface ProductImageAnalysis {
  category: string;
  color: string;
  material: string;
  style: string;
  brand: string | null;
  description: string;
}
