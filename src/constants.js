// Shared tuning values for the whole game.

export const TILE = 1;                 // world units per grid cell
export const MIN_COL = -8;             // playable columns, inclusive
export const MAX_COL = 8;
export const DECOR_COL = 15;           // rows are drawn out to here (scenery walls)

export const ROWS_AHEAD = 26;          // rows generated in front of the player
export const ROWS_BEHIND = 12;         // rows kept behind the camera before recycling

export const HOP_TIME = 0.14;          // seconds per hop
export const HOP_HEIGHT = 0.62;

export const WATER_LIMIT = 9.2;        // ride a log past this and you're gone
export const EAGLE_MARGIN = 5.5;       // rows behind the camera before the eagle takes you

export const COLORS = {
  sky:        0xa9e2ff,
  grassLight: 0x7ec86a,
  grassDark:  0x74be61,
  road:       0x45464f,
  roadDark:   0x3e3f47,
  water:      0x3fa9e0,
  waterDark:  0x3a9dd2,
  rail:       0x9c8262,
  log:        0x8a5a37,
  logDark:    0x6f4629,
};

// Vehicle paint jobs — flat, saturated, Crossy-Road-ish.
export const CAR_COLORS = [0xff5a4d, 0xffc93c, 0x4fc3f7, 0xa78bfa, 0xffffff, 0x2dd4a0, 0xff8fab];
export const TRUCK_COLORS = [0xf5f5f5, 0xffd166, 0x8ecae6, 0xef476f];
