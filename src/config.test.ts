import { describe, it, expect } from 'vitest';
import { APP_CONFIG } from './config';

describe('APP_CONFIG', () => {
  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(APP_CONFIG)).toBe(true);
  });

  it('has all required keys', () => {
    expect(APP_CONFIG.MAX_CACHED_PARTS).toBe(300);
    expect(APP_CONFIG.PAGE_SIZE).toBe(50);
    expect(APP_CONFIG.AC_CHUNK_SIZE).toBe(150);
    expect(APP_CONFIG.SEARCH_DEBOUNCE_MS).toBe(500);
    expect(APP_CONFIG.SEARCH_TIMEOUT_MS).toBe(60000);
    expect(APP_CONFIG.GLOBAL_MAX_RESULTS).toBe(500);
    expect(APP_CONFIG.FETCH_TIMEOUT_MS).toBe(10000);
  });

  it('values are positive numbers', () => {
    for (const [key, val] of Object.entries(APP_CONFIG)) {
      expect(val, `${key} should be positive`).toBeGreaterThan(0);
    }
  });
});
