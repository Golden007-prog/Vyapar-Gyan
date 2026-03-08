'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  MessageSquare,
  Calendar,
  ArrowLeft,
  ArrowRight,
  Check,
  ShoppingCart,
  TrendingUp,
  Tag,
  Smile,
  Loader2,
} from 'lucide-react';
import {
  createCampaign,
  scheduleCampaign,
  estimateReach,
  type AudienceFilters,
} from '@/lib/api-campaigns';

// --- Step definitions ---
const STEPS = [
  { id: 'audience', label: 'Audience', icon: Users },
  { id: 'message', label: 'Message', icon: MessageSquare },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
] as const;

type StepId = (typeof STEPS)[number]['id'];

// Common emoji set for quick insert
const EMOJI_PICKER = ['🎉', '🔥', '💰', '⭐', '🛒', '✅', '❤️', '👋', '🎁', '📦', '💥', '🏷️'];

export default function NewCampaignPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<StepId>('audience');

  // Audience state
  const [filters, setFilters] = useState<AudienceFilters>({});
  const [reach, setReach] = useState<number | null>(null);
  const [reachLoading, setReachLoading] = useState(false);

  // Message state
  const [messageText, setMessageText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);

  // Schedule state
  const [scheduleType, setScheduleType] = useState<'now' | 'later'>('now');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('09:00');

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentStepIndex = STEPS.findIndex((s) => s.id === currentStep);

  // --- Audience helpers ---
  const toggleFilter = (key: 'cartAbandoners' | 'highSpenders', value: boolean) => {
    setFilters((prev) => ({ ...prev, [key]: value ? true : undefined }));
    setReach(null);
  };

  const togglePastPurchasers = () => {
    setFilters((prev) => ({
      ...prev,
      pastPurchasers: prev.pastPurchasers ? undefined : [],
    }));
    setReach(null);
  };

  const toggleCategoryInterest = () => {
    setFilters((prev) => ({
      ...prev,
      categoryInterest: prev.categoryInterest ? undefined : [],
    }));
    setReach(null);
  };

  const hasAnyFilter =
    filters.pastPurchasers !== undefined ||
    filters.cartAbandoners ||
    filters.highSpenders ||
    filters.categoryInterest !== undefined;

  const fetchReach = useCallback(async () => {
    if (!hasAnyFilter) return;
    setReachLoading(true);
    try {
      const res = await estimateReach(filters);
      setReach(res.estimatedReach);
    } catch {
      setReach(null);
    } finally {
      setReachLoading(false);
    }
  }, [filters, hasAnyFilter]);

  // --- Navigation ---
  const goNext = () => {
    const idx = currentStepIndex;
    if (idx < STEPS.length - 1) setCurrentStep(STEPS[idx + 1].id);
  };

  const goBack = () => {
    const idx = currentStepIndex;
    if (idx > 0) setCurrentStep(STEPS[idx - 1].id);
  };

  const canProceed = (): boolean => {
    if (currentStep === 'audience') return hasAnyFilter;
    if (currentStep === 'message') return messageText.trim().length > 0;
    return true;
  };

  // --- Submit ---
  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let scheduledAt: string | undefined;
      if (scheduleType === 'later' && scheduledDate) {
        scheduledAt = new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString();
      }

      const res = await createCampaign({
        messageText,
        audienceFilters: filters,
        scheduledAt,
      });

      // Auto-schedule the campaign
      await scheduleCampaign(res.campaign.campaignId);
      router.push('/seller/campaigns');
    } catch (err: any) {
      setError(err.message || 'Failed to create campaign');
    } finally {
      setSubmitting(false);
    }
  };

  // --- Emoji insert ---
  const insertEmoji = (emoji: string) => {
    setMessageText((prev) => prev + emoji);
    setShowEmoji(false);
  };

  // Minimum date for scheduler (today)
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push('/seller/campaigns')}
          className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Campaign</h1>
          <p className="text-sm text-gray-500">Compose and schedule a WhatsApp campaign</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center justify-between rounded-lg border bg-white p-4">
        {STEPS.map((step, idx) => {
          const isActive = step.id === currentStep;
          const isDone = idx < currentStepIndex;
          const Icon = step.icon;
          return (
            <div key={step.id} className="flex flex-1 items-center">
              <button
                onClick={() => idx <= currentStepIndex && setCurrentStep(step.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : isDone
                    ? 'text-green-700 hover:bg-green-50'
                    : 'text-gray-400'
                }`}
                disabled={idx > currentStepIndex}
              >
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : isDone
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {isDone ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                <span className="hidden sm:inline">{step.label}</span>
              </button>
              {idx < STEPS.length - 1 && (
                <div className={`mx-2 h-px flex-1 ${isDone ? 'bg-green-300' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="rounded-lg border bg-white p-6">
        {/* STEP 1: Audience */}
        {currentStep === 'audience' && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900">Select Audience</h2>
            <p className="text-sm text-gray-500">
              Choose who should receive this campaign. Opted-out customers are automatically excluded.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <FilterCard
                active={filters.pastPurchasers !== undefined}
                icon={<ShoppingCart className="h-5 w-5" />}
                title="Past Purchasers"
                description="Customers who bought from your store"
                onClick={togglePastPurchasers}
              />
              <FilterCard
                active={!!filters.cartAbandoners}
                icon={<Tag className="h-5 w-5" />}
                title="Cart Abandoners"
                description="Customers with carts older than 24h"
                onClick={() => toggleFilter('cartAbandoners', !filters.cartAbandoners)}
              />
              <FilterCard
                active={!!filters.highSpenders}
                icon={<TrendingUp className="h-5 w-5" />}
                title="High Spenders"
                description="Top 20% customers by total spend"
                onClick={() => toggleFilter('highSpenders', !filters.highSpenders)}
              />
              <FilterCard
                active={filters.categoryInterest !== undefined}
                icon={<Tag className="h-5 w-5" />}
                title="Category Interest"
                description="Browsed a category in last 30 days"
                onClick={toggleCategoryInterest}
              />
            </div>

            {/* Estimated reach */}
            <div className="flex items-center gap-4 rounded-lg bg-gray-50 p-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700">Estimated Reach</p>
                {reach !== null ? (
                  <p className="text-2xl font-bold text-indigo-600">
                    {reach.toLocaleString()} <span className="text-sm font-normal text-gray-500">customers</span>
                  </p>
                ) : (
                  <p className="text-sm text-gray-400">Select filters and estimate</p>
                )}
              </div>
              <button
                onClick={fetchReach}
                disabled={!hasAnyFilter || reachLoading}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {reachLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Estimate'}
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: Message */}
        {currentStep === 'message' && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900">Compose Message</h2>
            <p className="text-sm text-gray-500">
              Write your campaign message. Max 1024 characters.
            </p>

            <div className="space-y-2">
              <div className="relative">
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value.slice(0, 1024))}
                  rows={5}
                  placeholder="Type your campaign message here..."
                  className="w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <div className="flex items-center justify-between px-1 pt-1">
                  <button
                    onClick={() => setShowEmoji(!showEmoji)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <Smile className="h-5 w-5" />
                  </button>
                  <span className="text-xs text-gray-400">{messageText.length}/1024</span>
                </div>
                {showEmoji && (
                  <div className="absolute bottom-12 left-0 z-10 flex flex-wrap gap-1 rounded-lg border bg-white p-2 shadow-lg">
                    {EMOJI_PICKER.map((e) => (
                      <button
                        key={e}
                        onClick={() => insertEmoji(e)}
                        className="rounded p-1 text-xl hover:bg-gray-100"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* WhatsApp Preview */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-700">WhatsApp Preview</h3>
              <div className="mx-auto max-w-xs">
                <div className="rounded-2xl border-2 border-gray-800 bg-gray-800 p-2">
                  {/* Phone notch */}
                  <div className="mx-auto mb-2 h-5 w-20 rounded-full bg-gray-900" />
                  {/* Chat area */}
                  <div className="rounded-xl bg-[#e5ddd5] p-3" style={{ minHeight: 180 }}>
                    <div className="mb-1 text-center">
                      <span className="rounded-full bg-white/80 px-3 py-0.5 text-[10px] text-gray-500">
                        Today
                      </span>
                    </div>
                    {messageText ? (
                      <div className="ml-auto max-w-[85%] rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 shadow-sm">
                        <p className="whitespace-pre-wrap text-xs text-gray-800">{messageText}</p>
                        <p className="mt-1 text-right text-[9px] text-gray-500">
                          {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    ) : (
                      <p className="py-8 text-center text-xs text-gray-400">
                        Your message will appear here
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Schedule */}
        {currentStep === 'schedule' && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-gray-900">Schedule Campaign</h2>
            <p className="text-sm text-gray-500">
              Choose when to send. Messages during quiet hours (10 PM – 9 AM IST) are queued for 9 AM.
            </p>

            <div className="space-y-3">
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                  scheduleType === 'now' ? 'border-indigo-500 bg-indigo-50' : 'hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="schedule"
                  checked={scheduleType === 'now'}
                  onChange={() => setScheduleType('now')}
                  className="h-4 w-4 text-indigo-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">Send Now</p>
                  <p className="text-xs text-gray-500">Campaign will be sent immediately</p>
                </div>
              </label>

              <label
                className={`flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors ${
                  scheduleType === 'later' ? 'border-indigo-500 bg-indigo-50' : 'hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="schedule"
                  checked={scheduleType === 'later'}
                  onChange={() => setScheduleType('later')}
                  className="h-4 w-4 text-indigo-600"
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">Schedule for Later</p>
                  <p className="text-xs text-gray-500">Pick a date and time</p>
                </div>
              </label>

              {scheduleType === 'later' && (
                <div className="ml-7 flex gap-3">
                  <input
                    type="date"
                    value={scheduledDate}
                    min={today}
                    onChange={(e) => setScheduledDate(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                  <input
                    type="time"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Summary */}
            <div className="rounded-lg bg-gray-50 p-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Campaign Summary</h3>
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Audience filters</dt>
                  <dd className="font-medium text-gray-900">
                    {[
                      filters.pastPurchasers !== undefined && 'Past Purchasers',
                      filters.cartAbandoners && 'Cart Abandoners',
                      filters.highSpenders && 'High Spenders',
                      filters.categoryInterest !== undefined && 'Category Interest',
                    ]
                      .filter(Boolean)
                      .join(', ') || 'None'}
                  </dd>
                </div>
                {reach !== null && (
                  <div className="flex justify-between">
                    <dt className="text-gray-500">Estimated reach</dt>
                    <dd className="font-medium text-indigo-600">{reach.toLocaleString()}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-gray-500">Message length</dt>
                  <dd className="font-medium text-gray-900">{messageText.length} chars</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Send time</dt>
                  <dd className="font-medium text-gray-900">
                    {scheduleType === 'now'
                      ? 'Immediately'
                      : scheduledDate
                      ? `${scheduledDate} at ${scheduledTime}`
                      : 'Not set'}
                  </dd>
                </div>
              </dl>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
            )}
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={currentStepIndex === 0 ? () => router.push('/seller/campaigns') : goBack}
          className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" />
          {currentStepIndex === 0 ? 'Cancel' : 'Back'}
        </button>

        {currentStep === 'schedule' ? (
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {submitting ? 'Creating...' : 'Create Campaign'}
          </button>
        ) : (
          <button
            onClick={goNext}
            disabled={!canProceed()}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Next
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ---

function FilterCard({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
        active ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'
      }`}
    >
      <div className={`mt-0.5 ${active ? 'text-indigo-600' : 'text-gray-400'}`}>{icon}</div>
      <div>
        <p className={`text-sm font-medium ${active ? 'text-indigo-700' : 'text-gray-900'}`}>
          {title}
        </p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      {active && (
        <div className="ml-auto">
          <Check className="h-4 w-4 text-indigo-600" />
        </div>
      )}
    </button>
  );
}
