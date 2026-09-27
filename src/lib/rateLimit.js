/**
 * Simple in-memory rate limiter for API routes.
 * Uses a sliding window approach with per-IP tracking.
 *
 * NOTE: This is process-local — it resets on server restart and
 * doesn't work across multiple server instances. For production,
 * use Redis or a proper rate-limiting service.
 */

/** @type {Map<string, number[]>} IP → array of request timestamps */
const requestLog = new Map();

/** Cleanup interval: purge stale entries every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Periodic cleanup to prevent unbounded memory growth
let cleanupTimer = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of requestLog.entries()) {
      const fresh = timestamps.filter((t) => now - t < 120_000);
      if (fresh.length === 0) {
        requestLog.delete(ip);
      } else {
        requestLog.set(ip, fresh);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't block process exit
  if (cleanupTimer.unref) cleanupTimer.unref();
}

/**
 * Extract client IP from a Next.js request.
 *
 * @param {Request} req
 * @returns {string}
 */
function getClientIp(req) {
  // Next.js forwards headers
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * Check if a request should be rate-limited.
 *
 * @param {Request} req - The incoming request
 * @param {object} [options]
 * @param {number} [options.maxRequests=5] - Max requests allowed in the window
 * @param {number} [options.windowMs=60000] - Time window in milliseconds (default: 1 minute)
 * @returns {{ limited: boolean, remaining: number, retryAfterMs: number, ip: string }}
 */
export function checkRateLimit(req, { maxRequests = 5, windowMs = 60_000 } = {}) {
  startCleanup();

  const ip = getClientIp(req);
  const now = Date.now();

  // Get existing timestamps for this IP
  const timestamps = requestLog.get(ip) || [];

  // Filter to only timestamps within the current window
  const windowStart = now - windowMs;
  const recentTimestamps = timestamps.filter((t) => t > windowStart);

  if (recentTimestamps.length >= maxRequests) {
    // Rate limited — calculate retry-after
    const oldestInWindow = recentTimestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;

    return {
      limited: true,
      remaining: 0,
      retryAfterMs: Math.max(retryAfterMs, 1000),
      ip,
    };
  }

  // Allow request — record timestamp
  recentTimestamps.push(now);
  requestLog.set(ip, recentTimestamps);

  return {
    limited: false,
    remaining: maxRequests - recentTimestamps.length,
    retryAfterMs: 0,
    ip,
  };
}

/**
 * Create a 429 Too Many Requests response.
 *
 * @param {number} retryAfterMs - Milliseconds until the client should retry
 * @returns {Response}
 */
export function rateLimitResponse(retryAfterMs) {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  return Response.json(
    {
      error: "Too many requests. Please try again later.",
      retryAfter: retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}
