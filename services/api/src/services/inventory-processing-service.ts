/**
 * Inventory Processing Service
 *
 * Shared service for CSV column mapping and Khata book OCR extraction.
 * Used by both the WhatsApp inventory upload flow and the S3-triggered handler.
 *
 * Delegates AI work to GeminiAdapter and provides deterministic fallbacks.
 */

import { GeminiAdapter, type CsvColumnMapping, type KhataBookProduct } from '../adapters/gemini-adapter';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProcessedProduct {
  name: string;
  price: number;
  quantity: number;
  category?: string;
  sku?: string;
  brand?: string;
  variant?: string;
  confidence?: number;
  rowIndex?: number;
}

export interface CsvProcessingResult {
  mediaType: 'csv';
  products: ProcessedProduct[];
  headers: string[];
  csvLines: string[];
  columnMapping: CsvColumnMapping;
  errors: string[];
  warnings: string[];
}

export interface KhataProcessingResult {
  mediaType: 'image';
  products: ProcessedProduct[];
  errors: string[];
  warnings: string[];
}

export type InventoryProcessingResult = CsvProcessingResult | KhataProcessingResult;

// ---------------------------------------------------------------------------
// Deterministic fallback mapping
// ---------------------------------------------------------------------------

const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'product', 'product_name', 'item', 'item_name', 'product name', 'item name', 'description', 'title', 'product_title'],
  price: ['price', 'mrp', 'rate', 'cost', 'amount', 'selling_price', 'selling price', 'sp', 'unit_price', 'unit price'],
  quantity: ['qty', 'quantity', 'stock', 'stock_quantity', 'units', 'count', 'inventory', 'stock qty', 'available', 'in_stock'],
  category: ['category', 'cat', 'type', 'product_type', 'group', 'department', 'section'],
  sku: ['sku', 'sku_code', 'product_code', 'code', 'barcode', 'item_code', 'article'],
  brand: ['brand', 'brand_name', 'manufacturer', 'make', 'company'],
  variant: ['variant', 'size', 'color', 'colour', 'option', 'variation', 'weight', 'pack_size'],
};

export function deterministicMapColumns(headers: string[]): CsvColumnMapping {
  const normalized = headers.map(h => h.toLowerCase().trim().replace(/['"]/g, '').replace(/\s+/g, ' '));
  const mapping: CsvColumnMapping = {
    name: null, price: null, quantity: null, category: null,
    sku: null, brand: null, variant: null,
    confidence: 0, reasoning: 'Deterministic fallback — AI unavailable',
  };

  let matchCount = 0;
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = normalized.findIndex(h => aliases.includes(h));
    if (idx !== -1) {
      (mapping as any)[field] = idx;
      matchCount++;
    }
  }

  mapping.confidence = Math.min(0.7, 0.3 + (matchCount / headers.length) * 0.4);
  return mapping;
}

// ---------------------------------------------------------------------------
// CSV Processing
// ---------------------------------------------------------------------------

/**
 * Parse CSV buffer, map columns via Gemini (with deterministic fallback),
 * and return structured products ready for review.
 */
export async function processCsv(
  fileBuffer: Buffer,
  requestId: string,
  geminiApiKey?: string,
): Promise<CsvProcessingResult> {
  const csvContent = fileBuffer.toString('utf-8');
  const lines = csvContent.split('\n').filter(l => l.trim().length > 0);

  if (lines.length < 2) {
    return {
      mediaType: 'csv',
      products: [],
      headers: [],
      csvLines: lines,
      columnMapping: deterministicMapColumns([]),
      errors: ['CSV file must have at least a header row and one data row'],
      warnings: [],
    };
  }

  const headers = lines[0]!.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const sampleRows: string[][] = [];
  for (let i = 1; i < Math.min(4, lines.length); i++) {
    sampleRows.push(lines[i]!.split(',').map(v => v.trim().replace(/^"|"$/g, '')));
  }

  // Try Gemini-powered mapping, fall back to deterministic
  let mapping: CsvColumnMapping;
  try {
    const gemini = new GeminiAdapter(geminiApiKey);
    mapping = await gemini.mapCsvColumns(headers, sampleRows);
    logger.info('CSV column mapping via Gemini', { requestId, confidence: mapping.confidence });
  } catch (err) {
    logger.warn('Gemini CSV mapping failed, using deterministic fallback', {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    mapping = deterministicMapColumns(headers);
  }

  // Deterministic fallback for required fields if AI missed them
  if (mapping.name === null || mapping.price === null) {
    const fallback = deterministicMapColumns(headers);
    if (mapping.name === null) mapping.name = fallback.name;
    if (mapping.price === null) mapping.price = fallback.price;
    if (mapping.quantity === null) mapping.quantity = fallback.quantity;
    if (mapping.category === null) mapping.category = fallback.category;
  }

  // Parse rows using resolved mapping
  const products: ProcessedProduct[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  if (mapping.name === null) errors.push('No product name column identified');
  if (mapping.price === null) errors.push('No price column identified');

  if (errors.length === 0) {
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i]!.split(',').map(v => v.trim().replace(/^"|"$/g, ''));

      const name = mapping.name !== null ? values[mapping.name] : undefined;
      const priceStr = mapping.price !== null ? values[mapping.price] : undefined;
      const qtyStr = mapping.quantity !== null ? values[mapping.quantity] : undefined;
      const category = mapping.category !== null ? values[mapping.category] : undefined;
      const sku = mapping.sku !== null ? values[mapping.sku] : undefined;
      const brand = mapping.brand !== null ? values[mapping.brand] : undefined;
      const variant = mapping.variant !== null ? values[mapping.variant] : undefined;

      if (!name || !name.trim()) {
        warnings.push(`Row ${i + 1}: skipped — empty product name`);
        continue;
      }

      const price = parseFloat(priceStr || '0');
      if (isNaN(price) || price <= 0) {
        warnings.push(`Row ${i + 1}: skipped "${name}" — invalid price`);
        continue;
      }

      const quantity = parseInt(qtyStr || '1', 10);

      products.push({
        name: brand?.trim() ? `${brand.trim()} ${name.trim()}` : name.trim(),
        price,
        quantity: isNaN(quantity) || quantity <= 0 ? 1 : quantity,
        ...(category?.trim() ? { category: category.trim() } : {}),
        ...(sku?.trim() ? { sku: sku.trim() } : {}),
        ...(brand?.trim() ? { brand: brand.trim() } : {}),
        ...(variant?.trim() ? { variant: variant.trim() } : {}),
        rowIndex: i + 1,
      });
    }
  }

  return {
    mediaType: 'csv',
    products,
    headers,
    csvLines: lines,
    columnMapping: mapping,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Khata Book OCR Processing
// ---------------------------------------------------------------------------

/**
 * Extract products from a Khata book image using Gemini Vision OCR.
 */
export async function processKhataImage(
  fileBuffer: Buffer,
  mimeType: string,
  requestId: string,
  geminiApiKey?: string,
): Promise<KhataProcessingResult> {
  try {
    const gemini = new GeminiAdapter(geminiApiKey);
    const khataProducts: KhataBookProduct[] = await gemini.parseKhataBookImage(fileBuffer, mimeType);

    logger.info('Khata OCR extraction complete', {
      requestId,
      productCount: khataProducts.length,
    });

    const products: ProcessedProduct[] = khataProducts
      .filter(p => p.price > 0 && p.name.trim().length > 0)
      .map((p, i) => ({
        name: p.name.trim(),
        price: p.price,
        quantity: p.quantity > 0 ? p.quantity : 1,
        confidence: 0.85, // Khata OCR default confidence
        rowIndex: i + 1,
      }));

    return {
      mediaType: 'image',
      products,
      errors: [],
      warnings: khataProducts.length !== products.length
        ? [`${khataProducts.length - products.length} entries skipped (invalid name or price)`]
        : [],
    };
  } catch (err) {
    logger.error('Khata OCR processing failed', {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      mediaType: 'image',
      products: [],
      errors: [`OCR extraction failed: ${err instanceof Error ? err.message : String(err)}`],
      warnings: [],
    };
  }
}
