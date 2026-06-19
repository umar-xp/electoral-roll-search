/**
 * Shared Search Utilities — phonetic matching, edit distance, and sanitization.
 * =============================================================================
 * Single source of truth for algorithms used by both search-engine.js and
 * search-worker.js. Eliminates DRY violations and ensures consistent behavior.
 *
 * This file is loaded as a module in browser context (search-engine.js) and
 * imported via importScripts() in the Web Worker (search-worker.js).
 */

// ========== HTML SANITIZATION (XSS Prevention) ==========

/**
 * Escape a string for safe HTML insertion.
 * Prevents XSS from voter records that may contain arbitrary OCR output.
 *
 * @param {string} str - Untrusted string (e.g., voter name from JSON)
 * @returns {string} HTML-safe escaped string
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ========== PHONETIC MAPPING ==========

const PHONETIC_MAP = {
  // Vowel variations
  'ee': 'i', 'oo': 'u', 'aa': 'a', 'ou': 'u',
  'ai': 'e', 'ei': 'e', 'au': 'o',
  // Consonant variations common in Kannada transliteration
  'sh': 's', 'th': 't', 'dh': 'd', 'bh': 'b',
  'kh': 'k', 'gh': 'g', 'ph': 'f', 'ch': 'c',
  // Double consonants
  'pp': 'p', 'tt': 't', 'kk': 'k', 'mm': 'm',
  'nn': 'n', 'll': 'l', 'ss': 's', 'dd': 'd',
  // Common suffix variations in Kannada names
  'appa': 'apa', 'amma': 'ama', 'anna': 'ana',
  'esh': 'es', 'ish': 'is',
};

/**
 * Generate phonetic key for a name token.
 * Reduces a name to its phonetic skeleton by normalizing common
 * transliteration variants.
 *
 * @param {string} token - Normalized name token
 * @returns {string} Phonetic key
 */
function phoneticKey(token) {
  let key = token.toLowerCase();
  for (const [from, to] of Object.entries(PHONETIC_MAP)) {
    key = key.replaceAll(from, to);
  }
  // Remove trailing vowels (they vary most in transliteration)
  key = key.replace(/[aeiou]+$/, '');
  return key;
}

// ========== CONSONANT SKELETON ==========

/**
 * Generate consonant skeleton for a name token.
 * Strips vowels and collapses repeated consonants to catch
 * transliteration variants like umer/ummar/umar.
 *
 * @param {string} token - Lowercase name token
 * @returns {string} Consonant skeleton
 */
function consonantSkeleton(token) {
  return token.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}

// ========== JARO-WINKLER SIMILARITY ==========

/**
 * Jaro similarity between two strings.
 * Designed specifically for short strings like names.
 * Handles transpositions and insertions better than Levenshtein for names.
 *
 * @param {string} s1 - First string
 * @param {string} s2 - Second string
 * @returns {number} Similarity score (0-1)
 */
function jaro(s1, s2) {
  if (s1 === s2) return 1.0;
  const len1 = s1.length, len2 = s2.length;
  if (!len1 || !len2) return 0;

  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1Matches = new Array(len1).fill(false);
  const s2Matches = new Array(len2).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(len2, i + matchDist + 1);
    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (!matches) return 0;

  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  return (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
}

/**
 * Jaro-Winkler similarity — boosts Jaro score for common prefix.
 * Particularly effective for name matching where the first few
 * characters are almost always correct.
 *
 * @param {string} s1 - First string (lowercase)
 * @param {string} s2 - Second string (lowercase)
 * @param {number} p - Prefix scaling factor (default 0.1)
 * @returns {number} Similarity score (0-1)
 */
function jaroWinkler(s1, s2, p = 0.1) {
  const j = jaro(s1, s2);
  let prefix = 0;
  const maxPrefix = Math.min(4, s1.length, s2.length);
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * p * (1 - j);
}

// ========== DOUBLE METAPHONE ==========

/**
 * Double Metaphone phonetic encoding for names.
 * Generates primary and alternate phonetic codes.
 * Tuned for Indian/Muslim/Kannada transliterated names.
 *
 * @param {string} str - Input name token (lowercase, alpha only)
 * @returns {string[]} Array of [primary, alternate] codes
 */
function doubleMetaphone(str) {
  const s = str.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return ['', ''];

  let primary = '';
  let alternate = '';
  let i = 0;
  const len = s.length;

  // Skip silent initial letters
  if (/^(gn|kn|pn|ae|wr)/.test(s)) i = 1;

  const at = (pos) => pos >= 0 && pos < len ? s[pos] : '';
  const slice = (pos, n) => s.substring(pos, pos + n);

  while (i < len && primary.length < 6) {
    const c = s[i];

    switch (c) {
      case 'a': case 'e': case 'i': case 'o': case 'u':
        // Vowels only kept at start
        if (i === 0) { primary += 'A'; alternate += 'A'; }
        i++;
        break;

      case 'b':
        primary += 'P'; alternate += 'P';
        i += (at(i + 1) === 'b') ? 2 : 1;
        break;

      case 'c':
        if (slice(i, 2) === 'ch') {
          primary += 'X'; alternate += 'X';
          i += 2;
        } else if (at(i + 1) === 'e' || at(i + 1) === 'i' || at(i + 1) === 'y') {
          primary += 'S'; alternate += 'S';
          i += 1;
        } else {
          primary += 'K'; alternate += 'K';
          i += (at(i + 1) === 'c' || at(i + 1) === 'k') ? 2 : 1;
        }
        break;

      case 'd':
        if (slice(i, 2) === 'dh') {
          primary += 'T'; alternate += 'T';
          i += 2;
        } else {
          primary += 'T'; alternate += 'T';
          i += (at(i + 1) === 'd') ? 2 : 1;
        }
        break;

      case 'f':
        primary += 'F'; alternate += 'P';  // f/ph/p interchange for Indian names
        i += (at(i + 1) === 'f') ? 2 : 1;
        break;

      case 'g':
        if (slice(i, 2) === 'gh') {
          primary += 'K'; alternate += 'K';
          i += 2;
        } else {
          primary += 'K'; alternate += 'K';
          i += (at(i + 1) === 'g') ? 2 : 1;
        }
        break;

      case 'h':
        // H is silent between vowels or at end
        if ('aeiou'.includes(at(i + 1)) && (i === 0 || !'aeiou'.includes(at(i - 1)))) {
          primary += 'H'; alternate += 'H';
        }
        i++;
        break;

      case 'j':
        primary += 'J'; alternate += 'J';
        i += (at(i + 1) === 'j') ? 2 : 1;
        break;

      case 'k':
        if (slice(i, 2) === 'kh') {
          primary += 'K'; alternate += 'K';
          i += 2;
        } else {
          primary += 'K'; alternate += 'K';
          i += (at(i + 1) === 'k') ? 2 : 1;
        }
        break;

      case 'l':
        primary += 'L'; alternate += 'L';
        i += (at(i + 1) === 'l') ? 2 : 1;
        break;

      case 'm':
        primary += 'M'; alternate += 'M';
        i += (at(i + 1) === 'm') ? 2 : 1;
        break;

      case 'n':
        primary += 'N'; alternate += 'N';
        i += (at(i + 1) === 'n') ? 2 : 1;
        break;

      case 'p':
        if (at(i + 1) === 'h') {
          primary += 'F'; alternate += 'P';  // ph -> F (primary) / P (alternate)
          i += 2;
        } else {
          primary += 'P'; alternate += 'P';
          i += (at(i + 1) === 'p') ? 2 : 1;
        }
        break;

      case 'q':
        primary += 'K'; alternate += 'K';
        i += (at(i + 1) === 'q') ? 2 : 1;
        break;

      case 'r':
        primary += 'R'; alternate += 'R';
        i += (at(i + 1) === 'r') ? 2 : 1;
        break;

      case 's':
        if (slice(i, 2) === 'sh') {
          primary += 'X'; alternate += 'S';  // sh variants
          i += 2;
        } else {
          primary += 'S'; alternate += 'S';
          i += (at(i + 1) === 's') ? 2 : 1;
        }
        break;

      case 't':
        if (slice(i, 2) === 'th') {
          primary += 'T'; alternate += 'T';
          i += 2;
        } else {
          primary += 'T'; alternate += 'T';
          i += (at(i + 1) === 't') ? 2 : 1;
        }
        break;

      case 'v':
        primary += 'F'; alternate += 'V';
        i += (at(i + 1) === 'v') ? 2 : 1;
        break;

      case 'w':
        if ('aeiou'.includes(at(i + 1))) {
          primary += 'V'; alternate += 'V';
        }
        i++;
        break;

      case 'x':
        primary += 'KS'; alternate += 'KS';
        i++;
        break;

      case 'y':
        if ('aeiou'.includes(at(i + 1))) {
          primary += 'Y'; alternate += 'Y';
        }
        i++;
        break;

      case 'z':
        primary += 'J'; alternate += 'S';  // z -> j (Indian) / s (alternate)
        i += (at(i + 1) === 'z') ? 2 : 1;
        break;

      default:
        i++;
    }
  }

  return [primary.substring(0, 6), alternate.substring(0, 6)];
}

// ========== LEVENSHTEIN DISTANCE ==========

/**
 * Calculate Levenshtein edit distance between two strings.
 * Optimized with single-row DP and early termination.
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @param {number} maxDist - Maximum distance before early termination
 * @returns {number} Edit distance (or maxDist+1 if exceeded)
 */
function levenshtein(a, b, maxDist = 3) {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  if (a === b) return 0;

  const m = a.length, n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = i;

    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }

    // Early termination: if minimum in this row exceeds threshold
    if (rowMin > maxDist) return maxDist + 1;

    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

// ========== TOKEN SCORING ==========

/**
 * Score how well a query token matches a voter's token.
 *
 * @param {string} queryToken - Normalized search query token
 * @param {string} voterToken - Normalized voter record token
 * @returns {number} Match score (0-1)
 */
function scoreToken(queryToken, voterToken) {
  if (queryToken === voterToken) return 1.0;

  // Both tokens must be meaningful for fuzzy matching
  if (queryToken.length < 3 || voterToken.length < 3) return 0.0;

  // Prefix match (requires 4+ chars to avoid short false matches)
  if (voterToken.startsWith(queryToken) && queryToken.length >= 4) return 0.9;
  if (queryToken.startsWith(voterToken) && voterToken.length >= 4) return 0.85;

  // Phonetic match
  if (queryToken.length >= 4 && phoneticKey(queryToken) === phoneticKey(voterToken)) return 0.8;

  // Edit distance (only for tokens of similar length, both 5+ chars)
  if (Math.abs(queryToken.length - voterToken.length) <= 2 && Math.min(queryToken.length, voterToken.length) >= 5) {
    const dist = levenshtein(queryToken, voterToken, 2);
    if (dist === 1) return 0.7;
    if (dist === 2) return 0.5;
  }

  // Jaro-Winkler: excellent for name matching (handles insertions/transpositions)
  if (Math.min(queryToken.length, voterToken.length) >= 4) {
    const jw = jaroWinkler(queryToken, voterToken);
    if (jw >= 0.92) return 0.85;
    if (jw >= 0.82) return 0.72;
  }

  // Double Metaphone: phonetic codes that handle transliteration variants
  if (queryToken.length >= 3 && voterToken.length >= 3) {
    const [qPri, qAlt] = doubleMetaphone(queryToken);
    const [vPri, vAlt] = doubleMetaphone(voterToken);
    if (qPri && vPri && (qPri === vPri || qPri === vAlt || qAlt === vPri)) return 0.72;
  }

  // Contains match (requires 4+ chars)
  if (queryToken.length >= 4 && voterToken.length >= 6 && voterToken.includes(queryToken)) return 0.6;

  // Consonant skeleton: strip vowels, collapse doubled consonants
  // Catches transliteration variants like umer/ummar/umar
  const qSkel = consonantSkeleton(queryToken);
  const vSkel = consonantSkeleton(voterToken);
  if (qSkel.length >= 2 && qSkel === vSkel && queryToken[0] === voterToken[0] && Math.min(queryToken.length, voterToken.length) >= 4) return 0.7;

  return 0.0;
}

/**
 * Score how well query tokens match against a set of voter tokens.
 * Uses best-match strategy: each query token finds its best matching
 * voter token.
 *
 * @param {string[]} queryTokens - Normalized query name tokens
 * @param {string[]} voterTokens - Normalized voter record tokens
 * @returns {number} Average best-match score (0-1)
 */
function scoreNameMatch(queryTokens, voterTokens) {
  if (!queryTokens.length || !voterTokens.length) return 0;

  let totalScore = 0;
  let matchedCount = 0;

  for (const qt of queryTokens) {
    let bestScore = 0;
    for (const vt of voterTokens) {
      const s = scoreToken(qt, vt);
      if (s > bestScore) bestScore = s;
      if (s === 1.0) break;
    }
    totalScore += bestScore;
    if (bestScore > 0) matchedCount++;
  }

  if (matchedCount === 0) return 0;

  const avgScore = totalScore / queryTokens.length;
  const coverageBonus = (matchedCount === queryTokens.length) ? 0.1 : 0;

  return Math.min(1.0, avgScore + coverageBonus);
}

// ========== QUERY TOKENIZATION ==========

/**
 * Tokenize a search query string into normalized tokens.
 * Handles both English and Kannada input.
 *
 * @param {string} input - Raw user search input
 * @returns {string[]} Normalized tokens
 */
function tokenizeQuery(input) {
  if (!input || !input.trim()) return [];
  const cleaned = input.replace(/[\u200C\u200D]/g, '').trim().toLowerCase();

  // Check if input is primarily Kannada
  const kannadaChars = (cleaned.match(/[\u0C80-\u0CFF]/g) || []).length;
  if (kannadaChars > cleaned.length * 0.5) {
    return [cleaned];
  }

  // English: split on spaces, filter short tokens
  return cleaned.split(/\s+/)
    .map(t => t.replace(/[^a-z]/g, ''))
    .filter(t => t.length >= 2);
}

// ========== VOTER RECORD HELPERS ==========

/**
 * Extract searchable tokens from voter name fields.
 *
 * @param {Object} voter - Voter record
 * @returns {string[]} Normalized lowercase tokens
 */
function getVoterTokens(voter) {
  if (Array.isArray(voter.vt) && voter.vt.length > 0) {
    return voter.vt.map(t => t.replace(/[\u200C\u200D]/g, '').toLowerCase());
  }
  if (voter.vn) {
    return voter.vn.replace(/[\u200C\u200D]/g, '').toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  }
  return [];
}

/**
 * Extract searchable tokens from relative name fields.
 *
 * @param {Object} voter - Voter record
 * @returns {string[]} Normalized lowercase tokens
 */
function getRelativeTokens(voter) {
  if (Array.isArray(voter.rnt) && voter.rnt.length > 0) {
    return voter.rnt.map(t => t.replace(/[\u200C\u200D]/g, '').toLowerCase());
  }
  if (voter.rn) {
    return voter.rn.replace(/[\u200C\u200D]/g, '').toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  }
  return [];
}

// ========== VOTER RECORD VALIDATION ==========

/**
 * Validate a voter record has the minimum required fields.
 * Returns true if the record is well-formed enough to search.
 *
 * @param {*} voter - Potential voter record
 * @returns {boolean}
 */
function isValidVoterRecord(voter) {
  if (!voter || typeof voter !== 'object') return false;
  // Must have at least a name field (Kannada or English)
  if (!voter.vk && !voter.vn && !(Array.isArray(voter.vt) && voter.vt.length)) return false;
  return true;
}

// ========== EXPORT ==========
// Supports both browser global and Worker importScripts contexts

if (typeof self !== 'undefined' && typeof self.importScripts === 'function') {
  // Web Worker context — attach to self
  self.escapeHtml = escapeHtml;
  self.phoneticKey = phoneticKey;
  self.consonantSkeleton = consonantSkeleton;
  self.jaroWinkler = jaroWinkler;
  self.doubleMetaphone = doubleMetaphone;
  self.levenshtein = levenshtein;
  self.scoreToken = scoreToken;
  self.scoreNameMatch = scoreNameMatch;
  self.tokenizeQuery = tokenizeQuery;
  self.getVoterTokens = getVoterTokens;
  self.getRelativeTokens = getRelativeTokens;
  self.isValidVoterRecord = isValidVoterRecord;
  self.PHONETIC_MAP = PHONETIC_MAP;
} else if (typeof window !== 'undefined') {
  // Browser main thread — attach to window
  window.SearchUtils = {
    escapeHtml,
    phoneticKey,
    consonantSkeleton,
    jaroWinkler,
    doubleMetaphone,
    levenshtein,
    scoreToken,
    scoreNameMatch,
    tokenizeQuery,
    getVoterTokens,
    getRelativeTokens,
    isValidVoterRecord,
    PHONETIC_MAP,
  };
}
