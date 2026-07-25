// The world, as pure data. No three.js, no rendering, no wall-clock time —
// every position is a closed-form function of the tick, so the client and the
// server can evaluate the same instant and get the same answer.
//
// Rows are generated in ascending order from a seed, so both sides walk the
// same sequence. Only +, -, *, / and comparisons are used: Math.sin and
// friends are not identically specified across engines and would let a Safari
// run fail verification on a Node server.

import { xfnv1a, rowRng } from './rng.js';
import { MIN_COL, MAX_COL, SPAN, LOOP, TRAIN_WARN, TRAIN_SPEED, TRAIN_HALF } from './constants.js';

export function wrapX(x) {
  return ((x + SPAN) % LOOP + LOOP) % LOOP - SPAN;
}

const SAFE_ROW = (index) => ({ index, type: 'grass', blocked: [], coin: null, safe: true });

export class SimWorld {
  constructor(seed) {
    this.seed = String(seed);
    this.seedInt = xfnv1a(this.seed);
    this.rows = new Map();
    this.band = { type: null, left: 0 };
    this.sinceGrass = 0;
    this.lastRow = 4;
    for (let i = -4; i <= 4; i++) this.rows.set(i, SAFE_ROW(i));
  }

  row(index) {
    if (index < -4) return SAFE_ROW(index);
    while (this.lastRow < index) {
      this.lastRow += 1;
      this.rows.set(this.lastRow, this.build(this.lastRow));
    }
    return this.rows.get(index);
  }

  /* ---------------------------------------------------------- generation */

  pickType(index, rnd) {
    if (index < 8) return 'grass';

    if (this.sinceGrass >= 5) {                       // always a way to breathe
      this.band = { type: 'grass', left: randInt(rnd, 1, 2) - 1 };
      return 'grass';
    }
    if (this.band.left > 0) {
      this.band.left -= 1;
      return this.band.type;
    }
    if (this.band.type === null) {
      this.band = { type: 'road', left: randInt(rnd, 1, 2) - 1 };
      return 'road';
    }

    const options = ['road', 'road', 'road', 'water', 'water', 'rail', 'grass', 'grass', 'grass'];
    let type = options[(rnd() * options.length) | 0];
    let guard = 0;
    while (type === this.band.type && guard++ < 8) {
      type = options[(rnd() * options.length) | 0];
    }
    const lengths = { grass: [1, 2], road: [1, 3], water: [1, 3], rail: [1, 2] };
    const [lo, hi] = lengths[type];
    this.band = { type, left: randInt(rnd, lo, hi) - 1 };
    return type;
  }

  build(index) {
    const rnd = rowRng(this.seedInt, index, 0);
    const difficulty = Math.min(1, index / 220);
    const type = this.pickType(index, rnd);
    if (type === 'grass') this.sinceGrass = 0;
    else this.sinceGrass += 1;

    const row = { index, type, blocked: [], coin: null };

    if (type === 'grass') {
      const count = randInt(rnd, 0, 5) + (rnd() < difficulty ? 1 : 0);
      const free = [];
      for (let c = MIN_COL; c <= MAX_COL; c++) free.push(c);
      for (let i = 0; i < count && free.length; i++) {
        const col = free.splice((rnd() * free.length) | 0, 1)[0];
        row.blocked.push(col);
        row.kinds = row.kinds || [];
        row.kinds.push(rnd());                        // which prop, for the view
      }
      if (rnd() < 0.22 && free.length) row.coin = free[(rnd() * free.length) | 0];
      return row;
    }

    if (type === 'road') {
      const heavy = rnd() < 0.3;
      const dir = rnd() < 0.5 ? 1 : -1;
      const speed = (heavy ? range(rnd, 2.0, 3.2) : range(rnd, 2.8, 5.2)) * (1 + difficulty * 0.55);
      const bodyLen = heavy ? 2.7 : 1.5;
      const gap = range(rnd, heavy ? 3.4 : 2.6, heavy ? 6.0 : 5.0) - difficulty * 0.7;
      const count = Math.max(2, Math.floor(LOOP / (bodyLen + gap)));
      const spacing = LOOP / count;
      const offset = range(rnd, 0, spacing);
      row.heavy = heavy;
      row.dir = dir;
      row.speed = speed;
      row.half = bodyLen / 2;
      row.starts = [];
      for (let i = 0; i < count; i++) row.starts.push(-SPAN + offset + i * spacing);
      return row;
    }

    if (type === 'water') {
      if (rnd() < 0.16) {                             // lily pads: static footing
        row.speed = 0;
        row.dir = 1;
        row.half = 0.42;
        row.pads = true;
        row.starts = [];
        const free = [];
        for (let c = MIN_COL; c <= MAX_COL; c++) free.push(c);
        const pads = randInt(rnd, 6, 9);
        for (let i = 0; i < pads && free.length; i++) {
          row.starts.push(free.splice((rnd() * free.length) | 0, 1)[0]);
        }
        return row;
      }
      const dir = rnd() < 0.5 ? 1 : -1;
      const speed = range(rnd, 1.1, 2.4) * (1 + difficulty * 0.5);
      const len = randInt(rnd, 2, 4);
      const gap = range(rnd, 1.6, 2.9);
      // Spacing has to divide the wrap loop exactly or logs bunch at the seam,
      // but plain flooring can leave a 4.5-tile hole you can only cross by
      // waiting. Nudge the count until the gap between logs is actually fair.
      let count = Math.max(2, Math.round(LOOP / (len + gap)));
      while (LOOP / count - len > 3.0) count += 1;
      while (count > 2 && LOOP / count - len < 1.2) count -= 1;
      const spacing = LOOP / count;
      const offset = range(rnd, 0, spacing);
      row.dir = dir;
      row.speed = speed;
      row.len = len;
      row.half = len / 2 - 0.08;
      row.starts = [];
      for (let i = 0; i < count; i++) row.starts.push(-SPAN + offset + i * spacing);
      return row;
    }

    // rail
    const travel = (2 * (SPAN + TRAIN_HALF + 1)) / TRAIN_SPEED;
    row.dir = rnd() < 0.5 ? 1 : -1;
    row.period = range(rnd, 5.5, 10) + TRAIN_WARN + travel;
    row.phase = range(rnd, 0, row.period);
    row.travel = travel;
    row.half = TRAIN_HALF;
    return row;
  }

  /* -------------------------------------------------------- evaluation */

  /** Centre of moving thing `i` on a road/water row, at time t seconds. */
  itemX(row, i, t) {
    if (!row.starts) return 0;
    if (!row.speed) return row.starts[i];
    return wrapX(row.starts[i] + row.speed * row.dir * t);
  }

  /** Train state at time t: null, 'warn', or a number (its centre x). */
  trainAt(row, t) {
    const p = ((t - row.phase) % row.period + row.period) % row.period;
    if (p < TRAIN_WARN) return 'warn';
    const running = p - TRAIN_WARN;
    if (running >= row.travel) return null;
    const from = -row.dir * (SPAN + row.half + 1);
    return from + row.dir * TRAIN_SPEED * running;
  }

  isBlocked(index, col) {
    if (col < MIN_COL || col > MAX_COL) return true;
    const row = this.row(index);
    return row.type === 'grass' && row.blocked.indexOf(col) !== -1;
  }

  /** Index of the log/pad under x, or -1. */
  logAt(index, x, t) {
    const row = this.row(index);
    if (row.type !== 'water' || !row.starts) return -1;
    for (let i = 0; i < row.starts.length; i++) {
      if (Math.abs(x - this.itemX(row, i, t)) <= row.half) return i;
    }
    return -1;
  }

  /** 'car' | 'train' | null */
  hazardAt(index, x, t, halfW) {
    const row = this.row(index);
    if (row.type === 'road') {
      for (let i = 0; i < row.starts.length; i++) {
        if (Math.abs(x - this.itemX(row, i, t)) < row.half + halfW) return 'car';
      }
    } else if (row.type === 'rail') {
      const train = this.trainAt(row, t);
      if (typeof train === 'number' && Math.abs(x - train) < row.half + halfW) return 'train';
    }
    return null;
  }
}

function range(rnd, a, b) {
  return a + rnd() * (b - a);
}

function randInt(rnd, a, b) {
  return a + ((rnd() * (b - a + 1)) | 0);
}
