// Endless row generator: terrain, scenery, traffic, rivers and railways.

import * as THREE from 'three';
import {
  TILE, MIN_COL, MAX_COL, DECOR_COL, ROWS_AHEAD, ROWS_BEHIND, COLORS,
} from './constants.js';
import * as M from './models.js';
import { sfx } from './audio.js';

const SPAN = 17;            // traffic wraps around at ±SPAN
const LOOP = SPAN * 2;
const ROW_WIDTH = DECOR_COL * 2 + 1;

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => a + ((Math.random() * (b - a + 1)) | 0);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.rows = new Map();
    this.band = { type: null, left: 0 };
    this.sinceGrass = 0;
    this.difficulty = 0;
    this.lastRow = 0;
  }

  reset() {
    for (const row of this.rows.values()) this.removeRow(row);
    this.rows.clear();
    this.band = { type: null, left: 0 };
    this.sinceGrass = 0;
    this.difficulty = 0;

    // A safe lawn to start on, plus a few rows behind the player.
    for (let i = -4; i <= 4; i++) this.rows.set(i, this.buildRow(i, 'grass', { safe: true }));
    this.lastRow = 4;
    this.ensureAhead(0);
  }

  getRow(i) {
    return this.rows.get(i) || null;
  }

  ensureAhead(playerRow) {
    // Always extend from the furthest row built, so the strip stays contiguous.
    const target = playerRow + ROWS_AHEAD;
    for (let i = this.lastRow; i < target; i++) {
      const next = i + 1;
      this.difficulty = Math.min(1, next / 220);
      this.rows.set(next, this.buildRow(next, this.nextType(next)));
      this.lastRow = next;
    }
  }

  recycle(minRow) {
    const cutoff = minRow - ROWS_BEHIND;
    for (const [i, row] of this.rows) {
      if (i < cutoff) {
        this.removeRow(row);
        this.rows.delete(i);
      }
    }
  }

  removeRow(row) {
    this.group.remove(row.group);
    if (row.signals) for (const s of row.signals) s.userData.bulbMat.dispose();
    // Shared geometries/materials stay cached; only per-row GPU buffers go.
    row.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  }

  /* ------------------------------------------------------------ generation */

  nextType(index) {
    const type = this.pickType(index);
    if (type === 'grass') this.sinceGrass = 0;
    else this.sinceGrass++;
    return type;
  }

  pickType(index) {
    if (index < 8) return 'grass';

    // Never let hazards run more than five deep — you need somewhere to breathe.
    const needsBreather = this.sinceGrass >= 5;
    if (needsBreather) {
      this.band = { type: 'grass', left: randInt(1, 2) - 1 };
      return 'grass';
    }
    if (this.band.left > 0) {
      this.band.left--;
      return this.band.type;
    }

    const prev = this.band.type;
    if (prev === null) {
      // Ease people in: the first hazard is always a road.
      this.band = { type: 'road', left: randInt(1, 2) - 1 };
      return 'road';
    }

    const options = ['road', 'road', 'road', 'water', 'water', 'rail', 'grass', 'grass', 'grass'];
    let type = pick(options);
    // Never repeat a band type back-to-back — variety keeps it readable.
    let guard = 0;
    while (type === prev && guard++ < 8) type = pick(options);

    const lengths = { grass: [1, 2], road: [1, 3], water: [1, 3], rail: [1, 2] };
    const [lo, hi] = lengths[type];
    this.band = { type, left: randInt(lo, hi) - 1 };
    return type;
  }

  buildRow(index, type, opts = {}) {
    const row = {
      index, type,
      group: new THREE.Group(),
      blocked: new Set(),
      coins: new Map(),
      vehicles: [],
      logs: [],
    };
    row.group.position.z = -index * TILE;
    this.group.add(row.group);

    if (type === 'grass') this.buildGrass(row, opts);
    else if (type === 'road') this.buildRoad(row);
    else if (type === 'water') this.buildWater(row);
    else if (type === 'rail') this.buildRail(row);

    return row;
  }

  buildGrass(row, opts) {
    const shade = row.index % 2 === 0 ? COLORS.grassLight : COLORS.grassDark;
    row.group.add(M.makeTile(ROW_WIDTH, shade));

    // Scenery walls mark the edge of the playable area.
    for (let c = MAX_COL + 1; c <= DECOR_COL; c++) {
      for (const col of [c, -c]) {
        const t = M.makeTree();
        t.position.set(col * TILE, 0, rand(-0.12, 0.12));
        t.scale.setScalar(rand(0.9, 1.25));
        row.group.add(t);
      }
    }

    if (opts.safe) return;

    const obstacles = randInt(0, 5) + (Math.random() < this.difficulty ? 1 : 0);
    const free = [];
    for (let c = MIN_COL; c <= MAX_COL; c++) free.push(c);
    for (let i = 0; i < obstacles; i++) {
      const col = free.splice((Math.random() * free.length) | 0, 1)[0];
      if (col === undefined) break;
      const roll = Math.random();
      const prop = roll < 0.7 ? M.makeTree() : roll < 0.88 ? M.makeRock() : M.makeBush();
      prop.position.set(col * TILE, 0, rand(-0.1, 0.1));
      prop.scale.setScalar(rand(0.9, 1.15));
      prop.rotation.y = rand(-0.3, 0.3);
      row.group.add(prop);
      row.blocked.add(col);
    }

    if (Math.random() < 0.22 && free.length) {
      const col = pick(free);
      const coin = M.makeCoin();
      coin.position.x = col * TILE;
      row.group.add(coin);
      row.coins.set(col, coin);
    }
  }

  buildRoad(row) {
    row.group.add(M.makeTile(ROW_WIDTH, COLORS.road, 0.2));

    // Lane dashes on alternating rows read as multi-lane highway.
    if (row.index % 2 === 0) {
      const xs = [];
      for (let x = -DECOR_COL; x <= DECOR_COL; x += 2) xs.push(x);
      row.group.add(instancedStrip(M.box(0.7, 0.02, 0.09), M.mat(0xe9edf0), xs, 0.005, false));
    }

    const heavy = Math.random() < 0.3;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const speed = (heavy ? rand(2.0, 3.2) : rand(2.8, 5.2)) * (1 + this.difficulty * 0.55);
    const bodyLen = heavy ? 2.7 : 1.5;
    const gap = rand(heavy ? 3.4 : 2.6, heavy ? 6.0 : 5.0) - this.difficulty * 0.7;
    const count = Math.max(2, Math.floor(LOOP / (bodyLen + gap)));
    const spacing = LOOP / count;
    const offset = rand(0, spacing);

    for (let i = 0; i < count; i++) {
      const mesh = heavy ? M.makeTruck() : M.makeCar();
      mesh.rotation.y = dir > 0 ? 0 : Math.PI;
      const x = wrapX(-SPAN + offset + i * spacing);
      mesh.position.x = x;
      row.group.add(mesh);
      row.vehicles.push({ mesh, x, half: mesh.userData.halfLen, halfW: 0.45 });
    }

    row.speed = speed;
    row.dir = dir;
    row.honkAt = rand(2, 9);
    return row;
  }

  buildWater(row) {
    row.group.add(M.makeWaterTile(ROW_WIDTH));

    if (Math.random() < 0.16) {
      // Lily-pad row: static stepping stones instead of moving logs.
      row.speed = 0;
      row.dir = 1;
      const cols = [];
      for (let c = MIN_COL; c <= MAX_COL; c++) cols.push(c);
      const pads = randInt(6, 9);
      for (let i = 0; i < pads; i++) {
        const col = cols.splice((Math.random() * cols.length) | 0, 1)[0];
        if (col === undefined) break;
        const pad = M.makeLilyPad();
        pad.position.set(col * TILE, 0, rand(-0.1, 0.1));
        row.group.add(pad);
        row.logs.push({ mesh: pad, x: col * TILE, half: 0.42, y: 0.06 });
      }
      return row;
    }

    const dir = Math.random() < 0.5 ? 1 : -1;
    const speed = rand(1.1, 2.4) * (1 + this.difficulty * 0.5);
    const len = randInt(2, 4);
    // Keep gaps hoppable — you must always be able to reach the next log.
    const gap = rand(1.6, 2.9);
    const count = Math.max(2, Math.floor(LOOP / (len + gap)));
    const spacing = LOOP / count;
    const offset = rand(0, spacing);

    for (let i = 0; i < count; i++) {
      const mesh = M.makeLog(len);
      const x = wrapX(-SPAN + offset + i * spacing);
      mesh.position.x = x;
      row.group.add(mesh);
      row.logs.push({ mesh, x, half: len / 2 - 0.08, y: 0.25 });
    }

    row.speed = speed;
    row.dir = dir;
    return row;
  }

  buildRail(row) {
    row.group.add(M.makeTile(ROW_WIDTH, COLORS.rail, 0.2));

    const sleeperXs = [];
    for (let x = -DECOR_COL; x <= DECOR_COL; x += 0.5) sleeperXs.push(x);
    row.group.add(instancedStrip(M.box(0.32, 0.06, 0.86), M.mat(0x6b4b30), sleeperXs, 0.03, true));
    for (const z of [-0.3, 0.3]) {
      const railBar = new THREE.Mesh(M.box(ROW_WIDTH, 0.08, 0.1), M.mat(0xb9c1c7));
      railBar.position.set(0, 0.09, z);
      railBar.castShadow = false;
      row.group.add(railBar);
    }

    row.signals = [];
    for (const col of [MAX_COL + 1, MIN_COL - 1]) {
      const s = M.makeSignal();
      s.position.set(col * TILE, 0, 0.55);
      row.group.add(s);
      row.signals.push(s);
    }

    const train = M.makeTrain();
    train.visible = false;
    row.group.add(train);

    row.train = {
      mesh: train,
      half: train.userData.halfLen,
      x: 0,
      state: 'idle',
      timer: rand(1.5, 6),
      dir: 1,
      speed: 24,
      warned: false,
    };
    return row;
  }

  /* ---------------------------------------------------------------- update */

  update(dt, elapsed, playerRow) {
    for (const row of this.rows.values()) {
      const near = Math.abs(row.index - playerRow) < 24;

      if (row.type === 'road' && row.speed) {
        const step = row.speed * row.dir * dt;
        for (const v of row.vehicles) {
          v.x = wrapX(v.x + step);
          v.mesh.position.x = v.x;
        }
        if (near) {
          row.honkAt -= dt;
          if (row.honkAt <= 0) {
            row.honkAt = rand(6, 16);
            if (Math.abs(row.index - playerRow) < 6) sfx.horn();
          }
        }
      } else if (row.type === 'water' && row.speed) {
        const step = row.speed * row.dir * dt;
        for (const l of row.logs) {
          l.x = wrapX(l.x + step);
          l.mesh.position.x = l.x;
        }
      } else if (row.type === 'rail') {
        this.updateRail(row, dt, playerRow);
      }

      for (const coin of row.coins.values()) {
        coin.rotation.y += dt * 3;
        coin.position.y = 0.42 + Math.sin(elapsed * 3 + row.index) * 0.06;
      }
    }
  }

  updateRail(row, dt, playerRow) {
    const t = row.train;
    t.timer -= dt;
    const visible = Math.abs(row.index - playerRow) < 12;

    if (t.state === 'idle') {
      if (t.timer <= 0) {
        t.state = 'warn';
        t.timer = 1.5;
        t.dir = Math.random() < 0.5 ? 1 : -1;
        if (visible) sfx.bell();
      }
      this.setSignals(row, false);
    } else if (t.state === 'warn') {
      this.setSignals(row, Math.floor(t.timer * 6) % 2 === 0);
      if (t.timer <= 0) {
        t.state = 'run';
        t.x = -t.dir * (SPAN + t.half + 1);
        t.mesh.visible = true;
        t.mesh.position.x = t.x;
        if (visible) sfx.screech();
      }
    } else if (t.state === 'run') {
      this.setSignals(row, Math.floor(t.timer * 10) % 2 === 0);
      t.x += t.dir * t.speed * dt;
      t.mesh.position.x = t.x;
      if (Math.abs(t.x) > SPAN + t.half + 1.5) {
        t.state = 'idle';
        t.mesh.visible = false;
        t.timer = rand(3.5, 8);
        this.setSignals(row, false);
      }
    }
  }

  setSignals(row, on) {
    for (const s of row.signals) {
      s.userData.bulbMat.color.setHex(on ? 0xff3b30 : 0x5a1f1f);
    }
  }

  /* ------------------------------------------------------------- queries */

  isBlocked(rowIndex, col) {
    if (col < MIN_COL || col > MAX_COL) return true;
    const row = this.getRow(rowIndex);
    return row ? row.blocked.has(col) : false;
  }

  // Which log (or lily pad) is under this x on a water row?
  logAt(rowIndex, x) {
    const row = this.getRow(rowIndex);
    if (!row || row.type !== 'water') return null;
    for (const l of row.logs) {
      if (Math.abs(x - l.x) <= l.half) return l;
    }
    return null;
  }

  // Anything lethal overlapping the player at (rowIndex, x)?
  hazardAt(rowIndex, x, halfW = 0.28) {
    const row = this.getRow(rowIndex);
    if (!row) return null;
    if (row.type === 'road') {
      for (const v of row.vehicles) {
        if (Math.abs(x - v.x) < v.half + halfW) return 'car';
      }
    } else if (row.type === 'rail') {
      const t = row.train;
      if (t.state === 'run' && Math.abs(x - t.x) < t.half + halfW) return 'train';
    }
    return null;
  }

  collectCoin(rowIndex, col) {
    const row = this.getRow(rowIndex);
    if (!row) return null;
    const coin = row.coins.get(col);
    if (!coin) return null;
    row.coins.delete(col);
    row.group.remove(coin);
    return coin;
  }
}

// One draw call for a repeated strip of identical blocks (sleepers, lane dashes).
const _m4 = new THREE.Matrix4();
function instancedStrip(geometry, material, xs, y, receiveShadow) {
  const inst = new THREE.InstancedMesh(geometry, material, xs.length);
  xs.forEach((x, i) => inst.setMatrixAt(i, _m4.makeTranslation(x, y, 0)));
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = false;
  inst.receiveShadow = receiveShadow;
  return inst;
}

function wrapX(x) {
  // Keeps traffic evenly spaced across the wrap seam.
  return ((x + SPAN) % LOOP + LOOP) % LOOP - SPAN;
}
