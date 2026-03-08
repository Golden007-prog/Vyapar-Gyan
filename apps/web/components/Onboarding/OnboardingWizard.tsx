'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  FileText,
  Phone,
  MessageCircle,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Upload,
  AlertCircle,
  Clock,
} from 'lucide-react';
import { WhatsAppOptIn } from '@/components/Onboarding/WhatsAppOptIn';
import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BusinessInfo {
  businessName: string;
  businessAddress: string;
  gstNumber: string;
  businessCategory: string;
}

interface DocumentUpload {
  idProof: File | null;
  businessProof: File | null;
}

interface PhoneVerification {
  phone: string;
  otpSent: boolean;
  otp: string;
  verified: boolean;
}

type Step = 'business_info' | 'documents' | 'phone_verify' | 'whatsapp_optin' | 'pending_approval';

const STEPS: { key: Step; label: string; icon: React.ReactNode }[] = [
  { key: 'business_info', label: 'Business Info', icon: <Building2 className="h-5 w-5" /> },
  { key: 'documents', label: 'Documents', icon: <FileText className="h-5 w-5" /> },
  { key: 'phone_verify', label: 'Phone Verify', icon: <Phone className="h-5 w-5" /> },
  { key: 'whatsapp_optin', label: 'WhatsApp', icon: <MessageCircle className="h-5 w-5" /> },
  { key: 'pending_approval', label: 'Approval', icon: <CheckCircle2 className="h-5 w-5" /> },
];

const BUSINESS_CATEGORIES = [
  'Grocery & Kirana',
  'Electronics',
  'Clothing & Fashion',
  'Home & Kitchen',
  'Health & Beauty',
  'Sports & Fitness',
  'Books & Stationery',
  'Jewellery & Accessories',
  'Food & Beverages',
  'Other',
];

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.vyapargyan.com';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface OnboardingWizardProps {
  userId: string;
  phone?: string;
  displayName?: string;
}

export function OnboardingWizard({ userId, phone: initialPhone, displayName }: OnboardingWizardProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<Step>('business_info');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Business Info
  const [business, setBusiness] = useState<BusinessInfo>({
    businessName: '',
    businessAddress: '',
    gstNumber: '',
    businessCategory: '',
  });

  // Step 2: Document Upload
  const [documents, setDocuments] = useState<DocumentUpload>({
    idProof: null,
    businessProof: null,
  });

  // Step 3: Phone Verification
  const [phoneState, setPhoneState] = useState<PhoneVerification>({
    phone: initialPhone || '',
    otpSent: false,
    otp: '',
    verified: !!initialPhone,
  });

  // Step 4: WhatsApp Opt-in
  const [whatsappOptedIn, setWhatsappOptedIn] = useState(false);

  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStep);

  // ---------------------------------------------------------------------------
  // Step navigation
  // ---------------------------------------------------------------------------

  const goNext = useCallback(() => {
    const idx = STEPS.findIndex((s) => s.key === currentStep);
    if (idx < STEPS.length - 1) {
      setCurrentStep(STEPS[idx + 1].key);
      setError('');
    }
  }, [currentStep]);

  const goBack = useCallback(() => {
    const idx = STEPS.findIndex((s) => s.key === currentStep);
    if (idx > 0) {
      setCurrentStep(STEPS[idx - 1].key);
      setError('');
    }
  }, [currentStep]);

  // ---------------------------------------------------------------------------
  // Step 1: Business Info submit
  // ---------------------------------------------------------------------------

  const handleBusinessSubmit = async () => {
    if (!business.businessName.trim()) {
      setError('Business name is required.');
      return;
    }
    if (!business.businessAddress.trim()) {
      setError('Business address is required.');
      return;
    }
    if (!business.businessCategory) {
      setError('Please select a business category.');
      return;
    }
    if (
      business.gstNumber &&
      !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(business.gstNumber)
    ) {
      setError('Please enter a valid GST number (e.g. 22AAAAA0000A1Z5).');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await api.put('/api/v1/account/preferences', {
        businessName: business.businessName,
        businessAddress: business.businessAddress,
        gstNumber: business.gstNumber || undefined,
        businessCategory: business.businessCategory,
      });
      goNext();
    } catch (err: any) {
      setError(err.message || 'Failed to save business info.');
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Step 2: Document Upload submit
  // ---------------------------------------------------------------------------

  const handleDocumentSubmit = async () => {
    if (!documents.idProof) {
      setError('Please upload your ID proof (Aadhaar, PAN, or Voter ID).');
      return;
    }
    if (!documents.businessProof) {
      setError('Please upload your business proof (GST certificate, shop license, etc.).');
      return;
    }

    setLoading(true);
    setError('');
    try {
      // Get presigned upload URLs
      for (const [docType, file] of Object.entries(documents)) {
        if (!file) continue;
        const { uploadUrl } = await api.post('/api/v1/seller/generate-upload-url', {
          fileName: file.name,
          fileType: file.type,
          category: docType === 'idProof' ? 'id_proof' : 'business_proof',
        });
        // Upload directly to S3
        await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': file.type },
          body: file,
        });
      }
      goNext();
    } catch (err: any) {
      setError(err.message || 'Failed to upload documents.');
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Step 3: Phone Verification
  // ---------------------------------------------------------------------------

  const handleSendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(phoneState.phone)) {
      setError('Please enter a valid 10-digit Indian mobile number.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await fetch(`${API_BASE_URL}/api/v1/auth/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: phoneState.phone }),
      });
      setPhoneState((prev) => ({ ...prev, otpSent: true }));
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (phoneState.otp.length !== 6) {
      setError('Please enter the 6-digit OTP.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/auth/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phoneState.phone,
          otp: phoneState.otp,
          userId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'OTP verification failed.');
      }
      setPhoneState((prev) => ({ ...prev, verified: true }));
      goNext();
    } catch (err: any) {
      setError(err.message || 'OTP verification failed.');
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Step 4: WhatsApp Opt-in confirm
  // ---------------------------------------------------------------------------

  const handleWhatsAppConfirm = async () => {
    setLoading(true);
    setError('');
    try {
      // Store consent record via API
      await api.put('/api/v1/account/preferences', {
        whatsappOptIn: whatsappOptedIn,
        preferredChannel: whatsappOptedIn ? 'both' : 'web',
      });
      goNext();
    } catch (err: any) {
      setError(err.message || 'Failed to save WhatsApp preference.');
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderStepIndicator = () => (
    <nav aria-label="Onboarding progress" className="mb-8">
      <ol className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const isActive = idx === currentStepIndex;
          const isCompleted = idx < currentStepIndex;
          return (
            <li key={step.key} className="flex flex-1 items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
                    isCompleted
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : isActive
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-gray-300 bg-white text-gray-400'
                  }`}
                >
                  {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : step.icon}
                </div>
                <span
                  className={`text-xs font-medium ${
                    isActive ? 'text-indigo-600' : isCompleted ? 'text-emerald-600' : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div
                  className={`mx-2 h-0.5 flex-1 ${
                    idx < currentStepIndex ? 'bg-emerald-500' : 'bg-gray-200'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );

  // ---------------------------------------------------------------------------
  // Step renderers
  // ---------------------------------------------------------------------------

  const renderBusinessInfo = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Tell us about your business</h3>
        <p className="mt-1 text-sm text-gray-600">
          This helps us set up your store on VyaparGyan.
        </p>
      </div>

      <div>
        <label htmlFor="ob-biz-name" className="block text-sm font-medium text-gray-700">
          Business name <span className="text-red-500">*</span>
        </label>
        <input
          id="ob-biz-name"
          type="text"
          required
          value={business.businessName}
          onChange={(e) => setBusiness((p) => ({ ...p, businessName: e.target.value }))}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="e.g. Sharma General Store"
          maxLength={100}
        />
      </div>

      <div>
        <label htmlFor="ob-biz-addr" className="block text-sm font-medium text-gray-700">
          Business address <span className="text-red-500">*</span>
        </label>
        <textarea
          id="ob-biz-addr"
          required
          value={business.businessAddress}
          onChange={(e) => setBusiness((p) => ({ ...p, businessAddress: e.target.value }))}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Shop no., street, area, city, state, PIN"
          rows={3}
          maxLength={500}
        />
      </div>

      <div>
        <label htmlFor="ob-biz-cat" className="block text-sm font-medium text-gray-700">
          Business category <span className="text-red-500">*</span>
        </label>
        <select
          id="ob-biz-cat"
          required
          value={business.businessCategory}
          onChange={(e) => setBusiness((p) => ({ ...p, businessCategory: e.target.value }))}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Select category</option>
          {BUSINESS_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="ob-gst" className="block text-sm font-medium text-gray-700">
          GST number <span className="text-xs text-gray-400">(optional)</span>
        </label>
        <input
          id="ob-gst"
          type="text"
          value={business.gstNumber}
          onChange={(e) => setBusiness((p) => ({ ...p, gstNumber: e.target.value.toUpperCase() }))}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="22AAAAA0000A1Z5"
          maxLength={15}
        />
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleBusinessSubmit}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Next'}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const renderDocumentUpload = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Upload verification documents</h3>
        <p className="mt-1 text-sm text-gray-600">
          We need these to verify your identity and business. Your documents are stored securely.
        </p>
      </div>

      {/* ID Proof */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          ID proof <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-500">Aadhaar card, PAN card, or Voter ID</p>
        <label
          htmlFor="ob-id-proof"
          className={`mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition ${
            documents.idProof
              ? 'border-emerald-300 bg-emerald-50'
              : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
          }`}
        >
          {documents.idProof ? (
            <>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-700">{documents.idProof.name}</span>
            </>
          ) : (
            <>
              <Upload className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-600">Click to upload</span>
            </>
          )}
          <input
            id="ob-id-proof"
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setDocuments((p) => ({ ...p, idProof: file }));
            }}
          />
        </label>
      </div>

      {/* Business Proof */}
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Business proof <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-gray-500">GST certificate, shop license, or trade license</p>
        <label
          htmlFor="ob-biz-proof"
          className={`mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition ${
            documents.businessProof
              ? 'border-emerald-300 bg-emerald-50'
              : 'border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
          }`}
        >
          {documents.businessProof ? (
            <>
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-700">{documents.businessProof.name}</span>
            </>
          ) : (
            <>
              <Upload className="h-5 w-5 text-gray-400" />
              <span className="text-sm text-gray-600">Click to upload</span>
            </>
          )}
          <input
            id="ob-biz-proof"
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              setDocuments((p) => ({ ...p, businessProof: file }));
            }}
          />
        </label>
      </div>

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button
          type="button"
          onClick={handleDocumentSubmit}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Uploading...' : 'Next'}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const renderPhoneVerification = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Verify your phone number</h3>
        <p className="mt-1 text-sm text-gray-600">
          We&apos;ll send a 6-digit OTP to confirm your number.
        </p>
      </div>

      {phoneState.verified ? (
        <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-4">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          <div>
            <p className="font-medium text-emerald-800">Phone verified</p>
            <p className="text-sm text-emerald-600">+91 {phoneState.phone}</p>
          </div>
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="ob-phone" className="block text-sm font-medium text-gray-700">
              Mobile number
            </label>
            <div className="mt-1 flex">
              <span className="inline-flex items-center rounded-l-lg border border-r-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-500">
                +91
              </span>
              <input
                id="ob-phone"
                type="tel"
                value={phoneState.phone}
                onChange={(e) =>
                  setPhoneState((p) => ({
                    ...p,
                    phone: e.target.value.replace(/\D/g, '').slice(0, 10),
                  }))
                }
                className="block w-full rounded-r-lg border border-gray-300 px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="9876543210"
                maxLength={10}
                disabled={phoneState.otpSent}
              />
            </div>
          </div>

          {!phoneState.otpSent ? (
            <button
              type="button"
              onClick={handleSendOtp}
              disabled={loading || phoneState.phone.length !== 10}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Sending OTP...' : 'Send OTP'}
            </button>
          ) : (
            <>
              <div>
                <label htmlFor="ob-otp" className="block text-sm font-medium text-gray-700">
                  Enter OTP
                </label>
                <input
                  id="ob-otp"
                  type="text"
                  inputMode="numeric"
                  value={phoneState.otp}
                  onChange={(e) =>
                    setPhoneState((p) => ({
                      ...p,
                      otp: e.target.value.replace(/\D/g, '').slice(0, 6),
                    }))
                  }
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-center text-lg font-semibold tracking-widest text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="• • • • • •"
                  maxLength={6}
                />
              </div>
              <button
                type="button"
                onClick={handleVerifyOtp}
                disabled={loading || phoneState.otp.length !== 6}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify OTP'}
              </button>
            </>
          )}
        </>
      )}

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        {phoneState.verified && (
          <button
            type="button"
            onClick={goNext}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );

  const renderWhatsAppOptIn = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-gray-900">Connect WhatsApp</h3>
        <p className="mt-1 text-sm text-gray-600">
          Get order updates, customer messages, and AI insights directly on WhatsApp.
        </p>
      </div>

      <WhatsAppOptIn
        userId={userId}
        checked={whatsappOptedIn}
        onChange={setWhatsappOptedIn}
      />

      <div className="flex justify-between pt-2">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <button
          type="button"
          onClick={handleWhatsAppConfirm}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Saving...' : whatsappOptedIn ? 'Enable & Continue' : 'Skip for now'}
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const renderPendingApproval = () => (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
        <Clock className="h-8 w-8 text-amber-600" />
      </div>

      <div>
        <h3 className="text-xl font-semibold text-gray-900">Application submitted!</h3>
        <p className="mt-2 text-sm text-gray-600">
          Your seller application is under review. Our team will verify your documents and
          approve your account within 24–48 hours.
        </p>
      </div>

      <div className="rounded-lg bg-gray-50 p-4 text-left">
        <h4 className="text-sm font-medium text-gray-700">What happens next?</h4>
        <ul className="mt-2 space-y-2 text-sm text-gray-600">
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
            Our team reviews your business details and documents
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
            You&apos;ll receive a notification once approved
          </li>
          <li className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
            Start listing products and receiving orders
          </li>
          {whatsappOptedIn && (
            <li className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500" />
              Get AI-powered business insights on WhatsApp
            </li>
          )}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => router.push('/seller')}
        className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
      >
        Go to Dashboard
      </button>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-lg border bg-white p-6 shadow-lg sm:p-8">
        {displayName && (
          <p className="mb-4 text-sm text-gray-600">
            Welcome, <span className="font-medium text-gray-900">{displayName}</span>! Let&apos;s set up your store.
          </p>
        )}

        {renderStepIndicator()}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {currentStep === 'business_info' && renderBusinessInfo()}
        {currentStep === 'documents' && renderDocumentUpload()}
        {currentStep === 'phone_verify' && renderPhoneVerification()}
        {currentStep === 'whatsapp_optin' && renderWhatsAppOptIn()}
        {currentStep === 'pending_approval' && renderPendingApproval()}
      </div>
    </div>
  );
}
