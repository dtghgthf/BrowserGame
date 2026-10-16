import { Container, Graphics } from 'pixi.js';
import { BIOME_INFO, CAMPAIGN_LEGS, MODIFIER_INFO, currentNode, dailyLabel, nextLegs, type GameState, type Simulation } from '@lw/shared';
import type { NetStatus } from '../net/NetLink';
import { PixelFont, PixelText } from './PixelFont';
import { SeaChart } from './SeaChart';

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

  private readonly chart: SeaChart;

  constructor(private readonly font: PixelFont) {
    this.root.addChild(this.g);
    this.chart = new SeaChart(font);
    this.root.addChild(this.chart.root);
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

  update(
    sim: Simulation,
    state: GameState,
    localIds: readonly string[],
    width: number,
    height: number,
    time: number,
    net: { code: string; status: NetStatus; synced: boolean } | null = null,
  ): void {
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

    // ---- sea chart + distance to the lighthouse
    this.chart.draw(state, sim.tuning, 4, 46, 92, 58, time);
    const prog = Math.min(1, s.x / Math.max(1, state.voyage.length));
    this.g.rect(4, 105, 92, 2).fill(C.edge);
    this.g.rect(4, 105, Math.round(92 * prog), 2).fill(C.gold);

    // ---- stock: wood for the workshop, coins, tools
    const v = state.voyage;
    this.g.rect(4, 109, 92, 9).fill({ color: C.panel, alpha: 0.75 });
    this.text('wood', `HOLZ ${v.timber}`, 7, 111, v.timber > 0 ? C.text : C.warn);
    this.text('coins', `MÜNZEN ${v.coins}`, 44, 111, C.gold);
    this.text('tools', `${v.hammer ? 'H' : ''}${v.crowbar ? 'B' : ''}`, 88, 111, C.dim);

    // ---- the run: leg, sea area, modifiers
    const camp = state.campaign;
    let panelBottom = 118;
    if (camp.mode !== 'single') {
      const cur = currentNode(camp);
      const legNo = state.status === 'harbor' ? camp.leg : camp.leg + 1;
      const where = state.status === 'harbor' ? 'IM HAFEN' : cur ? BIOME_INFO[cur.biome].name.toUpperCase() : '';
      const lines = [`${camp.mode === 'daily' ? 'TAGESFAHRT' : 'ETAPPE'} ${Math.min(legNo, CAMPAIGN_LEGS)}/${CAMPAIGN_LEGS}`, where, ...camp.modifiers.map((m) => MODIFIER_INFO[m].name.toUpperCase())];
      this.g.rect(4, 120, 92, lines.length * 7 + 4).fill({ color: C.panel, alpha: 0.75 });
      lines.forEach((t, i) => this.text(`camp${i}`, t, 7, 122 + i * 7, i === 0 ? C.gold : i === 1 ? C.text : C.dim));
      panelBottom = 120 + lines.length * 7 + 4;
    }

    // ---- warnings (top centre, one line each)
    const warnings: [string, number][] = [];
    const leaks = state.leaks.filter((l) => l.active).length;
    if (leaks > 0) warnings.push([leaks > 1 ? `${leaks} LECKS!` : 'LECK!', C.warn]);
    if (state.fires.length > 0) warnings.push([state.fires.length > 3 ? 'FEUER AN BORD!' : 'FEUER!', 0xff9a40]);
    if (v.waveWarn > 0) warnings.push(['BRECHER! FESTHALTEN!', 0x9ccaf2]);
    if (state.pirate && state.pirate.hook > 0) warnings.push(['ENTERHAKEN AM BUG! KAPPEN!', C.warn]);
    const loose = state.objects.filter((o) => (o.kind === 'crate' || o.kind === 'barrel') && !o.lashed && !o.carriedBy && o.spawn && Math.abs(o.x - o.spawn.x) > 1).length;
    if (loose >= 2) warnings.push(['LADUNG LOS! FESTZURREN!', 0xe0b860]);
    const w = state.whirl;
    const wheel = state.stations.find((st) => st.kind === 'wheel');
    if (w && wheel && !wheel.helper && Math.hypot(w.x - state.ship.x, w.lateral - state.ship.lateral) < w.radius * 1.4) {
      warnings.push(['STRUDEL! ZU ZWEIT ANS STEUERRAD!', 0x9ccaf2]);
    }
    if (state.players.some((p) => p.overboard > 0 && !localIds.includes(p.id)) && state.stations.some((st) => st.kind === 'ring')) {
      warnings.push(['MANN ÜBER BORD! RETTUNGSRING!', C.warn]);
    }
    if (Math.floor(time * 2.5) % 2 === 0 || v.waveWarn > 0) {
      warnings.forEach(([msg, col], i) => this.text(`warn${i}`, msg, Math.round(width / 2 - this.font.measure(msg) / 2), 6 + i * 8, col));
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
      if (hints.interact) parts.push(`[${keyE}] ${hints.interact.label}`);
      if (hints.pick) parts.push(`[${keyF}] ${hints.pick.label}`);
      const line = prefix + parts.join('  ');
      if (parts.length) {
        const w = this.font.measure(line);
        const x = Math.round(width / 2 - w / 2);
        this.g.rect(x - 3, baseY - 2, w + 6, 9).fill({ color: C.panel, alpha: 0.8 });
        this.text(`hint${i}`, line, x, baseY, C.text);
      }
      if (p.action) {
        this.bar(Math.round(width / 2 - 20), baseY - 8, 40, 3, p.action.progress / sim.actionDuration(p.action.kind), C.gold);
      }
      // station controls are drawn by StationWidget (interactive) for the primary player
      if (p.station !== null && i > 0) {
        const st = state.stations[p.station]!;
        this.text(`st${i}`, `P${i + 1}: ${st.kind.toUpperCase()}`, Math.round(width / 2 - 30), baseY - 10, C.gold);
      }
      if (p.overboard > 0) {
        const held = state.ring?.holder === p.id;
        const wait = p.overboard > sim.tuning.gameplay.overboardTime + 0.1;
        const msg = held ? 'FESTHALTEN - SIE ZIEHEN DICH RAN!' : wait ? `MANN ÜBER BORD! ZUM RING SCHWIMMEN (${Math.ceil(p.overboard)})` : 'MANN ÜBER BORD!';
        this.text(`ob${i}`, msg, Math.round(width / 2 - this.font.measure(msg) / 2), Math.round(height / 2) - 20 - i * 10, held ? C.good : C.warn);
      }
    });

    // ---- online: room code (top right) so others can join, connection problems
    if (net) {
      const label = `RAUM ${net.code}`;
      const crew = `${state.players.length}/4 AN BORD`;
      // under the course panel (the top right corner belongs to the menu buttons)
      this.g.rect(4, panelBottom + 2, 92, 17).fill({ color: C.panel, alpha: 0.75 });
      this.text('room', label, 7, panelBottom + 5, C.gold);
      this.text('crew', crew, 7, panelBottom + 12, C.dim);
      const problem = !net.synced ? 'VERBINDE ...' : net.status === 'reconnecting' ? 'VERBINDUNG WEG - VERBINDE NEU ...' : '';
      if (problem && Math.floor(time * 2) % 2 === 0) {
        const pw = this.font.measure(problem);
        this.g.rect(Math.round(width / 2 - pw / 2) - 4, 20, pw + 8, 12).fill({ color: C.panel, alpha: 0.9 });
        this.text('net', problem, Math.round(width / 2 - pw / 2), 23, C.warn);
      }
    }

    // ---- in the harbour: what to do and when the ship casts off
    if (state.status === 'harbor') {
      const legs = nextLegs(camp);
      const chosen = camp.choice >= 0 ? camp.nodes[camp.choice] : legs[0];
      const lines: [string, number][] = [
        [camp.node < 0 ? 'IM HAFEN - GLEICH GEHT ES LOS' : 'IM HAFEN', C.gold],
        [`ABLEGEN IN ${Math.ceil(state.statusTimer)}`, C.text],
        [chosen ? `NÄCHSTE ETAPPE: ${BIOME_INFO[chosen.biome].name.toUpperCase()}` : '', C.text],
        [camp.shop.some((o) => !o.sold) ? 'KARTENTISCH = ROUTE  ·  OBERDECK = HÄNDLER' : 'KARTENTISCH = ROUTE WÄHLEN', C.dim],
      ];
      const w = Math.max(...lines.map(([t]) => this.font.measure(t)));
      const x0 = Math.round(width / 2 - w / 2);
      this.g.rect(x0 - 5, 20, w + 10, lines.length * 8 + 6).fill({ color: C.panel, alpha: 0.85 });
      lines.forEach(([t, col], i) => this.text(`harbor${i}`, t, Math.round(width / 2 - this.font.measure(t) / 2), 23 + i * 8, col));
    }

    if (state.status === 'arrived') {
      const v = state.voyage;
      const lines: [string, number][] = [
        [camp.mode === 'single' ? 'LEUCHTTURM ERREICHT!' : camp.mode === 'daily' ? `TAGESFAHRT ${dailyLabel(new Date())} GESCHAFFT!` : 'KAMPAGNE GESCHAFFT! LEUCHTTURM ERREICHT!', C.gold],
        [`FELSEN: ${v.rocksPassed} UMSCHIFFT  ${v.rocksDestroyed} ZERSCHOSSEN  ${v.rocksHit} GERAMMT`, C.text],
        [`KRAKEN VERJAGT: ${v.monstersRepelled}   LECKS GEFLICKT: ${v.leaksRepaired}`, C.text],
        [`KISTEN GEÖFFNET: ${v.cratesOpened}   TREIBGUT: ${v.flotsamFished}   MÜNZEN: ${v.coins}`, C.text],
        [`FEUER GELÖSCHT: ${v.firesPut}   PIRATEN VERJAGT: ${v.piratesBeaten}   GERETTET: ${v.rescues}`, C.text],
        [`NEUE FAHRT IN ${Math.ceil(state.statusTimer)}`, C.dim],
      ];
      const w = Math.max(...lines.map(([t]) => this.font.measure(t)));
      const x0 = Math.round(width / 2 - w / 2);
      const y0 = Math.round(height / 2) - 30;
      this.g.rect(x0 - 6, y0 - 6, w + 12, lines.length * 10 + 8).fill({ color: C.panel, alpha: 0.9 }).stroke({ color: C.gold, width: 1, pixelLine: true });
      lines.forEach(([t, col], i) => this.text(`arr${i}`, t, Math.round(width / 2 - this.font.measure(t) / 2), y0 + i * 10, col));
    }

    if (state.status === 'sunk') {
      const msg =
        camp.mode === 'single'
          ? `SCHIFF GESUNKEN - NEUSTART IN ${Math.ceil(state.statusTimer)}`
          : `GESUNKEN AUF ETAPPE ${camp.leg + 1}/${CAMPAIGN_LEGS} · ${state.voyage.coins} MÜNZEN · NEUE FAHRT IN ${Math.ceil(state.statusTimer)}`;
      const w = this.font.measure(msg);
      this.g.rect(Math.round(width / 2 - w / 2) - 4, Math.round(height / 2) - 4, w + 8, 13).fill({ color: C.panel, alpha: 0.9 });
      this.text('sunk', msg, Math.round(width / 2 - w / 2), Math.round(height / 2), C.warn);
    }
  }
}
