/**
 * Index-Based Search Engine — O(1) lookups via phonetic inverted index.
 * ======================================================================
 * Replaces brute-force O(n) scanning with index-first search:
 *   1. Query → phonetic keys → shard lookup → candidate set
 *   2. Candidate set → fetch only relevant parts → score & rank
 *
 * This reduces network requests from thousands to single-digit fetches.
 */

class IndexedSearchEngine {
  constructor(options = {}) {
    this.basePath = options.basePath || this._detectBasePath();
    this.indexPath = `${this.basePath}data/search_index/`;
    this.metadata = null;
    this._shardCache = new Map();
    this._idShardCache = new Map();
    this._partCache = new LRUCache(options.maxCachedParts || 200);
    this._fetchTimeoutMs = options.fetchTimeoutMs || 8000;
    this._maxResults = options.maxResults || 500;
  }

  _detectBasePath() {
    const path = window.location.pathname || '/';
    const idx = path.indexOf('/apps/web/');
    if (idx >= 0) return path.slice(0, idx + 1);
    if (path.endsWith('/')) return path;
    return path.replace(/[^/]*$/, '');
  }

  /**
   * Initialize: load index metadata.
   */
  async init() {
    const url = `${this.indexPath}metadata.json?t=${Date.now()}`;
    const res = await this._fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Failed to load search index metadata: HTTP ${res.status}`);
    this.metadata = await res.json();
    return this;
  }

  /**
   * Check if the index is available.
   */
  get isAvailable() {
    return this.metadata !== null;
  }

  /**
   * Search by voter name using the phonetic index.
   * Returns scored, ranked results without scanning all data.
   *
   * @param {Object} query - Search parameters
   * @returns {Promise<{results: Array, time_ms: number, totalFound: number}>}
   */
  async search(query, signal) {
    const start = performance.now();
    const { voterName, relName, voterId } = query;

    // Fast path: Voter ID lookup (O(1))
    if (voterId && voterId.length >= 4) {
      const idResults = await this._searchByVoterId(voterId, signal);
      return {
        results: idResults,
        time_ms: performance.now() - start,
        totalFound: idResults.length,
        method: 'voter_id_index',
      };
    }

    // Name-based search via phonetic index
    if (!voterName) {
      return { results: [], time_ms: 0, totalFound: 0, method: 'none' };
    }

    // Step 1: Tokenize and generate phonetic keys
    const queryTokens = this._tokenize(voterName);
    if (!queryTokens.length) {
      return { results: [], time_ms: 0, totalFound: 0, method: 'none' };
    }

    // Step 2: Look up phonetic keys in shards → get candidate refs
    const candidateRefs = await this._lookupPhoneticCandidates(queryTokens, signal);

    // Step 3: If relative name provided, intersect with relative name candidates
    let finalRefs = candidateRefs;
    if (relName) {
      const relTokens = this._tokenize(relName);
      if (relTokens.length) {
        const relRefs = await this._lookupPhoneticCandidates(relTokens, signal, 'r:');
        finalRefs = this._intersectRefs(candidateRefs, relRefs);
      }
    }

    // Step 4: Group refs by part file and fetch only needed parts
    const grouped = this._groupRefsByPart(finalRefs);

    // Step 5: Fetch parts, score candidates, apply filters
    const results = await this._scoreAndFilter(grouped, query, signal);

    // Step 6: Sort by score, limit results
    results.sort((a, b) => b._score - a._score);
    const limited = results.slice(0, this._maxResults);

    return {
      results: limited,
      time_ms: performance.now() - start,
      totalFound: results.length,
      method: 'phonetic_index',
    };
  }

  /**
   * Search by voter ID using the ID index (O(1)).
   */
  async _searchByVoterId(voterId, signal) {
    const vid = voterId.trim().toUpperCase();
    const prefix = vid.slice(0, 3);

    if (!this.metadata.id_manifest[prefix]) return [];

    let shard = this._idShardCache.get(prefix);
    if (!shard) {
      const url = `${this.indexPath}id_shards/${prefix}.json`;
      const res = await this._fetchWithTimeout(url, signal);
      if (!res.ok) return [];
      shard = await res.json();
      this._idShardCache.set(prefix, shard);
    }

    // Exact match
    const ref = shard[vid];
    if (ref) {
      const voter = await this._resolveRef(ref, signal);
      if (voter) return [{ ...voter, _score: 1.0 }];
    }

    // Fuzzy: find IDs within edit distance 1
    const fuzzyResults = [];
    for (const [id, idRef] of Object.entries(shard)) {
      if (id.length === vid.length && this._editDist1(vid, id)) {
        const voter = await this._resolveRef(idRef, signal);
        if (voter) fuzzyResults.push({ ...voter, _score: 0.85 });
      }
    }

    return fuzzyResults.slice(0, 10);
  }

  /**
   * Look up phonetic candidates from index shards.
   */
  async _lookupPhoneticCandidates(tokens, signal, prefix = '') {
    const allRefs = new Set();

    for (const token of tokens) {
      const pkey = this._phoneticKey(token);
      if (!pkey || pkey.length < 2) continue;

      const shardId = pkey.slice(0, 2);
      const lookupKey = `${prefix}${pkey}`;

      // Load shard if not cached
      let shard = this._shardCache.get(shardId);
      if (!shard) {
        if (!this.metadata.shard_manifest[shardId]) continue;
        const url = `${this.indexPath}shards/${shardId}.json`;
        try {
          const res = await this._fetchWithTimeout(url, signal);
          if (!res.ok) continue;
          shard = await res.json();
          this._shardCache.set(shardId, shard);
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          continue;
        }
      }

      // Get exact key matches
      const refs = shard[lookupKey] || [];
      refs.forEach(r => allRefs.add(r));

      // Also check phonetic neighbors (keys that share the same prefix)
      // This handles minor phonetic variations
      const pKeyPrefix = pkey.slice(0, Math.max(3, pkey.length - 1));
      for (const key of Object.keys(shard)) {
        const cleanKey = key.startsWith('r:') ? key.slice(2) : key;
        if (prefix && !key.startsWith(prefix)) continue;
        if (!prefix && key.startsWith('r:')) continue;
        if (cleanKey.startsWith(pKeyPrefix) && cleanKey !== pkey) {
          // Only include if phonetically close
          if (this._phoneticDistance(pkey, cleanKey) <= 1) {
            (shard[key] || []).forEach(r => allRefs.add(r));
          }
        }
      }
    }

    return allRefs;
  }

  /**
   * Intersect two sets of refs (for name + relative name).
   * Returns refs that appear in both sets (same voter index).
   */
  _intersectRefs(nameRefs, relRefs) {
    // Both sets contain refs like "DISTRICT|ac|part|idx"
    // A voter matches both if the same "DISTRICT|ac|part|idx" is in both
    const intersection = new Set();
    for (const ref of nameRefs) {
      if (relRefs.has(ref)) {
        intersection.add(ref);
      }
    }
    // If intersection is too small, use name refs only (relative name might be different)
    if (intersection.size < 5 && nameRefs.size > 0) {
      return nameRefs;
    }
    return intersection;
  }

  /**
   * Group refs by part file for batch fetching.
   */
  _groupRefsByPart(refs) {
    const groups = new Map(); // "dist|ac|part" → [indices]
    for (const ref of refs) {
      const parts = ref.split('|');
      if (parts.length < 4) continue;
      const partKey = `${parts[0]}|${parts[1]}|${parts[2]}`;
      const idx = parseInt(parts[3], 10);
      if (!groups.has(partKey)) groups.set(partKey, []);
      groups.get(partKey).push(idx);
    }
    return groups;
  }

  /**
   * Fetch relevant parts, extract candidates, score them.
   */
  async _scoreAndFilter(grouped, query, signal) {
    const results = [];
    const { voterName, relName, age, gender, relType } = query;
    const queryTokens = this._tokenize(voterName || '');

    // Limit to avoid fetching too many parts
    const entries = Array.from(grouped.entries()).slice(0, 100);

    // Fetch in parallel batches of 10
    for (let i = 0; i < entries.length; i += 10) {
      if (signal && signal.aborted) break;

      const batch = entries.slice(i, i + 10);
      const partData = await Promise.all(
        batch.map(([partKey]) => this._loadPart(partKey, signal))
      );

      for (let j = 0; j < batch.length; j++) {
        const [partKey, indices] = batch[j];
        const voters = partData[j];
        if (!voters) continue;

        const [dist, ac, part] = partKey.split('|');

        for (const idx of indices) {
          if (idx >= voters.length) continue;
          const voter = voters[idx];
          if (!voter) continue;

          // Apply hard filters
          if (gender && voter.g !== gender) continue;
          if (relType && voter.rt !== relType) continue;
          if (age) {
            const diff = Math.abs(parseInt(age, 10) - (voter.a || 0));
            if (diff > 2) continue;
          }

          // Score the name match
          const voterTokens = this._getVoterTokens(voter);
          const nameScore = scoreNameMatch(queryTokens, voterTokens);
          if (nameScore <= 0.3) continue;

          // Score relative name if provided
          let relScore = 1.0;
          if (relName) {
            const relQueryTokens = this._tokenize(relName);
            const relVoterTokens = this._getRelativeTokens(voter);
            relScore = scoreNameMatch(relQueryTokens, relVoterTokens);
            if (relScore <= 0.2) continue;
          }

          const combined = relName
            ? (nameScore * 0.65) + (relScore * 0.35)
            : nameScore;

          if (combined >= 0.4) {
            results.push({
              ...voter,
              d: dist,
              ac: parseInt(ac, 10),
              pn: parseInt(part, 10),
              _score: combined,
            });
          }
        }
      }
    }

    return results;
  }

  /**
   * Resolve a single ref to a voter record.
   */
  async _resolveRef(ref, signal) {
    const parts = ref.split('|');
    if (parts.length < 4) return null;
    const partKey = `${parts[0]}|${parts[1]}|${parts[2]}`;
    const idx = parseInt(parts[3], 10);
    const voters = await this._loadPart(partKey, signal);
    if (!voters || idx >= voters.length) return null;
    const voter = voters[idx];
    const [dist, ac, part] = parts;
    return { ...voter, d: dist, ac: parseInt(ac, 10), pn: parseInt(part, 10) };
  }

  /**
   * Load a part's voter data with caching.
   */
  async _loadPart(partKey, signal) {
    if (this._partCache.has(partKey)) {
      return this._partCache.get(partKey);
    }

    const [dist, ac, part] = partKey.split('|');
    const dirName = dist.replace(/ /g, '_');
    const url = `${this.basePath}data/districts/${dirName}/${ac}/part_${part}.json`;

    try {
      const res = await this._fetchWithTimeout(url, signal);
      if (!res.ok) return null;
      const data = await res.json();
      const voters = data.voters || [];
      this._partCache.set(partKey, voters);
      return voters;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      return null;
    }
  }

  // ─── Utility methods ─────────────────────────────────────────────

  _tokenize(input) {
    if (!input || !input.trim()) return [];
    const trimmed = input.trim().toLowerCase();
    if (/[\u0C80-\u0CFF]/.test(trimmed)) return [trimmed];
    return trimmed.split(/[\s.,\-/]+/).filter(t => t.length >= 2);
  }

  _phoneticKey(token) {
    let key = token.toLowerCase().trim();
    for (const [frm, to] of Object.entries(IndexedSearchEngine.PHONETIC_MAP)) {
      key = key.replaceAll(frm, to);
    }
    key = key.replace(/[aeiou]+$/, '');
    return key;
  }

  _phoneticDistance(a, b) {
    if (a === b) return 0;
    if (a.length !== b.length) return Math.abs(a.length - b.length);
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diff++;
      if (diff > 1) return diff;
    }
    return diff;
  }

  _editDist1(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diff++;
      if (diff > 1) return false;
    }
    return diff === 1;
  }

  _getVoterTokens(voter) {
    if (Array.isArray(voter.vt) && voter.vt.length > 0) {
      return voter.vt.map(t => t.toLowerCase());
    }
    if (voter.vn) return voter.vn.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    return [];
  }

  _getRelativeTokens(voter) {
    if (Array.isArray(voter.rnt) && voter.rnt.length > 0) {
      return voter.rnt.map(t => t.toLowerCase());
    }
    if (voter.rn) return voter.rn.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    return [];
  }

  async _fetchWithTimeout(url, signal) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this._fetchTimeoutMs);

    const combinedSignal = signal
      ? this._combineSignals(signal, controller.signal)
      : controller.signal;

    try {
      return await fetch(url, { signal: combinedSignal });
    } finally {
      clearTimeout(timeout);
    }
  }

  _combineSignals(signal1, signal2) {
    if (signal1.aborted || signal2.aborted) {
      const c = new AbortController();
      c.abort();
      return c.signal;
    }
    const combined = new AbortController();
    signal1.addEventListener('abort', () => combined.abort(), { once: true });
    signal2.addEventListener('abort', () => combined.abort(), { once: true });
    return combined.signal;
  }
}

// Static phonetic map
IndexedSearchEngine.PHONETIC_MAP = {
  'th': 't', 'dh': 'd', 'bh': 'b', 'kh': 'k', 'gh': 'g',
  'ph': 'f', 'sh': 's', 'ch': 'c',
  'ee': 'i', 'oo': 'u', 'aa': 'a', 'ou': 'u',
  'ai': 'e', 'ei': 'e', 'au': 'o',
  'pp': 'p', 'tt': 't', 'kk': 'k', 'mm': 'm',
  'nn': 'n', 'll': 'l', 'ss': 's', 'dd': 'd',
};

// Export for both browser and worker contexts
if (typeof self !== 'undefined' && typeof self.importScripts === 'function') {
  self.IndexedSearchEngine = IndexedSearchEngine;
} else if (typeof window !== 'undefined') {
  window.IndexedSearchEngine = IndexedSearchEngine;
}
