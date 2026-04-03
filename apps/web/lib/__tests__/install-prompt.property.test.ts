import fc from 'fast-check';
import { shouldShowInstallPrompt } from '../install-prompt';

/**
 * Property 5: Install prompt triggers on third visit
 *
 * For any visit count n where n >= 3, shouldShowInstallPrompt returns true.
 * For any visit count n where n < 3, shouldShowInstallPrompt returns false.
 *
 * **Validates: Requirements 8.5**
 */
describe('Feature: mobile-first-ui, Property 5: Install prompt triggers on third visit', () => {
  it('should return true when visit count >= 3', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3, max: 100 }), (visitCount) => {
        expect(shouldShowInstallPrompt(visitCount)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should return false when visit count < 3', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 }), (visitCount) => {
        expect(shouldShowInstallPrompt(visitCount)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});
