import { Canvas, hex, mix, shade, type RGBA } from './canvas';
import type { PropSprite } from './props';

/**
 * Unlit UI sprites: big interactive station controls (steering wheel, pump
 * lever, dial) and the pixel-art touch buttons with their context icons.
 */

const WOOD_L = hex('#b07a46');
const WOOD = hex('#8a5a32');
const WOOD_D = hex('#5e3a1e');
const OUT = hex('#1a0f08');
const BRASS = hex('#c8963c');
const BRASS_L = hex('#f0cc72');
const BRASS_D = hex('#7a5520');
const IRON = hex('#3a3e46');
const IRON_L = hex('#8a929e');
const GLASS = hex('#0e1824');
const PAPER = hex('#efe6cf');

function ring(c: Canvas, cx: number, cy: number, r0: number, r1: number, col: (d: number, a: number) => RGBA): void {
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d >= r0 && d <= r1) c.set(x, y, col(d, Math.atan2(y + 0.5 - cy, x + 0.5 - cx)));
    }
  }
}

/** Large steering wheel for the helm UI (rotated with the rudder). */
function bigWheel(): PropSprite {
  const S = 61;
  const c = new Canvas(S, S);
  const m = 30.5;
  // spokes (8), the top one is the brass "king spoke" that marks rudder amidships
  for (let i = 0; i < 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI * 2;
    for (let r = 4; r <= 29.5; r += 0.25) {
      const x = m + Math.cos(a) * r;
      const y = m + Math.sin(a) * r;
      const handle = r > 24;
      const w = handle ? 1.6 : 1.0;
      for (let dx = -w; dx <= w; dx += 0.5) {
        for (let dy = -w; dy <= w; dy += 0.5) {
          if (dx * dx + dy * dy > w * w) continue;
          const col = i === 0 && handle ? BRASS : handle ? WOOD_L : WOOD;
          c.set(Math.floor(x + dx), Math.floor(y + dy), col);
        }
      }
    }
  }
  // rim, with a brass band at the king spoke
  ring(c, m, m, 18.5, 23, (d, a) => {
    if (Math.abs(a + Math.PI / 2) < 0.12) return BRASS_L;
    return d < 19.5 || d > 22 ? WOOD_D : d < 20.5 ? WOOD_L : WOOD;
  });
  // hub
  c.disc(30, 30, 5, BRASS);
  c.disc(30, 30, 3, BRASS_D);
  c.set(29, 29, BRASS_L);
  c.set(30, 30, OUT);
  c.innerOutline(OUT);
  return { name: 'ui_wheel', canvas: c, pivot: { x: 30, y: 30 } };
}

/** Pump body + lever for the pump UI. */
function bigPump(): PropSprite[] {
  const body = new Canvas(24, 40);
  for (let y = 6; y < 34; y++) {
    for (let x = 6; x < 18; x++) {
      const t = Math.sin(((x - 6 + 0.5) / 12) * Math.PI);
      body.set(x, y, mix(IRON, IRON_L, t * 0.85));
    }
  }
  body.rect(4, 4, 16, 3, IRON_L);
  body.rect(4, 4, 16, 1, hex('#b8c0ca'));
  body.rect(17, 12, 6, 3, IRON);
  body.rect(21, 15, 2, 2, IRON);
  body.rect(1, 34, 22, 6, WOOD);
  body.rect(1, 34, 22, 1, WOOD_L);
  body.rect(11, 1, 2, 4, IRON_L);
  body.innerOutline(OUT);
  const lever = new Canvas(44, 7);
  for (let x = 0; x < 44; x++) {
    lever.set(x, 2, IRON_L);
    lever.set(x, 3, IRON);
  }
  lever.rect(32, 0, 12, 7, WOOD);
  lever.rect(32, 0, 12, 2, WOOD_L);
  lever.disc(4, 3, 3, BRASS);
  lever.set(4, 3, OUT);
  lever.innerOutline(OUT);
  return [
    { name: 'ui_pump', canvas: body, pivot: { x: 12, y: 39 } },
    { name: 'ui_lever', canvas: lever, pivot: { x: 4, y: 3 } },
  ];
}

/** Brass dial with a beam needle for searchlight / cannon aiming. */
function dial(): PropSprite[] {
  const S = 57;
  const c = new Canvas(S, S);
  const m = 28.5;
  ring(c, m, m, 0, 23.5, (d) => mix(GLASS, hex('#1c2c40'), 1 - d / 24));
  ring(c, m, m, 23.5, 27.5, (d) => (d < 24.5 ? BRASS_D : d > 26.5 ? BRASS_D : d < 25.5 ? BRASS_L : BRASS));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const long = i % 3 === 0;
    for (let r = long ? 17 : 20; r <= 22.5; r += 0.5) c.set(Math.floor(m + Math.cos(a) * r), Math.floor(m + Math.sin(a) * r), long ? PAPER : hex('#7d8ca0'));
  }
  // tiny ship silhouette in the middle
  c.rect(23, 29, 11, 2, WOOD_D);
  c.rect(25, 31, 7, 1, WOOD_D);
  c.rect(28, 24, 1, 5, hex('#5a6270'));
  c.innerOutline(OUT);
  const needle = new Canvas(24, 5);
  for (let x = 0; x < 24; x++) {
    const h = x < 4 ? 2 : Math.max(0, Math.round((x - 4) / 9));
    for (let y = 2 - h; y <= 2 + h; y++) needle.set(x, y, x < 4 ? BRASS : hex('#fff2b0'));
  }
  needle.disc(2, 2, 2, BRASS_L);
  return [
    { name: 'ui_dial', canvas: c, pivot: { x: 28, y: 28 } },
    { name: 'ui_needle', canvas: needle, pivot: { x: 2, y: 2 } },
  ];
}

/** Round pixel button frame (normal + pressed). */
function buttons(): PropSprite[] {
  const mk = (name: string, S: number, down: boolean): PropSprite => {
    const c = new Canvas(S, S);
    const m = S / 2;
    ring(c, m, m, 0, m - 0.2, (d, a) => {
      if (d > m - 2.2) {
        // brass rim, lit from the top-left (inverted when pressed)
        const lit = Math.cos(a + Math.PI * 0.75) * (down ? -1 : 1);
        return lit > 0.3 ? BRASS_L : lit < -0.3 ? BRASS_D : BRASS;
      }
      const t = (d / m) * 0.6;
      return down ? shade(hex('#3a2a1c'), 0.8 + t * 0.2) : mix(hex('#4a3422'), hex('#2a1c12'), t);
    });
    c.innerOutline(OUT);
    return { name, canvas: c, pivot: { x: Math.floor(m), y: Math.floor(m) } };
  };
  const stick = new Canvas(34, 34);
  ring(stick, 17, 17, 13, 16.8, (d, a) => {
    const lit = Math.cos(a + Math.PI * 0.75);
    return d > 15.5 || d < 13.8 ? BRASS_D : lit > 0.2 ? BRASS_L : BRASS;
  });
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const x = Math.round(17 + Math.cos(a) * 9.5);
    const y = Math.round(17 + Math.sin(a) * 9.5);
    stick.set(x, y, PAPER);
  }
  stick.innerOutline(OUT);
  const knob = new Canvas(16, 16);
  ring(knob, 8, 8, 0, 7.8, (d, a) => {
    const lit = Math.cos(a + Math.PI * 0.75);
    return d > 6.5 ? BRASS_D : lit > 0.35 && d > 3 ? BRASS_L : BRASS;
  });
  knob.innerOutline(OUT);
  return [
    mk('ui_btn', 24, false),
    mk('ui_btn_down', 24, true),
    mk('ui_btn_big', 30, false),
    mk('ui_btn_big_down', 30, true),
    { name: 'ui_stick_base', canvas: stick, pivot: { x: 17, y: 17 } },
    { name: 'ui_stick_knob', canvas: knob, pivot: { x: 8, y: 8 } },
  ];
}

/** 12x12 context icons for the touch buttons. */
function icons(): PropSprite[] {
  const W = hex('#f2eee2');
  const Y = BRASS_L;
  const B = hex('#5aa8e6');
  const D = hex('#c08a52');
  const R = hex('#e05a48');
  const G = IRON_L;
  const pal: Record<string, RGBA> = { w: W, y: Y, b: B, d: D, r: R, g: G, o: OUT };
  const icon = (name: string, rows: string[]): PropSprite => {
    const c = new Canvas(12, 12);
    c.pattern(0, 0, rows, pal);
    return { name, canvas: c, pivot: { x: 6, y: 6 } };
  };
  return [
    icon('ui_i_jump', ['            ', '     ww     ', '    wwww    ', '   wwwwww   ', '  wwwwwwww  ', '    wwww    ', '    wwww    ', '    wwww    ', '            ', '  wwwwwwww  ', '            ', '            ']),
    icon('ui_i_hand', ['    w w     ', '   wwwww    ', '   wwwwww   ', '   wwwwwww  ', '   wwwwwww  ', ' w wwwwwww  ', ' wwwwwwwww  ', '  wwwwwwww  ', '  wwwwwww   ', '   wwwww    ', '            ', '            ']),
    icon('ui_i_wheel', ['     y      ', '  d  y  d   ', '   dddd     ', '  dd  dd    ', 'yyd yy dyy  ', '  dd  dd    ', '   dddd     ', '  d  y  d   ', '     y      ', '            ', '            ', '            '].map((r) => ` ${r}`.slice(0, 12))),
    icon('ui_i_pump', ['         ', '  gggggggw ', '     g  w  ', '    ggg    ', '    ggg    ', '    gggbb  ', '    ggg b  ', '    ggg    ', '   ddddd   ', '   ddddd   ', '         b ', '        bbb'].map((r) => r.padEnd(12))),
    icon('ui_i_hatch', ['            ', ' dddddddddd ', ' dgdddddgd  ', ' dddddddddd ', ' dgdddddgd  ', ' dddddddddd ', '     yy     ', '     yy     ', '   y yy y   ', '    yyyy    ', '     yy     ', '            ']),
    icon('ui_i_hammer', ['            ', '   gggggg   ', '   gggggg   ', '   gg dd    ', '      dd    ', '      dd    ', '      dd    ', '      dd    ', '  b   dd  b ', '  b       b ', ' bbb     bbb', '            ']),
    icon('ui_i_light', ['            ', '  gggg      ', ' gggggy  y  ', ' ggggwyyy   ', ' ggggwyyyyy ', ' ggggwyyy   ', ' gggggy  y  ', '  gggg      ', '   gg       ', '  gggg      ', '            ', '            ']),
    icon('ui_i_cannon', ['            ', '            ', '        gg  ', '      gggg  ', '    gggggg  ', '  ggggggg   ', ' gggggg     ', '  dgg d     ', ' ddddddd    ', '  o   o     ', '            ', '            ']),
    icon('ui_i_plank', ['            ', '         dd ', '        ddd ', '       ddd  ', '      ddd   ', '     ddd    ', '    ddd     ', '   ddd      ', '  ddd       ', ' ddd        ', ' dd         ', '            ']),
    icon('ui_i_exit', ['            ', ' rr      rr ', '  rr    rr  ', '   rr  rr   ', '    rrrr    ', '     rr     ', '    rrrr    ', '   rr  rr   ', '  rr    rr  ', ' rr      rr ', '            ', '            ']),
    icon('ui_i_grab', ['            ', '  dddddddd  ', '  dgddddgd  ', '  dddddddd  ', '  dgddddgd  ', '  dddddddd  ', '            ', '     ww     ', '    wwww    ', '   wwwwww   ', '     ww     ', '     ww     ']),
    icon('ui_i_drop', ['     ww     ', '     ww     ', '   wwwwww   ', '    wwww    ', '     ww     ', '            ', '  dddddddd  ', '  dgddddgd  ', '  dddddddd  ', '  dgddddgd  ', '  dddddddd  ', '            ']),
    icon('ui_i_fire', ['     y      ', '  y  yy  y  ', '   yyrryy   ', ' yyrrwwrryy ', '  yrwwwwry  ', ' yyrwwwwryy ', '  yrrwwrry  ', '   yyrryy   ', '  y  yy  y  ', '     y      ', '            ', '            ']),
    icon('ui_i_crate', ['            ', '   d    d   ', '    d  d    ', '  dddddddd  ', '  dgddddgd  ', '  dddddddd  ', '  dd dd dd  ', '  dddddddd  ', '  dgddddgd  ', '  dddddddd  ', '            ', '            ']),
    icon('ui_i_ball', ['            ', '            ', '    gggg    ', '   gwgggg   ', '  ggwggggg  ', '  gggggggg  ', '  gggggggg  ', '  gggggggg  ', '   gggggg   ', '    gggg    ', '            ', '            ']),
    icon('ui_i_oil', ['            ', '     y      ', '    yyy     ', '   yyyyy    ', '   yyyyy    ', '  ggggggg   ', '  gdddddg  g', '  gdddddggg ', '  gdddddg   ', '  ggggggg   ', '            ', '            ']),
    icon('ui_i_bucket', ['            ', '  gggggggg  ', ' g        g ', ' g dddddd g ', '  dbbbbbbd  ', '  dddddddd  ', '  gggggggg  ', '  dddddddd  ', '   dddddd   ', '   gggggg   ', '            ', '            ']),
    icon('ui_i_ring', ['            ', '   rrwwrr   ', '  w      w  ', ' r        r ', ' r        r ', ' w        w ', ' w        w ', ' r        r ', ' r        r ', '  w      w  ', '   rrwwrr   ', '            ']),
    icon('ui_i_lash', ['  y      y  ', '  y      y  ', ' dyddddddyd ', ' dyddddddyd ', ' dyddddddyd ', ' dyddddddyd ', ' dyddddddyd ', ' dyddddddyd ', '  y      y  ', ' yyy    yyy ', '            ', '            ']),
    icon('ui_i_ping', ['            ', '    rrrr    ', '   rrwwrr   ', '  rrrwwrrr  ', '  rrrwwrrr  ', '  rrrrrrrr  ', '   rrwwrr   ', '    rrrr    ', '     rr     ', '     rr     ', '      r     ', '            ']),
  ];
}

export function drawUi(): PropSprite[] {
  return [bigWheel(), ...bigPump(), ...dial(), ...buttons(), ...icons()];
}
