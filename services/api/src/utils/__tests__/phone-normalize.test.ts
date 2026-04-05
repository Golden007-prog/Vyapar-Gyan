import { normalizeIndianPhone } from '../phone-normalize';

describe('normalizeIndianPhone', () => {
  describe('valid Indian phone numbers', () => {
    it('returns 10 digits from raw 10-digit input', () => {
      expect(normalizeIndianPhone('9876543210')).toBe('9876543210');
    });

    it('strips +91 prefix', () => {
      expect(normalizeIndianPhone('+919876543210')).toBe('9876543210');
    });

    it('strips 91 prefix from 12-digit input', () => {
      expect(normalizeIndianPhone('919876543210')).toBe('9876543210');
    });

    it('strips leading 0 from 11-digit input', () => {
      expect(normalizeIndianPhone('09876543210')).toBe('9876543210');
    });

    it('strips spaces', () => {
      expect(normalizeIndianPhone('+91 987 654 3210')).toBe('9876543210');
    });

    it('strips dashes', () => {
      expect(normalizeIndianPhone('+91-987-654-3210')).toBe('9876543210');
    });

    it('strips parentheses', () => {
      expect(normalizeIndianPhone('(+91)9876543210')).toBe('9876543210');
    });

    it('strips mixed formatting', () => {
      expect(normalizeIndianPhone('+91 (987) 654-3210')).toBe('9876543210');
    });

    it('accepts numbers starting with 6', () => {
      expect(normalizeIndianPhone('6123456789')).toBe('6123456789');
    });

    it('accepts numbers starting with 7', () => {
      expect(normalizeIndianPhone('7001124396')).toBe('7001124396');
    });

    it('accepts numbers starting with 8', () => {
      expect(normalizeIndianPhone('8927049085')).toBe('8927049085');
    });
  });

  describe('international numbers', () => {
    it('returns +1 US number as-is', () => {
      expect(normalizeIndianPhone('+12125551234')).toBe('+12125551234');
    });

    it('returns +44 UK number as-is', () => {
      expect(normalizeIndianPhone('+447911123456')).toBe('+447911123456');
    });

    it('strips formatting from international numbers', () => {
      expect(normalizeIndianPhone('+1 (212) 555-1234')).toBe('+12125551234');
    });
  });

  describe('invalid inputs', () => {
    it('throws for empty string', () => {
      expect(() => normalizeIndianPhone('')).toThrow('Invalid phone input');
    });

    it('throws for whitespace-only string', () => {
      expect(() => normalizeIndianPhone('   ')).toThrow('contains no digits');
    });

    it('throws for number starting with 1-5', () => {
      expect(() => normalizeIndianPhone('1234567890')).toThrow('not a valid 10-digit number');
    });

    it('throws for too-short number', () => {
      expect(() => normalizeIndianPhone('98765')).toThrow('not a valid 10-digit number');
    });

    it('throws for too-long number without valid prefix', () => {
      expect(() => normalizeIndianPhone('98765432101234')).toThrow('not a valid 10-digit number');
    });

    it('throws for non-string input', () => {
      expect(() => normalizeIndianPhone(null as any)).toThrow('Invalid phone input');
    });

    it('throws for short international number', () => {
      expect(() => normalizeIndianPhone('+12')).toThrow('Invalid international phone number');
    });
  });
});
