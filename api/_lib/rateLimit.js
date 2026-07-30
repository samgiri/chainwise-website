// Best-effort abuse protection for /api/analyze.
//
// When Vercel KV is configured (KV_REST_API_URL/KV_REST_API_TOKEN), this uses a real
// distributed fixed-window counter shared across serverless instances. Without KV, it
// falls back to an in-memory Map scoped to a single warm serverless instance - this is a
// known, documented limitation (a fresh cold start or a different instance resets the
// count), not a claim of production-grade distributed rate limiting.

const WINDOW_SECONDS = 300; // 5 minutes
const MAX_REQUESTS_PER_WINDOW = 20;

const memoryStore = new Map();

function cleanupMemoryStore(now) {
  for (const [key, entry] of memoryStore) {
    if (now - entry.windowStart > WINDOW_SECONDS * 1000) memoryStore.delete(key);
  }
}

async function checkRateLimitMemory(ip) {
  const now = Date.now();
  cleanupMemoryStore(now);
  const entry = memoryStore.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_SECONDS * 1000) {
    memoryStore.set(ip, { windowStart: now, count: 1 });
    return { limited: false, remaining: MAX_REQUESTS_PER_WINDOW - 1 };
  }
  entry.count += 1;
  if (entry.count > MAX_REQUESTS_PER_WINDOW) {
    return { limited: true, remaining: 0 };
  }
  return { limited: false, remaining: MAX_REQUESTS_PER_WINDOW - entry.count };
}

async function checkRateLimitKv(ip) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const key = `ratelimit:analyze:${ip}`;
  try {
    const res = await fetch(`${url}/incr/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`KV incr HTTP ${res.status}`);
    const data = await res.json();
    const count = Number(data.result || 1);
    if (count === 1) {
      await fetch(`${url}/expire/${encodeURIComponent(key)}/${WINDOW_SECONDS}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    if (count > MAX_REQUESTS_PER_WINDOW) return { limited: true, remaining: 0 };
    return { limited: false, remaining: MAX_REQUESTS_PER_WINDOW - count };
  } catch (err) {
    // If KV itself is unreachable, fail open to the in-memory fallback rather than
    // blocking every request because of an unrelated infra outage.
    return checkRateLimitMemory(ip);
  }
}

function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

async function checkRateLimit(req) {
  const ip = extractClientIp(req);
  const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  const result = hasKv ? await checkRateLimitKv(ip) : await checkRateLimitMemory(ip);
  return { ...result, ip, backend: hasKv ? 'kv' : 'memory', windowSeconds: WINDOW_SECONDS, maxRequests: MAX_REQUESTS_PER_WINDOW };
}

module.exports = { checkRateLimit, WINDOW_SECONDS, MAX_REQUESTS_PER_WINDOW };
