/**
 * Performance Benchmark Script
 * ============================
 * Measures search performance across varying data sizes and query patterns.
 * Run: npm run perf
 */

const { readFileSync, existsSync, readdirSync } = require('fs');
const { join } = require('path');
const { performance } = require('perf_hooks');

const ROOT = join(__dirname, '..');

// ---------- Load search-utils in Node context ----------
const searchUtilsSrc = readFileSync(join(ROOT, 'apps/web/search-utils.js'), 'utf-8');
const sandbox = {};
const wrappedSrc = searchUtilsSrc + `
;module.exports = { escapeHtml, phoneticKey, levenshtein, scoreToken, scoreNameMatch, tokenizeQuery };
`;
const scriptFn = new Function('module', 'exports', 'require', wrappedSrc);
const fakeModule = { exports: {} };
scriptFn(fakeModule, fakeModule.exports, require);
const { phoneticKey, levenshtein, scoreToken, scoreNameMatch, tokenizeQuery } = fakeModule.exports;

// ---------- Test data generators ----------
function generateNames(count) {
  const firstNames = ['RAMESH', 'SURESH', 'MAHESH', 'GANESH', 'RAJESH', 'KUMAR', 'LAXMI', 'MANJUNATH', 'BASAVARAJ', 'SHIVAKUMAR'];
  const lastNames = ['GOWDA', 'NAIK', 'SHETTY', 'PATIL', 'REDDY', 'HEGDE', 'SWAMY', 'RAO', 'MURTHY', 'PRASAD'];
  const names = [];
  for (let i = 0; i < count; i++) {
    names.push(`${firstNames[i % firstNames.length]} ${lastNames[Math.floor(i / firstNames.length) % lastNames.length]}`);
  }
  return names;
}

function generateVoterRecords(count) {
  const names = generateNames(count);
  return names.map((name, i) => ({
    vn: name,
    vk: `ಮಾದರಿ ${i}`,
    vid: `ABC${String(i).padStart(7, '0')}`,
    rn: names[(i + 1) % names.length],
    age: 25 + (i % 50),
    sex: i % 2 === 0 ? 'M' : 'F',
    hn: String(100 + (i % 500)),
  }));
}

// ---------- Benchmark harness ----------
function bench(label, fn, iterations = 1000) {
  // Warmup
  for (let i = 0; i < Math.min(100, iterations); i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  const opsPerSec = Math.round((iterations / elapsed) * 1000);
  const avgMs = (elapsed / iterations).toFixed(4);
  return { label, iterations, totalMs: elapsed.toFixed(2), avgMs, opsPerSec };
}

// ---------- Benchmarks ----------
function runBenchmarks() {
  console.log('='.repeat(70));
  console.log('  ELECTORAL ROLL SEARCH — PERFORMANCE BENCHMARKS');
  console.log('='.repeat(70));
  console.log();

  const results = [];

  // 1. phoneticKey generation
  const testNames = generateNames(100);
  results.push(bench('phoneticKey (single name)', () => {
    phoneticKey('MANJUNATH');
  }, 10000));

  results.push(bench('phoneticKey (batch 100 names)', () => {
    for (const name of testNames) phoneticKey(name);
  }, 1000));

  // 2. Levenshtein distance
  results.push(bench('levenshtein (short strings)', () => {
    levenshtein('KUMAR', 'KUMARA', 3);
  }, 10000));

  results.push(bench('levenshtein (medium strings)', () => {
    levenshtein('MANJUNATH', 'MANJUNATHA', 3);
  }, 10000));

  results.push(bench('levenshtein (long strings, early exit)', () => {
    levenshtein('BASAVARAJESHWARA', 'COMPLETELY_DIFFERENT', 3);
  }, 10000));

  // 3. scoreToken
  results.push(bench('scoreToken (exact match)', () => {
    scoreToken('kumar', 'KUMAR');
  }, 5000));

  results.push(bench('scoreToken (fuzzy match)', () => {
    scoreToken('kumr', 'KUMAR');
  }, 5000));

  results.push(bench('scoreToken (no match)', () => {
    scoreToken('xyz', 'KUMAR');
  }, 5000));

  // 4. scoreNameMatch (multi-token)
  results.push(bench('scoreNameMatch (2 tokens, exact)', () => {
    scoreNameMatch(['ramesh', 'gowda'], ['RAMESH', 'GOWDA']);
  }, 20000));

  results.push(bench('scoreNameMatch (2 tokens, fuzzy)', () => {
    scoreNameMatch(['ramsh', 'gowd'], ['RAMESH', 'GOWDA']);
  }, 20000));

  // 5. tokenizeQuery
  results.push(bench('tokenizeQuery (English)', () => {
    tokenizeQuery('Ramesh Kumar Gowda');
  }, 10000));

  results.push(bench('tokenizeQuery (Kannada)', () => {
    tokenizeQuery('ರಮೇಶ ಕುಮಾರ');
  }, 10000));

  // 6. Simulated full search scoring (scan through records)
  const records1k = generateVoterRecords(1000);
  const records10k = generateVoterRecords(10000);
  const queryTokens = tokenizeQuery('Ramesh Gowda');

  results.push(bench('Full scan + score (1K records)', () => {
    let topScore = 0;
    for (const rec of records1k) {
      const tokens = (rec.vn || '').split(/\s+/);
      const score = scoreNameMatch(queryTokens, tokens);
      if (score > topScore) topScore = score;
    }
  }, 100));

  results.push(bench('Full scan + score (10K records)', () => {
    let topScore = 0;
    for (const rec of records10k) {
      const tokens = (rec.vn || '').split(/\s+/);
      const score = scoreNameMatch(queryTokens, tokens);
      if (score > topScore) topScore = score;
    }
  }, 10));

  // ---------- Print results ----------
  const pad = (s, n) => String(s).padEnd(n);
  const rpad = (s, n) => String(s).padStart(n);
  console.log(`  ${pad('Benchmark', 40)} ${rpad('Avg (ms)', 10)} ${rpad('Ops/sec', 12)} ${rpad('Total (ms)', 12)}`);
  console.log('-'.repeat(78));
  for (const r of results) {
    console.log(`  ${pad(r.label, 40)} ${rpad(r.avgMs, 10)} ${rpad(r.opsPerSec.toLocaleString(), 12)} ${rpad(r.totalMs, 12)}`);
  }
  console.log();

  // ---------- Memory usage ----------
  const mem = process.memoryUsage();
  console.log('  Memory Usage:');
  console.log(`    Heap Used:  ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`    Heap Total: ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`);
  console.log(`    RSS:        ${(mem.rss / 1024 / 1024).toFixed(1)} MB`);
  console.log();

  // ---------- Data loading benchmark ----------
  const masterIndexPath = join(ROOT, 'data/master_index.json');
  if (existsSync(masterIndexPath)) {
    const start = performance.now();
    const data = JSON.parse(readFileSync(masterIndexPath, 'utf-8'));
    const parseTime = performance.now() - start;
    console.log(`  master_index.json parse: ${parseTime.toFixed(2)} ms (${JSON.stringify(data).length} bytes)`);
  }

  // Check a sample part file
  const samplePartDir = join(ROOT, 'data/districts/MYSORE');
  if (existsSync(samplePartDir)) {
    const files = readdirSync(samplePartDir).filter(f => f.endsWith('_index.json'));
    if (files.length > 0) {
      const start = performance.now();
      const data = JSON.parse(readFileSync(join(samplePartDir, files[0]), 'utf-8'));
      const parseTime = performance.now() - start;
      console.log(`  Sample AC index parse (${files[0]}): ${parseTime.toFixed(2)} ms`);
    }
  }

  console.log();
  console.log('='.repeat(70));
  console.log('  BENCHMARK COMPLETE');
  console.log('='.repeat(70));
}

runBenchmarks();
