/**
 * UI Utilities — DOM helpers, alerts, rendering primitives.
 * @module ui
 */

import { escapeHtml } from './search-utils';

/** Show a status banner with type and message */
export function showBanner(type: 'green' | 'yellow' | 'red' | 'error', message: string): void {
  const banner = document.getElementById('div-status-banner');
  if (!banner) return;
  banner.style.display = 'block';
  const colorMap: Record<string, string> = {
    green: 'alert-success',
    yellow: 'alert-warning',
    red: 'alert-error',
    error: 'alert-error',
  };
  banner.className = `alert ${colorMap[type] || 'alert-info'}`;
  banner.textContent = message;
}

/** Hide the status banner */
export function hideBanner(): void {
  const banner = document.getElementById('div-status-banner');
  if (banner) banner.style.display = 'none';
}

/** Show search progress bar */
export function showProgress(text: string, pct: number | null = null): void {
  const div = document.getElementById('div-search-progress');
  if (!div) return;
  div.style.display = 'block';
  const t = div.querySelector('.progress-text');
  if (t) t.textContent = text;
  if (pct !== null) {
    const fill = div.querySelector<HTMLElement>('.progress-bar-fill');
    if (fill) fill.style.width = `${pct}%`;
  }
}

/** Hide search progress bar */
export function hideProgress(): void {
  const div = document.getElementById('div-search-progress');
  if (div) div.style.display = 'none';
}

/** Show skeleton loading cards */
export function showSkeletonResults(count: number): void {
  const container = document.getElementById('div-db-results');
  if (!container) return;
  let skeletons = '';
  for (let i = 0; i < count; i++) {
    skeletons += '<div class="result-card skeleton-card" aria-hidden="true">' +
      '<div class="skeleton-line skeleton-wide"></div>' +
      '<div class="skeleton-line skeleton-medium"></div>' +
      '<div class="skeleton-line skeleton-short"></div>' +
      '</div>';
  }
  container.innerHTML = '<div id="results-grid">' + skeletons + '</div>';
}

/** Remove skeleton cards */
export function hideSkeletonResults(): void {
  const skeletons = document.querySelectorAll('.skeleton-card');
  skeletons.forEach(el => el.remove());
}

/** Create a debounced version of a function */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { fn(...args); timer = null; }, delay);
  };
}

/** Safely set innerHTML with escaped content */
export function safeInnerHTML(element: HTMLElement, html: string): void {
  element.innerHTML = html;
}

/** Escape for data attributes */
export function escAttr(str: string): string {
  return encodeURIComponent(str);
}

export { escapeHtml as esc };
