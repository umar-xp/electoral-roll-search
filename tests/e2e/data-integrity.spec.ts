/**
 * E2E Tests — Data Integrity & Index Loading
 * =============================================
 * Validates that master_index.json is correct, data files are accessible,
 * and the application gracefully handles missing or malformed data.
 *
 * Run: npx playwright test tests/e2e/data-integrity.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test';

// ──────────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────────

async function waitForDistrictsLoaded(page: Page) {
  await page.locator('#sel-district option[value="MYSORE"]').waitFor({ state: 'attached', timeout: 15000 });
}

// ──────────────────────────────────────────────────────────────────────
// MASTER INDEX & DATA LOADING
// ──────────────────────────────────────────────────────────────────────

test.describe('Master Index Loading', () => {
  test('master_index.json is fetched successfully', async ({ page }) => {
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('master_index.json') && resp.status() === 200,
      { timeout: 15000 }
    );
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('districts');
  });

  test('master index has correct district structure', async ({ page }) => {
    const responsePromise = page.waitForResponse(
      resp => resp.url().includes('master_index.json') && resp.status() === 200
    );
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await responsePromise;
    const body = await response.json();
    const districts = body.districts;
    // Should be an object or array
    expect(districts).toBeTruthy();
    // MYSORE district should exist
    const districtNames = Array.isArray(districts) ? districts.map((d: any) => d.name || d.id) : Object.keys(districts);
    expect(districtNames.some((n: string) => n.includes('MYSORE'))).toBe(true);
  });

  test('AC 114 data parts are accessible', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Try fetching a known part file via full URL
    const response = await page.request.get('http://localhost:8080/data/districts/MYSORE/114/part_1.json');
    expect(response.status()).toBe(200);
    const data = await response.json();
    // Data is either a flat array or wrapped in {meta, voters}
    const voters = Array.isArray(data) ? data : (data?.voters || []);
    expect(Array.isArray(voters)).toBe(true);
    expect(voters.length).toBeGreaterThan(0);
  });

  test('voter records have expected fields', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await page.request.get('http://localhost:8080/data/districts/MYSORE/114/part_1.json');
    const data = await response.json();
    const voters = Array.isArray(data) ? data : (data?.voters || []);
    const record = voters[0];
    // At least one of vk (Kannada name) or vn (English name) should be present
    expect(record.vk || record.vn).toBeTruthy();
  });

  test('all available parts of AC 114 are accessible', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const knownParts = [1, 9, 19, 23, 24, 28, 41, 46, 47, 50, 51, 58, 64, 66, 74, 84, 86, 87, 98, 106];
    for (const part of knownParts) {
      const response = await page.request.get(`http://localhost:8080/data/districts/MYSORE/114/part_${part}.json`);
      expect(response.status(), `Part ${part} should return 200`).toBe(200);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────
// DISTRICT & AC DROPDOWNS
// ──────────────────────────────────────────────────────────────────────

test.describe('District & AC Dropdowns', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
  });

  test('district dropdown is populated', async ({ page }) => {
    const options = await page.locator('#sel-district option').count();
    expect(options).toBeGreaterThan(1); // At least placeholder + 1 district
  });

  test('selecting MYSORE populates AC dropdown', async ({ page }) => {
    await page.locator('#sel-district').selectOption('MYSORE');
    await page.locator('#sel-ac option[value="114"]').waitFor({ state: 'attached', timeout: 10000 });
    const options = await page.locator('#sel-ac option').count();
    expect(options).toBeGreaterThan(1);
  });

  test('AC 114 is labeled Krishnaraja', async ({ page }) => {
    await page.locator('#sel-district').selectOption('MYSORE');
    await page.locator('#sel-ac option[value="114"]').waitFor({ state: 'attached', timeout: 10000 });
    const text = await page.locator('#sel-ac option[value="114"]').textContent();
    expect(text).toContain('Krishnaraja');
  });

  test('changing district resets AC dropdown', async ({ page }) => {
    await page.locator('#sel-district').selectOption('MYSORE');
    await page.locator('#sel-ac option[value="114"]').waitFor({ state: 'attached', timeout: 10000 });
    // Switch to a different district or placeholder
    await page.locator('#sel-district').selectOption('');
    await page.waitForTimeout(500);
    // AC dropdown should reset
    const selectedAC = await page.locator('#sel-ac').inputValue();
    expect(selectedAC).toBe('');
  });
});

// ──────────────────────────────────────────────────────────────────────
// DATA QUALITY — NETWORK ERRORS
// ──────────────────────────────────────────────────────────────────────

test.describe('Network Error Handling', () => {
  test('graceful handling when data part returns 404', async ({ page }) => {
    // Route a non-existent part to 404
    await page.route('**/data/districts/MYSORE/114/part_99.json', route => {
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
    // App should still be functional
    await expect(page.locator('#sel-district')).toBeVisible();
  });

  test('app handles malformed JSON gracefully', async ({ page }) => {
    // Route a part with malformed JSON
    await page.route('**/data/districts/MYSORE/114/part_1.json', route => {
      route.fulfill({ status: 200, contentType: 'application/json', body: 'not json at all' });
    });
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForDistrictsLoaded(page);
    await page.locator('#sel-district').selectOption('MYSORE');
    await page.locator('#sel-ac option[value="114"]').waitFor({ state: 'attached', timeout: 10000 });
    await page.locator('#sel-ac').selectOption('114');
    await page.waitForTimeout(1000);
    // App should not crash — search area should still be visible
    await expect(page.locator('#inp-voter-name')).toBeVisible();
  });

  test('app handles master_index.json failure', async ({ page }) => {
    await page.route('**/master_index.json', route => {
      route.fulfill({ status: 500, contentType: 'text/plain', body: 'Server Error' });
    });
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    // App should render without crashing
    await expect(page.locator('body')).toBeVisible();
  });

  test('app handles slow network without crashing', async ({ page }) => {
    test.setTimeout(60000);
    // Slow down all data requests
    await page.route('**/data/**', async route => {
      await new Promise(r => setTimeout(r, 3000));
      route.continue();
    });
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    // App should still render
    await expect(page.locator('#sel-district')).toBeVisible();
  });
});

// ──────────────────────────────────────────────────────────────────────
// DATA STRUCTURE VALIDATION
// ──────────────────────────────────────────────────────────────────────

test.describe('Data Structure Validation', () => {
  test('voter record contains valid voter ID format', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await page.request.get('http://localhost:8080/data/districts/MYSORE/114/part_1.json');
    const data = await response.json();
    const voters = Array.isArray(data) ? data : (data?.voters || []);
    // Check first few records for voter ID pattern (field: vid)
    const recordsWithVID = voters.filter((r: any) => r.vid);
    if (recordsWithVID.length > 0) {
      const vid = recordsWithVID[0].vid;
      expect(vid.length).toBeGreaterThanOrEqual(5);
    }
  });

  test('voter records have numeric age when present', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await page.request.get('http://localhost:8080/data/districts/MYSORE/114/part_1.json');
    const data = await response.json();
    const voters = Array.isArray(data) ? data : (data?.voters || []);
    const recordsWithAge = voters.filter((r: any) => r.age !== undefined);
    for (const record of recordsWithAge.slice(0, 20)) {
      const age = Number(record.age);
      expect(age).toBeGreaterThanOrEqual(18);
      expect(age).toBeLessThanOrEqual(120);
    }
  });

  test('voter record gender field is valid when present', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await page.request.get('http://localhost:8080/data/districts/MYSORE/114/part_1.json');
    const data = await response.json();
    const voters = Array.isArray(data) ? data : (data?.voters || []);
    const recordsWithGender = voters.filter((r: any) => r.g);
    for (const record of recordsWithGender.slice(0, 20)) {
      expect(['M', 'F', 'O']).toContain(record.g);
    }
  });

  test('voter records have Kannada names', async ({ page }) => {
    await page.goto('/apps/web/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const response = await page.request.get('http://localhost:8080/data/districts/MYSORE/114/part_1.json');
    const data = await response.json();
    const voters = Array.isArray(data) ? data : (data?.voters || []);
    const recordsWithKannada = voters.filter((r: any) => r.vk);
    expect(recordsWithKannada.length).toBeGreaterThan(0);
    // Kannada Unicode range: \u0C80-\u0CFF
    const kannadaRegex = /[\u0C80-\u0CFF]/;
    expect(kannadaRegex.test(recordsWithKannada[0].vk)).toBe(true);
  });
});
