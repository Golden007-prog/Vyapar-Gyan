'use client';

import { useEffect, useState, useCallback } from 'react';
import { Package, Upload, FileSpreadsheet, Image as ImageIcon, X, AlertCircle, CheckCircle, Loader2, Camera } from 'lucide-react';

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

// ── CSV Parser ──
interface CsvParseResult {
  success: boolean;
  products: Partial<Product>[];
  errors: string[];
  warnings: string[];
}

function parseCsv(text: string): CsvParseResult {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { success: false, products: [], errors: ['CSV must have a header row and at least one data row.'], warnings: [] };

  const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
  const nameIdx = header.findIndex(h => ['name', 'product', 'product_name', 'item'].includes(h));
  const priceIdx = header.findIndex(h => ['price', 'mrp', 'rate', 'cost'].includes(h));
  const qtyIdx = header.findIndex(h => ['qty', 'quantity', 'stock', 'stock_quantity', 'units'].includes(h));
  const catIdx = header.findIndex(h => ['category', 'cat', 'type'].includes(h));

  const errors: string[] = [];
  const warnings: string[] = [];

  if (nameIdx === -1) errors.push('Missing required column: name/product');
  if (priceIdx === -1) errors.push('Missing required column: price/mrp/rate');
  if (qtyIdx === -1) warnings.push('No quantity column found — defaulting to 0');
  if (catIdx === -1) warnings.push('No category column found — will be set to "Uncategorized"');
  if (errors.length > 0) return { success: false, products: [], errors, warnings };

  const products: Partial<Product>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
    const name = cols[nameIdx];
    const price = parseFloat(cols[priceIdx]);
    const qty = qtyIdx >= 0 ? parseInt(cols[qtyIdx], 10) : 0;
    const cat = catIdx >= 0 ? cols[catIdx] : 'Uncategorized';

    if (!name) { warnings.push(`Row ${i + 1}: skipped — empty name`); continue; }
    if (isNaN(price) || price <= 0) { warnings.push(`Row ${i + 1}: skipped "${name}" — invalid price`); continue; }

    products.push({
      id: `csv-${Date.now()}-${i}`,
      name,
      price,
      stockQuantity: isNaN(qty) ? 0 : qty,
      categoryName: cat,
      categoryId: `cat-${cat.toLowerCase().replace(/\s+/g, '-')}`,
      stockAddedDate: new Date().toISOString(),
      imageUrls: [],
      isActive: true,
    });
  }

  if (products.length === 0) errors.push('No valid product rows found in CSV.');
  return { success: products.length > 0, products, errors, warnings };
}

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<CsvParseResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageSuccess, setImageSuccess] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setProducts(DEMO_PRODUCTS);
      setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const calculateStockAge = (stockAddedDate: string): number => {
    return Math.ceil(Math.abs(Date.now() - new Date(stockAddedDate).getTime()) / 86400000);
  };

  const getStockAgeColor = (days: number): string => {
    if (days > 60) return 'text-red-600';
    if (days > 30) return 'text-yellow-600';
    return 'text-green-600';
  };

  const formatCurrency = (amount: number): string =>
    new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);

  // ── CSV Upload ──
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleCsvFileSelect(e.dataTransfer.files[0]);
  }, []);

  const handleCsvFileSelect = (file: File) => {
    if (!['text/csv', 'application/vnd.ms-excel'].includes(file.type) && !file.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }
    setSelectedFile(file);
    setUploadResult(null);
  };

  const handleCsvUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);
    setUploadResult(null);

    try {
      const text = await selectedFile.text();
      const result = parseCsv(text);
      setUploadResult(result);

      if (result.success && result.products.length > 0) {
        // Add parsed products to inventory
        setProducts(prev => [...prev, ...result.products as Product[]]);
      }
    } catch {
      setUploadResult({ success: false, products: [], errors: ['Failed to read file.'], warnings: [] });
    } finally {
      setUploading(false);
    }
  };

  // ── Image Upload ──
  const handleImageSelect = (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (JPG, PNG)');
      return;
    }
    setImageFile(file);
    setImageSuccess(false);
    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleImageUpload = async () => {
    if (!imageFile) return;
    setImageUploading(true);
    setImageSuccess(false);

    // Simulate OCR processing delay
    await new Promise(r => setTimeout(r, 2000));

    // Simulate Gemini Vision OCR result — add demo products from "Khata book"
    const ocrProducts: Product[] = [
      { id: `ocr-${Date.now()}-1`, name: 'Toor Dal 1kg', categoryId: 'cat-groceries', categoryName: 'Groceries', price: 160, stockQuantity: 10, stockAddedDate: new Date().toISOString(), imageUrls: [], isActive: true },
      { id: `ocr-${Date.now()}-2`, name: 'Basmati Rice 5kg', categoryId: 'cat-groceries', categoryName: 'Groceries', price: 450, stockQuantity: 8, stockAddedDate: new Date().toISOString(), imageUrls: [], isActive: true },
      { id: `ocr-${Date.now()}-3`, name: 'Sugar 2kg', categoryId: 'cat-groceries', categoryName: 'Groceries', price: 90, stockQuantity: 15, stockAddedDate: new Date().toISOString(), imageUrls: [], isActive: true },
    ];

    setProducts(prev => [...prev, ...ocrProducts]);
    setImageUploading(false);
    setImageSuccess(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory Hub</h1>
          <p className="mt-1 text-sm text-gray-500">Manage your product catalog and bulk upload inventory</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setShowImageModal(true); setImageFile(null); setImagePreview(null); setImageSuccess(false); }}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Camera className="h-4 w-4" /> Khata Book OCR
          </button>
          <button onClick={() => { setShowUploadModal(true); setSelectedFile(null); setUploadResult(null); }}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            <Upload className="h-4 w-4" /> CSV Upload
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Products</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{products.length}</p>
            </div>
            <div className="rounded-full bg-indigo-100 p-3"><Package className="h-6 w-6 text-indigo-600" /></div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Low Stock Items</p>
              <p className="mt-1 text-2xl font-bold text-yellow-600">{products.filter(p => p.stockQuantity <= 5).length}</p>
            </div>
            <div className="rounded-full bg-yellow-100 p-3"><AlertCircle className="h-6 w-6 text-yellow-600" /></div>
          </div>
        </div>
        <div className="rounded-lg border bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Dead Stock (60+ days)</p>
              <p className="mt-1 text-2xl font-bold text-red-600">{products.filter(p => calculateStockAge(p.stockAddedDate) > 60).length}</p>
            </div>
            <div className="rounded-full bg-red-100 p-3"><Package className="h-6 w-6 text-red-600" /></div>
          </div>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
          <span className="ml-3 text-sm text-gray-500">Loading inventory...</span>
        </div>
      )}

      {/* Empty */}
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
                          <div className="flex h-10 w-10 items-center justify-center rounded bg-gray-200">
                            <Package className="h-5 w-5 text-gray-400" />
                          </div>
                          <div className="ml-4 text-sm font-medium text-gray-900">{product.name}</div>
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

      {/* CSV Upload Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">CSV Upload</h2>
              <button onClick={() => { setShowUploadModal(false); setSelectedFile(null); setUploadResult(null); }} className="text-gray-400 hover:text-gray-600">
                <X className="h-6 w-6" />
              </button>
            </div>

            <p className="mb-3 text-sm text-gray-600">
              Upload a CSV file with columns: <code className="rounded bg-gray-100 px-1 text-xs">name, price, quantity, category</code>
            </p>

            {/* Drag and Drop */}
            <div onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              className={`relative rounded-lg border-2 border-dashed p-8 text-center transition-colors ${dragActive ? 'border-indigo-500 bg-indigo-50' : 'border-gray-300 bg-gray-50'}`}>
              <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && handleCsvFileSelect(e.target.files[0])}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              {selectedFile ? (
                <div className="space-y-2">
                  <FileSpreadsheet className="mx-auto h-10 w-10 text-green-600" />
                  <p className="text-sm font-medium text-gray-900">{selectedFile.name}</p>
                  <p className="text-xs text-gray-500">{(selectedFile.size / 1024).toFixed(1)} KB</p>
                  <button onClick={() => { setSelectedFile(null); setUploadResult(null); }} className="text-sm text-red-600 hover:text-red-700">Remove</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="mx-auto h-10 w-10 text-gray-400" />
                  <p className="text-sm font-medium text-gray-900">Drag and drop CSV here</p>
                  <p className="text-xs text-gray-500">or click to browse</p>
                </div>
              )}
            </div>

            {/* Upload Result */}
            {uploadResult && (
              <div className="mt-4 space-y-2">
                {uploadResult.success ? (
                  <div className="rounded-lg bg-green-50 p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <p className="text-sm font-medium text-green-800">
                        Successfully imported {uploadResult.products.length} products
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg bg-red-50 p-3">
                    {uploadResult.errors.map((err, i) => (
                      <p key={i} className="text-sm text-red-700">⚠ {err}</p>
                    ))}
                  </div>
                )}
                {uploadResult.warnings.length > 0 && (
                  <div className="rounded-lg bg-yellow-50 p-3">
                    {uploadResult.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-yellow-700">{w}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button onClick={() => { setShowUploadModal(false); setSelectedFile(null); setUploadResult(null); }}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCsvUpload} disabled={!selectedFile || uploading}
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {uploading ? <><Loader2 className="h-4 w-4 animate-spin" />Processing...</> : 'Upload & Parse'}
              </button>
            </div>

            <div className="mt-3 rounded-lg bg-blue-50 p-3">
              <p className="text-xs text-blue-800">
                <strong>Sample CSV format:</strong><br />
                name,price,quantity,category<br />
                Amul Butter 500g,280,50,Groceries<br />
                USB-C Cable,149,100,Electronics
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Image / Khata Book Upload Modal */}
      {showImageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900">Khata Book OCR Upload</h2>
              <button onClick={() => setShowImageModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-6 w-6" />
              </button>
            </div>

            <p className="mb-3 text-sm text-gray-600">
              Upload a photo of your handwritten Khata book or stock register. Gemini Vision AI will extract product details automatically.
            </p>

            <div className="relative rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 p-6 text-center">
              <input type="file" accept="image/jpeg,image/jpg,image/png" onChange={(e) => e.target.files?.[0] && handleImageSelect(e.target.files[0])}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              {imagePreview ? (
                <div className="space-y-3">
                  <img src={imagePreview} alt="Preview" className="mx-auto max-h-48 rounded-lg object-contain shadow" />
                  <p className="text-sm font-medium text-gray-900">{imageFile?.name}</p>
                  <button onClick={() => { setImageFile(null); setImagePreview(null); setImageSuccess(false); }} className="text-sm text-red-600 hover:text-red-700">Remove</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Camera className="mx-auto h-10 w-10 text-gray-400" />
                  <p className="text-sm font-medium text-gray-900">Upload Khata book photo</p>
                  <p className="text-xs text-gray-500">JPG or PNG, max 10MB</p>
                </div>
              )}
            </div>

            {imageSuccess && (
              <div className="mt-4 rounded-lg bg-green-50 p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <p className="text-sm font-medium text-green-800">
                    AI extracted 3 products from your Khata book and added them to inventory
                  </p>
                </div>
              </div>
            )}

            <div className="mt-6 flex gap-3">
              <button onClick={() => setShowImageModal(false)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={handleImageUpload} disabled={!imageFile || imageUploading}
                className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                {imageUploading ? <><Loader2 className="h-4 w-4 animate-spin" />AI Processing...</> : 'Upload & Extract'}
              </button>
            </div>

            <div className="mt-3 rounded-lg bg-blue-50 p-3">
              <p className="text-xs text-blue-800">
                <strong>AI Processing:</strong> Gemini Vision will read your handwritten entries, extract product names, quantities, and prices, then add them to your inventory. Takes ~2 seconds.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
