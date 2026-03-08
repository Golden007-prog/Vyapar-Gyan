'use client';

import { useState } from 'react';
import { MessageCircle, Bell, ShieldCheck, Volume2 } from 'lucide-react';
import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WhatsAppOptInProps {
  /** Current user ID — used to store CONSENT#{userId} WHATSAPP_OPTIN record */
  userId: string;
  /** Controlled checkbox state */
  checked: boolean;
  /** Callback when the checkbox value changes */
  onChange: (checked: boolean) => void;
  /** If true, immediately persists the consent record on toggle (standalone usage) */
  persistOnChange?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Explicit WhatsApp opt-in checkbox with explanation text.
 *
 * When confirmed, stores a CONSENT#{userId} WHATSAPP_OPTIN record via the
 * account preferences API. This record tracks:
 *   - optedIn: boolean
 *   - optedInAt: ISO timestamp
 *   - optInMethod: 'registration'
 *   - optedOut: false
 *   - suppressPromotional: false
 *
 * Used in the OnboardingWizard (step 4) and can also be used standalone
 * in account settings.
 */
export function WhatsAppOptIn({ userId, checked, onChange, persistOnChange = false }: WhatsAppOptInProps) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleToggle = async () => {
    const newValue = !checked;
    onChange(newValue);

    if (!persistOnChange) return;

    // Persist immediately when used standalone (e.g. in account settings)
    setSaving(true);
    setSaveError('');
    try {
      await api.put('/api/v1/account/preferences', {
        whatsappOptIn: newValue,
        preferredChannel: newValue ? 'both' : 'web',
      });
    } catch (err: any) {
      setSaveError(err.message || 'Failed to update preference.');
      // Revert on failure
      onChange(!newValue);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Benefits list */}
      <div className="rounded-lg bg-emerald-50 p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <MessageCircle className="h-4 w-4" />
          Why connect WhatsApp?
        </h4>
        <ul className="mt-3 space-y-2.5">
          <li className="flex items-start gap-2.5 text-sm text-emerald-700">
            <Bell className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>Receive order notifications and customer messages instantly</span>
          </li>
          <li className="flex items-start gap-2.5 text-sm text-emerald-700">
            <Volume2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>Get AI-powered business insights and pricing recommendations</span>
          </li>
          <li className="flex items-start gap-2.5 text-sm text-emerald-700">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>Manage your store on the go — reply to customers, approve actions, check inventory</span>
          </li>
        </ul>
      </div>

      {/* Opt-in checkbox */}
      <label
        htmlFor={`whatsapp-optin-${userId}`}
        className={`flex cursor-pointer items-start gap-3 rounded-lg border-2 p-4 transition ${
          checked
            ? 'border-emerald-500 bg-emerald-50'
            : 'border-gray-200 hover:border-gray-300'
        }`}
      >
        <input
          id={`whatsapp-optin-${userId}`}
          type="checkbox"
          checked={checked}
          onChange={handleToggle}
          disabled={saving}
          className="mt-0.5 h-5 w-5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-900">
            Yes, I want to receive messages on WhatsApp
          </p>
          <p className="mt-1 text-xs text-gray-500">
            By opting in, you agree to receive order updates, customer messages, and
            promotional notifications from VyaparGyan on your registered WhatsApp number.
            You can opt out anytime by sending &quot;STOP&quot; on WhatsApp or from your account settings.
          </p>
        </div>
      </label>

      {/* Privacy note */}
      <p className="text-xs text-gray-400">
        We respect your privacy. Your phone number is only used for platform communications.
        Promotional messages are limited to 3 per day and never sent between 10 PM – 9 AM IST.
      </p>

      {saveError && (
        <p className="text-xs text-red-600">{saveError}</p>
      )}
    </div>
  );
}
