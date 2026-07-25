// Top-10 scoreboard, backed by a Redis sorted set over Upstash's REST API.
//
// GET  /api/scores -> { top: [...] }
// POST /api/scores -> submit a run for verification:
//        { sessionId, seed, issuedAt, rules, sig, inputs, endTick, name }
//
// The client never tells us its score. It tells us which buttons it pressed,
// and the server replays the run to find out what that was worth. A forged
// submission has to survive the same simulation the player did.

import { redis, cors, clientIp, overRateLimit, configured } from './_upstash.js';
import { verifySession, signingReady, SESSION_MAX_AGE_MS, RULES_VERSION } from './_sign.js';
import { replay } from '../src/sim/game.js';

const BOARD = 'cc:scores';   // sorted set: member = name, score = best score
const META = 'cc:meta';      // hash: name -> {coins, ts} of that best run
const TOP_N = 10;

const NAME_MAX = 12;
const RATE_LIMIT = 15;       // submissions per minute per IP

const BANNED = [
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'niger', 'fag', 'rape', 'nazi', 'hitler',
  'slut', 'whore', 'kike', 'spic', 'chink', 'tranny', 'retard', 'pedo', 'rapist',
];

const LEET = { 0: 'O', 1: 'I', 3: 'E', 4: 'A', 5: 'S', 7: 'T', 8: 'B', '@': 'A', $: 'S', '!': 'I' };

// A substring list loses to the obvious tricks: separators (f-u-c-k),
// leetspeak (sh1t), doubled letters (NICCER) and lookalike consonants
// (BLACNIGER). Squash all of that out before matching, on both sides.
function normalize(s) {
  return s
    .toUpperCase()
    .replace(/[0134578@$!]/g, (c) => LEET[c] || '')
    .replace(/[^A-Z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

const hardG = (s) => s.replace(/[CKQ]/g, 'G');
const BANNED_PLAIN = [...new Set(BANNED.map(normalize))];
const BANNED_SWAPPED = [...new Set(BANNED.map((w) => hardG(normalize(w))))];

function isBanned(name) {
  const n = normalize(name);
  if (BANNED_PLAIN.some((bad) => n.includes(bad))) return true;
  // Weaker on the swapped pass, or MONICA -> MONIGA turns away every Monica.
  const swapped = hardG(n);
  return BANNED_SWAPPED.some((bad) => (
    bad.length >= 5 ? swapped.includes(bad) : swapped.startsWith(bad)
  ));
}

function cleanName(raw) {
  const name = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  if (!name) return { error: 'Enter a name.' };
  if (isBanned(name)) return { error: 'Pick a different name.' };
  return { name };
}

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

async function readTop() {
  const [flatScores, flatMeta] = await redis([
    ['ZRANGE', BOARD, '0', String(TOP_N - 1), 'REV', 'WITHSCORES'],
    ['HGETALL', META],
  ]);
  return buildBoard(flatScores || [], flatMeta || []);
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!configured) return res.status(503).json({ error: 'Scoreboard not configured.' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json({ top: await readTop() });
    }
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    if (!signingReady) {
      return res.status(503).json({ error: 'Verification not configured.' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { name, error } = cleanName(body.name);
    if (error) return res.status(400).json({ error });

    if (await overRateLimit(`cc:rl:${clientIp(req)}`, RATE_LIMIT, 60)) {
      return res.status(429).json({ error: 'Slow down a moment.' });
    }

    // 1. The session must be one we minted, unexpired, for these rules.
    const fields = {
      sessionId: String(body.sessionId || ''),
      seed: String(body.seed || ''),
      issuedAt: Number(body.issuedAt) || 0,
      rules: Number(body.rules) || 0,
    };
    if (!verifySession(fields, body.sig)) {
      return res.status(400).json({ error: 'This run could not be verified.' });
    }
    if (fields.rules !== RULES_VERSION) {
      return res.status(409).json({ error: 'The game updated — play one more run.' });
    }
    const age = Date.now() - fields.issuedAt;
    if (age < -60_000 || age > SESSION_MAX_AGE_MS) {
      return res.status(400).json({ error: 'That run expired. Play another.' });
    }

    // 2. One submission per session, ever.
    const [claimed] = await redis([
      ['SET', `cc:used:${fields.sessionId}`, '1', 'NX', 'EX', '604800'],
    ]);
    if (claimed === null) {
      return res.status(409).json({ error: 'That run was already submitted.' });
    }

    // 3. Replay it. This, not the client, decides the score.
    const result = replay(fields.seed, body.inputs, Number(body.endTick) || 0);
    if (!result.ok) {
      return res.status(400).json({ error: 'This run could not be verified.' });
    }
    const score = result.score;
    const coins = result.coins;
    if (score < 1) {
      return res.status(400).json({ error: 'No score to submit yet.' });
    }

    // 4. Best score per name.
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
      score,
      coins,
      best: Number(best) || score,
      rank: revRank === null || revRank === undefined ? null : Number(revRank) + 1,
      improved: Number(changed) === 1,
      top: buildBoard(flatScores || [], flatMeta || []),
    });
  } catch (err) {
    console.error('[scores]', err.message);
    return res.status(500).json({ error: 'Scoreboard unavailable.' });
  }
}
