/**
 * Health check edge function.
 * Returns service status for uptime monitoring tools (UptimeRobot, Pingdom, etc.)
 */

export default async function handler(request, context) {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '5.0.0',
    checks: {},
  };

  // Check: master_index.json is accessible
  try {
    const url = new URL('/data/master_index.json', request.url);
    const res = await fetch(url.toString(), { method: 'HEAD' });
    checks.checks.data = res.ok ? 'ok' : 'degraded';
  } catch (e) {
    checks.checks.data = 'error';
    checks.status = 'degraded';
  }

  // Check: main app HTML is accessible
  try {
    const url = new URL('/apps/web/index.html', request.url);
    const res = await fetch(url.toString(), { method: 'HEAD' });
    checks.checks.app = res.ok ? 'ok' : 'degraded';
  } catch (e) {
    checks.checks.app = 'error';
    checks.status = 'degraded';
  }

  const statusCode = checks.status === 'ok' ? 200 : 503;

  return new Response(JSON.stringify(checks, null, 2), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export const config = {
  path: '/health',
};
