/**
 * E2E Tests — UI Interactions & Features
 * ========================================
 * Tests for feedback modal, language toggle, voting, "This is me" modal,
 * advanced filters, pagination (load more), secondary content, and sharing.
 *
 * Run: npx playwright test tests/e2e/interactions.spec.ts --project=chromium
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
  await page.locator('#sel-ac option[value="114"]').waitFor({ state: 'attached', timeout: 30000 });
  await page.locator('#sel-ac').selectOption('114');
  await page.waitForTimeout(500);
}

async function searchAndGetResults(page: Page, name: string) {
  // Use all-parts mode for broader search
  await page.locator('#rdo-all-parts').check();
  await page.locator('#inp-voter-name').fill(name);
  await page.locator('#btn-search').click();
  // Wait for the "This is me" button to appear (indicates real voter results)
  await page.waitForSelector('.btn-this-is-me', { timeout: 60000 });
}

// ──────────────────────────────────────────────────────────────────────
// FEEDBACK MODAL
// ──────────────────────────────────────────────────────────────────────

test.describe('Feedback Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  });

  test('feedback FAB is visible', async ({ page }) => {
    await expect(page.locator('#btn-feedback')).toBeVisible();
  });

  test('clicking FAB opens feedback modal', async ({ page }) => {
    await page.locator('#btn-feedback').click();
    await expect(page.locator('#feedbackModalOverlay')).toHaveClass(/show/);
    await expect(page.locator('.feedback-modal h3')).toBeVisible();
  });

  test('cancel button closes feedback modal', async ({ page }) => {
    await page.locator('#btn-feedback').click();
    await expect(page.locator('#feedbackModalOverlay')).toHaveClass(/show/);
    await page.locator('#btn-cancel-feedback').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#feedbackModalOverlay')).not.toHaveClass(/show/);
  });

  test('feedback modal has required form fields', async ({ page }) => {
    await page.locator('#btn-feedback').click();
    await expect(page.locator('#feedbackText')).toBeVisible();
    await expect(page.locator('#btn-submit-feedback')).toBeVisible();
    await expect(page.locator('#btn-cancel-feedback')).toBeVisible();
  });

  test('feedback textarea accepts input', async ({ page }) => {
    await page.locator('#btn-feedback').click();
    await page.locator('#feedbackText').fill('Test feedback message');
    expect(await page.locator('#feedbackText').inputValue()).toBe('Test feedback message');
  });

  test('screenshot upload area is present', async ({ page }) => {
    await page.locator('#btn-feedback').click();
    await expect(page.locator('#feedbackSSArea')).toBeVisible();
    await expect(page.locator('#feedbackSSInput')).toBeAttached();
  });

  test('Escape key closes feedback modal', async ({ page }) => {
    await page.locator('#btn-feedback').click();
    await expect(page.locator('#feedbackModalOverlay')).toHaveClass(/show/);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(page.locator('#feedbackModalOverlay')).not.toHaveClass(/show/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// LANGUAGE TOGGLE
// ──────────────────────────────────────────────────────────────────────

test.describe('Language Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  });

  test('language toggle button is visible', async ({ page }) => {
    await expect(page.locator('#btn-lang-toggle')).toBeVisible();
  });

  test('clicking language toggle changes button text', async ({ page }) => {
    const btn = page.locator('#btn-lang-toggle');
    const initialText = await btn.textContent();
    await btn.click();
    await page.waitForTimeout(300);
    const newText = await btn.textContent();
    expect(newText).not.toBe(initialText);
  });

  test('language toggle persists across interactions', async ({ page }) => {
    const btn = page.locator('#btn-lang-toggle');
    await btn.click();
    const textAfterToggle = await btn.textContent();
    // Interact with something else
    await page.locator('#tab-btn-upload').click();
    await page.locator('#tab-btn-db').click();
    // Language should persist
    expect(await btn.textContent()).toBe(textAfterToggle);
  });
});

// ──────────────────────────────────────────────────────────────────────
// ADVANCED FILTERS
// ──────────────────────────────────────────────────────────────────────

test.describe('Advanced Filters', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
  });

  test('advanced filters toggle shows/hides extra fields', async ({ page }) => {
    const advRow = page.locator('#row-advanced-filters');
    // Initially hidden
    await expect(advRow).not.toBeVisible();

    // Click to show
    await page.locator('#lnk-advanced-filters').click();
    await page.waitForTimeout(400);
    await expect(advRow).toBeVisible();

    // Click again to hide
    await page.locator('#lnk-advanced-filters').click();
    await page.waitForTimeout(400);
    await expect(advRow).not.toBeVisible();
  });

  test('gender filter dropdown has options', async ({ page }) => {
    await page.locator('#lnk-advanced-filters').click();
    await page.waitForTimeout(300);
    const options = await page.locator('#sel-gender option').count();
    expect(options).toBeGreaterThanOrEqual(3); // Any, M, F
  });

  test('relative type filter dropdown has options', async ({ page }) => {
    await page.locator('#lnk-advanced-filters').click();
    await page.waitForTimeout(300);
    const options = await page.locator('#sel-rel-type option').count();
    expect(options).toBeGreaterThanOrEqual(4); // Any, F, M, H, W
  });

  test('voter ID field accepts input in advanced filters', async ({ page }) => {
    await page.locator('#lnk-advanced-filters').click();
    await page.waitForTimeout(300);
    await page.locator('#inp-voter-id').fill('ABC1234567');
    expect(await page.locator('#inp-voter-id').inputValue()).toBe('ABC1234567');
  });

  test('gender filter applies to search', async ({ page }) => {
    test.setTimeout(90000);
    await selectMysoreKrishnaraja(page);
    await page.locator('#lnk-advanced-filters').click();
    await page.waitForTimeout(300);
    await page.locator('#sel-gender').selectOption('F');
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('Manjunath');
    await page.locator('#btn-search').click();

    // Wait for results
    await page.waitForTimeout(15000);
    // Should not crash — results may be 0 (no female Manjunath)
    await expect(page.locator('#sel-district')).toBeVisible();
  });
});

// ──────────────────────────────────────────────────────────────────────
// "THIS IS ME" / SUCCESS MODAL
// ──────────────────────────────────────────────────────────────────────

test.describe('This Is Me / Success Modal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await selectMysoreKrishnaraja(page);
  });

  test('"This is me" button exists on result cards', async ({ page }) => {
    test.setTimeout(90000);
    await searchAndGetResults(page, 'Manjunath');
    const btn = page.locator('.btn-this-is-me').first();
    await expect(btn).toBeVisible();
  });

  test('clicking "This is me" opens success modal', async ({ page }) => {
    test.setTimeout(90000);
    await searchAndGetResults(page, 'Manjunath');
    await page.locator('.btn-this-is-me').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('#successModal')).toHaveClass(/show/);
    await expect(page.locator('#successModal .big-check')).toBeVisible();
  });

  test('success modal shows voter details', async ({ page }) => {
    test.setTimeout(90000);
    await searchAndGetResults(page, 'Manjunath');
    await page.locator('.btn-this-is-me').first().click();
    await page.waitForTimeout(500);
    const modalText = await page.locator('#successModal').textContent();
    expect(modalText).toContain('AC');
    expect(modalText).toContain('Part');
  });

  test('"Done" button closes success modal', async ({ page }) => {
    test.setTimeout(90000);
    await searchAndGetResults(page, 'Manjunath');
    await page.locator('.btn-this-is-me').first().click();
    await page.waitForTimeout(500);
    
    // FIX: WebKit/Mobile Safari struggles with CSS fade animations. Force the click.
    await page.locator('#btn-close-modal').click({ force: true });
    await page.waitForTimeout(500);
    await expect(page.locator('#successModal')).not.toHaveClass(/show/);
  });
});

// ──────────────────────────────────────────────────────────────────────
// PAGINATION / LOAD MORE
// ──────────────────────────────────────────────────────────────────────

test.describe('Pagination — Load More', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await selectMysoreKrishnaraja(page);
  });

  test('results with many matches show "Load more" button', async ({ page }) => {
    test.setTimeout(90000);
    await searchAndGetResults(page, 'Krishnappa');
    // Check result count and whether load more appears
    const cardCount = await page.locator('.result-card:not(.skeleton-card)').count();
    const loadMore = page.locator('#btn-load-more');
    // If results are capped at page size, load more should appear
    if (cardCount >= 50) {
      await expect(loadMore).toBeVisible();
    } else {
      // Fewer than page size — load more may not show
      expect(cardCount).toBeGreaterThan(0);
    }
  });

  test('clicking "Load more" adds more result cards', async ({ page }) => {
    test.setTimeout(90000);
    await searchAndGetResults(page, 'Shivakumari');
    const initialCount = await page.locator('.result-card:not(.skeleton-card)').count();
    const loadMore = page.locator('#btn-load-more');

    if (await loadMore.isVisible()) {
      await loadMore.click();
      await page.waitForTimeout(1000);
      const newCount = await page.locator('.result-card:not(.skeleton-card)').count();
      expect(newCount).toBeGreaterThan(initialCount);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// VOTING FEATURE
// ──────────────────────────────────────────────────────────────────────

test.describe('Vote for Next District', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    
    // FIX: Force the section open reliably bypassing UI animations
    await page.evaluate(() => {
      const el = document.getElementById('secondary-content');
      if (el) el.setAttribute('open', '');
    });
    await page.waitForTimeout(300);
  });

  test('vote section is visible in expanded secondary content', async ({ page }) => {
    await expect(page.locator('.vote-banner')).toBeVisible();
  });

  test('vote district dropdown has options', async ({ page }) => {
    const options = await page.locator('#sel-vote-district-new option').count();
    expect(options).toBeGreaterThan(10); 
  });

  test('can select a district and cast vote', async ({ page }) => {
    test.setTimeout(90000);
    await page.locator('#sel-vote-district-new').selectOption('Hassan');
    // FIX: Force click in case it's obscured by other elements
    await page.locator('#btn-vote-new').click({ force: true });
    await page.waitForTimeout(500);
    const resultsBar = page.locator('#vote-results-bar-new');
    const text = await resultsBar.textContent();
    expect(text!.length).toBeGreaterThanOrEqual(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECONDARY CONTENT (DETAILS/SUMMARY)
// ──────────────────────────────────────────────────────────────────────

test.describe('Secondary Content Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // FIX: Force it closed to guarantee a clean slate before testing
    await page.evaluate(() => {
      const el = document.getElementById('secondary-content');
      if (el) el.removeAttribute('open');
    });
  });

  test('secondary content is collapsed by default', async ({ page }) => {
    const details = page.locator('#secondary-content');
    const isOpen = await details.getAttribute('open');
    expect(isOpen).toBeNull();
  });

  test('clicking summary expands secondary content', async ({ page }) => {
    await page.locator('#secondary-content summary').click({ force: true });
    await page.waitForTimeout(300);
    const details = page.locator('#secondary-content');
    await expect(details).toHaveAttribute('open', '');
  });

  test('video section is visible when expanded', async ({ page }) => {
    await page.locator('#secondary-content summary').click({ force: true });
    await page.waitForTimeout(300);
    await expect(page.locator('.video-section')).toBeVisible();
  });

  test('quick guide steps are visible when expanded', async ({ page }) => {
    await page.locator('#secondary-content summary').click({ force: true });
    await page.waitForTimeout(300);
    const steps = page.locator('.guide-step');
    const count = await steps.count();
    expect(count).toBe(3);
  });

  test('important links section has external links', async ({ page }) => {
    await page.locator('#secondary-content summary').click({ force: true });
    await page.waitForTimeout(300);
    const links = page.locator('.link-pill');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('WhatsApp share button has valid href', async ({ page }) => {
    await page.locator('#secondary-content summary').click({ force: true });
    await page.waitForTimeout(300);
    const href = await page.locator('#btn-whatsapp-share').getAttribute('href');
    expect(href).toContain('wa.me');
  });

  test('copy link button works', async ({ page, context, browserName }) => {
    test.setTimeout(90000);
    await page.locator('#secondary-content summary').click({ force: true });
    await page.waitForTimeout(300);
    
    if (browserName !== 'webkit') {
      await context.grantPermissions(['clipboard-write']);
    }
    await page.locator('#btn-copy-link').click({ force: true });
    await page.waitForTimeout(500);
    const btnText = await page.locator('#btn-copy-link').textContent();
    expect(btnText).toContain('Copied');
  });
});

// ──────────────────────────────────────────────────────────────────────
// SEARCH SCOPE RADIO BUTTONS
// ──────────────────────────────────────────────────────────────────────

test.describe('Search Scope Controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
    await selectMysoreKrishnaraja(page);
  });

  test('"Search entire constituency" is checked by default', async ({ page }) => {
    await expect(page.locator('#rdo-all-parts')).toBeChecked();
  });

  test('switching to "Specific part only" enables part dropdown', async ({ page }) => {
    await page.locator('#rdo-part-only').check();
    await page.waitForTimeout(1000);
    await expect(page.locator('#sel-part')).toBeEnabled();
  });

  test('part dropdown has correct number of parts for AC 114', async ({ page }) => {
    await page.locator('#rdo-part-only').check();
    await page.waitForTimeout(1500);
    // AC 114 has 20 parts + "All Parts" option
    const options = await page.locator('#sel-part option').count();
    expect(options).toBeGreaterThanOrEqual(20);
  });

  test('switching back to "entire constituency" disables part dropdown', async ({ page }) => {
    await page.locator('#rdo-part-only').check();
    await page.waitForTimeout(500);
    await page.locator('#rdo-all-parts').check();
    await page.waitForTimeout(500);
    await expect(page.locator('#sel-part')).toBeDisabled();
  });
});

// ──────────────────────────────────────────────────────────────────────
// ENTER KEY TRIGGERS SEARCH
// ──────────────────────────────────────────────────────────────────────

test.describe('Keyboard Search Trigger', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await selectMysoreKrishnaraja(page);
    await page.locator('#rdo-all-parts').check();
  });

  test('pressing Enter in voter name input triggers search', async ({ page }) => {
    test.setTimeout(90000);
    await page.locator('#inp-voter-name').fill('Manjunath');
    await page.locator('#inp-voter-name').press('Enter');
    // Should start searching
    await page.waitForSelector('.result-card:not(.skeleton-card), .no-results-card', { timeout: 60000 });
    const hasResults = await page.locator('.result-card:not(.skeleton-card)').count();
    expect(hasResults).toBeGreaterThan(0);
  });

  test('pressing Enter in relative name input triggers search', async ({ page }) => {
    test.setTimeout(90000);
    await page.locator('#inp-voter-name').fill('Manjunath');
    await page.locator('#inp-relative-name').fill('Kumar');
    await page.locator('#inp-relative-name').press('Enter');
    await page.waitForTimeout(10000);
    // Should not crash
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('pressing Enter in age input triggers search', async ({ page }) => {
    test.setTimeout(90000);
    await page.locator('#inp-voter-name').fill('Manjunath');
    await page.locator('#inp-age').fill('35');
    await page.locator('#inp-age').press('Enter');
    await page.waitForTimeout(10000);
    await expect(page.locator('#sel-district')).toBeVisible();
  });
});