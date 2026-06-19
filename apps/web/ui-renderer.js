/**
 * UI Rendering Module — All DOM manipulation in one place.
 * =========================================================
 * Handles banners, progress bars, skeleton loading, and result rendering.
 * No inline styles — all CSS classes are used.
 */

const UIRenderer = (function() {
  'use strict';

  function showBanner(type, msg) {
    const el = document.getElementById('div-status-banner');
    if (!el) return;
    el.style.display = 'block';
    el.className = `alert alert-${type === 'error' ? 'error' : type === 'red' ? 'error' : type}`;
    el.textContent = msg;
  }

  function hideBanner() {
    const el = document.getElementById('div-status-banner');
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  }

  function showProgress(text, pct) {
    const bar = document.getElementById('div-search-progress');
    if (!bar) return;
    bar.style.display = 'block';
    const textEl = bar.querySelector('.progress-text');
    if (textEl) textEl.textContent = text;
    const fill = bar.querySelector('.progress-bar-fill');
    if (fill) fill.style.width = `${Math.min(100, pct || 0)}%`;
  }

  function hideProgress() {
    const bar = document.getElementById('div-search-progress');
    if (bar) bar.style.display = 'none';
  }

  function showSkeletonResults(count) {
    const container = document.getElementById('div-db-results');
    if (!container) return;
    const skeletons = Array.from({ length: count }, () =>
      '<div class="result-card skeleton-card"><div class="skeleton-line skeleton-w80"></div><div class="skeleton-line skeleton-w60"></div><div class="skeleton-line skeleton-w40"></div></div>'
    ).join('');
    container.innerHTML = skeletons;
  }

  function clearResults() {
    const div = document.getElementById('div-db-results');
    if (div) div.innerHTML = '';
  }

  /**
   * Render a single voter card (XSS-safe).
   */
  function renderVoterCard(voter, selectedAC, selectedPart) {
    const relTypeLabel = { 'F': 'Father | ತಂದೆ', 'H': 'Husband | ಗಂಡ', 'M': 'Mother | ತಾಯಿ', 'W': 'Wife | ಹೆಂಡತಿ' }[voter.rt] || voter.rt || '';
    const genderLabel = voter.g === 'M' ? 'Male | ಗಂಡಸು' : 'Female | ಹೆಂಗಸು';
    const genderClass = voter.g === 'M' ? 'tag-male' : 'tag-female';
    const voterId = voter.id ? `<div class="result-field"><label>Voter ID | EPIC</label><div class="val monospace">${escapeHtml(voter.id)}</div></div>` : '';
    const acNum = voter.ac != null ? String(voter.ac) : (selectedAC || '');
    const partNum = voter.pn != null ? String(voter.pn) : (selectedPart != null ? String(selectedPart) : '');

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
           >Found / This is me</button>
         </div>`
      : '';

    const dqWarn = voter.dq === 0
      ? '<div class="data-quality-warn">Details may be incomplete \u2014 verify from official rolls | \u0C88 \u0CB5\u0CBF\u0CB5\u0CB0\u0C97\u0CB3\u0CC1 \u0C85\u0CAA\u0CC2\u0CB0\u0CCD\u0CA3\u0CB5\u0CBE\u0C97\u0CBF\u0CB0\u0CAC\u0CB9\u0CC1\u0CA6\u0CC1</div>'
      : '';

    return `
      <div class="result-card" tabindex="0" role="article" aria-label="Voter: ${escapeHtml(voter.vn || voter.vk || '')}">
        <div class="result-grid">
          <div class="result-field">
            <label>Name | ಹೆಸರು</label>
            <div class="val voter-name-kn">${escapeHtml(voter.vk) || '\u2014'}</div>
            <div class="voter-name-en">${escapeHtml(voter.vn) || ''}</div>
          </div>
          <div class="result-field">
            <label>${relTypeLabel || 'Relative Name | ಸಂಬಂಧಿತರ ಹೆಸರು'}</label>
            <div class="val voter-name-kn">${escapeHtml(voter.rk) || '\u2014'}</div>
            <div class="voter-name-en">${escapeHtml(voter.rn) || ''}</div>
          </div>
          <div class="result-field"><label>Serial No.</label><div class="val">${escapeHtml(voter.sn) ?? '\u2014'}</div></div>
          <div class="result-field"><label>Part Serial No.</label><div class="val monospace highlight">${escapeHtml(voter.psn) || '\u2014'}</div></div>
          <div class="result-field"><label>AC / Part</label><div class="val">${acNum ? `AC ${escapeHtml(acNum)}` : '\u2014'}${partNum ? ` \u00B7 Part ${escapeHtml(partNum)}` : ''}</div></div>
          <div class="result-field"><label>House No.</label><div class="val">${escapeHtml(voter.hn) || '\u2014'}</div></div>
          <div class="result-field">
            <label>Gender / Age</label>
            <div class="val">
              <span class="tag ${genderClass}">${genderLabel}</span>
              <span class="tag tag-age">${voter.a != null ? `${escapeHtml(String(voter.a))} yrs` : '\u2014'}</span>
            </div>
          </div>
          ${voterId}
        </div>
        ${thisMeBtn}
        ${dqWarn}
      </div>`;
  }

  /**
   * Render full results list.
   */
  function renderResults(results, opts) {
    const { isPartial, searched, total, voterName, pageSize, selectedAC, selectedPart } = opts;
    const container = document.getElementById('div-db-results');
    if (!container) return;

    const count = results.length;
    const toShow = results.slice(0, pageSize);

    const countText = isPartial
      ? `Found ${count}+ matches (searching ${searched}/${total} parts...)`
      : `Found ${count} voter${count !== 1 ? 's' : ''} matching "${escapeHtml(voterName)}" across ${total} parts`;

    const remaining = count - pageSize;

    container.innerHTML = `
      <div class="results-disclaimer">
        English names are transliterated from Kannada text and may contain spelling variations.
      </div>
      <div class="results-header">
        <span class="results-count">${countText}</span>
      </div>
      <div id="results-grid">
        ${toShow.map(v => renderVoterCard(v, selectedAC, selectedPart)).join('')}
      </div>
      ${count > pageSize ? `
        <div class="load-more-row">
          <button class="btn btn-outline btn-sm load-more-btn" id="btn-load-more">
            Load ${Math.min(pageSize, remaining)} more (${remaining} remaining)
          </button>
        </div>` : ''}
    `;

    return toShow.length;
  }

  function renderNoResults(voterName, relName) {
    const container = document.getElementById('div-db-results');
    if (!container) return;
    container.innerHTML = `
      <div class="result-card no-results-card">
        <h3 class="no-results-title">No results found | ಯಾವುದೇ ಮತದಾರರು ಕಂಡುಬಂದಿಲ್ಲ</h3>
        <p class="no-results-detail">
          No voters found for "<strong>${escapeHtml(voterName)}</strong>"${relName ? ` with relative "<strong>${escapeHtml(relName)}</strong>"` : ''}
        </p>
        <div class="no-results-tips">
          <h4>Search tips:</h4>
          <ul>
            <li>Try a shorter name (first word only)</li>
            <li>Muslim names may vary (Abdul/Abdur, Mohammad/Mohammed)</li>
            <li>Remove Part filter and search all parts</li>
            <li>Try searching in Kannada</li>
          </ul>
        </div>
      </div>`;
  }

  return {
    showBanner,
    hideBanner,
    showProgress,
    hideProgress,
    showSkeletonResults,
    clearResults,
    renderVoterCard,
    renderResults,
    renderNoResults,
  };
})();

if (typeof window !== 'undefined') {
  window.UIRenderer = UIRenderer;
  // Backward compat aliases
  window.showBanner = UIRenderer.showBanner;
  window.hideBanner = UIRenderer.hideBanner;
  window.showProgress = UIRenderer.showProgress;
  window.hideProgress = UIRenderer.hideProgress;
  window.showSkeletonResults = UIRenderer.showSkeletonResults;
}
