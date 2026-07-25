// Bootstrap: renderer, camera rig, game loop, input and HUD wiring.

import * as THREE from 'three';
import { COLORS, EAGLE_MARGIN, TILE } from './constants.js';
import { World } from './world.js';
import { Player } from './player.js';
import * as M from './models.js';
import { sfx, unlock, toggle as toggleSound, isEnabled } from './audio.js';
import { fetchTop, submitScore, renderBoard, savedName, rememberName } from './leaderboard.js';

/* ------------------------------------------------------------------ setup */

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.sky);
scene.fog = new THREE.Fog(COLORS.sky, 34, 66);

const VIEW = 11;                                     // vertical world units in frame
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -40, 200);
const CAM_OFFSET = new THREE.Vector3(4.6, 19, 15.5);   // slight yaw, ~50° tilt
scene.add(camera);

const sun = new THREE.DirectionalLight(0xffffff, 1.05);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
// Wide enough to cover everything on screen — a tight frustum leaves the
// rest of the view stuck on the shadow map's clamped edge texel.
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 140;
sun.shadow.bias = -0.0012;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(sun.target);

scene.add(new THREE.HemisphereLight(0xffffff, 0x88d0ff, 0.55));
scene.add(new THREE.AmbientLight(0xffffff, 0.35));

const world = new World(scene);
const player = new Player(scene, world);

const eagle = M.makeEagle();
eagle.visible = false;
scene.add(eagle);

/* -------------------------------------------------------------- game state */

const ui = {
  score: document.getElementById('score'),
  best: document.getElementById('best'),
  coins: document.getElementById('coins'),
  start: document.getElementById('startScreen'),
  over: document.getElementById('gameOver'),
  finalScore: document.getElementById('finalScore'),
  finalCoins: document.getElementById('finalCoins'),
  finalBest: document.getElementById('finalBest'),
  newBest: document.getElementById('newBest'),
  reason: document.getElementById('deathReason'),
  sound: document.getElementById('sound'),
  boardScreen: document.getElementById('boardScreen'),
  topBoard: document.getElementById('topBoard'),
  submitBlock: document.getElementById('submitBlock'),
  submitForm: document.getElementById('submitForm'),
  submitBtn: document.getElementById('submitBtn'),
  nameInput: document.getElementById('nameInput'),
  submitMsg: document.getElementById('submitMsg'),
  overBoardBlock: document.getElementById('overBoardBlock'),
  overBoardTitle: document.getElementById('overBoardTitle'),
  overBoard: document.getElementById('overBoard'),
};

const REASONS = {
  car: 'Squashed',
  train: 'Hit by a train',
  water: 'Went for a swim',
  eagle: 'Taken by the eagle',
};

let state = 'ready';          // ready | playing | over
let best = Number(localStorage.getItem('cc_best') || 0);
let camAnchor = 0;
let camX = 0;
let scrollActive = false;
let overTimer = 0;
let shake = 0;

ui.best.textContent = `Best ${best}`;
ui.sound.textContent = isEnabled() ? '🔊' : '🔇';

function startGame() {
  world.reset();
  player.reset();
  camAnchor = 0;
  camX = 0;
  scrollActive = false;
  overTimer = 0;
  shake = 0;
  eagle.visible = false;
  ui.score.textContent = '0';
  ui.coins.textContent = '0';
  ui.start.classList.remove('show');
  ui.over.classList.remove('show');
  closeBoard();
  ui.submitBlock.classList.add('hidden');
  ui.overBoardBlock.classList.add('hidden');
  message('', '');
  state = 'playing';
  unlock();
  sfx.start();
  updateCamera(0, true);
}

function endGame() {
  state = 'over';
  const score = player.maxRow;
  const isBest = score > best;
  pendingRun = { score, coins: player.coins };
  setupScoreboard();
  if (isBest) {
    best = score;
    localStorage.setItem('cc_best', String(best));
    ui.best.textContent = `Best ${best}`;
  }
  ui.finalScore.textContent = score;
  ui.finalCoins.textContent = player.coins;
  ui.finalBest.textContent = best;
  ui.newBest.classList.toggle('hidden', !isBest);
  ui.reason.textContent = REASONS[player.deathCause] || 'Game over';
  ui.over.classList.add('show');
}

/* ------------------------------------------------------------- scoreboard */

let pendingRun = { score: 0, coins: 0 };
let boardOpen = false;

function message(text, kind) {
  ui.submitMsg.textContent = text;
  ui.submitMsg.className = `msg ${kind || ''}`;
}

// Called on game over: pull the board, and offer to submit if the run counts.
async function setupScoreboard() {
  message('', '');
  ui.submitBlock.classList.add('hidden');
  ui.overBoardBlock.classList.add('hidden');
  ui.overBoardTitle.textContent = 'Top 10';

  let data;
  try {
    data = await fetchTop();
  } catch {
    message('Scoreboard offline.', '');
    return;
  }
  if (state !== 'over') return;                 // player already restarted

  renderBoard(ui.overBoard, data.top, savedName());
  ui.overBoardBlock.classList.remove('hidden');

  if (pendingRun.score > 0) {
    ui.nameInput.value = savedName();
    ui.submitBlock.classList.remove('hidden');
  }
}

ui.submitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = ui.nameInput.value.trim();
  if (!name) return message('Enter a name.', 'err');

  ui.submitBtn.disabled = true;
  message('Saving…', '');
  try {
    const data = await submitScore({ name, score: pendingRun.score, coins: pendingRun.coins });
    rememberName(data.name);
    ui.submitBlock.classList.add('hidden');
    renderBoard(ui.overBoard, data.top, data.name);
    ui.overBoardBlock.classList.remove('hidden');
    if (data.rank && data.rank <= 10) {
      message(`#${data.rank} on the board!`, 'ok');
      ui.overBoardTitle.textContent = 'Top 10';
    } else if (data.improved) {
      message(`Saved — your best is ${data.best}. Rank #${data.rank}.`, 'ok');
    } else {
      message(`Your best is still ${data.best}. Rank #${data.rank}.`, 'ok');
    }
    sfx.coin();
  } catch (err) {
    message(err.message, 'err');
  } finally {
    ui.submitBtn.disabled = false;
  }
});

async function openBoard() {
  boardOpen = true;
  ui.boardScreen.classList.add('show');
  ui.topBoard.innerHTML = '<li class="board-empty">Loading…</li>';
  try {
    const data = await fetchTop();
    renderBoard(ui.topBoard, data.top, savedName());
  } catch {
    ui.topBoard.innerHTML = '<li class="board-empty">Scoreboard offline.</li>';
  }
}

function closeBoard() {
  boardOpen = false;
  ui.boardScreen.classList.remove('show');
}

document.getElementById('boardBtn').addEventListener('click', openBoard);
document.getElementById('boardCloseBtn').addEventListener('click', closeBoard);

/* ------------------------------------------------------------------ input */

function handleMove(dir) {
  if (state === 'ready') { startGame(); return; }
  if (state !== 'playing') return;
  unlock();
  player.move(dir);
}

const KEYS = {
  ArrowUp: 'forward', KeyW: 'forward',
  ArrowDown: 'back', KeyS: 'back',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  // Never steer the chicken while someone is typing their name.
  if (e.target instanceof HTMLInputElement) return;
  if (boardOpen) {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') {
      e.preventDefault();
      closeBoard();
    }
    return;
  }
  const dir = KEYS[e.code];
  if (dir) {
    e.preventDefault();
    handleMove(dir);
    return;
  }
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (state === 'ready') startGame();
    else if (state === 'over') startGame();
  }
});

// Tap to hop forward, swipe for a direction.
let touchStart = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (state === 'over') return;
  touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!touchStart || state === 'over') { touchStart = null; return; }
  const dx = e.clientX - touchStart.x;
  const dy = e.clientY - touchStart.y;
  touchStart = null;
  const dist = Math.hypot(dx, dy);
  if (dist < 26) { handleMove('forward'); return; }
  if (Math.abs(dx) > Math.abs(dy)) handleMove(dx > 0 ? 'right' : 'left');
  else handleMove(dy < 0 ? 'forward' : 'back');
});

document.getElementById('playBtn').addEventListener('click', startGame);
document.getElementById('retryBtn').addEventListener('click', startGame);
ui.sound.addEventListener('click', () => {
  const on = toggleSound();
  ui.sound.textContent = on ? '🔊' : '🔇';
});

window.addEventListener('resize', resize);
const MIN_WIDTH = 10.5;                              // columns that must always fit

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;
  // On tall/portrait screens, widen the frustum instead of cropping the road.
  const vertical = Math.max(VIEW, MIN_WIDTH / aspect);
  camera.left = (-vertical * aspect) / 2;
  camera.right = (vertical * aspect) / 2;
  camera.top = vertical / 2;
  camera.bottom = -vertical / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
}
resize();

/* ------------------------------------------------------------------- loop */

const _target = new THREE.Vector3();
const _sunOffset = new THREE.Vector3(-22, 34, 16);
const _eagleTarget = new THREE.Vector3();

function updateCamera(dt, snap = false) {
  // Never travel backwards; ease forward toward the chicken.
  const k = snap ? 1 : 1 - Math.pow(0.0025, dt);
  const eased = camAnchor + (player.row - camAnchor) * k;
  camAnchor = Math.max(camAnchor, eased);

  if (state === 'playing' && player.maxRow >= 6) scrollActive = true;
  if (scrollActive && !player.dead) {
    const rate = 0.42 + Math.min(0.85, player.maxRow / 320);
    camAnchor += rate * dt;
  }

  const wantX = THREE.MathUtils.clamp(player.mesh.position.x * 0.55, -3.2, 3.2);
  camX += (wantX - camX) * (snap ? 1 : 1 - Math.pow(0.004, dt));

  const focusZ = -(camAnchor + 2.2) * TILE;
  _target.set(camX, 0, focusZ);

  if (shake > 0) {
    shake = Math.max(0, shake - dt * 2.4);
    _target.x += (Math.random() - 0.5) * shake * 0.5;
    _target.z += (Math.random() - 0.5) * shake * 0.5;
  }

  camera.position.copy(_target).add(CAM_OFFSET);
  camera.lookAt(_target);

  sun.position.copy(_target).add(_sunOffset);
  sun.target.position.copy(_target);
  sun.target.updateMatrixWorld();
}

let last = performance.now();
let elapsed = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;

  world.update(dt, elapsed, player.row);
  player.update(dt, elapsed);

  if (state === 'playing') {
    if (!player.dead) {
      world.ensureAhead(player.maxRow);
      world.recycle(Math.floor(camAnchor));

      if (player.row < camAnchor - EAGLE_MARGIN) {
        player.die('eagle');
        launchEagle();
      }
      if (player.deathCause === 'car' || player.deathCause === 'train') shake = 1;

      const score = player.maxRow;
      if (ui.score.textContent !== String(score)) ui.score.textContent = String(score);
      if (ui.coins.textContent !== String(player.coins)) ui.coins.textContent = String(player.coins);
    } else {
      overTimer += dt;
      if (overTimer > 1.15) endGame();
    }
  }

  if (eagle.visible) updateEagle(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

function launchEagle() {
  shake = 0.6;
  eagle.visible = true;
  eagle.position.set(player.mesh.position.x - 4, 7, -player.row * TILE - 4);
  eagle.userData.t = 0;
}

function updateEagle(dt) {
  eagle.userData.t += dt;
  const t = eagle.userData.t;
  const p = player.mesh.position;
  _eagleTarget.set(p.x - 0.4, p.y + 0.55, p.z);
  eagle.position.lerp(_eagleTarget, Math.min(1, dt * 7));
  const flap = Math.sin(t * 26) * 0.5;
  if (eagle.userData.wingL) eagle.userData.wingL.rotation.x = flap;
  if (eagle.userData.wingR) eagle.userData.wingR.rotation.x = -flap;
  if (t > 3.5) eagle.visible = false;
}

// Handy for debugging in the console: __cc.player.row, __cc.world.getRow(n), …
window.__cc = { player, world, camera, scene, renderer, get state() { return state; }, get camAnchor() { return camAnchor; } };

// Kick things off on the start screen with a live world behind the card.
world.reset();
player.reset();
updateCamera(0, true);
requestAnimationFrame((t) => { last = t; frame(t); });
