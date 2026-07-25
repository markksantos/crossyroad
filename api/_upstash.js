// Shared Redis access. Files under /api starting with "_" are not routes.

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

export const configured = Boolean(REDIS_URL && REDIS_TOKEN);

export async function redis(commands) {
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis http ${res.status}`);
  const data = await res.json();
  return data.map((entry) => {
    if (entry.error) throw new Error(entry.error);
    return entry.result;
  });
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : (fwd || '')).split(',')[0].trim() || 'unknown';
}

/** Returns true when the caller is over the limit. */
export async function overRateLimit(key, limit, seconds = 60) {
  const [hits] = await redis([
    ['INCR', key],
    ['EXPIRE', key, String(seconds), 'NX'],
  ]);
  return Number(hits) > limit;
}

export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
}
