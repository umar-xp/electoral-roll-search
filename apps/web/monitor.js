/**
 * Production Error & Performance Monitoring
 * ==========================================
 * Lightweight client-side observability without external dependencies.
 * Captures errors, performance metrics, and search analytics.
 *
 * Data is stored in sessionStorage for diagnostics and optionally
 * sent to a configurable endpoint (Sentry DSN, custom webhook, etc.)
 *
 * To enable remote reporting, set window.__MONITOR_ENDPOINT to your URL.
 */

(function() {
  'use strict';

  const MAX_STORED_ERRORS = 50;
  const MAX_STORED_METRICS = 100;
  const STORAGE_KEY_ERRORS = '_voter_search_errors';
  const STORAGE_KEY_METRICS = '_voter_search_metrics';

  // ─── Error Capture ────────────────────────────────────────────────

  function captureError(error, context) {
    const entry = {
      ts: new Date().toISOString(),
      msg: error.message || String(error),
      stack: (error.stack || '').split('\n').slice(0, 5).join('\n'),
      ctx: context || '',
      url: location.pathname,
      ua: navigator.userAgent.slice(0, 80),
    };

    // Store locally
    try {
      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY_ERRORS) || '[]');
      stored.push(entry);
      if (stored.length > MAX_STORED_ERRORS) stored.shift();
      sessionStorage.setItem(STORAGE_KEY_ERRORS, JSON.stringify(stored));
    } catch (_) { /* sessionStorage full or unavailable */ }

    // Send to remote endpoint if configured
    if (window.__MONITOR_ENDPOINT) {
      sendToEndpoint('error', entry);
    }

    // Console warning in development
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      console.warn('[Monitor]', entry.msg, context);
    }
  }

  function captureMetric(name, value, tags) {
    const entry = {
      ts: new Date().toISOString(),
      name,
      value,
      tags: tags || {},
    };

    try {
      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY_METRICS) || '[]');
      stored.push(entry);
      if (stored.length > MAX_STORED_METRICS) stored.shift();
      sessionStorage.setItem(STORAGE_KEY_METRICS, JSON.stringify(stored));
    } catch (_) { /* ignore */ }

    if (window.__MONITOR_ENDPOINT) {
      sendToEndpoint('metric', entry);
    }
  }

  // ─── Remote Reporting ─────────────────────────────────────────────

  let _sendQueue = [];
  let _sendTimer = null;

  function sendToEndpoint(type, data) {
    _sendQueue.push({ type, data });

    // Batch send: wait 2s then send all queued items
    if (!_sendTimer) {
      _sendTimer = setTimeout(flushQueue, 2000);
    }
  }

  function flushQueue() {
    _sendTimer = null;
    if (!_sendQueue.length || !window.__MONITOR_ENDPOINT) return;

    const batch = _sendQueue.splice(0, 20);

    // Use sendBeacon for reliability (survives page unload)
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        window.__MONITOR_ENDPOINT,
        JSON.stringify({ events: batch, site: 'votersearch2002' })
      );
    } else {
      fetch(window.__MONITOR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch, site: 'votersearch2002' }),
        keepalive: true,
      }).catch(() => {});
    }
  }

  // ─── Global Error Handlers ────────────────────────────────────────

  window.addEventListener('error', function(event) {
    captureError(
      event.error || new Error(event.message),
      `${event.filename}:${event.lineno}:${event.colno}`
    );
  });

  window.addEventListener('unhandledrejection', function(event) {
    captureError(
      event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
      'unhandledrejection'
    );
  });

  // ─── Performance Metrics ──────────────────────────────────────────

  window.addEventListener('load', function() {
    // Capture page load performance
    setTimeout(function() {
      if (performance.getEntriesByType) {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) {
          captureMetric('page_load_ms', Math.round(nav.loadEventEnd - nav.startTime));
          captureMetric('dom_ready_ms', Math.round(nav.domContentLoadedEventEnd - nav.startTime));
          captureMetric('ttfb_ms', Math.round(nav.responseStart - nav.requestStart));
        }
      }

      // Core Web Vitals: LCP
      if (PerformanceObserver && PerformanceObserver.supportedEntryTypes &&
          PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) {
        try {
          new PerformanceObserver(function(list) {
            const entries = list.getEntries();
            if (entries.length) {
              captureMetric('lcp_ms', Math.round(entries[entries.length - 1].startTime));
            }
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        } catch (_) { /* not supported */ }
      }

      // Core Web Vitals: CLS
      if (PerformanceObserver && PerformanceObserver.supportedEntryTypes &&
          PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
        try {
          let clsValue = 0;
          new PerformanceObserver(function(list) {
            for (var entry of list.getEntries()) {
              if (!entry.hadRecentInput) clsValue += entry.value;
            }
            captureMetric('cls', Math.round(clsValue * 1000) / 1000);
          }).observe({ type: 'layout-shift', buffered: true });
        } catch (_) { /* not supported */ }
      }

      // Core Web Vitals: FID / INP
      if (PerformanceObserver && PerformanceObserver.supportedEntryTypes &&
          PerformanceObserver.supportedEntryTypes.includes('first-input')) {
        try {
          new PerformanceObserver(function(list) {
            var entry = list.getEntries()[0];
            if (entry) captureMetric('fid_ms', Math.round(entry.processingStart - entry.startTime));
          }).observe({ type: 'first-input', buffered: true });
        } catch (_) { /* not supported */ }
      }
    }, 100);
  });

  // Flush on page unload
  window.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') {
      flushQueue();
    }
  });

  // ─── Public API ───────────────────────────────────────────────────

  window.Monitor = {
    captureError,
    captureMetric,

    /**
     * Track search performance.
     * @param {Object} params - { query, results, time_ms, district }
     */
    trackSearch(params) {
      captureMetric('search', params.time_ms, {
        results: params.results,
        district: params.district || 'global',
        hasResults: params.results > 0,
      });
    },

    /**
     * Get all stored errors for diagnostics.
     */
    getErrors() {
      try {
        return JSON.parse(sessionStorage.getItem(STORAGE_KEY_ERRORS) || '[]');
      } catch (_) { return []; }
    },

    /**
     * Get all stored metrics.
     */
    getMetrics() {
      try {
        return JSON.parse(sessionStorage.getItem(STORAGE_KEY_METRICS) || '[]');
      } catch (_) { return []; }
    },

    /**
     * Clear all stored diagnostics data.
     */
    clear() {
      sessionStorage.removeItem(STORAGE_KEY_ERRORS);
      sessionStorage.removeItem(STORAGE_KEY_METRICS);
    },
  };
})();
