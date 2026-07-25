// Simulation tests. Run with: node test/sim.mjs
//
// These guard the replay contract. If the browser and the server ever disagree
// about what a run scored, honest players get rejected and cheats get in — so
// determinism is tested first and hardest.

import { Game, replay, DIRS } from '../src/sim/game.js';
import { SimWorld } from '../src/sim/world.js';
import { DT, HOP_TICKS, TRAIN_WARN } from '../src/sim/constants.js';

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  ${extra}` : ''}`);
};
const group = (name) => console.log(`\n— ${name}`);

/* ------------------------------------------------------ a scripted player */

function bot(seed, maxTicks = 40000) {
  const g = new Game(seed);
  const log = [];
  for (let tick = 0; tick < maxTicks && !g.dead; tick++) {
    let input = null;
    if (!g.hop) {
      const t = g.tick * DT;
      const arrive = t + HOP_TICKS * DT;
      const next = g.world.row(g.row + 1);
      const tx = next.type === 'water' ? g.x : Math.round(g.x);
      let go = false;
      if (next.type === 'grass') go = !g.world.isBlocked(g.row + 1, Math.round(tx));
      else if (next.type === 'water') {
        go = g.world.logAt(g.row + 1, tx, arrive) >= 0
          && g.world.logAt(g.row + 1, tx, arrive + 0.4) >= 0;
      } else {
        go = true;
        for (let k = 0; k <= 10; k++) if (g.world.hazardAt(g.row + 1, tx, t + k * 0.05, 0.8)) go = false;
      }
      if (go) input = 'forward';
      else if (tick % 25 === 0) input = Math.round(g.x) < 0 ? 'right' : 'left';
      if (input) log.push(tick, DIRS.indexOf(input));
    }
    g.step(input);
  }
  return { score: g.maxRow, coins: g.coins, cause: g.cause, endTick: g.tick, log };
}

/* ------------------------------------------------------------------ tests */

group('determinism and replay fidelity');
const SEEDS = ['aaa111', 'deadbeef', 'ffff0000', '12345678', 'zzz', '9f3a2b7c', '0', 'seed-with-dashes'];
for (const seed of SEEDS) {
  const a = bot(seed);
  const b = bot(seed);
  check(`same seed, same outcome (${seed})`,
    a.score === b.score && a.coins === b.coins && a.cause === b.cause,
    `score=${a.score} coins=${a.coins} cause=${a.cause}`);
  const r = replay(seed, a.log, a.endTick);
  check(`server replay matches the live run (${seed})`,
    r.ok && r.score === a.score && r.coins === a.coins,
    `live=${a.score}/${a.coins} replay=${r.score}/${r.coins}`);
}

group('forged submissions');
check('an empty input log scores nothing', (() => {
  const r = replay('aaa111', [], 1e6);
  return r.ok && r.score === 0;
})());
check('a huge score cannot be conjured from one input', (() => {
  const r = replay('aaa111', [0, 0], 1e6);
  return r.ok && r.score <= 1;
})());
check('out-of-order ticks rejected', !replay('aaa111', [50, 0, 10, 0], 1000).ok);
check('duplicate ticks rejected', !replay('aaa111', [10, 0, 10, 0], 1000).ok);
check('unknown direction rejected', !replay('aaa111', [10, 9], 1000).ok);
check('odd-length log rejected', !replay('aaa111', [10], 1000).ok);
check('negative tick rejected', !replay('aaa111', [-5, 0], 1000).ok);
check('fractional tick rejected', !replay('aaa111', [1.5, 0], 1000).ok);
const spam = [];
for (let i = 0; i < 3000; i++) spam.push(i * 10, 0);
check('mashing forward is bounded by hazards', (() => {
  const r = replay('aaa111', spam, 40000);
  return r.ok && r.score < 300;
})(), `score=${replay('aaa111', spam, 40000).score}`);
check('the same inputs score differently on another seed',
  replay('aaa111', spam, 40000).score !== replay('bbb222', spam, 40000).score);

group('the world is fair');
let waterRows = 0; let footing = 0; let wideGaps = 0;
let roadRows = 0; let safeMoments = 0;
let railRows = 0; let cycling = 0;
for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6']) {
  const w = new SimWorld(seed);
  for (let i = 8; i < 240; i++) {
    const row = w.row(i);
    if (row.type === 'water') {
      waterRows++;
      let ok = false;
      for (let t = 0; t < 12 && !ok; t += 0.1) {
        for (let x = -8; x <= 8 && !ok; x += 0.5) if (w.logAt(i, x, t) >= 0) ok = true;
      }
      if (ok) footing++;
      if (row.starts && !row.pads && 34 / row.starts.length - row.len > 3.05) wideGaps++;
    } else if (row.type === 'road') {
      roadRows++;
      let safe = false;
      for (let t = 0; t < 12 && !safe; t += 0.05) if (!w.hazardAt(i, 0, t, 0.28)) safe = true;
      if (safe) safeMoments++;
    } else if (row.type === 'rail') {
      railRows++;
      const seen = new Set();
      for (let t = 0; t < 40; t += 0.05) {
        const s = w.trainAt(row, t);
        seen.add(s === null ? 'idle' : typeof s === 'number' ? 'run' : 'warn');
      }
      if (seen.size === 3) cycling++;
    }
  }
}
check('every river has footing', footing === waterRows, `${footing}/${waterRows}`);
check('no unhoppable log gaps', wideGaps === 0, `${wideGaps} too wide`);
check('every road has a safe moment', safeMoments === roadRows, `${safeMoments}/${roadRows}`);
check('every railway cycles idle → warn → run', cycling === railRows, `${cycling}/${railRows}`);
check('hazards never stack more than five deep', (() => {
  for (const seed of ['h1', 'h2', 'h3']) {
    const w = new SimWorld(seed);
    let run = 0;
    for (let i = 8; i < 400; i++) {
      if (w.row(i).type === 'grass') run = 0;
      else if (++run > 5) return false;
    }
  }
  return true;
})());

group('mechanics');
function firstRow(world, predicate, from = 1, to = 120) {
  for (let i = from; i < to; i++) if (predicate(world.row(i), i)) return i;
  return -1;
}

check('landing on a log carries you downstream', (() => {
  let ok = 0; let tried = 0;
  for (const seed of ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) {
    const g = new Game(seed);
    const i = firstRow(g.world, (r, idx) => r.type === 'water' && !r.pads
      && g.world.row(idx - 1).type === 'grass');
    if (i < 0) continue;
    const row = g.world.row(i);
    const arrive = (g.tick + HOP_TICKS + 1) * DT;
    let placed = false;
    for (let idx = 0; idx < row.starts.length && !placed; idx++) {
      const lx = g.world.itemX(row, idx, arrive);
      if (Math.abs(lx) > 6) continue;
      const col = Math.round(lx);
      if (g.world.isBlocked(i - 1, col)) continue;
      g.row = i - 1; g.maxRow = i - 1; g.x = col;
      placed = true;
    }
    if (!placed) continue;
    tried++;
    const startX = g.x;
    g.press('forward', g.tick * DT);
    for (let k = 0; k < HOP_TICKS + 120; k++) g.step(null);
    if (g.riding && !g.dead && Math.abs(g.x - startX) > 0.3) ok++;
  }
  return tried > 0 && ok === tried;
})());

check('open water drowns you', (() => {
  let ok = 0; let tried = 0;
  for (const seed of ['d1', 'd2', 'd3', 'd4', 'd5']) {
    const g = new Game(seed);
    const i = firstRow(g.world, (r, idx) => r.type === 'water' && !r.pads
      && g.world.row(idx - 1).type === 'grass');
    if (i < 0) continue;
    const arrive = (g.tick + HOP_TICKS + 1) * DT;
    let col = null;
    for (let c = -7; c <= 7 && col === null; c++) {
      if (g.world.isBlocked(i - 1, c)) continue;
      let clear = true;
      for (let d = -0.15; d <= 0.15; d += 0.03) if (g.world.logAt(i, c, arrive + d) >= 0) clear = false;
      if (clear) col = c;
    }
    if (col === null) continue;
    tried++;
    g.row = i - 1; g.maxRow = i - 1; g.x = col;
    g.press('forward', g.tick * DT);
    for (let k = 0; k < HOP_TICKS + 6; k++) g.step(null);
    if (g.dead && g.cause === 'water') ok++;
  }
  return tried > 0 && ok === tried;
})());

check('drifting off the edge of the world kills you', (() => {
  const g = new Game('off1');
  const i = firstRow(g.world, (r) => r.type === 'water' && !r.pads);
  g.row = i; g.maxRow = i;
  g.riding = { rowIndex: i, logIdx: 0, offset: 0 };
  for (let k = 0; k < 3600 && !g.dead; k++) g.step(null);
  return g.dead && g.cause === 'water';
})());

check('trees block a hop without killing you', (() => {
  let ok = 0; let tried = 0;
  for (const seed of ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8']) {
    const g = new Game(seed);
    let done = false;
    for (let i = 9; i < 120 && !done; i++) {
      const row = g.world.row(i);
      if (row.type !== 'grass' || !row.blocked.length) continue;
      if (g.world.row(i - 1).type !== 'grass') continue;
      const col = row.blocked.find((c) => Math.abs(c) <= 7 && !g.world.isBlocked(i - 1, c));
      if (col === undefined) continue;
      done = true;
      tried++;
      g.row = i - 1; g.maxRow = i - 1; g.x = col;
      const startRow = g.row;
      const startBlocks = g.blocks;
      g.press('forward', g.tick * DT);
      for (let k = 0; k < HOP_TICKS + 4; k++) g.step(null);
      if (g.row === startRow && !g.dead && g.blocks > startBlocks) ok++;
    }
  }
  return tried > 0 && ok === tried;
})());

check('you cannot hop out of the playable strip', (() => {
  const g = new Game('walls');
  g.row = 2; g.maxRow = 2; g.x = 8;
  const before = g.blocks;
  g.press('right', g.tick * DT);
  for (let k = 0; k < HOP_TICKS + 2; k++) g.step(null);
  return Math.round(g.x) === 8 && g.blocks > before;
})());

check('retreating is capped', (() => {
  const g = new Game('retreat');
  g.row = 20; g.maxRow = 20;
  for (let i = 0; i < 40; i++) {
    g.press('back', g.tick * DT);
    for (let k = 0; k < HOP_TICKS + 1; k++) g.step(null);
  }
  return g.row >= 11;
})());

check('coins are collectable and replay identically', (() => {
  let collected = 0; let tried = 0;
  for (const seed of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']) {
    const probe = new Game(seed);
    let target = null;
    for (let i = 1; i < 40 && !target; i++) {
      const r = probe.world.row(i);
      if (r.type === 'grass' && r.coin !== null && !probe.world.isBlocked(i, r.coin)) {
        let clear = true;
        for (let k = 1; k <= i; k++) if (probe.world.row(k).type !== 'grass') clear = false;
        if (clear && Math.abs(r.coin) <= 6) target = { row: i, col: r.coin };
      }
    }
    if (!target) continue;
    tried++;
    const g = new Game(seed);
    const log = [];
    const wants = [];
    for (let c = 0; c !== target.col; c += target.col > 0 ? 1 : -1) wants.push(target.col > 0 ? 'right' : 'left');
    for (let r = 0; r < target.row; r++) wants.push('forward');
    let wi = 0;
    for (let tick = 0; tick < 3000 && !g.dead && wi <= wants.length; tick++) {
      let input = null;
      if (!g.hop && wi < wants.length) { input = wants[wi++]; log.push(tick, DIRS.indexOf(input)); }
      g.step(input);
      if (wi >= wants.length && !g.hop) break;
    }
    const r = replay(seed, log, g.tick);
    if (g.coins > 0 && r.coins === g.coins) collected++;
  }
  return tried > 0 && collected > 0;
})());

group('replay cost');
const long = bot('perf-seed');
const t0 = performance.now();
for (let i = 0; i < 20; i++) replay('perf-seed', long.log, long.endTick);
console.log(`  ${long.endTick} ticks, ${long.log.length / 2} inputs → ${((performance.now() - t0) / 20).toFixed(2)} ms per verification`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
