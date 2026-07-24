// Tiny WebAudio synth — no asset files, everything is oscillators.

let ctx = null;
let master = null;
let enabled = localStorage.getItem('cc_sound') !== 'off';

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

// Browsers only allow audio after a gesture; main.js calls this on first input.
export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function isEnabled() {
  return enabled;
}

export function toggle() {
  enabled = !enabled;
  localStorage.setItem('cc_sound', enabled ? 'on' : 'off');
  if (enabled) unlock();
  return enabled;
}

function tone({ freq = 440, to = freq, dur = 0.12, type = 'square', gain = 0.2, delay = 0 }) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.3, gain = 0.25, filter = 900, delay = 0 }) {
  if (!enabled) return;
  const c = ensure();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = filter;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(lp).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  hop:   () => tone({ freq: 520, to: 760, dur: 0.09, type: 'square', gain: 0.13 }),
  bump:  () => tone({ freq: 150, to: 90, dur: 0.09, type: 'square', gain: 0.14 }),
  coin:  () => { tone({ freq: 880, dur: 0.07, type: 'square', gain: 0.16 });
                 tone({ freq: 1320, dur: 0.11, type: 'square', gain: 0.14, delay: 0.07 }); },
  splash:() => { noise({ dur: 0.4, gain: 0.3, filter: 1400 });
                 tone({ freq: 300, to: 120, dur: 0.28, type: 'sine', gain: 0.16 }); },
  crash: () => { noise({ dur: 0.32, gain: 0.4, filter: 700 });
                 tone({ freq: 180, to: 60, dur: 0.3, type: 'sawtooth', gain: 0.2 }); },
  horn:  () => { tone({ freq: 330, dur: 0.16, type: 'sawtooth', gain: 0.14 });
                 tone({ freq: 262, dur: 0.2, type: 'sawtooth', gain: 0.14, delay: 0.16 }); },
  bell:  () => { tone({ freq: 990, dur: 0.13, type: 'triangle', gain: 0.12 });
                 tone({ freq: 990, dur: 0.13, type: 'triangle', gain: 0.12, delay: 0.28 }); },
  screech:() => { noise({ dur: 0.5, gain: 0.22, filter: 2600 }); },
  eagle: () => { tone({ freq: 1200, to: 420, dur: 0.5, type: 'sawtooth', gain: 0.16 }); },
  over:  () => { tone({ freq: 440, to: 415, dur: 0.16, type: 'square', gain: 0.16 });
                 tone({ freq: 330, to: 311, dur: 0.18, type: 'square', gain: 0.16, delay: 0.16 });
                 tone({ freq: 220, to: 180, dur: 0.42, type: 'square', gain: 0.16, delay: 0.34 }); },
  start: () => { tone({ freq: 523, dur: 0.1, type: 'square', gain: 0.14 });
                 tone({ freq: 784, dur: 0.16, type: 'square', gain: 0.14, delay: 0.1 }); },
};
