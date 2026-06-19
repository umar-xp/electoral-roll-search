/**
 * Rate limiting edge function for /data/* endpoints.
 * 
 * Uses a sliding window approach with in-memory LRU store.
 * NOTE: Edge functions run at the PoP level — each node has its own store.
 * This provides per-node rate limiting which is effective against single-origin
 * scrapers but not distributed attacks. For full distributed rate limiting,
 * upgrade to Netlify's built-in rate limiting or add Cloudflare in front.
 *
 * Limits:
 *   - Normal users: 120 requests per minute per IP
 *   - Suspected bots: 10 requests per minute
 *   - Bulk download detection: 30 unique part files per 5 minutes
 *   - Hard block: known scraping user agents
 */

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS_NORMAL = 120;
const MAX_REQUESTS_SUSPECT = 10;
const BULK_WINDOW_MS = 300_000; // 5 minutes
const MAX_UNIQUE_PARTS = 30; // Max unique part files per bulk window
const MAX_ENTRIES = 10_000; // Cap memory usage

// In-memory stores with LRU eviction
const ipHits = new Map();
const ipPartAccess = new Map();

// Hard-blocked user agent patterns (known scraping tools)
const BLOCKED_USER_AGENTS = [
  /scrapy/i, /python-requests/i, /go-http-client/i,
  /node-fetch/i, /axios\/\d/i, /crawler/i, /spider/i,
  /scraper/i, /httpclient/i, /libwww-perl/i, /mechanize/i,
];

// Soft-suspect patterns (may be legitimate but rate-limited harder)
const SUSPECT_USER_AGENTS = [
  /wget/i, /curl/i, /java\//i, /python-urllib/i,
  /bot(?!.*google|.*bing|.*yandex)/i,
];

const REQUIRED_HEADERS = ['accept', 'accept-language'];

function classifyRequest(request) {
  const ua = request.headers.get('user-agent') || '';

  // Hard block: known scraping tools
  if (!ua || ua.length < 10) return 'blocked';
  if (BLOCKED_USER_AGENTS.some(re => re.test(ua))) return 'blocked';

  // Soft suspect: missing browser headers or suspicious UA
  if (SUSPECT_USER_AGENTS.some(re => re.test(ua))) return 'suspect';
  for (const header of REQUIRED_HEADERS) {
    if (!request.headers.get(header)) return 'suspect';
  }

  return 'normal';
}

function evictOldEntries(store, maxAge) {
  if (store.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.windowStart > maxAge * 2) {
      store.delete(key);
    }
    if (store.size <= MAX_ENTRIES / 2) break;
  }
}

function rateLimitResponse(retryAfterSeconds, limit, message) {
  return new Response(
    JSON.stringify({ error: message || 'Rate limit exceeded. Please try again later.' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfterSeconds),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
      },
    }
  );
}

export default async function handler(request, context) {
  const ip = context.ip || request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const now = Date.now();
  const url = new URL(request.url);
  const path = url.pathname;

  // Periodic eviction
  evictOldEntries(ipHits, WINDOW_MS);
  evictOldEntries(ipPartAccess, BULK_WINDOW_MS);

  // Classify the request
  const classification = classifyRequest(request);

  // Hard block known scrapers
  if (classification === 'blocked') {
    return new Response(
      JSON.stringify({ error: 'Automated access is not permitted. Contact the maintainer for bulk data access.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const maxRequests = classification === 'suspect' ? MAX_REQUESTS_SUSPECT : MAX_REQUESTS_NORMAL;

  // Sliding window rate limit
  let entry = ipHits.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    ipHits.set(ip, entry);
  }
  entry.count++;

  if (entry.count > maxRequests) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    return rateLimitResponse(retryAfter, maxRequests);
  }

  // Bulk download detection for part files
  if (path.includes('/part_') && path.endsWith('.json')) {
    let partEntry = ipPartAccess.get(ip);
    if (!partEntry || now - partEntry.windowStart > BULK_WINDOW_MS) {
      partEntry = { windowStart: now, paths: new Set() };
      ipPartAccess.set(ip, partEntry);
    }
    partEntry.paths.add(path);

    if (partEntry.paths.size > MAX_UNIQUE_PARTS) {
      const retryAfter = Math.ceil((partEntry.windowStart + BULK_WINDOW_MS - now) / 1000);
      return new Response(
        JSON.stringify({
          error: 'Bulk download detected. This service is for individual voter lookups only.',
          hint: 'For research access to bulk data, contact the maintainer.',
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter),
            'X-Bulk-Limit': String(MAX_UNIQUE_PARTS),
          },
        }
      );
    }
  }

  // Pass through with rate limit headers
  const response = await context.next();
  const headers = new Headers(response.headers);
  headers.set('X-RateLimit-Limit', String(maxRequests));
  headers.set('X-RateLimit-Remaining', String(Math.max(0, maxRequests - entry.count)));
  headers.set('X-RateLimit-Reset', String(Math.ceil((entry.windowStart + WINDOW_MS) / 1000)));

  // Security: prevent data from being framed
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export const config = {
  path: '/data/*',
};
