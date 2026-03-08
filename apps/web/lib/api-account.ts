/**
 * Account API Client
 *
 * Functions for account management endpoints (JWT-protected).
 */

import { api } from './api-client';

// --- Types ---

export interface UserProfile {
  userId: string;
  role: string;
  displayName: string;
  phoneNumber: string;
  phoneVerificationStatus: 'unverified' | 'pending_otp' | 'verified' | 'failed';
  preferredChannel: 'whatsapp' | 'web' | 'both';
  whatsappConnected: boolean;
  businessName?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePreferencesPayload {
  preferredChannel?: 'whatsapp' | 'web' | 'both';
  displayName?: string;
  language?: string;
}

// --- API Functions ---

export async function getProfile(): Promise<UserProfile> {
  return api.get('/api/v1/account/profile');
}

export async function updatePreferences(
  payload: UpdatePreferencesPayload,
): Promise<{ success: boolean; updated: Record<string, unknown> }> {
  return api.put('/api/v1/account/preferences', payload);
}

export async function initiatePhoneChange(
  newPhoneNumber: string,
): Promise<{ success: boolean; message: string; cooldownSeconds: number }> {
  return api.post('/api/v1/account/phone/change', { newPhoneNumber });
}

export async function verifyPhoneChange(
  newPhoneNumber: string,
  otp: string,
): Promise<{ success: boolean; message: string; phoneNumber: string }> {
  return api.post('/api/v1/account/phone/change', { newPhoneNumber, otp });
}

export async function disconnectWhatsApp(): Promise<{ success: boolean; message: string }> {
  return api.post('/api/v1/account/whatsapp/disconnect');
}

export async function deleteAccount(): Promise<{ success: boolean; message: string; deletedAt: string }> {
  return api.delete('/api/v1/account');
}
