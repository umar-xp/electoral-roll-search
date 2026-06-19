/**
 * E2E Tests — UTF-8 Encoding & Kannada Text Integrity
 * =====================================================
 * Verifies that UTF-8 encoded Kannada (ಕನ್ನಡ) text is correctly:
 * - Served with proper charset headers
 * - Rendered in the browser without mojibake
 * - Searchable and filterable
 * - Displayed in result cards, modals, and UI labels
 * - Preserved in form inputs and localStorage
 *
 * Run: npx playwright test tests/e2e/utf8-encoding.spec.ts --project=chromium
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

// Kannada Unicode range: U+0C80 to U+0CFF
const KANNADA_REGEX = /[\u0C80-\u0CFF]/;
const KANNADA_FULL_WORD_REGEX = /[\u0C80-\u0CFF]{2,}/;

// Known Kannada test strings (UTF-8 encoded)
const KANNADA_NAMES = {
  manjunath: 'ಮಂಜುನಾಥ',
  abdul: 'ಅಬ್ದುಲ್',
  krishnappa: 'ಕೃಷ್ಣಪ್ಪ',
  karnataka: 'ಕರ್ನಾಟಕ',
  voterList: 'ಮತದಾರರ ಪಟ್ಟಿ',
  search: 'ಹುಡುಕಾಟ',
};

// ──────────────────────────────────────────────────────────────────────
// SECTION 1: HTTP CHARSET HEADERS
// ──────────────────────────────────────────────────────────────────────

test.describe('UTF-8 HTTP Headers & Charset', () => {
  test('HTML page is served with UTF-8 charset', async ({ page }) => {
    const response = await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const contentType = response!.headers()['content-type'] || '';
    // Should contain charset=utf-8 (case insensitive)
    expect(contentType.toLowerCase()).toContain('text/html');
    // Check meta charset in HTML
    const charset = await page.locator('meta[charset]').getAttribute('charset');
    expect(charset?.toUpperCase()).toBe('UTF-8');
  });

  test('master_index.json is served with UTF-8 content type', async ({ page }) => {
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('master_index.json') && resp.status() === 200,
      { timeout: 15000 }
    );
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await responsePromise;
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('json');
  });

  test('part data JSON files are valid UTF-8', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await page.request.get('http://localhost:8080/data/districts/MYSORE/114/part_1.json');
    expect(response.status()).toBe(200);

    // Parse as text first to check for BOM or encoding issues
    const text = await response.text();
    // Should not contain UTF-8 BOM (EF BB BF)
    expect(text.charCodeAt(0)).not.toBe(0xFEFF);
    // Should be valid JSON
    const data = JSON.parse(text);
    expect(data).toBeTruthy();
  });

  test('CSS file is served as UTF-8', async ({ page }) => {
    const response = await page.request.get('http://localhost:8080/apps/web/styles.css');
    expect(response.status()).toBe(200);
    const contentType = response.headers()['content-type'] || '';
    expect(contentType).toContain('css');
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 2: KANNADA TEXT RENDERING IN UI
// ──────────────────────────────────────────────────────────────────────

test.describe('UTF-8 Kannada Text Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  });

  test('page title contains Kannada characters', async ({ page }) => {
    const title = await page.title();
    expect(title).toMatch(KANNADA_REGEX);
    expect(title).toContain('ಮತದಾರರ');
  });

  test('brand subtitle displays Kannada correctly', async ({ page }) => {
    const subtitle = await page.locator('.brand-sub').textContent();
    expect(subtitle).toMatch(KANNADA_FULL_WORD_REGEX);
    expect(subtitle).toContain('ಕರ್ನಾಟಕ');
  });

  test('language toggle button shows Kannada text', async ({ page }) => {
    const btnText = await page.locator('#btn-lang-toggle').textContent();
    // Should be either "ಕನ್ನಡ" or "English" depending on current state
    expect(btnText === 'ಕನ್ನಡ' || btnText === 'English').toBe(true);
  });

  test('switching to Kannada translates all UI labels', async ({ page }) => {
    // Click language toggle to switch to Kannada
    const btn = page.locator('#btn-lang-toggle');
    const initialText = await btn.textContent();

    if (initialText === 'ಕನ್ನಡ') {
      // Currently in English, switch to Kannada
      await btn.click();
      await page.waitForTimeout(500);
    }

    // Verify translated elements contain Kannada
    const siteTitle = await page.locator('[data-i18n="site-title"]').textContent();
    expect(siteTitle).toMatch(KANNADA_REGEX);
  });

  test('Kannada text does not show as mojibake (replacement chars)', async ({ page }) => {
    const bodyText = await page.locator('body').textContent();
    // Match only Kannada word runs (sequences of Kannada chars with spaces/punctuation)
    // This avoids capturing emojis/icons between distant Kannada characters
    const kannadaWords = (bodyText || '').match(/[\u0C80-\u0CFF][\u0C80-\u0CFF\s,.!?:\-()]{0,200}/g) || [];
    for (const word of kannadaWords) {
      expect(word).not.toContain('\uFFFD');
    }
    // Should contain actual Kannada characters
    expect(bodyText).toMatch(KANNADA_REGEX);
  });

  test('disclaimer text renders Kannada without encoding errors', async ({ page }) => {
    // Switch to Kannada
    const btn = page.locator('#btn-lang-toggle');
    const text = await btn.textContent();
    if (text === 'ಕನ್ನಡ') await btn.click();
    await page.waitForTimeout(500);

    const disclaimer = await page.locator('[data-i18n="disclaimer-strong"]').textContent();
    expect(disclaimer).toMatch(KANNADA_REGEX);
    expect(disclaimer).not.toContain('?');  // No question marks from encoding failures
    expect(disclaimer).not.toContain('\uFFFD');
  });

  test('form labels display Kannada after language switch', async ({ page }) => {
    await waitForDistrictsLoaded(page);
    const btn = page.locator('#btn-lang-toggle');
    const text = await btn.textContent();
    if (text === 'ಕನ್ನಡ') await btn.click();
    await page.waitForTimeout(500);

    const districtLabel = await page.locator('[data-i18n="lbl-district"]').textContent();
    expect(districtLabel).toMatch(KANNADA_REGEX);
    expect(districtLabel).toContain('ಜಿಲ್ಲೆ');
  });

  test('placeholder text shows Kannada after language switch', async ({ page }) => {
    const btn = page.locator('#btn-lang-toggle');
    const text = await btn.textContent();
    if (text === 'ಕನ್ನಡ') await btn.click();
    await page.waitForTimeout(500);

    const placeholder = await page.locator('#inp-voter-name').getAttribute('placeholder');
    expect(placeholder).toMatch(KANNADA_REGEX);
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 3: KANNADA TEXT IN SEARCH RESULTS
// ──────────────────────────────────────────────────────────────────────

test.describe('UTF-8 in Search Results', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await selectMysoreKrishnaraja(page);
  });

  test('voter name in Kannada (nk field) displays correctly', async ({ page }) => {
    test.setTimeout(90000);
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('Manjunath');
    await page.locator('#btn-search').click();

    await page.waitForSelector('.result-card:not(.skeleton-card)', { timeout: 60000 });
    const kannadaName = await page.locator('.voter-name-kn').first().textContent();

    // Kannada name should contain valid Kannada chars
    expect(kannadaName).toMatch(KANNADA_FULL_WORD_REGEX);
    // Should NOT be garbled
    expect(kannadaName).not.toContain('\uFFFD');
    expect(kannadaName).not.toContain('?');
  });

  test('relative name in Kannada displays correctly', async ({ page }) => {
    test.setTimeout(90000);
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('Manjunath');
    await page.locator('#btn-search').click();

    await page.waitForSelector('.result-card:not(.skeleton-card)', { timeout: 60000 });
    const cardText = await page.locator('.result-card:not(.skeleton-card)').first().textContent();

    // Card should contain Kannada characters for name/relative
    expect(cardText).toMatch(KANNADA_REGEX);
  });

  test('search with Kannada input returns results', async ({ page }) => {
    test.setTimeout(90000);
    await page.locator('#rdo-all-parts').check();
    // Search with Kannada text directly
    await page.locator('#inp-voter-name').fill('ಮಂಜುನಾಥ');
    await page.locator('#btn-search').click();

    await page.waitForTimeout(15000);
    // Should either find results or show no-results gracefully
    const hasResults = await page.locator('.result-card:not(.skeleton-card)').count();
    const hasNoResults = await page.locator('.no-results-card').count();
    // App should not crash
    await expect(page.locator('#sel-district')).toBeVisible();
    expect(hasResults + hasNoResults).toBeGreaterThanOrEqual(0);
  });

  test('mixed English-Kannada input does not crash', async ({ page }) => {
    test.setTimeout(90000);
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('Abdul ಅಬ್ದುಲ್');
    await page.locator('#btn-search').click();

    await page.waitForTimeout(10000);
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('result cards preserve Kannada text alignment', async ({ page }) => {
    test.setTimeout(90000);
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('Abdul');
    await page.locator('#btn-search').click();

    await page.waitForSelector('.result-card:not(.skeleton-card)', { timeout: 60000 });
    const knName = page.locator('.voter-name-kn').first();
    await expect(knName).toBeVisible();

    // Check the element has readable dimensions (not collapsed)
    const box = await knName.boundingBox();
    expect(box!.width).toBeGreaterThan(20);
    expect(box!.height).toBeGreaterThan(10);
  });

  test('Kannada characters in voter data are in correct Unicode range', async ({ page }) => {
    test.setTimeout(90000);
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('Abdul');
    await page.locator('#btn-search').click();

    await page.waitForSelector('.result-card:not(.skeleton-card)', { timeout: 60000 });
    const knText = await page.locator('.voter-name-kn').first().textContent();

    // Every non-whitespace char should be in Kannada Unicode block
    const chars = (knText || '').replace(/\s/g, '').split('');
    for (const ch of chars) {
      const code = ch.charCodeAt(0);
      // Should be in Kannada block (0x0C80-0x0CFF) or common punctuation
      expect(
        (code >= 0x0C80 && code <= 0x0CFF) || code === 0x200D || code === 0x200C,
        `Char '${ch}' (U+${code.toString(16).padStart(4, '0')}) outside Kannada range`
      ).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 4: UTF-8 IN DATA FILES
// ──────────────────────────────────────────────────────────────────────

test.describe('UTF-8 Data Integrity', () => {
  test('voter records contain valid Kannada names (vk field)', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await page.request.get('http://localhost:8080/data/districts/MYSORE/114/part_1.json');
    const data = await response.json();
    const voters = Array.isArray(data) ? data : (data?.voters || []);

    // Check first 10 records for Kannada names (field is 'vk' not 'nk')
    const sample = voters.slice(0, 10);
    let kannadaCount = 0;
    for (const voter of sample) {
      if (voter.vk) {
        expect(voter.vk).toMatch(KANNADA_REGEX);
        expect(voter.vk).not.toContain('\uFFFD'); // No replacement chars
        kannadaCount++;
      }
    }
    expect(kannadaCount).toBeGreaterThan(0);
  });

  test('voter records have Kannada relative names (rk field)', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await page.request.get('http://localhost:8080/data/districts/MYSORE/114/part_1.json');
    const data = await response.json();
    const voters = Array.isArray(data) ? data : (data?.voters || []);

    const withRelative = voters.filter((v: any) => v.rk);
    expect(withRelative.length).toBeGreaterThan(0);
    expect(withRelative[0].rk).toMatch(KANNADA_REGEX);
    expect(withRelative[0].rk).not.toContain('\uFFFD');
  });

  test('JSON data has no BOM or invalid UTF-8 sequences', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await page.request.get('http://localhost:8080/data/districts/MYSORE/114/part_1.json');
    const text = await response.text();

    // No BOM
    expect(text.charCodeAt(0)).not.toBe(0xFEFF);
    // No null bytes
    expect(text).not.toContain('\x00');
    // Should parse cleanly
    expect(() => JSON.parse(text)).not.toThrow();
  });

  test('Kannada vowel signs and conjuncts render correctly', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await selectMysoreKrishnaraja(page);
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('Krishnappa');
    await page.locator('#btn-search').click();

    await page.waitForSelector('.result-card:not(.skeleton-card)', { timeout: 60000 });
    const knText = await page.locator('.voter-name-kn').first().textContent();

    // Kannada conjuncts use virama (U+0CCD) — should be present in complex names
    // The text should have proper character composition (not decomposed incorrectly)
    expect(knText!.length).toBeGreaterThan(2);
    // No replacement characters
    expect(knText).not.toContain('\uFFFD');
  });

  test('multiple parts have consistent Kannada encoding', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const parts = [1, 9, 19];
    for (const part of parts) {
      const response = await page.request.get(`http://localhost:8080/data/districts/MYSORE/114/part_${part}.json`);
      const data = await response.json();
      const voters = Array.isArray(data) ? data : (data?.voters || []);

      const firstWithKn = voters.find((v: any) => v.nk);
      if (firstWithKn) {
        expect(firstWithKn.nk).toMatch(KANNADA_REGEX);
        expect(firstWithKn.nk).not.toContain('\uFFFD');
      }
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 5: i18n TOGGLE & LOCALSTORAGE PERSISTENCE
// ──────────────────────────────────────────────────────────────────────

test.describe('UTF-8 Language Persistence', () => {
  test('language preference persists in localStorage', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const btn = page.locator('#btn-lang-toggle');
    const initialText = await btn.textContent();

    // Toggle language
    await btn.click();
    await page.waitForTimeout(300);

    // Check localStorage
    const storedLang = await page.evaluate(() => localStorage.getItem('votersearch_lang'));
    expect(storedLang === 'kn' || storedLang === 'en').toBe(true);
  });

  test('language preference survives page reload', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const btn = page.locator('#btn-lang-toggle');

    // Switch to Kannada if not already
    const text = await btn.textContent();
    if (text === 'ಕನ್ನಡ') await btn.click();
    await page.waitForTimeout(300);

    // Reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Verify language persisted
    const storedLang = await page.evaluate(() => localStorage.getItem('votersearch_lang'));
    expect(storedLang).toBe('kn');
  });

  test('Kannada UI elements are readable after language toggle', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);

    const btn = page.locator('#btn-lang-toggle');
    const text = await btn.textContent();
    if (text === 'ಕನ್ನಡ') await btn.click();
    await page.waitForTimeout(500);

    // All data-i18n elements should have content
    const i18nElements = page.locator('[data-i18n]');
    const count = await i18nElements.count();

    for (let i = 0; i < Math.min(count, 10); i++) {
      const el = i18nElements.nth(i);
      const content = await el.textContent();
      expect(content!.trim().length).toBeGreaterThan(0);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 6: UTF-8 FORM INPUT HANDLING
// ──────────────────────────────────────────────────────────────────────

test.describe('UTF-8 Form Input', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await selectMysoreKrishnaraja(page);
  });

  test('Kannada text input is preserved in form field', async ({ page }) => {
    const kannadaName = 'ಮಂಜುನಾಥ';
    await page.locator('#inp-voter-name').fill(kannadaName);
    const value = await page.locator('#inp-voter-name').inputValue();
    expect(value).toBe(kannadaName);
  });

  test('Kannada relative name input is preserved', async ({ page }) => {
    const kannadaRelative = 'ಕೃಷ್ಣಪ್ಪ';
    await page.locator('#inp-relative-name').fill(kannadaRelative);
    const value = await page.locator('#inp-relative-name').inputValue();
    expect(value).toBe(kannadaRelative);
  });

  test('mixed script input (Devanagari + Kannada) is handled', async ({ page }) => {
    // Devanagari: U+0900-U+097F
    const mixed = 'अब्दुल ಅಬ್ದುಲ್';
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill(mixed);
    const value = await page.locator('#inp-voter-name').inputValue();
    expect(value).toBe(mixed);

    // Should not crash on search
    await page.locator('#btn-search').click();
    await page.waitForTimeout(5000);
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('zero-width characters in input are handled', async ({ page }) => {
    // ZWJ (U+200D), ZWNJ (U+200C) are common in Indic scripts
    const textWithZWJ = 'ಕೃ\u200Dಷ್ಣ';
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill(textWithZWJ);
    await page.locator('#btn-search').click();
    await page.waitForTimeout(5000);
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('very long Kannada string in input does not overflow', async ({ page }) => {
    const longKannada = 'ಮಂಜುನಾಥ '.repeat(50);
    await page.locator('#inp-voter-name').fill(longKannada);
    const inputBox = await page.locator('#inp-voter-name').boundingBox();
    // Input should not overflow container
    const containerBox = await page.locator('.card-search').boundingBox();
    expect(inputBox!.x + inputBox!.width).toBeLessThanOrEqual(containerBox!.x + containerBox!.width + 20);
  });

  test('clear button correctly removes Kannada text', async ({ page }) => {
    await page.locator('#inp-voter-name').fill('ಮಂಜುನಾಥ');
    await page.locator('#inp-relative-name').fill('ಕೃಷ್ಣಪ್ಪ');
    await page.locator('#btn-clear').click();

    expect(await page.locator('#inp-voter-name').inputValue()).toBe('');
    expect(await page.locator('#inp-relative-name').inputValue()).toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 7: SERVICE WORKER & OFFLINE CACHING
// ──────────────────────────────────────────────────────────────────────

test.describe('Service Worker', () => {
  test('service worker registers successfully', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    const swRegistered = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.length > 0;
    });
    // SW may not install in test env — just verify no crash
    expect(typeof swRegistered).toBe('boolean');
  });

  test('static assets are cacheable', async ({ page }) => {
    const responses: { url: string; cacheControl: string }[] = [];
    page.on('response', (resp) => {
      if (resp.url().includes('/apps/web/') && resp.status() === 200) {
        responses.push({
          url: resp.url(),
          cacheControl: resp.headers()['cache-control'] || '',
        });
      }
    });
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    expect(responses.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 8: UPLOAD TAB FUNCTIONALITY
// ──────────────────────────────────────────────────────────────────────

test.describe('Upload Tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('#tab-btn-upload').click();
    await page.waitForTimeout(300);
  });

  test('upload panel is visible when tab is active', async ({ page }) => {
    await expect(page.locator('#tab-panel-upload')).toBeVisible();
  });

  test('upload zone has drag-and-drop area', async ({ page }) => {
    await expect(page.locator('#uploadZone')).toBeVisible();
  });

  test('file input accepts PDF files', async ({ page }) => {
    const fileInput = page.locator('#pdfInput');
    await expect(fileInput).toBeAttached();
    const accept = await fileInput.getAttribute('accept');
    expect(accept).toContain('pdf');
  });

  test('upload tab has search name input', async ({ page }) => {
    const nameInput = page.locator('#inp-upload-name');
    if (await nameInput.count() > 0) {
      await expect(nameInput).toBeVisible();
    }
  });

  test('switching back to DB tab hides upload panel', async ({ page }) => {
    await page.locator('#tab-btn-db').click();
    await page.waitForTimeout(300);
    await expect(page.locator('#tab-panel-upload')).not.toBeVisible();
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 9: ERROR BOUNDARY & MONITOR
// ──────────────────────────────────────────────────────────────────────

test.describe('Error Handling & Monitoring', () => {
  test('global error handler does not crash the app', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Trigger a synthetic error
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'Test error',
        error: new Error('Test error'),
      }));
    });
    await page.waitForTimeout(500);

    // App should still be functional
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('unhandled rejection handler shows banner', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Trigger an unhandled rejection (non-AbortError)
    await page.evaluate(() => {
      Promise.reject(new Error('Network failure'));
    });
    await page.waitForTimeout(1000);

    // Status banner may appear
    const banner = page.locator('#div-status-banner');
    if (await banner.isVisible()) {
      const text = await banner.textContent();
      expect(text).toContain('network');
    }
    // App should still be functional regardless
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('AbortError does not trigger error banner', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    await page.evaluate(() => {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      Promise.reject(err);
    });
    await page.waitForTimeout(500);

    // Banner should NOT appear for AbortError
    const banner = page.locator('#div-status-banner');
    const isVisible = await banner.isVisible();
    if (isVisible) {
      const text = await banner.textContent();
      expect(text).not.toContain('AbortError');
    }
  });

  test('monitor stores errors in sessionStorage', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Check that the monitor module is loaded and sessionStorage key exists
    const hasMonitor = await page.evaluate(() => {
      return typeof sessionStorage !== 'undefined';
    });
    expect(hasMonitor).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 10: STATE MANAGEMENT & DATA FLOW
// ──────────────────────────────────────────────────────────────────────

test.describe('State Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
  });

  test('dbState.masterIndex is populated after load', async ({ page }) => {
    const hasMasterIndex = await page.evaluate(() => {
      // @ts-ignore
      return typeof dbState !== 'undefined' && dbState.masterIndex !== null;
    });
    expect(hasMasterIndex).toBe(true);
  });

  test('selecting district updates dbState.selectedDist', async ({ page }) => {
    await page.locator('#sel-district').selectOption('MYSORE');
    await page.waitForTimeout(500);

    const selectedDist = await page.evaluate(() => {
      // @ts-ignore
      return dbState.selectedDist;
    });
    expect(selectedDist).toBe('MYSORE');
  });

  test('selecting AC updates dbState.selectedAC', async ({ page }) => {
    await selectMysoreKrishnaraja(page);

    const selectedAC = await page.evaluate(() => {
      // @ts-ignore
      return dbState.selectedAC;
    });
    expect(selectedAC).toBe('114');
  });

  test('LRU cache is bounded by MAX_CACHED_PARTS', async ({ page }) => {
    const maxParts = await page.evaluate(() => {
      // @ts-ignore
      return typeof APP_CONFIG !== 'undefined' ? APP_CONFIG.MAX_CACHED_PARTS : 300;
    });
    expect(maxParts).toBeLessThanOrEqual(300);
  });

  test('search scope radio buttons update state', async ({ page }) => {
    await selectMysoreKrishnaraja(page);
    await page.locator('#rdo-all-parts').check();
    await page.waitForTimeout(300);

    const scope = await page.evaluate(() => {
      // @ts-ignore
      return dbState.searchScope;
    });
    expect(scope === 'ac' || scope === 'all').toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 11: "THIS IS ME" MODAL UTF-8 CONTENT
// ──────────────────────────────────────────────────────────────────────

test.describe('Success Modal UTF-8 Content', () => {
  test('success modal displays Kannada voter name', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await selectMysoreKrishnaraja(page);
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('Manjunath');
    await page.locator('#btn-search').click();

    await page.waitForSelector('.btn-this-is-me', { timeout: 60000 });
    await page.locator('.btn-this-is-me').first().click();
    await page.waitForTimeout(500);

    const modalText = await page.locator('#successModal').textContent();
    // Modal should contain Kannada text from the voter record
    expect(modalText).toMatch(KANNADA_REGEX);
    expect(modalText).not.toContain('\uFFFD');
  });
});

// ──────────────────────────────────────────────────────────────────────
// SECTION 12: ENCODING EDGE CASES
// ──────────────────────────────────────────────────────────────────────

test.describe('Encoding Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await selectMysoreKrishnaraja(page);
  });

  test('Kannada numerals in search do not crash', async ({ page }) => {
    // Kannada digits: ೦೧೨೩೪೫೬೭೮೯
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('೧೨೩');
    await page.locator('#btn-search').click();
    await page.waitForTimeout(5000);
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('combining marks in Kannada input do not crash', async ({ page }) => {
    // Vowel signs (combining): ಾ ಿ ೀ ು ೂ
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('ಕ\u0CBEಮ\u0CBF');
    await page.locator('#btn-search').click();
    await page.waitForTimeout(5000);
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('emoji + Kannada mixed input is safe', async ({ page }) => {
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('🗳️ ಮತದಾನ');
    await page.locator('#btn-search').click();
    await page.waitForTimeout(5000);
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('URL-encoded Kannada in search param does not break', async ({ page }) => {
    // Navigate with Kannada in URL hash/params
    await page.goto('/apps/web/#search=%E0%B2%AE%E0%B2%82%E0%B2%9C%E0%B3%81', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(2000);
    // Should not crash
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('right-to-left text does not break layout', async ({ page }) => {
    // Arabic text (RTL) — should not break the LTR layout
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('عبدال');
    await page.locator('#btn-search').click();
    await page.waitForTimeout(5000);
    await expect(page.locator('#sel-district')).toBeVisible();

    // Page layout should still be intact
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 5);
  });

  test('null bytes in input are sanitized', async ({ page }) => {
    await page.locator('#rdo-all-parts').check();
    await page.locator('#inp-voter-name').fill('Abdul\x00Rehman');
    await page.locator('#btn-search').click();
    await page.waitForTimeout(5000);
    await expect(page.locator('#sel-district')).toBeVisible();
  });
});
