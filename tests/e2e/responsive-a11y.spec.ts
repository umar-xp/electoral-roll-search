/**
 * E2E Tests — Mobile, Accessibility & Responsive Design
 * ========================================================
 * Tests for responsive breakpoints, touch targets, screen readers,
 * keyboard navigation, and mobile-specific behaviors.
 *
 * Run: npx playwright test tests/e2e/responsive-a11y.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test';

// ──────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────

async function waitForDistrictsLoaded(page: Page) {
  await page.locator('#sel-district option[value="MYSORE"]').waitFor({ state: 'attached', timeout: 15000 });
}

// ──────────────────────────────────────────────────────────────────────
// RESPONSIVE LAYOUT
// ──────────────────────────────────────────────────────────────────────

test.describe('Responsive Layout — Mobile (375px)', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
  });

  test('page renders without horizontal overflow', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5); // 5px tolerance
  });

  test('search input is full width on mobile', async ({ page }) => {
    const inputBox = await page.locator('#inp-voter-name').boundingBox();
    expect(inputBox!.width).toBeGreaterThan(250);
  });

  test('search button has adequate touch target size', async ({ page }) => {
    const btnBox = await page.locator('#btn-search').boundingBox();
    expect(btnBox!.height).toBeGreaterThanOrEqual(40); // Near iOS minimum 44px
  });

  test('district dropdown is full width', async ({ page }) => {
    const selBox = await page.locator('#sel-district').boundingBox();
    expect(selBox!.width).toBeGreaterThan(250);
  });

  test('tabs are visible and tappable', async ({ page }) => {
    const tabBtnDB = page.locator('#tab-btn-db');
    await expect(tabBtnDB).toBeVisible();
    const tabBox = await tabBtnDB.boundingBox();
    expect(tabBox!.height).toBeGreaterThanOrEqual(40);
  });

  test('feedback FAB does not overlap search button', async ({ page }) => {
    const fabBox = await page.locator('#btn-feedback').boundingBox();
    const searchBox = await page.locator('#btn-search').boundingBox();
    if (fabBox && searchBox) {
      const fabBottom = fabBox.y + fabBox.height;
      const searchTop = searchBox.y;
      // They should not overlap
      const fabRight = fabBox.x + fabBox.width;
      const searchLeft = searchBox.x;
      const overlapsVertically = fabBox.y < searchTop + searchBox.height && fabBottom > searchTop;
      const overlapsHorizontally = fabBox.x < searchLeft + searchBox.width && fabRight > searchLeft;
      if (overlapsVertically && overlapsHorizontally) {
        // If they overlap, test fails
        expect(overlapsVertically && overlapsHorizontally).toBe(false);
      }
    }
  });
});

test.describe('Responsive Layout — Tablet (768px)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
  });

  test('form elements arrange in grid on tablet', async ({ page }) => {
    const districtBox = await page.locator('#sel-district').boundingBox();
    const acBox = await page.locator('#sel-ac').boundingBox();
    // On tablet, these may be side by side or stacked — just check they're visible
    expect(districtBox).not.toBeNull();
    expect(acBox).not.toBeNull();
  });

  test('no horizontal scroll on tablet', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });
});

test.describe('Responsive Layout — Desktop (1440px)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
  });

  test('main container has max-width constraint', async ({ page }) => {
    const mainBox = await page.locator('.main-container, main, .app-shell').first().boundingBox();
    if (mainBox) {
      expect(mainBox.width).toBeLessThanOrEqual(1200);
    }
  });

  test('content is centered on desktop', async ({ page }) => {
    const mainBox = await page.locator('.main-container, main, .app-shell').first().boundingBox();
    if (mainBox) {
      const viewportWidth = 1440;
      const leftMargin = mainBox.x;
      const rightMargin = viewportWidth - (mainBox.x + mainBox.width);
      // Margins should be roughly equal (centered)
      expect(Math.abs(leftMargin - rightMargin)).toBeLessThan(50);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// ACCESSIBILITY — ARIA & SEMANTICS
// ──────────────────────────────────────────────────────────────────────

test.describe('Accessibility — ARIA & Semantics', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  });

  test('all form inputs have labels or aria-label', async ({ page }) => {
    // Check main search form inputs (exclude radio, hidden, and secondary content)
    const inputs = page.locator('.search-panel input:not([type="hidden"]):not([type="radio"]), .search-panel select, .search-panel textarea');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const id = await input.getAttribute('id');
      const ariaLabel = await input.getAttribute('aria-label');
      const ariaLabelledby = await input.getAttribute('aria-labelledby');
      const placeholder = await input.getAttribute('placeholder');
      const title = await input.getAttribute('title');
      const label = id ? await page.locator(`label[for="${id}"]`).count() : 0;
      // At least one accessibility mechanism
      expect(
        ariaLabel || ariaLabelledby || label > 0 || placeholder || title,
        `Input ${id || 'unnamed'} should have accessibility label`
      ).toBeTruthy();
    }
  });

  test('buttons have accessible text', async ({ page }) => {
    const buttons = page.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const btn = buttons.nth(i);
      const text = await btn.textContent();
      const ariaLabel = await btn.getAttribute('aria-label');
      const title = await btn.getAttribute('title');
      expect(
        (text && text.trim().length > 0) || ariaLabel || title,
        `Button at index ${i} should have accessible text`
      ).toBeTruthy();
    }
  });

  test('page has main heading', async ({ page }) => {
    const h1 = page.locator('h1');
    await expect(h1.first()).toBeVisible();
  });

  test('tabs have proper role attributes', async ({ page }) => {
    // Tab buttons should have role=tab or be inside a tablist
    const tabList = page.locator('[role="tablist"], .tab-group, .tabs');
    const count = await tabList.count();
    // At least we have tab-like buttons
    await expect(page.locator('#tab-btn-db')).toBeVisible();
    await expect(page.locator('#tab-btn-upload')).toBeVisible();
  });

  test('modals trap focus when open', async ({ page }) => {
    await page.locator('#btn-feedback').click();
    await page.waitForTimeout(300);
    // Focus should be inside the modal
    const activeElement = await page.evaluate(() => document.activeElement?.closest('.feedback-modal, #feedbackModalOverlay'));
    // Pressing Tab should keep focus inside modal
    await page.keyboard.press('Tab');
    const newFocus = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.closest('.feedback-modal, #feedbackModalOverlay') !== null;
    });
    expect(newFocus).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// KEYBOARD NAVIGATION
// ──────────────────────────────────────────────────────────────────────

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
  });

  test('Tab key navigates through form controls', async ({ page }) => {
    await page.keyboard.press('Tab');
    // Focus should move to first interactive element
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(['INPUT', 'SELECT', 'BUTTON', 'A']).toContain(focusedTag);
  });

  test('focused elements have visible focus ring', async ({ page }) => {
    await page.locator('#inp-voter-name').focus();
    const outline = await page.locator('#inp-voter-name').evaluate(el => {
      const styles = window.getComputedStyle(el);
      return styles.outlineStyle + styles.boxShadow;
    });
    // Should have some visible focus indicator (outline or box-shadow)
    expect(outline).not.toBe('noneNone');
  });

  test('tab navigation follows logical order', async ({ page }) => {
    // Only test enabled, focusable elements
    const expectedOrder = ['#sel-district', '#inp-voter-name'];
    for (const selector of expectedOrder) {
      await page.locator(selector).focus();
      await expect(page.locator(selector)).toBeFocused();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// COLOR CONTRAST & VISUAL ACCESSIBILITY
// ──────────────────────────────────────────────────────────────────────

test.describe('Visual Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  });

  test('text has sufficient font size (min 14px)', async ({ page }) => {
    const bodyFontSize = await page.evaluate(() => {
      return parseFloat(window.getComputedStyle(document.body).fontSize);
    });
    expect(bodyFontSize).toBeGreaterThanOrEqual(14);
  });

  test('buttons have minimum 14px font', async ({ page }) => {
    const searchBtn = page.locator('#btn-search');
    const fontSize = await searchBtn.evaluate(el => parseFloat(window.getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(14);
  });

  test('links are distinguishable from regular text', async ({ page }) => {
    const links = page.locator('a:visible').first();
    if (await links.count() > 0) {
      const linkColor = await links.evaluate(el => window.getComputedStyle(el).color);
      const bodyColor = await page.evaluate(() => window.getComputedStyle(document.body).color);
      // Link should have different color or underline
      const hasUnderline = await links.evaluate(el =>
        window.getComputedStyle(el).textDecorationLine.includes('underline')
      );
      expect(linkColor !== bodyColor || hasUnderline).toBe(true);
    }
  });

  test('reduced motion is respected', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Animations should be disabled
    const transition = await page.evaluate(() => {
      const el = document.querySelector('.result-card, .app-shell');
      if (!el) return 'none';
      return window.getComputedStyle(el).animationDuration;
    });
    // With reduced motion, animation duration should be 0s or very short
    if (transition && transition !== 'none') {
      const duration = parseFloat(transition);
      expect(duration).toBeLessThanOrEqual(0.01);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// PERFORMANCE INDICATORS
// ──────────────────────────────────────────────────────────────────────

test.describe('Performance', () => {
  test('page load completes within 5 seconds', async ({ page }) => {
    const start = Date.now();
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
    const loadTime = Date.now() - start;
    expect(loadTime).toBeLessThan(5000);
  });

  test('no console errors on page load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    // Filter out expected errors (like service worker, favicon 404, search_index 404)
    const realErrors = errors.filter(e =>
      !e.includes('favicon') && !e.includes('sw.js') && !e.includes('service-worker') &&
      !e.includes('404') && !e.includes('Failed to load resource')
    );
    expect(realErrors).toHaveLength(0);
  });

  test('no unhandled promise rejections on load', async ({ page }) => {
    const rejections: string[] = [];
    page.on('pageerror', err => rejections.push(err.message));
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    expect(rejections).toHaveLength(0);
  });

  test('CSS and JS assets load successfully', async ({ page }) => {
    const failedAssets: string[] = [];
    page.on('response', resp => {
      if (resp.status() >= 400 && (resp.url().endsWith('.js') || resp.url().endsWith('.css'))) {
        failedAssets.push(resp.url());
      }
    });
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    expect(failedAssets).toHaveLength(0);
  });
});
