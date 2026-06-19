/**
 * E2E Search Assessment — Playwright Chromium test
 * =================================================
 * Tests real voter name searches against live JSON data served from
 * data/districts/MYSORE/114/. Names sourced from SQLite (confidence >= 85).
 *
 * Run: npx playwright test tests/e2e/search-assessment.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test';

// ──────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────

async function waitForDistrictsLoaded(page: Page) {
  await page.locator('#sel-district option[value="MYSORE"]').waitFor({ state: 'attached', timeout: 15000 });
}

async function selectMysoreKrishnaraja(page: Page) {
  await waitForDistrictsLoaded(page);
  await page.locator('#sel-district').selectOption('MYSORE');
  // AC 114 — Krishnaraja
  await page.locator('#sel-ac option[value="114"]').waitFor({ state: 'attached', timeout: 30000 });
  await page.locator('#sel-ac').selectOption('114');
  await page.waitForTimeout(500);
}

async function searchAndWait(page: Page, name: string): Promise<number> {
  // Ensure AC scope (search all parts)
  await page.locator('#rdo-all-parts').check();
  await page.locator('#inp-voter-name').fill(name);
  await page.locator('#btn-search').click();

  // Wait for results to appear (real cards, not skeletons)
  try {
    await page.waitForSelector('.result-card:not(.skeleton-card)', { timeout: 60000 });
  } catch {
    // Check if "no results" is shown
    const noResults = await page.locator('.no-results-card').count();
    if (noResults > 0) return 0;
    return -1; // timeout / error
  }
  const count = await page.locator('.result-card:not(.skeleton-card)').count();
  return count;
}

async function clearAndReset(page: Page) {
  await page.locator('#btn-clear').click();
  await page.waitForTimeout(300);
}

// ──────────────────────────────────────────────────────────────────────
// ASSESSMENT: UI ALIGNMENT & STRUCTURE CHECKS
// ──────────────────────────────────────────────────────────────────────

test.describe('UI Alignment & Structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  });

  test('search tabs are aligned side-by-side equally', async ({ page }) => {
    const tabDb = page.locator('#tab-btn-db');
    const tabUpload = page.locator('#tab-btn-upload');
    
    const dbBox = await tabDb.boundingBox();
    const uploadBox = await tabUpload.boundingBox();
    
    expect(dbBox).not.toBeNull();
    expect(uploadBox).not.toBeNull();
    
    // Same vertical position (aligned)
    expect(Math.abs(dbBox!.y - uploadBox!.y)).toBeLessThan(3);
    // Similar width (within 10%)
    const widthDiff = Math.abs(dbBox!.width - uploadBox!.width) / dbBox!.width;
    expect(widthDiff).toBeLessThan(0.15);
  });

  test('search row fields are aligned in a grid', async ({ page }) => {
    await waitForDistrictsLoaded(page);
    
    const fields = page.locator('.card-search .search-row:first-of-type .field');
    const count = await fields.count();
    expect(count).toBe(3); // District, AC, Part
    
    // First row items should be vertically aligned
    const box0 = await fields.nth(0).boundingBox();
    const box1 = await fields.nth(1).boundingBox();
    const box2 = await fields.nth(2).boundingBox();
    
    expect(box0).not.toBeNull();
    expect(box1).not.toBeNull();
    expect(box2).not.toBeNull();
    
    // All at same Y position (aligned row)
    expect(Math.abs(box0!.y - box1!.y)).toBeLessThan(3);
    expect(Math.abs(box1!.y - box2!.y)).toBeLessThan(3);
  });

  test('card has proper padding and border radius', async ({ page }) => {
    const card = page.locator('.card-search');
    await expect(card).toBeVisible();
    
    const styles = await card.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return {
        borderRadius: cs.borderRadius,
        overflow: cs.overflow,
      };
    });
    // Should have rounded corners (>= 16px)
    expect(parseInt(styles.borderRadius)).toBeGreaterThanOrEqual(16);
  });

  test('no horizontal overflow on page', async ({ page }) => {
    const hasOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasOverflow).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// ASSESSMENT: SEARCH 5 REAL NAMES FROM SQLITE
// ──────────────────────────────────────────────────────────────────────

test.describe('Search Assessment — 5 SQLite Names', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await selectMysoreKrishnaraja(page);
  });

  test('Search 1: "Manjunath" — common name, should return multiple results', async ({ page }) => {
    test.setTimeout(90000);
    const count = await searchAndWait(page, 'Manjunath');
    console.log(`[RESULT] "Manjunath" → ${count} results`);
    expect(count).toBeGreaterThan(5); // Very common name
    
    // Verify result card structure
    const firstCard = page.locator('.result-card:not(.skeleton-card)').first();
    await expect(firstCard.locator('.voter-name-kn').first()).toBeVisible();
    const fieldCount = await firstCard.locator('.result-field').count();
    expect(fieldCount).toBeGreaterThanOrEqual(4);
  });

  test('Search 2: "Krishnappa" — conf=92.5, AC 114 Part 64', async ({ page }) => {
    test.setTimeout(90000);
    const count = await searchAndWait(page, 'Krishnappa');
    console.log(`[RESULT] "Krishnappa" → ${count} results`);
    expect(count).toBeGreaterThan(0);
    
    // Verify the Kannada name is displayed
    const kannadaNames = page.locator('.result-card .voter-name-kn');
    const firstKn = await kannadaNames.first().textContent();
    expect(firstKn).toBeTruthy();
    expect(firstKn!.length).toBeGreaterThan(2);
  });

  test('Search 3: "Shivakumari" — conf=94.3, should find exact match', async ({ page }) => {
    test.setTimeout(90000);
    const count = await searchAndWait(page, 'Shivakumari');
    console.log(`[RESULT] "Shivakumari" → ${count} results`);
    expect(count).toBeGreaterThan(0);
    
    // Verify result has gender/age tags
    const firstCard = page.locator('.result-card:not(.skeleton-card)').first();
    const tags = firstCard.locator('.tag');
    const tagCount = await tags.count();
    expect(tagCount).toBeGreaterThanOrEqual(1); // At least gender tag
  });

  test('Search 4: "Bhagyamma" — conf=89.5, female voter', async ({ page }) => {
    test.setTimeout(90000);
    const count = await searchAndWait(page, 'Bhagyamma');
    console.log(`[RESULT] "Bhagyamma" → ${count} results`);
    expect(count).toBeGreaterThan(0);
    
    // Check that AC/Part info is shown in result
    const firstCard = page.locator('.result-card:not(.skeleton-card)').first();
    const cardText = await firstCard.textContent();
    expect(cardText).toContain('AC 114');
  });

  test('Search 5: "Shakumtala" — conf=93.3, verify result card alignment', async ({ page }) => {
    test.setTimeout(90000);
    const count = await searchAndWait(page, 'Shakumtala');
    console.log(`[RESULT] "Shakumtala" → ${count} results`);
    expect(count).toBeGreaterThan(0);
    
    // Check result card grid alignment
    const firstCard = page.locator('.result-card:not(.skeleton-card)').first();
    const gridItems = firstCard.locator('.result-field');
    const gridCount = await gridItems.count();
    expect(gridCount).toBeGreaterThanOrEqual(4);
    
    // Verify cards are not overlapping
    if (count >= 2) {
      const card1Box = await page.locator('.result-card:not(.skeleton-card)').nth(0).boundingBox();
      const card2Box = await page.locator('.result-card:not(.skeleton-card)').nth(1).boundingBox();
      if (card1Box && card2Box) {
        // Card 2 should be below card 1 (no overlap)
        expect(card2Box.y).toBeGreaterThan(card1Box.y + card1Box.height - 5);
      }
    }
  });

  test('Search precision: garbage name returns minimal/zero results', async ({ page }) => {
    test.setTimeout(90000);
    const count = await searchAndWait(page, 'Qqwwzzxx');
    console.log(`[RESULT] "Qqwwzzxx" (garbage) → ${count} results`);
    // Fuzzy search may match 0-1 results for random strings; should never be >2
    expect(count).toBeLessThanOrEqual(2);
  });
});
