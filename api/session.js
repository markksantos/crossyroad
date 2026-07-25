// POST /api/session -> a signed world seed to play. One per run.

import { cors, clientIp, overRateLimit, configured } from './_upstash.js';
import { newSession, signSession, signingReady } from './_sign.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!configured || !signingReady) {
    return res.status(503).json({ error: 'Scoreboard not configured.' });
  }

  try {
    // Generous: a session is minted every time someone presses Play.
    if (await overRateLimit(`cc:sl:${clientIp(req)}`, 60, 60)) {
      return res.status(429).json({ error: 'Slow down a moment.' });
    }
    const session = newSession();
    return res.status(200).json({ ...session, sig: signSession(session) });
  } catch (err) {
    console.error('[session]', err.message);
    return res.status(500).json({ error: 'Could not start a verified run.' });
  }
}
