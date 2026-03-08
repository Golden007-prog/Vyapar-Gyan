'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  User,
  Phone,
  Globe,
  MessageSquare,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import {
  getProfile,
  updatePreferences,
  initiatePhoneChange,
  verifyPhoneChange,
  disconnectWhatsApp,
  deleteAccount,
  type UserProfile,
} from '@/lib/api-account';

// --- Constants ---

const CHANNEL_OPTIONS: { value: UserProfile['preferredChannel']; label: string }[] = [
  { value: 'web', label: 'Web Chat' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'both', label: 'Both' },
];

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'ta', label: 'தமிழ் (Tamil)' },
  { value: 'te', label: 'తెలుగు (Telugu)' },
  { value: 'mr', label: 'मराठी (Marathi)' },
  { value: 'bn', label: 'বাংলা (Bengali)' },
  { value: 'gu', label: 'ગુજરાતી (Gujarati)' },
  { value: 'kn', label: 'ಕನ್ನಡ (Kannada)' },
];

// --- Page ---

export default function AccountPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Preference state
  const [savingPref, setSavingPref] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<UserProfile['preferredChannel']>('web');
  const [selectedLang, setSelectedLang] = useState('en');

  // Phone change state
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneStep, setPhoneStep] = useState<'input' | 'otp'>('input');
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState('');

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // WhatsApp disconnect
  const [disconnecting, setDisconnecting] = useState(false);

  // Load profile
  useEffect(() => {
    setLoading(true);
    getProfile()
      .then((p) => {
        setProfile(p);
        setSelectedChannel(p.preferredChannel);
      })
      .catch(() => {
        // Demo profile fallback
        const demo: UserProfile = {
          userId: 'demo-customer-001',
          role: 'customer',
          displayName: 'Demo Customer',
          phoneNumber: '+919000000003',
          phoneVerificationStatus: 'verified',
          preferredChannel: 'both',
          whatsappConnected: true,
          status: 'active',
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: new Date().toISOString(),
        };
        setProfile(demo);
        setSelectedChannel(demo.preferredChannel);
      })
      .finally(() => setLoading(false));
  }, []);

  const showSuccess = useCallback((msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  }, []);

  // --- Preference handlers ---

  const handleChannelChange = async (channel: UserProfile['preferredChannel']) => {
    setSelectedChannel(channel);
    setSavingPref(true);
    try {
      await updatePreferences({ preferredChannel: channel });
      setProfile((p) => (p ? { ...p, preferredChannel: channel } : p));
      showSuccess('Channel preference updated');
    } catch {
      setSelectedChannel(profile?.preferredChannel ?? 'web');
    } finally {
      setSavingPref(false);
    }
  };

  const handleLanguageChange = async (lang: string) => {
    setSelectedLang(lang);
    setSavingPref(true);
    try {
      await updatePreferences({ language: lang });
      showSuccess('Language preference updated');
    } catch {
      // revert silently
    } finally {
      setSavingPref(false);
    }
  };

  // --- Phone change handlers ---

  const handlePhoneSendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(newPhone)) {
      setPhoneError('Enter a valid 10-digit Indian mobile number');
      return;
    }
    setPhoneLoading(true);
    setPhoneError('');
    try {
      await initiatePhoneChange(newPhone);
      setPhoneStep('otp');
    } catch (err: any) {
      setPhoneError(err.message || 'Failed to send OTP');
    } finally {
      setPhoneLoading(false);
    }
  };

  const handlePhoneVerify = async () => {
    if (!/^\d{6}$/.test(phoneOtp)) {
      setPhoneError('Enter a valid 6-digit OTP');
      return;
    }
    setPhoneLoading(true);
    setPhoneError('');
    try {
      await verifyPhoneChange(newPhone, phoneOtp);
      setProfile((p) => (p ? { ...p, phoneNumber: newPhone, phoneVerificationStatus: 'verified' } : p));
      setPhoneModalOpen(false);
      resetPhoneModal();
      showSuccess('Phone number updated');
    } catch (err: any) {
      setPhoneError(err.message || 'Verification failed');
    } finally {
      setPhoneLoading(false);
    }
  };

  const resetPhoneModal = () => {
    setNewPhone('');
    setPhoneOtp('');
    setPhoneStep('input');
    setPhoneError('');
  };

  // --- WhatsApp disconnect ---

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectWhatsApp();
      setProfile((p) =>
        p ? { ...p, whatsappConnected: false, preferredChannel: 'web' } : p,
      );
      setSelectedChannel('web');
      showSuccess('WhatsApp disconnected');
    } catch (err: any) {
      setError(err.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  // --- Account deletion ---

  const handleDelete = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setDeleting(true);
    try {
      await deleteAccount();
      router.push('/login');
    } catch (err: any) {
      setError(err.message || 'Failed to delete account');
      setDeleting(false);
    }
  };

  // --- Render ---

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-lg font-semibold text-gray-900">Account</h1>

      {/* Success toast */}
      {successMsg && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-700">
          <CheckCircle2 className="h-4 w-4" />
          {successMsg}
        </div>
      )}

      {/* Profile Info */}
      <section className="mt-4 rounded-lg border bg-white p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100">
            <User className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{profile.displayName}</p>
            <p className="text-xs text-gray-500">{profile.role}</p>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-gray-400" />
            <span>+91 {profile.phoneNumber}</span>
            <span
              className={`text-xs ${
                profile.phoneVerificationStatus === 'verified'
                  ? 'text-green-600'
                  : 'text-yellow-600'
              }`}
            >
              ({profile.phoneVerificationStatus})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-gray-400" />
            <span>WhatsApp: {profile.whatsappConnected ? 'Connected' : 'Not connected'}</span>
          </div>
        </div>
      </section>

      {/* Preferences */}
      <section className="mt-4 rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-800">Preferences</h2>

        {/* Preferred Channel */}
        <div className="mt-3">
          <label className="text-xs font-medium text-gray-500">Preferred Channel</label>
          <div className="mt-1.5 flex gap-2">
            {CHANNEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleChannelChange(opt.value)}
                disabled={savingPref}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  selectedChannel === opt.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Language */}
        <div className="mt-4">
          <label className="text-xs font-medium text-gray-500">Language</label>
          <div className="mt-1.5 flex items-center gap-2">
            <Globe className="h-4 w-4 text-gray-400" />
            <select
              value={selectedLang}
              onChange={(e) => handleLanguageChange(e.target.value)}
              disabled={savingPref}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Phone Change */}
      <section className="mt-4 rounded-lg border bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Phone Number</h2>
            <p className="text-xs text-gray-500">+91 {profile.phoneNumber}</p>
          </div>
          <button
            onClick={() => {
              resetPhoneModal();
              setPhoneModalOpen(true);
            }}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Change
          </button>
        </div>
      </section>

      {/* WhatsApp Disconnect */}
      {profile.whatsappConnected && (
        <section className="mt-4 rounded-lg border bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">WhatsApp</h2>
              <p className="text-xs text-gray-500">
                Disconnect WhatsApp. Your message history will be preserved.
              </p>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="rounded-lg border border-orange-300 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </section>
      )}

      {/* Danger Zone */}
      <section className="mt-6 rounded-lg border border-red-200 bg-red-50/50 p-4">
        <h2 className="text-sm font-semibold text-red-800">Danger Zone</h2>
        <p className="mt-1 text-xs text-red-600">
          Deleting your account is permanent after 30 days. Your data will be anonymized.
        </p>
        <button
          onClick={() => setDeleteModalOpen(true)}
          className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700"
        >
          Delete Account
        </button>
      </section>

      {/* Phone Change Modal */}
      {phoneModalOpen && (
        <Modal onClose={() => setPhoneModalOpen(false)} title="Change Phone Number">
          {phoneStep === 'input' ? (
            <>
              <p className="text-sm text-gray-600">
                Enter your new phone number. We&apos;ll send an OTP to verify it.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-gray-500">+91</span>
                <input
                  type="tel"
                  maxLength={10}
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, ''))}
                  placeholder="10-digit number"
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              {phoneError && (
                <p className="mt-2 text-xs text-red-600">{phoneError}</p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setPhoneModalOpen(false)}
                  className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePhoneSendOtp}
                  disabled={phoneLoading}
                  className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {phoneLoading ? 'Sending...' : 'Send OTP'}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600">
                Enter the 6-digit code sent to +91 {newPhone}
              </p>
              <input
                type="text"
                maxLength={6}
                value={phoneOtp}
                onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-center text-lg tracking-widest focus:border-indigo-500 focus:outline-none"
              />
              {phoneError && (
                <p className="mt-2 text-xs text-red-600">{phoneError}</p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => {
                    setPhoneStep('input');
                    setPhoneOtp('');
                    setPhoneError('');
                  }}
                  className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
                >
                  Back
                </button>
                <button
                  onClick={handlePhoneVerify}
                  disabled={phoneLoading}
                  className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {phoneLoading ? 'Verifying...' : 'Verify'}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteModalOpen && (
        <Modal onClose={() => setDeleteModalOpen(false)} title="Delete Account">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm text-gray-700">
                This will schedule your account for permanent deletion. You have 30 days to
                reactivate. After that, all personal data will be anonymized.
              </p>
              <p className="mt-3 text-sm text-gray-700">
                Type <span className="font-mono font-bold">DELETE</span> to confirm:
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
              />
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => {
                setDeleteModalOpen(false);
                setDeleteConfirmText('');
              }}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={deleteConfirmText !== 'DELETE' || deleting}
              className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete My Account'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Modal Component ---

function Modal({
  children,
  title,
  onClose,
}: {
  children: React.ReactNode;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
