// The chicken, as a view over the simulation. It decides nothing — it reads
// the sim's position each frame and draws it, interpolated between ticks.

import * as THREE from 'three';
import { TILE, HOP_HEIGHT, HOP_TICKS, DT } from './constants.js';
import * as M from './models.js';
import { sfx } from './audio.js';

const FACING = { forward: Math.PI, back: 0, right: -Math.PI / 2, left: Math.PI / 2 };

export class PlayerView {
  constructor(scene) {
    this.scene = scene;
    this.mesh = M.makeChicken();
    scene.add(this.mesh);
    this.splashes = [];
    this.reset();
  }

  reset() {
    this.facing = Math.PI;
    this.lastHopId = null;
    this.lastCoins = 0;
    this.lastBlocked = 0;
    this.deathAge = 0;
    this.deathCause = null;
    this.mesh.visible = true;
    this.mesh.position.set(0, 0, 0);
    this.mesh.rotation.set(0, this.facing, 0);
    this.mesh.scale.set(1, 1, 1);
    for (const s of this.splashes) this.scene.remove(s.group);
    this.splashes.length = 0;
  }

  update(game, alpha, dt, elapsed) {
    this.updateSplashes(dt);

    // Sounds follow sim events, so they can't fire twice for one hop.
    if (game.hop && game.hop.ticks === 0 && this.lastHopId !== game.tick) {
      this.lastHopId = game.tick;
      this.facing = FACING[game.hop.dir];
      sfx.hop();
    }
    if (game.blocks !== this.lastBlocked) {
      this.lastBlocked = game.blocks;
      sfx.bump();
    }
    if (game.coins > this.lastCoins) {
      this.lastCoins = game.coins;
      sfx.coin();
    }
    if (game.dead && this.deathCause !== game.cause) {
      this.deathCause = game.cause;
      this.deathAge = 0;
      if (game.cause === 'water') {
        this.spawnSplash(game);
        sfx.splash();
      } else if (game.cause === 'eagle') {
        sfx.eagle();
      } else {
        sfx.crash();
      }
      sfx.over();
    }

    if (game.dead) {
      this.deathAge += dt;
      this.animateDeath(game, dt);
      return;
    }

    const x = game.renderX(alpha);
    let z;
    let y;

    if (game.hop) {
      const k = Math.min(1, (game.hop.ticks + alpha) / HOP_TICKS);
      z = -(game.hop.fromRow + (game.hop.toRow - game.hop.fromRow) * k) * TILE;
      // standY is only written on landing, so mid-hop it still holds the
      // height of the surface we left.
      const fromY = game.standY;
      y = fromY + (targetY(game) - fromY) * k + Math.sin(k * Math.PI) * HOP_HEIGHT;
      const squash = 1 + Math.sin(k * Math.PI) * 0.18;
      this.mesh.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    } else {
      z = -game.row * TILE;
      y = game.standY + Math.sin(elapsed * 5) * 0.02;
      const s = 1 + Math.sin(elapsed * 5) * 0.02;
      this.mesh.scale.set(1, s, 1);
    }

    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = angleLerp(this.mesh.rotation.y, this.facing, 1 - Math.pow(0.0005, dt));
  }

  animateDeath(game, dt) {
    if (this.deathCause === 'water') {
      this.mesh.position.y = Math.max(-0.9, this.mesh.position.y - dt * 1.6);
      this.mesh.rotation.z += dt * 1.4;
      if (this.mesh.position.y <= -0.85) this.mesh.visible = false;
    } else if (this.deathCause === 'eagle') {
      this.mesh.position.y += dt * 5;
      this.mesh.rotation.y += dt * 6;
      if (this.mesh.position.y > 8) this.mesh.visible = false;
    } else {
      const k = Math.min(1, this.deathAge * 8);
      this.mesh.scale.set(1 + k * 0.5, Math.max(0.08, 1 - k * 0.95), 1 + k * 0.35);
      this.mesh.position.y = 0;
    }
  }

  spawnSplash(game) {
    const g = M.makeSplash();
    g.position.set(game.x, 0.1, -game.row * TILE);
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

function targetY(game) {
  if (!game.hop || game.hop.logIdx < 0) return 0;
  const row = game.world.row(game.hop.toRow);
  return row.pads ? 0.06 : 0.25;
}

function angleLerp(a, b, t) {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

export { DT };
