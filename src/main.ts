/**
 * Main entry point — imports all modules and initializes the app.
 * This is the bundler entry point that replaces the monolithic app.js.
 * @module main
 */

import { APP_CONFIG } from './config';
import { LRUCache } from './lru-cache';
import type { VoterRecord, SearchFilters, MasterIndex } from './types';
import { escapeHtml, scoreNameMatch, tokenizeQuery } from './search-utils';
import { showBanner, hideBanner, showProgress, hideProgress, showSkeletonResults } from './ui';

// Re-export for backwards compatibility with existing code
export { APP_CONFIG, LRUCache, escapeHtml, scoreNameMatch, tokenizeQuery };
export type { VoterRecord, SearchFilters, MasterIndex };

// ========== GLOBAL ERROR BOUNDARY ==========
window.addEventListener('error', () => {
  const banner = document.getElementById('div-status-banner');
  if (banner && !banner.dataset.userError) {
    banner.dataset.userError = '1';
    banner.style.display = 'block';
    banner.className = 'alert alert-error';
    banner.textContent = 'Something went wrong. Please refresh the page. | ಏನೋ ತಪ್ಪಾಗಿದೆ. ಪುಟವನ್ನು ರಿಫ್ರೆಶ್ ಮಾಡಿ.';
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.name === 'AbortError') return;
  const banner = document.getElementById('div-status-banner');
  if (banner && !banner.dataset.userError) {
    banner.dataset.userError = '1';
    banner.style.display = 'block';
    banner.className = 'alert alert-error';
    banner.textContent = 'A network request failed. Check your connection and retry. | ನೆಟ್ವರ್ಕ್ ವಿಫಲವಾಗಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.';
  }
});

// ========== SERVICE WORKER ==========
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* SW optional */ });
}

// ========== LAZY VIDEO LOADING ==========
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll<HTMLElement>('.video-lazy').forEach((el) => {
    const loadVideo = () => {
      const videoId = el.getAttribute('data-video-id');
      if (!videoId) return;
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`;
      iframe.setAttribute('allowfullscreen', '');
      iframe.setAttribute('allow', 'autoplay; encrypted-media');
      iframe.title = el.getAttribute('aria-label') || '';
      el.innerHTML = '';
      el.classList.remove('video-lazy');
      el.appendChild(iframe);
    };
    el.addEventListener('click', loadVideo);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); loadVideo(); }
    });
  });
});

// ========== KEYBOARD NAVIGATION ==========
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('successModal');
    if (modal && modal.style.display !== 'none') {
      const closeBtn = document.getElementById('btn-close-modal');
      if (closeBtn) closeBtn.click();
      return;
    }
    const fbOverlay = document.getElementById('feedbackModalOverlay');
    if (fbOverlay && fbOverlay.classList.contains('show')) {
      const cancelBtn = document.getElementById('btn-cancel-feedback');
      if (cancelBtn) cancelBtn.click();
      return;
    }
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const cards = document.querySelectorAll<HTMLElement>('.result-card[tabindex]');
    if (!cards.length) return;
    const current = document.activeElement as HTMLElement;
    const idx = Array.from(cards).indexOf(current);
    if (idx === -1) return;
    e.preventDefault();
    const next = e.key === 'ArrowDown'
      ? Math.min(idx + 1, cards.length - 1)
      : Math.max(idx - 1, 0);
    cards[next].focus();
  }
});

// Export UI utilities for module consumers
export { showBanner, hideBanner, showProgress, hideProgress, showSkeletonResults };
