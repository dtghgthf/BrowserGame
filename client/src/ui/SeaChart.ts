import { Container, Graphics } from 'pixi.js';
import { ROCK_LOOKAHEAD, courseLateralAt, predictCourse, rockThreat, type GameState, type Tuning } from '@lw/shared';
import { PixelFont, PixelText } from './PixelFont';

/** Meters to each side of the course shown on the chart. */
const HALF_WIDTH = 13;

const COL = {
  water: 0x0b1a26,
  grid: 0x16303f,
  edge: 0x2c3a4c,
  course: 0xe0b860,
  rock: 0x8a96a6,
  danger: 0xff5a44,
  dangerDim: 0xa8302a,
  kraken: 0xc05a9a,
  ice: 0xa8dcf4,
  whirl: 0x5aa8e6,
  flotsam: 0xe0b860,
  pirate: 0xe8584a,
  ship: 0xf2eee2,
  text: 0xd8dde6,
  dim: 0x7a8696,
  good: 0x6cc070,
};

/**
 * Top-down sea chart ("Seekarte"), drawn like a driving game: the yellow lane
 * in the middle is the way the ship will go with the wheel as it is (the
 * current is included). Everything else is drawn relative to that lane - turn
 * the wheel and the rocks slide sideways. Rocks the searchlight has spotted
 * are grey, rocks inside the lane blink red, an arrow says which way to steer.
 */
export class SeaChart {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly title: PixelText;
  private readonly dist: PixelText;
  private readonly hint: PixelText;
  private readonly legend: PixelText[] = [];

  constructor(font: PixelFont, legend = false) {
    this.title = new PixelText(font, 'SEEKARTE', COL.dim);
    this.dist = new PixelText(font, '', COL.course);
    this.hint = new PixelText(font, '', COL.danger);
    this.root.addChild(this.g, this.title, this.dist, this.hint);
    if (legend) {
      for (const [text, color] of [
        ['GELB = DEIN KURS', COL.course],
        ['ROT = FELS IM WEG', COL.danger],
        ['GOLD = TREIBGUT', COL.flotsam],
      ] as const) {
        const t = new PixelText(font, text, color);
        this.legend.push(t);
        this.root.addChild(t);
      }
    }
  }

  draw(state: GameState, tuning: Readonly<Tuning>, x: number, y: number, w: number, h: number, time: number): void {
    const g = this.g;
    g.clear();
    const ship = state.ship;
    const beam = tuning.gameplay.shipBeam;
    // frame, title row, hint row
    g.rect(x, y, w, h).fill({ color: 0x0b1018, alpha: 0.85 });
    const ax = x + 1;
    const ay = y + 9;
    const aw = w - 2;
    const ah = h - 18;
    g.rect(ax, ay, aw, ah).fill(COL.water);
    g.rect(x, y, w, 1).fill(COL.edge).rect(x, y + h - 1, w, 1).fill(COL.edge).rect(x, y, 1, h).fill(COL.edge).rect(x + w - 1, y, 1, h).fill(COL.edge);
    this.title.position.set(x + 3, y + 2);
    const left = Math.max(0, Math.round(state.voyage.length - ship.x));
    this.dist.text = `${left} M`;
    this.dist.position.set(x + w - 3 - this.dist.textWidth, y + 2);

    const cx = ax + Math.floor(aw / 2);
    const scaleX = aw / 2 / HALF_WIDTH;
    const bottom = ay + ah - 2;
    const course = predictCourse(state, tuning, ROCK_LOOKAHEAD + 10);
    // sideways position relative to the predicted course at that distance
    const toX = (lateral: number, ahead: number) => cx + Math.round((lateral - courseLateralAt(course, ahead)) * scaleX);
    const toY = (ahead: number) => bottom - Math.round((ahead / ROCK_LOOKAHEAD) * (ah - 4));
    const inside = (px: number, py: number) => px >= ax && px < ax + aw && py >= ay && py < ay + ah;

    // distance rings every 40 m
    for (let d = 40; d < ROCK_LOOKAHEAD; d += 40) g.rect(ax, toY(d), aw, 1).fill(COL.grid);

    // the lane the ship will take: straight up the middle
    const half = Math.max(2, Math.round(beam * scaleX));
    g.rect(cx - half, ay, half * 2 + 1, ah).fill({ color: COL.course, alpha: 0.16 });
    for (let py = ay + ((Math.floor(time * 12) % 4) + 4) % 4; py < ay + ah; py += 4) {
      // edge dashes move down like road markings: the ship is moving
      g.rect(cx - half, py, 1, 2).fill({ color: COL.course, alpha: 0.8 });
      g.rect(cx + half, py, 1, 2).fill({ color: COL.course, alpha: 0.8 });
    }

    // rocks (only what the crew has seen)
    let nearest: { ahead: number; steer: -1 | 1 } | null = null;
    let seen = 0;
    const blink = Math.floor(time * 4) % 2 === 0;
    for (const r of state.rocks) {
      if (!r.spotted || r.hit) continue;
      const ahead = r.x - ship.x;
      if (ahead < 0 || ahead > ROCK_LOOKAHEAD) continue;
      seen++;
      const t = rockThreat(r, ship.x, course, beam);
      const px = toX(r.lateral, ahead);
      const py = toY(ahead);
      const size = Math.max(1, Math.round(r.radius * scaleX));
      if (t.danger && (!nearest || ahead < nearest.ahead)) nearest = { ahead, steer: t.steer };
      if (!inside(px, py)) continue;
      const col = t.danger ? (blink ? COL.danger : COL.dangerDim) : r.kind === 'ice' ? COL.ice : COL.rock;
      // a little rock: wider at the bottom
      g.rect(px - size, py, size * 2 + 1, 2).fill(col);
      g.rect(px - Math.max(0, size - 1), py - 1, Math.max(1, size * 2 - 1), 1).fill(col);
      // a little "!" above rocks in the way
      if (t.danger && py - 6 > ay) g.rect(px, py - 6, 1, 2).fill(COL.danger).rect(px, py - 3, 1, 1).fill(COL.danger);
    }

    // a whirlpool: a blue ring, red when the course runs into it
    const wh = state.whirl;
    if (wh && wh.spotted) {
      const ahead = wh.x - ship.x;
      if (ahead > -wh.radius && ahead < ROCK_LOOKAHEAD) {
        const px = toX(wh.lateral, Math.max(0, ahead));
        const py = toY(Math.max(0, ahead));
        const off = wh.lateral - courseLateralAt(course, Math.max(0, ahead));
        const danger = Math.abs(off) < wh.radius * 0.5 + beam;
        if (danger && (!nearest || ahead < nearest.ahead)) nearest = { ahead, steer: off > 0 ? -1 : 1 };
        const rad = Math.max(2, Math.round(wh.radius * 0.6 * scaleX));
        const col = danger && blink ? COL.danger : COL.whirl;
        for (let a = 0; a < 16; a++) {
          const ang = (a / 16) * Math.PI * 2 + time * 2;
          const rr = rad * (0.4 + 0.6 * ((a % 8) / 8));
          const qx = px + Math.round(Math.cos(ang) * rr);
          const qy = py + Math.round(Math.sin(ang) * rr * 0.6);
          if (inside(qx, qy)) g.rect(qx, qy, 1, 1).fill(col);
        }
      }
    }

    // flotsam: gold crates to steer towards
    let target: { ahead: number; off: number } | null = null;
    for (const f of state.flotsam) {
      if (!f.spotted) continue;
      const ahead = f.x - ship.x;
      if (ahead < -2 || ahead > ROCK_LOOKAHEAD) continue;
      const px = toX(f.lateral, Math.max(0, ahead));
      const py = toY(Math.max(0, ahead));
      const off = f.lateral - courseLateralAt(course, Math.max(0, ahead));
      if (ahead > 0 && (!target || ahead < target.ahead)) target = { ahead, off };
      if (inside(px, py)) g.rect(px - 1, py - 1, 3, 3).fill(COL.flotsam).rect(px, py, 1, 1).fill(0x6a4a20);
    }

    // the pirates' sloop ahead
    const pr = state.pirate;
    if (pr && pr.spotted && pr.phase !== 'flee') {
      const py = toY(Math.max(0, pr.offset - 16));
      const col = blink ? COL.pirate : COL.dangerDim;
      g.rect(cx - 3, py + 1, 7, 2).fill(col).rect(cx, py - 4, 1, 5).fill(col).rect(cx + 1, py - 4, 2, 3).fill(0xe6e2d8);
    }

    // the kraken (straight ahead, in the ship's path)
    const m = state.monster;
    if (m && m.spotted && m.phase !== 'flee') {
      const py = toY(Math.max(0, m.offset - 16));
      const col = blink ? COL.kraken : 0x7a2e58;
      g.rect(cx - 2, py - 2, 5, 3).fill(col).rect(cx - 3, py + 1, 1, 2).fill(col).rect(cx - 1, py + 1, 1, 2).fill(col).rect(cx + 1, py + 1, 1, 2).fill(col).rect(cx + 3, py + 1, 1, 2).fill(col);
    }

    // the lighthouse at the end of the course line
    if (left < ROCK_LOOKAHEAD) {
      const lx = cx;
      const ly = toY(left);
      if (inside(lx, ly)) g.rect(lx - 1, ly, 3, 3).fill(COL.course).rect(lx, ly - 2, 1, 2).fill(0xfff0c0);
    }

    // the own ship (bow up)
    g.rect(cx, bottom - 4, 1, 1).fill(COL.ship).rect(cx - 1, bottom - 3, 3, 3).fill(COL.ship).rect(cx - 2, bottom, 5, 1).fill(COL.ship);

    // what to do
    if (nearest) {
      this.hint.text = nearest.steer < 0 ? '< LENKEN' : 'LENKEN >';
      this.hint.setColor(COL.danger);
      this.hint.visible = blink || nearest.ahead > 60;
    } else if (target && Math.abs(target.off) > beam * 0.6) {
      // nothing in the way: steer onto the flotsam to fish it out
      this.hint.text = target.off < 0 ? '< TREIBGUT' : 'TREIBGUT >';
      this.hint.setColor(COL.flotsam);
      this.hint.visible = true;
    } else if (target) {
      this.hint.text = 'TREIBGUT IN DER SPUR';
      this.hint.setColor(COL.flotsam);
      this.hint.visible = true;
    } else {
      this.hint.text = seen > 0 ? 'KURS FREI' : 'NICHTS GESICHTET';
      this.hint.setColor(seen > 0 ? COL.good : COL.dim);
      this.hint.visible = true;
    }
    this.hint.position.set(Math.round(x + w / 2 - this.hint.textWidth / 2), y + h - 8);
    this.legend.forEach((t, i) => t.position.set(x, y + h + 3 + i * 7));
  }
}
