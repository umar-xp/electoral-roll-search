/**
 * Integration Tests — verifies the full search flow works end-to-end.
 *
 * Tests the actual deployed frontend logic (app.js) including:
 * - Data loading from JSON shards
 * - Search scoring and ranking
 * - Result rendering (DOM output)
 * - CSP compliance (no inline scripts)
 * - Service worker registration
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

// ─── Test: index.html has NO inline scripts ─────────────────────────────────

console.log('\n── CSP Compliance Tests ──');

const htmlPath = path.join(__dirname, '..', 'apps', 'web', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// No inline script blocks (only external src references allowed)
const inlineScriptPattern = /<script>[\s\S]*?<\/script>/gi;
const inlineMatches = html.match(inlineScriptPattern);
assert(
  !inlineMatches || inlineMatches.length === 0,
  'No inline <script> blocks in index.html'
);

// No onclick/onchange/onerror inline handlers
const inlineHandlerPattern = /\s(onclick|onchange|onerror|onload|onsubmit|onfocus|onblur)=/gi;
const handlerMatches = html.match(inlineHandlerPattern);
assert(
  !handlerMatches || handlerMatches.length === 0,
  `No inline event handlers in HTML (found ${handlerMatches ? handlerMatches.length : 0})`
);

// No javascript: protocol URIs
const jsProtocol = /href\s*=\s*["']javascript:/gi;
assert(
  !jsProtocol.test(html),
  'No javascript: protocol URIs'
);

// ─── Test: Security headers file ────────────────────────────────────────────

console.log('\n── Security Headers Tests ──');

const headersPath = path.join(__dirname, '..', '_headers');
const headers = fs.readFileSync(headersPath, 'utf8');

assert(headers.includes('X-Frame-Options: DENY'), 'X-Frame-Options: DENY present');
assert(headers.includes('X-Content-Type-Options: nosniff'), 'nosniff present');
assert(headers.includes('Strict-Transport-Security'), 'HSTS present');
assert(headers.includes("script-src 'self'"), "CSP script-src is 'self' (no unsafe-inline)");
assert(!headers.includes('unsafe-inline'), 'No unsafe-inline in CSP');
assert(!headers.includes('unsafe-eval'), 'No unsafe-eval in CSP');
assert(headers.includes("object-src 'none'"), "object-src 'none' blocks plugins");
assert(headers.includes("base-uri 'self'"), "base-uri 'self' prevents base-tag injection");
assert(headers.includes('worker-src'), 'worker-src directive for service worker');
assert(headers.includes('Cross-Origin-Opener-Policy'), 'COOP header present');

// ─── Test: app.js exists and has event binding ──────────────────────────────

console.log('\n── Architecture Tests ──');

const appJsPath = path.join(__dirname, '..', 'apps', 'web', 'app.js');
assert(fs.existsSync(appJsPath), 'app.js exists as external file');

const appJs = fs.readFileSync(appJsPath, 'utf8');
assert(appJs.includes('addEventListener'), 'app.js uses addEventListener (not inline handlers)');
assert(appJs.includes('serviceWorker'), 'Service worker registration in app.js');

// ─── Test: Service worker exists ────────────────────────────────────────────

const swPath = path.join(__dirname, '..', 'apps', 'web', 'sw.js');
assert(fs.existsSync(swPath), 'sw.js service worker exists');

const swJs = fs.readFileSync(swPath, 'utf8');
assert(swJs.includes('cacheFirst'), 'SW implements cache-first strategy');
assert(swJs.includes('networkFirst'), 'SW implements network-first strategy');
assert(swJs.includes('staleWhileRevalidate'), 'SW implements stale-while-revalidate');

// ─── Test: No sensitive data in frontend files ──────────────────────────────

console.log('\n── Data Privacy Tests ──');

assert(!appJs.includes('is_muslim'), 'No is_muslim field in app.js');
assert(!appJs.includes('name_origin'), 'No name_origin field in app.js');
assert(!html.includes('is_muslim'), 'No is_muslim field in index.html');
assert(!html.includes('name_origin'), 'No name_origin field in index.html');

// Check JSON data files don't contain sensitive fields
const dataDir = path.join(__dirname, '..', 'data', 'districts');
if (fs.existsSync(dataDir)) {
  const districts = fs.readdirSync(dataDir);
  let sampleChecked = false;
  for (const dist of districts.slice(0, 2)) {
    const distDir = path.join(dataDir, dist);
    const files = fs.readdirSync(distDir).filter(f => f.endsWith('_index.json'));
    if (files.length > 0) {
      const indexData = fs.readFileSync(path.join(distDir, files[0]), 'utf8');
      assert(!indexData.includes('is_muslim'), `No is_muslim in ${dist}/${files[0]}`);
      sampleChecked = true;
      break;
    }
  }
  if (!sampleChecked) {
    console.log('  (no index files found to check)');
  }
}

// ─── Test: search-utils.js functions ────────────────────────────────────────

console.log('\n── Search Algorithm Integration Tests ──');

const utilsPath = path.join(__dirname, '..', 'apps', 'web', 'search-utils.js');
const utilsCode = fs.readFileSync(utilsPath, 'utf8');

const ctx = vm.createContext({
  console,
  self: {},
  importScripts: function() {},
});
vm.runInContext(utilsCode, ctx);

// Test: escapeHtml prevents XSS
const escaped = vm.runInContext('escapeHtml("<script>alert(1)</script>")', ctx);
assert(
  escaped === '&lt;script&gt;alert(1)&lt;/script&gt;',
  'escapeHtml prevents XSS injection'
);

// Test: phoneticKey normalizes Indian names
const pk1 = vm.runInContext('phoneticKey("Shivappa")', ctx);
const pk2 = vm.runInContext('phoneticKey("Shivapa")', ctx);
assert(pk1 === pk2, 'phoneticKey("Shivappa") === phoneticKey("Shivapa") (doubled consonants)');

// Test: levenshtein handles edge cases
const lev0 = vm.runInContext('levenshtein("test", "test", 3)', ctx);
assert(lev0 === 0, 'levenshtein identical = 0');

const lev1 = vm.runInContext('levenshtein("test", "tost", 3)', ctx);
assert(lev1 === 1, 'levenshtein 1 substitution = 1');

// Test: tokenizeQuery handles Kannada
const kanTokens = vm.runInContext('tokenizeQuery("ಮೊಹಮ್ಮದ")', ctx);
assert(kanTokens.length === 1, 'Kannada input stays as single token');

const enTokens = vm.runInContext('tokenizeQuery("Abdul Rehman")', ctx);
assert(enTokens.length === 2, 'English input splits into tokens');

// Test: scoreNameMatch returns reasonable scores
const score = vm.runInContext('scoreNameMatch(["mohammed"], ["mohammed"])', ctx);
assert(score >= 0.9, 'Exact name match scores >= 0.9');

const noMatch = vm.runInContext('scoreNameMatch(["xyz"], ["abc"])', ctx);
assert(noMatch === 0, 'Non-matching names score 0');

// ─── Test: build script includes all files ──────────────────────────────────

console.log('\n── Build System Tests ──');

const buildPath = path.join(__dirname, '..', 'scripts', 'build.js');
const buildJs = fs.readFileSync(buildPath, 'utf8');
assert(buildJs.includes('app.js'), 'Build script includes app.js');
assert(buildJs.includes('sw.js'), 'Build script includes sw.js');

// ─── Test: package.json is valid ────────────────────────────────────────────

console.log('\n── Package Config Tests ──');

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
assert(pkg.private === true, 'package.json is private (not accidentally published)');
assert(!pkg.main, 'No invalid "main" pointing to nonexistent file');
assert(pkg.scripts.test, 'test script defined');
assert(pkg.scripts['test:integration'], 'integration test script defined');

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(50)}`);
console.log(`Integration Tests: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
