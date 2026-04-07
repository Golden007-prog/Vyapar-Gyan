/**
 * Zod validation schemas for Omnichannel Commerce API
 *
 * Covers all request/response types from design Section 2:
 * - Auth & OTP (2.1)
 * - Chat & Sync (2.2)
 * - Cart (2.3)
 * - Approval Engine (2.4)
 * - Campaign (2.5)
 */

import { z } from 'zod';

// ============================================================================
// Regex patterns
// ============================================================================

/** Indian mobile number: starts with 6-9, followed by 9 digits */
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

/** GST number format */
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// ============================================================================
// 2.1 Authentication & OTP Schemas
// ============================================================================

export const SendOTPSchema = z.object({
  phoneNumber: z.string().regex(INDIAN_MOBILE_REGEX, 'Invalid Indian mobile number'),
});
export type SendOTPInput = z.infer<typeof SendOTPSchema>;

export const VerifyOTPSchema = z.object({
  phoneNumber: z.string().regex(INDIAN_MOBILE_REGEX, 'Invalid Indian mobile number'),
  otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
  userId: z.string().uuid().optional(),
});
export type VerifyOTPInput = z.infer<typeof VerifyOTPSchema>;

export const RegisterSchema = z.object({
  role: z.enum(['customer', 'seller']),
  phoneNumber: z.string().regex(INDIAN_MOBILE_REGEX, 'Invalid Indian mobile number'),
  displayName: z.string().min(2).max(100),
  password: z.string().min(8),
  businessName: z.string().min(2).max(100).optional(),
  businessAddress: z.string().max(500).optional(),
  gstNumber: z.string().regex(GST_REGEX, 'Invalid GST number').optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

// ============================================================================
// 2.2 Chat & Sync Schemas
// ============================================================================

export const SyncQuerySchema = z.object({
  lastSyncTimestamp: z.string().optional(),
  cartVersion: z.coerce.number().optional(),
});
export type SyncQueryInput = z.infer<typeof SyncQuerySchema>;

export const SendMessageSchema = z.object({
  content: z.string().min(1).max(4096),
  messageType: z.enum(['text', 'image', 'product_card']).default('text'),
  sellerId: z.string().min(1).optional(),
  productContext: z
    .object({
      productId: z.string(),
      name: z.string(),
      price: z.number(),
    })
    .optional(),
  correlationId: z.string().optional(),
});
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

// ============================================================================
// 2.3 Cart Schemas
// ============================================================================

export const AddToCartSchema = z.object({
  productId: z.string(),
  quantity: z.coerce.number().int().min(1).max(99),
});
export type AddToCartInput = z.infer<typeof AddToCartSchema>;

// ============================================================================
// 2.4 Approval Engine Schemas
// ============================================================================

export const ApprovalsQuerySchema = z.object({
  status: z.enum(['pending_review', 'approved', 'rejected', 'all']).default('pending_review'),
  limit: z.coerce.number().min(1).max(50).default(20),
  cursor: z.string().optional(),
});
export type ApprovalsQueryInput = z.infer<typeof ApprovalsQuerySchema>;

export const RejectSchema = z.object({
  rejectionReason: z.string().min(1).max(500),
});
export type RejectInput = z.infer<typeof RejectSchema>;

// ============================================================================
// 2.5 Campaign Schemas
// ============================================================================

export const CreateCampaignSchema = z.object({
  approvalId: z.string().uuid().optional(),
  messageText: z.string().min(1).max(1024),
  templateSid: z.string().optional(),
  audienceFilters: z.object({
    pastPurchasers: z.array(z.string()).optional(),
    cartAbandoners: z.boolean().optional(),
    highSpenders: z.boolean().optional(),
    categoryInterest: z.array(z.string()).optional(),
  }),
  scheduledAt: z.string().datetime().optional(),
});
export type CreateCampaignInput = z.infer<typeof CreateCampaignSchema>;

// ============================================================================
// 2.7 Account Management Schemas
// ============================================================================

export const UpdatePreferencesSchema = z.object({
  preferredChannel: z.enum(['whatsapp', 'web', 'both']).optional(),
  displayName: z.string().min(2).max(100).optional(),
  language: z.string().min(2).max(10).optional(),
});
export type UpdatePreferencesInput = z.infer<typeof UpdatePreferencesSchema>;

export const PhoneChangeSchema = z.object({
  newPhoneNumber: z.string().regex(INDIAN_MOBILE_REGEX, 'Invalid Indian mobile number'),
  otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits').optional(),
});
export type PhoneChangeInput = z.infer<typeof PhoneChangeSchema>;


// ============================================================================
// 2.8 Catalog API Schemas
// ============================================================================

export const CatalogProductsQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().max(200).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z.enum(['price_asc', 'price_desc', 'newest', 'popularity']).default('newest'),
  limit: z.coerce.number().min(1).max(50).default(20),
  cursor: z.string().optional(),
});
export type CatalogProductsQueryInput = z.infer<typeof CatalogProductsQuerySchema>;

export const CatalogSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().min(1).max(50).default(20),
  cursor: z.string().optional(),
});
export type CatalogSearchQueryInput = z.infer<typeof CatalogSearchQuerySchema>;

// ============================================================================
// 3.0 OpenSearch Integration Schemas
// ============================================================================

/**
 * Search query parameters for GET /api/v1/search
 *
 * Validates: Requirements 5.6, 5.7
 */
export const SearchQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  seller: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().int().min(1).max(100).default(20),
});
export type SearchQueryInput = z.infer<typeof SearchQuerySchema>;

/**
 * Autocomplete query parameters for GET /api/v1/autocomplete
 *
 * Validates: Requirements 6.2, 6.4
 */
export const AutocompleteQuerySchema = z.object({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});
export type AutocompleteQueryInput = z.infer<typeof AutocompleteQuerySchema>;

/**
 * Individual product item returned in search results.
 *
 * Validates: Requirements 11.2
 */
export const SearchProductItemSchema = z.object({
  productId: z.string(),
  productName: z.string(),
  description: z.string(),
  category: z.string(),
  sellerId: z.string(),
  price: z.number(),
  stockQuantity: z.number().int(),
  imageUrls: z.array(z.string()),
  createdAt: z.string(),
});
export type SearchProductItem = z.infer<typeof SearchProductItemSchema>;

/**
 * Search response schema for GET /api/v1/search
 *
 * Validates: Requirements 5.7, 11.2
 */
export const SearchResponseSchema = z.object({
  items: z.array(SearchProductItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

/**
 * Individual autocomplete suggestion.
 *
 * Validates: Requirements 6.4, 11.3
 */
export const AutocompleteSuggestionSchema = z.object({
  name: z.string(),
  category: z.string(),
  productId: z.string(),
});
export type AutocompleteSuggestion = z.infer<typeof AutocompleteSuggestionSchema>;

/**
 * Autocomplete response schema for GET /api/v1/autocomplete
 *
 * Validates: Requirements 6.4, 11.3
 */
export const AutocompleteResponseSchema = z.object({
  suggestions: z.array(AutocompleteSuggestionSchema),
});
export type AutocompleteResponse = z.infer<typeof AutocompleteResponseSchema>;
