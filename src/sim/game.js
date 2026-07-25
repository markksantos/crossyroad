// The game itself, as a fixed-step state machine. The browser steps it live at
// 60 Hz; the server steps it again from the recorded inputs to decide what a
// run actually scored. Nothing here reads the clock, the DOM or Math.random.

import { SimWorld, wrapX } from './world.js';
import {
  DT, HOP_TICKS, MIN_COL, MAX_COL, WATER_LIMIT, EAGLE_MARGIN, RETREAT_LIMIT,
  CAM_FOLLOW, SCROLL_START_ROW, SCROLL_BASE, PLAYER_HALF, MAX_TICKS, MAX_INPUTS,
} from './constants.js';

export const DIRS = ['forward', 'back', 'left', 'right'];

export class Game {
  constructor(seed) {
    this.world = new SimWorld(seed);
    this.reset();
  }

  reset() {
    this.tick = 0;
    this.row = 0;
    this.x = 0;
    this.standY = 0;
    this.maxRow = 0;
    this.coins = 0;
    this.dead = false;
    this.cause = null;
    this.deathTick = 0;
    this.hop = null;
    this.queued = null;
    this.riding = null;          // { rowIndex, logIdx, offset }
    this.camAnchor = 0;
    this.scrollActive = false;
    this.collected = new Set();
    this.blocks = 0;             // refused hops, so the view can thump once each
  }

  get time() {
    return this.tick * DT;
  }

  /** Advance exactly one tick. `input` is a direction string or null. */
  step(input) {
    if (this.dead) {
      this.tick += 1;
      return;
    }
    const t = this.tick * DT;

    if (input) this.press(input, t);

    if (this.hop) {
      this.hop.ticks += 1;
      if (this.hop.logIdx >= 0) {
        const row = this.world.row(this.hop.toRow);
        this.hop.toX = this.world.itemX(row, this.hop.logIdx, t) + this.hop.logOffset;
      }
      if (this.hop.ticks >= HOP_TICKS) this.land(t);
    } else if (this.riding) {
      const row = this.world.row(this.riding.rowIndex);
      this.x = this.world.itemX(row, this.riding.logIdx, t) + this.riding.offset;
      if (Math.abs(this.x) > WATER_LIMIT) return this.die('water');
    }

    this.updateCamera();
    if (this.dead) return;
    this.checkHazards(t);
    this.tick += 1;
  }

  press(dir, t) {
    if (this.hop) {
      if (this.hop.ticks * 100 >= HOP_TICKS * 45) this.queued = dir;
      return;
    }
    this.startHop(dir, t);
  }

  startHop(dir, t) {
    const dz = dir === 'forward' ? 1 : dir === 'back' ? -1 : 0;
    const dx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
    const toRow = this.row + dz;
    if (toRow < this.maxRow - RETREAT_LIMIT) return;

    const destRow = this.world.row(toRow);
    const onWater = destRow.type === 'water';
    const fromX = this.x;
    const desiredX = onWater ? fromX + dx : Math.round(fromX) + dx;

    if (desiredX < MIN_COL - 0.5 || desiredX > MAX_COL + 0.5) {
      this.blocks += 1;
      return;
    }

    let logIdx = -1;
    let logOffset = 0;
    if (onWater) {
      logIdx = this.world.logAt(toRow, desiredX, t);
      if (logIdx >= 0) {
        const lx = this.world.itemX(destRow, logIdx, t);
        logOffset = clamp(desiredX - lx, -destRow.half + 0.12, destRow.half - 0.12);
      }
    } else if (this.world.isBlocked(toRow, Math.round(desiredX))) {
      this.blocks += 1;
      return;
    }

    this.hop = {
      ticks: 0, dir, fromX, fromRow: this.row, toRow, toX: desiredX,
      logIdx, logOffset, onWater,
    };
    this.riding = null;
  }

  land(t) {
    const h = this.hop;
    this.hop = null;
    this.row = h.toRow;
    this.x = h.toX;

    const row = this.world.row(this.row);
    if (row.type === 'water') {
      let idx = h.logIdx;
      if (idx < 0 || Math.abs(this.x - this.world.itemX(row, idx, t)) > row.half) {
        idx = this.world.logAt(this.row, this.x, t);
      }
      if (idx < 0) {
        this.standY = 0;
        return this.die('water');
      }
      const lx = this.world.itemX(row, idx, t);
      this.riding = {
        rowIndex: this.row,
        logIdx: idx,
        offset: clamp(this.x - lx, -row.half + 0.12, row.half - 0.12),
      };
      this.x = lx + this.riding.offset;
      this.standY = row.pads ? 0.06 : 0.25;
    } else {
      this.riding = null;
      this.standY = 0;
      const col = Math.round(this.x);
      if (row.coin === col && !this.collected.has(this.row)) {
        this.collected.add(this.row);
        this.coins += 1;
        this.coinTick = this.tick;
      }
    }

    if (this.row > this.maxRow) this.maxRow = this.row;

    if (this.queued) {
      const q = this.queued;
      this.queued = null;
      this.startHop(q, t);
    }
  }

  updateCamera() {
    const eased = this.camAnchor + (this.row - this.camAnchor) * CAM_FOLLOW;
    if (eased > this.camAnchor) this.camAnchor = eased;

    if (this.maxRow >= SCROLL_START_ROW) this.scrollActive = true;
    if (this.scrollActive) {
      const rate = SCROLL_BASE + Math.min(0.85, this.maxRow / 320);
      this.camAnchor += rate * DT;
    }
    if (this.row < this.camAnchor - EAGLE_MARGIN) this.die('eagle');
  }

  checkHazards(t) {
    const row = this.hop && this.hop.ticks * 2 > HOP_TICKS ? this.hop.toRow : this.row;
    const x = this.hop ? this.renderX(0) : this.x;
    const hazard = this.world.hazardAt(row, x, t, PLAYER_HALF);
    if (hazard) this.die(hazard);
  }

  /** Interpolated x for rendering (alpha 0..1 between ticks). Never used by rules. */
  renderX(alpha) {
    if (!this.hop) return this.x;
    const k = Math.min(1, (this.hop.ticks + alpha) / HOP_TICKS);
    return this.hop.fromX + (this.hop.toX - this.hop.fromX) * k;
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.cause = cause;
    this.deathTick = this.tick;
    this.hop = null;
    this.queued = null;
    this.riding = null;
  }
}

/**
 * Replay a recorded run and report what it actually achieved.
 * `inputs` is a flat [tick, dirIndex, tick, dirIndex, …] list — compact on the
 * wire and cheap to validate.
 */
export function replay(seed, inputs, endTick) {
  const flat = Array.isArray(inputs) ? inputs : [];
  if (flat.length % 2 !== 0 || flat.length / 2 > MAX_INPUTS) {
    return { ok: false, reason: 'input list malformed' };
  }

  const limit = Math.min(Math.max(0, endTick | 0), MAX_TICKS);
  const game = new Game(seed);
  let cursor = 0;
  let lastTick = -1;

  // Validate the whole log up front: ticks strictly ascending, directions real.
  for (let i = 0; i < flat.length; i += 2) {
    const at = flat[i];
    if (!Number.isInteger(at) || at < 0 || at <= lastTick) {
      return { ok: false, reason: 'inputs out of order' };
    }
    if (!DIRS[flat[i + 1]]) return { ok: false, reason: 'unknown direction' };
    lastTick = at;
  }

  for (let tick = 0; tick <= limit && !game.dead; tick++) {
    let input = null;
    if (cursor < flat.length && flat[cursor] === tick) {
      input = DIRS[flat[cursor + 1]];
      cursor += 2;
    }
    game.step(input);
  }
  // Anything left over happened after the chicken died. It cannot raise the
  // score, so it is ignored rather than treated as forgery.

  return {
    ok: true,
    score: game.maxRow,
    coins: game.coins,
    cause: game.cause,
    dead: game.dead,
    ticks: game.tick,
  };
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export { wrapX };
