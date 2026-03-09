// Mock the logger to avoid AsyncLocalStorage issues in tests
jest.mock('../logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { findBestMatch, formatClarificationMessage, formatNotFoundMessage, type ProductCandidate } from '../product-matcher';

// ── Demo inventory matching Dragon Store seed data ──────────────────

const DEMO_PRODUCTS: ProductCandidate[] = [
  { id: 'p1', name: 'Tata Salt 1kg', price: 25, stockQuantity: 100 },
  { id: 'p2', name: 'Tata Salt Lite 1kg', price: 30, stockQuantity: 50 },
  { id: 'p3', name: 'Amul Butter 500g', price: 290, stockQuantity: 40 },
  { id: 'p4', name: 'Amul Butter 100g', price: 60, stockQuantity: 80 },
  { id: 'p5', name: 'Surf Excel Quick Wash 1kg', price: 180, stockQuantity: 30 },
  { id: 'p6', name: 'Red Label Tea 250g', price: 120, stockQuantity: 60 },
  { id: 'p7', name: 'Red Label Tea 500g', price: 230, stockQuantity: 25 },
  { id: 'p8', name: 'Tata Tea Gold 500g', price: 260, stockQuantity: 35 },
  { id: 'p9', name: 'Maggi 2-Minute Noodles', price: 14, stockQuantity: 200 },
  { id: 'p10', name: 'Parle-G Biscuits 800g', price: 55, stockQuantity: 150 },
  { id: 'p11', name: 'Fortune Sunflower Oil 1L', price: 140, stockQuantity: 45 },
  { id: 'p12', name: 'Aashirvaad Atta 5kg', price: 280, stockQuantity: 20 },
  { id: 'p13', name: 'Himalayan Pink Salt 500g', price: 85, stockQuantity: 15 },
];

describe('findBestMatch', () => {
  // ── B. Product lookup and stock matching ──────────────────────────

  it('matches "Tata Salt" exactly', () => {
    const result = findBestMatch('Tata Salt', DEMO_PRODUCTS);
    expect(result.type).toBe('exact');
    expect(result.product?.name).toContain('Tata Salt');
  });

  it('matches "tata salt" case-insensitively', () => {
    const result = findBestMatch('tata salt', DEMO_PRODUCTS);
    expect(result.type).toBe('exact');
    expect(result.product?.name).toContain('Tata Salt');
  });

  it('matches "TATA SALT" all caps', () => {
    const result = findBestMatch('TATA SALT', DEMO_PRODUCTS);
    expect(result.type).toBe('exact');
    expect(result.product?.name).toContain('Tata Salt');
  });

  it('matches "Amul Butter" correctly', () => {
    const result = findBestMatch('Amul Butter', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy', 'multiple']).toContain(result.type);
    if (result.type === 'multiple') {
      expect(result.candidates!.every(c => c.name.includes('Amul Butter'))).toBe(true);
    } else {
      expect(result.product?.name).toContain('Amul Butter');
    }
  });

  it('matches "Surf Excel" correctly', () => {
    const result = findBestMatch('Surf Excel', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy']).toContain(result.type);
    expect(result.product?.name).toContain('Surf Excel');
  });

  it('matches "Red Label Tea 500g" with size variant', () => {
    const result = findBestMatch('Red Label Tea 500g', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy']).toContain(result.type);
    expect(result.product?.name).toBe('Red Label Tea 500g');
  });

  it('matches "red label tea" without size — may return multiple', () => {
    const result = findBestMatch('red label tea', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy', 'multiple']).toContain(result.type);
    if (result.type === 'multiple') {
      expect(result.candidates!.length).toBeGreaterThanOrEqual(2);
      expect(result.candidates!.every(c => c.name.toLowerCase().includes('red label'))).toBe(true);
    }
  });

  it('matches "maggi" partial name', () => {
    const result = findBestMatch('maggi', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy']).toContain(result.type);
    expect(result.product?.name).toContain('Maggi');
  });

  it('matches "parle g" with alias handling', () => {
    const result = findBestMatch('parle g', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy']).toContain(result.type);
    expect(result.product?.name).toContain('Parle');
  });

  it('matches "atta" partial product name', () => {
    const result = findBestMatch('atta', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy']).toContain(result.type);
    expect(result.product?.name).toContain('Atta');
  });

  it('returns none for completely unrelated query', () => {
    const result = findBestMatch('iPhone 15 Pro', DEMO_PRODUCTS);
    expect(result.type).toBe('none');
  });

  it('returns none for empty query', () => {
    const result = findBestMatch('', DEMO_PRODUCTS);
    expect(result.type).toBe('none');
  });

  it('returns none for empty product list', () => {
    const result = findBestMatch('Tata Salt', []);
    expect(result.type).toBe('none');
  });

  // ── Fuzzy / typo tolerance ────────────────────────────────────────

  it('handles minor typos like "Tata Slat"', () => {
    const result = findBestMatch('Tata Slat', DEMO_PRODUCTS);
    // Should still find Tata Salt via Levenshtein
    expect(['exact', 'fuzzy']).toContain(result.type);
    expect(result.product?.name).toContain('Tata Salt');
  });

  it('handles extra spaces like "Amul  Butter"', () => {
    const result = findBestMatch('Amul  Butter', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy', 'multiple']).toContain(result.type);
  });

  // ── Size-aware matching ───────────────────────────────────────────

  it('prefers 500g variant when query specifies 500g', () => {
    const result = findBestMatch('Amul Butter 500g', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy']).toContain(result.type);
    expect(result.product?.name).toBe('Amul Butter 500g');
  });

  it('prefers 100g variant when query specifies 100g', () => {
    const result = findBestMatch('Amul Butter 100g', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy']).toContain(result.type);
    expect(result.product?.name).toBe('Amul Butter 100g');
  });

  // ── Disambiguation ────────────────────────────────────────────────

  it('distinguishes Tata Salt from Himalayan Pink Salt', () => {
    const result = findBestMatch('Himalayan Salt', DEMO_PRODUCTS);
    expect(['exact', 'fuzzy']).toContain(result.type);
    expect(result.product?.name).toContain('Himalayan');
  });
});

describe('formatClarificationMessage', () => {
  it('formats a clean clarification message', () => {
    const msg = formatClarificationMessage('butter', [
      { id: 'p3', name: 'Amul Butter 500g', price: 290, stockQuantity: 40 },
      { id: 'p4', name: 'Amul Butter 100g', price: 60, stockQuantity: 80 },
    ]);
    expect(msg).toContain('butter');
    expect(msg).toContain('Amul Butter 500g');
    expect(msg).toContain('Amul Butter 100g');
    expect(msg).toContain('Which one');
    expect(msg).not.toContain('{');
    expect(msg).not.toContain('<');
  });
});

describe('formatNotFoundMessage', () => {
  it('formats a clean not-found message without suggestions', () => {
    const msg = formatNotFoundMessage('Organic Quinoa');
    expect(msg).toContain('Organic Quinoa');
    expect(msg).toContain('check the product name');
    expect(msg).not.toContain('{');
  });

  it('formats a not-found message with suggestions', () => {
    const msg = formatNotFoundMessage('Salt', [
      { id: 'p1', name: 'Tata Salt 1kg', price: 25, stockQuantity: 100 },
    ]);
    expect(msg).toContain('Salt');
    expect(msg).toContain('Tata Salt 1kg');
    expect(msg).toContain('Did you mean');
  });
});
