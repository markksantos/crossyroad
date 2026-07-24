// The chicken: input queue, grid hops, log riding, and dying.

import * as THREE from 'three';
import { TILE, HOP_TIME, HOP_HEIGHT, WATER_LIMIT, MIN_COL, MAX_COL } from './constants.js';
import * as M from './models.js';
import { sfx } from './audio.js';

export class Player {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.mesh = M.makeChicken();
    scene.add(this.mesh);

    this.splashes = [];
    this.reset();
  }

  reset() {
    this.row = 0;
    this.x = 0;
    this.y = 0;
    this.maxRow = 0;
    this.coins = 0;
    this.dead = false;
    this.deathCause = null;
    this.deathTime = 0;
    this.hop = null;
    this.queued = null;
    this.riding = null;
    this.facing = Math.PI;      // faces "forward" (-z)
    this.idleTime = 0;
    this.bumpT = 0;
    this.standY = 0;            // ground height of whatever we're stood on

    this.mesh.visible = true;
    this.mesh.position.set(0, 0, 0);
    this.mesh.rotation.set(0, this.facing, 0);
    this.mesh.scale.set(1, 1, 1);

    for (const s of this.splashes) this.scene.remove(s.group);
    this.splashes.length = 0;
  }

  /** dir: 'forward' | 'back' | 'left' | 'right' */
  move(dir) {
    if (this.dead) return;
    if (this.hop) {
      // Buffer one input so quick taps feel responsive.
      if (this.hop.t > HOP_TIME * 0.45) this.queued = dir;
      return;
    }
    this.startHop(dir);
  }

  startHop(dir) {
    const dz = dir === 'forward' ? 1 : dir === 'back' ? -1 : 0;
    const dx = dir === 'right' ? 1 : dir === 'left' ? -1 : 0;
    const toRow = this.row + dz;
    if (toRow < this.maxRow - 8) return;              // no infinite retreating

    const destRow = this.world.getRow(toRow);
    if (!destRow) return;

    const fromX = this.x;
    const onWater = destRow.type === 'water';
    // On water we keep the fractional offset; on land we snap to the grid.
    const desiredX = onWater ? fromX + dx * TILE : Math.round(fromX) + dx * TILE;

    if (desiredX < MIN_COL - 0.5 || desiredX > MAX_COL + 0.5) {
      sfx.bump();
      this.bump(dir);
      return;
    }

    let targetLog = null;
    let logOffset = 0;
    if (onWater) {
      targetLog = this.world.logAt(toRow, desiredX);
      if (targetLog) {
        logOffset = clamp(desiredX - targetLog.x, -targetLog.half + 0.12, targetLog.half - 0.12);
      }
    } else if (this.world.isBlocked(toRow, Math.round(desiredX))) {
      sfx.bump();
      this.bump(dir);
      return;
    }

    this.hop = {
      t: 0,
      dir,
      fromX,
      fromRow: this.row,
      toRow,
      toX: desiredX,
      fromY: this.standY,
      toY: targetLog ? targetLog.y : 0,
      targetLog,
      logOffset,
      onWater,
    };
    this.riding = null;
    this.facing = dir === 'forward' ? Math.PI : dir === 'back' ? 0
      : dir === 'right' ? -Math.PI / 2 : Math.PI / 2;
    this.idleTime = 0;
    sfx.hop();
  }

  bump(dir) {
    // Little nudge so a blocked hop still registers visually.
    this.facing = dir === 'forward' ? Math.PI : dir === 'back' ? 0
      : dir === 'right' ? -Math.PI / 2 : Math.PI / 2;
    this.bumpT = 0.14;
  }

  update(dt, elapsed) {
    this.updateSplashes(dt);

    if (this.dead) {
      this.deathTime += dt;
      this.animateDeath(dt);
      return;
    }

    if (this.hop) {
      const h = this.hop;
      h.t += dt;
      const k = Math.min(1, h.t / HOP_TIME);

      if (h.targetLog) h.toX = h.targetLog.x + h.logOffset;   // track a drifting log

      const x = h.fromX + (h.toX - h.fromX) * k;
      const z = -(h.fromRow + (h.toRow - h.fromRow) * k) * TILE;
      const y = h.fromY + (h.toY - h.fromY) * k + Math.sin(k * Math.PI) * HOP_HEIGHT;

      this.mesh.position.set(x, y, z);
      const squash = 1 + Math.sin(k * Math.PI) * 0.18;
      this.mesh.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));

      if (k >= 1) this.land();
    } else {
      this.idleTime += dt;
      if (this.riding) {
        this.x = this.riding.log.x + this.riding.offset;
        this.mesh.position.x = this.x;
        if (Math.abs(this.x) > WATER_LIMIT) return this.die('water');
      }
      // Idle bob.
      const bob = Math.sin(elapsed * 5) * 0.02;
      this.mesh.position.y = this.standY + bob;
      const s = 1 + Math.sin(elapsed * 5) * 0.02;
      this.mesh.scale.set(1, s, 1);
    }

    if (this.bumpT > 0) {
      this.bumpT -= dt;
      const p = Math.max(0, this.bumpT) / 0.14;
      this.mesh.position.y = this.standY + Math.sin(p * Math.PI) * 0.1;
    }

    // Smooth turn toward the facing direction.
    this.mesh.rotation.y = angleLerp(this.mesh.rotation.y, this.facing, 1 - Math.pow(0.0005, dt));

    this.checkHazards();
  }

  land() {
    const h = this.hop;
    this.hop = null;
    this.row = h.toRow;
    this.x = h.toX;
    this.mesh.position.set(this.x, 0, -this.row * TILE);
    this.mesh.scale.set(1, 1, 1);

    const row = this.world.getRow(this.row);

    if (row && row.type === 'water') {
      const log = h.targetLog && Math.abs(this.x - h.targetLog.x) <= h.targetLog.half
        ? h.targetLog
        : this.world.logAt(this.row, this.x);
      if (!log) {
        this.standY = 0;
        this.spawnSplash();
        return this.die('water');
      }
      this.riding = { log, offset: clamp(this.x - log.x, -log.half + 0.12, log.half - 0.12) };
      this.x = log.x + this.riding.offset;
      this.standY = log.y;
      this.mesh.position.set(this.x, this.standY, -this.row * TILE);
    } else {
      this.riding = null;
      this.standY = 0;
      const coin = this.world.collectCoin(this.row, Math.round(this.x));
      if (coin) {
        this.coins++;
        sfx.coin();
      }
    }

    if (this.row > this.maxRow) this.maxRow = this.row;

    if (this.queued) {
      const q = this.queued;
      this.queued = null;
      this.startHop(q);
    }
  }

  checkHazards() {
    if (this.dead) return;
    // Mid-hop you're vulnerable on whichever row you're closest to.
    const row = this.hop && this.hop.t / HOP_TIME > 0.5 ? this.hop.toRow : this.row;
    const x = this.mesh.position.x;
    const hazard = this.world.hazardAt(row, x);
    if (hazard) this.die(hazard);
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true;
    this.deathCause = cause;
    this.deathTime = 0;
    this.hop = null;
    this.queued = null;
    this.riding = null;
    if (cause === 'water') sfx.splash();
    else if (cause === 'eagle') sfx.eagle();
    else sfx.crash();
    sfx.over();
  }

  animateDeath(dt) {
    const t = this.deathTime;
    if (this.deathCause === 'water') {
      this.mesh.position.y = Math.max(-0.9, this.mesh.position.y - dt * 1.6);
      this.mesh.rotation.z += dt * 1.4;
      if (this.mesh.position.y <= -0.85) this.mesh.visible = false;
    } else if (this.deathCause === 'eagle') {
      this.mesh.position.y += dt * 5;
      this.mesh.rotation.y += dt * 6;
      if (this.mesh.position.y > 8) this.mesh.visible = false;
    } else {
      // Flattened.
      const k = Math.min(1, t * 8);
      this.mesh.scale.set(1 + k * 0.5, Math.max(0.08, 1 - k * 0.95), 1 + k * 0.35);
      this.mesh.position.y = 0;
    }
  }

  spawnSplash() {
    const g = M.makeSplash();
    g.position.set(this.mesh.position.x, 0.1, -this.row * TILE);
    this.scene.add(g);
    this.splashes.push({ group: g, t: 0 });
  }

  updateSplashes(dt) {
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.t += dt;
      for (const p of s.group.children) {
        p.userData.vel.y -= 9 * dt;
        p.position.addScaledVector(p.userData.vel, dt);
      }
      s.group.userData.mat.opacity = Math.max(0, 0.9 - s.t * 1.4);
      if (s.t > 0.7) {
        this.scene.remove(s.group);
        s.group.userData.mat.dispose();
        this.splashes.splice(i, 1);
      }
    }
  }
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function angleLerp(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
