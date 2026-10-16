import {
  DESIGN_LIMITS,
  DESIGN_TEMPLATES,
  TileKind,
  decodeDesign,
  designOrigin,
  encodeDesign,
  normalizeDesign,
  parseLayout,
  validateShipDesign,
  type DesignIssue,
  type ShipDesign,
} from '@lw/shared';
import { drawHull } from '../render/procedural/ship';
import { deleteShip, saveShip, savedShips } from '../ships';

/** What can be painted: map character, German name, cell colour, short label. */
const PALETTE: { ch: string; name: string; color: string; label?: string; group: 'bau' | 'station' | 'ding' }[] = [
  { ch: '#', name: 'Rumpf / Wand', color: '#6a4a30', group: 'bau' },
  { ch: '.', name: 'Innenraum', color: '#2b221b', group: 'bau' },
  { ch: ' ', name: 'Außen (Luft)', color: '#0b1220', group: 'bau' },
  { ch: '|', name: 'Reling', color: '#9a7848', group: 'bau' },
  { ch: '=', name: 'Luke', color: '#c08a40', group: 'bau' },
  { ch: 'H', name: 'Leiter', color: '#5a4026', label: 'H', group: 'bau' },
  { ch: 'x', name: 'Leckstelle', color: '#8a2a22', label: 'x', group: 'bau' },
  { ch: '@', name: 'Startplatz', color: '#2b221b', label: '@', group: 'station' },
  { ch: 'w', name: 'Steuerrad', color: '#2b221b', label: 'W', group: 'station' },
  { ch: 'p', name: 'Pumpe', color: '#2b221b', label: 'P', group: 'station' },
  { ch: 's', name: 'Scheinwerfer', color: '#2b221b', label: 'S', group: 'station' },
  { ch: 'c', name: 'Kanone', color: '#2b221b', label: 'C', group: 'station' },
  { ch: 'u', name: 'Kugelgestell', color: '#2b221b', label: 'U', group: 'station' },
  { ch: 'k', name: 'Werkbank', color: '#2b221b', label: 'K', group: 'station' },
  { ch: 't', name: 'Kartentisch', color: '#2b221b', label: 'T', group: 'station' },
  { ch: 'r', name: 'Rettungsring', color: '#2b221b', label: 'R', group: 'station' },
  { ch: 'l', name: 'Laterne', color: '#2b221b', label: 'L', group: 'ding' },
  { ch: 'b', name: 'Kiste', color: '#2b221b', label: 'b', group: 'ding' },
  { ch: 'f', name: 'Ölfass', color: '#2b221b', label: 'f', group: 'ding' },
  { ch: 'n', name: 'Planke', color: '#2b221b', label: 'n', group: 'ding' },
  { ch: 'o', name: 'Ölkanne', color: '#2b221b', label: 'o', group: 'ding' },
  { ch: 'e', name: 'Eimer', color: '#2b221b', label: 'e', group: 'ding' },
];
const MARKER_COLOR: Record<string, string> = { '@': '#f0e6cc', w: '#e0b860', p: '#5aa8e6', s: '#f0f0a0', c: '#9aa2ae', u: '#7d8590', k: '#c08a52', t: '#e8dcc0', r: '#e05a48', l: '#ffcc66', b: '#a07040', f: '#8a5a32', n: '#c08a52', o: '#d07040', e: '#80b0d0' };
const COMPARTMENT_TINTS = ['#24323e', '#2e2a3c', '#203a30', '#3a2a24', '#2a3a3a'];

type Tool = 'brush' | 'rect' | 'fill';

export interface EditorActions {
  /** Sail this ship alone right now. */
  test(code: string): void;
  /** Use this ship for new voyages (solo and online). */
  use(code: string, name: string): void;
  close(): void;
}

/**
 * The shipyard ("Werft"): paint the ship's ASCII map with the mouse or a
 * finger, see the hull art, the waterline and the rooms, and what is still
 * missing. Ships are saved on the device and shared as links.
 */
export class Editor {
  readonly el: HTMLDivElement;
  private map: string[][] = [];
  private name = 'Mein Schiff';
  private readonly undo: string[][] = [];
  private readonly redo: string[][] = [];
  private tool: Tool = 'brush';
  private brush = '#';
  private mirror = false;
  private showHull = true;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly hullCanvas = document.createElement('canvas');
  private hullDirty = true;
  private hullTimer = 0;
  private cell = 12;
  private drag: { x0: number; y0: number; x1: number; y1: number; pointer: number } | null = null;
  private issues: DesignIssue[] = [];
  private readonly issueList: HTMLUListElement;
  private readonly status: HTMLDivElement;
  private readonly nameInput: HTMLInputElement;
  private readonly wInput: HTMLInputElement;
  private readonly hInput: HTMLInputElement;
  private readonly savedSelect: HTMLSelectElement;

  constructor(
    parent: HTMLElement,
    private readonly actions: EditorActions,
    start: ShipDesign = DESIGN_TEMPLATES.standard,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'editor allow-touch';
    this.el.innerHTML = `
      <div class="ed-top">
        <b class="ed-title">WERFT</b>
        <input class="ed-name" maxlength="${DESIGN_LIMITS.maxName}" spellcheck="false" />
        <select class="ed-template">
          <option value="">Vorlage …</option>
          <option value="standard">Leuchtturmwärter (Standard)</option>
          <option value="kutter">Kutter (klein)</option>
          <option value="fregatte">Fregatte (groß)</option>
          <option value="empty">Leer</option>
        </select>
        <select class="ed-saved"></select>
        <span class="ed-size">Breite <input class="ed-w" type="number" min="${DESIGN_LIMITS.minWidth}" max="${DESIGN_LIMITS.maxWidth}" />
        Höhe <input class="ed-h" type="number" min="${DESIGN_LIMITS.minHeight}" max="${DESIGN_LIMITS.maxHeight}" /></span>
        <span class="ed-spacer"></span>
        <button class="ed-btn ed-close">Schließen</button>
      </div>
      <div class="ed-main">
        <div class="ed-palette"></div>
        <div class="ed-stage"><canvas class="ed-canvas"></canvas></div>
        <div class="ed-side">
          <div class="ed-tools">
            <button class="ed-btn ed-tool" data-tool="brush">Pinsel</button>
            <button class="ed-btn ed-tool" data-tool="rect">Rechteck</button>
            <button class="ed-btn ed-tool" data-tool="fill">Füllen</button>
            <button class="ed-btn ed-mirror">Spiegeln</button>
            <button class="ed-btn ed-hull">Rumpf-Ansicht</button>
            <button class="ed-btn ed-undo">Rückgängig</button>
            <button class="ed-btn ed-redo">Wiederholen</button>
          </div>
          <div class="ed-check"><b>Prüfung</b><ul class="ed-issues"></ul></div>
          <div class="ed-actions">
            <button class="ed-btn ed-save">Speichern</button>
            <button class="ed-btn ed-share">Link teilen</button>
            <button class="ed-btn primary ed-test">Probefahrt</button>
            <button class="ed-btn primary ed-use">Als mein Schiff</button>
            <button class="ed-btn subtle ed-delete">Gespeichertes löschen</button>
          </div>
          <div class="ed-status"></div>
        </div>
      </div>`;
    parent.appendChild(this.el);
    const q = <T extends Element>(s: string) => this.el.querySelector(s) as T;
    this.canvas = q('.ed-canvas');
    this.ctx = this.canvas.getContext('2d')!;
    this.issueList = q('.ed-issues');
    this.status = q('.ed-status');
    this.nameInput = q('.ed-name');
    this.wInput = q('.ed-w');
    this.hInput = q('.ed-h');
    this.savedSelect = q('.ed-saved');

    // palette
    const pal = q<HTMLDivElement>('.ed-palette');
    for (const group of ['bau', 'station', 'ding'] as const) {
      const h = document.createElement('div');
      h.className = 'ed-group';
      h.textContent = group === 'bau' ? 'Bauen' : group === 'station' ? 'Stationen' : 'Dinge';
      pal.appendChild(h);
      for (const p of PALETTE.filter((x) => x.group === group)) {
        const b = document.createElement('button');
        b.className = 'ed-tile';
        b.dataset.ch = p.ch;
        b.innerHTML = `<span class="ed-sw" style="background:${p.label ? MARKER_COLOR[p.ch] ?? p.color : p.color}">${p.label ?? ''}</span>${p.name}`;
        b.addEventListener('click', () => this.setBrush(p.ch));
        pal.appendChild(b);
      }
    }
    this.el.querySelectorAll<HTMLButtonElement>('.ed-tool').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool as Tool)));
    q<HTMLButtonElement>('.ed-mirror').addEventListener('click', () => {
      this.mirror = !this.mirror;
      this.syncButtons();
    });
    q<HTMLButtonElement>('.ed-hull').addEventListener('click', () => {
      this.showHull = !this.showHull;
      this.syncButtons();
      this.draw();
    });
    q<HTMLButtonElement>('.ed-undo').addEventListener('click', () => this.doUndo());
    q<HTMLButtonElement>('.ed-redo').addEventListener('click', () => this.doRedo());
    q<HTMLButtonElement>('.ed-close').addEventListener('click', () => this.actions.close());
    q<HTMLButtonElement>('.ed-save').addEventListener('click', () => {
      saveShip(this.design());
      this.refreshSaved();
      this.say(`„${this.name}“ gespeichert.`);
    });
    q<HTMLButtonElement>('.ed-delete').addEventListener('click', () => {
      deleteShip(this.name);
      this.refreshSaved();
      this.say(`„${this.name}“ aus der Liste gelöscht.`);
    });
    q<HTMLButtonElement>('.ed-share').addEventListener('click', () => void this.share());
    q<HTMLButtonElement>('.ed-test').addEventListener('click', () => {
      if (this.blocked()) return;
      this.actions.test(encodeDesign(this.design()));
    });
    q<HTMLButtonElement>('.ed-use').addEventListener('click', () => {
      if (this.blocked()) return;
      saveShip(this.design());
      this.actions.use(encodeDesign(this.design()), this.name);
    });
    q<HTMLSelectElement>('.ed-template').addEventListener('change', (e) => {
      const v = (e.target as HTMLSelectElement).value;
      (e.target as HTMLSelectElement).value = '';
      if (!v) return;
      this.pushUndo();
      if (v === 'empty') this.load({ name: 'Mein Schiff', map: Array.from({ length: 24 }, () => ' '.repeat(64)) });
      else this.load(DESIGN_TEMPLATES[v as keyof typeof DESIGN_TEMPLATES]);
    });
    this.savedSelect.addEventListener('change', () => {
      const code = this.savedSelect.value;
      this.savedSelect.value = '';
      const s = savedShips().find((x) => x.code === code);
      if (!s) return;
      const d = decodeDesign(s.code);
      if (d) {
        this.pushUndo();
        this.load(d);
      }
    });
    this.nameInput.addEventListener('input', () => (this.name = this.nameInput.value.slice(0, DESIGN_LIMITS.maxName) || 'Mein Schiff'));
    const resize = () => this.resizeMap(Number(this.wInput.value), Number(this.hInput.value));
    this.wInput.addEventListener('change', resize);
    this.hInput.addEventListener('change', resize);

    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.doRedo();
        else this.doUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.doRedo();
      } else if (e.key === 'Escape') this.actions.close();
    });
    window.addEventListener('resize', () => this.layout());

    this.load(start);
    this.setBrush('#');
    this.setTool('brush');
    this.refreshSaved();
    document.body.classList.add('editor-open');
  }

  destroy(): void {
    document.body.classList.remove('editor-open');
    this.el.remove();
  }

  // ---------------------------------------------------------------- model

  private design(): ShipDesign {
    return { name: this.name, map: this.map.map((r) => r.join('')) };
  }

  private load(d: ShipDesign): void {
    const n = normalizeDesign(d);
    this.name = n.name || 'Mein Schiff';
    this.map = n.map.map((r) => [...r]);
    this.nameInput.value = this.name;
    this.changed();
    this.layout();
  }

  private snapshot(): string[] {
    return this.map.map((r) => r.join(''));
  }

  private pushUndo(): void {
    this.undo.push(this.snapshot());
    if (this.undo.length > 100) this.undo.shift();
    this.redo.length = 0;
  }

  private doUndo(): void {
    const prev = this.undo.pop();
    if (!prev) return;
    this.redo.push(this.snapshot());
    this.map = prev.map((r) => [...r]);
    this.changed();
    this.layout();
  }

  private doRedo(): void {
    const next = this.redo.pop();
    if (!next) return;
    this.undo.push(this.snapshot());
    this.map = next.map((r) => [...r]);
    this.changed();
    this.layout();
  }

  private resizeMap(w: number, h: number): void {
    w = Math.max(DESIGN_LIMITS.minWidth, Math.min(DESIGN_LIMITS.maxWidth, Math.round(w) || 0));
    h = Math.max(DESIGN_LIMITS.minHeight, Math.min(DESIGN_LIMITS.maxHeight, Math.round(h) || 0));
    const oh = this.map.length;
    const ow = this.map[0]?.length ?? 0;
    if (w === ow && h === oh) return;
    this.pushUndo();
    // grow / shrink around the middle horizontally, at the top vertically (the keel stays where it is)
    const dx = Math.floor((w - ow) / 2);
    const dy = h - oh;
    const next: string[][] = [];
    for (let y = 0; y < h; y++) {
      const row: string[] = [];
      for (let x = 0; x < w; x++) row.push(this.map[y - dy]?.[x - dx] ?? ' ');
      next.push(row);
    }
    this.map = next;
    this.changed();
    this.layout();
  }

  private set(x: number, y: number, ch: string): void {
    if (y < 0 || y >= this.map.length || x < 0 || x >= this.map[0]!.length) return;
    this.map[y]![x] = ch;
    if (this.mirror) this.map[y]![this.map[0]!.length - 1 - x] = ch;
  }

  private fill(x: number, y: number, ch: string): void {
    const w = this.map[0]!.length;
    const h = this.map.length;
    const from = this.map[y]?.[x];
    if (from === undefined || from === ch) return;
    const stack = [[x, y]];
    let n = 0;
    while (stack.length && n < 5000) {
      const [cx, cy] = stack.pop()!;
      if (cx! < 0 || cy! < 0 || cx! >= w || cy! >= h || this.map[cy!]![cx!] !== from) continue;
      this.map[cy!]![cx!] = ch;
      n++;
      stack.push([cx! + 1, cy!], [cx! - 1, cy!], [cx!, cy! + 1], [cx!, cy! - 1]);
    }
  }

  /** After every edit: re-validate, schedule the hull preview. */
  private changed(): void {
    this.issues = validateShipDesign(this.design());
    this.issueList.innerHTML = '';
    if (this.issues.length === 0) {
      const li = document.createElement('li');
      li.className = 'ok';
      li.textContent = 'Alles seetüchtig!';
      this.issueList.appendChild(li);
    }
    for (const i of this.issues) {
      const li = document.createElement('li');
      li.className = i.level;
      li.textContent = `${i.level === 'error' ? '✖' : '⚠'} ${i.message}`;
      this.issueList.appendChild(li);
    }
    this.wInput.value = String(this.map[0]?.length ?? 0);
    this.hInput.value = String(this.map.length);
    this.hullDirty = true;
    window.clearTimeout(this.hullTimer);
    this.hullTimer = window.setTimeout(() => this.draw(), 250);
    this.draw();
  }

  private blocked(): boolean {
    const errors = this.issues.filter((i) => i.level === 'error');
    if (errors.length === 0) return false;
    this.say(`Noch nicht seetüchtig: ${errors[0]!.message}`, true);
    return true;
  }

  // ---------------------------------------------------------------- input

  private tileAt(e: PointerEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / this.cell), y: Math.floor((e.clientY - r.top) / this.cell) };
  }

  private onDown(e: PointerEvent): void {
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    const t = this.tileAt(e);
    this.pushUndo();
    if (this.tool === 'fill') {
      this.fill(t.x, t.y, this.brush);
      this.changed();
      return;
    }
    this.drag = { x0: t.x, y0: t.y, x1: t.x, y1: t.y, pointer: e.pointerId };
    if (this.tool === 'brush') {
      this.set(t.x, t.y, this.brush);
      this.draw();
    }
  }

  private onMove(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointer) return;
    const t = this.tileAt(e);
    if (this.tool === 'brush') {
      // a line from the last tile, so fast strokes leave no gaps
      const n = Math.max(Math.abs(t.x - this.drag.x1), Math.abs(t.y - this.drag.y1), 1);
      for (let i = 1; i <= n; i++) this.set(Math.round(this.drag.x1 + ((t.x - this.drag.x1) * i) / n), Math.round(this.drag.y1 + ((t.y - this.drag.y1) * i) / n), this.brush);
    }
    this.drag.x1 = t.x;
    this.drag.y1 = t.y;
    this.draw();
  }

  private onUp(e: PointerEvent): void {
    if (!this.drag || e.pointerId !== this.drag.pointer) return;
    if (this.tool === 'rect') {
      const d = this.drag;
      for (let y = Math.min(d.y0, d.y1); y <= Math.max(d.y0, d.y1); y++) for (let x = Math.min(d.x0, d.x1); x <= Math.max(d.x0, d.x1); x++) this.set(x, y, this.brush);
    }
    this.drag = null;
    this.changed();
  }

  private setBrush(ch: string): void {
    this.brush = ch;
    this.el.querySelectorAll<HTMLButtonElement>('.ed-tile').forEach((b) => b.classList.toggle('selected', b.dataset.ch === ch));
  }

  private setTool(t: Tool): void {
    this.tool = t;
    this.syncButtons();
  }

  private syncButtons(): void {
    this.el.querySelectorAll<HTMLButtonElement>('.ed-tool').forEach((b) => b.classList.toggle('selected', b.dataset.tool === this.tool));
    (this.el.querySelector('.ed-mirror') as HTMLButtonElement).classList.toggle('selected', this.mirror);
    (this.el.querySelector('.ed-hull') as HTMLButtonElement).classList.toggle('selected', this.showHull);
  }

  private refreshSaved(): void {
    const list = savedShips();
    this.savedSelect.innerHTML = `<option value="">Gespeichert (${list.length}) …</option>` + list.map((s) => `<option value="${s.code}">${s.name.replace(/</g, '')}</option>`).join('');
  }

  private say(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  private async share(): Promise<void> {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('ship', encodeDesign(this.design()));
    const link = url.toString();
    try {
      await navigator.clipboard.writeText(link);
      this.say('Link kopiert – wer ihn öffnet, segelt dein Schiff.');
    } catch {
      this.say(link);
    }
  }

  // ---------------------------------------------------------------- drawing

  private layout(): void {
    const stage = this.el.querySelector('.ed-stage') as HTMLDivElement;
    const w = this.map[0]?.length ?? 1;
    const h = this.map.length || 1;
    const r = stage.getBoundingClientRect();
    this.cell = Math.max(5, Math.min(22, Math.floor(Math.min((r.width - 8) / w, (r.height - 8) / h))));
    this.canvas.width = w * this.cell;
    this.canvas.height = h * this.cell;
    this.draw();
  }

  private draw(): void {
    const c = this.ctx;
    const cs = this.cell;
    const map = this.map;
    const w = map[0]?.length ?? 0;
    const h = map.length;
    if (w === 0) return;
    const design = this.design();
    const layout = parseLayout(design.map, { origin: designOrigin(design.map) });
    c.fillStyle = '#0b1220';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // the hull as it will look (drawn by the same code as the game)
    if (this.showHull && !this.drag) {
      if (this.hullDirty) {
        try {
          const art = drawHull(layout);
          this.hullCanvas.width = art.w;
          this.hullCanvas.height = art.h;
          const hc = this.hullCanvas.getContext('2d')!;
          const img = hc.createImageData(art.w, art.h);
          img.data.set(art.data);
          hc.putImageData(img, 0, 0);
          this.hullDirty = false;
        } catch {
          /* half-painted ships can confuse the art generator: no preview */
        }
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = map[y]![x]!;
        const kind = layout.tiles[y * w + x];
        let color = PALETTE.find((p) => p.ch === ch)?.color ?? '#ff00ff';
        // air tiles show the room they belong to (inside = tinted per compartment)
        if (kind === TileKind.Interior) {
          const comp = layout.compartmentOf[y * w + x]!;
          color = COMPARTMENT_TINTS[comp % COMPARTMENT_TINTS.length]!;
        } else if (kind === TileKind.Exterior && ch !== ' ') color = '#0b1220';
        c.fillStyle = color;
        c.fillRect(x * cs, y * cs, cs, cs);
      }
    }
    if (this.showHull && !this.hullDirty) {
      c.imageSmoothingEnabled = false;
      c.globalAlpha = 0.85;
      c.drawImage(this.hullCanvas, 0, 0, w * cs, h * cs);
      c.globalAlpha = 1;
    }
    // markers and ladders as letters
    c.font = `bold ${Math.max(7, Math.floor(cs * 0.75))}px monospace`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = map[y]![x]!;
        const p = PALETTE.find((q) => q.ch === ch);
        if (!p?.label) continue;
        c.fillStyle = MARKER_COLOR[ch] ?? '#f0e6cc';
        if (ch === 'H') c.fillStyle = '#d8b878';
        if (ch === 'x') c.fillStyle = '#ff7a6a';
        c.fillText(p.label, x * cs + cs / 2, y * cs + cs / 2 + 1);
      }
    }
    // grid
    if (cs >= 8) {
      c.strokeStyle = 'rgba(255,255,255,0.05)';
      c.beginPath();
      for (let x = 0; x <= w; x++) {
        c.moveTo(x * cs + 0.5, 0);
        c.lineTo(x * cs + 0.5, h * cs);
      }
      for (let y = 0; y <= h; y++) {
        c.moveTo(0, y * cs + 0.5);
        c.lineTo(w * cs, y * cs + 0.5);
      }
      c.stroke();
    }
    // waterline
    const wy = Math.round(layout.origin.y * cs) + 0.5;
    c.strokeStyle = '#5aa8e6';
    c.setLineDash([6, 4]);
    c.beginPath();
    c.moveTo(0, wy);
    c.lineTo(w * cs, wy);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = '#5aa8e6';
    c.textAlign = 'left';
    c.fillText('Wasserlinie', 4, wy - cs * 0.6);
    // problems
    c.strokeStyle = '#ff5a44';
    c.lineWidth = 2;
    for (const i of this.issues) for (const t of i.tiles ?? []) c.strokeRect(t.tx * cs + 1, t.ty * cs + 1, cs - 2, cs - 2);
    c.lineWidth = 1;
    // rectangle being dragged
    if (this.drag && this.tool === 'rect') {
      const d = this.drag;
      c.strokeStyle = '#f0cc72';
      c.strokeRect(Math.min(d.x0, d.x1) * cs + 0.5, Math.min(d.y0, d.y1) * cs + 0.5, (Math.abs(d.x1 - d.x0) + 1) * cs, (Math.abs(d.y1 - d.y0) + 1) * cs);
    }
  }
}
