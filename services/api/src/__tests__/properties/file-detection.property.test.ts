/**
 * Property-Based Tests for File Type Detection and Inventory Edit Parsing
 *
 * Tests media type classification from Twilio MediaContentType0 headers
 * and inventory edit command parsing for the WhatsApp inventory upload flow.
 *
 * Uses fast-check to verify invariants across randomised inputs.
 */

import * as fc from 'fast-check';
import {
  detectMediaType,
  parseInventoryEditCommand,
} from '../../handlers/whatsapp/inventory-upload';

// ── Property 16: File type detection classifies media correctly ──

describe('Property 16: File type detection classifies media correctly', () => {
  /**
   * **Validates: Requirement 11.1**
   *
   * For any Twilio media content type string:
   *   text/csv, application/csv → csv
   *   application/vnd.ms-excel, spreadsheetml.sheet → excel
   *   image/jpeg, image/png, image/webp → image
   *   others → unknown
   */

  it('CSV content types always classify as csv', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('text/csv', 'application/csv'),
        (contentType) => {
          expect(detectMediaType(contentType)).toBe('csv');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('CSV content types with whitespace still classify as csv', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('text/csv', 'application/csv'),
        fc.constantFrom('', ' ', '  '),
        (contentType, padding) => {
          expect(detectMediaType(padding + contentType + padding)).toBe('csv');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('Excel content types always classify as excel', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ),
        (contentType) => {
          expect(detectMediaType(contentType)).toBe('excel');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('Image content types always classify as image', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('image/jpeg', 'image/png', 'image/webp'),
        (contentType) => {
          expect(detectMediaType(contentType)).toBe('image');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('case insensitive: uppercase variants classify correctly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'TEXT/CSV',
          'Application/CSV',
          'Image/JPEG',
          'IMAGE/PNG',
          'image/WEBP',
          'Application/Vnd.Ms-Excel',
        ),
        (contentType) => {
          const result = detectMediaType(contentType);
          expect(result).not.toBe('unknown');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('unknown content types always classify as unknown', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'application/pdf',
          'application/json',
          'text/plain',
          'text/html',
          'audio/ogg',
          'video/mp4',
          'application/zip',
          'application/octet-stream',
        ),
        (contentType) => {
          expect(detectMediaType(contentType)).toBe('unknown');
        },
      ),
      { numRuns: 50 },
    );
  });

  it('random strings classify as unknown', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) =>
            !s.toLowerCase().includes('csv') &&
            !s.toLowerCase().includes('excel') &&
            !s.toLowerCase().includes('spreadsheetml') &&
            !s.toLowerCase().includes('image/jpeg') &&
            !s.toLowerCase().includes('image/png') &&
            !s.toLowerCase().includes('image/webp') &&
            !s.toLowerCase().includes('vnd.ms-excel'),
        ),
        (randomType) => {
          expect(detectMediaType(randomType)).toBe('unknown');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('return type is always one of csv, excel, image, unknown', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 100 }), (input) => {
        const result = detectMediaType(input);
        expect(['csv', 'excel', 'image', 'unknown']).toContain(result);
      }),
      { numRuns: 200 },
    );
  });
});

// ── Property 18: Inventory edit command parsing ──

describe('Property 18: Inventory edit command parsing extracts item, field, and value', () => {
  /**
   * **Validates: Requirement 11.6**
   *
   * For any edit command matching "change item N price to X" or
   * "update item N quantity to X", parser extracts correct item index,
   * field name, and new value.
   */

  const positiveIntArb = fc.integer({ min: 1, max: 100 });
  const positiveNumArb = fc.integer({ min: 1, max: 99999 });
  const verbArb = fc.constantFrom('change', 'update');

  it('"change/update item N price to X" extracts correct values', () => {
    fc.assert(
      fc.property(verbArb, positiveIntArb, positiveNumArb, (verb, n, price) => {
        const result = parseInventoryEditCommand(`${verb} item ${n} price to ${price}`);
        expect(result).not.toBeNull();
        expect(result!.itemIndex).toBe(n);
        expect(result!.field).toBe('price');
        expect(result!.value).toBe(price);
      }),
      { numRuns: 100 },
    );
  });

  it('"change/update item N quantity to X" extracts correct values', () => {
    fc.assert(
      fc.property(verbArb, positiveIntArb, fc.integer({ min: 1, max: 9999 }), (verb, n, qty) => {
        const result = parseInventoryEditCommand(`${verb} item ${n} quantity to ${qty}`);
        expect(result).not.toBeNull();
        expect(result!.itemIndex).toBe(n);
        expect(result!.field).toBe('quantity');
        expect(result!.value).toBe(qty);
      }),
      { numRuns: 100 },
    );
  });

  it('"change/update item N qty to X" also works (qty alias)', () => {
    fc.assert(
      fc.property(verbArb, positiveIntArb, fc.integer({ min: 1, max: 9999 }), (verb, n, qty) => {
        const result = parseInventoryEditCommand(`${verb} item ${n} qty to ${qty}`);
        expect(result).not.toBeNull();
        expect(result!.itemIndex).toBe(n);
        expect(result!.field).toBe('quantity');
        expect(result!.value).toBe(qty);
      }),
      { numRuns: 100 },
    );
  });

  it('"change/update item N name to X" extracts name as string', () => {
    fc.assert(
      fc.property(
        verbArb,
        positiveIntArb,
        fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
        (verb, n, name) => {
          const result = parseInventoryEditCommand(`${verb} item ${n} name to ${name}`);
          expect(result).not.toBeNull();
          expect(result!.itemIndex).toBe(n);
          expect(result!.field).toBe('name');
          expect(result!.value).toBe(name.trim().toLowerCase());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('case insensitive: "CHANGE ITEM 3 PRICE TO 250" works', () => {
    fc.assert(
      fc.property(positiveIntArb, positiveNumArb, (n, price) => {
        const result = parseInventoryEditCommand(`CHANGE ITEM ${n} PRICE TO ${price}`);
        expect(result).not.toBeNull();
        expect(result!.itemIndex).toBe(n);
        expect(result!.field).toBe('price');
      }),
      { numRuns: 50 },
    );
  });

  it('invalid patterns return null', () => {
    const invalidInputs = [
      'hello',
      'change item',
      'change item 3',
      'change item 3 price',
      'change item 3 price to',
      'set item 3 price to 250',
      'modify item 3 price to 250',
      'change item 0 price to 250',
      'change item -1 price to 250',
      '',
      '  ',
      'looks good',
      'cancel',
    ];

    for (const input of invalidInputs) {
      expect(parseInventoryEditCommand(input)).toBeNull();
    }
  });
});
