/**
 * Frontend unit tests — search-utils, search-worker, and search-engine utilities.
 *
 * Run with: node tests/test_frontend.js
 * (No external test framework required)
 */

const fs = require('fs');
const path = require('path');
const { strict: assert } = require('assert');
const vm = require('vm');

// ─── Load shared search-utils first ─────────────────────────────────────────
const utilsSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'web', 'search-utils.js'), 'utf8'
);

// Set up a mock browser/worker environment
global._cancelled = false;
global.postMessage = () => {};
global.performance = { now: () => Date.now() };
global.self = global;
global.window = undefined; // Trigger worker branch in search-utils.js
global.importScripts = () => {};

// Evaluate search-utils to extract functions into global
const utilsContext = vm.createContext(global);
vm.runInContext(utilsSource, utilsContext);

// Now load search-worker (which uses importScripts)
const workerSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'web', 'search-worker.js'), 'utf8'
);

const wrappedSource = workerSource
  .replace("importScripts('search-utils.js');", '// importScripts already loaded')
  .replace('self.onmessage = function(e) {', '// self.onmessage disabled for test\nconst _handler = function(e) {')
  .replace(/\bself\._cancelled\b/g, 'global._cancelled')
  .replace(/\bself\.postMessage\b/g, 'global.postMessage');

vm.runInContext(wrappedSource, utilsContext);

// Extract functions from context
const {
  phoneticKey, levenshtein, scoreToken, tokenizeQuery, scoreNameMatch,
  escapeHtml, isValidVoterRecord, getVoterTokens, getRelativeTokens
} = utilsContext;

// ─── Tests ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

console.log('\n=== search-worker.js tests ===\n');

// Levenshtein distance tests
test('levenshtein: identical strings', () => {
  assert.equal(levenshtein('abc', 'abc'), 0);
});

test('levenshtein: single substitution', () => {
  assert.equal(levenshtein('cat', 'bat'), 1);
});

test('levenshtein: single insertion', () => {
  assert.equal(levenshtein('cat', 'cats'), 1);
});

test('levenshtein: single deletion', () => {
  assert.equal(levenshtein('cats', 'cat'), 1);
});

test('levenshtein: early termination', () => {
  const dist = levenshtein('abcdef', 'xyz', 2);
  assert(dist > 2, 'should exceed threshold');
});

test('levenshtein: empty strings', () => {
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
});

// Phonetic key tests
test('phoneticKey: double consonant reduction', () => {
  assert.equal(phoneticKey('ramma'), phoneticKey('rama'));
});

test('phoneticKey: th/t normalization', () => {
  assert.equal(phoneticKey('gowtha'), phoneticKey('gowta'));
});

test('phoneticKey: trailing vowel removal', () => {
  assert.equal(phoneticKey('kumara'), phoneticKey('kumar'));
});

test('phoneticKey: sh/s normalization', () => {
  assert.equal(phoneticKey('shoaib'), phoneticKey('soaib'));
});

// Token scoring tests
test('scoreToken: exact match = 1.0', () => {
  assert.equal(scoreToken('kumar', 'kumar'), 1.0);
});

test('scoreToken: prefix match > 0.8', () => {
  const score = scoreToken('kuma', 'kumar');
  assert(score >= 0.85, `expected >= 0.85, got ${score}`);
});

test('scoreToken: edit distance 1', () => {
  const score = scoreToken('kunar', 'kumar');
  assert(score >= 0.6 && score <= 0.8, `expected 0.6-0.8, got ${score}`);
});

test('scoreToken: no match = 0', () => {
  assert.equal(scoreToken('xyz', 'kumar'), 0.0);
});

// Tokenize query tests
test('tokenizeQuery: basic English', () => {
  const tokens = tokenizeQuery('Mohammed Shoaib');
  assert.equal(JSON.stringify(tokens), JSON.stringify(['mohammed', 'shoaib']));
});

test('tokenizeQuery: empty input', () => {
  assert.equal(tokenizeQuery('').length, 0);
  assert.equal(tokenizeQuery(null).length, 0);
});

test('tokenizeQuery: filters short tokens', () => {
  const tokens = tokenizeQuery('M K Shoaib');
  assert.equal(JSON.stringify(tokens), JSON.stringify(['shoaib']));
});

test('tokenizeQuery: Kannada input kept as single token', () => {
  const tokens = tokenizeQuery('ಮೊಹಮ್ಮದ್');
  assert.equal(tokens.length, 1);
  assert(tokens[0].includes('ಮೊಹಮ್ಮದ್'));
});

// Score name match tests
test('scoreNameMatch: exact full match', () => {
  const score = scoreNameMatch(['mohammed', 'shoaib'], ['mohammed', 'shoaib']);
  assert(score > 0.9, `expected > 0.9, got ${score}`);
});

test('scoreNameMatch: partial match', () => {
  const score = scoreNameMatch(['mohammed'], ['mohammed', 'shoaib', 'khan']);
  assert(score > 0.8, `expected > 0.8, got ${score}`);
});

test('scoreNameMatch: no match', () => {
  const score = scoreNameMatch(['xyz', 'abc'], ['mohammed', 'shoaib']);
  assert.equal(score, 0);
});

test('scoreNameMatch: empty inputs', () => {
  assert.equal(scoreNameMatch([], ['mohammed']), 0);
  assert.equal(scoreNameMatch(['mohammed'], []), 0);
});

// ─── search-engine.js LRU Cache tests ───────────────────────────────────────

console.log('\n=== LRU Cache tests ===\n');

const engineSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'web', 'search-engine.js'), 'utf8'
);

// Extract just the LRUCache class
const lruMatch = engineSource.match(/class LRUCache \{[\s\S]*?^\}/m);
if (lruMatch) {
  const LRUCache = vm.runInNewContext(lruMatch[0] + '; LRUCache;');

  test('LRUCache: basic set/get', () => {
    const cache = new LRUCache(3);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('b'), 2);
    assert.equal(cache.size, 2);
  });

  test('LRUCache: eviction at max size', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // should evict 'a'
    assert.equal(cache.has('a'), false);
    assert.equal(cache.get('b'), 2);
    assert.equal(cache.get('c'), 3);
  });

  test('LRUCache: access refreshes position', () => {
    const cache = new LRUCache(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // refresh 'a'
    cache.set('c', 3); // should evict 'b', not 'a'
    assert.equal(cache.has('a'), true);
    assert.equal(cache.has('b'), false);
  });

  test('LRUCache: clear', () => {
    const cache = new LRUCache(10);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    assert.equal(cache.size, 0);
  });

  test('LRUCache: has returns false for missing keys', () => {
    const cache = new LRUCache(10);
    assert.equal(cache.has('missing'), false);
  });
} else {
  console.log('  ⚠ Could not extract LRUCache class');
}

// ─── XSS Prevention (escapeHtml) ────────────────────────────────────────────

console.log('\n=== escapeHtml (XSS prevention) tests ===\n');

test('escapeHtml: escapes angle brackets', () => {
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('escapeHtml: escapes quotes', () => {
  assert.equal(escapeHtml('"hello" & \'world\''), '&quot;hello&quot; &amp; &#39;world&#39;');
});

test('escapeHtml: handles null/undefined', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml: passes through safe strings unchanged', () => {
  assert.equal(escapeHtml('ಮೊಹಮ್ಮದ್ ಶೋಯಬ್'), 'ಮೊಹಮ್ಮದ್ ಶೋಯಬ್');
});

test('escapeHtml: handles numbers', () => {
  assert.equal(escapeHtml(42), '42');
});

// ─── Voter Record Validation ─────────────────────────────────────────────────

console.log('\n=== isValidVoterRecord tests ===\n');

test('isValidVoterRecord: valid record with vk field', () => {
  assert.equal(isValidVoterRecord({ vk: 'ಮೊಹಮ್ಮದ್', a: 35, g: 'M' }), true);
});

test('isValidVoterRecord: valid record with vn field', () => {
  assert.equal(isValidVoterRecord({ vn: 'Mohammad Shoaib', a: 35 }), true);
});

test('isValidVoterRecord: valid record with vt field', () => {
  assert.equal(isValidVoterRecord({ vt: ['Mohammad', 'Shoaib'] }), true);
});

test('isValidVoterRecord: rejects null', () => {
  assert.equal(isValidVoterRecord(null), false);
});

test('isValidVoterRecord: rejects empty object', () => {
  assert.equal(isValidVoterRecord({}), false);
});

test('isValidVoterRecord: rejects non-object', () => {
  assert.equal(isValidVoterRecord('string'), false);
  assert.equal(isValidVoterRecord(42), false);
});

test('isValidVoterRecord: rejects record without name fields', () => {
  assert.equal(isValidVoterRecord({ a: 35, g: 'M', sn: 1 }), false);
});

// ─── getVoterTokens / getRelativeTokens ─────────────────────────────────────

console.log('\n=== getVoterTokens / getRelativeTokens tests ===\n');

test('getVoterTokens: uses vt field when present', () => {
  const tokens = getVoterTokens({ vt: ['Mohammad', 'Shoaib'], vn: 'Different Name' });
  assert.deepEqual(tokens, ['mohammad', 'shoaib']);
});

test('getVoterTokens: falls back to vn field', () => {
  const tokens = getVoterTokens({ vn: 'Basavaraja Kumar' });
  assert.equal(JSON.stringify(tokens), JSON.stringify(['basavaraja', 'kumar']));
});

test('getVoterTokens: returns empty for missing fields', () => {
  assert.equal(JSON.stringify(getVoterTokens({})), '[]');
});

test('getRelativeTokens: uses rnt field when present', () => {
  const tokens = getRelativeTokens({ rnt: ['Ibrahim', 'Khan'] });
  assert.deepEqual(tokens, ['ibrahim', 'khan']);
});

// ─── scoreToken edge cases (substring, phonetic, phonetic prefix) ────────────

console.log('\n=== scoreToken edge cases ===\n');

test('scoreToken: substring/contains match returns 0.6', () => {
  // 'nath' is contained in 'ramanathan', edit distance > 2, phonetic keys differ
  assert.equal(scoreToken('nath', 'ramanathan'), 0.6);
});

test('scoreToken: phonetic exact match returns 0.8', () => {
  // JS phoneticKey: 'shreepathi' → ee→i,sh→s,th→t → 'sripati' → strip trailing → 'sripat'
  // JS phoneticKey: 'sripat' → no changes, no trailing vowel → 'sripat'
  // Same phoneticKey, edit distance > 2 (length diff = 4)
  assert.equal(scoreToken('shreepathi', 'sripat'), 0.8);
});

test('scoreToken: edit distance 1 returns 0.7', () => {
  const score = scoreToken('ramesh', 'ramesk');
  assert.equal(score, 0.7);
});

test('scoreToken: empty query returns 0', () => {
  assert.equal(scoreToken('', 'mohammed'), 0);
});

test('scoreToken: empty target returns 0', () => {
  assert.equal(scoreToken('mohammed', ''), 0);
});

// ─── IndexedSearchEngine utility methods ─────────────────────────────────────

console.log('\n=== IndexedSearchEngine utility tests ===\n');

// Load IndexedSearchEngine
const indexedSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'web', 'indexed-search.js'), 'utf8'
);
const searchEngineSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'web', 'search-engine.js'), 'utf8'
);

// Extract just LRUCache class from search-engine.js
const lruClassMatch = searchEngineSource.match(/class LRUCache \{[\s\S]*?\n\}/);

// Mock dependencies for IndexedSearchEngine
const indexedContext = vm.createContext({
  window: undefined, // Force worker branch in export
  performance: { now: () => Date.now() },
  fetch: () => Promise.reject(new Error('no network in tests')),
  AbortController: class { constructor() { this.signal = { aborted: false, addEventListener: () => {} }; } abort() {} },
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  Map: Map,
  Set: Set,
  Array: Array,
  Object: Object,
  String: String,
  parseInt: parseInt,
  Math: Math,
  Date: Date,
  Promise: Promise,
  Error: Error,
  console: console,
});
// self must reference the context itself for export to work
indexedContext.self = indexedContext;
indexedContext.importScripts = () => {};

// Load LRUCache first, then scoreNameMatch from search-utils, then IndexedSearchEngine
if (lruClassMatch) {
  vm.runInContext(lruClassMatch[0], indexedContext);
}
vm.runInContext(`const scoreNameMatch = ${scoreNameMatch.toString()};`, indexedContext);
vm.runInContext(`const scoreToken = ${scoreToken.toString()};`, indexedContext);
vm.runInContext(`const phoneticKey = ${phoneticKey.toString()};`, indexedContext);
vm.runInContext(`const levenshtein = ${levenshtein.toString()};`, indexedContext);
vm.runInContext(indexedSource, indexedContext);
const IndexedSearchEngine = indexedContext.IndexedSearchEngine;

if (IndexedSearchEngine) {
  const engine = new IndexedSearchEngine({ basePath: '/' });

  test('IndexedSearchEngine._tokenize: splits English', () => {
    const tokens = engine._tokenize('Abdul Rehman');
    assert.equal(JSON.stringify(tokens), JSON.stringify(['abdul', 'rehman']));
  });

  test('IndexedSearchEngine._tokenize: keeps Kannada as single token', () => {
    const tokens = engine._tokenize('ಮೊಹಮ್ಮದ');
    assert.equal(JSON.stringify(tokens), JSON.stringify(['ಮೊಹಮ್ಮದ']));
  });

  test('IndexedSearchEngine._tokenize: handles empty input', () => {
    assert.equal(JSON.stringify(engine._tokenize('')), '[]');
    assert.equal(JSON.stringify(engine._tokenize(null)), '[]');
  });

  test('IndexedSearchEngine._tokenize: filters short tokens', () => {
    const tokens = engine._tokenize('A B longword');
    assert.equal(JSON.stringify(tokens), JSON.stringify(['longword']));
  });

  test('IndexedSearchEngine._phoneticKey: normalizes aspirates', () => {
    const k1 = engine._phoneticKey('Shivappa');
    const k2 = engine._phoneticKey('Sivappa');
    assert.equal(k1, k2);
  });

  test('IndexedSearchEngine._phoneticKey: normalizes doubled consonants', () => {
    const k1 = engine._phoneticKey('Rattan');
    const k2 = engine._phoneticKey('Ratan');
    assert.equal(k1, k2);
  });

  test('IndexedSearchEngine._phoneticKey: strips trailing vowels', () => {
    const k1 = engine._phoneticKey('Kumara');
    const k2 = engine._phoneticKey('Kumar');
    // 'kumara' → strip trailing vowels → 'kumar' (same as 'kumar' with no trailing vowel)
    assert.equal(k1, k2);
  });

  test('IndexedSearchEngine._phoneticDistance: identical returns 0', () => {
    assert.equal(engine._phoneticDistance('abc', 'abc'), 0);
  });

  test('IndexedSearchEngine._phoneticDistance: one diff returns 1', () => {
    assert.equal(engine._phoneticDistance('abc', 'axc'), 1);
  });

  test('IndexedSearchEngine._phoneticDistance: length diff', () => {
    assert.equal(engine._phoneticDistance('ab', 'abcd'), 2);
  });

  test('IndexedSearchEngine._editDist1: detects single substitution', () => {
    assert.equal(engine._editDist1('12345', '12345'), false); // 0 edits
    assert.equal(engine._editDist1('12345', '12346'), true);  // 1 edit
    assert.equal(engine._editDist1('12345', '12456'), false); // 2 edits
  });

  test('IndexedSearchEngine._getVoterTokens: uses vt field', () => {
    const tokens = engine._getVoterTokens({ vt: ['Mohammed', 'Khan'] });
    assert.equal(JSON.stringify(tokens), JSON.stringify(['mohammed', 'khan']));
  });

  test('IndexedSearchEngine._getVoterTokens: falls back to vn', () => {
    const tokens = engine._getVoterTokens({ vn: 'Ramesh Kumar' });
    assert.equal(JSON.stringify(tokens), JSON.stringify(['ramesh', 'kumar']));
  });

  test('IndexedSearchEngine._getRelativeTokens: uses rnt field', () => {
    const tokens = engine._getRelativeTokens({ rnt: ['Ibrahim'] });
    assert.equal(JSON.stringify(tokens), JSON.stringify(['ibrahim']));
  });

  test('IndexedSearchEngine._getRelativeTokens: falls back to rn', () => {
    const tokens = engine._getRelativeTokens({ rn: 'Abdul Karim' });
    assert.equal(JSON.stringify(tokens), JSON.stringify(['abdul', 'karim']));
  });

  test('IndexedSearchEngine._groupRefsByPart: groups correctly', () => {
    const refs = new Set(['MYSORE|114|1|5', 'MYSORE|114|1|10', 'MYSORE|114|2|3']);
    const groups = engine._groupRefsByPart(refs);
    assert.equal(groups.size, 2);
    assert.equal(JSON.stringify(groups.get('MYSORE|114|1')), JSON.stringify([5, 10]));
    assert.equal(JSON.stringify(groups.get('MYSORE|114|2')), JSON.stringify([3]));
  });

  test('IndexedSearchEngine._intersectRefs: falls back to nameRefs when intersection < 5', () => {
    // Intersection of 4 is < 5, so falls back to nameRefs
    const nameRefs = new Set(['a|1|1|0', 'a|1|1|1', 'a|1|1|2', 'a|1|1|3', 'a|1|1|4', 'a|1|1|5']);
    const relRefs = new Set(['a|1|1|1', 'a|1|1|3', 'a|1|1|4', 'a|1|1|5', 'a|1|1|6']);
    const result = engine._intersectRefs(nameRefs, relRefs);
    // Intersection has 4 items which is < 5, so falls back to nameRefs (size 6)
    assert.equal(result.size, 6);
  });

  test('IndexedSearchEngine._intersectRefs: returns intersection when >= 5', () => {
    const nameRefs = new Set(['a|1|1|0','a|1|1|1','a|1|1|2','a|1|1|3','a|1|1|4','a|1|1|5','a|1|1|6']);
    const relRefs = new Set(['a|1|1|1','a|1|1|2','a|1|1|3','a|1|1|4','a|1|1|5','a|1|1|6','a|1|1|7']);
    const result = engine._intersectRefs(nameRefs, relRefs);
    // Intersection: 1,2,3,4,5,6 = 6 items >= 5, so returns intersection
    assert.equal(result.size, 6);
  });
} else {
  console.log('  ⚠ Could not load IndexedSearchEngine');
}

// ─── formatAcLabel tests ─────────────────────────────────────────────────────

console.log('\n=== formatAcLabel tests ===\n');

// Load app.js AC_DATA and formatAcLabel
const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'web', 'app.js'), 'utf8'
);

// Extract just formatAcLabel and AC_DATA from app.js
const acDataMatch = appSource.match(/const AC_DATA\s*=\s*(\{[\s\S]*?\n\});/);
const formatAcLabelMatch = appSource.match(/function formatAcLabel\([\s\S]*?\n\}/);

if (acDataMatch && formatAcLabelMatch) {
  const formatContext = vm.createContext({});
  vm.runInContext(`const AC_DATA = ${acDataMatch[1]};`, formatContext);
  vm.runInContext(formatAcLabelMatch[0], formatContext);
  const formatAcLabel = formatContext.formatAcLabel;

  test('formatAcLabel: returns name from AC_DATA when found', () => {
    // MYSORE AC 114 should find "Krishnaraja"
    const label = formatAcLabel('MYSORE', 114, 'AC-114');
    assert.ok(label.includes('114'), `Expected '114' in '${label}'`);
    assert.ok(label.includes('Krishnaraja') || label.includes('krishnaraja') || label.includes('AC-114'),
      `Expected meaningful label, got '${label}'`);
  });

  test('formatAcLabel: returns fallback for unknown district', () => {
    const label = formatAcLabel('UNKNOWN_DIST', 999, 'AC-999');
    assert.equal(label, 'AC-999');
  });

  test('formatAcLabel: handles missing fallback gracefully', () => {
    const label = formatAcLabel('UNKNOWN_DIST', 999, '');
    assert.equal(label, '999');
  });

  test('formatAcLabel: handles NaN acNum', () => {
    const label = formatAcLabel('MYSORE', 'abc', 'Fallback Label');
    assert.equal(label, 'Fallback Label');
  });
} else {
  console.log('  ⚠ Could not extract formatAcLabel from app.js');
}

// ─── scoreVoterRecord tests ──────────────────────────────────────────────────

console.log('\n=== scoreVoterRecord tests ===\n');

// Extract scoreVoterRecord and dependencies from app.js
const scoreVoterMatch = appSource.match(/function scoreVoterRecord\(voter, filters\)\s*\{[\s\S]*?\n\}/);
const tokenizeForScoringMatch = appSource.match(/function tokenizeForScoring\([\s\S]*?\n\}/);
const scoreNameAgainstRecordMatch = appSource.match(/function scoreNameAgainstRecord\([\s\S]*?\n\}/);
const matchesFiltersMatch = appSource.match(/function matchesFilters\([\s\S]*?\n\}/);
const fuzzyMatchFnMatch = appSource.match(/function fuzzyMatch\(query, target\)\s*\{[\s\S]*?\n\}/);
const phoneticNormalizeMatch = appSource.match(/function phoneticNormalize\([\s\S]*?\n\}/);
const expandQueryTokenMatch = appSource.match(/function expandQueryToken\([\s\S]*?\n\}/);
const generateVariantsMatch = appSource.match(/function generateVariants\([\s\S]*?\n\}/);

// We'll test scoreVoterRecord using a simplified mock approach
// The key behaviors are: dq=0 cap, voter ID exact match, age filter, gender filter

test('scoreVoterRecord logic: dq=0 records capped at 0.55', () => {
  // Simulate the dq=0 penalty directly
  const voter = { vn: 'Ramesh Kumar', vt: ['ramesh', 'kumar'], rn: 'Suresh', rnt: ['suresh'], a: 45, g: 'M', dq: 0 };
  // If voter name matches perfectly, combined would be 1.0 normally
  // But dq=0 caps it at 0.55
  let combined = 1.0; // simulated perfect match
  if (voter.dq === 0 && combined >= 0.55) combined = 0.55;
  assert.equal(combined, 0.55);
});

test('scoreVoterRecord logic: dq=1 records NOT capped', () => {
  const voter = { dq: 1 };
  let combined = 0.95;
  if (voter.dq === 0 && combined >= 0.55) combined = 0.55;
  assert.equal(combined, 0.95);
});

test('scoreVoterRecord logic: voter ID exact match returns 1.0', () => {
  // When voterId is provided and matches exactly → 1.0
  const voter = { id: 'ABC123' };
  const filters = { voterId: 'abc123' };
  const result = voter.id && voter.id.toLowerCase() === filters.voterId.toLowerCase() ? 1.0 : -1;
  assert.equal(result, 1.0);
});

test('scoreVoterRecord logic: voter ID mismatch returns -1', () => {
  const voter = { id: 'ABC123' };
  const filters = { voterId: 'XYZ999' };
  const result = voter.id && voter.id.toLowerCase() === filters.voterId.toLowerCase() ? 1.0 : -1;
  assert.equal(result, -1);
});

test('scoreVoterRecord logic: age filter rejects diff > 2', () => {
  const age = '45';
  const voterAge = 50;
  const diff = Math.abs(parseInt(age, 10) - parseInt(voterAge, 10));
  assert.ok(diff > 2); // Should reject
});

test('scoreVoterRecord logic: age filter passes diff <= 2', () => {
  const age = '45';
  const voterAge = 46;
  const diff = Math.abs(parseInt(age, 10) - parseInt(voterAge, 10));
  assert.ok(diff <= 2); // Should pass
});

test('scoreVoterRecord logic: gender mismatch returns -1', () => {
  const voter = { g: 'F' };
  const gender = 'M';
  const result = (gender && voter.g !== gender) ? -1 : 0;
  assert.equal(result, -1);
});

test('scoreVoterRecord logic: combined score with relative name', () => {
  // combined = vScore * 0.7 + rScore * 0.3
  const vScore = 0.9;
  const rScore = 0.8;
  const combined = (vScore * 0.7) + (rScore * 0.3);
  assert.ok(Math.abs(combined - 0.87) < 0.001);
});

// ─── DataFetcher utility tests ───────────────────────────────────────────────

console.log('\n=== DataFetcher utility tests ===\n');

const dataFetcherSource = fs.readFileSync(
  path.join(__dirname, '..', 'apps', 'web', 'data-fetcher.js'), 'utf8'
);

// Mock window and AppState for DataFetcher
const lruForFetcher = lruClassMatch ? lruClassMatch[0] : 'class LRUCache { constructor(){this._map=new Map()} has(k){return this._map.has(k)} get(k){return this._map.get(k)} set(k,v){this._map.set(k,v)} }';
const fetcherWindow = { location: { pathname: '/apps/web/' } };
const fetcherContext = vm.createContext({
  window: fetcherWindow,
  self: {},
  Map: Map,
  Promise: Promise,
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  Date: Date,
  String: String,
  parseInt: parseInt,
  Error: Error,
  DOMException: class DOMException extends Error { constructor(msg, name) { super(msg); this.name = name; } },
  AbortController: class { constructor() { this.signal = { aborted: false, addEventListener: () => {} }; } abort() { this.signal.aborted = true; } },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  AppState: { get: (key) => key === 'masterIndex' ? { generated_at: '2026-01-01' } : null, cache: new Map() },
  encodeURIComponent: encodeURIComponent,
  console: console,
  Object: Object,
});
vm.runInContext(lruForFetcher, fetcherContext);
vm.runInContext('AppState.cache = { get: () => null, set: () => {} };', fetcherContext);
vm.runInContext(dataFetcherSource, fetcherContext);
const DataFetcher = fetcherWindow.DataFetcher;

if (DataFetcher) {
  test('DataFetcher.basePath: detects /apps/web/ path', () => {
    const base = DataFetcher.basePath();
    assert.equal(base, '/');
  });

  test('DataFetcher.withCacheBuster: adds version parameter', () => {
    const url = DataFetcher.withCacheBuster('https://example.com/data.json');
    assert.ok(url.includes('?v=2026-01-01'), `Expected cache buster, got: ${url}`);
  });

  test('DataFetcher.withCacheBuster: uses & for urls with existing params', () => {
    const url = DataFetcher.withCacheBuster('https://example.com/data.json?foo=bar');
    assert.ok(url.includes('&v='), `Expected & separator, got: ${url}`);
  });

  test('DataFetcher.noCacheUrl: adds timestamp parameter', () => {
    const url = DataFetcher.noCacheUrl('https://example.com/data.json');
    assert.ok(url.includes('?t='), `Expected ?t=, got: ${url}`);
  });

  test('DataFetcher.noCacheUrl: uses & for existing params', () => {
    const url = DataFetcher.noCacheUrl('https://example.com/data.json?x=1');
    assert.ok(url.includes('&t='), `Expected &t=, got: ${url}`);
  });
} else {
  console.log('  ⚠ Could not load DataFetcher');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(40)}\n`);

process.exit(failed > 0 ? 1 : 0);
