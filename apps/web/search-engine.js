/**
 * Karnataka Electoral Roll Search Engine — Main Search Module
 * =============================================================
/**
 * Karnataka Electoral Roll Search Engine — Main Search Module
 * =============================================================
 * Client-side search engine that enables fast, fuzzy, bilingual
 * voter search across 7M+ records. Works with the existing static
 * JSON data architecture (no backend required).
 *
 * Depends on: search-utils.js (must be loaded first)
 *
 * Usage:
 *   <script src="search-utils.js"></script>
 *   <script src="search-engine.js"></script>
 *   const engine = new VoterSearchEngine();
 *   await engine.init();
 *   const results = await engine.search({ voterName: "Mohammed" });
 */

// ========== LRU CACHE CLASS ==========

/**
 * Least-Recently-Used cache with bounded size.
 *
 * Description: Prevents unbounded memory growth by evicting oldest entries
 * when the cache exceeds maxSize. Each entry's access refreshes its position.
 *
 * @param {number} maxSize - Maximum number of entries before eviction
 */
class LRUCache {
  constructor(maxSize = 200) {
    this._maxSize = maxSize;
    this._map = new Map();
  }

  has(key) {
    return this._map.has(key);
  }

  get(key) {
    if (!this._map.has(key)) return undefined;
    // Move to end (most recently used)
    const value = this._map.get(key);
    this._map.delete(key);
    this._map.set(key, value);
    return value;
  }

  set(key, value) {
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._maxSize) {
      // Evict oldest entry (first key in Map iteration order)
      const oldestKey = this._map.keys().next().value;
      this._map.delete(oldestKey);
    }
    this._map.set(key, value);
  }

  get size() {
    return this._map.size;
  }

  clear() {
    this._map.clear();
  }

  values() {
    return this._map.values();
  }
}

// ========== VOTER SEARCH ENGINE CLASS ==========

class VoterSearchEngine {
  /**
   * Initialize the search engine.
   *
   * @param {Object} options - Configuration options
   * @param {string} options.basePath - Base URL path for data files
   * @param {boolean} options.useWorker - Whether to use Web Worker (default: true)
   * @param {number} options.maxCachedParts - Max parts to keep in memory (default: 200)
   * @param {number} options.searchTimeoutMs - Max time for a single search (default: 60000)
   * @param {number} options.fetchRetries - Number of retries for failed fetches (default: 2)
   */
  constructor(options = {}) {
    this.basePath = options.basePath || this._detectBasePath();
    this.useWorker = options.useWorker !== false;
    this.worker = null;
    this.masterIndex = null;
    this.loadedParts = new LRUCache(options.maxCachedParts || 200);
    this.searchHistory = [];
    this._batchCounter = 0;
    this._pendingSearches = new Map();
    this._inflightFetches = new Map(); // Deduplication: URL → Promise
    this._searchTimeoutMs = options.searchTimeoutMs || 60000;
    this._fetchRetries = options.fetchRetries || 2;
    this._fetchTimeoutMs = options.fetchTimeoutMs || 10000; // 10s per fetch
    this._lastError = null;
  }

  /**
   * Detect the base path for data files relative to current page.
   *
   * @returns {string} Base path ending with /
   * @private
   */
  _detectBasePath() {
    const path = window.location.pathname || '/';
    const idx = path.indexOf('/apps/web/');
    if (idx >= 0) return path.slice(0, idx + 1);
    if (path.endsWith('/')) return path;
    return path.replace(/[^/]*$/, '');
  }

  /**
   * Initialize the engine: load master index and start Web Worker.
   *
   * Must be called before any search operations.
   * Throws an error if master index cannot be loaded.
   *
   * @returns {Promise<void>}
   */
  async init() {
    // Load master index with retry
    const url = `${this.basePath}data/master_index.json?t=${Date.now()}`;
    let lastErr = null;
    for (let attempt = 0; attempt <= this._fetchRetries; attempt++) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.masterIndex = await res.json();
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        if (attempt < this._fetchRetries) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }
    if (lastErr) {
      this._lastError = `Failed to load master index: ${lastErr.message}`;
      throw new Error(this._lastError);
    }

    // Initialize Web Worker if supported
    if (this.useWorker && typeof Worker !== 'undefined') {
      try {
        const workerUrl = new URL('search-worker.js', window.location.href).href;
        this.worker = new Worker(workerUrl);
        this.worker.onmessage = (e) => this._handleWorkerMessage(e);
        this.worker.onerror = (e) => {
          console.warn('Search worker error, falling back to main thread:', e);
          this.worker = null;
        };
      } catch (err) {
        console.warn('Failed to create search worker:', err);
        this.worker = null;
      }
    }
  }

  /**
   * Get list of available (live) districts.
   *
   * @returns {Array<{key: string, name: string, voterCount: number, acCount: number}>}
   */
  getDistricts() {
    if (!this.masterIndex) return [];
    const districts = this.masterIndex.districts || {};
    return Object.entries(districts)
      .filter(([, d]) => d.status === 'live')
      .map(([key, d]) => ({
        key,
        name: d.display_name,
        voterCount: d.voter_count,
        acCount: d.ac_count,
        acs: d.acs || [],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Load an AC index to get part listings with error handling.
   *
   * @param {string} districtKey - District identifier
   * @param {number} acNum - Assembly Constituency number
   * @returns {Promise<Object>} AC index data with parts array
   */
  async loadACIndex(districtKey, acNum) {
    const dirName = districtKey.replace(/ /g, '_');
    const url = `${this.basePath}data/districts/${dirName}/${acNum}_index.json`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      this._lastError = `Failed to load AC index for ${districtKey} AC${acNum}: ${err.message}`;
      console.warn(this._lastError);
      return { parts: [] };
    }
  }

  /**
   * Load voter data from a specific part file with retry logic.
   *
   * Results are cached via LRU to avoid re-fetching while bounding memory.
   * Failed fetches are retried up to this._fetchRetries times.
   *
   * @param {string} districtKey - District identifier
   * @param {number} acNum - AC number
   * @param {number} partNum - Part number
   * @returns {Promise<Array>} Array of voter records
   */
  async loadPart(districtKey, acNum, partNum) {
    const cacheKey = `${districtKey}|${acNum}|${partNum}`;
    if (this.loadedParts.has(cacheKey)) {
      return this.loadedParts.get(cacheKey);
    }

    const dirName = districtKey.replace(/ /g, '_');
    const url = `${this.basePath}data/districts/${dirName}/${acNum}/part_${partNum}.json`;

    // Request deduplication: if same URL is already in-flight, reuse promise
    if (this._inflightFetches.has(url)) {
      return this._inflightFetches.get(url);
    }

    const fetchPromise = this._fetchWithRetry(url, cacheKey, districtKey, acNum, partNum);
    this._inflightFetches.set(url, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      this._inflightFetches.delete(url);
    }
  }

  /**
   * Internal fetch with retry, timeout, and deduplication support.
   * @private
   */
  async _fetchWithRetry(url, cacheKey, districtKey, acNum, partNum) {
    let lastErr = null;
    for (let attempt = 0; attempt <= this._fetchRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this._fetchTimeoutMs);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error(`HTTP ${res.status} for part ${partNum}`);
        const data = await res.json();
        const voters = (data.voters || []).map(v => ({
          ...v,
          _dist: districtKey,
          _ac: acNum,
          _pn: v.pn || partNum,
        }));
        this.loadedParts.set(cacheKey, voters);
        this._lastError = null;
        return voters;
      } catch (err) {
        lastErr = err;
        if (err.name === 'AbortError') {
          lastErr = new Error(`Timeout loading part ${partNum} after ${this._fetchTimeoutMs}ms`);
        }
        if (attempt < this._fetchRetries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }

    this._lastError = `Failed to load ${districtKey} AC${acNum} Part${partNum}: ${lastErr.message}`;
    console.warn(this._lastError);
    return [];
  }

  /**
   * Search within a specific AC (all parts or single part).
   *
   * This is the primary search method. It loads part files progressively
   * and reports progress via the onProgress callback. Uses Web Worker for
   * large batches (>5000 voters) to keep UI responsive.
   *
   * @param {Object} params - Search parameters
   * @param {string} params.district - District key
   * @param {number} params.acNum - AC number
   * @param {number|null} params.partNum - Part number (null = all parts)
   * @param {string} params.voterName - Voter name query
   * @param {string} [params.relName] - Relative name query
   * @param {string} [params.age] - Age filter (±2 tolerance)
   * @param {string} [params.gender] - Gender filter (M/F)
   * @param {string} [params.relType] - Relation type (F/M/H)
   * @param {string} [params.voterId] - Voter EPIC ID
   * @param {Function} [params.onProgress] - Progress callback(searched, total, found)
   * @param {AbortSignal} [params.signal] - AbortController signal for cancellation
   * @returns {Promise<Object>} Search results { results: [], totalFound, totalSearched, time_ms }
   */
  async search(params) {
    const {
      district, acNum, partNum,
      voterName, relName, age, gender, relType, voterId,
      onProgress, signal
    } = params;

    const startTime = performance.now();
    const allResults = [];

    // Determine which parts to search
    let partsToSearch = [];
    if (partNum) {
      partsToSearch = [partNum];
    } else {
      const acIndex = await this.loadACIndex(district, acNum);
      partsToSearch = (acIndex.parts || []).map(p => p.part_num);
    }

    const totalParts = partsToSearch.length;
    const BATCH_SIZE = 5; // Load 5 parts at a time
    let searchedParts = 0;
    const query = { voterName, relName, age, gender, relType, voterId };

    for (let i = 0; i < totalParts; i += BATCH_SIZE) {
      if (signal && signal.aborted) break;

      const batch = partsToSearch.slice(i, i + BATCH_SIZE);

      // Load batch of parts in parallel
      const batchData = await Promise.all(
        batch.map(pn => this.loadPart(district, acNum, pn))
      );

      const voters = batchData.flat();

      // Use Web Worker for large batches, main thread for small ones
      let batchResults;
      if (this.worker && voters.length > 5000) {
        batchResults = await this._searchWithWorker(voters, query);
      } else {
        batchResults = this._searchVoters(voters, query);
      }

      allResults.push(...batchResults);
      searchedParts += batch.length;

      if (onProgress) {
        onProgress(searchedParts, totalParts, allResults.length);
      }
    }

    // Sort by relevance score
    allResults.sort((a, b) => b._score - a._score);

    const elapsed = performance.now() - startTime;

    return {
      results: allResults.slice(0, 200),
      totalFound: allResults.length,
      totalSearched: partsToSearch.length,
      time_ms: Math.round(elapsed),
    };
  }

  /**
   * Global search across ALL live districts with timeout protection.
   *
   * Searches each district's ACs progressively. Designed for "find me
   * anywhere" use case when the user doesn't know their district/AC.
   * Automatically stops after this._searchTimeoutMs or when enough results found.
   *
   * @param {Object} params - Same as search() but without district/ac
   * @param {string} params.voterName - Required for global search
   * @param {Function} [params.onProgress] - Progress callback
   * @param {AbortSignal} [params.signal] - Cancellation signal
   * @returns {Promise<Object>} Aggregated results across all districts
   */
  async globalSearch(params) {
    const { voterName, onProgress, signal } = params;
    if (!voterName) throw new Error('voterName is required for global search');

    const startTime = performance.now();
    const allResults = [];
    const districts = this.getDistricts();
    let totalAcsSearched = 0;
    let totalAcs = 0;
    let timedOut = false;

    // Calculate total ACs for progress
    for (const dist of districts) {
      totalAcs += dist.acs.length;
    }

    for (const dist of districts) {
      if (signal && signal.aborted) break;
      if (timedOut) break;

      for (const ac of dist.acs) {
        if (signal && signal.aborted) break;

        // Timeout protection: stop if search exceeds time limit
        if (performance.now() - startTime > this._searchTimeoutMs) {
          timedOut = true;
          break;
        }

        const result = await this.search({
          ...params,
          district: dist.key,
          acNum: ac.ac_num,
          partNum: null,
          onProgress: null, // Don't report per-part progress for global
          signal,
        });

        allResults.push(...result.results);
        totalAcsSearched++;

        if (onProgress) {
          onProgress(totalAcsSearched, totalAcs, allResults.length);
        }

        // Early stop: enough results found
        if (allResults.length >= 500) break;
      }

      if (allResults.length >= 500) break;
    }

    allResults.sort((a, b) => b._score - a._score);
    const elapsed = performance.now() - startTime;

    return {
      results: allResults.slice(0, 200),
      totalFound: allResults.length,
      totalSearched: totalAcsSearched,
      totalAcs,
      time_ms: Math.round(elapsed),
      timedOut,
    };
  }

  /**
   * Search voter array using the scoring algorithm.
   *
   * @param {Array} voters - Array of voter records
   * @param {Object} query - Search query parameters
   * @returns {Array} Matching voters with _score field added
   * @private
   */
  _searchVoters(voters, query) {
    const voterNameTokens = this._tokenize(query.voterName);
    const relNameTokens = this._tokenize(query.relName);

    const parsedQuery = {
      ...query,
      voterNameTokens,
      relNameTokens,
    };

    const results = [];

    for (const voter of voters) {
      const score = this._scoreVoter(voter, parsedQuery);
      if (score > 0) {
        results.push({ ...voter, _score: score });
      }
    }

    return results;
  }

  /**
   * Tokenize a search query for matching.
   *
   * @param {string} input - Raw search input
   * @returns {string[]} Normalized tokens
   * @private
   */
  _tokenize(input) {
    if (!input || !input.trim()) return [];
    const cleaned = input.trim().toLowerCase();

    // Kannada input: keep as single token
    const kannadaChars = (cleaned.match(/[\u0C80-\u0CFF]/g) || []).length;
    if (kannadaChars > cleaned.length * 0.5) {
      return [cleaned];
    }

    return cleaned.split(/\s+/)
      .map(t => t.replace(/[^a-z]/g, ''))
      .filter(t => t.length >= 2);
  }

  /**
   * Score a voter record against a search query.
   *
   * @param {Object} voter - Voter record
   * @param {Object} query - Parsed query with tokens
   * @returns {number} Score 0-1, or -1 for non-match
   * @private
   */
  _scoreVoter(voter, query) {
    // Hard filters
    if (query.gender && voter.g !== query.gender) return -1;
    if (query.relType && voter.rt !== query.relType) return -1;
    if (query.age) {
      const diff = Math.abs(parseInt(query.age) - (voter.a || 0));
      if (diff > 2) return -1;
    }
    if (query.voterId) {
      if (!voter.id) return -1;
      const qid = query.voterId.toLowerCase();
      const vid = voter.id.toLowerCase();
      if (qid === vid) return 1.0;
      // Fuzzy: allow 1 character substitution (handles OCR digit errors)
      if (qid.length === vid.length && this._levenshtein(qid, vid, 1) <= 1) return 0.85;
      // Prefix match: user may type partial ID
      if (qid.length >= 4 && vid.startsWith(qid)) return 0.7;
      if (qid.length >= 4 && qid.startsWith(vid)) return 0.7;
      return -1;
    }

    // Name scoring
    let nameScore = 0;
    if (query.voterNameTokens.length > 0) {
      // Check if Kannada query — do substring match on vk field
      const isKannada = query.voterNameTokens.length === 1 &&
        /[\u0C80-\u0CFF]/.test(query.voterNameTokens[0]);

      if (isKannada) {
        nameScore = this._scoreKannadaMatch(query.voterNameTokens[0], voter);
      } else {
        const voterTokens = this._getVoterTokens(voter);
        nameScore = this._scoreNameMatch(query.voterNameTokens, voterTokens);
      }
      if (nameScore <= 0) return -1;
    }

    // Relative name scoring
    let relScore = 1.0;
    if (query.relNameTokens.length > 0) {
      const isKannada = query.relNameTokens.length === 1 &&
        /[\u0C80-\u0CFF]/.test(query.relNameTokens[0]);

      if (isKannada) {
        relScore = (voter.rk && voter.rk.replace(/[\u200C\u200D]/g, '').includes(query.relNameTokens[0])) ? 0.8 : -1;
      } else {
        const relTokens = this._getRelativeTokens(voter);
        relScore = this._scoreNameMatch(query.relNameTokens, relTokens);
      }
      if (relScore <= 0) return -1;
    }

    const hasRel = query.relNameTokens.length > 0;
    return hasRel ? (nameScore * 0.65 + relScore * 0.35) : nameScore;
  }

  /**
   * Score Kannada name match using substring comparison.
   *
   * @param {string} query - Kannada query string
   * @param {Object} voter - Voter record with vk field
   * @returns {number} Score 0-1
   * @private
   */
  _scoreKannadaMatch(query, voter) {
    const vk = (voter.vk || '').replace(/[\u200C\u200D]/g, '').toLowerCase();
    if (!vk) return 0;
    const q = query.replace(/[\u200C\u200D]/g, '').toLowerCase();
    if (vk === q) return 1.0;
    if (vk.includes(q)) return 0.85;
    if (q.length >= 4 && vk.startsWith(q.substring(0, 4))) return 0.6;
    return 0;
  }

  /**
   * Score English name token match.
   *
   * @private
   */
  _scoreNameMatch(queryTokens, voterTokens) {
    if (!queryTokens.length || !voterTokens.length) return 0;

    let totalScore = 0;
    let matchedCount = 0;

    for (const qt of queryTokens) {
      let bestScore = 0;
      for (const vt of voterTokens) {
        const s = this._scoreTokenPair(qt, vt);
        if (s > bestScore) bestScore = s;
        if (s === 1.0) break;
      }
      totalScore += bestScore;
      if (bestScore > 0) matchedCount++;
    }

    if (matchedCount === 0) return 0;
    const avgScore = totalScore / queryTokens.length;
    const bonus = (matchedCount === queryTokens.length) ? 0.1 : 0;
    return Math.min(1.0, avgScore + bonus);
  }

  /** @private — delegates to shared SearchUtils */
  _scoreTokenPair(queryToken, voterToken) {
    return (typeof SearchUtils !== 'undefined')
      ? SearchUtils.scoreToken(queryToken, voterToken)
      : this._scoreTokenPairFallback(queryToken, voterToken);
  }

  /** @private */
  _getVoterTokens(voter) {
    return (typeof SearchUtils !== 'undefined')
      ? SearchUtils.getVoterTokens(voter)
      : this._getVoterTokensFallback(voter);
  }

  /** @private */
  _getRelativeTokens(voter) {
    return (typeof SearchUtils !== 'undefined')
      ? SearchUtils.getRelativeTokens(voter)
      : this._getRelativeTokensFallback(voter);
  }

  /** @private — delegates to shared SearchUtils */
  _phoneticKey(token) {
    return (typeof SearchUtils !== 'undefined')
      ? SearchUtils.phoneticKey(token)
      : this._phoneticKeyFallback(token);
  }

  /** @private — delegates to shared SearchUtils */
  _levenshtein(a, b, maxDist = 3) {
    return (typeof SearchUtils !== 'undefined')
      ? SearchUtils.levenshtein(a, b, maxDist)
      : this._levenshteinFallback(a, b, maxDist);
  }

  // Inline fallbacks for when search-utils.js hasn't loaded (graceful degradation)
  /** @private */
  _scoreTokenPairFallback(queryToken, voterToken) {
    if (queryToken === voterToken) return 1.0;
    if (voterToken.startsWith(queryToken) && queryToken.length >= 3) return 0.9;
    if (queryToken.startsWith(voterToken) && voterToken.length >= 3) return 0.85;
    if (queryToken.length >= 4 && this._phoneticKeyFallback(queryToken) === this._phoneticKeyFallback(voterToken)) return 0.8;
    if (Math.abs(queryToken.length - voterToken.length) <= 2) {
      const dist = this._levenshteinFallback(queryToken, voterToken, 2);
      if (dist === 1) return 0.7;
      if (dist === 2) return 0.5;
    }
    // Jaro-Winkler fallback
    if (Math.min(queryToken.length, voterToken.length) >= 4) {
      const jw = (typeof SearchUtils !== 'undefined') ? SearchUtils.jaroWinkler(queryToken, voterToken) : 0;
      if (jw >= 0.92) return 0.85;
      if (jw >= 0.82) return 0.72;
    }
    if (queryToken.length >= 4 && voterToken.includes(queryToken)) return 0.6;
    // Consonant skeleton fallback
    const qSkel = this._consonantSkeleton(queryToken);
    const vSkel = this._consonantSkeleton(voterToken);
    if (qSkel.length >= 2 && qSkel === vSkel && queryToken[0] === voterToken[0] && Math.min(queryToken.length, voterToken.length) >= 4) return 0.7;
    return 0;
  }

  /** @private */
  _getVoterTokensFallback(voter) {
    if (Array.isArray(voter.vt) && voter.vt.length) return voter.vt.map(t => t.replace(/[\u200C\u200D]/g, '').toLowerCase());
    if (voter.vn) return voter.vn.replace(/[\u200C\u200D]/g, '').toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    return [];
  }

  /** @private */
  _getRelativeTokensFallback(voter) {
    if (Array.isArray(voter.rnt) && voter.rnt.length) return voter.rnt.map(t => t.replace(/[\u200C\u200D]/g, '').toLowerCase());
    if (voter.rn) return voter.rn.replace(/[\u200C\u200D]/g, '').toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    return [];
  }

  /** @private */
  _phoneticKeyFallback(token) {
    const map = {
      'ee': 'i', 'oo': 'u', 'aa': 'a', 'ou': 'u',
      'sh': 's', 'th': 't', 'dh': 'd', 'bh': 'b',
      'kh': 'k', 'gh': 'g', 'ph': 'f', 'ch': 'c',
      'pp': 'p', 'tt': 't', 'kk': 'k', 'mm': 'm',
      'nn': 'n', 'll': 'l', 'ss': 's', 'dd': 'd',
    };
    let key = token;
    for (const [from, to] of Object.entries(map)) {
      key = key.replaceAll(from, to);
    }
    return key.replace(/[aeiou]+$/, '');
  }

  /** @private */
  _levenshteinFallback(a, b, maxDist = 3) {
    if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
    if (a === b) return 0;
    const m = a.length, n = b.length;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    let curr = new Array(n + 1);

    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        curr[j] = a[i-1] === b[j-1]
          ? prev[j-1]
          : 1 + Math.min(prev[j], curr[j-1], prev[j-1]);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[n];
  }

  /** @private */
  _consonantSkeleton(token) {
    return token.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
  }

  /**
   * Handle messages from Web Worker.
   * @private
   */
  _handleWorkerMessage(e) {
    const msg = e.data;
    const pending = this._pendingSearches.get(msg.batchId);
    if (!pending) return;

    if (msg.type === 'results') {
      pending.resolve(msg.results || []);
      this._pendingSearches.delete(msg.batchId);
    } else if (msg.type === 'progress' && pending.onProgress) {
      pending.onProgress(msg.searched, msg.total, msg.found);
    } else if (msg.type === 'error') {
      pending.resolve([]); // Fallback gracefully
      this._pendingSearches.delete(msg.batchId);
    } else if (msg.type === 'cancelled') {
      pending.resolve([]);
      this._pendingSearches.delete(msg.batchId);
    }
  }

  /**
   * Delegate search to Web Worker for non-blocking processing.
   *
   * Description: Sends voter data and query to the worker thread.
   * Returns a Promise that resolves when the worker posts results back.
   * Falls back to main-thread search if worker fails.
   *
   * @param {Array} voters - Voter records to search
   * @param {Object} query - Search query parameters
   * @returns {Promise<Array>} Matching voter records with _score
   * @private
   */
  _searchWithWorker(voters, query) {
    return new Promise((resolve) => {
      const batchId = `batch_${++this._batchCounter}_${Date.now()}`;

      // Set a safety timeout: if worker doesn't respond in 15s, fallback to main thread
      const timeout = setTimeout(() => {
        this._pendingSearches.delete(batchId);
        resolve(this._searchVoters(voters, query));
      }, 15000);

      this._pendingSearches.set(batchId, {
        resolve: (results) => {
          clearTimeout(timeout);
          resolve(results);
        },
        onProgress: null,
      });

      this.worker.postMessage({
        type: 'search',
        batchId,
        query,
        voters,
      });
    });
  }

  /**
   * Get engine statistics.
   *
   * @returns {Object} Stats about loaded data and cache
   */
  getStats() {
    let totalCached = 0;
    for (const voters of this.loadedParts.values()) {
      totalCached += voters.length;
    }
    return {
      partsLoaded: this.loadedParts.size,
      votersCached: totalCached,
      hasWorker: !!this.worker,
      districtsAvailable: this.getDistricts().length,
      lastError: this._lastError,
    };
  }

  /**
   * Get the last error message (if any).
   *
   * @returns {string|null} Last error message or null
   */
  getLastError() {
    return this._lastError;
  }

  /**
   * Clear the voter data cache to free memory.
   */
  clearCache() {
    this.loadedParts.clear();
  }

  /**
   * Destroy the engine: terminate worker, clear all state.
   * Call this when the engine is no longer needed to prevent memory leaks.
   */
  destroy() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    // Resolve all pending searches with empty results
    for (const [, pending] of this._pendingSearches) {
      pending.resolve([]);
    }
    this._pendingSearches.clear();
    this._inflightFetches.clear();
    this.loadedParts.clear();
    this.masterIndex = null;
  }
}

// Export for use in browser
if (typeof window !== 'undefined') {
  window.VoterSearchEngine = VoterSearchEngine;
}
