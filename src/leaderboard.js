// Scoreboard client. Degrades quietly: if the API isn't reachable (e.g. the
// game is being served by a plain static server), the board just stays hidden.

const API = new URLSearchParams(location.search).get('api')
  || localStorage.getItem('cc_api')
  || '/api/scores';

export const savedName = () => localStorage.getItem('cc_name') || '';
export const rememberName = (name) => localStorage.setItem('cc_name', name);

async function call(options) {
  const res = await fetch(API, options);
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
  return call({ method: 'GET', headers: { Accept: 'application/json' } });
}

export function submitScore({ name, score, coins }) {
  return call({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, score, coins }),
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
