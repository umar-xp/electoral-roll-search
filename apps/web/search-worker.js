/**
 * Karnataka Electoral Roll Search Engine — Client-Side Search Worker
 * ==================================================================
 * High-performance Web Worker for searching voter records across
 * all loaded part data. Runs off the main thread to keep the UI
 * responsive during large searches (7M+ records).
 *
 * Communication Protocol (postMessage):
 *   Main -> Worker:
 *     { type: "search", query: {...}, voters: [...], batchId: "..." }
 *     { type: "cancel" }
 *   Worker -> Main:
 *     { type: "progress", batchId, searched: N, total: T, found: F }
 *     { type: "results", batchId, results: [...], totalFound, totalSearched, time_ms }
 *     { type: "error", batchId, message: "..." }
 *     { type: "cancelled", batchId }
 */

// Import shared utilities (phonetic, levenshtein, scoring, validation)
importScripts('search-utils.js');

// ========== VOTER SCORING ==========

/**
 * Score a complete voter record against a search query.
 *
 * @param {Object} voter - Voter record object
 * @param {Object} query - Search query with fields
 * @returns {number} Score 0-1, or -1 if definitely not a match
 */
function scoreVoter(voter, query) {
  // Validate record before scoring
  if (!isValidVoterRecord(voter)) return -1;

  // Hard filters first (fast rejection)
  if (query.gender && voter.g !== query.gender) return -1;
  if (query.relType && voter.rt !== query.relType) return -1;
  if (query.age) {
    const ageDiff = Math.abs(parseInt(query.age) - (voter.a || 0));
    if (ageDiff > 2) return -1;
  }
  if (query.voterId) {
    if (!voter.id) return -1;
    const qid = query.voterId.toLowerCase();
    const vid = voter.id.toLowerCase();
    if (qid === vid) return 1.0;
    // Fuzzy: allow 1 character substitution (handles OCR digit errors)
    if (qid.length === vid.length && levenshtein(qid, vid, 1) <= 1) return 0.85;
    // Prefix match: user may type partial ID
    if (qid.length >= 4 && vid.startsWith(qid)) return 0.7;
    if (qid.length >= 4 && qid.startsWith(vid)) return 0.7;
    return -1;
  }

  // Name scoring
  let nameScore = 0;
  if (query.voterNameTokens && query.voterNameTokens.length > 0) {
    const voterTokens = getVoterTokens(voter);
    nameScore = scoreNameMatch(query.voterNameTokens, voterTokens);
    if (nameScore <= 0) return -1;
  }

  // Relative name scoring
  let relScore = 1.0;
  if (query.relNameTokens && query.relNameTokens.length > 0) {
    const relTokens = getRelativeTokens(voter);
    relScore = scoreNameMatch(query.relNameTokens, relTokens);
    if (relScore <= 0) {
      // Fallback: check Kannada name substring
      if (query.relName && voter.rk && voter.rk.replace(/[\u200C\u200D]/g, '').includes(query.relName.replace(/[\u200C\u200D]/g, ''))) {
        relScore = 0.6;
      } else {
        return -1;
      }
    }
  }

  // Weighted combination
  const hasRelQuery = query.relNameTokens && query.relNameTokens.length > 0;
  const combined = hasRelQuery
    ? (nameScore * 0.65) + (relScore * 0.35)
    : nameScore;

  return combined;
}

// ========== WEB WORKER MESSAGE HANDLER ==========

self.onmessage = function(e) {
  const msg = e.data;

  if (msg.type === 'search') {
    try {
      performSearch(msg.query, msg.voters, msg.batchId);
    } catch (err) {
      self.postMessage({
        type: 'error',
        batchId: msg.batchId,
        message: err.message || 'Unknown search error',
      });
    }
  } else if (msg.type === 'cancel') {
    self._cancelled = true;
  }
};

/**
 * Perform search across voter array and post results back.
 *
 * @param {Object} query - Parsed search query
 * @param {Array} voters - Array of voter records to search
 * @param {string} batchId - Unique ID for this search batch
 */
function performSearch(query, voters, batchId) {
  self._cancelled = false;
  const startTime = performance.now();

  // Input validation
  if (!Array.isArray(voters)) {
    self.postMessage({
      type: 'error',
      batchId,
      message: 'Invalid voters array',
    });
    return;
  }

  // Tokenize query
  const voterNameTokens = tokenizeQuery(query.voterName);
  const relNameTokens = tokenizeQuery(query.relName);

  const parsedQuery = {
    ...query,
    voterNameTokens,
    relNameTokens,
  };

  const results = [];
  const BATCH_SIZE = 10000;
  const total = voters.length;

  for (let i = 0; i < total; i++) {
    if (self._cancelled) {
      self.postMessage({ type: 'cancelled', batchId });
      return;
    }

    const score = scoreVoter(voters[i], parsedQuery);
    if (score > 0) {
      results.push({ ...voters[i], _score: score });
    }

    // Post progress every BATCH_SIZE records
    if ((i + 1) % BATCH_SIZE === 0) {
      self.postMessage({
        type: 'progress',
        batchId,
        searched: i + 1,
        total,
        found: results.length,
      });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b._score - a._score);

  const elapsed = performance.now() - startTime;

  self.postMessage({
    type: 'results',
    batchId,
    results: results.slice(0, 200),
    totalFound: results.length,
    totalSearched: total,
    time_ms: Math.round(elapsed),
  });
}
