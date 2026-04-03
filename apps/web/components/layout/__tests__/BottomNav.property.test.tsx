/**
 * Property-based test: Active tab matches current route
 *
 * **Validates: Requirements 2.5**
 *
 * For any NavItem in any role's navigation configuration, when the current
 * pathname matches that item's href, the BottomNav component shall render
 * that tab with the active highlight style (indigo-600) and no other tab
 * shall have the active style.
 */
import React from 'react';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import * as fc from 'fast-check';
import { SELLER_NAV, CUSTOMER_NAV, ADMIN_NAV } from '../nav-config';
import type { NavConfig } from '../nav-config';

// --- Mocks ---

let mockPathname = '/';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

jest.mock('next/link', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ href, children, className, ...rest }: any) =>
      React.createElement('a', { href, className, ...rest }, children),
  };
});

// --- Helpers ---

const ALL_CONFIGS: NavConfig[] = [SELLER_NAV, CUSTOMER_NAV, ADMIN_NAV];

/** Collect all linkable primary items (skip #more) across all role configs */
function allLinkableItems() {
  const items: { config: NavConfig; item: (typeof SELLER_NAV.primary)[number] }[] = [];
  for (const config of ALL_CONFIGS) {
    for (const item of config.primary) {
      if (item.href !== '#more') {
        items.push({ config, item });
      }
    }
  }
  return items;
}

const linkableItems = allLinkableItems();

/** fast-check arbitrary that picks a random linkable NavItem with its config */
const navItemArb = fc.integer({ min: 0, max: linkableItems.length - 1 }).map(
  (i) => linkableItems[i],
);

// --- Test ---

describe('BottomNav - Property 1: Active tab matches current route', () => {
  it('should highlight only the tab whose href matches the current pathname', () => {
    fc.assert(
      fc.property(navItemArb, ({ config, item }) => {
        // Set the mocked pathname to this item's href
        mockPathname = item.href;

        const { BottomNav } = require('../BottomNav');

        const { container } = render(
          <BottomNav
            items={config.primary}
            overflowItems={config.overflow}
            onMorePress={() => {}}
          />,
        );

        // Get all link elements (tabs rendered as <a> tags)
        const links = container.querySelectorAll('a');

        let activeCount = 0;

        links.forEach((link) => {
          const href = link.getAttribute('href');
          const classes = link.className;
          const hasActiveStyle =
            classes.includes('text-indigo-600') && classes.includes('bg-indigo-50');

          if (href === item.href) {
            // This tab should be active
            expect(hasActiveStyle).toBe(true);
            if (hasActiveStyle) activeCount++;
          } else {
            // This tab should NOT be active
            expect(hasActiveStyle).toBe(false);
          }
        });

        // Exactly one tab should be active
        expect(activeCount).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
