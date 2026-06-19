/**
 * Network Module — Fetch utilities with retry, timeout, and caching.
 * ==================================================================
 * Centralized data fetching with:
 *   - Automatic retry with exponential backoff
 *   - Per-request timeout via AbortController
 *   - Request deduplication (prevents duplicate in-flight requests)
 *   - Cache busting via masterIndex.generated_at
 */

const DataFetcher = (function() {
  'use strict';

  const _inflight = new Map(); // URL → Promise (deduplication)
  const MAX_RETRIES = 2;
  const FETCH_TIMEOUT_MS = 10000;

  function _basePath() {
    const p = window.location.pathname || '/';
    const idx = p.indexOf('/apps/web/');
    if (idx >= 0) return p.slice(0, idx + 1);
    if (p.endsWith('/')) return p;
    return p.replace(/[^/]*$/, '');
  }

  function _cacheBuster() {
    const mi = AppState.get('masterIndex');
    return (mi && mi.generated_at) || String(Date.now());
  }

  function withCacheBuster(url) {
    const v = _cacheBuster();
    return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(v)}`;
  }

  function noCacheUrl(url) {
    return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
  }

  /**
   * Fetch with timeout and retry.
   * @param {string} url
   * @param {object} opts - { signal, retries, timeout, noCache }
   * @returns {Promise<Response>}
   */
  async function fetchWithRetry(url, opts = {}) {
    const retries = opts.retries ?? MAX_RETRIES;
    const timeout = opts.timeout ?? FETCH_TIMEOUT_MS;
    let lastErr = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      // Combine with external signal
      if (opts.signal && opts.signal.aborted) {
        clearTimeout(timer);
        throw new DOMException('Aborted', 'AbortError');
      }
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      try {
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (e.name === 'AbortError') throw e;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }
    throw lastErr;
  }

  /**
   * Fetch JSON with deduplication (same URL returns same promise).
   */
  async function fetchJSON(url, opts = {}) {
    const cacheKey = url.split('?')[0]; // Dedupe ignoring query params

    if (_inflight.has(cacheKey)) {
      return _inflight.get(cacheKey);
    }

    const promise = fetchWithRetry(url, opts).then(r => r.json()).finally(() => {
      _inflight.delete(cacheKey);
    });

    _inflight.set(cacheKey, promise);
    return promise;
  }

  /**
   * Load master index.
   */
  async function loadMasterIndex() {
    const url = noCacheUrl(_basePath() + 'data/master_index.json');
    return fetchJSON(url, { noCache: true });
  }

  /**
   * Load AC index for a district/AC.
   */
  async function loadACIndex(districtKey, acNum) {
    const url = withCacheBuster(`${_basePath()}data/districts/${districtKey}/${acNum}_index.json`);
    return fetchJSON(url);
  }

  /**
   * Load part voter data with LRU caching.
   */
  async function loadPartData(district, acNum, partNum, signal) {
    const key = `${district}_${acNum}_${partNum}`;
    const cached = AppState.cache.get(key);
    if (cached) return cached;

    const url = withCacheBuster(`${_basePath()}data/districts/${district}/${acNum}/part_${partNum}.json`);
    const data = await fetchJSON(url, { signal });
    const voters = (data && data.voters) ? data.voters : [];

    const distKey = String(district || '').toUpperCase();
    const acInt = parseInt(acNum, 10);
    const withMeta = voters.map(v => ({
      ...v,
      d: distKey,
      ac: isNaN(acInt) ? null : acInt,
      pn: v && v.pn != null ? v.pn : partNum,
    }));

    AppState.cache.set(key, withMeta);
    return withMeta;
  }

  return {
    basePath: _basePath,
    withCacheBuster,
    noCacheUrl,
    fetchWithRetry,
    fetchJSON,
    loadMasterIndex,
    loadACIndex,
    loadPartData,
  };
})();

if (typeof window !== 'undefined') {
  window.DataFetcher = DataFetcher;
}
