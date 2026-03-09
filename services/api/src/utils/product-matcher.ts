/**
 * Product Matcher
 * 
 * Fuzzy product matching for WhatsApp bot queries.
 * Handles case-insensitive matching, partial names, brand aliases,
 * variant resolution (size/quantity), and ranked candidate scoring.
 */

import { logger } from './logger';

// ── Types ──────────────────────────────────────────────────────────────

export interface ProductCandidate {
  id: string;
  name: string;
  price: number;
  stockQuantity: number;
  categoryId?: string;
  [key: string]: any;
}

export interface MatchResult {
  type: 'exact' | 'fuzzy' | 'multiple' | 'none';
  product?: ProductCandidate;
  candidates?: ProductCandidate[];
  score?: number;
}

// ── Common Indian grocery brand aliases / synonyms ─────────────────────

const BRAND_ALIASES: Record<string, string[]> = {
  'tata': ['tata'],
  'amul': ['amul'],
  'surf': ['surf excel', 'surf'],
  'red label': ['red label', 'brooke bond red label'],
  'brooke bond': ['brooke bond', 'red label'],
  'parle': ['parle', 'parle-g', 'parle g'],
  'maggi': ['maggi', 'nestle maggi'],
  'nestle': ['nestle', 'nescafe'],
  'britannia': ['britannia'],
  'haldiram': ['haldiram', 'haldirams'],
  'mdh': ['mdh'],
  'everest': ['everest'],
  'fortune': ['fortune'],
  'aashirvaad': ['aashirvaad', 'ashirvaad', 'aashirvad'],
  'vim': ['vim'],
  'dettol': ['dettol'],
  'lifebuoy': ['lifebuoy'],
  'lux': ['lux'],
  'dove': ['dove'],
  'clinic plus': ['clinic plus', 'clinic'],
  'head shoulders': ['head & shoulders', 'head and shoulders', 'h&s'],
  'colgate': ['colgate'],
  'closeup': ['closeup', 'close up', 'close-up'],
  'dabur': ['dabur'],
  'patanjali': ['patanjali'],
  'mother dairy': ['mother dairy'],
  'verka': ['verka'],
  'nandini': ['nandini'],
};

// ── Size/variant patterns ──────────────────────────────────────────────

const SIZE_PATTERN = /(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|gram|grams|ml|l|ltr|litre|litres|liter|liters|pcs?|pieces?|pack|units?)\b/i;

// ── Core matching logic ────────────────────────────────────────────────

/**
 * Normalize a product name for comparison.
 * Lowercases, trims, collapses whitespace, removes common filler words.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[''`]/g, '')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(the|a|an|of|for|and|&)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract size/variant info from a query string.
 */
function extractSize(text: string): { cleaned: string; size?: string } {
  const match = text.match(SIZE_PATTERN);
  if (match) {
    const size = match[0];
    const cleaned = text.replace(SIZE_PATTERN, '').replace(/\s+/g, ' ').trim();
    return { cleaned, size: size.toLowerCase() };
  }
  return { cleaned: text };
}

/**
 * Compute a simple similarity score between two normalized strings.
 * Returns 0-1 where 1 is exact match.
 */
function similarityScore(query: string, target: string): number {
  if (query === target) return 1.0;

  // Check if query is a substring of target or vice versa
  if (target.includes(query)) return 0.85 + (query.length / target.length) * 0.1;
  if (query.includes(target)) return 0.7;

  // Token-based matching
  const queryTokens = query.split(' ').filter(t => t.length > 1);
  const targetTokens = target.split(' ').filter(t => t.length > 1);

  if (queryTokens.length === 0 || targetTokens.length === 0) return 0;

  let matchedTokens = 0;
  for (const qt of queryTokens) {
    for (const tt of targetTokens) {
      if (tt === qt) {
        matchedTokens += 1;
        break;
      }
      if (tt.includes(qt) || qt.includes(tt)) {
        matchedTokens += 0.7;
        break;
      }
      // Levenshtein for close matches (typos)
      if (qt.length > 3 && tt.length > 3 && levenshteinDistance(qt, tt) <= 2) {
        matchedTokens += 0.5;
        break;
      }
    }
  }

  return matchedTokens / Math.max(queryTokens.length, targetTokens.length);
}

/**
 * Levenshtein edit distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }

  return dp[m]![n]!;
}

/**
 * Check if query matches any known brand alias.
 */
function expandBrandAliases(query: string): string[] {
  const lower = query.toLowerCase();
  const expansions: string[] = [lower];

  for (const [_brand, aliases] of Object.entries(BRAND_ALIASES)) {
    for (const alias of aliases) {
      if (lower.includes(alias)) {
        // Add all aliases for this brand as potential search terms
        for (const otherAlias of aliases) {
          if (otherAlias !== alias) {
            expansions.push(lower.replace(alias, otherAlias));
          }
        }
      }
    }
  }

  return [...new Set(expansions)];
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Find the best matching product from a list of candidates.
 * 
 * Strategy:
 * 1. Try exact normalized match
 * 2. Try substring/contains match
 * 3. Try brand alias expansion
 * 4. Try fuzzy token matching with scoring
 * 5. If multiple good matches, return them for clarification
 * 6. If no match, return none
 */
export function findBestMatch(
  query: string,
  products: ProductCandidate[],
  _options?: { sizeAware?: boolean },
): MatchResult {
  if (!query || products.length === 0) {
    return { type: 'none' };
  }

  const { cleaned: cleanedQuery, size: querySize } = extractSize(query);
  const normalizedQuery = normalize(cleanedQuery);
  const expandedQueries = expandBrandAliases(normalizedQuery);

  logger.debug('Product matching', {
    originalQuery: query,
    normalizedQuery,
    querySize,
    expandedQueries: expandedQueries.length,
    candidateCount: products.length,
  });

  // Score all products
  const scored = products.map(product => {
    const normalizedName = normalize(product.name);
    const { size: productSize } = extractSize(product.name);

    // Best score across all query expansions
    let bestScore = 0;
    for (const eq of expandedQueries) {
      const score = similarityScore(eq, normalizedName);
      if (score > bestScore) bestScore = score;
    }

    // Size bonus/penalty
    if (querySize && productSize) {
      if (querySize === productSize) {
        bestScore = Math.min(1.0, bestScore + 0.1); // Size match bonus
      } else {
        bestScore = Math.max(0, bestScore - 0.15); // Size mismatch penalty
      }
    }

    return { product, score: bestScore, normalizedName };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score < 0.3) {
    return { type: 'none' };
  }

  // Exact or very high confidence match
  if (top.score >= 0.85) {
    return { type: 'exact', product: top.product, score: top.score };
  }

  // Check if there are multiple close candidates
  const closeMatches = scored.filter(s => s.score >= 0.5 && s.score >= top.score - 0.15);

  if (closeMatches.length === 1) {
    return { type: 'fuzzy', product: closeMatches[0]!.product, score: closeMatches[0]!.score };
  }

  if (closeMatches.length > 1 && closeMatches.length <= 5) {
    return {
      type: 'multiple',
      candidates: closeMatches.map(m => m.product),
    };
  }

  // Too many matches or low confidence — return best guess as fuzzy
  if (top.score >= 0.5) {
    return { type: 'fuzzy', product: top.product, score: top.score };
  }

  return { type: 'none' };
}

/**
 * Format a "did you mean?" clarification message for WhatsApp.
 */
export function formatClarificationMessage(
  originalQuery: string,
  candidates: ProductCandidate[],
): string {
  const lines = [`I found a few products matching "${originalQuery}":`];
  lines.push('');
  candidates.slice(0, 5).forEach((p, i) => {
    lines.push(`${i + 1}. ${p.name} — ₹${p.price} (${p.stockQuantity} in stock)`);
  });
  lines.push('');
  lines.push('Which one did you mean? Reply with the number or full name.');
  return lines.join('\n');
}

/**
 * Format a "not found" message with optional suggestions.
 */
export function formatNotFoundMessage(
  query: string,
  suggestions?: ProductCandidate[],
): string {
  let msg = `I couldn't find "${query}" in the inventory.`;
  if (suggestions && suggestions.length > 0) {
    msg += '\n\nDid you mean:\n';
    suggestions.slice(0, 3).forEach((p, i) => {
      msg += `${i + 1}. ${p.name}\n`;
    });
    msg += '\nReply with the product name to check.';
  } else {
    msg += '\nPlease check the product name and try again.';
  }
  return msg;
}
