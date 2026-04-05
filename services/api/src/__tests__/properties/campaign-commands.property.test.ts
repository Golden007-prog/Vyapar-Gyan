/**
 * Property-Based Tests for Campaign Commands
 *
 * Tests campaign list formatting and command parsing for the
 * Seller Copilot WhatsApp campaign approval flow.
 *
 * Uses fast-check to verify invariants across randomised inputs.
 */

import * as fc from 'fast-check';
import {
  parseCampaignCommand,
  formatCampaignList,
} from '../../handlers/whatsapp/seller-copilot';
import type { CampaignRecord } from '../../adapters/dynamodb-adapter';

// ── Generators ─────────────────────────────────────────────────────────

/** Generate a valid CampaignRecord for testing */
const campaignRecordArb = fc.record({
  campaignId: fc.uuid(),
  sellerId: fc.uuid(),
  status: fc.constantFrom('draft' as const, 'scheduled' as const),
  messageText: fc.string({ minLength: 1, maxLength: 100 }),
  audienceFilters: fc.record({
    pastPurchasers: fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
    cartAbandoners: fc.boolean(),
    highSpenders: fc.boolean(),
    categoryInterest: fc.array(fc.string(), { minLength: 0, maxLength: 3 }),
  }),
  estimatedReach: fc.nat({ max: 10000 }),
  sentCount: fc.constant(0),
  deliveredCount: fc.constant(0),
  readCount: fc.constant(0),
  conversionCount: fc.constant(0),
  createdAt: fc.date().map(d => d.toISOString()),
  updatedAt: fc.date().map(d => d.toISOString()),
}) as fc.Arbitrary<CampaignRecord>;

/** Generate a positive integer for campaign index */
const positiveIntArb = fc.integer({ min: 1, max: 100 });

// ── Property 6: Campaign list formatting preserves all campaign details ──

describe('Property 6: Campaign list formatting preserves all campaign details', () => {
  /**
   * **Validates: Requirements 5.1, 5.5**
   *
   * For any non-empty pending campaign list, formatted message contains
   * numbered entry with campaign name, affected products, suggested discount,
   * expected revenue impact. Empty list → "All caught up!"
   */

  it('empty list returns "All caught up!" message', () => {
    const result = formatCampaignList([]);
    expect(result).toBe('All caught up! No pending campaigns.');
  });

  it('non-empty list contains numbered entry for each campaign', () => {
    fc.assert(
      fc.property(
        fc.array(campaignRecordArb, { minLength: 1, maxLength: 10 }),
        (campaigns) => {
          const result = formatCampaignList(campaigns);

          // Must NOT be the empty message
          expect(result).not.toContain('All caught up!');

          // Each campaign should have a numbered entry
          campaigns.forEach((_, i) => {
            expect(result).toContain(`*${i + 1}.*`);
          });

          // Must contain structural elements for each entry
          expect(result).toContain('📦 Products:');
          expect(result).toContain('🏷️ Discount:');
          expect(result).toContain('📈 Reach:');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('formatted message contains campaign message text (truncated)', () => {
    fc.assert(
      fc.property(
        fc.array(campaignRecordArb, { minLength: 1, maxLength: 5 }),
        (campaigns) => {
          const result = formatCampaignList(campaigns);

          campaigns.forEach((c) => {
            // The message text is truncated to 50 chars
            const expectedName = c.messageText?.substring(0, 50) || 'Untitled Campaign';
            expect(result).toContain(expectedName);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 7: Campaign command parsing extracts correct action and index ──

describe('Property 7: Campaign command parsing extracts correct action and index', () => {
  /**
   * **Validates: Requirements 5.2, 5.3**
   *
   * For any reply matching "N", "approve N", "approve #N", "dismiss N",
   * "dismiss #N" (N = positive integer), parser extracts correct action
   * and index. Invalid patterns rejected.
   */

  it('bare positive number → approve with that index', () => {
    fc.assert(
      fc.property(positiveIntArb, (n) => {
        const result = parseCampaignCommand(String(n));
        expect(result).not.toBeNull();
        expect(result!.action).toBe('approve');
        expect(result!.index).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  it('"approve N" → approve with index N', () => {
    fc.assert(
      fc.property(positiveIntArb, (n) => {
        const result = parseCampaignCommand(`approve ${n}`);
        expect(result).not.toBeNull();
        expect(result!.action).toBe('approve');
        expect(result!.index).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  it('"approve #N" → approve with index N', () => {
    fc.assert(
      fc.property(positiveIntArb, (n) => {
        const result = parseCampaignCommand(`approve #${n}`);
        expect(result).not.toBeNull();
        expect(result!.action).toBe('approve');
        expect(result!.index).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  it('"dismiss N" → dismiss with index N', () => {
    fc.assert(
      fc.property(positiveIntArb, (n) => {
        const result = parseCampaignCommand(`dismiss ${n}`);
        expect(result).not.toBeNull();
        expect(result!.action).toBe('dismiss');
        expect(result!.index).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  it('"dismiss #N" → dismiss with index N', () => {
    fc.assert(
      fc.property(positiveIntArb, (n) => {
        const result = parseCampaignCommand(`dismiss #${n}`);
        expect(result).not.toBeNull();
        expect(result!.action).toBe('dismiss');
        expect(result!.index).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  it('case insensitive: "APPROVE N" and "Dismiss N" work', () => {
    fc.assert(
      fc.property(positiveIntArb, (n) => {
        const approveResult = parseCampaignCommand(`APPROVE ${n}`);
        expect(approveResult).not.toBeNull();
        expect(approveResult!.action).toBe('approve');

        const dismissResult = parseCampaignCommand(`Dismiss ${n}`);
        expect(dismissResult).not.toBeNull();
        expect(dismissResult!.action).toBe('dismiss');
      }),
      { numRuns: 50 },
    );
  });

  it('invalid patterns return null', () => {
    const invalidInputs = [
      'hello',
      'approve',
      'dismiss',
      'approve zero',
      'approve -1',
      '0',
      '-5',
      'approve 0',
      'dismiss 0',
      'reject 3',
      'cancel 2',
      '',
      '  ',
    ];

    for (const input of invalidInputs) {
      expect(parseCampaignCommand(input)).toBeNull();
    }
  });

  it('zero is rejected as invalid index', () => {
    expect(parseCampaignCommand('0')).toBeNull();
    expect(parseCampaignCommand('approve 0')).toBeNull();
    expect(parseCampaignCommand('dismiss 0')).toBeNull();
  });
});


// ── Property 19: "Both" channel dispatch executes both delivery paths ──

import { resolveDeliveryChannels, type DeliveryChannel } from '../../services/campaign-service';

describe('Property 19: "Both" channel dispatch executes both delivery paths', () => {
  /**
   * **Validates: Requirement 12.4**
   *
   * For any campaign with channel="both" and target customer list,
   * dispatcher executes both Web Chat and WhatsApp delivery for every customer.
   */

  it('"both" resolves to exactly ["web", "whatsapp"]', () => {
    fc.assert(
      fc.property(fc.constant('both' as const), (channel) => {
        const channels = resolveDeliveryChannels(channel);
        expect(channels).toHaveLength(2);
        expect(channels).toContain('web');
        expect(channels).toContain('whatsapp');
      }),
      { numRuns: 100 },
    );
  });

  it('"web" resolves to exactly ["web"]', () => {
    fc.assert(
      fc.property(fc.constant('web' as const), (channel) => {
        const channels = resolveDeliveryChannels(channel);
        expect(channels).toEqual(['web']);
      }),
      { numRuns: 100 },
    );
  });

  it('"whatsapp" resolves to exactly ["whatsapp"]', () => {
    fc.assert(
      fc.property(fc.constant('whatsapp' as const), (channel) => {
        const channels = resolveDeliveryChannels(channel);
        expect(channels).toEqual(['whatsapp']);
      }),
      { numRuns: 100 },
    );
  });

  it('for any channel selection, resolved channels are a non-empty subset of ["web", "whatsapp"]', () => {
    const channelArb = fc.constantFrom('web' as const, 'whatsapp' as const, 'both' as const);
    fc.assert(
      fc.property(channelArb, (channel) => {
        const channels = resolveDeliveryChannels(channel);
        expect(channels.length).toBeGreaterThan(0);
        for (const ch of channels) {
          expect(['web', 'whatsapp']).toContain(ch);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('"both" always includes every single-channel option', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const bothChannels = resolveDeliveryChannels('both');
        const webChannels = resolveDeliveryChannels('web');
        const whatsappChannels = resolveDeliveryChannels('whatsapp');

        // "both" must be a superset of "web" and "whatsapp" individually
        for (const ch of webChannels) {
          expect(bothChannels).toContain(ch);
        }
        for (const ch of whatsappChannels) {
          expect(bothChannels).toContain(ch);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('for any customer list size, "both" produces 2x the delivery paths of a single channel', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (customerCount) => {
          const bothChannels = resolveDeliveryChannels('both');
          const webChannels = resolveDeliveryChannels('web');

          // Total deliveries for "both" = customerCount * bothChannels.length
          // Total deliveries for "web" = customerCount * webChannels.length
          const bothTotal = customerCount * bothChannels.length;
          const singleTotal = customerCount * webChannels.length;

          expect(bothTotal).toBe(singleTotal * 2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
