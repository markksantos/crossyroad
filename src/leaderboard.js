// Scoreboard client. Degrades quietly: if the API isn't reachable (e.g. the
// game is being served by a plain static server), the board stays hidden and
// the game plays exactly as it otherwise would.

const BASE = new URLSearchParams(location.search).get('api')
  || localStorage.getItem('cc_api')
  || '/api';

const SCORES = BASE.endsWith('/scores') ? BASE : `${BASE.replace(/\/$/, '')}/scores`;
const SESSION = SCORES.replace(/\/scores$/, '/session');

export const savedName = () => localStorage.getItem('cc_name') || '';
export const rememberName = (name) => localStorage.setItem('cc_name', name);

async function call(url, options) {
  const res = await fetch(url, options);
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) throw new Error(data.error || `Scoreboard error (${res.status})`);
  return data;
}

export function fetchTop() {
  return call(SCORES, { method: 'GET', headers: { Accept: 'application/json' } });
}

/**
 * Ask the server for a signed world seed. Returns null when the scoreboard
 * isn't available — the run then plays normally but can't be submitted.
 */
export async function startSession() {
  try {
    const data = await call(SESSION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!data.seed || !data.sig) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Submit a run for verification. We send what was pressed, not what it scored:
 * the server replays the inputs against the seed it issued and derives the
 * score itself.
 */
export function submitRun({ name, session, inputs, endTick }) {
  return call(SCORES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      sessionId: session.sessionId,
      seed: session.seed,
      issuedAt: session.issuedAt,
      rules: session.rules,
      sig: session.sig,
      inputs,
      endTick,
    }),
  });
}

/** Render entries into a <ol>. `highlight` marks the current player's row. */
export function renderBoard(el, entries, highlight = null) {
  el.innerHTML = '';
  if (!entries || !entries.length) {
    el.innerHTML = '<li class="board-empty">No scores yet — be the first.</li>';
    return;
  }
  const mark = highlight ? highlight.toUpperCase() : null;
  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'board-row';
    if (entry.rank <= 3) li.classList.add(`medal-${entry.rank}`);
    if (mark && entry.name === mark) li.classList.add('is-you');

    const rank = document.createElement('span');
    rank.className = 'board-rank';
    rank.textContent = entry.rank;

    const name = document.createElement('span');
    name.className = 'board-name';
    name.textContent = entry.name;

    const coins = document.createElement('span');
    coins.className = 'board-coins';
    coins.textContent = entry.coins ? `${entry.coins}c` : '';

    const score = document.createElement('span');
    score.className = 'board-score';
    score.textContent = entry.score;

    li.append(rank, name, coins, score);
    el.appendChild(li);
  }
}
