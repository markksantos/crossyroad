// Deterministic RNG. Integer ops only (imul/xor/shift), so a given seed
// produces byte-identical output in every JS engine — the browser plays the
// run and the server replays it, and both must agree exactly.

export function xfnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  let s = a | 0;
  return function next() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;   // exact: divisor is 2^32
  };
}

/**
 * A stream for one row. `salt` separates concerns: salt 0 drives gameplay and
 * must never change, salt 1 drives cosmetics, so re-skinning the game can
 * never invalidate an in-flight run.
 */
export function rowRng(seedInt, index, salt = 0) {
  const mixed = (seedInt
    ^ Math.imul(index + 4096, 0x9e3779b1)
    ^ Math.imul(salt + 1, 0x85ebca6b)) | 0;
  return mulberry32(mixed);
}
