import { Container, Graphics } from 'pixi.js';
import type { GameState, Simulation } from '@lw/shared';
import { PixelFont, PixelText } from './PixelFont';

const C = {
  panel: 0x0b1018,
  edge: 0x2c3a4c,
  text: 0xd8dde6,
  dim: 0x7a8696,
  warn: 0xe8584a,
  water: 0x3d86d6,
  good: 0x6cc070,
  gold: 0xe0b860,
};

/** Low-res pixel HUD: course, water levels, station UI, prompts, warnings. */
export class Hud {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly texts = new Map<string, PixelText>();

  constructor(private readonly font: PixelFont) {
    this.root.addChild(this.g);
  }

  private text(key: string, value: string, x: number, y: number, color = C.text): PixelText {
    let t = this.texts.get(key);
    if (!t) {
      t = new PixelText(this.font, value, color);
      this.texts.set(key, t);
      this.root.addChild(t);
    }
    t.text = value;
    t.setColor(color);
    t.position.set(Math.round(x), Math.round(y));
    t.visible = true;
    return t;
  }

  private bar(x: number, y: number, w: number, h: number, frac: number, color: number, bg = C.panel): void {
    this.g.rect(x - 1, y - 1, w + 2, h + 2).fill(C.edge);
    this.g.rect(x, y, w, h).fill(bg);
    const f = Math.max(0, Math.min(1, frac));
    if (f > 0) this.g.rect(x, y, Math.max(1, Math.round(w * f)), h).fill(color);
  }

  update(sim: Simulation, state: GameState, localIds: readonly string[], width: number, height: number, time: number): void {
    this.g.clear();
    for (const t of this.texts.values()) t.visible = false;
    const s = state.ship;

    // ---- top-left: course + water
    this.g.rect(4, 4, 92, 39).fill({ color: C.panel, alpha: 0.75 });
    this.text('kurs', 'KURS', 7, 7, C.dim);
    const cx = 27;
    const cw = 64;
    this.g.rect(cx, 7, cw, 5).fill(C.edge);
    this.g.rect(cx + cw / 2, 6, 1, 7).fill(C.good);
    const hx = cx + cw / 2 + Math.max(-1, Math.min(1, s.heading / 1.0)) * (cw / 2 - 1);
    this.g.rect(Math.round(hx) - 1, 6, 3, 7).fill(Math.abs(s.heading) > 0.35 ? C.warn : C.gold);
    const ids = ['MD', 'UD'];
    state.compartments.forEach((c, i) => {
      const cap = sim.waterGeometry[i]!.capacity;
      const y = 17 + i * 8;
      this.text(`wl${i}`, ids[i] ?? `R${i + 1}`, 7, y, C.dim);
      this.bar(cx, y, cw - 18, 5, c.volume / cap, c.volume / cap > 0.5 ? C.warn : C.water);
      this.text(`wp${i}`, `${Math.round((c.volume / cap) * 100)}%`, cx + cw - 15, y, C.text);
    });
    const deg = Math.round((s.roll * 180) / Math.PI);
    this.text('roll', `NEIGUNG ${deg > 0 ? '+' : ''}${deg}°`, 7, 34, Math.abs(deg) > 14 ? C.warn : C.dim);

    // ---- leak warning
    const leaks = state.leaks.filter((l) => l.active).length;
    if (leaks > 0 && Math.floor(time * 2.5) % 2 === 0) {
      const msg = leaks > 1 ? `${leaks} LECKS!` : 'LECK!';
      this.text('leak', msg, Math.round(width / 2 - this.font.measure(msg) / 2), 6, C.warn);
    }

    // ---- per local player: station UI, prompts, repair progress
    localIds.forEach((id, i) => {
      const p = state.players.find((pp) => pp.id === id);
      if (!p) return;
      const baseY = height - 14 - i * 22;
      const hints = sim.interactionHints(id);
      const prefix = localIds.length > 1 ? `P${i + 1} ` : '';
      const keyE = i === 0 ? 'E' : 'ENTER';
      const keyF = i === 0 ? 'F' : 'STRG';
      const parts: string[] = [];
      if (hints.interact) parts.push(`[${keyE}] ${hints.interact}`);
      if (hints.pick) parts.push(`[${keyF}] ${hints.pick}`);
      const line = prefix + parts.join('  ');
      if (parts.length) {
        const w = this.font.measure(line);
        const x = Math.round(width / 2 - w / 2);
        this.g.rect(x - 3, baseY - 2, w + 6, 9).fill({ color: C.panel, alpha: 0.8 });
        this.text(`hint${i}`, line, x, baseY, C.text);
      }
      if (p.action) {
        this.bar(Math.round(width / 2 - 20), baseY - 8, 40, 3, p.action.progress / 1.6, C.gold);
      }
      if (p.station !== null) {
        const st = state.stations[p.station]!;
        const px = Math.round(width / 2 - 50);
        const py = baseY - 26;
        this.g.rect(px, py, 100, 20).fill({ color: C.panel, alpha: 0.85 });
        this.g.rect(px, py, 100, 1).fill(C.edge);
        switch (st.kind) {
          case 'wheel': {
            this.text(`st${i}`, 'RUDER  A/D DREHEN', px + 3, py + 3, C.gold);
            this.bar(px + 3, py + 11, 94, 5, 0, C.gold);
            const rx = px + 3 + 47 + Math.round(st.value * 46);
            this.g.rect(rx - 1, py + 10, 3, 7).fill(C.gold);
            this.g.rect(px + 50, py + 11, 1, 5).fill(C.dim);
            break;
          }
          case 'pump': {
            const comp = state.compartments[1];
            const cap = sim.waterGeometry[1]?.capacity ?? 1;
            this.text(`st${i}`, 'PUMPE  A/D IM WECHSEL!', px + 3, py + 3, C.gold);
            this.bar(px + 3, py + 11, 60, 5, (st.value + 1) / 2, C.gold);
            this.bar(px + 68, py + 11, 29, 5, (comp?.volume ?? 0) / cap, C.water);
            break;
          }
          case 'searchlight':
            this.text(`st${i}`, 'SCHEINWERFER', px + 3, py + 3, C.gold);
            this.text(`st2${i}`, 'A/D SCHWENKEN', px + 3, py + 11, C.dim);
            break;
          case 'cannon':
            this.text(`st${i}`, 'KANONE  A/D ZIELEN', px + 3, py + 3, C.gold);
            this.text(`st2${i}`, 'FEUERN: PHASE 4', px + 3, py + 11, C.dim);
            break;
          default:
            break;
        }
      }
      if (p.overboard > 0) {
        const msg = 'MANN ÜBER BORD!';
        this.text(`ob${i}`, msg, Math.round(width / 2 - this.font.measure(msg) / 2), Math.round(height / 2) - 20 - i * 10, C.warn);
      }
    });

    if (state.status === 'sunk') {
      const msg = `SCHIFF GESUNKEN - NEUSTART IN ${Math.ceil(state.statusTimer)}`;
      const w = this.font.measure(msg);
      this.g.rect(Math.round(width / 2 - w / 2) - 4, Math.round(height / 2) - 4, w + 8, 13).fill({ color: C.panel, alpha: 0.9 });
      this.text('sunk', msg, Math.round(width / 2 - w / 2), Math.round(height / 2), C.warn);
    }
  }
}
