/**
 * Property-Based Tests for Category Operations
 *
 * Tests category rename propagation, merge preview, alias resolution,
 * and deactivated category filtering for the Global Catalog Manager.
 *
 * Uses fast-check to verify invariants across randomised inputs.
 */

import * as fc from 'fast-check';
import {
  resolveAlias,
  computeMergePreview,
  filterActiveCategories,
  propagateRename,
  type CategoryRecord,
  type CategoryAlias,
  type ProductRecord,
} from '../../handlers/admin/catalog-manager';

// ── Generators ─────────────────────────────────────────────────────────

/** Generate a category ID */
const categoryIdArb = fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'), {
  minLength: 4,
  maxLength: 12,
}).map(s => `cat-${s}`);

/** Generate a seller ID */
const sellerIdArb = fc.uuid();

/** Generate a product record */
const productRecordArb = (categoryIds: string[]): fc.Arbitrary<ProductRecord> =>
  fc.record({
    productId: fc.uuid(),
    sellerId: sellerIdArb,
    categoryId: fc.constantFrom(...categoryIds),
    name: fc.string({ minLength: 1, maxLength: 50 }),
  });

/** Generate a CategoryRecord */
const categoryRecordArb: fc.Arbitrary<CategoryRecord> = fc.record({
  categoryId: categoryIdArb,
  name: fc.string({ minLength: 1, maxLength: 50 }),
  status: fc.constantFrom('active' as const, 'inactive' as const),
  productCount: fc.nat({ max: 1000 }),
  activeSellers: fc.nat({ max: 100 }),
  createdAt: fc.date().map(d => d.toISOString()),
  updatedAt: fc.date().map(d => d.toISOString()),
});

/** Generate a CategoryAlias */
const categoryAliasArb = (canonicalName: string, categoryId: string): fc.Arbitrary<CategoryAlias> =>
  fc.record({
    alias: fc.string({ minLength: 1, maxLength: 30 }).map(s => s.trim()).filter(s => s.length > 0),
    language: fc.constantFrom('en', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn'),
    canonicalName: fc.constant(canonicalName),
    categoryId: fc.constant(categoryId),
    createdAt: fc.date().map(d => d.toISOString()),
  });

// ── Property 20: Category rename propagates to all products ──────────

describe('Property 20: Category rename propagates to all products', () => {
  /**
   * **Validates: Requirement 18.3**
   *
   * For any rename operation, all product records referencing old category
   * name are updated to new name, and count of updated products equals
   * count of products with old category.
   */

  it('all products with old categoryId are updated to new categoryId', () => {
    fc.assert(
      fc.property(
        categoryIdArb,
        categoryIdArb,
        fc.array(fc.record({
          productId: fc.uuid(),
          sellerId: sellerIdArb,
          categoryId: categoryIdArb,
          name: fc.string({ minLength: 1, maxLength: 50 }),
        }), { minLength: 0, maxLength: 30 }),
        (oldCatId, newCatId, products) => {
          fc.pre(oldCatId !== newCatId);

          const originalCount = products.filter(p => p.categoryId === oldCatId).length;
          const result = propagateRename(products, oldCatId, newCatId);

          // No products should reference old category after rename
          const remainingOld = result.filter(p => p.categoryId === oldCatId).length;
          expect(remainingOld).toBe(0);

          // Count of products now referencing new category should include the renamed ones
          const newCatCount = result.filter(p => p.categoryId === newCatId).length;
          const originalNewCatCount = products.filter(p => p.categoryId === newCatId).length;
          expect(newCatCount).toBe(originalNewCatCount + originalCount);

          // Total product count is preserved
          expect(result.length).toBe(products.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('products not referencing old category are unchanged', () => {
    fc.assert(
      fc.property(
        categoryIdArb,
        categoryIdArb,
        fc.array(fc.record({
          productId: fc.uuid(),
          sellerId: sellerIdArb,
          categoryId: categoryIdArb,
          name: fc.string({ minLength: 1, maxLength: 50 }),
        }), { minLength: 1, maxLength: 20 }),
        (oldCatId, newCatId, products) => {
          fc.pre(oldCatId !== newCatId);

          const result = propagateRename(products, oldCatId, newCatId);

          // Products that didn't have oldCatId should be identical
          products.forEach((p, i) => {
            if (p.categoryId !== oldCatId) {
              expect(result[i].categoryId).toBe(p.categoryId);
              expect(result[i].productId).toBe(p.productId);
              expect(result[i].sellerId).toBe(p.sellerId);
            }
          });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rename is idempotent when applied twice', () => {
    fc.assert(
      fc.property(
        categoryIdArb,
        categoryIdArb,
        fc.array(fc.record({
          productId: fc.uuid(),
          sellerId: sellerIdArb,
          categoryId: categoryIdArb,
          name: fc.string({ minLength: 1, maxLength: 50 }),
        }), { minLength: 0, maxLength: 15 }),
        (oldCatId, newCatId, products) => {
          fc.pre(oldCatId !== newCatId);

          const first = propagateRename(products, oldCatId, newCatId);
          const second = propagateRename(first, oldCatId, newCatId);

          // Second application should produce same result (no old refs left)
          expect(second).toEqual(first);
        },
      ),
      { numRuns: 100 },
    );
  });
});


// ── Property 21: Merge preview correctly counts affected products and sellers ──

describe('Property 21: Merge preview correctly counts affected products and sellers', () => {
  /**
   * **Validates: Requirement 18.4**
   *
   * For any two categories (source, target), merge preview returns exact
   * count of products with categoryId = sourceId and exact count of
   * distinct sellers among those products.
   */

  it('affectedProducts equals count of products with sourceId', () => {
    fc.assert(
      fc.property(
        categoryIdArb,
        categoryIdArb,
        fc.array(fc.record({
          productId: fc.uuid(),
          sellerId: sellerIdArb,
          categoryId: categoryIdArb,
          name: fc.string({ minLength: 1, maxLength: 50 }),
        }), { minLength: 0, maxLength: 30 }),
        (sourceId, targetId, products) => {
          fc.pre(sourceId !== targetId);

          const preview = computeMergePreview(products, sourceId, targetId);
          const expectedCount = products.filter(p => p.categoryId === sourceId).length;

          expect(preview.affectedProducts).toBe(expectedCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('affectedSellers equals distinct seller count among source products', () => {
    fc.assert(
      fc.property(
        categoryIdArb,
        categoryIdArb,
        fc.array(fc.record({
          productId: fc.uuid(),
          sellerId: sellerIdArb,
          categoryId: categoryIdArb,
          name: fc.string({ minLength: 1, maxLength: 50 }),
        }), { minLength: 0, maxLength: 30 }),
        (sourceId, targetId, products) => {
          fc.pre(sourceId !== targetId);

          const preview = computeMergePreview(products, sourceId, targetId);
          const sourceProducts = products.filter(p => p.categoryId === sourceId);
          const expectedSellers = new Set(sourceProducts.map(p => p.sellerId)).size;

          expect(preview.affectedSellers).toBe(expectedSellers);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty product list returns zero counts', () => {
    fc.assert(
      fc.property(
        categoryIdArb,
        categoryIdArb,
        (sourceId, targetId) => {
          const preview = computeMergePreview([], sourceId, targetId);
          expect(preview.affectedProducts).toBe(0);
          expect(preview.affectedSellers).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('products not in source category are not counted', () => {
    fc.assert(
      fc.property(
        categoryIdArb,
        categoryIdArb,
        categoryIdArb,
        fc.array(fc.record({
          productId: fc.uuid(),
          sellerId: sellerIdArb,
          name: fc.string({ minLength: 1, maxLength: 50 }),
        }), { minLength: 1, maxLength: 10 }),
        (sourceId, targetId, otherId, baseProducts) => {
          fc.pre(sourceId !== targetId && sourceId !== otherId && targetId !== otherId);

          // All products belong to otherId (not source)
          const products = baseProducts.map(p => ({ ...p, categoryId: otherId }));
          const preview = computeMergePreview(products, sourceId, targetId);

          expect(preview.affectedProducts).toBe(0);
          expect(preview.affectedSellers).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 22: Category aliases resolve to canonical name ──────────

describe('Property 22: Category aliases resolve to canonical name', () => {
  /**
   * **Validates: Requirement 18.5**
   *
   * For any set of aliases mapped to a canonical category, looking up
   * any alias returns the same canonical category name.
   */

  it('any alias in the set resolves to the same canonical name', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        categoryIdArb,
        fc.array(
          fc.string({ minLength: 1, maxLength: 20 }).map(s => s.trim()).filter(s => s.length > 0),
          { minLength: 1, maxLength: 10 },
        ),
        (canonicalName, categoryId, aliasNames) => {
          // Ensure unique aliases
          const uniqueAliases = [...new Set(aliasNames.map(a => a.toLowerCase()))];
          fc.pre(uniqueAliases.length > 0);

          const aliases: CategoryAlias[] = uniqueAliases.map(a => ({
            alias: a,
            language: 'en',
            canonicalName,
            categoryId,
            createdAt: new Date().toISOString(),
          }));

          // Every alias should resolve to the same canonical name
          for (const a of aliases) {
            const resolved = resolveAlias(aliases, a.alias);
            expect(resolved).toBe(canonicalName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('alias resolution is case-insensitive', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        categoryIdArb,
        fc.string({ minLength: 1, maxLength: 20 }).map(s => s.trim()).filter(s => s.length > 0),
        (canonicalName, categoryId, aliasName) => {
          const aliases: CategoryAlias[] = [{
            alias: aliasName.toLowerCase(),
            language: 'en',
            canonicalName,
            categoryId,
            createdAt: new Date().toISOString(),
          }];

          // Lookup with different cases should all resolve
          expect(resolveAlias(aliases, aliasName.toLowerCase())).toBe(canonicalName);
          expect(resolveAlias(aliases, aliasName.toUpperCase())).toBe(canonicalName);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('non-existent alias returns null', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        categoryIdArb,
        fc.string({ minLength: 1, maxLength: 20 }).map(s => s.trim()).filter(s => s.length > 0),
        fc.string({ minLength: 1, maxLength: 20 }).map(s => s.trim()).filter(s => s.length > 0),
        (canonicalName, categoryId, aliasName, lookupName) => {
          fc.pre(aliasName.toLowerCase() !== lookupName.toLowerCase());

          const aliases: CategoryAlias[] = [{
            alias: aliasName.toLowerCase(),
            language: 'en',
            canonicalName,
            categoryId,
            createdAt: new Date().toISOString(),
          }];

          expect(resolveAlias(aliases, lookupName)).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty alias list always returns null', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }),
        (input) => {
          expect(resolveAlias([], input)).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 23: Deactivated categories excluded from customer queries ──

describe('Property 23: Deactivated categories excluded from customer queries', () => {
  /**
   * **Validates: Requirement 18.6**
   *
   * For any set of categories where some are deactivated, customer-facing
   * query returns only active categories.
   */

  it('only active categories are returned', () => {
    fc.assert(
      fc.property(
        fc.array(categoryRecordArb, { minLength: 0, maxLength: 20 }),
        (categories) => {
          const result = filterActiveCategories(categories);

          // Every returned category must be active
          for (const cat of result) {
            expect(cat.status).toBe('active');
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('no deactivated categories are included', () => {
    fc.assert(
      fc.property(
        fc.array(categoryRecordArb, { minLength: 0, maxLength: 20 }),
        (categories) => {
          const result = filterActiveCategories(categories);
          const inactiveInResult = result.filter(c => c.status === 'inactive');

          expect(inactiveInResult.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('count of active results equals count of active inputs', () => {
    fc.assert(
      fc.property(
        fc.array(categoryRecordArb, { minLength: 0, maxLength: 20 }),
        (categories) => {
          const result = filterActiveCategories(categories);
          const expectedCount = categories.filter(c => c.status === 'active').length;

          expect(result.length).toBe(expectedCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('all-active input returns all categories', () => {
    fc.assert(
      fc.property(
        fc.array(
          categoryRecordArb.map(c => ({ ...c, status: 'active' as const })),
          { minLength: 1, maxLength: 10 },
        ),
        (categories) => {
          const result = filterActiveCategories(categories);
          expect(result.length).toBe(categories.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('all-inactive input returns empty array', () => {
    fc.assert(
      fc.property(
        fc.array(
          categoryRecordArb.map(c => ({ ...c, status: 'inactive' as const })),
          { minLength: 1, maxLength: 10 },
        ),
        (categories) => {
          const result = filterActiveCategories(categories);
          expect(result.length).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
