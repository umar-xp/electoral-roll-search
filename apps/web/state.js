/**
 * State Management Module
 * =======================
 * Centralized application state with getters/setters.
 * Replaces the global dbState object with controlled access.
 */

const AppState = (function() {
  'use strict';

  const APP_CONFIG = Object.freeze({
    MAX_CACHED_PARTS: 300,
    PAGE_SIZE: 50,
    AC_CHUNK_SIZE: 150,
    SEARCH_DEBOUNCE_MS: 500,
    SEARCH_TIMEOUT_MS: 60000,
    GLOBAL_MAX_RESULTS: 500,
    FETCH_TIMEOUT_MS: 10000,
  });

  const state = {
    masterIndex: null,
    acIndex: null,
    cacheBuster: null,
    loadedParts: {},
    selectedDist: null,
    selectedAC: null,
    selectedPart: null,
    searchScope: 'part',
    isSearching: false,
    abortCtrl: null,
    globalAbort: null,
    allResults: [],
    displayedCount: 0,
    PAGE_SIZE: APP_CONFIG.PAGE_SIZE,
    acAllParts: null,
    acAllPartsIndex: 0,
    acAllPartsChunk: APP_CONFIG.AC_CHUNK_SIZE,
    lastDBParams: null,
    // Indexed search engine instance
    indexedEngine: null,
  };

  // LRU Cache for part data
  const _partCache = new Map();

  function lruGet(key) {
    if (!_partCache.has(key)) return null;
    const value = _partCache.get(key);
    _partCache.delete(key);
    _partCache.set(key, value);
    return value;
  }

  function lruSet(key, value) {
    if (_partCache.has(key)) {
      _partCache.delete(key);
    } else if (_partCache.size >= APP_CONFIG.MAX_CACHED_PARTS) {
      const oldestKey = _partCache.keys().next().value;
      _partCache.delete(oldestKey);
      delete state.loadedParts[oldestKey];
    }
    _partCache.set(key, value);
    state.loadedParts[key] = value;
  }

  return {
    config: APP_CONFIG,
    get: (key) => state[key],
    set: (key, value) => { state[key] = value; },
    reset: () => {
      state.allResults = [];
      state.displayedCount = 0;
      state.acAllParts = null;
      state.acAllPartsIndex = 0;
      state.lastDBParams = null;
    },
    cache: { get: lruGet, set: lruSet, size: () => _partCache.size },
    state, // Direct access for backward compat (will be removed)
  };
})();

// Export for other modules
if (typeof window !== 'undefined') {
  window.AppState = AppState;
}
