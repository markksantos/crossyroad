// Session signing. The seed is minted server-side and signed, so a client
// can't choose its own world, replay an old one, or invent a session.

import crypto from 'node:crypto';
import { RULES_VERSION } from '../src/sim/constants.js';

const SECRET = process.env.RUN_SECRET || '';

export const signingReady = Boolean(SECRET);
export { RULES_VERSION };

export const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;   // submit within 6 hours

function payload({ sessionId, seed, issuedAt, rules }) {
  return `${sessionId}.${seed}.${issuedAt}.${rules}`;
}

export function signSession(fields) {
  return crypto.createHmac('sha256', SECRET).update(payload(fields)).digest('hex');
}

export function verifySession(fields, sig) {
  if (!signingReady || typeof sig !== 'string') return false;
  const expected = signSession(fields);
  if (expected.length !== sig.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

export function newSession() {
  return {
    sessionId: crypto.randomUUID(),
    seed: crypto.randomBytes(8).toString('hex'),
    issuedAt: Date.now(),
    rules: RULES_VERSION,
  };
}
