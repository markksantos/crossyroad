// Procedural low-poly models. Everything is boxes, so geometries and
// materials are cached and shared — building a row costs almost nothing.

import * as THREE from 'three';
import { TILE, COLORS, CAR_COLORS, TRUCK_COLORS } from './constants.js';

const geoCache = new Map();
const matCache = new Map();

export function box(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

export function mat(color, opts = {}) {
  const key = `${color}|${opts.transparent ? opts.opacity : ''}|${opts.flat ? 1 : 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
    });
    matCache.set(key, m);
  }
  return m;
}

function mesh(w, h, d, color, opts) {
  const m = new THREE.Mesh(box(w, h, d), mat(color, opts));
  m.castShadow = opts?.castShadow ?? true;
  m.receiveShadow = opts?.receiveShadow ?? true;
  return m;
}

const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/* ------------------------------------------------------------------ terrain */

export function makeTile(width, color, height = 0.2) {
  const m = new THREE.Mesh(box(width, height, TILE), mat(color));
  m.castShadow = false;
  m.receiveShadow = true;
  m.position.y = -height / 2;
  return m;
}

export function makeWaterTile(width) {
  const m = new THREE.Mesh(box(width, 0.2, TILE), mat(COLORS.water));
  m.castShadow = false;
  m.receiveShadow = true;
  m.position.y = -0.16;
  return m;
}

/* ------------------------------------------------------------------ scenery */

export function makeTree() {
  const g = new THREE.Group();
  const trunk = mesh(0.28, 0.42, 0.28, 0x8a5a37);
  trunk.position.y = 0.21;
  g.add(trunk);

  const tiers = 1 + ((Math.random() * 3) | 0);
  const leafColor = pick([0x3f9e4d, 0x379046, 0x48ab57]);
  let y = 0.42;
  for (let i = 0; i < tiers; i++) {
    const s = 0.78 - i * 0.13;
    const h = 0.42;
    const leaf = mesh(s, h, s, leafColor);
    leaf.position.y = y + h / 2;
    y += h * 0.86;
    g.add(leaf);
  }
  return g;
}

export function makeRock() {
  const g = new THREE.Group();
  const a = mesh(0.5, 0.34, 0.46, 0x9aa5ad);
  a.position.y = 0.17;
  a.rotation.y = Math.random() * Math.PI;
  g.add(a);
  const b = mesh(0.3, 0.22, 0.28, 0xb2bcc4);
  b.position.set(0.18, 0.11, -0.14);
  b.rotation.y = Math.random() * Math.PI;
  g.add(b);
  return g;
}

export function makeBush() {
  const g = new THREE.Group();
  const c = mesh(0.62, 0.4, 0.58, 0x4aa85a);
  c.position.y = 0.2;
  g.add(c);
  const d = mesh(0.34, 0.28, 0.34, 0x56b866);
  d.position.set(-0.2, 0.32, 0.1);
  g.add(d);
  return g;
}

export function makeLilyPad() {
  const g = new THREE.Group();
  const pad = mesh(0.62, 0.06, 0.62, 0x2f9d5b, { castShadow: false });
  pad.position.y = 0.03;
  pad.rotation.y = Math.random() * Math.PI;
  g.add(pad);
  const flower = mesh(0.16, 0.12, 0.16, 0xffb3c7, { castShadow: false });
  flower.position.y = 0.11;
  if (Math.random() < 0.5) g.add(flower);
  return g;
}

/* ------------------------------------------------------------------ vehicles */

function wheels(group, halfLen, y = 0.11) {
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = mesh(0.18, 0.22, 0.22, 0x22242a);
      w.position.set(sx * (halfLen - 0.24), y, sz * 0.33);
      group.add(w);
    }
  }
}

// Vehicles are built pointing along +X; the row flips them by direction.
export function makeCar() {
  const g = new THREE.Group();
  const color = pick(CAR_COLORS);
  const len = 1.5;

  const body = mesh(len, 0.32, 0.82, color);
  body.position.y = 0.34;
  g.add(body);

  const cabin = mesh(0.72, 0.3, 0.72, color);
  cabin.position.set(-0.08, 0.63, 0);
  g.add(cabin);

  const glass = mesh(0.74, 0.18, 0.74, 0x2b3a45, { transparent: true, opacity: 0.85 });
  glass.position.set(-0.08, 0.66, 0);
  g.add(glass);

  const lightF = mesh(0.06, 0.1, 0.16, 0xfff4c2, { castShadow: false });
  lightF.position.set(len / 2 - 0.02, 0.34, 0.26);
  g.add(lightF);
  const lightF2 = lightF.clone();
  lightF2.position.z = -0.26;
  g.add(lightF2);

  const tail = mesh(0.06, 0.1, 0.16, 0xd6402f, { castShadow: false });
  tail.position.set(-len / 2 + 0.02, 0.34, 0.26);
  g.add(tail);
  const tail2 = tail.clone();
  tail2.position.z = -0.26;
  g.add(tail2);

  wheels(g, len / 2);
  g.userData.halfLen = len / 2;
  return g;
}

export function makeTruck() {
  const g = new THREE.Group();
  const cabColor = pick(TRUCK_COLORS);
  const len = 2.7;

  const trailer = mesh(1.75, 0.72, 0.9, 0xf1f3f5);
  trailer.position.set(-0.45, 0.62, 0);
  g.add(trailer);

  const stripe = mesh(1.76, 0.12, 0.92, 0xd7dde3, { castShadow: false });
  stripe.position.set(-0.45, 0.5, 0);
  g.add(stripe);

  const cab = mesh(0.85, 0.6, 0.86, cabColor);
  cab.position.set(0.9, 0.5, 0);
  g.add(cab);

  const glass = mesh(0.5, 0.22, 0.88, 0x2b3a45, { transparent: true, opacity: 0.85 });
  glass.position.set(1.06, 0.62, 0);
  g.add(glass);

  wheels(g, len / 2 - 0.1);
  const mid = mesh(0.18, 0.22, 0.22, 0x22242a);
  mid.position.set(-0.1, 0.11, 0.33);
  g.add(mid);
  const mid2 = mid.clone();
  mid2.position.z = -0.33;
  g.add(mid2);

  g.userData.halfLen = len / 2;
  return g;
}

export function makeLog(lengthTiles) {
  const g = new THREE.Group();
  const len = lengthTiles;
  const body = mesh(len, 0.34, 0.7, COLORS.log, { receiveShadow: true });
  body.position.y = 0.05;
  g.add(body);

  const top = mesh(len - 0.06, 0.1, 0.56, 0x9b6a42, { castShadow: false });
  top.position.y = 0.2;
  g.add(top);

  for (const sx of [-1, 1]) {
    const cap = mesh(0.1, 0.32, 0.64, COLORS.logDark, { castShadow: false });
    cap.position.set(sx * (len / 2 - 0.03), 0.05, 0);
    g.add(cap);
  }
  g.userData.halfLen = len / 2;
  return g;
}

export function makeTrain() {
  const g = new THREE.Group();
  const carLen = 3.2;
  const cars = 4;
  const total = carLen * cars;

  for (let i = 0; i < cars; i++) {
    const x = -total / 2 + carLen * i + carLen / 2;
    const color = i === 0 ? 0xe23c3c : 0xdfe4e8;
    const body = mesh(carLen - 0.22, 0.9, 0.94, color);
    body.position.set(x, 0.72, 0);
    g.add(body);

    const roof = mesh(carLen - 0.3, 0.14, 0.86, 0x8f979d, { castShadow: false });
    roof.position.set(x, 1.22, 0);
    g.add(roof);

    const win = mesh(carLen - 0.9, 0.26, 0.98, 0x2b3a45, { castShadow: false });
    win.position.set(x, 0.9, 0);
    g.add(win);

    const skirt = mesh(carLen - 0.4, 0.22, 0.8, 0x4b545c);
    skirt.position.set(x, 0.24, 0);
    g.add(skirt);
  }

  const lamp = mesh(0.1, 0.16, 0.3, 0xfff3bf, { castShadow: false });
  lamp.position.set(-total / 2 + 0.02, 0.8, 0);
  g.add(lamp);

  g.userData.halfLen = total / 2;
  return g;
}

/* ------------------------------------------------------------------ props */

const COIN_OUTER = new THREE.CylinderGeometry(0.24, 0.24, 0.07, 14);
const COIN_INNER = new THREE.CylinderGeometry(0.15, 0.15, 0.09, 12);

export function makeCoin() {
  const g = new THREE.Group();
  const c = new THREE.Mesh(COIN_OUTER, mat(0xffc93c));
  c.rotation.x = Math.PI / 2;
  c.castShadow = true;
  g.add(c);
  const inner = new THREE.Mesh(COIN_INNER, mat(0xffe479));
  inner.rotation.x = Math.PI / 2;
  g.add(inner);
  g.position.y = 0.42;
  return g;
}

export function makeSignal() {
  const g = new THREE.Group();
  const post = mesh(0.12, 1.1, 0.12, 0x3b4045);
  post.position.y = 0.55;
  g.add(post);
  const head = mesh(0.34, 0.34, 0.18, 0x2b3035);
  head.position.y = 1.16;
  g.add(head);

  const bulbMat = new THREE.MeshBasicMaterial({ color: 0x5a1f1f });
  const bulb = new THREE.Mesh(box(0.16, 0.16, 0.06), bulbMat);
  bulb.position.set(0, 1.16, 0.12);
  g.add(bulb);
  g.userData.bulb = bulb;
  g.userData.bulbMat = bulbMat;
  return g;
}

/* ------------------------------------------------------------------ player */

export function makeChicken() {
  const g = new THREE.Group();
  const white = 0xffffff;

  const body = mesh(0.5, 0.4, 0.42, white);
  body.position.y = 0.3;
  g.add(body);

  const tail = mesh(0.14, 0.24, 0.3, 0xf2f2f2);
  tail.position.set(0, 0.46, 0.24);
  g.add(tail);

  const head = mesh(0.34, 0.3, 0.32, white);
  head.position.set(0, 0.66, -0.06);
  g.add(head);

  const comb = mesh(0.1, 0.14, 0.22, 0xe23c3c);
  comb.position.set(0, 0.85, -0.02);
  g.add(comb);

  const beak = mesh(0.14, 0.1, 0.14, 0xffa62b);
  beak.position.set(0, 0.63, -0.24);
  g.add(beak);

  const wattle = mesh(0.08, 0.1, 0.08, 0xe23c3c);
  wattle.position.set(0, 0.53, -0.2);
  g.add(wattle);

  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(box(0.06, 0.08, 0.06), new THREE.MeshBasicMaterial({ color: 0x1b232a }));
    eye.position.set(sx * 0.13, 0.7, -0.18);
    g.add(eye);

    const wing = mesh(0.08, 0.24, 0.3, 0xf2f2f2);
    wing.position.set(sx * 0.28, 0.32, 0.02);
    g.add(wing);

    const leg = mesh(0.08, 0.16, 0.08, 0xffa62b);
    leg.position.set(sx * 0.12, 0.08, 0.02);
    g.add(leg);
  }

  return g;
}

export function makeEagle() {
  const g = new THREE.Group();
  const body = mesh(0.9, 0.42, 0.5, 0x6b4a2f);
  body.position.y = 0;
  g.add(body);
  const head = mesh(0.34, 0.3, 0.32, 0xf3f0e8);
  head.position.set(-0.5, 0.1, 0);
  g.add(head);
  const beak = mesh(0.18, 0.12, 0.12, 0xffc93c);
  beak.position.set(-0.72, 0.06, 0);
  g.add(beak);
  for (const sz of [-1, 1]) {
    const wing = mesh(0.7, 0.1, 1.1, 0x5a3d26);
    wing.position.set(0, 0.14, sz * 0.78);
    g.add(wing);
    g.userData[sz > 0 ? 'wingL' : 'wingR'] = wing;
  }
  return g;
}

export function makeSplash() {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color: 0xdff3ff, transparent: true, opacity: 0.9 });
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Mesh(box(0.12, 0.12, 0.12), m);
    const a = (i / 8) * Math.PI * 2;
    p.userData.vel = new THREE.Vector3(Math.cos(a) * 1.6, 2.4 + Math.random(), Math.sin(a) * 1.6);
    g.add(p);
  }
  g.userData.mat = m;
  return g;
}

// Note: every geometry and material above is either cached or module-level,
// so recycled rows can simply be detached — there is nothing to dispose.
// The only exceptions are the signal bulb and splash materials, which their
// owners dispose explicitly.
