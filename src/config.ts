/**
 * Application Configuration — single source of truth for all tuneable parameters.
 * @module config
 */

export const APP_CONFIG = Object.freeze({
  /** Max parts in LRU cache (~36MB at 120KB each) */
  MAX_CACHED_PARTS: 300,
  /** Results per page */
  PAGE_SIZE: 50,
  /** Parts loaded per AC search batch */
  AC_CHUNK_SIZE: 150,
  /** Debounce interval for search button (ms) */
  SEARCH_DEBOUNCE_MS: 500,
  /** Max time for global search (ms) */
  SEARCH_TIMEOUT_MS: 60000,
  /** Cap results in global search */
  GLOBAL_MAX_RESULTS: 500,
  /** Per-fetch timeout (ms) */
  FETCH_TIMEOUT_MS: 10000,
});

export type AppConfig = typeof APP_CONFIG;
