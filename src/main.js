// Bootstrap: renderer, camera rig, fixed-step game loop, input and HUD.
//
// The simulation runs at exactly 60 Hz and every input is recorded against the
// tick it landed on. That log is what gets submitted — the server replays it to
// decide the score, so the number on screen is a prediction of the server's
// answer, not a claim the server has to take on faith.

import * as THREE from 'three';
import { COLORS, TILE, DT, EAGLE_MARGIN } from './constants.js';
import { Game, DIRS } from './sim/game.js';
import { MAX_INPUTS } from './sim/constants.js';
import { WorldView } from './world.js';
import { PlayerView } from './player.js';
import * as M from './models.js';
import { sfx, unlock, toggle as toggleSound, isEnabled } from './audio.js';
import {
  fetchTop, submitRun, startSession, renderBoard, savedName, rememberName,
} from './leaderboard.js';

/* ------------------------------------------------------------------ setup */

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.sky);
scene.fog = new THREE.Fog(COLORS.sky, 34, 66);

const VIEW = 11;
const MIN_WIDTH = 10.5;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -40, 200);
const CAM_OFFSET = new THREE.Vector3(4.6, 19, 15.5);
scene.add(camera);

const sun = new THREE.DirectionalLight(0xffffff, 1.05);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
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

const worldView = new WorldView(scene);
const playerView = new PlayerView(scene);
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

let state = 'ready';               // ready | playing | over
let best = Number(localStorage.getItem('cc_best') || 0);
let game = new Game('menu');
let session = null;                // signed seed from the server, if any
let inputs = [];                   // flat [tick, dirIndex, …]
let pending = [];                  // inputs waiting for their tick
let camX = 0;
let overTimer = 0;
let shake = 0;
let boardOpen = false;

ui.best.textContent = `Best ${best}`;
ui.sound.textContent = isEnabled() ? '🔊' : '🔇';

function newRun(seed) {
  game = new Game(seed);
  inputs = [];
  pending = [];
  worldView.attach(game.world);
  worldView.sync(0);
  playerView.reset();
  camX = 0;
  overTimer = 0;
  shake = 0;
  eagle.visible = false;
}

async function startGame() {
  unlock();
  ui.start.classList.remove('show');
  ui.over.classList.remove('show');
  closeBoard();
  ui.submitBlock.classList.add('hidden');
  ui.overBoardBlock.classList.add('hidden');
  message('', '');
  ui.score.textContent = '0';
  ui.coins.textContent = '0';

  // A verified run needs a server-issued seed. Without one the game still
  // plays — it just can't be submitted.
  session = await startSession();
  newRun(session ? session.seed : `local-${Math.random().toString(36).slice(2)}`);

  state = 'playing';
  sfx.start();
  updateCamera(0, true);
}

function endGame() {
  state = 'over';
  const score = game.maxRow;
  const isBest = score > best;
  if (isBest) {
    best = score;
    localStorage.setItem('cc_best', String(best));
    ui.best.textContent = `Best ${best}`;
  }
  ui.finalScore.textContent = score;
  ui.finalCoins.textContent = game.coins;
  ui.finalBest.textContent = best;
  ui.newBest.classList.toggle('hidden', !isBest);
  ui.reason.textContent = REASONS[game.cause] || 'Game over';
  ui.over.classList.add('show');
  setupScoreboard();
}

/* ------------------------------------------------------------- scoreboard */

function message(text, kind) {
  ui.submitMsg.textContent = text;
  ui.submitMsg.className = `msg ${kind || ''}`;
}

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
  if (state !== 'over') return;

  renderBoard(ui.overBoard, data.top, savedName());
  ui.overBoardBlock.classList.remove('hidden');

  if (game.maxRow > 0 && session) {
    ui.nameInput.value = savedName();
    ui.submitBlock.classList.remove('hidden');
  } else if (game.maxRow > 0) {
    message('This run was not verified, so it cannot be submitted.', '');
  }
}

ui.submitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = ui.nameInput.value.trim();
  if (!name) return message('Enter a name.', 'err');
  if (!session) return message('This run was not verified.', 'err');

  ui.submitBtn.disabled = true;
  message('Verifying…', '');
  try {
    const data = await submitRun({ name, session, inputs, endTick: game.tick });
    rememberName(data.name);
    ui.submitBlock.classList.add('hidden');
    renderBoard(ui.overBoard, data.top, data.name);
    ui.overBoardBlock.classList.remove('hidden');
    if (data.rank && data.rank <= 10) message(`#${data.rank} on the board!`, 'ok');
    else if (data.improved) message(`Saved — your best is ${data.best}. Rank #${data.rank}.`, 'ok');
    else message(`Your best is still ${data.best}. Rank #${data.rank}.`, 'ok');
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
document.getElementById('playBtn').addEventListener('click', startGame);
document.getElementById('retryBtn').addEventListener('click', startGame);
ui.sound.addEventListener('click', () => {
  ui.sound.textContent = toggleSound() ? '🔊' : '🔇';
});

/* ------------------------------------------------------------------ input */

function handleMove(dir) {
  if (state === 'ready') { startGame(); return; }
  if (state !== 'playing' || game.dead) return;
  unlock();
  if (pending.length < 3) pending.push(dir);
}

const KEYS = {
  ArrowUp: 'forward', KeyW: 'forward',
  ArrowDown: 'back', KeyS: 'back',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
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
    if (state === 'ready' || state === 'over') startGame();
  }
});

let touchStart = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (state === 'over') return;
  touchStart = { x: e.clientX, y: e.clientY };
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!touchStart || state === 'over') { touchStart = null; return; }
  const dx = e.clientX - touchStart.x;
  const dy = e.clientY - touchStart.y;
  touchStart = null;
  if (Math.hypot(dx, dy) < 26) return handleMove('forward');
  if (Math.abs(dx) > Math.abs(dy)) handleMove(dx > 0 ? 'right' : 'left');
  else handleMove(dy < 0 ? 'forward' : 'back');
});

window.addEventListener('resize', resize);
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const aspect = w / h;
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
  const wantX = THREE.MathUtils.clamp(playerView.mesh.position.x * 0.55, -3.2, 3.2);
  camX += (wantX - camX) * (snap ? 1 : 1 - Math.pow(0.004, dt));

  _target.set(camX, 0, -(game.camAnchor + 2.2) * TILE);
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

function launchEagle() {
  shake = 0.6;
  eagle.visible = true;
  eagle.position.set(game.x - 4, 7, -game.row * TILE - 4);
  eagle.userData.t = 0;
}

function updateEagle(dt) {
  eagle.userData.t += dt;
  const p = playerView.mesh.position;
  _eagleTarget.set(p.x - 0.4, p.y + 0.55, p.z);
  eagle.position.lerp(_eagleTarget, Math.min(1, dt * 7));
  const flap = Math.sin(eagle.userData.t * 26) * 0.5;
  if (eagle.userData.wingL) eagle.userData.wingL.rotation.x = flap;
  if (eagle.userData.wingR) eagle.userData.wingR.rotation.x = -flap;
  if (eagle.userData.t > 3.5) eagle.visible = false;
}

let last = performance.now();
let elapsed = 0;
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  elapsed += dt;

  const wasDead = game.dead;

  if (state === 'playing') {
    acc += dt;
    let steps = 0;
    while (acc >= DT && steps < 8) {          // never spiral after a stall
      const input = pending.length ? pending.shift() : null;
      if (input && inputs.length / 2 < MAX_INPUTS) {
        inputs.push(game.tick, DIRS.indexOf(input));
      }
      game.step(input);
      acc -= DT;
      steps += 1;
      if (game.dead) { pending.length = 0; acc = 0; break; }
    }

    if (!wasDead && game.dead) {
      if (game.cause === 'eagle') launchEagle();
      else if (game.cause === 'car' || game.cause === 'train') shake = 1;
    }

    const score = String(game.maxRow);
    if (ui.score.textContent !== score) ui.score.textContent = score;
    const coins = String(game.coins);
    if (ui.coins.textContent !== coins) ui.coins.textContent = coins;

    if (game.dead) {
      overTimer += dt;
      if (overTimer > 1.15) endGame();
    }
  }

  const alpha = state === 'playing' && !game.dead ? acc / DT : 0;
  const t = (game.tick + alpha) * DT;

  worldView.sync(game.row);
  worldView.update(t, dt, game, game.row);
  playerView.update(game, alpha, dt, elapsed);
  if (eagle.visible) updateEagle(dt);
  updateCamera(dt);
  renderer.render(scene, camera);
}

// Something to look at behind the title card.
worldView.attach(game.world);
worldView.sync(0);
updateCamera(0, true);
requestAnimationFrame((t) => { last = t; frame(t); });

window.__cc = {
  get game() { return game; },
  get inputs() { return inputs; },
  get session() { return session; },
  get state() { return state; },
  world: worldView, player: playerView, camera, scene, renderer,
};
