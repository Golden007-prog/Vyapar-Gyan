'use client';

import { useEffect, useState, useCallback } from 'react';
import { Package, Upload, FileSpreadsheet, X, AlertCircle, CheckCircle, Loader2, Camera, Sparkles, Eye, Edit3 } from 'lucide-react';

interface Product {
  id: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  price: number;
  stockQuantity: number;
  stockAddedDate: string;
  imageUrls: string[];
  isActive: boolean;
  sku?: string;
  brand?: string;
  variant?: string;
}

// ── Demo seeded products for Dragon Store ──
const DEMO_PRODUCTS: Product[] = [
  { id: 'p-001', name: 'Amul Butter 500g', categoryId: 'cat-groceries', categoryName: 'Groceries', price: 280, stockQuantity: 3, stockAddedDate: new Date(Date.now() - 5 * 86400000).toISOString(), imageUrls: [], isActive: true },
  { id: 'p-002', name: 'Surf Excel 1kg', categoryId: 'cat-home', categoryName: 'Home & Kitchen', price: 199, stockQuantity: 45, stockAddedDate: new Date(Date.now() - 15 * 86400000).toISOString(), imageUrls: [], isActive: true },
  { id: 'p-003', name: 'USB-C Cable 1m', categoryId: 'cat-electronics', categoryName: 'Electronics', price: 149, stockQuantity: 120, stockAddedDate: new Date(Date.now() - 10 * 86400000).toISOString(), imageUrls: [], isActive: true },
  { id: 'p-004', name: 'Winter Jacket (L)', categoryId: 'cat-textiles', categoryName: 'Textiles & Fashion', price: 1200, stockQuantity: 15, stockAddedDate: new Date(Date.now() - 68 * 86400000).toISOString(), imageUrls: [], isActive: true },
  { id: 'p-005', name: 'Vim Dishwash Bar', categoryId: 'cat-home', categoryName: 'Home & Kitchen', price: 35, stockQuantity: 200, stockAddedDate: new Date(Date.now() - 8 * 86400000).toISOString(), imageUrls: [], isActive: true },
  { id: 'p-006', name: 'Aashirvaad Atta 5kg', categoryId: 'cat-groceries', categoryName: 'Groceries', price: 320, stockQuantity: 28, stockAddedDate: new Date(Date.now() - 12 * 86400000).toISOString(), imageUrls: [], isActive: true },
  { id: 'p-007', name: 'Phone Case (iPhone 15)', categoryId: 'cat-electronics', categoryName: 'Electronics', price: 299, stockQuantity: 6, stockAddedDate: new Date(Date.now() - 75 * 86400000).toISOString(), imageUrls: [], isActive: false },
  { id: 'p-008', name: 'Nivea Body Lotion 200ml', categoryId: 'cat-beauty', categoryName: 'Beauty & Personal Care', price: 245, stockQuantity: 18, stockAddedDate: new Date(Date.now() - 20 * 86400000).toISOString(), imageUrls: [], isActive: true },
];

// ── Column mapping types ──
interface ColumnMapping {
  name: number | null;
  price: number | null;
  quantity: number | null;
  category: number | null;
  sku: number | null;
  brand: number | null;
  variant: number | null;
}

interface AiMappingResult {
  mapping: ColumnMapping;
  confidence: number;
  reasoning: string;
}

interface CsvParseResult {
  success: boolean;
  products: Partial<Product>[];
  errors: string[];
  warnings: string[];
}

// ── Deterministic fallback CSV parser ──
const COLUMN_ALIASES: Record<keyof ColumnMapping, string[]> = {
  name: ['name', 'product', 'product_name', 'item', 'item_name', 'product name', 'item name', 'description', 'title', 'product_title'],
  price: ['price', 'mrp', 'rate', 'cost', 'amount', 'selling_price', 'selling price', 'sp', 'unit_price', 'unit price'],
  quantity: ['qty', 'quantity', 'stock', 'stock_quantity', 'units', 'count', 'inventory', 'stock qty', 'available', 'in_stock'],
  category: ['category', 'cat', 'type', 'product_type', 'group', 'department', 'section'],
  sku: ['sku', 'sku_code', 'product_code', 'code', 'barcode', 'item_code', 'article'],
  brand: ['brand', 'brand_name', 'manufacturer', 'make', 'company'],
  variant: ['variant', 'size', 'color', 'colour', 'option', 'variation', 'weight', 'pack_size'],
};

function deterministicMap(headers: string[]): ColumnMapping {
  const normalized = headers.map(h => h.toLowerCase().trim().replace(/['"]/g, '').replace(/\s+/g, ' '));
  const mapping: ColumnMapping = { name: null, price: null, quantity: null, category: null, sku: null, brand: null, variant: null };

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [keyof ColumnMapping, string[]][]) {
    const idx = normalized.findIndex(h => aliases.includes(h));
    if (idx !== -1) mapping[field] = idx;
  }
  return mapping;
}

// ── Gemini AI CSV mapping (simulated for demo, real call in production) ──
async function geminiMapColumns(headers: string[], sampleRows: string[][]): Promise<AiMappingResult> {
  // In production, this calls the Gemini API via backend endpoint:
  // POST /api/v1/seller/inventory/ai-map-csv { headers, sampleRows }
  // For demo, we simulate intelligent fuzzy matching that goes beyond exact aliases

  await new Promise(r => setTimeout(r, 1200)); // simulate API latency

  const normalized = headers.map(h => h.toLowerCase().trim().replace(/['"]/g, ''));
  const mapping: ColumnMapping = { name: null, price: null, quantity: null, category: null, sku: null, brand: null, variant: null };

  // Fuzzy patterns that Gemini would catch
  const fuzzyPatterns: Record<keyof ColumnMapping, RegExp[]> = {
    name: [/prod/i, /item/i, /name/i, /title/i, /desc/i, /saman/i, /vastu/i],
    price: [/price/i, /mrp/i, /rate/i, /cost/i, /amount/i, /sell/i, /daam/i, /kimat/i, /₹/],
    quantity: [/qty/i, /quant/i, /stock/i, /unit/i, /count/i, /avail/i, /inv/i, /maal/i, /number/i],
    category: [/cat/i, /type/i, /group/i, /dept/i, /section/i, /vibhag/i],
    sku: [/sku/i, /code/i, /barcode/i, /article/i, /id/i],
    brand: [/brand/i, /make/i, /manuf/i, /company/i],
    variant: [/variant/i, /size/i, /color/i, /colour/i, /weight/i, /pack/i, /option/i],
  };

  let matchCount = 0;
  for (const [field, patterns] of Object.entries(fuzzyPatterns) as [keyof ColumnMapping, RegExp[]][]) {
    if (mapping[field] !== null) continue;
    const idx = normalized.findIndex((h, i) => {
      if (Object.values(mapping).includes(i)) return false; // already used
      return patterns.some(p => p.test(h));
    });
    if (idx !== -1) { mapping[field] = idx; matchCount++; }
  }

  // Heuristic: if we still don't have name/price, try to infer from sample data
  if (mapping.name === null && sampleRows.length > 0) {
    const textColIdx = normalized.findIndex((_, i) => {
      if (Object.values(mapping).includes(i)) return false;
      return sampleRows.every(row => row[i] && isNaN(Number(row[i])));
    });
    if (textColIdx !== -1) { mapping.name = textColIdx; matchCount++; }
  }
  if (mapping.price === null && sampleRows.length > 0) {
    const numColIdx = normalized.findIndex((_, i) => {
      if (Object.values(mapping).includes(i)) return false;
      return sampleRows.every(row => !isNaN(Number(row[i])) && Number(row[i]) > 0);
    });
    if (numColIdx !== -1) { mapping.price = numColIdx; matchCount++; }
  }

  const confidence = Math.min(0.98, 0.5 + (matchCount / headers.length) * 0.5);
  const reasoning = `AI identified ${matchCount} of ${headers.length} columns. ` +
    (mapping.name !== null ? `Product name → "${headers[mapping.name]}". ` : 'Could not identify product name column. ') +
    (mapping.price !== null ? `Price → "${headers[mapping.price]}". ` : '') +
    (mapping.quantity !== null ? `Quantity → "${headers[mapping.quantity]}". ` : '');

  return { mapping, confidence, reasoning };
}

function parseWithMapping(lines: string[], mapping: ColumnMapping): CsvParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const products: Partial<Product>[] = [];

  if (mapping.name === null) errors.push('No product name column mapped');
  if (mapping.price === null) errors.push('No price column mapped');
  if (errors.length > 0) return { success: false, products: [], errors, warnings };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const name = mapping.name !== null ? cols[mapping.name] : '';
    const price = mapping.price !== null ? parseFloat(cols[mapping.price]) : NaN;
    const qty = mapping.quantity !== null ? parseInt(cols[mapping.quantity], 10) : 0;
    const cat = mapping.category !== null ? cols[mapping.category] : 'Uncategorized';
    const sku = mapping.sku !== null ? cols[mapping.sku] : undefined;
    const brand = mapping.brand !== null ? cols[mapping.brand] : undefined;
    const variant = mapping.variant !== null ? cols[mapping.variant] : undefined;

    if (!name) { warnings.push(`Row ${i + 1}: skipped — empty name`); continue; }
    if (isNaN(price) || price <= 0) { warnings.push(`Row ${i + 1}: skipped "${name}" — invalid price`); continue; }

    products.push({
      id: `csv-${Date.now()}-${i}`,
      name: brand ? `${brand} ${name}` : name,
      price,
      stockQuantity: isNaN(qty) ? 0 : qty,
      categoryName: cat,
      categoryId: `cat-${cat.toLowerCase().replace(/\s+/g, '-')}`,
      stockAddedDate: new Date().toISOString(),
      imageUrls: [],
      isActive: true,
      sku,
      brand,
      variant,
    });
  }

  if (products.length === 0) errors.push('No valid product rows found.');
  return { success: products.length > 0, products, errors, warnings };
}

// ── Khata Book OCR simulation (demo) ──
interface OcrExtractedProduct {
  name: string;
  quantity: number;
  price: number;
  confidence: number;
}

async function simulateKhataOcr(): Promise<OcrExtractedProduct[]> {
  await new Promise(r => setTimeout(r, 2500));
  return [
    { name: 'Toor Dal 1kg', quantity: 10, price: 160, confidence: 0.94 },
    { name: 'Basmati Rice 5kg', quantity: 8, price: 450, confidence: 0.91 },
    { name: 'Sugar 2kg', quantity: 15, price: 90, confidence: 0.88 },
    { name: 'Mustard Oil 1L', quantity: 6, price: 185, confidence: 0.85 },
    { name: 'Chana Dal 500g', quantity: 12, price: 65, confidence: 0.79 },
  ];
}

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // CSV state
  const [showCsvModal, setShowCsvModal] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvStep, setCsvStep] = useState<'upload' | 'analyzing' | 'mapping' | 'preview' | 'done'>('upload');
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvLines, setCsvLines] = useState<string[]>([]);
  const [csvSampleRows, setCsvSampleRows] = useState<string[][]>([]);
  const [aiMapping, setAiMapping] = useState<AiMappingResult | null>(null);
  const [editableMapping, setEditableMapping] = useState<ColumnMapping>({ name: null, price: null, quantity: null, category: null, sku: null, brand: null, variant: null });
  const [csvResult, setCsvResult] = useState<CsvParseResult | null>(null);
  const [dragActive, setDragActive] = useState(false);

  // Image/Khata state
  const [showImageModal, setShowImageModal] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageStep, setImageStep] = useState<'upload' | 'processing' | 'review' | 'done'>('upload');
  const [ocrProducts, setOcrProducts] = useState<OcrExtractedProduct[]>([]);
  const [ocrSelected, setOcrSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => { setProducts(DEMO_PRODUCTS); setLoading(false); }, 500);
    return () => clearTimeout(timer);
  }, []);

  const calculateStockAge = (d: string) => Math.ceil(Math.abs(Date.now() - new Date(d).getTime()) / 86400000);
  const getStockAgeColor = (days: number) => days > 60 ? 'text-red-600' : days > 30 ? 'text-yellow-600' : 'text-green-600';
  const formatCurrency = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

  // ── CSV Upload Flow ──
  const handleDrag = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragActive(e.type === 'dragenter' || e.type === 'dragover'); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setDragActive(false); if (e.dataTransfer.files?.[0]) handleCsvSelect(e.dataTransfer.files[0]); }, []);

  const handleCsvSelect = (file: File) => {
    if (!file.name.endsWith('.csv') && !['text/csv', 'application/vnd.ms-excel'].includes(file.type)) {
      alert('Please upload a CSV file'); return;
    }
    setCsvFile(file);
    setCsvStep('upload');
    setCsvResult(null);
    setAiMapping(null);
  };

  const handleCsvAnalyze = async () => {
    if (!csvFile) return;
    setCsvStep('analyzing');

    try {
      const text = await csvFile.text();
      const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) { setCsvResult({ success: false, products: [], errors: ['CSV must have a header and at least one data row.'], warnings: [] }); setCsvStep('upload'); return; }

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const sampleRows = lines.slice(1, Math.min(4, lines.length)).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));

      setCsvHeaders(headers);
      setCsvLines(lines);
      setCsvSampleRows(sampleRows);

      // Try AI mapping first
      try {
        const aiResult = await geminiMapColumns(headers, sampleRows);
        setAiMapping(aiResult);
        setEditableMapping(aiResult.mapping);

        if (aiResult.confidence >= 0.75 && aiResult.mapping.name !== null && aiResult.mapping.price !== null) {
          // High confidence — go straight to preview
          const parsed = parseWithMapping(lines, aiResult.mapping);
          setCsvResult(parsed);
          setCsvStep('preview');
        } else {
          // Low confidence — let seller review mapping
          setCsvStep('mapping');
        }
      } catch {
        // AI failed — use deterministic fallback
        const fallback = deterministicMap(headers);
        setEditableMapping(fallback);
        setAiMapping({ mapping: fallback, confidence: 0, reasoning: 'AI unavailable — using rule-based column matching.' });
        setCsvStep('mapping');
      }
    } catch {
      setCsvResult({ success: false, products: [], errors: ['Failed to read CSV file.'], warnings: [] });
      setCsvStep('upload');
    }
  };

  const handleMappingConfirm = () => {
    const parsed = parseWithMapping(csvLines, editableMapping);
    setCsvResult(parsed);
    setCsvStep('preview');
  };

  const handleCsvImport = () => {
    if (csvResult?.success && csvResult.products.length > 0) {
      setProducts(prev => [...prev, ...csvResult.products as Product[]]);
      setCsvStep('done');
    }
  };

  const resetCsvModal = () => { setShowCsvModal(false); setCsvFile(null); setCsvStep('upload'); setCsvResult(null); setAiMapping(null); };

  // ── Image Upload Flow ──
  const handleImageSelect = (file: File) => {
    if (!file.type.startsWith('image/')) { alert('Please select an image file (JPG, PNG)'); return; }
    setImageFile(file);
    setImageStep('upload');
    setOcrProducts([]);
    setOcrSelected(new Set());
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleImageProcess = async () => {
    if (!imageFile) return;
    setImageStep('processing');
    const extracted = await simulateKhataOcr();
    setOcrProducts(extracted);
    setOcrSelected(new Set(extracted.map((_, i) => i))); // select all by default
    setImageStep('review');
  };

  const handleImageImport = () => {
    const selected = ocrProducts.filter((_, i) => ocrSelected.has(i));
    const newProducts: Product[] = selected.map((p, i) => ({
      id: `ocr-${Date.now()}-${i}`,
      name: p.name,
      price: p.price,
      stockQuantity: p.quantity,
      categoryId: 'cat-groceries',
      categoryName: 'Groceries',
      stockAddedDate: new Date().toISOString(),
      imageUrls: [],
      isActive: true,
    }));
    setProducts(prev => [...prev, ...newProducts]);
    setImageStep('done');
  };

  const resetImageModal = () => { setShowImageModal(false); setImageFile(null); setImagePreview(null); setImageStep('upload'); setOcrProducts([]); };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Hub</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your product catalog and bulk upload inventory</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { resetImageModal(); setShowImageModal(true); }}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Camera className="h-4 w-4" /> Khata Book OCR
          </button>
          <button onClick={() => { resetCsvModal(); setShowCsvModal(true); }}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            <Upload className="h-4 w-4" /> Smart CSV Upload
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-gray-600">Total Products</p><p className="mt-1 text-2xl font-bold text-gray-900">{products.length}</p></div>
            <div className="rounded-full bg-indigo-100 p-3"><Package className="h-6 w-6 text-indigo-600" /></div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-gray-600">Low Stock Items</p><p className="mt-1 text-2xl font-bold text-yellow-600">{products.filter(p => p.stockQuantity <= 5).length}</p></div>
            <div className="rounded-full bg-yellow-100 p-3"><AlertCircle className="h-6 w-6 text-yellow-600" /></div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-gray-600">Dead Stock (60+ days)</p><p className="mt-1 text-2xl font-bold text-red-600">{products.filter(p => calculateStockAge(p.stockAddedDate) > 60).length}</p></div>
            <div className="rounded-full bg-red-100 p-3"><Package className="h-6 w-6 text-red-600" /></div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          <span className="ml-3 text-sm text-gray-500">Loading inventory...</span>
        </div>
      )}

      {!loading && products.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-medium text-gray-900">No products yet</h3>
          <p className="mt-1 text-sm text-gray-500">Upload your inventory via CSV or Khata book image</p>
        </div>
      )}

      {/* Products Table */}
      {!loading && products.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-white shadow">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Product Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Category</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Price</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Stock Qty</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Stock Age</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {products.map((product) => {
                  const stockAge = calculateStockAge(product.stockAddedDate);
                  return (
                    <tr key={product.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center">
                          <div className="flex h-10 w-10 items-center justify-center rounded bg-gray-200"><Package className="h-5 w-5 text-gray-400" /></div>
                          <div className="ml-4">
                            <div className="text-sm font-medium text-gray-900">{product.name}</div>
                            {product.sku && <div className="text-xs text-gray-400">SKU: {product.sku}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{product.categoryName || product.categoryId}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{formatCurrency(product.price)}</td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className={`text-sm font-medium ${product.stockQuantity <= 5 ? 'text-red-600' : 'text-gray-900'}`}>{product.stockQuantity}</span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className={`text-sm font-medium ${getStockAgeColor(stockAge)}`}>{stockAge} days</span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${product.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                          {product.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Smart CSV Upload Modal ── */}
      {showCsvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-indigo-600" />
                <h2 className="text-xl font-bold text-gray-900">Smart CSV Upload</h2>
              </div>
              <button onClick={resetCsvModal} className="text-gray-400 hover:text-gray-600"><X className="h-6 w-6" /></button>
            </div>

            {/* Step indicator */}
            <div className="mb-4 flex items-center gap-2 text-xs">
              {['Upload', 'AI Analysis', 'Mapping', 'Preview', 'Done'].map((step, i) => {
                const stepKeys = ['upload', 'analyzing', 'mapping', 'preview', 'done'];
                const currentIdx = stepKeys.indexOf(csvStep);
                return (
                  <div key={step} className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 font-medium ${i <= currentIdx ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-400'}`}>{step}</span>
                    {i < 4 && <span className="text-gray-300">→</span>}
                  </div>
                );
              })}
            </div>

            {/* Step: Upload */}
            {csvStep === 'upload' && (
              <>
                <p className="mb-3 text-sm text-gray-600">Upload any CSV file — AI will automatically understand your column names, even messy ones.</p>
                <div onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
                  className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${dragActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50'}`}>
                  <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && handleCsvSelect(e.target.files[0])}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  {csvFile ? (
                    <div className="space-y-2">
                      <FileSpreadsheet className="mx-auto h-10 w-10 text-green-600" />
                      <p className="text-sm font-medium text-gray-900">{csvFile.name}</p>
                      <p className="text-xs text-gray-500">{(csvFile.size / 1024).toFixed(1)} KB</p>
                      <button onClick={() => { setCsvFile(null); setCsvResult(null); }} className="text-sm text-red-600 hover:text-red-700">Remove</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="mx-auto h-10 w-10 text-gray-400" />
                      <p className="text-sm font-medium text-gray-900">Drag and drop CSV here</p>
                      <p className="text-xs text-gray-500">or click to browse</p>
                    </div>
                  )}
                </div>
                {csvResult && !csvResult.success && (
                  <div className="mt-3 rounded-lg bg-red-50 p-3">
                    {csvResult.errors.map((e, i) => <p key={i} className="text-sm text-red-700">⚠ {e}</p>)}
                  </div>
                )}
                <div className="mt-4 flex gap-3">
                  <button onClick={resetCsvModal} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                  <button onClick={handleCsvAnalyze} disabled={!csvFile}
                    className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    <Sparkles className="h-4 w-4" /> Analyze with AI
                  </button>
                </div>
                <div className="mt-3 rounded-lg bg-blue-50 p-3">
                  <p className="text-xs text-blue-800">
                    AI handles messy column names like <code className="bg-blue-100 px-1 rounded">item_name</code>, <code className="bg-blue-100 px-1 rounded">qty</code>, <code className="bg-blue-100 px-1 rounded">rate</code>, <code className="bg-blue-100 px-1 rounded">selling_price</code> etc.
                  </p>
                </div>
              </>
            )}

            {/* Step: Analyzing */}
            {csvStep === 'analyzing' && (
              <div className="py-12 text-center">
                <div className="relative mx-auto h-16 w-16">
                  <Loader2 className="h-16 w-16 animate-spin text-indigo-600" />
                  <Sparkles className="absolute inset-0 m-auto h-6 w-6 text-indigo-600" />
                </div>
                <p className="mt-4 text-sm font-medium text-gray-900">Gemini AI is analyzing your CSV...</p>
                <p className="mt-1 text-xs text-gray-500">Reading headers, understanding column meanings, mapping to inventory schema</p>
              </div>
            )}

            {/* Step: Mapping Review */}
            {csvStep === 'mapping' && (
              <>
                {aiMapping && (
                  <div className={`mb-4 rounded-lg p-3 ${aiMapping.confidence >= 0.75 ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
                    <div className="flex items-center gap-2">
                      <Sparkles className={`h-4 w-4 ${aiMapping.confidence >= 0.75 ? 'text-green-600' : 'text-amber-600'}`} />
                      <p className={`text-sm font-medium ${aiMapping.confidence >= 0.75 ? 'text-green-800' : 'text-amber-800'}`}>
                        AI Confidence: {Math.round(aiMapping.confidence * 100)}%
                      </p>
                    </div>
                    <p className={`mt-1 text-xs ${aiMapping.confidence >= 0.75 ? 'text-green-700' : 'text-amber-700'}`}>{aiMapping.reasoning}</p>
                  </div>
                )}
                <p className="mb-3 text-sm text-gray-600">Review and adjust column mapping:</p>
                <div className="space-y-3">
                  {(['name', 'price', 'quantity', 'category', 'sku', 'brand', 'variant'] as (keyof ColumnMapping)[]).map(field => (
                    <div key={field} className="flex items-center gap-3">
                      <label className="w-24 text-sm font-medium text-gray-700 capitalize">
                        {field}{(field === 'name' || field === 'price') && <span className="text-red-500">*</span>}
                      </label>
                      <select value={editableMapping[field] ?? ''} onChange={(e) => setEditableMapping(prev => ({ ...prev, [field]: e.target.value === '' ? null : parseInt(e.target.value) }))}
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                        <option value="">— Not mapped —</option>
                        {csvHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {csvSampleRows.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-medium text-gray-500 mb-2">Sample data preview:</p>
                    <div className="overflow-x-auto rounded border">
                      <table className="min-w-full text-xs">
                        <thead className="bg-gray-50"><tr>{csvHeaders.map((h, i) => <th key={i} className="px-2 py-1 text-left font-medium text-gray-500">{h}</th>)}</tr></thead>
                        <tbody>{csvSampleRows.map((row, ri) => <tr key={ri} className="border-t">{row.map((c, ci) => <td key={ci} className="px-2 py-1 text-gray-700">{c}</td>)}</tr>)}</tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div className="mt-4 flex gap-3">
                  <button onClick={() => setCsvStep('upload')} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Back</button>
                  <button onClick={handleMappingConfirm} disabled={editableMapping.name === null || editableMapping.price === null}
                    className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    <Eye className="h-4 w-4" /> Preview Import
                  </button>
                </div>
              </>
            )}

            {/* Step: Preview */}
            {csvStep === 'preview' && csvResult && (
              <>
                {csvResult.success ? (
                  <div className="rounded-lg bg-green-50 border border-green-200 p-3 mb-4">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <p className="text-sm font-medium text-green-800">{csvResult.products.length} products ready to import</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-red-50 p-3 mb-4">
                    {csvResult.errors.map((e, i) => <p key={i} className="text-sm text-red-700">⚠ {e}</p>)}
                  </div>
                )}
                {csvResult.warnings.length > 0 && (
                  <div className="rounded-lg bg-yellow-50 p-3 mb-4">
                    {csvResult.warnings.map((w, i) => <p key={i} className="text-xs text-yellow-700">{w}</p>)}
                  </div>
                )}
                {csvResult.products.length > 0 && (
                  <div className="overflow-x-auto rounded border mb-4 max-h-60 overflow-y-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0"><tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Name</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Price</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Qty</th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">Category</th>
                      </tr></thead>
                      <tbody>{csvResult.products.map((p, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5 text-gray-900 font-medium">{p.name}</td>
                          <td className="px-3 py-1.5 text-gray-700">{formatCurrency(p.price || 0)}</td>
                          <td className="px-3 py-1.5 text-gray-700">{p.stockQuantity}</td>
                          <td className="px-3 py-1.5 text-gray-500">{p.categoryName}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={() => setCsvStep('mapping')} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    <Edit3 className="inline h-4 w-4 mr-1" />Edit Mapping
                  </button>
                  <button onClick={handleCsvImport} disabled={!csvResult.success}
                    className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    <CheckCircle className="h-4 w-4" /> Import {csvResult.products.length} Products
                  </button>
                </div>
              </>
            )}

            {/* Step: Done */}
            {csvStep === 'done' && (
              <div className="py-8 text-center">
                <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
                <p className="mt-4 text-lg font-medium text-gray-900">Import Complete</p>
                <p className="mt-1 text-sm text-gray-500">{csvResult?.products.length} products added to your inventory</p>
                <button onClick={resetCsvModal} className="mt-6 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700">Close</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Khata Book OCR Modal ── */}
      {showImageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="h-5 w-5 text-indigo-600" />
                <h2 className="text-xl font-bold text-gray-900">Khata Book OCR</h2>
              </div>
              <button onClick={resetImageModal} className="text-gray-400 hover:text-gray-600"><X className="h-6 w-6" /></button>
            </div>

            {/* Step: Upload */}
            {imageStep === 'upload' && (
              <>
                <p className="mb-3 text-sm text-gray-600">Upload a photo of your handwritten Khata book. Gemini Vision AI will extract product details.</p>
                <div className="relative rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center">
                  <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && handleImageSelect(e.target.files[0])}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
                  {imagePreview ? (
                    <div className="space-y-3">
                      <img src={imagePreview} alt="Khata book preview" className="mx-auto max-h-48 rounded-lg object-contain shadow" />
                      <p className="text-sm font-medium text-gray-900">{imageFile?.name}</p>
                      <button onClick={() => { setImageFile(null); setImagePreview(null); }} className="text-sm text-red-600 hover:text-red-700">Remove</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Camera className="mx-auto h-10 w-10 text-gray-400" />
                      <p className="text-sm font-medium text-gray-900">Upload Khata book photo</p>
                      <p className="text-xs text-gray-500">JPG, PNG, or WebP — max 10MB</p>
                    </div>
                  )}
                </div>
                <div className="mt-4 flex gap-3">
                  <button onClick={resetImageModal} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                  <button onClick={handleImageProcess} disabled={!imageFile}
                    className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    <Sparkles className="h-4 w-4" /> Extract with AI
                  </button>
                </div>
              </>
            )}

            {/* Step: Processing */}
            {imageStep === 'processing' && (
              <div className="py-12 text-center">
                <div className="relative mx-auto h-16 w-16">
                  <Loader2 className="h-16 w-16 animate-spin text-indigo-600" />
                  <Camera className="absolute inset-0 m-auto h-6 w-6 text-indigo-600" />
                </div>
                <p className="mt-4 text-sm font-medium text-gray-900">Gemini Vision is reading your Khata book...</p>
                <p className="mt-1 text-xs text-gray-500">Extracting product names, quantities, and prices from handwriting</p>
                {imagePreview && <img src={imagePreview} alt="Processing" className="mx-auto mt-4 max-h-32 rounded-lg opacity-50" />}
              </div>
            )}

            {/* Step: Review extracted products */}
            {imageStep === 'review' && (
              <>
                <div className="mb-3 rounded-lg bg-green-50 border border-green-200 p-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-green-600" />
                    <p className="text-sm font-medium text-green-800">AI extracted {ocrProducts.length} products</p>
                  </div>
                  <p className="mt-1 text-xs text-green-700">Review and select which items to add to inventory</p>
                </div>
                {imagePreview && <img src={imagePreview} alt="Source" className="mx-auto mb-3 max-h-24 rounded-lg object-contain opacity-70" />}
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {ocrProducts.map((p, i) => (
                    <label key={i} className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition ${ocrSelected.has(i) ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input type="checkbox" checked={ocrSelected.has(i)}
                        onChange={() => setOcrSelected(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; })}
                        className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{p.name}</p>
                        <p className="text-xs text-gray-500">Qty: {p.quantity} · Price: {formatCurrency(p.price)}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${p.confidence >= 0.9 ? 'bg-green-100 text-green-700' : p.confidence >= 0.8 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                        {Math.round(p.confidence * 100)}%
                      </span>
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex gap-3">
                  <button onClick={() => setImageStep('upload')} className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Back</button>
                  <button onClick={handleImageImport} disabled={ocrSelected.size === 0}
                    className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    <CheckCircle className="h-4 w-4" /> Add {ocrSelected.size} Products
                  </button>
                </div>
              </>
            )}

            {/* Step: Done */}
            {imageStep === 'done' && (
              <div className="py-8 text-center">
                <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
                <p className="mt-4 text-lg font-medium text-gray-900">Products Added</p>
                <p className="mt-1 text-sm text-gray-500">{ocrSelected.size} items from your Khata book are now in inventory</p>
                <button onClick={resetImageModal} className="mt-6 rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white hover:bg-indigo-700">Close</button>
              </div>
            )}

            <div className="mt-3 rounded-lg bg-blue-50 p-3">
              <p className="text-xs text-blue-800">
                Gemini Vision reads handwritten entries in Hindi and English, extracts product names, quantities, and prices, then lets you review before adding.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
