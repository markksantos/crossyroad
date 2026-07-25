// Top-10 scoreboard, backed by a Redis sorted set over Upstash's REST API.
// GET  /api/scores            -> { top: [...] }
// POST /api/scores {name,score,coins} -> { top: [...], rank, best }
//
// One entry per name (best score kept), so a single player can't fill the board.

// Works with either naming: Upstash's own vars or Vercel's KV_* aliases.
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const BOARD = 'cc:scores';   // sorted set: member = name, score = best score
const META = 'cc:meta';      // hash: name -> {coins, ts} of that best run
const TOP_N = 10;

const MAX_SCORE = 5000;      // sanity ceiling; nobody is hopping 5000 rows
const MAX_COINS = 5000;
const NAME_MAX = 10;
const RATE_LIMIT = 15;       // submissions per minute per IP

const BANNED = [
  'fuck', 'shit', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'hitler', 'slut', 'whore',
];

async function redis(commands) {
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

// Upstash returns flat [member, score, member, score, …] / [field, value, …].
function pairsToMap(flat) {
  const map = new Map();
  for (let i = 0; i < flat.length; i += 2) map.set(String(flat[i]), flat[i + 1]);
  return map;
}

function buildBoard(flatScores, flatMeta) {
  const meta = pairsToMap(flatMeta || []);
  const out = [];
  for (let i = 0; i < flatScores.length; i += 2) {
    const name = String(flatScores[i]);
    let extra = {};
    try {
      extra = JSON.parse(meta.get(name) || '{}');
    } catch {
      extra = {};
    }
    out.push({
      rank: out.length + 1,
      name,
      score: Number(flatScores[i + 1]) || 0,
      coins: Number(extra.coins) || 0,
      ts: Number(extra.ts) || 0,
    });
  }
  return out;
}

function cleanName(raw) {
  const name = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  if (!name) return { error: 'Enter a name.' };
  const flat = name.replace(/[^A-Z]/g, '');
  if (BANNED.some((word) => flat.includes(word.toUpperCase()))) {
    return { error: 'Pick a different name.' };
  }
  return { name };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : (fwd || '')).split(',')[0].trim() || 'unknown';
}

async function readTop() {
  const [flatScores, flatMeta] = await redis([
    ['ZRANGE', BOARD, '0', String(TOP_N - 1), 'REV', 'WITHSCORES'],
    ['HGETALL', META],
  ]);
  return buildBoard(flatScores || [], flatMeta || []);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: 'Scoreboard not configured.' });
  }

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ top: await readTop() });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

      const { name, error } = cleanName(body.name);
      if (error) return res.status(400).json({ error });

      const score = Math.floor(Number(body.score));
      const coins = Math.floor(Number(body.coins));
      if (!Number.isFinite(score) || score < 1 || score > MAX_SCORE) {
        return res.status(400).json({ error: 'Score out of range.' });
      }
      if (!Number.isFinite(coins) || coins < 0 || coins > MAX_COINS) {
        return res.status(400).json({ error: 'Coins out of range.' });
      }

      const rlKey = `cc:rl:${clientIp(req)}`;
      const [hits] = await redis([
        ['INCR', rlKey],
        ['EXPIRE', rlKey, '60', 'NX'],
      ]);
      if (Number(hits) > RATE_LIMIT) {
        return res.status(429).json({ error: 'Slow down a moment.' });
      }

      // GT keeps the player's personal best; CH tells us whether it improved.
      const [changed] = await redis([['ZADD', BOARD, 'GT', 'CH', String(score), name]]);

      const writes = [];
      if (Number(changed) === 1) {
        writes.push(['HSET', META, name, JSON.stringify({ coins, ts: Date.now() })]);
      }
      const results = await redis([
        ...writes,
        ['ZSCORE', BOARD, name],
        ['ZREVRANK', BOARD, name],
        ['ZRANGE', BOARD, '0', String(TOP_N - 1), 'REV', 'WITHSCORES'],
        ['HGETALL', META],
      ]);
      const [best, revRank, flatScores, flatMeta] = results.slice(writes.length);

      return res.status(200).json({
        name,
        best: Number(best) || score,
        rank: revRank === null || revRank === undefined ? null : Number(revRank) + 1,
        improved: Number(changed) === 1,
        top: buildBoard(flatScores || [], flatMeta || []),
      });
    }

    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('[scores]', err.message);
    return res.status(500).json({ error: 'Scoreboard unavailable.' });
  }
};
