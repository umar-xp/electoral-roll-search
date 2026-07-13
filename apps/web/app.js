// Register service worker for offline-first caching
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(function() {});
}

// ========== INDEXED SEARCH ENGINE INITIALIZATION ==========
// Try to initialize the high-performance indexed search engine.
// Falls back to brute-force scan if the index isn't available yet.
let _indexedSearchEngine = null;
(async function initIndexedSearch() {
  try {
    if (typeof IndexedSearchEngine !== 'undefined') {
      _indexedSearchEngine = new IndexedSearchEngine();
      await _indexedSearchEngine.init();
      console.info('[Search] Inverted index loaded — using O(1) search');
    }
  } catch (e) {
    _indexedSearchEngine = null;
    // Index not yet generated — fall back to brute-force
    console.info('[Search] Index not available, using fallback scan');
  }
})();

// ========== GLOBAL ERROR BOUNDARY ==========
// Surface critical errors to users instead of failing silently
window.addEventListener('error', function(event) {
  var banner = document.getElementById('div-status-banner');
  if (banner && !banner.dataset.userError) {
    banner.dataset.userError = '1';
    banner.style.display = 'block';
    banner.className = 'alert alert-error';
    banner.textContent = 'Something went wrong. Please refresh the page. | ಏನೋ ತಪ್ಪಾಗಿದೆ. ಪುಟವನ್ನು ರಿಫ್ರೆಶ್ ಮಾಡಿ.';
  }
});
window.addEventListener('unhandledrejection', function(event) {
  if (event.reason && event.reason.name === 'AbortError') return; // Expected cancellation
  var banner = document.getElementById('div-status-banner');
  if (banner && !banner.dataset.userError) {
    banner.dataset.userError = '1';
    banner.style.display = 'block';
    banner.className = 'alert alert-error';
    banner.textContent = 'A network request failed. Check your connection and retry. | ನೆಟ್ವರ್ಕ್ ವಿಫಲವಾಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';
  }
});

// ========== APPLICATION CONFIGURATION ==========
const APP_CONFIG = Object.freeze({
  MAX_CACHED_PARTS: 300,       // Max parts in LRU cache (~36MB at 120KB each)
  PAGE_SIZE: 50,               // Results per page
  AC_CHUNK_SIZE: 150,          // Parts loaded per AC search batch
  SEARCH_DEBOUNCE_MS: 500,     // Debounce interval for search button
  SEARCH_TIMEOUT_MS: 60000,    // Max time for global search (60s)
  GLOBAL_MAX_RESULTS: 500,     // Cap results in global search
  FETCH_TIMEOUT_MS: 10000,     // Per-fetch timeout (10s)
});

/**
 * LRU Cache for loaded part data — prevents unbounded memory growth.
 * Author: Mohammed Shoaib U
 * 
 * Description: Evicts least-recently-used parts when cache exceeds MAX_CACHED_PARTS.
 * Each part is ~600 voters × ~200 bytes = ~120KB, so 300 parts ≈ 36MB max.
 */
const MAX_CACHED_PARTS = APP_CONFIG.MAX_CACHED_PARTS;
const _partCache = new Map();

function lruGetPart(key, store) {
  if (!_partCache.has(key)) return null;
  // Move to end (most recently used) — O(1) with Map
  const value = _partCache.get(key);
  _partCache.delete(key);
  _partCache.set(key, value);
  return value;
}

function lruSetPart(key, value, store) {
  if (_partCache.has(key)) {
    _partCache.delete(key);
  } else if (_partCache.size >= MAX_CACHED_PARTS) {
    // Evict oldest (first key in Map iteration order) — O(1)
    const oldestKey = _partCache.keys().next().value;
    _partCache.delete(oldestKey);
    delete store[oldestKey];
  }
  _partCache.set(key, value);
  store[key] = value;
}

const dbState = {
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
  allResults: [],
  displayedCount: 0,
  PAGE_SIZE: APP_CONFIG.PAGE_SIZE,
  acAllParts: null,
  acAllPartsIndex: 0,
  acAllPartsChunk: APP_CONFIG.AC_CHUNK_SIZE,
  lastDBParams: null
};

function siteBasePath() {
  const p = window.location.pathname || '/';
  const appIdx = p.indexOf('/apps/web/');
  if (appIdx >= 0) return p.slice(0, appIdx + 1);
  const distIdx = p.indexOf('/dist/');
  if (distIdx >= 0) return p.slice(0, distIdx + 1);
  if (p.endsWith('/')) return p;
  return p.replace(/[^/]*$/, '');
}

/**
 * Escape untrusted strings for safe HTML insertion (XSS prevention).
 * Delegates to the canonical escapeHtml from search-utils.js.
 * Use this for any voter record data rendered into HTML templates.
 */
function _esc(str) {
  return escapeHtml(str);
}

function noCacheUrl(url) {
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
}

function withCacheBuster(url) {
  const v =
    (dbState.masterIndex && dbState.masterIndex.generated_at)
      ? dbState.masterIndex.generated_at
      : (dbState.cacheBuster || '1');
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(v))}`;
}

async function initDBSearch() {
  try {
    const res = await fetch(noCacheUrl(siteBasePath() + 'data/master_index.json'), { cache: 'no-store' });
    dbState.masterIndex = await res.json();
    dbState.cacheBuster = (dbState.masterIndex && dbState.masterIndex.generated_at) ? dbState.masterIndex.generated_at : String(Date.now());

    const sel = document.getElementById('sel-district');
    const districts = (dbState.masterIndex || {}).districts || {};

    let liveCount = 0;
    if (Array.isArray(districts)) {
      liveCount = districts.filter(d => d && d.status === 'live').length;
    } else {
      liveCount = Object.values(districts).filter(d => d && d.status === 'live').length;
    }
    const badge = document.getElementById('badge-live-districts');
    if (badge) badge.textContent = `⚠️ ${liveCount} districts only`;

    if (Array.isArray(districts)) {
      districts
        .filter(d => d && d.status === 'live')
        .sort((a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || ''))
        .forEach(d => {
          const key = d.district_code || '';
          if (!key) return;
          const label = d.display_name || d.name || key;
          sel.add(new Option(label, key));
        });
    } else {
      Object.entries(districts)
        .filter(([, d]) => d && d.status === 'live')
        .sort((a, b) => (a[1].display_name || '').localeCompare(b[1].display_name || ''))
        .forEach(([key, d]) => {
          sel.add(new Option(d.display_name, key));
        });

      if (sel.options.length > 1) {
        const sep = new Option('── Coming Soon ──', '', false, false);
        sep.disabled = true;
        sel.add(sep);
      }

      Object.entries(districts)
        .filter(([, d]) => d && d.status === 'coming_soon')
        .sort((a, b) => (a[1].display_name || '').localeCompare(b[1].display_name || ''))
        .forEach(([key, d]) => {
          const opt = new Option(d.display_name + ' (Coming Soon)', key);
          opt.disabled = true;
          sel.add(opt);
        });
    }

    sel.addEventListener('change', dbOnDistrictChange);
    document.getElementById('sel-ac').addEventListener('change', dbOnACChange);
    document.getElementById('sel-part').addEventListener('change', dbOnPartChange);
    document.getElementById('btn-clear').addEventListener('click', clearSearch);
    
    // Debounced search — prevents duplicate requests from rapid clicks
    // Author: Mohammed Shoaib U
    let _searchDebounceTimer = null;
    document.getElementById('btn-search').addEventListener('click', () => {
      if (_searchDebounceTimer) return; // Ignore if already debouncing
      _searchDebounceTimer = setTimeout(() => { _searchDebounceTimer = null; }, APP_CONFIG.SEARCH_DEBOUNCE_MS);
      window.__searchMode = 'db';
      performSearch();
    });
    document.getElementById('btn-global-search').addEventListener('click', () => {
      if (_searchDebounceTimer) return;
      _searchDebounceTimer = setTimeout(() => { _searchDebounceTimer = null; }, APP_CONFIG.SEARCH_DEBOUNCE_MS);
      window.__searchMode = 'db';
      performGlobalSearch();
    });
    const btnCancel = document.getElementById('btn-cancel-db-search');
    if (btnCancel) btnCancel.addEventListener('click', cancelDBSearch);

    // Enter key triggers search from any input field
    ['inp-voter-name', 'inp-relative-name', 'inp-age', 'inp-voter-id'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); window.__searchMode = 'db'; performSearch(); }
      });
    });

    const r1 = document.getElementById('rdo-part-only');
    const r2 = document.getElementById('rdo-all-parts');
    if (r1) r1.addEventListener('change', applyDBSearchScopeToUI);
    if (r2) r2.addEventListener('change', applyDBSearchScopeToUI);

    const lnk = document.getElementById('lnk-advanced-filters');
    if (lnk) {
      lnk.addEventListener('click', (e) => {
        e.preventDefault();
        toggleAdvancedFilters();
      });
    }

    const last = sessionStorage.getItem('lastDBSearch');
    if (last) restoreLastSearch(JSON.parse(last));

    installSearchRouter();
    applyDBSearchScopeToUI();
  } catch (e) {
    showBanner('error', 'Could not load district list. Please refresh. | ಜಿಲ್ಲೆಗಳ ಪಟ್ಟಿಯನ್ನು ಲೋಡ್ ಮಾಡಲಾಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ರಿಫ್ರೆಶ್ ಮಾಡಿ.');
  }
}

function restoreLastSearch(last) {
  if (!last) return;
  const distSel = document.getElementById('sel-district');
  if (last.searchScope === 'ac') {
    const r2 = document.getElementById('rdo-all-parts');
    if (r2) r2.checked = true;
  } else {
    const r1 = document.getElementById('rdo-part-only');
    if (r1) r1.checked = true;
  }
  if (last.selectedDist) {
    distSel.value = last.selectedDist;
    dbOnDistrictChange();
  }
  if (last.voterName) document.getElementById('inp-voter-name').value = last.voterName;
  if (last.relativeName) document.getElementById('inp-relative-name').value = last.relativeName;
  if (last.age) document.getElementById('inp-age').value = last.age;
  if (last.relType) document.getElementById('sel-rel-type').value = last.relType;
  if (last.gender) document.getElementById('sel-gender').value = last.gender;
  if (last.voterId) document.getElementById('inp-voter-id').value = last.voterId;
  applyDBSearchScopeToUI();
}

function getDBSearchScope() {
  const r2 = document.getElementById('rdo-all-parts');
  return (r2 && r2.checked) ? 'ac' : 'part';
}

function applyDBSearchScopeToUI() {
  dbState.searchScope = getDBSearchScope();
  const partSel = document.getElementById('sel-part');
  if (!partSel) return;
  if (dbState.searchScope === 'ac') {
    partSel.value = '';
    dbState.selectedPart = null;
    partSel.disabled = true;
    if (partSel.options && partSel.options.length) partSel.options[0].textContent = 'All parts will be searched | ಎಲ್ಲಾ ಭಾಗಗಳು';
  } else {
    if (partSel.options && partSel.options.length) partSel.options[0].textContent = 'Select Part | ಭಾಗ ಆಯ್ಕೆ ಮಾಡಿ';
    if (dbState.selectedAC) partSel.disabled = false;
  }
}

function dbOnDistrictChange() {
  const key = document.getElementById('sel-district').value;
  dbState.selectedDist = key || null;

  resetDropdown('sel-ac', 'Select AC | ಕ್ಷೇತ್ರ ಆಯ್ಕೆ ಮಾಡಿ');
  resetDropdown('sel-part', 'All Parts | ಎಲ್ಲಾ ಭಾಗಗಳು');
  clearDBResults();

  document.getElementById('btn-search').disabled = true;

  if (!key) {
    hideBanner();
    return;
  }

  const districts = (dbState.masterIndex || {}).districts || {};

  // Support both array-style and object-style district formats
  let dist;
  if (Array.isArray(districts)) {
    dist = districts.find(d => d && d.district_code === key);
  } else {
    dist = districts[key];
  }

  if (!dist || dist.status === 'coming_soon') {
    showBanner(
      'yellow',
      `⏳ Data for ${(dist && (dist.display_name || dist.name) ? (dist.display_name || dist.name).split('|')[0].trim() : key)} is being processed. Currently live: Bagalkot, Bangalore Urban. | ⏳ ಡೇಟಾ ಸಿದ್ಧವಾಗುತ್ತಿದೆ. ಈಗ ಲೈವ್: ಬಾಗಲಕೋಟೆ, ಬೆಂಗಳೂರು ನಗರ.`
    );
    return;
  }

  // If dist has acs inline (object-style), use them directly
  if (dist.acs && dist.acs.length > 0) {
    _populateACDropdown(key, dist);
    return;
  }

  // Array-style: fetch district index.json for AC list
  showBanner('blue', '🔵 Loading... ಲೋಡ್ ಆಗುತ್ತಿದೆ...');
  const url = withCacheBuster(`${siteBasePath()}data/districts/${key}/index.json`);
  fetch(url)
    .then(r => { if (!r.ok) throw new Error('District index fetch failed'); return r.json(); })
    .then(distIndex => {
      _populateACDropdown(key, distIndex);
    })
    .catch(() => {
      showBanner('error', 'Could not load district data. Please refresh. | ಜಿಲ್ಲೆಯ ಡೇಟಾ ಲೋಡ್ ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ರಿಫ್ರೆಶ್ ಮಾಡಿ.');
    });
}

function _populateACDropdown(key, dist) {
  const acSel = document.getElementById('sel-ac');
  acSel.disabled = false;
  (dist.acs || [])
    .slice()
    .sort((a, b) => (parseInt(a.ac_num, 10) || 0) - (parseInt(b.ac_num, 10) || 0))
    .forEach((ac) => {
      const acLabel = formatAcLabel(key, ac.ac_num, ac.ac_name);
      acSel.add(
        new Option(
          `${acLabel} (${(ac.voter_count || 0).toLocaleString()})`,
          ac.ac_num
        )
      );
    });

  const displayName = dist.display_name || dist.district || dist.name || key;
  showBanner(
    'green',
    `✅ ${displayName.split('|')[0].trim()} — ${(dist.total_voters || dist.voter_count || 0).toLocaleString()} voters across ${dist.ac_count || (dist.acs || []).length} constituencies | ✅ ${(dist.total_voters || dist.voter_count || 0).toLocaleString()} ಮತದಾರರು · ${dist.ac_count || (dist.acs || []).length} ಕ್ಷೇತ್ರಗಳು`
  );
  applyDBSearchScopeToUI();
}

async function dbOnACChange() {
  const acNum = document.getElementById('sel-ac').value;
  dbState.selectedAC = acNum || null;

  resetDropdown('sel-part', 'All Parts | ಎಲ್ಲಾ ಭಾಗಗಳು');
  clearDBResults();
  document.getElementById('btn-search').disabled = true;
  if (!acNum) return;

  showBanner('blue', '🔵 Loading... ಲೋಡ್ ಆಗುತ್ತಿದೆ...');

  try {
    const url = withCacheBuster(`${siteBasePath()}data/districts/${dbState.selectedDist}/${acNum}_index.json`);
    const res = await fetch(url);
    dbState.acIndex = await res.json();

    const partSel = document.getElementById('sel-part');
    (dbState.acIndex.parts || []).forEach((p) => {
      partSel.add(new Option(`Part ${p.part_num} (${p.voter_count} voters)`, p.part_num));
    });
    partSel.disabled = false;
    applyDBSearchScopeToUI();

    showBanner(
      'green',
      `✅ ${formatAcLabel(dbState.selectedDist, dbState.selectedAC, dbState.acIndex.ac_name)} — ${(dbState.acIndex.total_voters || 0).toLocaleString()} voters, ${(dbState.acIndex.parts || []).length} parts | ✅ ${(dbState.acIndex.total_voters || 0).toLocaleString()} ಮತದಾರರು · ${(dbState.acIndex.parts || []).length} ಭಾಗಗಳು`
    );

    document.getElementById('btn-search').disabled = false;
    var _hint = document.getElementById('search-hint');
    if (_hint) _hint.classList.add('hidden');
    document.getElementById('inp-voter-name').focus();
  } catch (e) {
    showBanner('error', 'Failed to load AC data. Please try again. | ಕ್ಷೇತ್ರದ ಡೇಟಾ ಲೋಡ್ ಆಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.');
  }
}

function dbOnPartChange() {
  const val = document.getElementById('sel-part').value;
  dbState.selectedPart = val ? parseInt(val, 10) : null;
}

function resetDropdown(id, placeholder) {
  const sel = document.getElementById(id);
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  sel.disabled = true;
}

function clearDBResults() {
  dbState.allResults = [];
  dbState.displayedCount = 0;
  dbState.acAllParts = null;
  dbState.acAllPartsIndex = 0;
  dbState.lastDBParams = null;
  hideMorePartsControl();
  const div = document.getElementById('div-db-results');
  if (div) div.innerHTML = '<div id="empty-state" class="empty-state"><div class="empty-state-icon">\uD83D\uDCCB</div><div class="empty-state-text">Your search results will appear here</div><div class="empty-state-sub">Select a district, enter a name, and hit Search</div></div>';
  hideProgress();
}

function hideMorePartsControl() {
  const div = document.getElementById('div-ac-search-more');
  if (!div) return;
  div.style.display = 'none';
  div.innerHTML = '';
}

function renderMorePartsControl() {
  const div = document.getElementById('div-ac-search-more');
  if (!div) return;

  const total = (dbState.acAllParts && Array.isArray(dbState.acAllParts)) ? dbState.acAllParts.length : 0;
  const searched = parseInt(dbState.acAllPartsIndex, 10) || 0;
  const remaining = Math.max(0, total - searched);
  if (!total || remaining <= 0) {
    hideMorePartsControl();
    return;
  }

  const nextCount = Math.min(dbState.acAllPartsChunk || 150, remaining);
  div.style.display = 'block';
  div.innerHTML = `
    <div class="alert alert-warning" style="margin-top:10px;align-items:center">
      <span>⚠️</span>
      <span style="flex:1">
        Searched ${searched}/${total} parts. Load remaining parts? | ${searched}/${total} ಭಾಗಗಳು ಹುಡುಕಲಾಗಿದೆ. ಉಳಿದ ಭಾಗಗಳನ್ನು ಹುಡುಕಬೇಕೇ?
      </span>
      <button class="btn btn-primary btn-sm" id="btn-search-next-parts" type="button">Search next ${nextCount}</button>
      <button class="btn btn-outline btn-sm" id="btn-search-all-remaining" type="button" style="margin-left:6px">Search all remaining</button>
    </div>
  `;

  const b1 = document.getElementById('btn-search-next-parts');
  const b2 = document.getElementById('btn-search-all-remaining');
  if (b1) b1.addEventListener('click', () => continueDBAllPartsSearch('next'));
  if (b2) b2.addEventListener('click', () => continueDBAllPartsSearch('all'));
}

async function continueDBAllPartsSearch(mode = 'next') {
  if (dbState.isSearching) return;
  const params = dbState.lastDBParams;
  if (!params || params.scopeMode !== 'ac') return;

  const allParts = (dbState.acAllParts && Array.isArray(dbState.acAllParts)) ? dbState.acAllParts : [];
  const totalAll = allParts.length;
  const startIndex = parseInt(dbState.acAllPartsIndex, 10) || 0;
  if (!totalAll || startIndex >= totalAll) {
    hideMorePartsControl();
    showBanner('green', '✅ All parts already searched. | ✅ ಎಲ್ಲಾ ಭಾಗಗಳು ಈಗಾಗಲೇ ಹುಡುಕಲಾಗಿದೆ.');
    return;
  }

  const remaining = totalAll - startIndex;
  const count = (mode === 'all')
    ? remaining
    : Math.min(dbState.acAllPartsChunk || 150, remaining);

  const partsToSearch = allParts.slice(startIndex, startIndex + count);
  await runDBSearchOverParts({
    district: params.district,
    acNum: params.acNum,
    partsToSearch,
    chunkStartIndex: startIndex,
    totalAllParts: totalAll,
    filters: params.filters,
    voterName: params.voterName
  });
}

/**
 * Load voter data from a part file with LRU caching and retry logic.
 * Author: Mohammed Shoaib U
 * 
 * Description: Fetches part JSON, caches with LRU eviction (max 300 parts),
 * retries up to 2 times on network failure with exponential backoff.
 * Reports errors via showBanner() so users know what failed.
 * 
 * @param {string} district - District key
 * @param {number} acNum - AC number
 * @param {number} partNum - Part number
 * @returns {Promise<Array>} Voter records array
 */
async function loadPartData(district, acNum, partNum, signal) {
  const key = `${district}_${acNum}_${partNum}`;
  const cached = lruGetPart(key, dbState.loadedParts);
  if (cached) return cached;
  
  const url = withCacheBuster(`${siteBasePath()}data/districts/${district}/${acNum}/part_${partNum}.json`);
  const MAX_RETRIES = 2;
  let lastErr = null;
  
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const voters = Array.isArray(data) ? data : (data && data.voters) ? data.voters : [];
      const distKey = String(district || '').toUpperCase();
      const acInt = parseInt(acNum, 10);
      const withMeta = voters.map(v => {
        // Normalize new-format fields (ne/nk/re/rel/age/vid/st) to internal names
        const norm = (v.ne !== undefined && v.vn === undefined) ? {
          ...v,
          vn: v.ne,
          vk: v.nk || v.vk,
          rn: v.re || v.rn,
          rk: v.rk,
          rt: v.rel || v.rt,
          a: v.age != null ? v.age : v.a,
          id: v.vid != null ? v.vid : v.id,
          vt: v.st || v.vt
        } : v;
        return {
          ...norm,
          d: distKey,
          ac: isNaN(acInt) ? null : acInt,
          pn: norm.pn != null ? norm.pn : partNum
        };
      });
      lruSetPart(key, withMeta, dbState.loadedParts);
      return withMeta;
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') return [];
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  
  console.warn(`Part ${partNum} failed after ${MAX_RETRIES + 1} attempts:`, lastErr);
  return [];
}

// runDBSearchOverParts — capture a LOCAL reference, don't re-read dbState
async function runDBSearchOverParts({ district, acNum, partsToSearch, chunkStartIndex, totalAllParts, filters, voterName }) {
  if (dbState.abortCtrl) dbState.abortCtrl.abort();
  const myAbortCtrl = new AbortController();
  dbState.abortCtrl = myAbortCtrl;
  dbState.isSearching = true;
  document.getElementById('btn-search').disabled = true;
  hideMorePartsControl();

  const BATCH = 10;
  const totalChunk = partsToSearch.length;
  let searchedInChunk = 0;

  for (let i = 0; i < partsToSearch.length; i += BATCH) {
    if (myAbortCtrl.signal.aborted) break;          // was: dbState.abortCtrl.signal.aborted
    const batch = partsToSearch.slice(i, i + BATCH);
    const end = Math.min(i + BATCH, totalChunk);
    const searchedOverall = Math.min(totalAllParts, chunkStartIndex + i);
    const endOverall = Math.min(totalAllParts, chunkStartIndex + end);

    showProgress(
      `Searching parts ${searchedOverall + 1}–${endOverall} of ${totalAllParts}... Found ${dbState.allResults.length} so far | ಭಾಗಗಳು ${searchedOverall + 1}–${endOverall}/${totalAllParts} ಹುಡುಕುತ್ತಿದೆ...`,
      totalAllParts ? (searchedOverall / totalAllParts) * 100 : 0
    );

    const batchData = await Promise.all(
      batch.map(pn => loadPartData(district, acNum, pn, myAbortCtrl.signal))  // pass it explicitly
    );
    const matches = batchData
      .flat()
      .map(v => {
        const scored = scoreVoterRecord(v, filters);
        if (scored <= 0) return null;
        return { ...v, _score: scored };
      })
      .filter(Boolean);

    dbState.allResults.push(...matches);
    searchedInChunk += batch.length;

    if (dbState.allResults.length > 0 && dbState.allResults.length <= 2000) {
      dbState.allResults.sort((a, b) => (b._score || 0) - (a._score || 0));
    }

    const searchedNowOverall = Math.min(totalAllParts, chunkStartIndex + searchedInChunk);
    if (dbState.allResults.length > 0 && dbState.displayedCount === 0) {
      renderResults({ isPartial: searchedNowOverall < totalAllParts, searched: searchedNowOverall, total: totalAllParts, voterName });
    } else if (dbState.allResults.length > 0) {
      const badge = document.querySelector('.results-count');
      if (badge) {
        badge.textContent = `Found ${dbState.allResults.length}+ matches (searching ${searchedNowOverall}/${totalAllParts} parts...)`;
      }
    }
  }

  if (myAbortCtrl.signal.aborted) {
    dbState.acAllPartsIndex = Math.min(totalAllParts, chunkStartIndex + searchedInChunk);
    dbState.isSearching = false;
    document.getElementById('btn-search').disabled = false;
    hideProgress();
    if (dbState.lastDBParams && dbState.lastDBParams.scopeMode === 'ac') renderMorePartsControl();
    return;
  }

  dbState.acAllPartsIndex = Math.min(totalAllParts, chunkStartIndex + searchedInChunk);
  dbState.isSearching = false;
  document.getElementById('btn-search').disabled = false;
  hideProgress();

  const searchedOverallFinal = parseInt(dbState.acAllPartsIndex, 10) || 0;
  const isPartialFinal = searchedOverallFinal < totalAllParts;

  if (dbState.allResults.length === 0) {
    if (isPartialFinal) {
      showBanner(
        'yellow',
        `⚠️ No matches found yet. Only searched ${searchedOverallFinal}/${totalAllParts} parts. Load remaining parts to continue. | ⚠️ ಇನ್ನೂ ಫಲಿತಾಂಶಗಳಿಲ್ಲ. ${searchedOverallFinal}/${totalAllParts} ಭಾಗಗಳು ಮಾತ್ರ ಹುಡುಕಲಾಗಿದೆ. ಉಳಿದ ಭಾಗಗಳನ್ನು ಹುಡುಕಿ.`
      );
      renderMorePartsControl();
      return;
    }
    showNoResults(filters.voterName || voterName, filters.relName || '');
    return;
  }

  dbState.allResults.sort((a, b) => (b._score || 0) - (a._score || 0));
  renderResults({ isPartial: isPartialFinal, searched: searchedOverallFinal, total: totalAllParts, voterName });
  if (isPartialFinal) renderMorePartsControl();
}


// ========== INLINE VALIDATION (replaces native alert()) ==========
function showValidationError(inputId, message) {
  // Remove any existing validation errors
  document.querySelectorAll('.validation-error').forEach(el => el.remove());
  document.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));

  const input = document.getElementById(inputId);
  if (input) {
    input.classList.add('input-error');
    input.focus();
    // Create inline error message
    const errDiv = document.createElement('div');
    errDiv.className = 'validation-error';
    errDiv.setAttribute('role', 'alert');
    errDiv.textContent = message;
    input.parentNode.appendChild(errDiv);
    // Auto-remove after 5 seconds
    setTimeout(() => {
      errDiv.remove();
      input.classList.remove('input-error');
    }, 5000);
    // Remove on input change
    const removeErr = () => { errDiv.remove(); input.classList.remove('input-error'); input.removeEventListener('input', removeErr); input.removeEventListener('change', removeErr); };
    input.addEventListener('input', removeErr);
    input.addEventListener('change', removeErr);
  } else {
    // Fallback to banner if input not found
    showBanner('error', message);
  }
}

async function performDBSearch() {
  if (dbState.isSearching) return;
  hideMorePartsControl();

  const district = dbState.selectedDist;
  const acNum = dbState.selectedAC;
  const partNum = dbState.selectedPart;
  const voterName = document.getElementById('inp-voter-name').value.trim();
  const relName = document.getElementById('inp-relative-name').value.trim();
  const age = document.getElementById('inp-age').value.trim();
  const relType = document.getElementById('sel-rel-type').value;
  const gender = document.getElementById('sel-gender').value;
  const voterId = document.getElementById('inp-voter-id').value.trim();
  const scopeMode = getDBSearchScope();

  if (!district || !acNum) {
    showValidationError('sel-district', 'Please select District and Constituency');
    return;
  }
  if (scopeMode === 'part' && !partNum && !voterId) {
    showValidationError('sel-part', 'Please select a Part Number (or switch to "Search all parts")');
    return;
  }
  if (!voterName && !voterId) {
    showValidationError('inp-voter-name', 'Please enter Voter Name or Voter ID');
    return;
  }

  dbState.isSearching = true;
  dbState.allResults = [];
  dbState.displayedCount = 0;
  showSkeletonResults(3); // Show loading placeholder
  document.getElementById('btn-search').disabled = true;

  const allParts = (scopeMode === 'part')
    ? (partNum ? [partNum] : [])
    : ((dbState.acIndex && dbState.acIndex.parts) ? dbState.acIndex.parts.map(p => p.part_num) : []);

  const filters = { voterName, relName, age, relType, gender, voterId };

  if (scopeMode === 'ac') {
    dbState.acAllParts = allParts.slice();
    dbState.acAllPartsIndex = 0;
    dbState.lastDBParams = { district, acNum, voterName, filters, scopeMode };

    let firstChunk = dbState.acAllParts.slice(0, dbState.acAllPartsChunk || 150);
    if (dbState.acAllParts.length > firstChunk.length) {
      showBanner(
        'yellow',
        `⚠️ This AC has ${dbState.acAllParts.length} parts. Searching first ${firstChunk.length} parts. Use "Search next" to load remaining parts. | ⚠️ ಈ ಕ್ಷೇತ್ರದಲ್ಲಿ ${dbState.acAllParts.length} ಭಾಗಗಳಿವೆ. ಮೊದಲ ${firstChunk.length} ಭಾಗಗಳನ್ನು ಹುಡುಕುತ್ತಿದೆ. ಉಳಿದ ಭಾಗಗಳಿಗಾಗಿ "Search next" ಒತ್ತಿರಿ.`
      );
    }

    await runDBSearchOverParts({
      district,
      acNum,
      partsToSearch: firstChunk,
      chunkStartIndex: 0,
      totalAllParts: dbState.acAllParts.length,
      filters,
      voterName
    });
  } else {
    dbState.acAllParts = null;
    dbState.acAllPartsIndex = 0;
    dbState.lastDBParams = null;
    await runDBSearchOverParts({
      district,
      acNum,
      partsToSearch: allParts,
      chunkStartIndex: 0,
      totalAllParts: allParts.length,
      filters,
      voterName
    });
  }

  sessionStorage.setItem('lastDBSearch', JSON.stringify({
    selectedDist: district,
    selectedAC: acNum,
    selectedPart: partNum,
    searchScope: scopeMode,
    voterName,
    relativeName: relName,
    age,
    relType,
    gender,
    voterId,
    timestamp: Date.now()
  }));
}

function cancelDBSearch() {
  if (dbState.abortCtrl) dbState.abortCtrl.abort();
  if (dbState.globalAbort) dbState.globalAbort.abort();
  dbState.isSearching = false;
  document.getElementById('btn-search').disabled = false;
  document.getElementById('btn-global-search').disabled = false;
  hideProgress();
  showBanner('yellow', 'Search cancelled. | ಹುಡುಕಾಟ ರದ್ದುಪಡಿಸಲಾಗಿದೆ.');
}

/**
 * Global Search — searches ALL districts without requiring district/AC selection.
 * Author: Mohammed Shoaib U
 * 
 * Description: Uses the VoterSearchEngine class to search across all live districts
 * progressively. Results are ranked by relevance score and displayed as they arrive.
 */
async function performGlobalSearch() {
  const voterName = document.getElementById('inp-voter-name').value.trim();
  const relName = document.getElementById('inp-relative-name').value.trim();
  const age = document.getElementById('inp-age').value.trim();
  const relType = document.getElementById('sel-rel-type').value;
  const gender = document.getElementById('sel-gender').value;
  const voterId = document.getElementById('inp-voter-id').value.trim();

  if (!voterName && !voterId) {
    showValidationError('inp-voter-name', 'Please enter Voter Name or Voter ID for search');
    return;
  }

  // Initialize the search engine if not already done
  if (!window._voterSearchEngine) {
    window._voterSearchEngine = new VoterSearchEngine();
    await window._voterSearchEngine.init();
  }
  const engine = window._voterSearchEngine;

  // Setup UI for searching
  dbState.isSearching = true;
  dbState.allResults = [];
  dbState.displayedCount = 0;
  showSkeletonResults(3);
  document.getElementById('btn-search').disabled = true;
  document.getElementById('btn-global-search').disabled = true;

  dbState.globalAbort = new AbortController();
  const signal = dbState.globalAbort.signal;

  showProgress('🌐 Global search starting... Searching all districts | ಎಲ್ಲಾ ಜಿಲ್ಲೆಗಳಲ್ಲಿ ಹುಡುಕುತ್ತಿದೆ...', 0);

  try {
    const result = await engine.globalSearch({
      voterName,
      relName,
      age,
      gender,
      relType,
      voterId,
      signal,
      onProgress: (searched, total, found) => {
        const pct = total > 0 ? (searched / total) * 100 : 0;
        showProgress(
          `🌐 Searching AC ${searched}/${total} across all districts... Found ${found} matches | ಕ್ಷೇತ್ರ ${searched}/${total} ಹುಡುಕುತ್ತಿದೆ... ${found} ಫಲಿತಾಂಶಗಳು`,
          pct
        );
      },
    });

    dbState.allResults = result.results;
    dbState.isSearching = false;
    document.getElementById('btn-search').disabled = false;
    document.getElementById('btn-global-search').disabled = false;
    hideProgress();

    if (result.results.length === 0) {
      showNoResults(voterName, relName);
    } else {
      dbState.allResults.sort((a, b) => (b._score || 0) - (a._score || 0));
      renderResults({
        isPartial: result.timedOut || false,
        searched: result.totalSearched,
        total: result.totalAcs || result.totalSearched,
        voterName,
      });
      const statusEmoji = result.timedOut ? '⏱️' : '🌐';
      const statusText = result.timedOut
        ? `${statusEmoji} Search timed out after ${(result.time_ms / 1000).toFixed(1)}s — Found ${result.totalFound} voters in ${result.totalSearched}/${result.totalAcs} ACs | ⏱️ ಸಮಯ ಮೀರಿದೆ`
        : `${statusEmoji} Global search complete in ${(result.time_ms / 1000).toFixed(1)}s — Found ${result.totalFound} voters across ${result.totalSearched} ACs | ಗ್ಲೋಬಲ್ ಹುಡುಕಾಟ ಪೂರ್ಣ — ${result.totalFound} ಮತದಾರರು ${result.totalSearched} ಕ್ಷೇತ್ರಗಳಲ್ಲಿ`;
      showBanner(result.timedOut ? 'yellow' : 'green', statusText);
    }
  } catch (err) {
    if (err.name === 'AbortError' || signal.aborted) {
      showBanner('yellow', 'Global search cancelled. | ಗ್ಲೋಬಲ್ ಹುಡುಕಾಟ ರದ್ದು.');
    } else {
      showBanner('red', `Search error: ${err.message}`);
      console.error('Global search error:', err);
    }
  } finally {
    dbState.isSearching = false;
    document.getElementById('btn-search').disabled = false;
    document.getElementById('btn-global-search').disabled = false;
    hideProgress();
  }
}

function clearSearch() {
  if (dbState.abortCtrl) dbState.abortCtrl.abort();
  document.getElementById('sel-district').value = '';
  resetDropdown('sel-ac', 'Select AC | ಕ್ಷೇತ್ರ ಆಯ್ಕೆ ಮಾಡಿ');
  resetDropdown('sel-part', 'All Parts | ಎಲ್ಲಾ ಭಾಗಗಳು');
  document.getElementById('inp-voter-name').value = '';
  document.getElementById('inp-relative-name').value = '';
  document.getElementById('inp-age').value = '';
  document.getElementById('sel-rel-type').value = '';
  document.getElementById('sel-gender').value = '';
  document.getElementById('inp-voter-id').value = '';
  dbState.allResults = [];
  dbState.displayedCount = 0;
  dbState.acAllParts = null;
  dbState.acAllPartsIndex = 0;
  dbState.lastDBParams = null;
  document.getElementById('div-db-results').innerHTML = '<div id="empty-state" class="empty-state"><div class="empty-state-icon">\uD83D\uDCCB</div><div class="empty-state-text">Your search results will appear here</div><div class="empty-state-sub">Select a district, enter a name, and hit Search</div></div>';
  hideMorePartsControl();
  hideBanner();
  hideProgress();
  document.getElementById('btn-search').disabled = true;
  var _hint = document.getElementById('search-hint');
  if (_hint) _hint.classList.remove('hidden');
  sessionStorage.removeItem('lastDBSearch');
}

function matchesFilters(voter, filters) {
  const { voterName, relName, age, relType, gender, voterId } = filters;

  if (voterId) {
    return voter.id && voter.id.toLowerCase() === voterId.toLowerCase();
  }

  if (voterName) {
    if (!fuzzyMatch(voterName, voter.vn) && !fuzzyMatch(voterName, voter.vk)) return false;
  }

  if (relName) {
    if (!fuzzyMatch(relName, voter.rn) && !fuzzyMatch(relName, voter.rk)) return false;
  }

  if (age) {
    const diff = Math.abs(parseInt(age, 10) - parseInt(voter.a, 10));
    if (!isNaN(diff) && diff > 2) return false;
  }

  if (relType && voter.rt !== relType) return false;
  if (gender && voter.g !== gender) return false;

  return true;
}

function tokenizeForScoring(text) {
  if (!text) return [];
  return String(text)
    .trim()
    .split(/[\s\.\-,/]+/g)
    .map(t => String(t || '').trim())
    .filter(Boolean);
}

function isKannadaToken(tok) {
  return /[\u0C80-\u0CFF]/.test(tok || '');
}

function isSyedSurnameToken(tok) {
  const t = String(tok || '').toLowerCase().trim();
  const tClean = t.replace(/[^a-z]/g, '');
  if (tClean === 'syed' || tClean === 'sayed' || tClean === 'sayyed' || tClean === 'sayyad' || tClean === 'saiyad' || tClean === 'saiyyad' || tClean === 'sayyid' || tClean === 'saiyyid') return true;
  if (tClean === 'syeda' || tClean === 'saiyada' || tClean === 'sayyada' || tClean === 'saiyda' || tClean === 'sayyida') return true;
  if (t.includes('ಸಯ್ಯದ') || t.includes('ಸ್ಯಯದ') || t.includes('ಸಯ್ಯ')) return true;
  return false;
}

// Token synonyms loaded from external JSON (avoid bloating app.js)
let TOKEN_SYNONYMS = {};
(function() {
  fetch(siteBasePath() + 'apps/web/token-synonyms.json')
    .then(function(r) { return r.json(); })
    .then(function(data) { TOKEN_SYNONYMS = data; })
    .catch(function() { /* Synonym expansion will be limited if load fails */ });
})();

function expandQueryToken(token) {
  const raw = String(token || '').replace(/[\u200C\u200D]/g, '').toLowerCase().trim();
  if (!raw) return [];
  if (isKannadaToken(raw)) {
    const s = raw.replace(/\s+/g,'').trim();
    return s ? [s] : [];
  }
  const base = raw.replace(/[^a-z]/g, '');
  if (!base) return [];
  const out = new Set([base]);
  const syn = TOKEN_SYNONYMS[base];
  if (syn) syn.forEach(v => out.add(String(v || '').toLowerCase()));

  if (base === 'md' || base === 'mohd') (TOKEN_SYNONYMS.mohammed || []).forEach(v => out.add(v));

  if (base.startsWith('f') && base.length > 3) {
    out.add(base.replace(/^f/, 'p'));
    out.add(base.replace(/^f/, 'ph'));
  }
  if (base.startsWith('ph') && base.length > 3) out.add(base.replace(/^ph/, 'f'));
  if (base.startsWith('p') && base.length > 3) out.add(base.replace(/^p/, 'f'));

  if (base.includes('z')) {
    out.add(base.replace(/z/g, 'j'));
    out.add(base.replace(/z/g, 'j') + 'a');
  }
  if (base.includes('j')) out.add(base.replace(/j/g, 'z'));

  if (base.includes('q')) out.add(base.replace(/q/g, 'k'));
  if (base.includes('k') && base.length > 3) out.add(base.replace(/k/g, 'q'));

  // Auto-generate doubled-consonant variants for short tokens (Indian transliteration)
  if (base.length >= 3 && base.length <= 8) {
    for (let i = 0; i < base.length; i++) {
      const c = base[i];
      if (c >= 'b' && c <= 'z' && !'aeiou'.includes(c)) {
        // Add doubled variant: umer -> ummer, ummar
        out.add(base.slice(0, i + 1) + c + base.slice(i + 1));
        // Remove double if present: ummar -> umar
        if (i + 1 < base.length && base[i + 1] === c) {
          out.add(base.slice(0, i) + base.slice(i + 1));
        }
      }
    }
  }

  return Array.from(out).filter(v => v.length >= 2);
}

function consonantSkeleton(s) {
  return s.toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}

function jaro(s1, s2) {
  if (s1 === s2) return 1.0;
  const len1 = s1.length, len2 = s2.length;
  if (!len1 || !len2) return 0;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1m = new Array(len1).fill(false);
  const s2m = new Array(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const end = Math.min(len2, i + matchDist + 1);
    for (let j = Math.max(0, i - matchDist); j < end; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue;
      s1m[i] = s2m[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0, trans = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1m[i]) continue;
    while (!s2m[k]) k++;
    if (s1[i] !== s2[k]) trans++;
    k++;
  }
  return (matches / len1 + matches / len2 + (matches - trans / 2) / matches) / 3;
}

function jaroWinkler(s1, s2) {
  const j = jaro(s1, s2);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

function doubleMetaphone(str) {
  const s = str.toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return ['', ''];
  let primary = '', alternate = '', i = 0;
  const len = s.length;
  if (/^(gn|kn|pn|ae|wr)/.test(s)) i = 1;
  const at = (p) => p >= 0 && p < len ? s[p] : '';
  const sl = (p, n) => s.substring(p, p + n);
  while (i < len && primary.length < 6) {
    const c = s[i];
    switch (c) {
      case 'a': case 'e': case 'i': case 'o': case 'u':
        if (i === 0) { primary += 'A'; alternate += 'A'; } i++; break;
      case 'b': primary += 'P'; alternate += 'P'; i += at(i+1)==='b'?2:1; break;
      case 'c':
        if (sl(i,2)==='ch') { primary+='X'; alternate+='X'; i+=2; }
        else if ('eiy'.includes(at(i+1))) { primary+='S'; alternate+='S'; i++; }
        else { primary+='K'; alternate+='K'; i+=(at(i+1)==='c'||at(i+1)==='k')?2:1; }
        break;
      case 'd':
        if (sl(i,2)==='dh') { primary+='T'; alternate+='T'; i+=2; }
        else { primary+='T'; alternate+='T'; i+=at(i+1)==='d'?2:1; } break;
      case 'f': primary+='F'; alternate+='P'; i+=at(i+1)==='f'?2:1; break;
      case 'g':
        if (sl(i,2)==='gh') { primary+='K'; alternate+='K'; i+=2; }
        else { primary+='K'; alternate+='K'; i+=at(i+1)==='g'?2:1; } break;
      case 'h':
        if ('aeiou'.includes(at(i+1))&&(i===0||!'aeiou'.includes(at(i-1)))) { primary+='H'; alternate+='H'; }
        i++; break;
      case 'j': primary+='J'; alternate+='J'; i+=at(i+1)==='j'?2:1; break;
      case 'k':
        if (sl(i,2)==='kh') { primary+='K'; alternate+='K'; i+=2; }
        else { primary+='K'; alternate+='K'; i+=at(i+1)==='k'?2:1; } break;
      case 'l': primary+='L'; alternate+='L'; i+=at(i+1)==='l'?2:1; break;
      case 'm': primary+='M'; alternate+='M'; i+=at(i+1)==='m'?2:1; break;
      case 'n': primary+='N'; alternate+='N'; i+=at(i+1)==='n'?2:1; break;
      case 'p':
        if (at(i+1)==='h') { primary+='F'; alternate+='P'; i+=2; }
        else { primary+='P'; alternate+='P'; i+=at(i+1)==='p'?2:1; } break;
      case 'q': primary+='K'; alternate+='K'; i+=at(i+1)==='q'?2:1; break;
      case 'r': primary+='R'; alternate+='R'; i+=at(i+1)==='r'?2:1; break;
      case 's':
        if (sl(i,2)==='sh') { primary+='X'; alternate+='S'; i+=2; }
        else { primary+='S'; alternate+='S'; i+=at(i+1)==='s'?2:1; } break;
      case 't':
        if (sl(i,2)==='th') { primary+='T'; alternate+='T'; i+=2; }
        else { primary+='T'; alternate+='T'; i+=at(i+1)==='t'?2:1; } break;
      case 'v': primary+='F'; alternate+='V'; i+=at(i+1)==='v'?2:1; break;
      case 'w': if ('aeiou'.includes(at(i+1))) { primary+='V'; alternate+='V'; } i++; break;
      case 'x': primary+='KS'; alternate+='KS'; i++; break;
      case 'y': if ('aeiou'.includes(at(i+1))) { primary+='Y'; alternate+='Y'; } i++; break;
      case 'z': primary+='J'; alternate+='S'; i+=at(i+1)==='z'?2:1; break;
      default: i++;
    }
  }
  return [primary.substring(0,6), alternate.substring(0,6)];
}

function getThreshold(len) {
  if (len <= 4) return 0.75;
  if (len <= 7) return 0.78;
  return 0.72;
}

function editDistanceLimited(a, b, maxDist) {
  const s = String(a || '');
  const t = String(b || '');
  if (!s || !t) return maxDist + 1;
  if (Math.abs(s.length - t.length) > maxDist) return maxDist + 1;
  const rows = s.length + 1;
  const cols = t.length + 1;
  const dp = new Array(cols);
  for (let j = 0; j < cols; j++) dp[j] = j;
  for (let i = 1; i < rows; i++) {
    let prev = dp[0];
    dp[0] = i;
    let minRow = dp[0];
    for (let j = 1; j < cols; j++) {
      const temp = dp[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + cost
      );
      prev = temp;
      if (dp[j] < minRow) minRow = dp[j];
    }
    if (minRow > maxDist) return maxDist + 1;
  }
  return dp[cols - 1];
}

function stringSimilarity(a, b) {
  const x = String(a || '').replace(/[\u200C\u200D]/g, '').toLowerCase().trim();
  const y = String(b || '').replace(/[\u200C\u200D]/g, '').toLowerCase().trim();
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Both strings must be meaningful length for fuzzy comparison
  if (x.length < 3 || y.length < 3) return 0;
  // Substring match: only meaningful if shorter string is 4+ chars
  const shorter = Math.min(x.length, y.length);
  if ((x.includes(y) || y.includes(x)) && shorter >= 4) return 1;
  if (isKannadaToken(x) || isKannadaToken(y)) return 0;

  // Phonetic normalization comparison — Author: Mohammed Shoaib U
  const xNorm = phoneticNormalize(x);
  const yNorm = phoneticNormalize(y);
  if (xNorm === yNorm && xNorm.length >= 4) return 0.95;
  if (xNorm.startsWith(yNorm) || yNorm.startsWith(xNorm)) {
    if (Math.min(xNorm.length, yNorm.length) >= 4) return 0.88;
  }

  // Edit distance — only for tokens of similar length
  if (Math.abs(x.length - y.length) > 2) return 0;
  const maxLen = Math.max(x.length, y.length);
  const dist = editDistanceLimited(x, y, 2);
  if (dist <= 2 && maxLen >= 5) {
    return Math.max(0, 1 - (dist / maxLen));
  }
  // Try on normalized forms
  if (xNorm.length >= 4 && yNorm.length >= 4) {
    const normDist = editDistanceLimited(xNorm, yNorm, 2);
    if (normDist <= 2) return Math.max(0, 1 - (normDist / Math.max(xNorm.length, yNorm.length)));
  }
  // Jaro-Winkler: designed for name matching, handles insertions well
  if (Math.min(x.length, y.length) >= 4) {
    const jw = jaroWinkler(x, y);
    if (jw >= 0.92) return 0.88;
    if (jw >= 0.82) return 0.75;
  }
  // Double Metaphone: phonetic codes for transliteration variants
  if (x.length >= 3 && y.length >= 3) {
    const [xPri, xAlt] = doubleMetaphone(x);
    const [yPri, yAlt] = doubleMetaphone(y);
    if (xPri && yPri && (xPri === yPri || xPri === yAlt || xAlt === yPri)) return 0.75;
  }
  // Consonant skeleton: strip vowels, collapse doubled consonants, compare
  const xSkel = consonantSkeleton(x);
  const ySkel = consonantSkeleton(y);
  if (xSkel.length >= 2 && xSkel === ySkel && x[0] === y[0] && Math.min(x.length, y.length) >= 4) return 0.75;
  return 0;
}

function bestTokenSimilarity(queryTok, recordTokens) {
  const qt = String(queryTok || '').trim();
  if (!qt) return 0;
  const variants = expandQueryToken(qt).slice(0, 20);
  let best = 0;
  for (const v of variants) {
    const vv = String(v || '').trim();
    if (!vv) continue;
    for (const rt of recordTokens) {
      const sim = stringSimilarity(vv, rt);
      if (sim > best) best = sim;
      if (best >= 1) return 1;
    }
  }
  return best;
}

function scoreNameAgainstRecord(query, recordTokens) {
  const qTokens = tokenizeForScoring(query)
    .map(t => String(t || '').toLowerCase().trim())
    .filter(t => t.length >= 2 && !/^\d+$/.test(t));
  if (!qTokens.length) return -1;

  let primaryIdx = 0;
  let primaryRequired = true;
  if (qTokens.length >= 2 && isSyedSurnameToken(qTokens[0])) primaryIdx = 1;
  if (qTokens.length === 1 && isSyedSurnameToken(qTokens[0])) primaryRequired = false;

  let score = 0;
  let possible = 0;
  for (let i = 0; i < qTokens.length; i++) {
    const qt = qTokens[i];
    const weight = (i === primaryIdx) ? 2.0 : 1.0;
    possible += weight;
    const thresh = getThreshold(qt.length);
    const bestSim = bestTokenSimilarity(qt, recordTokens);
    if (bestSim >= thresh) {
      score += bestSim * weight;
    } else {
      if (i === primaryIdx && primaryRequired) return -1;
      if (bestSim > 0.5) score += bestSim * weight * 0.5;
    }
  }
  const norm = possible > 0 ? (score / possible) : 0;
  if (primaryRequired) {
    const primaryTok = qTokens[primaryIdx];
    const primaryThresh = getThreshold(primaryTok.length);
    const primaryBest = bestTokenSimilarity(primaryTok, recordTokens);
    if (primaryBest < primaryThresh) return -1;
  }
  return norm;
}

// ========== SCORING ENGINE ==========
// NOTE: This scoring logic is the AUTHORITATIVE implementation for single-part/AC searches.
// It handles Indian name nuances (phonetic normalization, synonym expansion, Kannada matching).
// The VoterSearchEngine class (search-engine.js) delegates to SearchUtils.scoreNameMatch for
// worker-based searches. Both paths produce compatible scores.
// For global search, VoterSearchEngine is used directly (see performGlobalSearch).
function scoreVoterRecord(voter, filters) {
  const { voterName, relName, age, relType, gender, voterId } = filters;

  if (voterId) {
    return voter.id && voter.id.toLowerCase() === voterId.toLowerCase() ? 1.0 : -1;
  }

  if (age) {
    const diff = Math.abs(parseInt(age, 10) - parseInt(voter.a, 10));
    if (!isNaN(diff) && diff > 2) return -1;
  }
  if (relType && voter.rt !== relType) return -1;
  if (gender && voter.g !== gender) return -1;

  const voterTokens = Array.isArray(voter.vt) && voter.vt.length
    ? voter.vt.map(x => String(x || '').replace(/[\u200C\u200D]/g, '').toLowerCase())
    : tokenizeForScoring(voter.vn).map(x => x.toLowerCase());

  const relTokens = Array.isArray(voter.rnt) && voter.rnt.length
    ? voter.rnt.map(x => String(x || '').replace(/[\u200C\u200D]/g, '').toLowerCase())
    : tokenizeForScoring(voter.rn).map(x => x.toLowerCase());

  let vScore = voterName ? scoreNameAgainstRecord(voterName, voterTokens) : 0;
  if (voterName && vScore < 0) {
    const legacy = matchesFilters(voter, { voterName, relName: '', age: '', relType: '', gender: '', voterId: '' });
    if (!legacy) return -1;
    vScore = 0.55;
  }

  let rScore = 1.0;
  if (relName) {
    const relS = scoreNameAgainstRecord(relName, relTokens);
    if (relS < 0) {
      const legacyRel = fuzzyMatch(relName, voter.rn) || fuzzyMatch(relName, voter.rk);
      if (!legacyRel) return -1;
      rScore = 0.55;
    } else {
      rScore = relS;
    }
  }

  let combined = relName ? (vScore * 0.7) + (rScore * 0.3) : vScore;
  // Exclude low-quality OCR records entirely — they produce false matches
  if (voter.dq === 0) return -1;
  return combined >= 0.70 ? combined : -1;
}

function fuzzyMatch(query, target) {
  if (!query || !target) return false;
  const q = query.replace(/[\u200C\u200D]/g, '').toLowerCase().trim();
  const t = target.replace(/[\u200C\u200D]/g, '').toLowerCase().trim();

  if (t.includes(q)) return true;

  const variants = (typeof generateVariants === 'function' ? generateVariants(q) : [q])
    .map(v => (v || '').toLowerCase().trim())
    .filter(v => v.length >= 3);
  for (const v of variants) {
    if (t.includes(v)) return true;
  }

  const qTokens = q.split(/\s+/).filter(w => w.length >= 3);
  if (qTokens.length > 1 && qTokens.every(tok => t.includes(tok))) return true;

  // Enhanced phonetic comparison for Indian names — Author: Mohammed Shoaib U
  // Normalizes common transliteration variants before comparing
  const qNorm = phoneticNormalize(q);
  const tNorm = phoneticNormalize(t);
  if (qNorm.length >= 4 && tNorm.includes(qNorm)) return true;

  // Token-level phonetic match: each query token matches a target token phonetically
  if (qTokens.length >= 1) {
    const tTokens = t.split(/\s+/).filter(w => w.length >= 2);
    const allMatch = qTokens.every(qt => {
      const qtNorm = phoneticNormalize(qt);
      return tTokens.some(tt => {
        const ttNorm = phoneticNormalize(tt);
        if (qtNorm === ttNorm) return true;
        if (ttNorm.startsWith(qtNorm) && qtNorm.length >= 4) return true;
        // Allow 1 edit on normalized form for longer tokens
        if (qtNorm.length >= 5) {
          const dist = editDistanceLimited(qtNorm, ttNorm, 1);
          if (dist <= 1) return true;
        }
        return false;
      });
    });
    if (allMatch) return true;
  }

  if (!q.includes(' ') && q.length >= 5 && q.length <= 10) {
    const prefix = t.substring(0, Math.min(t.length, q.length + 2));
    if (prefix && prefix[0] === q[0]) {
      return levenshtein(q, prefix) <= 1;
    }
  }

  return false;
}

/**
 * Phonetic normalization for Indian/Karnataka names.
 * Author: Mohammed Shoaib U
 * 
 * Description: Reduces common transliteration variants to a canonical form.
 * Handles doubled consonants, aspirated forms, vowel length differences,
 * and common f/ph, z/j, k/q interchanges in Karnataka names.
 * 
 * @param {string} str - Input string (already lowercase)
 * @returns {string} Phonetically normalized string
 */
function phoneticNormalize(str) {
  if (!str) return '';
  let s = str.replace(/[^a-z]/g, '');
  // Aspirated → plain
  s = s.replace(/th/g, 't').replace(/dh/g, 'd').replace(/bh/g, 'b');
  s = s.replace(/kh/g, 'k').replace(/gh/g, 'g').replace(/ph/g, 'f');
  s = s.replace(/chh/g, 'ch').replace(/sh/g, 's');
  // Doubled consonants → single
  s = s.replace(/(.)\1/g, '$1');
  // Long vowels → short
  s = s.replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/aa/g, 'a');
  s = s.replace(/ai/g, 'e').replace(/ou/g, 'u').replace(/ei/g, 'e');
  // Common interchanges
  s = s.replace(/z/g, 'j').replace(/q/g, 'k').replace(/x/g, 'ks');
  // Trailing vowels normalized
  s = s.replace(/[aeiou]+$/, 'a');
  return s;
}

// levenshtein is provided by search-utils.js (loaded before app.js).
// No redeclaration needed — the global is already available.

function renderResults({ isPartial, searched, total, voterName }) {
  const container = document.getElementById('div-db-results');
  const count = dbState.allResults.length;
  const toShow = dbState.allResults.slice(0, dbState.PAGE_SIZE);
  dbState.displayedCount = toShow.length;

  const countText = isPartial
    ? `Found ${count}+ matches (searching ${searched}/${total} parts...)`
    : `Found ${count} voter${count !== 1 ? 's' : ''} matching "${voterName}" across ${total} parts`;

  const remaining = count - dbState.PAGE_SIZE;

  container.innerHTML = `
    <div class="results-disclaimer">
      <div>🔤 <strong>English names are transliterated from Kannada text</strong> and may contain spelling variations.</div>
    </div>
    <div class="results-header">
      <span class="results-count">${countText}</span>
    </div>
    <div id="results-grid">
      ${toShow.map(v => renderVoterCard(v)).join('')}
    </div>
    ${count > dbState.PAGE_SIZE ? `
      <div class="load-more-row">
        <button class="btn btn-outline btn-sm load-more-btn" id="btn-load-more">
          Load ${Math.min(dbState.PAGE_SIZE, remaining)} more | ಇನ್ನಷ್ಟು ತೋರಿಸಿ (${remaining} remaining)
        </button>
      </div>` : ''}
  `;

  // CSP-compliant event binding (no inline onclick)
  const loadMoreBtn = document.getElementById('btn-load-more');
  if (loadMoreBtn) loadMoreBtn.addEventListener('click', loadMoreResults);

  // Announce results to screen readers
  const announcement = document.getElementById('search-result-announcement');
  if (announcement) {
    announcement.textContent = isPartial
      ? `Searching: found ${count} matches so far`
      : `Search complete: found ${count} voter${count !== 1 ? 's' : ''}`;
  }
}

function loadMoreResults() {
  const next = dbState.allResults.slice(dbState.displayedCount, dbState.displayedCount + dbState.PAGE_SIZE);
  const grid = document.getElementById('results-grid');
  if (!grid) return;
  grid.insertAdjacentHTML('beforeend', next.map(v => renderVoterCard(v)).join(''));
  dbState.displayedCount += next.length;
  if (dbState.displayedCount >= dbState.allResults.length) {
    const btn = document.querySelector('.load-more-btn');
    if (btn) btn.parentElement.remove();
  }
}

function renderVoterCard(voter) {
  const relTypeLabel = { 'F': 'Father | ತಂದೆ', 'H': 'Husband | ಗಂಡ', 'M': 'Mother | ತಾಯಿ', 'W': 'Wife | ಹೆಂಡತಿ' }[voter.rt] || voter.rt || '';
  const genderLabel = voter.g === 'M' ? '👨 Male | ಗಂಡಸು' : '👩 Female | ಹೆಂಗಸು';
  const voterId = voter.id ? `<div class="result-field"><label>Voter ID | EPIC</label><div class="val small" style="font-family:monospace">${_esc(voter.id)}</div></div>` : '';
  const acNum = voter.ac != null ? String(voter.ac) : (dbState.selectedAC || '');
  const partNum = voter.pn != null ? String(voter.pn) : (dbState.selectedPart != null ? String(dbState.selectedPart) : '');
  // Confidence badge
  const cf = voter.cf;
  let confBadge = '';
  if (cf != null) {
    const confClass = cf >= 85 ? 'conf-high' : cf >= 70 ? 'conf-mid' : 'conf-low';
    const confLabel = cf >= 85 ? '✓ High confidence' : cf >= 70 ? '~ Moderate' : '⚠ Low confidence';
    confBadge = `<span class="conf-badge ${confClass}" title="OCR confidence: ${Math.round(cf)}%">${confLabel}</span>`;
  }
  const thisMeBtn = (acNum && partNum && (voter.sn != null))
    ? `<div class="result-actions">
         <button class="btn btn-success btn-sm btn-this-is-me"
           data-ac="${encodeURIComponent(acNum)}"
           data-part="${encodeURIComponent(partNum)}"
           data-serial="${encodeURIComponent(String(voter.sn ?? ''))}"
           data-psn="${encodeURIComponent(String(voter.psn ?? ''))}"
           data-name="${encodeURIComponent(voter.vk || '')}"
           data-rel="${encodeURIComponent(voter.rk || '')}"
           data-id="${encodeURIComponent(voter.id || '')}"
         >✅ This is me / Found</button>
         <span style="font-size:12px;color:var(--gray-400)">Not you? Check next result →</span>
       </div>`
    : '';

  return `
    <div class="result-card" tabindex="0" role="article" aria-label="Voter: ${_esc(voter.vn || voter.vk || '')}">
      ${confBadge}
      <div class="result-grid">
        <div class="result-field">
          <label>Name | ಹೆಸರು</label>
          <div class="val voter-name-kn">${_esc(voter.vk) || '—'}</div>
          <div class="voter-name-en">${_esc(voter.vn) || ''}</div>
        </div>
        <div class="result-field">
          <label>${relTypeLabel || 'Relative Name | ಸಂಬಂಧಿತರ ಹೆಸರು'}</label>
          <div class="val voter-name-kn">${_esc(voter.rk) || '—'}</div>
          <div class="voter-name-en">${_esc(voter.rn) || ''}</div>
        </div>
        <div class="result-field"><label>Serial No. | ಕ್ರಮ ಸಂಖ್ಯೆ</label><div class="val">${_esc(voter.sn) ?? '—'}</div></div>
        <div class="result-field"><label>Part Serial No. | ಭಾಗ ಕ್ರಮ ಸಂಖ್ಯೆ</label><div class="val monospace highlight">${_esc(voter.psn) || '—'}</div></div>
        <div class="result-field"><label>AC / Part | ಕ್ಷೇತ್ರ / ಭಾಗ</label><div class="val">${acNum ? `AC ${_esc(acNum)}` : '—'}${partNum ? ` · Part ${_esc(partNum)}` : ''}</div></div>
        <div class="result-field"><label>House No. | ಮನೆ ಸಂಖ್ಯೆ</label><div class="val">${_esc(voter.hn) || '—'}</div></div>
        <div class="result-field">
          <label>Gender / Age | ಲಿಂಗ / ವಯಸ್ಸು</label>
          <div class="val">
            <span class="tag ${voter.g === 'M' ? 'tag-male' : 'tag-female'}">${genderLabel}</span>
            <span class="tag tag-age">${voter.a != null ? `${_esc(String(voter.a))} yrs` : '—'}</span>
          </div>
        </div>
        ${voterId}
      </div>
      ${thisMeBtn}
      ${voter.dq === 0 ?
        '<div class="data-quality-warn">' +
        '⚠️ Details may be incomplete — ' +
        'verify from official rolls | ' +
        'ಈ ವಿವರಗಳು ಅಪೂರ್ಣವಾಗಿರಬಹುದು' +
        '</div>'
      : ''}
    </div>
  `;
}

function formatAcLabel(districtKey, acNum, fallbackName) {
  const n = parseInt(acNum, 10);
  const dKey = String(districtKey || '').toUpperCase().replace(/_/g, ' ');
  const code = 'A' + String(isNaN(n) ? acNum : n).padStart(3, '0');
  const list = AC_DATA[dKey] || [];
  const hit = list.find(x => (x && x.num) === code);
  if (hit && hit.name) return `${isNaN(n) ? acNum : n} - ${hit.name}`;
  const fb = (fallbackName || '').trim();
  return isNaN(n) ? (fb || String(acNum)) : (fb || String(n));
}

document.addEventListener('click', function (e) {
  const btn = e.target && e.target.closest ? e.target.closest('.btn-this-is-me') : null;
  if (!btn) return;
  const ac = decodeURIComponent(btn.getAttribute('data-ac') || '');
  const part = decodeURIComponent(btn.getAttribute('data-part') || '');
  const serial = decodeURIComponent(btn.getAttribute('data-serial') || '');
  const psn = decodeURIComponent(btn.getAttribute('data-psn') || '');
  const name = decodeURIComponent(btn.getAttribute('data-name') || '');
  const rel = decodeURIComponent(btn.getAttribute('data-rel') || '');
  const vid = decodeURIComponent(btn.getAttribute('data-id') || '');
  const acCode = ac.startsWith('A') ? ac : ('A' + String(ac).padStart(3, '0'));
  onSuccess(acCode, part, name || '—', rel || '—', serial || '—', vid || '', psn || '');
});

function showNoResults(voterName, relName) {
  const v = voterName || '—';
  const r = relName || '';
  const tokens = tokenizeForScoring(voterName || '').map(t => t.toLowerCase()).filter(t => t.length >= 2);
  const expanded = tokens.slice(0, 6).map(t => expandQueryToken(t).slice(0, 8).join('/'));
  document.getElementById('div-db-results').innerHTML = `
    <div class="result-card">
      <div style="font-size:16px;font-weight:800;color:var(--gray-800);margin-bottom:6px">
        No results found | ಯಾವುದೇ ಮತದಾರರು ಕಂಡುಬಂದಿಲ್ಲ
      </div>
      <div style="color:var(--gray-600);font-size:14px;margin-bottom:10px">
        No voters found for "<strong>${v}</strong>" ${r ? `with relative "<strong>${r}</strong>"` : ''}
      </div>
      ${expanded.length ? `
        <div style="font-size:12px;color:var(--gray-600);margin-bottom:10px">
          Searched tokens: <span style="font-family:'JetBrains Mono',monospace">${expanded.join(', ')}</span>
        </div>` : ''
      }
      <div style="font-weight:800;color:var(--gray-800);font-size:13px;margin-bottom:6px">Search tips | ಹುಡುಕಾಟ ಸಲಹೆಗಳು:</div>
      <ul style="margin:0;padding-left:18px;color:var(--gray-600);font-size:13px;line-height:1.6">
        <li>Try a shorter name (first word only) | ಚಿಕ್ಕ ಹೆಸರು ಪ್ರಯತ್ನಿಸಿ</li>
        <li>Muslim names may vary (Abdul/Abdur, Mohammad/Mohammed) | ಮುಸ್ಲಿಂ ಹೆಸರುಗಳಲ್ಲಿ ವ್ಯತ್ಯಾಸ ಸಾಧ್ಯ</li>
        <li>Remove Part filter | ಭಾಗ ಫಿಲ್ಟರ್ ತೆಗೆದುಹಾಕಿ</li>
        <li>Check Father/Husband spelling | ಸಂಬಂಧಿತರ ಹೆಸರಿನ ಸ್ಪೆಲ್ಲಿಂಗ್ ಪರಿಶೀಲಿಸಿ</li>
        <li>Try searching in Kannada | ಕನ್ನಡದಲ್ಲಿಯೇ ಹುಡುಕಿ</li>
      </ul>
    </div>
  `;
}

function installSearchRouter() {
  if (window.__searchRouterInstalled) return;
  window.__searchRouterInstalled = true;

  const original = window.performSearch;
  if (typeof original === 'function') window.__ocrPerformSearch = original;

  const ocrBtn = document.getElementById('searchBtn');
  if (ocrBtn) ocrBtn.addEventListener('click', () => { window.__searchMode = 'ocr'; }, true);

  const focusIdsOcr = ['searchName', 'searchRelative', 'searchHouse', 'searchAge'];
  focusIdsOcr.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('focus', () => { window.__searchMode = 'ocr'; }, true);
  });

  const focusIdsDb = ['inp-voter-name', 'inp-relative-name', 'inp-age', 'sel-rel-type', 'sel-gender', 'inp-voter-id', 'sel-district', 'sel-ac', 'sel-part'];
  focusIdsDb.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('focus', () => { window.__searchMode = 'db'; }, true);
  });

  window.performSearch = async function () {
    const mode = window.__searchMode || inferSearchMode();
    if (mode === 'db') return performDBSearch();
    if (typeof window.__ocrPerformSearch === 'function') return window.__ocrPerformSearch();
  };
}

function inferSearchMode() {
  const ae = document.activeElement ? document.activeElement.id : '';
  if (ae && (ae.startsWith('inp-') || ae.startsWith('sel-') || ae === 'btn-search' || ae === 'btn-clear')) return 'db';
  if (ae && ae.startsWith('search')) return 'ocr';

  const dbName = (document.getElementById('inp-voter-name')?.value || '').trim();
  const ocrName = (document.getElementById('searchName')?.value || '').trim();
  if (dbName && !ocrName) return 'db';
  return 'ocr';
}

function toggleAdvancedFilters() {
  const row = document.getElementById('row-advanced-filters');
  const lnk = document.getElementById('lnk-advanced-filters');
  if (!row || !lnk) return;
  const isOpen = row.style.display !== 'none';
  if (isOpen) {
    row.style.opacity = '0';
    row.style.transform = 'translateY(-8px)';
    setTimeout(() => { row.style.display = 'none'; }, 200);
  } else {
    row.style.display = 'grid';
    row.style.opacity = '0';
    row.style.transform = 'translateY(-8px)';
    requestAnimationFrame(() => {
      row.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
      row.style.opacity = '1';
      row.style.transform = 'translateY(0)';
    });
  }
  lnk.textContent = isOpen ? '▼ Advanced Filters | ಹೆಚ್ಚಿನ ಫಿಲ್ಟರ್' : '▲ Advanced Filters | ಹೆಚ್ಚಿನ ಫಿಲ್ಟರ್';
}

function showBanner(type, message) {
  const banner = document.getElementById('div-status-banner');
  if (!banner) return;
  let cls = 'alert alert-info';
  if (type === 'green') cls = 'alert alert-success';
  else if (type === 'yellow') cls = 'alert alert-warning';
  else if (type === 'blue') cls = 'alert alert-info';
  else if (type === 'error') cls = 'alert alert-error';
  banner.className = cls;
  banner.textContent = message;
  banner.style.display = 'flex';
}

function hideBanner() {
  const banner = document.getElementById('div-status-banner');
  if (banner) banner.style.display = 'none';
}

function showProgress(text, pct = null) {
  const div = document.getElementById('div-search-progress');
  if (!div) return;
  div.style.display = 'block';
  const t = div.querySelector('.progress-text');
  if (t) t.textContent = text;
  if (pct !== null) {
    const fill = div.querySelector('.progress-bar-fill');
    if (fill) fill.style.width = `${pct}%`;
  }
}

function hideProgress() {
  const div = document.getElementById('div-search-progress');
  if (div) div.style.display = 'none';
}

function showSkeletonResults(count) {
  const container = document.getElementById('div-db-results');
  if (!container) return;
  var skeletons = '';
  for (var i = 0; i < count; i++) {
    skeletons += '<div class="result-card skeleton-card" aria-hidden="true">' +
      '<div class="skeleton-line skeleton-wide"></div>' +
      '<div class="skeleton-line skeleton-medium"></div>' +
      '<div class="skeleton-line skeleton-short"></div>' +
      '</div>';
  }
  container.innerHTML = '<div id="results-grid">' + skeletons + '</div>';
}

function hideSkeletonResults() {
  var skeletons = document.querySelectorAll('.skeleton-card');
  skeletons.forEach(function(el) { el.remove(); });
}

document.addEventListener('DOMContentLoaded', initDBSearch);

// ========== LAZY VIDEO LOADING ==========
// Replaces thumbnail+play button with real iframe on click (saves ~2-3MB initial load)
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.video-lazy').forEach(function(el) {
    function loadVideo() {
      var videoId = el.getAttribute('data-video-id');
      if (!videoId) return;
      var iframe = document.createElement('iframe');
      iframe.src = 'https://www.youtube.com/embed/' + encodeURIComponent(videoId) + '?autoplay=1';
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('allow', 'autoplay; encrypted-media');
      iframe.title = el.getAttribute('aria-label') || '';
      el.innerHTML = '';
      el.classList.remove('video-lazy');
      el.appendChild(iframe);
    }
    el.addEventListener('click', loadVideo);
    el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadVideo(); }
    });
  });
});

// ========== KEYBOARD NAVIGATION ==========
// Arrow keys navigate between result cards; Escape closes modals
document.addEventListener('keydown', function(e) {
  // Escape to close modals
  if (e.key === 'Escape') {
    var modal = document.getElementById('successModal');
    if (modal && modal.style.display !== 'none' && modal.classList.contains('show')) {
      var closeBtn = document.getElementById('btn-close-modal');
      if (closeBtn) closeBtn.click();
      return;
    }
    var fbOverlay = document.getElementById('feedbackModalOverlay');
    if (fbOverlay && fbOverlay.classList.contains('show')) {
      var cancelBtn = document.getElementById('btn-cancel-feedback');
      if (cancelBtn) cancelBtn.click();
      return;
    }
  }
  // Arrow navigation in results grid
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    var cards = document.querySelectorAll('.result-card[tabindex]');
    if (!cards.length) return;
    var current = document.activeElement;
    var idx = Array.prototype.indexOf.call(cards, current);
    if (idx === -1) return;
    e.preventDefault();
    var next = e.key === 'ArrowDown' ? Math.min(idx + 1, cards.length - 1) : Math.max(idx - 1, 0);
    cards[next].focus();
  }
});

function initDistrictVote() {
  const sel = document.getElementById('sel-vote-district');
  const btn = document.getElementById('btn-vote-district');
  const counter = document.getElementById('vote-counter');
  const top = document.getElementById('vote-top');
  if (!sel || !btn || !counter || !top) return;

  const KEY = 'district_vote_counts_v1';
  const readCounts = () => {
    try {
      const raw = localStorage.getItem(KEY);
      const obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === 'object') ? obj : {};
    } catch {
      return {};
    }
  };
  const writeCounts = (obj) => {
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch {}
  };

  const render = () => {
    const counts = readCounts();
    const total = Object.values(counts).reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
    counter.textContent = `Votes: ${total.toLocaleString()}`;
    const entries = Object.entries(counts).sort((a, b) => (parseInt(b[1], 10) || 0) - (parseInt(a[1], 10) || 0));
    if (!entries.length || (parseInt(entries[0][1], 10) || 0) === 0) {
      top.textContent = 'Top voted district: —';
      return;
    }
    const [name, cnt] = entries[0];
    top.textContent = `Top voted district: ${name} (${(parseInt(cnt, 10) || 0).toLocaleString()})`;
  };

  btn.addEventListener('click', () => {
    const d = sel.value;
    if (!d) return;
    const counts = readCounts();
    counts[d] = (parseInt(counts[d], 10) || 0) + 1;
    writeCounts(counts);
    render();
  });

  render();
}

document.addEventListener('DOMContentLoaded', initDistrictVote);

// ====================================================================
// DATA: DISTRICTS & ASSEMBLY CONSTITUENCIES
// ====================================================================
const AC_DATA = {
  "BAGALKOT": [
    {name:"Jamkhandi",num:"A210"},{name:"Bilgi",num:"A211"},{name:"Mudhol",num:"A212"},
    {name:"Bagalkot",num:"A213"},{name:"Badami",num:"A214"},{name:"Gulegud",num:"A215"},{name:"Hungund",num:"A216"}
  ],
  "BANGALORE RURAL": [
    {name:"Kanakapura",num:"A091"},{name:"Sathanur",num:"A092"},{name:"Channapatna",num:"A093"},
    {name:"Ramanagar",num:"A094"},{name:"Magadi",num:"A095"},{name:"Nelamangala",num:"A096"},
    {name:"Doddaballapur",num:"A097"},{name:"Devanahalli",num:"A098"},{name:"Hosakote",num:"A099"}
  ],
  "BANGALORE URBAN": [
    {name:"Yelahanka",num:"A088"},{name:"Uttarahalli",num:"A089"},{name:"Varthur",num:"A090"},{name:"Anekal",num:"A100"}
  ],
  "BBMP": [
    {name:"Malleshwaram",num:"A076"},{name:"Rajaji Nagar",num:"A077"},{name:"Gandhi Nagar",num:"A078"},
    {name:"Chickpet",num:"A079"},{name:"Binnypet",num:"A080"},{name:"Chamrajpet",num:"A081"},
    {name:"Basavanagudi",num:"A082"},{name:"Jayanagar",num:"A083"},{name:"Shanti Nagar",num:"A084"},
    {name:"Shivajinagar",num:"A085"},{name:"Bharathinagar",num:"A086"},{name:"Jayamahal",num:"A087"}
  ],
  "BELGAUM": [
    {name:"Ramdurg",num:"A192"},{name:"Saundatti",num:"A193"},{name:"Bailhongal",num:"A194"},
    {name:"Kittur",num:"A195"},{name:"Khanapur",num:"A196"},{name:"Belgaum",num:"A197"},
    {name:"Uchagaon",num:"A198"},{name:"Bagewadi",num:"A199"},{name:"Gokak",num:"A200"},
    {name:"Arabhavi",num:"A201"},{name:"Hukkeri",num:"A202"},{name:"Sankeshwar",num:"A203"},
    {name:"Nippani",num:"A204"},{name:"Sadalga",num:"A205"},{name:"Chikkodi",num:"A206"},
    {name:"Raibag",num:"A207"},{name:"Kagwad",num:"A208"},{name:"Athani",num:"A209"}
  ],
  "BELLARY": [
    {name:"Siruguppa",num:"A031"},{name:"Kurugodu",num:"A032"},{name:"Bellary",num:"A033"},
    {name:"Hospet",num:"A034"},{name:"Sandur",num:"A035"},{name:"Kudligi",num:"A036"},
    {name:"Kottur",num:"A037"},{name:"Hadagali",num:"A038"}
  ],
  "BIDAR": [
    {name:"Aurad",num:"A001"},{name:"Bhalki",num:"A002"},{name:"Hulsoor",num:"A003"},
    {name:"Bidar",num:"A004"},{name:"Humnabad",num:"A005"},{name:"Basavakalyan",num:"A006"}
  ],
  "BIJAPURA": [
    {name:"Muddebihal",num:"A217"},{name:"Huvina Hipparagi",num:"A218"},{name:"Basavana Bagevadi",num:"A219"},
    {name:"Tikota",num:"A220"},{name:"Bijapur",num:"A221"},{name:"Ballolli",num:"A222"},
    {name:"Indi",num:"A223"},{name:"Sindagi",num:"A224"}
  ],
  "CHAMARAJANAGAR": [
    {name:"Hanur",num:"A110"},{name:"Kollegal",num:"A111"},{name:"Santhemarahalli",num:"A119"},
    {name:"Chamarajanagar",num:"A120"},{name:"Gundlupet",num:"A121"}
  ],
  "CHIKKAMAGALURU": [
    {name:"Sringeri",num:"A152"},{name:"Mudigere",num:"A153"},{name:"Chikmagalur",num:"A154"},
    {name:"Birur",num:"A155"},{name:"Kadur",num:"A156"},{name:"Tarikere",num:"A157"}
  ],
  "CHITRADURGA": [
    {name:"Bharamasagara",num:"A043"},{name:"Chitradurga",num:"A044"},{name:"Molakalmuru",num:"A046"},
    {name:"Challakere",num:"A047"},{name:"Hiriyur",num:"A048"},{name:"Holalkere",num:"A049"},{name:"Hosadurga",num:"A050"}
  ],
  "DAKSHINA KANNADA": [
    {name:"Sullia",num:"A137"},{name:"Puttur",num:"A138"},{name:"Vittla",num:"A139"},
    {name:"Belthangady",num:"A140"},{name:"Bantval",num:"A141"},{name:"Mangalore",num:"A142"},
    {name:"Ullal",num:"A143"},{name:"Surathkal",num:"A144"},{name:"Moodabidri",num:"A151"}
  ],
  "DAVANGERE": [
    {name:"Harapanahalli",num:"A039"},{name:"Harihar",num:"A040"},{name:"Davanagere",num:"A041"},
    {name:"Mayakonda",num:"A042"},{name:"Jagalur",num:"A045"},{name:"Channagiri",num:"A158"},{name:"Honnali",num:"A161"}
  ],
  "DHARWAD": [
    {name:"Dharwad Rural",num:"A174"},{name:"Dharwad",num:"A175"},{name:"Hubli",num:"A176"},
    {name:"Hubli Rural",num:"A177"},{name:"Kalghatgi",num:"A178"},{name:"Kundgol",num:"A179"},{name:"Navalgund",num:"A191"}
  ],
  "GADAG": [
    {name:"Shirahatti",num:"A186"},{name:"Mundargi",num:"A187"},{name:"Gadag",num:"A188"},
    {name:"Ron",num:"A189"},{name:"Nargund",num:"A190"}
  ],
  "GULBARGA": [
    {name:"Chincholi",num:"A007"},{name:"Kamalapur",num:"A008"},{name:"Aland",num:"A009"},
    {name:"Gulbarga",num:"A010"},{name:"Shahabad",num:"A011"},{name:"Afzalpur",num:"A012"},
    {name:"Chittapur",num:"A013"},{name:"Sedam",num:"A014"},{name:"Jevargi",num:"A015"},
    {name:"Gurmitkal",num:"A016"},{name:"Yadgir",num:"A017"},{name:"Shahapur",num:"A018"},{name:"Shorapur",num:"A019"}
  ],
  "HASSAN": [
    {name:"Belur",num:"A129"},{name:"Arsikere",num:"A130"},{name:"Gandasi",num:"A131"},
    {name:"Shravanabelagola",num:"A132"},{name:"Holenarasipur",num:"A133"},{name:"Arkalgud",num:"A134"},
    {name:"Hassan",num:"A135"},{name:"Sakleshpur",num:"A136"}
  ],
  "HAVERI": [
    {name:"Shiggaon",num:"A180"},{name:"Hangal",num:"A181"},{name:"Hirekerur",num:"A182"},
    {name:"Ranibennur",num:"A183"},{name:"Byadgi",num:"A184"},{name:"Haveri",num:"A185"}
  ],
  "KODAGU": [{name:"Virajpet",num:"A126"},{name:"Madikeri",num:"A127"},{name:"Somwarpet",num:"A128"}],
  "KOLAR": [
    {name:"Gauribidanur",num:"A064"},{name:"Chikballapur",num:"A065"},{name:"Sidlaghatta",num:"A066"},
    {name:"Bagepalli",num:"A067"},{name:"Chintamani",num:"A068"},{name:"Srinivasapur",num:"A069"},
    {name:"Mulbagal",num:"A070"},{name:"Kolar Gold Field",num:"A071"},{name:"Bethamangala",num:"A072"},
    {name:"Kolar",num:"A073"},{name:"Vemagal",num:"A074"},{name:"Malur",num:"A075"}
  ],
  "KOPPAL": [
    {name:"Kushtagi",num:"A026"},{name:"Yelburga",num:"A027"},{name:"Kanakagiri",num:"A028"},
    {name:"Gangawati",num:"A029"},{name:"Koppal",num:"A030"}
  ],
  "MANDYA": [
    {name:"Nagamangala",num:"A101"},{name:"Maddur",num:"A102"},{name:"Kiragaval",num:"A103"},
    {name:"Malavalli",num:"A104"},{name:"Mandya",num:"A105"},{name:"Keragodu",num:"A106"},
    {name:"Shrirangapattana",num:"A107"},{name:"Pandavapura",num:"A108"},{name:"Krishnarajpete",num:"A109"}
  ],
  "MYSORE": [
    {name:"Bannur",num:"A112"},{name:"T. Narasipur",num:"A113"},{name:"Krishnaraja",num:"A114"},
    {name:"Chamaraja",num:"A115"},{name:"Narasimharaja",num:"A116"},{name:"Chamundeshwari",num:"A117"},
    {name:"Nanjangud",num:"A118"},{name:"Heggadadevankote",num:"A122"},{name:"Hunsur",num:"A123"},
    {name:"Krishnarajanagara",num:"A124"},{name:"Periyapatna",num:"A125"}
  ],
  "RAICHUR": [
    {name:"Devadurga",num:"A020"},{name:"Raichur",num:"A021"},{name:"Kalmala",num:"A022"},
    {name:"Manvi",num:"A023"},{name:"Lingsugur",num:"A024"},{name:"Sindhanur",num:"A025"}
  ],
  "SHIVAMOGGA": [
    {name:"Holehonnur",num:"A159"},{name:"Bhadravati",num:"A160"},{name:"Shimoga",num:"A162"},
    {name:"Tirthahalli",num:"A163"},{name:"Hosanagar",num:"A164"},{name:"Sagar",num:"A165"},
    {name:"Sorab",num:"A166"},{name:"Shikaripura",num:"A167"}
  ],
  "TUMKUR": [
    {name:"Pavagada",num:"A051"},{name:"Sira",num:"A052"},{name:"Kalambella",num:"A053"},
    {name:"Bellavi",num:"A054"},{name:"Madhugiri",num:"A055"},{name:"Koratagere",num:"A056"},
    {name:"Tumkur",num:"A057"},{name:"Kunigal",num:"A058"},{name:"Huliyurdurga",num:"A059"},
    {name:"Gubbi",num:"A060"},{name:"Turuvekere",num:"A061"},{name:"Tiptur",num:"A062"},{name:"Chikkanayakanahalli",num:"A063"}
  ],
  "UDUPI": [
    {name:"Kapu",num:"A145"},{name:"Udupi",num:"A146"},{name:"Brahmavar",num:"A147"},
    {name:"Kundapura",num:"A148"},{name:"Byndoor",num:"A149"},{name:"Karkala",num:"A150"}
  ],
  "UTTAR KANNADA": [
    {name:"Sirsi",num:"A168"},{name:"Bhatkal",num:"A169"},{name:"Kumta",num:"A170"},
    {name:"Ankola",num:"A171"},{name:"Karwar",num:"A172"},{name:"Haliyal",num:"A173"}
  ]
};

// ====================================================================
// TRANSLITERATION — Latin phonetic to Kannada variants
// ====================================================================
const TRANSLITERATION_MAP = {
  // ---- Muslim / Urdu names ----
  "syed":       ["ಸ್ಯೆಯದ್","ಸೈಯದ್","ಸಯ್ಯದ್","ಸ್ಯೆಯದ"],
  "umar":       ["ಉಮರ್","ಉಮರ","ಉಮ್ಮರ್","ಉಮ್ಮರ"],
  "omar":       ["ಉಮರ್","ಉಮರ","ಓಮರ್"],
  "syeda":      ["ಸ್ಯೆಯದಾ","ಸೈಯದಾ","ಸ್ಯೆದಾ"],
  "khan":       ["ಖಾನ್","ಖಾನ","ಖಾನ್ ","ಖಾನ "],
  "khanum":     ["ಖಾನಂ","ಖಾನುಂ","ಖಾನಮ್"],
  "pasha":      ["ಪಾಶ","ಪಾಷ","ಬಾಶ","ಬಾಷ"],
  "basha":      ["ಬಾಶ","ಬಾಷ","ಬಾಸ","ಪಾಶ"],
  "mohammed":   ["ಮಹಮದ್","ಮೊಹಮ್ಮದ್","ಮುಹಮ್ಮದ್","ಮಹಮ್ಮದ","ಮೊಹಮದ್","ಮಹಮ್ಮದ್","ಮೊಹಮ್ಮದ"],
  "mohammad":   ["ಮಹಮದ್","ಮೊಹಮ್ಮದ್","ಮೊಹಮದ್","ಮಹಮ್ಮದ್"],
  "mohamad":    ["ಮಹಮದ್","ಮೊಹಮದ್"],
  "mohamed":    ["ಮಹಮದ್","ಮೊಹಮದ್","ಮುಹಮ್ಮದ್"],
  "muhammed":   ["ಮುಹಮ್ಮದ್","ಮಹಮದ್"],
  "banu":       ["ಬಾನು","ಬಾನ್","ಭಾನು","ಬಾನ"],
  "begum":      ["ಬೇಗಂ","ಬೇಗಮ್","ಬೇಗುಂ","ಬೀಗಂ","ಬೇಗಂ","ಬೇಗಮ"],
  "akram":      ["ಅಕ್ರಮ್","ಅಕ್ರಮ"],
  "bibi":       ["ಬೀಬಿ","ಬಿಬಿ"],
  "shabana":    ["ಶಬಾನ","ಶಬಾನ","ಷಬಾನ","ಶಬಾನಾ"],
  "fatima":     ["ಫಾತಿಮ","ಫಾತಿಮ","ಫಾತ್ಮಾ","ಫಾತಿಮಾ"],
  "abdul":      ["ಅಬ್ದುಲ್","ಅಬ್ಬೂಲ್","ಅಬ್ದುಲ"],
  "ibrahim":    ["ಇಬ್ರಾಹಿಂ","ಇಬ್ರಾಹಿಮ್"],
  "hassan":     ["ಹಸನ್","ಹಸನ","ಹಾಸನ್"],
  "hussain":    ["ಹುಸೇನ್","ಹುಸೈನ್","ಹುಸ್ಸೇನ್"],
  "hussein":    ["ಹುಸೇನ್","ಹುಸೈನ್"],
  "imaam":      ["ಇಮಾಮ್","ಇಮಾಮ"],
  "imam":       ["ಇಮಾಮ್","ಇಮಾಮ"],
  "nazeer":     ["ನಜೀರ್","ನಜೀರ"],
  "nazar":      ["ನಜರ್","ನಜ಼ರ"],
  "rasheed":    ["ರಶೀದ್","ರಶೀದ"],
  "rashid":     ["ರಶೀದ್","ರಾಷಿದ್"],
  "saleem":     ["ಸಲೀಮ್","ಸಲೀಮ"],
  "salim":      ["ಸಲೀಮ್","ಸಲಿಮ್"],
  "shareef":    ["ಶರೀಫ್","ಷರೀಫ್"],
  "sharif":     ["ಶರೀಫ್","ಷರೀಫ್"],
  "shabbir":    ["ಶಬ್ಬೀರ್","ಸಬ್ಬೀರ"],
  "jabeer":     ["ಜಬೀರ್","ಜಬೀರ"],
  "jabir":      ["ಜಬೀರ್","ಜಾಬಿರ"],
  "kareem":     ["ಕರೀಮ","ಕರೀಮ್"],
  "karim":      ["ಕರೀಮ","ಕರಿಮ್"],
  "rahim":      ["ರಹೀಮ","ರಹಿಮ್"],
  "raheem":     ["ರಹೀಮ","ರಹೀಮ್"],
  "aminabi":    ["ಅಮೀನಾ ಬಿ","ಅಮೀನಾಬಿ"],
  "amina":      ["ಅಮೀನಾ","ಅಮಿನ"],
  "aisha":      ["ಐಶ","ಆಯಿಶ"],
  "ayesha":     ["ಐಶ","ಅಯೇಶಾ"],
  "sakeena":    ["ಸಕೀನ","ಸಖೀನ"],
  "zubaida":    ["ಜುಬೇದಾ","ಜ಼ುಬೈದ"],
  "zubeida":    ["ಜುಬೇದಾ","ಜ಼ುಬೈದ"],
  "mujeer":     ["ಮುಜೀರ","ಮುಜೀರ್"],
  "fayaz":      ["ಫಯಾಜ","ಫಯಾಜ್"],
  "faiyaz":     ["ಫಯಾಜ","ಫಯ್ಯಾಜ"],
  "noorulla":   ["ನೂರುಲ್ಲ","ನೂರ್ ಉಲ್ಲ"],
  "noorullakhan":["ನೂರುಲ್ಲಾಖಾನ್","ನೂರ್ ಉಲ್ಲ ಖಾನ"],
  "khillemualla":["ಖಿಲೇಮುಲ್ಲ","ಖಿಲೇಮುಲ್ಲಾ"],
  "sultana":    ["ಸುಲ್ತಾನ","ಸುಲ್ಥಾನ"],
  "sultan":     ["ಸುಲ್ತಾನ","ಸುಲ್ಥಾನ"],
  "majeed":     ["ಮಜೀದ","ಮಜೀದ್"],
  "taher":      ["ತಾಹೆರ","ತಾಹಿರ"],
  "tahir":      ["ತಾಹಿರ","ತಾಹೆರ"],
  "wahab":      ["ವಹಾಬ","ವಾಹಬ"],
  "waliulla":   ["ವಲೀಉಲ್ಲ","ವಲಿ ಉಲ್ಲ"],
  // ---- Hindu / Kannada names ----
  "kumar":      ["ಕುಮಾರ್","ಕುಮಾರ"],
  "lakshmi":    ["ಲಕ್ಷ್ಮಿ","ಲಕ್ಷ್ಮಮ್ಮ","ಲಕ್ಷ್ಮೀ"],
  "venkatesh":  ["ವೆಂಕಟೇಶ್","ವೆಂಕಟೇಶ"],
  "narayana":   ["ನಾರಾಯಣ","ನಾರಾಯಣ್"],
  "ramesh":     ["ರಮೇಶ್","ರಮೇಶ"],
  "suresh":     ["ಸುರೇಶ್","ಸುರೇಶ"],
  "shivakumar": ["ಶಿವಕುಮಾರ್","ಶಿವಕುಮಾರ"],
  "manjula":    ["ಮಂಜುಲ","ಮಂಜುಳ"],
  "rajesh":     ["ರಾಜೇಶ","ರಾಜೇಶ್"],
  "girish":     ["ಗಿರೀಶ","ಗಿರೀಶ್"],
  "mahesh":     ["ಮಹೇಶ","ಮಹೇಶ್"],
  "ganesh":     ["ಗಣೇಶ","ಗಣೇಶ್"],
  "ravi":       ["ರವಿ","ರವಿ"],
  "rupa":       ["ರೂಪ","ರೂಪಾ"],
  "sunitha":    ["ಸುನಿತ","ಸುನೀತ"],
  "savitha":    ["ಸಾವಿತ","ಸಾವಿತ್ರಿ"],
  "kavitha":    ["ಕಾವ್ಯ","ಕಾವಿತ"],
  "anitha":     ["ಅನಿತ","ಅನೀತ"],
  "rekha":      ["ರೇಖ","ರೇಖಾ"],
  "usha":       ["ಉಷ","ಉಷಾ"],
  "pushpa":     ["ಪುಷ್ಪ","ಪುಷ್ಪ"],
  "geetha":     ["ಗೀತ","ಗೀತಾ"],
  "nandini":    ["ನಂದಿನಿ","ನಂದಿನಿ"],
  "sridevi":    ["ಶ್ರೀದೇವಿ","ಸ್ರೀದೇವಿ"],
  "basavaraj":  ["ಬಸವರಾಜ","ಬಸವರಾಜ್"],
  "nagaraj":    ["ನಾಗರಾಜ","ನಾಗರಾಜ್"],
  "shivaraj":   ["ಶಿವರಾಜ","ಶಿವರಾಜ್"],
  "muniswamy":  ["ಮುನಿಸ್ವಾಮಿ","ಮುನಿಸ್ವಾಮಿ"],
  "rangaswamy": ["ರಂಗಸ್ವಾಮಿ","ರಂಗಸ್ವಾಮಿ"],
  "thimmaiah":  ["ತಿಮ್ಮಯ್ಯ","ತಿಮ್ಮಪ್ಪ"],
  "hanumantha": ["ಹನುಮಂತ","ಹನುಮಂತಪ್ಪ"],
  "siddappa":   ["ಸಿದ್ದಪ್ಪ","ಸಿದ್ದ"],
  "lingappa":   ["ಲಿಂಗಪ್ಪ","ಲಿಂಗ"],
  "venkatarao": ["ವೆಂಕಟರಾವ","ವೆಂಕಟ ರಾವ"],
  "chendraiah": ["ಚೆಂದ್ರಯ್ಯ","ಚಂದ್ರಯ್ಯ"],
  "nanjaiah":   ["ನಂಜಯ್ಯ","ನಂಜಪ್ಪ"],
  "munirajappa":["ಮುನಿರಾಜಪ್ಪ","ಮುನಿರಾಜ"],
  "krishna":    ["ಕೃಷ್ಣ","ಕ್ರಿಷ್ಣ"],
  "rama":       ["ರಾಮ","ರಾಮ"],
  "srinivas":   ["ಶ್ರೀನಿವಾಸ","ಸ್ರೀನಿವಾಸ"],
  "manjunath":  ["ಮಂಜುನಾಥ","ಮಂಜುನಾಥ್"],
  "subramani":  ["ಸುಬ್ರಮಣಿ","ಸುಬ್ರಹ್ಮಣ್ಯ"],
  "shivashankar":["ಶಿವಶಂಕರ","ಶಿವಶಂಕರ್"],
  "bhaskar":    ["ಭಾಸ್ಕರ","ಭಾಸ್ಕರ್"],
  "siddalingaiah":["ಸಿದ್ದಲಿಂಗಯ್ಯ","ಸಿದ್ದಲಿಂಗ"],
  "ashwath":    ["ಅಶ್ವತ್","ಅಶ್ವಥ"],
  "ashwathappa":["ಅಶ್ವತ್ಥಪ್ಪ","ಅಶ್ವತ್ಪ್ಪ"],
  "gurappa":    ["ಗುರಪ್ಪ","ಗುರಪ್ಪ"],
  "rudra":      ["ರುದ್ರ","ರುದ್ರ"]
};

// ====================================================================
// PHONETIC NORMALIZATION: map common char sequences
// ====================================================================
const PHONETIC_NORMALIZE = [
  [/ಸ್ಯೆ/g,   "sye"],
  [/ಸ್ಯ/g,    "sy"],
  [/ಯದ್/g,   "yad"],
  [/ಖಾನ/g,   "khan"],
  [/ಬೇಗ/g,   "beg"],
  [/ಮಹಮ/g,   "moham"],
  [/ಮುಹ/g,   "muh"],
  [/ಮೊಹ/g,   "moh"],
  [/ಕುಮಾರ/g, "kumar"],
  [/ಲಕ್ಷ್ಮ/g, "lakshm"],
  [/ರಮೇಶ/g,  "ramesh"],
  [/ಸುರೇಶ/g, "suresh"],
  [/ನಾರಾಯಣ/g,"narayana"],
  [/ರಾಜೇಶ/g, "rajesh"],
  [/ಹನುಮ/g,  "hanum"],
  [/ಸಿದ್ದ/g, "sidda"],
  [/ಫಾತಿಮ/g, "fatim"],
  [/ಬಾನು/g,  "banu"],
  [/ಶಬಾನ/g,  "shaban"],
  [/ಅಕ್ರಮ/g, "akram"],
  [/ಇಬ್ರಾಹಿಂ/g,"ibrahim"],
  [/ಹುಸೇನ/g, "hussain"],
  [/ಫಯಾಜ/g,  "fayaz"],
  [/ನೂರ/g,   "noor"],
  [/ಮಂಜುನಾಥ/g,"manjunath"],
  [/ಮಂಜ/g,   "manj"],
  [/ಗಣೇಶ/g,  "ganesh"],
  [/ಲಿಂಗ/g,  "linga"],
  [/ಬಸವ/g,   "basava"],
  [/ವೆಂಕಟ/g, "venkata"]
];
// ====================================================================
// PHONETIC CONVERSION: Kannada text -> latin-like string for fuzzy match
// ====================================================================
function toPhonetic(text) {
  if (!text) return '';
  let t = text.toLowerCase();
  PHONETIC_NORMALIZE.forEach(([re, rep]) => { t = t.replace(re, rep); });
  return t;
}

// ====================================================================
// KANNADA → READABLE ENGLISH transliteration
//
// Key rules fixed vs previous version:
//  1. Consonant + ್ (virama) + same consonant = doubled consonant + 'a'
//     e.g. ಬ್ಬ = 'bba', ಮ್ಮ = 'mma', ಪ್ಪ = 'ppa'
//  2. Bare consonant at word end = consonant + 'a' (implicit vowel)
//     e.g. ಪ್ಪ at end → 'ppa', ಮ್ಮ → 'mma'
//  3. ಂ (anusvara) = 'm' before labials (p/b/m), 'n' before others, 'ng' before velars
//  4. ಾ (aa-kaara) = 'a' not 'aa' in common names (reads more natural)
//  5. ಫ → 'f' not 'ph' for Muslim names (Fatima not Phatima)
//  6. ಳ → 'la' not 'l' (retroflex lateral)
// ====================================================================
function kannadaToLatin(text) {
  if (!text) return '';
  // Strip ZWNJ
  text = text.replace(/[\u200C\u200D]/g, '');

  // Consonant bases → phoneme (without implicit 'a')
  const C = {
    'ಕ':'k','ಖ':'kh','ಗ':'g','ಘ':'gh','ಙ':'ng',
    'ಚ':'ch','ಛ':'chh','ಜ':'j','ಝ':'jh','ಞ':'ny',
    'ಟ':'t','ಠ':'th','ಡ':'d','ಢ':'dh','ಣ':'n',
    'ತ':'t','ಥ':'th','ದ':'d','ಧ':'dh','ನ':'n',
    'ಪ':'p','ಫ':'f','ಬ':'b','ಭ':'bh','ಮ':'m',
    'ಯ':'y','ರ':'r','ಲ':'l','ವ':'v',
    'ಶ':'sh','ಷ':'sh','ಸ':'s','ಹ':'h','ಳ':'l','ಱ':'r',
  };
  // Independent vowels
  const V = {
    'ಅ':'a','ಆ':'aa','ಇ':'i','ಈ':'ee','ಉ':'u','ಊ':'oo','ಋ':'ru',
    'ಎ':'e','ಏ':'ee','ಐ':'ai','ಒ':'o','ಓ':'oo','ಔ':'au',
  };
  // Dependent vowel signs (matras)
  const M = {
    'ಾ':'a','ಿ':'i','ೀ':'ee','ು':'u','ೂ':'oo','ೃ':'ru',
    'ೆ':'e','ೇ':'ee','ೈ':'ai','ೊ':'o','ೋ':'oo','ೌ':'au',
  };
  const VIRAMA = '್';
  const ANUSVARA = 'ಂ';
  const VISARGA  = 'ಃ';

  const chars = [...text];
  let out = '';
  let i = 0;

  while (i < chars.length) {
    const ch = chars[i];

    // Independent vowel
    if (V[ch] !== undefined) { out += V[ch]; i++; continue; }

    // Consonant
    if (C[ch] !== undefined) {
      const base = C[ch];
      i++;
      // Check what follows
      if (i < chars.length && chars[i] === VIRAMA) {
        // Consonant cluster: no implicit 'a'
        out += base;
        i++;
        continue;
      }
      if (i < chars.length && M[chars[i]] !== undefined) {
        // Consonant + matra vowel sign
        out += base + M[chars[i]];
        i++;
        continue;
      }
      if (i < chars.length && chars[i] === ANUSVARA) {
        // e.g. ರಂ → 'ram', ವೆಂ → 'ven'
        // anusvara handled below on next iteration — emit base + 'a' here
        out += base + 'a';
        continue; // don't advance i — anusvara handled next loop
      }
      // Bare consonant — add implicit 'a'
      out += base + 'a';
      continue;
    }

    // Anusvara ಂ — context-sensitive nasal
    if (ch === ANUSVARA) {
      const next = i + 1 < chars.length ? chars[i + 1] : '';
      if ('ಪಫಬಭಮ'.includes(next)) out += 'm';
      else if ('ಕಖಗಘ'.includes(next)) out += 'n';
      else out += 'n';
      i++; continue;
    }

    if (ch === VISARGA) { out += 'h'; i++; continue; }

    // Dependent vowel sign appearing without prior consonant (shouldn't happen but be safe)
    if (M[ch] !== undefined) { out += M[ch]; i++; continue; }

    // Pass through spaces, dots, hyphens etc.
    if (/[\s.\-\/,']/.test(ch)) { out += ch; i++; continue; }

    // Unknown — skip
    i++;
  }

  // Post-process for readability:
  // 1. Trailing consonant cluster like 'pp','mm','tt','nn' at word end → keep (already natural: Ramappa)
  // 2. 'aa' → 'a' for more natural reading (Rama not Raama, Shiva not Shiiva)
  //    EXCEPT: don't collapse 'aa' in first syllable if name is short (e.g. 'Aashiq')
  out = out
    .replace(/aa/g, 'a')   // Raama→Rama, Subbamma still Subbamma (mm preserved)
    .replace(/ee/g, 'i')   // Deepa not Deepaa
    .replace(/oo/g, 'u')   // not oo
    .replace(/ppha/g, 'ppa')  // cleanup double-ph
    .replace(/([a-z])\1{2,}/g, '$1$1')  // max double consonant
    .trim();

  // Title-case each word
  return out.split(/\s+/)
    .map(w => w ? w[0].toUpperCase() + w.slice(1) : '')
    .join(' ');
}



// ====================================================================
// STATE
// ====================================================================
let currentAC = null;
let voterDB = {};      // key = "AC_PARTNUM" => array of voter records
let fuseInstances = {}; // key = "AC_PARTNUM" => Fuse instance
let currentSearchScope = []; // which DB keys to search

// PDF.js workerSrc is set inside processPDF() after libraries have loaded

// ====================================================================
// INIT
// ====================================================================
function initApp() {
  loadFromStorage();
  refreshLoadedChips();
  trackVisitor();
  updateStatsFooter();
}
// Run when DOM is ready (scripts already loaded since they're at bottom of body)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// Storage with graceful fallback if localStorage is blocked (tracking prevention)
let storageAvailable = false;
try {
  localStorage.setItem('_test', '1');
  localStorage.removeItem('_test');
  storageAvailable = true;
} catch(e) {
  console.warn('localStorage blocked — data will not persist across sessions.');
}

function loadFromStorage() {
  if (!storageAvailable) return;
  try {
    const saved = localStorage.getItem('electoralDB');
    if (saved) {
      voterDB = JSON.parse(saved);
      Object.keys(voterDB).filter(k => !k.endsWith('_meta')).forEach(key => buildFuseIndex(key));
    }
  } catch(e) { voterDB = {}; }
}

function saveToStorage() {
  if (!storageAvailable) {
    console.warn('Storage blocked — processed data kept in memory only for this session.');
    return;
  }
  try {
    localStorage.setItem('electoralDB', JSON.stringify(voterDB));
  } catch(e) {
    console.warn('Storage quota exceeded — data not saved:', e.message);
  }
}

// ====================================================================
// VISITOR & SUCCESS COUNTERS
// Uses a shared remote counter first so all visitors see the same total.
// Falls back to shared runtime storage/localStorage if the remote counter fails.
// ====================================================================
const GLOBAL_VISITOR_COUNT = Object.freeze({
  endpoint: 'https://api.countapi.xyz',
  namespace: 'votersearch2002',
  key: 'site-visitors',
  displayOffset: 109
});

function formatDisplayedVisitorCount(rawCount) {
  return Math.max(0, parseInt(rawCount || '0', 10) || 0) + GLOBAL_VISITOR_COUNT.displayOffset;
}

async function getRemoteVisitorCount() {
  const url = `${GLOBAL_VISITOR_COUNT.endpoint}/get/${GLOBAL_VISITOR_COUNT.namespace}/${GLOBAL_VISITOR_COUNT.key}`;
  const res = await fetch(noCacheUrl(url), { cache: 'no-store' });
  if (!res.ok) throw new Error(`visitor counter HTTP ${res.status}`);
  const data = await res.json();
  return parseInt(data && data.value, 10) || 0;
}

async function hitRemoteVisitorCount() {
  const url = `${GLOBAL_VISITOR_COUNT.endpoint}/hit/${GLOBAL_VISITOR_COUNT.namespace}/${GLOBAL_VISITOR_COUNT.key}`;
  const res = await fetch(noCacheUrl(url), { cache: 'no-store' });
  if (!res.ok) throw new Error(`visitor counter HTTP ${res.status}`);
  const data = await res.json();
  return parseInt(data && data.value, 10) || 0;
}

async function trackVisitor() {
  try {
    if (sessionStorage.getItem('_visited')) { updateStatsFooter(); return; }
    sessionStorage.setItem('_visited', '1');
    try {
      await hitRemoteVisitorCount();
    } catch (remoteErr) {
      if (typeof window.storage !== 'undefined') {
        const cur = await window.storage.get('stats:visitors', true).catch(() => null);
        const n = cur ? (parseInt(cur.value, 10) || 0) + 1 : 1;
        await window.storage.set('stats:visitors', String(n), true);
      } else if (storageAvailable) {
        const n = (parseInt(localStorage.getItem('_vis') || '0', 10)) + 1;
        localStorage.setItem('_vis', String(n));
      }
      console.warn('Global visitor counter unavailable, using fallback counter.', remoteErr);
    }
    updateStatsFooter();
  } catch(e) { updateStatsFooter(); }
}

async function trackSuccessfulFind() {
  try {
    if (typeof window.storage !== 'undefined') {
      const cur = await window.storage.get('stats:successes', true).catch(() => null);
      const n = cur ? (parseInt(cur.value, 10) || 0) + 1 : 1;
      await window.storage.set('stats:successes', String(n), true);
    } else if (storageAvailable) {
      const n = (parseInt(localStorage.getItem('_suc') || '0', 10)) + 1;
      localStorage.setItem('_suc', String(n));
    }
    updateStatsFooter();
  } catch(e) { /* silent */ }
}

async function updateStatsFooter() {
  try {
    let visitors = 0, successes = 0;
    try {
      visitors = await getRemoteVisitorCount();
    } catch (remoteErr) {
      if (typeof window.storage !== 'undefined') {
        const v = await window.storage.get('stats:visitors', true).catch(() => null);
        if (v) visitors = parseInt(v.value, 10) || 0;
      } else if (storageAvailable) {
        visitors = parseInt(localStorage.getItem('_vis') || '0', 10);
      }
      console.warn('Global visitor counter read failed, using fallback counter.', remoteErr);
    }
    if (typeof window.storage !== 'undefined') {
      const s = await window.storage.get('stats:successes', true).catch(() => null);
      if (s) successes = parseInt(s.value, 10) || 0;
    } else if (storageAvailable) {
      successes = parseInt(localStorage.getItem('_suc') || '0', 10);
    }
    const el = document.getElementById('statsFooter');
    if (el) el.textContent = `👥 ${formatDisplayedVisitorCount(visitors)} visitors · ✅ ${successes} successful voter searches`;
  } catch(e) { /* silent */ }
}

// ====================================================================
// DROPDOWNS — kept as no-op stubs (no longer shown in UI)
// ====================================================================
function populateDistricts() {}
function onDistrictChange() {}
function onACChange() {}
function updateUploadState() {}

// ====================================================================
// FILE SELECTION & VALIDATION
// ====================================================================
function onFileSelected(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = '';
  if (!files.length) return;

  // ── Multi-file nudge ─────────────────────────────────────────────
  const notice = document.getElementById('multiFileNotice');
  const noticeText = document.getElementById('multiFileNoticeText');
  if (files.length > 1) {
    noticeText.textContent = `You've selected ${files.length} files. Each file takes 2–5 minutes to process — multiple files may take considerably longer. Please keep this tab open.`;
    notice.style.display = 'flex';
  } else {
    notice.style.display = 'none';
  }

  files.forEach(file => validateAndProcess(file));
}

function validateAndProcess(file) {
  const filename = file.name;

  // ── Rule 1: Must match CEO Karnataka naming exactly ──────────────────
  const match = filename.match(/^A(\d{3})0(\d{3})\.pdf$/i);
  if (!match) {
    showAlert('error',
      `❌ <b>Invalid filename: ${filename}</b><br>
       Expected CEO Karnataka format: <b>AXXXOYYY.pdf</b> (e.g. A1620037.pdf).<br>
       Do <u>not</u> rename the file before uploading.`);
    return;
  }

  // ── Auto-detect AC from filename ─────────────────────────────────────
  const fileAC  = 'A' + match[1];   // e.g. "A162"
  const partNum = match[2];          // e.g. "037"

  // Set currentAC to match this file (allows search scope to work)
  currentAC = fileAC;

  // ── Rule 2: Dedup — already processed? ───────────────────────────────
  const dbKey = `${fileAC}_${partNum}`;
  if (voterDB[dbKey]) {
    const meta  = voterDB[dbKey + '_meta'] || {};
    const count = voterDB[dbKey].length;
    const when  = meta.processedAt
      ? new Date(meta.processedAt).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric'})
      : 'earlier';
    showAlert('success',
      `✅ <b>Already processed!</b> Part <b>${partNum}</b> (AC ${match[1]}) was uploaded ${when} 
       and has <b>${count} voter records</b> ready.<br>
       No re-upload needed — go ahead and search.`);
    currentSearchScope = getSearchScope();
    refreshLoadedChips();
    return;
  }

  processPDF(file, dbKey, partNum);
}

function getSearchScope() {
  // Return all data keys regardless of AC — user may have uploaded multiple ACs
  return Object.keys(voterDB).filter(k => !k.endsWith('_meta'));
}

// Drag and drop
const uploadZone = document.getElementById('uploadZone');
uploadZone.addEventListener('dragover', e => {
  e.preventDefault(); uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault(); uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) onFileSelected({target:{files:[file],value:''}});
});

// ====================================================================
// PDF PROCESSING — tries direct text first, falls back to OCR
// ====================================================================
async function processPDF(file, dbKey, partNum) {
  showStatus('Loading PDF...', 3);
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('File is empty or could not be read');
    }

    showStatus('Parsing PDF structure...', 5);
    let pdf;
    try {
      pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
        useWorkerFetch: false,
        isEvalSupported: false,
        useSystemFonts: true
      }).promise;
    } catch(pdfErr) {
      console.warn('PDF worker failed, retrying:', pdfErr);
      pdfjsLib.GlobalWorkerOptions.workerSrc = '';
      pdf = await pdfjsLib.getDocument({data: new Uint8Array(arrayBuffer)}).promise;
    }

    const totalPages = pdf.numPages;
    showStatus('Checking for embedded text...', 7);

    // Step 1: try direct text extraction (instant — works if PDF has real text layer)
    let allRecords = await tryDirectExtract(pdf, totalPages);
    console.log('Direct extract records:', allRecords.length);

    // Step 2: if direct extraction yielded nothing, use OCR
    if (allRecords.length === 0) {
      showAlert('info',
        'ℹ️ Scanned PDF detected. Starting OCR — takes 2–4 minutes for ' +
        totalPages + ' pages. Please keep this tab open.');
      allRecords = await runOCR(pdf, totalPages);
      console.log('OCR records:', allRecords.length);
    }

    if (allRecords.length === 0) {
      showAlert('error',
        '❌ Could not extract voter records.<br>' +
        'Please open browser console (F12 → Console tab) and share the log for debugging.');
      hideStatus();
      return;
    }

    voterDB[dbKey] = allRecords;
    voterDB[dbKey + '_meta'] = {
      processedAt: new Date().toISOString(),
      recordCount: allRecords.length,
      partNum, acNum: currentAC
    };
    buildFuseIndex(dbKey);
    saveToStorage();
    currentSearchScope = getSearchScope();

    showStatus('✅ Done! ' + allRecords.length + ' voter records loaded from Part ' + partNum + '.', 100);
    setTimeout(hideStatus, 4000);
    refreshLoadedChips();

  } catch(err) {
    const msg = (err && err.message) ? err.message : JSON.stringify(err);
    console.error('processPDF error:', err);
    showAlert('error', '❌ Error reading PDF: ' + msg);
    hideStatus();
  }
}

// ====================================================================
// STRATEGY 2: OCR using Tesseract.js
// PSM 3 = fully automatic page segmentation (DO NOT force PSM 6)
// PSM 6 breaks on pages that have headers + table content mixed
// Diagnostic confirmed scale 2.5 works well for this PDF
// ====================================================================
async function runOCR(pdf, totalPages) {
  if (typeof Tesseract === 'undefined') {
    showAlert('error', '❌ OCR library not loaded. Please refresh the page.');
    return [];
  }

  showStatus('Loading OCR engine...', 8);
  let currentOCRPage = 1;

  let worker;
  try {
    worker = await Tesseract.createWorker(['kan', 'eng'], 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          const p = 10 + Math.round((currentOCRPage / totalPages) * 85);
          showStatus('OCR page ' + currentOCRPage + '/' + totalPages +
            ' — ' + Math.round(m.progress * 100) + '%', p);
        } else if (m.status) {
          showStatus(m.status + '...', 9);
        }
      }
    });
    // NO setParameters — use Tesseract default PSM 3 (auto segmentation)
    // PSM 6 (uniform block) was causing zero extractions on mixed-layout pages
  } catch(tErr) {
    console.error('Tesseract init failed:', tErr);
    showAlert('error', '❌ OCR engine failed to start: ' + (tErr.message || tErr));
    return [];
  }

  let allRecords = [];
  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    currentOCRPage = pageNum;
    const page   = await pdf.getPage(pageNum);
    const vp     = page.getViewport({scale: 3.0}); // ~216 DPI — better than 2.5 for Kannada OCR
    const canvas = document.createElement('canvas');
    canvas.width  = vp.width;
    canvas.height = vp.height;
    await page.render({canvasContext: canvas.getContext('2d'), viewport: vp}).promise;

    // Preprocessing: boost contrast to help faded/degraded scans
    let ocrTarget = canvas;
    try {
      const proc = document.createElement('canvas');
      proc.width = canvas.width; proc.height = canvas.height;
      const pctx = proc.getContext('2d');
      pctx.filter = 'contrast(1.35) brightness(1.05) grayscale(1)';
      pctx.drawImage(canvas, 0, 0);
      ocrTarget = proc;
    } catch(e) { /* use raw canvas if filter unsupported */ }

    const {data} = await worker.recognize(ocrTarget);

    // Log first page raw output for debugging
    if (pageNum <= 2) {
      const previewLines = data.text.split('\n').filter(l => l.trim()).slice(0, 5);
      console.log('Page ' + pageNum + ' OCR preview:', previewLines);
    }

    const pageRecords = parseOCRText(data.text);
    console.log('Page ' + pageNum + ': ' + pageRecords.length + ' records extracted');
    allRecords = allRecords.concat(pageRecords);
  }

  await worker.terminate();
  console.log('Total records from OCR:', allRecords.length);
  if (allRecords.length > 0) {
    console.log('Sample record:', JSON.stringify(allRecords[0]));
  }
  return allRecords;
}


// ====================================================================
// STRATEGY 1: Direct PDF text extraction
// ====================================================================
async function tryDirectExtract(pdf, totalPages) {
  let allRecords = [];
  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    if (content.items.length > 2) {  // lower threshold — some pages have very few items per row
      allRecords = allRecords.concat(parseTextItems(content.items));
    }
  }
  return allRecords;
}

// ====================================================================
// ====================================================================
// PARSER 1: For direct PDF text extraction (structured items)
// ====================================================================
function parseTextItems(items) {
  const records = [];
  const lines = {};
  items.forEach(item => {
    const y = Math.round(item.transform[5] / 3) * 3;
    if (!lines[y]) lines[y] = [];
    lines[y].push({text: item.str, x: item.transform[4]});
  });
  Object.keys(lines).map(Number).sort((a,b) => b-a).forEach(y => {
    const lineText = lines[y].sort((a,b)=>a.x-b.x).map(i=>i.str).join(' ').replace(/\s+/g,' ').trim();
    const r = matchVoterLine(lineText);
    if (r) records.push(r);
  });
  return records;
}

// ====================================================================
// PARSER 2: For OCR text output (line by line)
// Handles \u200C (ZWNJ) characters that Tesseract inserts in Kannada text
// ====================================================================
// ====================================================================
// OCR LINE NORMALISER — all 12 failure modes from real A0850001 data
// ====================================================================
function normaliseOCRLine(line) {
  if (!line) return '';
  line = line.replace(/[\u200C\u200D\uFEFF]/g, '');
  // Kannada digits → Arabic
  const KD={'೦':'0','೧':'1','೨':'2','೩':'3','೪':'4','೫':'5','೬':'6','೭':'7','೮':'8','೯':'9'};
  line = line.replace(/[೦-೯]/g, d => KD[d]||d);
  // FM3: ALL confirmed Latin OCR misreads for ತಂದೆ from real PDFs
  line = line.replace(/\b(god|wack|mortars|nowt|nod|woot|seas|means|dasa|go\}|gots|tod|fod|bod|wok|kod|303|Deacon\)?|Deacon|goa|sod)\b/gi, 'ತಂದೆ');
  // FM3: Kannada zero substitution
  line = line.replace(/ತ[o0\u0CE6]ದೆ/g, 'ತಂದೆ');
  line = line.replace(/ಗ[o0\u0CE6]ಡ/g, 'ಗಂಡ');
  // FM4: Gender latin — word boundary before age
  line = line.replace(/\b(no|ro|rio|Bo|fo|go|co|ho|lo|po|do|qo)\b\.?\s*(?=\d{2,3})/g, 'ಗಂ ');
  line = line.replace(/\b(nowt|now|hew|how|hex|bow|dew|few)\b\.?\s*(?=\d{2,3})/g, 'ಹೆಂ ');
  // FM4: Kannada glyph confusions
  line = line.replace(/ಗಣ(?=\s*\d)/g, 'ಗಂ');
  line = line.replace(/ಹೆಣ(?=\s*\d)/g, 'ಹೆಂ');
  // FM6: Bracket in age (5] → 51)
  line = line.replace(/(\d)\](?=\s|$)/g, '$11');
  // Strip trailing . after relation word
  line = line.replace(/(ತಂದೆ|ತಾಯಿ|ಗಂಡ|ಇತರೆ)[.,]+/g, '$1 ');
  // FM1: Leading serial noise
  line = line.replace(/^[-.|l\[\]{}]+\s*/, '');
  // FM12: Trailing noise on voter ID
  line = line.replace(/(\s[A-Z0-9]{5,15})[.\|ನ\s]+$/, '$1');
  return line.replace(/\s+/g, ' ').trim();
}

function parseOCRText(text) {
  const records = [];
  const rawLines = text.split('\n');
  for (let i = 0; i < rawLines.length; i++) {
    let line = normaliseOCRLine(rawLines[i]);
    if (!line || line.length < 8) continue;
    let r = matchVoterLine(line);
    if (!r && i + 1 < rawLines.length) {
      const n1 = normaliseOCRLine(rawLines[i + 1]);
      const m1 = (line + ' ' + n1).replace(/\s+/g, ' ').trim();
      r = matchVoterLine(m1);
      if (r) { i++; }
      else if (i + 2 < rawLines.length) {
        const n2 = normaliseOCRLine(rawLines[i + 2]);
        const m2 = (line + ' ' + n1 + ' ' + n2).replace(/\s+/g, ' ').trim();
        r = matchVoterLine(m2);
        if (r) i += 2;
      }
    }
    if (r) records.push(r);
  }
  return records;
}

// ====================================================================
// CORE VOTER ROW MATCHER
//
// CRITICAL FIX: Kannada Unicode block is U+0C80–U+0CFF
// Previous code used U+0C00–U+0C7F which matched NOTHING
//
// Actual CEO Karnataka PDF row format (confirmed from OCR output):
//   serial  house  name  ತಂದೆ.  relname  ಗಂ/ಹೆಂ  age  [voterID]
//   e.g: "2 43 ಸಮೀರ ತಂದೆ. ಹುಲಿರಾಜ ಗಂ 25 KFM2748473"
// ====================================================================
const KAN_RE = '[\\u0C80-\\u0CFF\\u200C\\u200D]';

// Helper to build a ZWNJ-tolerant match for a fixed Kannada keyword
// e.g. ತಂದೆ → each char may be followed by optional ZWNJ
function kanPattern(word) {
  return [...word].map(c => c.replace(/[\u0C80-\u0CFF]/,
    ch => ch + '\\u200C?\\u200D?')).join('');
}

const REL_PAT  = `(?:${kanPattern('ತಂದೆ')}|${kanPattern('ತಾಯಿ')}|${kanPattern('ಗಂಡ')}|${kanPattern('ಇತರೆ')})`;
const GEN_PAT  = `(?:${kanPattern('ಗಂ')}|${kanPattern('ಹೆಂ')})`;

const VOTER_PATTERN = new RegExp(
  '^(\\d{1,4})'                                         // serial
  + '\\s+([\\w\\u0C80-\\u0CFF\\u200C\\u200D\\/\\-\\.]+)'  // house no
  + '\\s+(' + KAN_RE + '(?:' + KAN_RE + '|[\\s\\.\\,\\-\\\'])*?)'  // name
  + '\\s+' + REL_PAT + '[\\.]?\\s+'                     // relation + optional dot
  + '(' + KAN_RE + '(?:' + KAN_RE + '|[\\s\\.\\,\\-\\\'])*?)'      // rel name
  + '\\s+' + GEN_PAT                                    // gender short
  + '\\s+(\\d{1,3})'                                    // age
  + '(?:\\s+([\\w\\d]{6,15}))?'                         // voter ID optional
  + '\\s*$'
);

function matchVoterLine(line) {
  if (!line || line.length < 8) return null;
  const clean = line.replace(/\u200C|\u200D/g, ''); // strip ZWNJ for matching
  const m = VOTER_PATTERN.exec(line.trim());
  if (!m) return null;
  // Groups: 1=serial, 2=house, 3=name, 4=relName, 5=age, 6=voterId
  // (relation keyword and gender are non-capturing in the new pattern)
  // Detect relation from original line
  let relation = 'ತಂದೆ';
  if (/ತಾಯಿ/.test(clean)) relation = 'ತಾಯಿ';
  else if (/ಗಂಡ/.test(clean)) relation = 'ಗಂಡ';
  else if (/ಇತರೆ/.test(clean)) relation = 'ಇತರೆ';
  const genderCode = /ಹೆಂ/.test(clean) ? 'ಹೆಂ' : 'ಗಂ';
  return makeRecord(m[1], m[2], m[3], relation, m[4], genderCode, m[5], m[6] || '');
}

function makeRecord(serial, house, name, relation, relName, genderCode, age, voterId) {
  name    = (name    || '').replace(/\u200C|\u200D/g, '').trim();
  relName = (relName || '').replace(/\u200C|\u200D/g, '').trim();
  const gender = genderCode === 'ಗಂ' ? 'Male' : 'Female';
  return {
    serial, house, name, relation, relName, gender, age,
    voterId: voterId || '',
    nameLower:    name.toLowerCase(),
    relNameLower: relName.toLowerCase(),
    namePhonetic: toPhonetic(name),
    relPhonetic:  toPhonetic(relName),
    nameLatin:    kannadaToLatin(name),
    relLatin:     kannadaToLatin(relName)
  };
}


// ====================================================================
// BUILD FUSE INDEX
// ====================================================================
function buildFuseIndex(dbKey) {
  const data = voterDB[dbKey];
  if (!data || !data.length) return;
  fuseInstances[dbKey] = new Fuse(data, {
    keys: ['name','relName','nameLower','relNameLower','namePhonetic','relPhonetic','nameLatin','relLatin','voterId'],
    threshold: 0.30,
    distance: 80,
    includeScore: true,
    ignoreLocation: true,
    useExtendedSearch: false
  });
}

// ====================================================================
// SEARCH
// ====================================================================
function performSearch() {
  const nameQ = document.getElementById('searchName').value.trim();
  const relQ  = document.getElementById('searchRelative').value.trim();

  if (!nameQ && !relQ) {
    showAlert('warning', 'Please enter at least your name to search.');
    return;
  }

  const scope = getSearchScope();
  if (!scope.length) {
    showAlert('warning', 'No electoral roll data loaded. Please upload a PDF part file first.');
    return;
  }

  // Split multi-word queries into individual tokens e.g. "Syed Umar" → ["syed","umar"]
  // Each token generates its own variants; a record must match ALL tokens (AND logic)
  const nameTokens = nameQ ? nameQ.trim().toLowerCase().split(/\s+/).filter(t => t.length >= 2).map(generateVariants) : [];
  const relTokens  = relQ  ? relQ.trim().toLowerCase().split(/\s+/).filter(t => t.length >= 2).map(generateVariants) : [];

  // Helper: does field string match ALL token-variant groups?
  function tokenMatchField(fieldLatin, fieldLower, fieldPhonetic) {
    return (tokenGroups) => tokenGroups.every(variants =>
      variants.some(v => {
        const vClean = v.replace(/[^a-z0-9]/g, '');
        return fieldLower.includes(v) ||
               fieldPhonetic.includes(v) ||
               (vClean.length >= 2 && fieldLatin.includes(vClean));
      })
    );
  }

  let allMatches = new Map(); // uid => {record, score, dbKey, nameHit, relHit}

  scope.forEach(dbKey => {
    const records = voterDB[dbKey] || [];

    records.forEach(r => {
      const uid = dbKey + '_' + r.serial;
      const nLatin = r.nameLatin   || '';
      const rLatin = r.relLatin    || '';
      const nLower = r.nameLower   || '';
      const rLower = r.relNameLower|| '';
      const nPhon  = r.namePhonetic|| '';
      const rPhon  = r.relPhonetic || '';

      let nameHit = nameTokens.length === 0 || tokenMatchField(nLatin, nLower, nPhon)(nameTokens);
      let relHit  = relTokens.length === 0  || tokenMatchField(rLatin, rLower, rPhon)(relTokens);

      // Both must match if both are provided
      const bothProvided = nameTokens.length > 0 && relTokens.length > 0;
      const hit = bothProvided ? (nameHit && relHit) : (nameHit || relHit);

      if (hit) {
        const score = (nameTokens.length > 0 && nameHit ? 2 : 0) +
                      (relTokens.length  > 0 && relHit  ? 1 : 0);
        if (!allMatches.has(uid) || allMatches.get(uid).score < score) {
          allMatches.set(uid, { record:r, score, dbKey, nameHit, relHit });
        }
      }
    });
  });

  // Fuzzy fallback — only if exact/substring scan found nothing
  if (allMatches.size === 0) {
    const allQueryVariants = [...nameTokens, ...relTokens].flat();
    scope.forEach(dbKey => {
      if (!fuseInstances[dbKey]) return;
      allQueryVariants.forEach(v => {
        if (v.length < 3) return;
        fuseInstances[dbKey].search(v, {limit:15}).forEach(res => {
          const uid = dbKey + '_' + res.item.serial;
          if (!allMatches.has(uid)) {
            allMatches.set(uid, { record:res.item, score:0.1, dbKey, nameHit:false, relHit:false });
          }
        });
      });
    });
  }

  // Sort: both-hit first, then name-only/rel-only, then fuzzy
  const sorted = Array.from(allMatches.values()).sort((a,b) => b.score - a.score);
  displayResults(sorted.slice(0, 20), nameQ, relQ);
}

// ====================================================================
// GENERATE SEARCH VARIANTS
// ====================================================================
function generateVariants(query) {
  const q = query.toLowerCase().trim();
  const variants = new Set([q]);

  if (typeof expandQueryToken === 'function') {
    expandQueryToken(q).forEach(v => variants.add(String(v || '').toLowerCase()));
  }

  // Check phonetic map
  Object.entries(TRANSLITERATION_MAP).forEach(([latin, kanList]) => {
    if (latin === q || latin.includes(q) || q.includes(latin)) {
      variants.add(latin);
      kanList.forEach(k => {
        const s = k.toLowerCase();
        variants.add(s);
        variants.add(s.replace(/್$/u, ''));
      });
    }
    kanList.forEach(k => {
      if (k.toLowerCase().includes(q) || q.includes(k.toLowerCase())) {
        variants.add(latin);
        kanList.forEach(k2 => {
          const s2 = k2.toLowerCase();
          variants.add(s2);
          variants.add(s2.replace(/್$/u, ''));
        });
      }
    });
  });

  const qClean = q.replace(/[^a-z0-9]/g, '');
  if (qClean === 'syed' || qClean === 'sayyed' || qClean === 'sayed' || qClean === 'saiyed' || qClean === 'sayyad' || qClean === 'saiyad' || qClean === 'saiyyad' || qClean === 'sayyid' || qClean === 'saiyyid') {
    ['syed', 'sayed', 'sayyed', 'sayyad', 'sayyid', 'saiyed', 'saiyad', 'saiyyad', 'saiyyid'].forEach(v => variants.add(v));
  }

  // If purely latin, add phonetic version
  if (/^[a-z\s]+$/.test(q)) {
    variants.add(toPhonetic(q));
  }

  return Array.from(variants).filter(v => v.length >= 2);
}

// ====================================================================
// DISPLAY RESULTS  — pure DOM, no innerHTML for data (avoids all quoting bugs)
// ====================================================================
function displayResults(results, nameQ, relQ) {
  const section   = document.getElementById('resultsSection');
  const container = document.getElementById('resultsContainer');
  const countEl   = document.getElementById('resultsCount');

  section.style.display = 'block';
  container.innerHTML = '';

  if (!results.length) {
    countEl.textContent = 'No results found';
    const empty = document.createElement('div');
    empty.className = 'no-results';
    empty.innerHTML = '<div class="icon">&#128269;</div>'
      + '<p>No voter records found matching your search.</p>'
      + '<p style="margin-top:8px;font-size:13px">Try uploading more PDF parts or check the spelling.</p>';
    container.appendChild(empty);
    return;
  }

  let currentPage = 0;
  const PAGE_SIZE = 5;

  function makeField(labelText, valueHTML) {
    const wrap = document.createElement('div');
    wrap.className = 'result-field';
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    const val = document.createElement('div');
    val.className = 'val';
    val.innerHTML = valueHTML;          // safe: valueHTML is our own highlight() output
    wrap.appendChild(lbl);
    wrap.appendChild(val);
    return wrap;
  }

  function makeSmallField(labelText, valueText, extraStyle) {
    const wrap = document.createElement('div');
    wrap.className = 'result-field';
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    const val = document.createElement('div');
    val.className = 'val small';
    if (extraStyle) val.style.cssText = extraStyle;
    val.textContent = valueText;
    wrap.appendChild(lbl);
    wrap.appendChild(val);
    return wrap;
  }

  function renderPage() {
    Array.from(container.querySelectorAll('.result-card, .load-more-row')).forEach(el => el.remove());

    const end       = (currentPage + 1) * PAGE_SIZE;
    const shown     = results.slice(0, end);
    const remaining = results.length - end;

    countEl.textContent = 'Showing ' + shown.length + ' of ' + results.length + ' matches';

    shown.forEach(function(match, idx) {
      const r       = match.record;
      const partNum = match.dbKey.split('_')[1];
      const acNum   = match.dbKey.split('_')[0];
      const isBest  = (idx === 0 && currentPage === 0);

      // Card wrapper
      const card = document.createElement('div');
      card.className = 'result-card' + (isBest ? ' best-match' : '');

      // Grid
      const grid = document.createElement('div');
      grid.className = 'result-grid';

      // Name field: Kannada PROMINENT (large bold) + English transliteration below (readable)
      const nameWrap = document.createElement('div');
      nameWrap.className = 'result-field';
      const nameLbl = document.createElement('label');
      nameLbl.textContent = 'Name | ಹೆಸರು';
      // Kannada — primary, large
      const nameKan = document.createElement('div');
      nameKan.className = 'val';
      nameKan.style.cssText = 'font-family:"Noto Sans Kannada",sans-serif;font-size:17px;font-weight:700;line-height:1.4';
      nameKan.innerHTML = highlight(r.name, nameQ);
      // English — secondary, readable but smaller
      const nameVal = document.createElement('div');
      nameVal.style.cssText = 'font-size:14px;font-weight:600;color:var(--gray-600);margin-top:3px;font-family:"Noto Serif",serif;letter-spacing:0.01em';
      nameVal.textContent = r.nameLatin || '';
      nameWrap.appendChild(nameLbl);
      nameWrap.appendChild(nameKan);
      if (r.nameLatin) {
        nameWrap.appendChild(nameVal);
        // Name split hint for concatenated names (e.g. syedabanu → syeda banu)
        const splitSuggestion = maybeSplitName(r.nameLatin);
        if (splitSuggestion) {
          const splitHint = document.createElement('div');
          splitHint.style.cssText = 'font-size:11px;color:var(--saffron);margin-top:3px;font-family:"JetBrains Mono",monospace';
          splitHint.title = 'This may be a compound name written as one word in Kannada';
          splitHint.textContent = '💡 Possible split: ' + splitSuggestion;
          nameWrap.appendChild(splitHint);
        }
      }
      grid.appendChild(nameWrap);

      // Relative name field: same pattern
      const relWrap = document.createElement('div');
      relWrap.className = 'result-field';
      const relLbl = document.createElement('label');
      relLbl.textContent = "Father's / Husband's Name";
      const relKan = document.createElement('div');
      relKan.className = 'val';
      relKan.style.cssText = 'font-family:"Noto Sans Kannada",sans-serif;font-size:17px;font-weight:700;line-height:1.4';
      relKan.innerHTML = highlight(r.relName, relQ);
      const relVal = document.createElement('div');
      relVal.style.cssText = 'font-size:14px;font-weight:600;color:var(--gray-600);margin-top:3px;font-family:"Noto Serif",serif;letter-spacing:0.01em';
      relVal.textContent = r.relLatin || '';
      relWrap.appendChild(relLbl);
      relWrap.appendChild(relKan);
      if (r.relLatin) relWrap.appendChild(relVal);
      grid.appendChild(relWrap);
      grid.appendChild(makeSmallField('Serial No.', r.serial));
      grid.appendChild(makeSmallField('House No.',  r.house));

      // Gender + Age tags
      const genderWrap = document.createElement('div');
      genderWrap.className = 'result-field';
      const gLbl = document.createElement('label');
      gLbl.textContent = 'Gender / Age';
      const gVal = document.createElement('div');
      gVal.className = 'val small';
      const gTag = document.createElement('span');
      gTag.className = 'tag ' + (r.gender === 'Male' ? 'tag-male' : 'tag-female');
      gTag.textContent = r.gender;
      const aTag = document.createElement('span');
      aTag.className = 'tag tag-age';
      aTag.textContent = r.age + ' yrs';
      gVal.appendChild(gTag);
      gVal.appendChild(document.createTextNode(' '));
      gVal.appendChild(aTag);
      genderWrap.appendChild(gLbl);
      genderWrap.appendChild(gVal);
      grid.appendChild(genderWrap);

      grid.appendChild(makeSmallField('Voter ID', r.voterId || '—', 'font-family:monospace'));

      card.appendChild(grid);

      // Actions row
      const actions = document.createElement('div');
      actions.className = 'result-actions';

      const btn = document.createElement('button');
      btn.className = 'btn btn-success btn-sm';
      btn.textContent = '✅ This is me / Found';
      // Closure captures exact voter data — no string escaping needed
      btn.addEventListener('click', (function(ac, pt, nm, rn, sr, vi) {
        return function() { onSuccess(ac, pt, nm, rn, sr, vi, sr); };
      })(acNum, partNum, r.name, r.relName, r.serial, r.voterId));

      const hint = document.createElement('span');
      hint.style.cssText = 'font-size:12px;color:var(--gray-400)';
      hint.textContent = 'Not you? Check next result →';

      actions.appendChild(btn);
      actions.appendChild(hint);
      card.appendChild(actions);
      container.appendChild(card);
    });

    // Next 5 / end-of-results row
    const row = document.createElement('div');
    row.className = 'load-more-row';
    if (remaining > 0) {
      row.style.cssText = 'text-align:center;padding:12px 0';
      const nextBtn = document.createElement('button');
      nextBtn.className = 'btn btn-outline';
      nextBtn.textContent = 'Next 5 results (' + remaining + ' remaining) →';
      nextBtn.addEventListener('click', function() {
        currentPage++;
        renderPage();
        const cards = container.querySelectorAll('.result-card');
        const firstNew = cards[currentPage * PAGE_SIZE];
        if (firstNew) firstNew.scrollIntoView({behavior:'smooth', block:'start'});
      });
      row.appendChild(nextBtn);
      container.appendChild(row);
    } else if (results.length > PAGE_SIZE) {
      row.style.cssText = 'text-align:center;padding:10px;font-size:13px;color:var(--gray-400)';
      row.textContent = '— All ' + results.length + ' results shown —';
      container.appendChild(row);
    }
  }

  renderPage();
}


function toTitleCase(str) {
  if (!str) return '';
  return str.replace(/\b\w/g, c => c.toUpperCase());
}

function highlight(text, query) {
  if (!text || !query) return _esc(text) || '—';
  try {
    const escaped = _esc(text);
    const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
    return escaped.replace(re, '<mark>$1</mark>');
  } catch(e) { return _esc(text); }
}

function escJ(s) { return (s||'').replace(/'/g,"\\'").replace(/"/g,'\\"'); }

// ====================================================================
// SUCCESS MODAL
// ====================================================================
function onSuccess(acNum, partNum, name, relName, serial, voterId, partSerialNum) {
  const acNumeric = acNum.replace('A','');
  // Find AC name
  let acName = '';
  Object.values(AC_DATA).flat().forEach(ac => {
    if (ac.num === acNum) acName = ac.name;
  });

  const saffron = 'color:var(--saffron);font-weight:700';
  const psnVal = (partSerialNum || serial || '').toString().trim();

  document.getElementById('modalInfo').innerHTML = `
    <div class="modal-info-row"><span>Voter Name</span><span style="text-align:right"><span style="font-family:'Noto Sans Kannada',sans-serif;font-size:15px;font-weight:700;display:block">${name}</span><small style="font-weight:600;color:var(--gray-600);font-family:'Noto Serif',serif;font-size:13px">${kannadaToLatin(name)}</small></span></div>
    <div class="modal-info-row"><span>Relation Name</span><span style="text-align:right"><span style="font-family:'Noto Sans Kannada',sans-serif;font-size:15px;font-weight:700;display:block">${relName}</span><small style="font-weight:600;color:var(--gray-600);font-family:'Noto Serif',serif;font-size:13px">${kannadaToLatin(relName)}</small></span></div>
    <div class="modal-info-row"><span>Serial No.</span><span>${serial}</span></div>
    <div class="modal-info-row"><span>⭐ AC Number</span><span style="${saffron}">${acNumeric}</span></div>
    ${acName ? `<div class="modal-info-row"><span>AC Name</span><span>${acName}</span></div>` : ''}
    <div class="modal-info-row"><span>⭐ Part Number</span><span style="${saffron}">${partNum}</span></div>
    <div class="modal-info-row"><span>⭐ Part Serial No.</span><span style="${saffron}">${psnVal || '—'}</span></div>
    ${voterId ? `<div class="modal-info-row"><span>Voter ID</span><span>${voterId}</span></div>` : ''}
  `;
  document.getElementById('successModal').classList.add('show');
  trackSuccessfulFind();
}

function closeModal() {
  document.getElementById('successModal').classList.remove('show');
}

document.getElementById('successModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});

// ====================================================================
// UI HELPERS
// ====================================================================
function showStatus(msg, pct) {
  const bar = document.getElementById('statusBar');
  bar.classList.add('show');
  document.getElementById('statusText').textContent = msg;
  document.getElementById('progressFill').style.width = pct + '%';
}
function hideStatus() {
  document.getElementById('statusBar').classList.remove('show');
}

let alertTimeout;
function showAlert(type, html) {
  clearTimeout(alertTimeout);
  const existing = document.getElementById('dynamicAlert');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'dynamicAlert';
  div.className = `alert alert-${type}`;
  div.innerHTML = `<span>${getAlertIcon(type)}</span><span>${html}</span>`;
  document.getElementById('uploadZone').parentNode.insertBefore(div, document.getElementById('uploadZone'));
  if (type !== 'error') alertTimeout = setTimeout(() => div.remove(), 6000);
}
function getAlertIcon(t) {
  return {warning:'⚠️',error:'❌',info:'ℹ️',success:'✅'}[t] || 'ℹ️';
}

function refreshLoadedChips() {
  const container = document.getElementById('loadedPdfs');
  const keys = Object.keys(voterDB).filter(k => !k.endsWith('_meta'));
  container.innerHTML = '';
  const clearWrap = document.getElementById('clearDataWrap');
  if (keys.length) {
    if (clearWrap) clearWrap.style.display = 'block';
    const label = document.createElement('div');
    label.style = 'font-size:12px;color:var(--gray-400);width:100%;margin-bottom:6px';
    label.textContent = `${keys.length} part(s) already processed — no re-upload needed:`;
    container.appendChild(label);
    keys.sort().forEach(k => {
      const [acNum, part] = k.split('_');
      const meta  = voterDB[k + '_meta'] || {};
      const count = meta.recordCount || (voterDB[k] || []).length;
      const when  = meta.processedAt
        ? new Date(meta.processedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'})
        : '';
      const chip = document.createElement('div');
      chip.className = 'pdf-chip';
      chip.title = `AC ${acNum} · Part ${part} · ${count} records · processed ${when}`;
      chip.innerHTML = `<span class="dot"></span> AC ${acNum.replace('A','')} · Part ${part} &nbsp;·&nbsp; ${count} voters${when ? ' &nbsp;·&nbsp; ' + when : ''}`;
      container.appendChild(chip);
    });
    currentSearchScope = keys;
  } else {
    if (clearWrap) clearWrap.style.display = 'none';
  }
}

function clearStoredData() {
  if (!confirm('This will delete all stored PDF data from your browser. You will need to re-upload PDFs to search again. Continue?')) return;
  voterDB = {};
  fuseInstances = {};
  currentSearchScope = [];
  if (storageAvailable) {
    try { localStorage.removeItem('electoralDB'); } catch(e) {}
  }
  refreshLoadedChips();
  clearResults();
  showAlert('info', 'All stored PDF data has been cleared. Please upload new PDFs to search.');
}

function clearResults() {
  document.getElementById('resultsSection').style.display = 'none';
}

// Enter key
document.getElementById('searchName').addEventListener('keydown', e => { if(e.key==='Enter') performSearch(); });
document.getElementById('searchRelative').addEventListener('keydown', e => { if(e.key==='Enter') performSearch(); });

// ====================================================================
// SEARCH MODE TABS
// ====================================================================
function switchTab(mode) {
  const dbPanel   = document.getElementById('tab-panel-upload');
  const dbCard    = document.querySelector('.card'); // Step 0 card
  const tabDb     = document.getElementById('tab-btn-db');
  const tabUpload = document.getElementById('tab-btn-upload');

  // The Step 0 "db" card is always the first .card after tabs
  // We identify it by its step-badge content
  const allCards = document.querySelectorAll('.main > .card');
  const step0Card = Array.from(allCards).find(c => {
    const badge = c.querySelector('.step-badge');
    return badge && badge.textContent.trim() === '0';
  });

  const panelDb = document.getElementById('tab-panel-db');
  const panelUpload = document.getElementById('tab-panel-upload');

  if (mode === 'db') {
    tabDb.classList.add('active');
    tabDb.setAttribute('aria-selected','true');
    tabUpload.classList.remove('active');
    tabUpload.setAttribute('aria-selected','false');
    if (step0Card) step0Card.style.display = '';
    if (panelDb) { panelDb.style.display = ''; panelDb.style.animation = 'fade-in-up 0.3s ease both'; }
    if (panelUpload) panelUpload.style.display = 'none';
  } else {
    tabUpload.classList.add('active');
    tabUpload.setAttribute('aria-selected','true');
    tabDb.classList.remove('active');
    tabDb.setAttribute('aria-selected','false');
    if (step0Card) step0Card.style.display = 'none';
    if (panelDb) panelDb.style.display = 'none';
    if (panelUpload) { panelUpload.style.display = ''; panelUpload.style.animation = 'fade-in-up 0.3s ease both'; }
  }
}

// ====================================================================
// WHATSAPP SHARE
// ====================================================================
(function initShare() {
  const url  = encodeURIComponent(window.location.href);
  const text = encodeURIComponent(
    '🗳️ Find your name in the 2002 Karnataka voter list!\n' +
    'Search Bagalkot, BBMP & Mysore by name — no login needed.\n' +
    window.location.href
  );
  const btn = document.getElementById('btn-whatsapp-share');
  if (btn) {
    btn.href = 'https://wa.me/?text=' + text;
  }
})();

function copyPageLink() {
  const btn = document.getElementById('btn-copy-link');
  navigator.clipboard.writeText(window.location.href).then(() => {
    btn.textContent = '✅ Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '🔗 Copy Link';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = window.location.href;
    document.body.appendChild(ta);
    ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = '✅ Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '🔗 Copy Link'; btn.classList.remove('copied'); }, 2000);
  });
}

// ====================================================================
// PROMINENT DISTRICT VOTE BANNER
// ====================================================================
const VOTE_STORAGE_KEY = 'districtVotes_v2';
const VOTE_STORAGE_KEY_LEGACY = 'district_vote_counts_v1';

function loadVotes() {
  try {
    const raw = localStorage.getItem(VOTE_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    const legacy = localStorage.getItem(VOTE_STORAGE_KEY_LEGACY);
    if (!legacy) return {};
    const obj = JSON.parse(legacy);
    if (obj && typeof obj === 'object') {
      localStorage.setItem(VOTE_STORAGE_KEY, JSON.stringify(obj));
      return obj;
    }
    return {};
  } catch(e) { return {}; }
}
function saveVotes(v) {
  try { localStorage.setItem(VOTE_STORAGE_KEY, JSON.stringify(v)); } catch(e) {}
}

function submitVoteNew() {
  const sel = document.getElementById('sel-vote-district-new');
  const district = sel.value;
  if (!district) { sel.style.borderColor = 'var(--saffron)'; setTimeout(()=>{sel.style.borderColor='';},1500); return; }

  const votes = loadVotes();
  votes[district] = (votes[district] || 0) + 1;
  saveVotes(votes);

  const btn = document.getElementById('btn-vote-new');
  btn.style.animation = 'none';
  btn.textContent = '✅ Voted!';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = '🗳️ Cast My Vote'; btn.disabled = false; }, 3000);

  /*
   * TO TRACK VOTES ACROSS ALL USERS — deploy a Cloudflare Worker, then uncomment:
   * fetch('https://your-worker.workers.dev/vote', {
   *   method: 'POST',
   *   headers: { 'Content-Type': 'application/json' },
   *   body: JSON.stringify({ district: district })
   * }).catch(e => console.log('Vote sync failed:', e));
   */

  renderVoteResults();
}

function renderVoteResults() {
  const bar = document.getElementById('vote-results-bar-new');
  if (!bar) return;
  const votes = loadVotes();
  const entries = Object.entries(votes).sort((a,b) => b[1]-a[1]).slice(0, 5);
  if (!entries.length) {
    bar.classList.remove('show');
    return;
  }
  const max = entries[0][1] || 1;
  const total = Object.values(votes).reduce((s,v)=>s+(parseInt(v,10)||0), 0);
  bar.innerHTML = `<div style="font-size:12.5px;font-weight:800;color:#FFD700;margin-bottom:8px;font-family:'JetBrains Mono',monospace">
    🏆 Leading: <span style="text-decoration:underline">${entries[0][0]}</span>
    &nbsp;·&nbsp; <span style="font-weight:400;opacity:0.8">Total community votes: ${total}</span>
  </div>`;
  bar.innerHTML += '<div style="font-size:11px;font-weight:700;color:rgba(255,255,255,0.55);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Top districts:</div>';
  entries.forEach(([name, count]) => {
    const pct = Math.round((count / max) * 100);
    const isLeader = (name === entries[0][0]);
    bar.innerHTML += `
      <div class="vote-result-row">
        <div class="vote-result-name" style="${isLeader?'color:#FFD700;font-weight:800':''}">${isLeader?'🏆 ':''}${name}</div>
        <div class="vote-result-track"><div class="vote-result-fill" style="width:${pct}%"></div></div>
        <div class="vote-result-count">${count} vote${count!==1?'s':''}</div>
      </div>`;
  });
  bar.classList.add('show');
}

// Render on load if votes exist
(function() {
  const v = loadVotes();
  if (Object.keys(v).length > 0) renderVoteResults();
})();

// ====================================================================
// ADMIN PANEL — activated by URL hash #admin
// ====================================================================
function renderAdminPanel() {
  const panel = document.getElementById('admin-panel');
  if (!panel) return;
  const votes = loadVotes();
  const entries = Object.entries(votes).sort((a,b) => b[1]-a[1]);
  const tableEl = document.getElementById('admin-vote-table');
  if (!tableEl) return;
  if (!entries.length) {
    tableEl.innerHTML = '<div style="color:#888;padding:6px">No votes recorded in this browser yet.</div>';
  } else {
    let html = '<table><tr><th>District</th><th>Votes</th></tr>';
    entries.forEach(([d,v]) => { html += `<tr><td>${d}</td><td><b>${v}</b></td></tr>`; });
    html += `</table><div style="color:#888;margin-top:4px;font-size:10px">Total: ${entries.reduce((s,[,v])=>s+v,0)} votes</div>`;
    tableEl.innerHTML = html;
  }
  panel.style.display = 'block';
}

function adminCopyJSON() {
  const data = loadVotes();
  const txt = JSON.stringify(data, null, 2);
  navigator.clipboard.writeText(txt).then(()=>alert('✅ JSON copied to clipboard!')).catch(()=>prompt('Copy this JSON:', txt));
}

function adminCopyCSV() {
  const data = loadVotes();
  const rows = ['District,Votes', ...Object.entries(data).sort((a,b)=>b[1]-a[1]).map(([d,v])=>`\"${d}\",${v}`)];
  const csv = rows.join('\n');
  navigator.clipboard.writeText(csv).then(()=>alert('✅ CSV copied to clipboard!')).catch(()=>prompt('Copy this CSV:', csv));
}

function checkAdminHash() {
  const panel = document.getElementById('admin-panel');
  if (!panel) return;
  if (window.location.hash === '#admin') renderAdminPanel();
  else panel.style.display = 'none';
}
window.addEventListener('hashchange', checkAdminHash);
checkAdminHash();

// ====================================================================
// FEEDBACK MODAL
// ====================================================================
function openFeedback() {
  document.getElementById('feedbackModalOverlay').classList.add('show');
}
function closeFeedback() {
  document.getElementById('feedbackModalOverlay').classList.remove('show');
}
function closeFeedbackIfBg(e) {
  if (e.target === document.getElementById('feedbackModalOverlay')) closeFeedback();
}

let feedbackScreenshotBase64 = null;

function previewScreenshot(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    feedbackScreenshotBase64 = ev.target.result;
    const img = document.getElementById('feedback-preview');
    img.src = ev.target.result;
    img.style.display = 'block';
    document.querySelector('#feedbackSSArea p').textContent = '✅ Screenshot attached';
  };
  reader.readAsDataURL(file);
}

function submitFeedback() {
  const text = document.getElementById('feedbackText').value.trim();
  if (!text) {
    document.getElementById('feedbackText').style.borderColor = 'var(--saffron)';
    document.getElementById('feedbackText').placeholder = '⚠️ Please describe the issue before sending.';
    return;
  }
  document.getElementById('feedbackText').style.borderColor = '';

  // Use mailto: as a reliable, zero-backend approach
  const subject = encodeURIComponent('votershare2002 Feedback');
  const body = encodeURIComponent(
    'Feedback from VoterSearch2002\n' +
    '================================\n\n' +
    text +
    '\n\n--- Page URL ---\n' + window.location.href +
    (feedbackScreenshotBase64
      ? '\n\n[Screenshot attached — please reply to this email if not visible]'
      : '')
  );

  // Open mail client
  window.location.href = `mailto:umar.xperiments@gmail.com?subject=${subject}&body=${body}`;

  // Show confirmation and close after delay
  const sending = document.getElementById('feedbackSending');
  sending.style.display = 'block';
  sending.innerHTML = '<div style="font-size:15px;color:var(--green);font-weight:700;text-align:center">✅ Opening your email client…<br><span style="font-size:12px;color:var(--gray-600);font-weight:400">If it doesn\'t open, email umar.xperiments@gmail.com<br>with subject: <b>votershare2002</b></span></div>';
  document.querySelector('.feedback-actions').style.display = 'none';

  setTimeout(() => {
    closeFeedback();
    sending.style.display = 'none';
    document.querySelector('.feedback-actions').style.display = '';
    document.getElementById('feedbackText').value = '';
    feedbackScreenshotBase64 = null;
    const img = document.getElementById('feedback-preview');
    img.src = ''; img.style.display = 'none';
    document.querySelector('#feedbackSSArea p').textContent = 'Click to attach a screenshot';
  }, 3500);
}

// ====================================================================
// NAME SPLIT HINT for concatenated Kannada names in upload search
// ====================================================================
// This is a non-breaking display hint only — shows in result cards.
// We inject a small note if the returned name looks like a compound
// (e.g. "syedabanu" — no space, length > 8, common Muslim name patterns).
function maybeSplitName(latinName) {
  if (!latinName) return null;
  const n = latinName.toLowerCase().replace(/\s/g,'');
  if (n.length < 7) return null;
  const splits = [
    [/^(syeda)(banu|begum|parween|parveen|khanam|sultana|bibi|tabassum)/, '$1 $2'],
    [/^(fathima|fatima|fatheema|patima|pathima)(bi|banu|begum|unnisa|sulthana)/, '$1 $2'],
    [/^(noor|nur)(jahan|unnisa|banu|basha|nisa|sultana)/, '$1 $2'],
    [/^(kamar|rahat|fasal|pasal|anjum|tajun|halim|rahimann?)(unnisa|nissa|unnissa)/, '$1 unnisa'],
    [/^(aisha|ayesha|amina|aminaa?)(banu|begum|bi)/, '$1 $2'],
    [/^(abdul|abdull?a?)(rehman|rahman|rahim|karim|aziz|azeez|hamid|latif|majid|wahab|razak|razzak|sattar|jabbar|qadir|hakim|hafeez|rashid|ghani|khader|kader|baseer|basheer|matin|mateen|wajid|wajeed|hameed|haseeb)/, '$1 $2'],
    [/^(mohammed|mohammad|mohd|md|muhammed|mohamad)(ali|hussain|hussein|rafi|rafiq|sajid|imran|iqbal|arif|farooq|parooq|moin|shafi|aslam|akram|ibrahim|ismail|yusuf|yunus|kaleem|saleem|nazir|tahir|bashir|munir|aamir|amir|hasan|haneef|hanif|kasim|khader|gouse|ghaus|yousuf|sharif|shareef|jaleel|jameel)/, '$1 $2'],
    [/^(syed|syayed|sayyad|sayyed|shaikh|shaik)(ali|hussain|mohd|mohammed|ahmad|ahmed|moin|ghouse|sadiq|razvi|jalal|kasim|yasin|ibrahim|mujeeb|mohinuddin|najaruddin|inayath|mujeebu?r?)/, '$1 $2'],
    [/^([a-z]{4,})(begum|begam)$/, '$1 $2'],
    [/^([a-z]{4,})(banu)$/, '$1 banu'],
    [/^([a-z]{4,})(khan)$/, '$1 khan'],
    [/^([a-z]{4,})(bi)$/, '$1 bi'],
    [/^([a-z]{4,})(unnisa)$/, '$1 $2'],
    [/^(balaram)(bhovi|bovi|bhavi)/, '$1 $2'],
    [/^(shivabasappa|shivabasavappa)/, 'shiva basappa'],
    [/^(narayanakutti|narayanakutty)/, 'narayana kutti'],
    [/^(muniswami|muneeswami|munniswamy)/, 'muni swami'],
    [/^(pattabirama|pattabhirama)/, 'pattabhi rama'],
    [/^(siddharama|siddharamappa)/, 'siddha rama'],
    [/^(musthafa|mustafa)(kitore|kitoore|kittore|kitoor)/, '$1 $2'],
    [/^(mohamad|mohammed)(kitore|kitoore|kittore|kitoor)/, '$1 $2'],
    [/^(rama?)(krishna)/, '$1 $2'],
    [/^(lakshmi)(narayana|devi|pathi)/, '$1 $2'],
    [/^(venkata)(ramana|chala|krishna|raman)/, '$1 $2'],
    [/^(putta|ramaa?)(swamy|swami)/, '$1 $2'],
  ];
  const cleaned = latinName.toLowerCase().replace(/[^a-z]/g,'');
  for (const [re, rep] of splits) {
    if (!rep) continue;
    if (re.test(cleaned)) {
      const suggested = cleaned.replace(re, rep);
      if (suggested !== cleaned) return suggested;
    }
  }
  return null;
}

// ====================================================================
// CSP-COMPLIANT EVENT BINDING
// Replaces all inline onclick/onchange handlers removed from HTML.
// ====================================================================
(function bindEvents() {
  const $ = (id) => document.getElementById(id);

  // Copy link button
  const btnCopy = $('btn-copy-link');
  if (btnCopy) btnCopy.addEventListener('click', copyPageLink);

  // Vote button
  const btnVote = $('btn-vote-new');
  if (btnVote) btnVote.addEventListener('click', submitVoteNew);

  // Tab switching
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
  });

  // PDF file input
  const pdfInput = $('pdfInput');
  if (pdfInput) pdfInput.addEventListener('change', onFileSelected);

  // Clear stored data
  const btnClearStored = $('btn-clear-stored');
  if (btnClearStored) btnClearStored.addEventListener('click', clearStoredData);

  // Upload search button
  const searchBtn = $('searchBtn');
  if (searchBtn) searchBtn.addEventListener('click', performSearch);

  // Clear results (upload tab)
  const btnClearResults = $('btn-clear-results');
  if (btnClearResults) btnClearResults.addEventListener('click', clearResults);

  // Admin panel buttons
  const btnAdminJson = $('btn-admin-json');
  if (btnAdminJson) btnAdminJson.addEventListener('click', adminCopyJSON);
  const btnAdminCsv = $('btn-admin-csv');
  if (btnAdminCsv) btnAdminCsv.addEventListener('click', adminCopyCSV);
  const btnAdminClose = $('btn-admin-close');
  if (btnAdminClose) btnAdminClose.addEventListener('click', () => {
    $('admin-panel').style.display = 'none';
  });

  // Feedback
  const btnFeedback = $('btn-feedback');
  if (btnFeedback) btnFeedback.addEventListener('click', openFeedback);
  const overlay = $('feedbackModalOverlay');
  if (overlay) overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeFeedback();
  });
  const feedbackSS = $('feedbackSSInput');
  if (feedbackSS) feedbackSS.addEventListener('change', previewScreenshot);
  const btnSubmitFb = $('btn-submit-feedback');
  if (btnSubmitFb) btnSubmitFb.addEventListener('click', submitFeedback);
  const btnCancelFb = $('btn-cancel-feedback');
  if (btnCancelFb) btnCancelFb.addEventListener('click', closeFeedback);

  // Success modal close
  const btnCloseModal = $('btn-close-modal');
  if (btnCloseModal) btnCloseModal.addEventListener('click', closeModal);
})();
