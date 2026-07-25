// The view of the world. It owns meshes and nothing else: every position it
// draws is read back out of the simulation, so what you see is what the server
// will verify. Cosmetic choices (paint, prop shapes) come from a separate RNG
// stream, so re-skinning the game can never change a run's outcome.

import * as THREE from 'three';
import { TILE, MIN_COL, MAX_COL, DECOR_COL, ROWS_AHEAD, ROWS_BEHIND, COLORS } from './constants.js';
import { rowRng } from './sim/rng.js';
import * as M from './models.js';
import { sfx } from './audio.js';

const ROW_WIDTH = DECOR_COL * 2 + 1;
const _m4 = new THREE.Matrix4();

export class WorldView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.views = new Map();
    this.sim = null;
  }

  attach(sim) {
    for (const view of this.views.values()) this.dispose(view);
    this.views.clear();
    this.sim = sim;
  }

  /** Build rows around the player, retire the ones left behind. */
  sync(playerRow) {
    if (!this.sim) return;
    const centre = Math.round(playerRow);
    const lo = centre - ROWS_BEHIND;
    const hi = centre + ROWS_AHEAD;

    for (const [index, view] of this.views) {
      if (index < lo || index > hi) {
        this.dispose(view);
        this.views.delete(index);
      }
    }
    for (let i = lo; i <= hi; i++) {
      if (!this.views.has(i)) this.views.set(i, this.build(i));
    }
  }

  dispose(view) {
    this.group.remove(view.group);
    if (view.signals) for (const s of view.signals) s.userData.bulbMat.dispose();
    view.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  }

  /* ------------------------------------------------------------- building */

  build(index) {
    const data = this.sim.row(index);
    const rnd = rowRng(this.sim.seedInt, index, 1);      // cosmetics only
    const group = new THREE.Group();
    group.position.z = -index * TILE;
    this.group.add(group);

    const view = { index, data, group, items: [], coin: null };

    if (data.type === 'grass') this.buildGrass(view, rnd);
    else if (data.type === 'road') this.buildRoad(view, rnd);
    else if (data.type === 'water') this.buildWater(view, rnd);
    else this.buildRail(view, rnd);

    return view;
  }

  buildGrass(view, rnd) {
    const { data, group } = view;
    group.add(M.makeTile(ROW_WIDTH, data.index % 2 === 0 ? COLORS.grassLight : COLORS.grassDark));

    for (let c = MAX_COL + 1; c <= DECOR_COL; c++) {
      for (const col of [c, -c]) {
        const tree = M.makeTree();
        tree.position.set(col * TILE, 0, rnd() * 0.24 - 0.12);
        tree.scale.setScalar(0.9 + rnd() * 0.35);
        group.add(tree);
      }
    }

    data.blocked.forEach((col, i) => {
      const kind = data.kinds ? data.kinds[i] : rnd();
      const prop = kind < 0.7 ? M.makeTree() : kind < 0.88 ? M.makeRock() : M.makeBush();
      prop.position.set(col * TILE, 0, rnd() * 0.2 - 0.1);
      prop.scale.setScalar(0.9 + rnd() * 0.25);
      prop.rotation.y = rnd() * 0.6 - 0.3;
      group.add(prop);
    });

    if (data.coin !== null) {
      const coin = M.makeCoin();
      coin.position.x = data.coin * TILE;
      group.add(coin);
      view.coin = coin;
    }
  }

  buildRoad(view, rnd) {
    const { data, group } = view;
    group.add(M.makeTile(ROW_WIDTH, COLORS.road, 0.2));

    if (data.index % 2 === 0) {
      const xs = [];
      for (let x = -DECOR_COL; x <= DECOR_COL; x += 2) xs.push(x);
      group.add(strip(M.box(0.7, 0.02, 0.09), M.mat(0xe9edf0), xs, 0.005, false));
    }

    for (let i = 0; i < data.starts.length; i++) {
      const mesh = data.heavy ? M.makeTruck() : M.makeCar();
      mesh.rotation.y = data.dir > 0 ? 0 : Math.PI;
      group.add(mesh);
      view.items.push(mesh);
    }
    view.honkAt = 2 + rnd() * 7;
  }

  buildWater(view, rnd) {
    const { data, group } = view;
    group.add(M.makeWaterTile(ROW_WIDTH));

    for (let i = 0; i < data.starts.length; i++) {
      const mesh = data.pads ? M.makeLilyPad() : M.makeLog(data.len);
      if (data.pads) mesh.rotation.y = rnd() * Math.PI;
      group.add(mesh);
      view.items.push(mesh);
    }
  }

  buildRail(view) {
    const { data, group } = view;
    group.add(M.makeTile(ROW_WIDTH, COLORS.rail, 0.2));

    const sleepers = [];
    for (let x = -DECOR_COL; x <= DECOR_COL; x += 0.5) sleepers.push(x);
    group.add(strip(M.box(0.32, 0.06, 0.86), M.mat(0x6b4b30), sleepers, 0.03, true));

    for (const z of [-0.3, 0.3]) {
      const bar = new THREE.Mesh(M.box(ROW_WIDTH, 0.08, 0.1), M.mat(0xb9c1c7));
      bar.position.set(0, 0.09, z);
      bar.castShadow = false;
      group.add(bar);
    }

    view.signals = [];
    for (const col of [MAX_COL + 1, MIN_COL - 1]) {
      const s = M.makeSignal();
      s.position.set(col * TILE, 0, 0.55);
      group.add(s);
      view.signals.push(s);
    }

    const train = M.makeTrain();
    train.visible = false;
    train.rotation.y = data.dir > 0 ? 0 : Math.PI;
    group.add(train);
    view.train = train;
    view.trainState = null;
  }

  /* ------------------------------------------------------------- updating */

  /** `t` may be fractional — every position is a closed form, so it just works. */
  update(t, dt, game, playerRow) {
    if (!this.sim) return;

    for (const view of this.views.values()) {
      const { data } = view;
      const near = Math.abs(data.index - playerRow) < 24;

      if (data.type === 'road' || data.type === 'water') {
        for (let i = 0; i < view.items.length; i++) {
          view.items[i].position.x = this.sim.itemX(data, i, t);
        }
        if (data.type === 'road' && near) {
          view.honkAt -= dt;
          if (view.honkAt <= 0) {
            view.honkAt = 6 + Math.random() * 10;
            if (Math.abs(data.index - playerRow) < 6) sfx.horn();
          }
        }
      } else if (data.type === 'rail') {
        const state = this.sim.trainAt(data, t);
        const visible = Math.abs(data.index - playerRow) < 12;

        if (typeof state === 'number') {
          view.train.visible = true;
          view.train.position.x = state;
        } else {
          view.train.visible = false;
        }
        const lit = state !== null && Math.floor(t * 6) % 2 === 0;
        for (const s of view.signals) s.userData.bulbMat.color.setHex(lit ? 0xff3b30 : 0x5a1f1f);

        const kind = state === null ? 'idle' : typeof state === 'number' ? 'run' : 'warn';
        if (kind !== view.trainState) {
          if (visible && kind === 'warn') sfx.bell();
          if (visible && kind === 'run') sfx.screech();
          view.trainState = kind;
        }
      }

      if (view.coin) {
        if (game.collected.has(data.index)) {
          view.group.remove(view.coin);
          view.coin = null;
        } else {
          view.coin.rotation.y += dt * 3;
          view.coin.position.y = 0.42 + Math.sin(t * 3 + data.index) * 0.06;
        }
      }
    }
  }
}

// One draw call for a repeated strip of identical blocks.
function strip(geometry, material, xs, y, receiveShadow) {
  const inst = new THREE.InstancedMesh(geometry, material, xs.length);
  xs.forEach((x, i) => inst.setMatrixAt(i, _m4.makeTranslation(x, y, 0)));
  inst.instanceMatrix.needsUpdate = true;
  inst.castShadow = false;
  inst.receiveShadow = receiveShadow;
  return inst;
}
