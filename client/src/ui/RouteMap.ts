import { Container, Graphics, Sprite } from 'pixi.js';
import { BIOME_INFO, currentNode, nextLegs, type CampaignState } from '@lw/shared';
import { frameOf, type Sheet } from '../render/assets';
import { PLAYER_COLORS } from '../render/ShipView';
import { PixelFont, PixelText } from './PixelFont';

const COL = {
  paper: 0xe8dcc0,
  paperDark: 0xc8b890,
  ink: 0x4a3420,
  inkDim: 0xa08a68,
  route: 0x8a5a32,
  choice: 0xc8352c,
  here: 0x2a6ab0,
};

/**
 * The route of the run as a little sea chart on parchment: one column per leg,
 * sea areas as icons, lines for the ways between them. The ship marks the leg
 * being sailed, the red ring the leg chosen at the chart table.
 */
export class RouteMap {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly icons: Sprite[] = [];
  private readonly title: PixelText;
  private readonly label: PixelText;
  private readonly sub: PixelText;

  constructor(
    private readonly props: Sheet,
    font: PixelFont,
  ) {
    this.title = new PixelText(font, '', COL.ink, null);
    this.label = new PixelText(font, '', COL.ink, null);
    this.sub = new PixelText(font, '', COL.inkDim, null);
    this.root.addChild(this.g, this.title, this.label, this.sub);
  }

  private icon(i: number, name: string): Sprite {
    let s = this.icons[i];
    if (!s) {
      s = new Sprite();
      this.icons[i] = s;
      this.root.addChild(s);
    }
    const f = frameOf(this.props, name);
    s.texture = f.texture;
    s.anchor.set(f.pivot.x / f.width, f.pivot.y / f.height);
    s.visible = true;
    return s;
  }

  /** Screen px of the legs that can be chosen next (same order as `nextLegs`) and of the map, from the last draw. */
  readonly options: { x: number; y: number }[] = [];
  readonly rect = { x: 0, y: 0, w: 0, h: 0 };

  draw(c: CampaignState, x: number, y: number, w: number, h: number, time: number, title = 'ROUTE'): void {
    const g = this.g;
    g.clear();
    this.options.length = 0;
    Object.assign(this.rect, { x, y, w, h });
    for (const s of this.icons) s.visible = false;
    // parchment with a darker rim
    g.rect(x, y, w, h).fill(COL.paperDark);
    g.rect(x + 1, y + 1, w - 2, h - 2).fill(COL.paper);
    this.title.text = title;
    this.title.position.set(x + 4, y + 3);
    if (c.nodes.length === 0) {
      this.label.text = 'EINZELFAHRT';
      this.label.position.set(x + 4, y + 14);
      this.sub.text = '';
      return;
    }
    const cols = Math.max(...c.nodes.map((n) => n.col)) + 1;
    const left = x + 14;
    const right = x + w - 22;
    const top = y + 14;
    const bottom = y + h - 20;
    const colX = (col: number) => Math.round(left + ((col + 1) / (cols + 1)) * (right - left));
    const rowsIn = (col: number) => c.nodes.filter((n) => n.col === col).length;
    const nodeY = (col: number, row: number) => {
      const n = rowsIn(col);
      return Math.round(top + ((row + 1) / (n + 1)) * (bottom - top));
    };
    const pos = (id: number) => {
      const n = c.nodes[id]!;
      return { x: colX(n.col), y: nodeY(n.col, n.row) };
    };
    const cur = currentNode(c);
    const next = nextLegs(c);
    const options = new Set(next.map((n) => n.id));
    for (const n of next) this.options.push(pos(n.id));
    const startX = left - 4;
    const startY = Math.round((top + bottom) / 2);
    const endX = right + 10;

    // dotted ways: from the harbour to the first legs, between legs, from the last leg to the lighthouse
    const dots = (ax: number, ay: number, bx: number, by: number, color: number) => {
      const n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay) / 3));
      for (let i = 1; i < n; i++) g.rect(Math.round(ax + ((bx - ax) * i) / n), Math.round(ay + ((by - ay) * i) / n), 1, 1).fill(color);
    };
    for (const n of c.nodes) {
      const p = pos(n.id);
      if (n.col === 0) dots(startX, startY, p.x, p.y, !cur ? COL.route : COL.inkDim);
      for (const id of n.next) {
        const q = pos(id);
        dots(p.x, p.y, q.x, q.y, cur && cur.id === n.id ? COL.route : COL.inkDim);
      }
      if (n.next.length === 0) dots(p.x, p.y, endX, startY, COL.inkDim);
    }
    // harbour (start) and lighthouse (end)
    g.rect(startX - 2, startY - 2, 4, 4).fill(COL.ink);
    this.icon(0, 'biome_lighthouse').position.set(endX + 2, startY);

    const blink = Math.floor(time * 3) % 2 === 0;
    c.nodes.forEach((n, i) => {
      const p = pos(n.id);
      const done = cur ? n.col < cur.col || n.id === cur.id : false;
      const s = this.icon(i + 1, `biome_${n.biome}`);
      s.position.set(p.x, p.y);
      s.alpha = done || options.has(n.id) || !cur ? 1 : 0.55;
      if (n.id === c.choice && options.has(n.id)) g.circle(p.x, p.y, 7).stroke({ color: COL.choice, width: 1, alpha: blink ? 1 : 0.6, pixelLine: true });
      if (cur && n.id === cur.id) g.rect(p.x - 2, p.y + 6, 5, 2).fill(COL.here).rect(p.x, p.y + 4, 1, 2).fill(COL.here);
      // the crew's votes: a little pointing finger in each voter's coat colour
      c.votes
        .filter((v) => v.node === n.id && options.has(n.id))
        .forEach((v, k) => {
          const fx = p.x + 8 + (k % 2) * 5;
          const fy = p.y - 6 + Math.floor(k / 2) * 6;
          const col = PLAYER_COLORS[v.color % PLAYER_COLORS.length]!;
          g.rect(fx, fy + 1, 4, 3).fill(COL.ink).rect(fx + 1, fy + 2, 2, 1).fill(col).rect(fx - 2, fy + 2, 2, 1).fill(COL.ink);
        });
    });

    // what the selected (or current) leg is
    const show = (c.choice >= 0 ? c.nodes[c.choice] : null) ?? cur;
    if (show) {
      this.label.text = `${BIOME_INFO[show.biome].name.toUpperCase()}  ${show.length} M`;
      this.sub.text = show.next.length === 0 ? 'LETZTE ETAPPE: DER LEUCHTTURM' : `BELOHNUNG ${show.reward} MÜNZEN`;
    } else {
      this.label.text = '';
      this.sub.text = '';
    }
    this.label.position.set(x + 4, y + h - 16);
    this.sub.position.set(x + 4, y + h - 9);
  }
}
