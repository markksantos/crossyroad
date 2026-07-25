// Simulation constants. These are part of the replay contract: changing any of
// them changes what a recorded run scores, so in-flight sessions would replay
// differently. Bump RULES_VERSION when you touch one.

export const RULES_VERSION = 1;

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const HOP_TICKS = 9;              // 0.15s per hop
export const TILE = 1;

export const MIN_COL = -8;
export const MAX_COL = 8;
export const SPAN = 17;                  // traffic wraps at ±SPAN
export const LOOP = SPAN * 2;

export const WATER_LIMIT = 9.2;          // ride a log past this and you're gone
export const EAGLE_MARGIN = 5.5;
export const RETREAT_LIMIT = 8;          // rows you may drop behind your best

export const CAM_FOLLOW = 0.12;          // per-tick ease toward the player
export const SCROLL_START_ROW = 6;
export const SCROLL_BASE = 0.42;         // rows/second, grows with score

export const TRAIN_WARN = 1.5;           // seconds of bell before it arrives
export const TRAIN_SPEED = 24;
export const TRAIN_HALF = 6.4;           // half length of a four-car train

export const PLAYER_HALF = 0.28;
export const MAX_TICKS = TICK_RATE * 60 * 30;   // 30 minutes, replay ceiling
export const MAX_INPUTS = 20000;
