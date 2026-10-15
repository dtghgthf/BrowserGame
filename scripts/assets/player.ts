import { Canvas, hex, type RGBA } from './canvas';

/** Frame size of the player sprite sheet. Feet are at the bottom centre (pivot 8,23). */
export const PLAYER_FRAME = { w: 16, h: 24, pivot: { x: 8, y: 23 } };

type Role = 'H' | 'h' | 'S' | 's' | 'E' | 'C' | 'c' | 'k' | 'P' | 'p' | 'B' | 'b' | 'M';

const BASE: Record<Exclude<Role, 'C' | 'c' | 'k'>, RGBA> = {
  H: hex('#e0ad32'),
  h: hex('#a87a1e'),
  S: hex('#e8b890'),
  s: hex('#b98262'),
  E: hex('#1a1418'),
  P: hex('#323a48'),
  p: hex('#232a35'),
  B: hex('#3a2a20'),
  b: hex('#261b15'),
  M: hex('#8a8f98'),
};
/** Coat pixels are stored white/grey in the coat layer and tinted per player at runtime. */
const COAT: Record<'C' | 'c' | 'k', RGBA> = { C: hex('#ffffff'), c: hex('#b8b8b8'), k: hex('#707070') };
/** Untinted preview colour of the coat (used for the combined image the normal map is built from). */
const COAT_PREVIEW: Record<'C' | 'c' | 'k', RGBA> = { C: hex('#3b6ea8'), c: hex('#2c5584'), k: hex('#1d3a5c') };

const HEIGHT: Record<Role, number> = { H: 3, h: 2.5, S: 2.5, s: 2, E: 2, C: 2.5, c: 2, k: 1.8, P: 2, p: 1.6, B: 2, b: 1.6, M: 3 };

interface Leg {
  dx: number;
  lift: number;
}
type Arm =
  | { kind: 'swing'; dx: number }
  | { kind: 'up' }
  | { kind: 'forward' }
  | { kind: 'climb'; high: boolean }
  | { kind: 'hammer'; up: boolean }
  | { kind: 'reach' };

interface Pose {
  bob: number;
  front: Leg;
  back: Leg;
  arm: Arm;
  backArm?: Arm;
}

export interface PlayerFrameImages {
  base: Canvas;
  coat: Canvas;
  full: Canvas;
}

function makeFrame(pose: Pose): PlayerFrameImages {
  const base = new Canvas(PLAYER_FRAME.w, PLAYER_FRAME.h);
  const coat = new Canvas(PLAYER_FRAME.w, PLAYER_FRAME.h);
  const full = new Canvas(PLAYER_FRAME.w, PLAYER_FRAME.h);
  const px = (x: number, y: number, r: Role) => {
    if (r === 'C' || r === 'c' || r === 'k') {
      coat.set(x, y, COAT[r], HEIGHT[r]);
      base.set(x, y, [0, 0, 0, 0]);
      full.set(x, y, COAT_PREVIEW[r], HEIGHT[r]);
    } else {
      base.set(x, y, BASE[r], HEIGHT[r]);
      coat.set(x, y, [0, 0, 0, 0]);
      full.set(x, y, BASE[r], HEIGHT[r]);
    }
  };
  const hline = (x0: number, x1: number, y: number, r: Role) => {
    for (let x = x0; x <= x1; x++) px(x, y, r);
  };
  const b = pose.bob;

  const drawArm = (arm: Arm, back: boolean) => {
    const C: Role = back ? 'c' : 'C';
    const c: Role = back ? 'k' : 'c';
    const hand: Role = back ? 's' : 'S';
    const sx = back ? 6 : 8;
    switch (arm.kind) {
      case 'swing': {
        const dx = arm.dx;
        for (let y = 11; y <= 15; y++) {
          const t = (y - 11) / 4;
          const x = Math.round(sx + dx * t);
          px(x, y + b, C);
          px(x + 1, y + b, c);
        }
        px(Math.round(sx + dx), 16 + b, hand);
        px(Math.round(sx + dx) + 1, 16 + b, hand);
        break;
      }
      case 'up': {
        const x = back ? 3 : 11;
        for (let y = 5; y <= 11; y++) {
          px(x, y + b, C);
          px(x + 1, y + b, c);
        }
        px(x, 4 + b, hand);
        px(x + 1, 4 + b, hand);
        break;
      }
      case 'forward': {
        for (let x = sx; x <= sx + 4; x++) {
          px(x, 11 + b, C);
          px(x, 12 + b, c);
        }
        px(sx + 5, 11 + b, hand);
        px(sx + 5, 12 + b, hand);
        break;
      }
      case 'reach': {
        for (let i = 0; i < 4; i++) {
          px(sx + i, 11 + b - i, C);
          px(sx + i + 1, 11 + b - i, c);
        }
        px(sx + 4, 7 + b, hand);
        px(sx + 5, 7 + b, hand);
        break;
      }
      case 'climb': {
        const top = arm.high ? 5 : 8;
        const x = back ? 6 : 9;
        for (let y = top + 1; y <= 11; y++) {
          px(x, y + b, C);
          px(x + 1, y + b, c);
        }
        px(x, top + b, hand);
        px(x + 1, top + b, hand);
        break;
      }
      case 'hammer': {
        if (arm.up) {
          for (let i = 0; i < 4; i++) px(sx + 1 + i, 11 + b - i, C);
          px(sx + 5, 7 + b, hand);
          // hammer head above the hand
          hline(sx + 4, sx + 7, 5 + b, 'M');
          px(sx + 5, 6 + b, 'b');
        } else {
          for (let x = sx; x <= sx + 4; x++) px(x, 13 + b, C);
          px(sx + 5, 13 + b, hand);
          hline(sx + 6, sx + 6, 12 + b, 'b');
          hline(sx + 6, sx + 7, 14 + b, 'M');
          px(sx + 7, 13 + b, 'M');
        }
        break;
      }
    }
  };

  // back arm first (behind the body)
  if (pose.backArm) drawArm(pose.backArm, true);

  // legs + boots
  const leg = (l: Leg, x0: number, front: boolean) => {
    const r: Role = front ? 'P' : 'p';
    const boot: Role = front ? 'B' : 'b';
    const x = x0 + l.dx;
    for (let y = 18; y <= 20 - l.lift; y++) {
      px(x, y, r);
      px(x + 1, y, r);
    }
    const by = 21 - l.lift;
    hline(x, x + 1, by, boot);
    hline(x, x + 2, by + 1, boot);
    if (l.lift === 0) hline(x, x + 2, by + 2, boot);
    else hline(x, x + 2, by + 1, boot);
  };
  leg(pose.back, 6, false);
  leg(pose.front, 8, true);

  // coat torso + skirt
  for (let y = 10; y <= 15; y++) {
    hline(5, 10, y + b, 'C');
    px(5, y + b, 'c');
  }
  hline(4, 11, 16 + b, 'C');
  hline(4, 11, 17 + b, 'c');
  if (b < 0) hline(4, 11, 18 + b, 'c');
  hline(7, 9, 10 + b, 'c');
  px(9, 12 + b, 'k');
  px(9, 14 + b, 'k');

  // head: face + sou'wester
  hline(7, 10, 7 + b, 'S');
  px(6, 7 + b, 's');
  px(9, 7 + b, 'E');
  hline(6, 11, 8 + b, 'S');
  px(6, 8 + b, 's');
  hline(7, 10, 9 + b, 's');
  hline(6, 9, 3 + b, 'H');
  hline(5, 10, 4 + b, 'H');
  hline(5, 10, 5 + b, 'H');
  px(5, 5 + b, 'h');
  hline(3, 11, 6 + b, 'h');
  px(3, 7 + b, 'h');
  px(4, 7 + b, 'h');

  drawArm(pose.arm, false);
  return { base, coat, full };
}

export interface PlayerSheet {
  frames: PlayerFrameImages[];
  tags: { name: string; from: number; to: number }[];
  durations: number[];
}

export function drawPlayerSheet(): PlayerSheet {
  const frames: PlayerFrameImages[] = [];
  const durations: number[] = [];
  const tags: PlayerSheet['tags'] = [];
  const add = (name: string, poses: Pose[], ms: number) => {
    const from = frames.length;
    for (const p of poses) {
      frames.push(makeFrame(p));
      durations.push(ms);
    }
    tags.push({ name, from, to: frames.length - 1 });
  };
  const L = (dx: number, lift = 0): Leg => ({ dx, lift });
  const runLegs: [Leg, Leg, number][] = [
    [L(2), L(-2), 0],
    [L(1), L(-1, 1), -1],
    [L(0, 1), L(0), -1],
    [L(-2), L(2), 0],
    [L(-1, 1), L(1), -1],
    [L(0), L(0, 1), -1],
  ];

  add('idle', [
    { bob: 0, front: L(1), back: L(-1), arm: { kind: 'swing', dx: 0 } },
    { bob: 1, front: L(1), back: L(-1), arm: { kind: 'swing', dx: 0 } },
  ], 500);
  add('run', runLegs.map(([f, bk, bob]) => ({ bob, front: f, back: bk, arm: { kind: 'swing', dx: -f.dx }, backArm: { kind: 'swing', dx: f.dx } })), 90);
  add('jump', [{ bob: -1, front: L(1, 2), back: L(-2, 1), arm: { kind: 'reach' }, backArm: { kind: 'swing', dx: -2 } }], 100);
  add('fall', [{ bob: 0, front: L(2, 1), back: L(-1), arm: { kind: 'up' }, backArm: { kind: 'up' } }], 100);
  add('climb', [
    { bob: 0, front: L(0, 2), back: L(0), arm: { kind: 'climb', high: true }, backArm: { kind: 'climb', high: false } },
    { bob: 0, front: L(0, 1), back: L(0, 1), arm: { kind: 'climb', high: true }, backArm: { kind: 'climb', high: true } },
    { bob: 0, front: L(0), back: L(0, 2), arm: { kind: 'climb', high: false }, backArm: { kind: 'climb', high: true } },
    { bob: 0, front: L(0, 1), back: L(0, 1), arm: { kind: 'climb', high: true }, backArm: { kind: 'climb', high: true } },
  ], 150);
  add('station', [
    { bob: 0, front: L(1), back: L(-1), arm: { kind: 'forward' }, backArm: { kind: 'forward' } },
    { bob: 1, front: L(1), back: L(-1), arm: { kind: 'forward' }, backArm: { kind: 'forward' } },
  ], 400);
  add('repair', [
    { bob: 0, front: L(2), back: L(-1), arm: { kind: 'hammer', up: true } },
    { bob: 1, front: L(2), back: L(-1), arm: { kind: 'hammer', up: false } },
  ], 160);
  add('swim', [
    { bob: 0, front: L(1, 1), back: L(-1), arm: { kind: 'reach' }, backArm: { kind: 'swing', dx: 2 } },
    { bob: 1, front: L(-1), back: L(1, 1), arm: { kind: 'forward' }, backArm: { kind: 'reach' } },
  ], 250);
  add('carry_idle', [
    { bob: 0, front: L(1), back: L(-1), arm: { kind: 'up' }, backArm: { kind: 'up' } },
    { bob: 1, front: L(1), back: L(-1), arm: { kind: 'up' }, backArm: { kind: 'up' } },
  ], 500);
  add('carry_run', runLegs.map(([f, bk, bob]) => ({ bob, front: f, back: bk, arm: { kind: 'up' }, backArm: { kind: 'up' } })), 110);
  return { frames, tags, durations };
}
