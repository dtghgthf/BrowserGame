import { Container, Graphics } from 'pixi.js';
import { PIXELS_PER_METER, PLAYER_HALF_HEIGHT, type GameState, type Simulation } from '@lw/shared';
import type { GameRenderer } from '../render/GameRenderer';
import type { LightSystem } from '../render/lighting/LightSystem';

const PPM = PIXELS_PER_METER;

export interface FrameStats {
  fps: number;
  frameMs: number;
  worstMs: number;
  steps: number;
  dropped: number;
  particles: number;
  lightPolys: number;
  /** Network line (empty when playing locally). */
  net?: string;
}

/**
 * F3 debug overlay: text panel (DOM, crisp) plus in-world lines drawn into the
 * low-res buffer: Rapier colliders, ladder zones, water surfaces, gravity
 * vector and light polygons.
 */
export class DebugOverlay {
  enabled = false;
  private readonly panel: HTMLPreElement;
  private readonly shipG = new Graphics();
  private readonly worldG = new Graphics();
  private readonly layer = new Container();
  private lastText = 0;

  constructor(host: HTMLElement, private readonly r: GameRenderer) {
    this.panel = document.createElement('pre');
    this.panel.className = 'debug-panel';
    this.panel.style.display = 'none';
    host.appendChild(this.panel);
    r.final.ship.addChild(this.shipG);
    r.final.world.addChild(this.worldG);
    this.layer.visible = false;
  }

  toggle(): void {
    this.enabled = !this.enabled;
    this.panel.style.display = this.enabled ? 'block' : 'none';
    document.body.classList.toggle('debug-open', this.enabled);
    this.shipG.visible = this.enabled;
    this.worldG.visible = this.enabled;
  }

  update(sim: Simulation, state: GameState, lights: LightSystem, stats: FrameStats, localId: string, now: number): void {
    this.shipG.clear();
    this.worldG.clear();
    if (!this.enabled) return;
    const g = this.shipG;

    // Rapier colliders (debug render buffers, ship-local meters)
    const { vertices } = sim.debugLines();
    for (let i = 0; i + 3 < vertices.length; i += 4) {
      g.moveTo(vertices[i]! * PPM, vertices[i + 1]! * PPM).lineTo(vertices[i + 2]! * PPM, vertices[i + 3]! * PPM);
    }
    g.stroke({ color: 0x40ff80, width: 1, alpha: 0.9, pixelLine: true });

    // ladder zones
    for (const l of sim.ladders) g.rect(l.x * PPM - 3, l.top * PPM, 6, (l.bottom - l.top) * PPM);
    g.stroke({ color: 0xffd040, width: 1, alpha: 0.7, pixelLine: true });

    // water surfaces
    state.compartments.forEach((c, i) => {
      if (c.volume <= 0.01) return;
      const geom = sim.waterGeometry[i]!;
      const y0 = (c.surfaceY + c.slope * (geom.xMin - geom.xMid)) * PPM;
      const y1 = (c.surfaceY + c.slope * (geom.xMax - geom.xMid)) * PPM;
      g.moveTo(geom.xMin * PPM, y0).lineTo(geom.xMax * PPM, y1);
      g.moveTo(c.centroidX * PPM, y0 - 4).lineTo(c.centroidX * PPM, y0 + 4);
    });
    g.stroke({ color: 0x40c0ff, width: 1, pixelLine: true });

    // light polygons
    for (const poly of lights.debugPolygons()) {
      const target = poly.space === 'ship' ? g : this.worldG;
      const pts = poly.points;
      if (pts.length < 4) continue;
      target.moveTo(pts[0]!, pts[1]!);
      for (let i = 2; i < pts.length; i += 2) target.lineTo(pts[i]!, pts[i + 1]!);
      target.closePath();
      target.stroke({ color: 0xff60c0, width: 1, alpha: 0.6, pixelLine: true });
      target.circle(poly.x, poly.y, 2).fill(0xffffff);
    }

    // gravity vector at the local player (ship frame)
    const p = state.players.find((pp) => pp.id === localId);
    const grav = state.ship.gravity;
    if (p) {
      const x = p.x * PPM;
      const y = (p.y - PLAYER_HALF_HEIGHT - 0.4) * PPM;
      g.moveTo(x, y).lineTo(x + grav.x * 1.2, y + grav.y * 1.2).stroke({ color: 0xff4040, width: 1, pixelLine: true });
      g.circle(x + grav.x * 1.2, y + grav.y * 1.2, 1.5).fill(0xff4040);
    }

    if (now - this.lastText < 250) return;
    this.lastText = now;
    const s = state.ship;
    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
    const phys = sim.physicsStats();
    const totals = sim.waterTotals();
    const lines = [
      `FPS ${stats.fps.toFixed(1)}  frame ${stats.frameMs.toFixed(2)} ms  worst ${stats.worstMs.toFixed(1)} ms`,
      `sim steps/frame ${stats.steps}  dropped ${stats.dropped}  tick ${state.tick}`,
      `render ${this.r.layout.width}x${this.r.layout.height} x${this.r.layout.scale}  quality ${this.r.quality}  light buffer ${this.r.lightWidth}x${this.r.lightHeight}`,
      `lights ${lights.count}  polys rebuilt ${stats.lightPolys}  particles ${stats.particles}`,
      `rapier bodies ${phys.bodies}  colliders ${phys.colliders}`,
      ...(stats.net ? [stats.net] : []),
      ``,
      `gravity (${grav.x.toFixed(2)}, ${grav.y.toFixed(2)})  |g| ${Math.hypot(grav.x, grav.y).toFixed(2)}  dir ${deg(Math.atan2(grav.x, grav.y))}°`,
      `roll ${deg(s.roll)}°  list ${deg(s.list)}°  heave ${s.y.toFixed(2)} m  sea ${s.seaState.toFixed(2)}`,
      `heading ${deg(s.heading)}°  rudder ${s.rudder.toFixed(2)}  speed ${s.speed.toFixed(2)} m/s`,
      `voyage ${s.x.toFixed(0)} / ${state.voyage.length} m  lateral ${s.lateral.toFixed(1)} m  rocks ${state.rocks.length} (passed ${state.voyage.rocksPassed} hit ${state.voyage.rocksHit} broken ${state.voyage.rocksDestroyed})  next rock ${(state.voyage.nextRockX - s.x).toFixed(0)} m`,
      `kraken ${state.monster ? `${state.monster.phase} +${state.monster.offset.toFixed(1)} m hp ${state.monster.hp}` : '-'}  pirates ${state.pirate ? `${state.pirate.phase} +${state.pirate.offset.toFixed(1)} hp ${state.pirate.hp} hook ${state.pirate.hook.toFixed(1)}` : '-'}  next encounter ${(state.voyage.nextEncounterX - s.x).toFixed(0)} m`,
      `whirl ${state.whirl ? `${(state.whirl.x - s.x).toFixed(0)} m` : '-'}  flotsam ${state.flotsam.length}  fires ${state.fires.length}  ring ${state.ring?.phase ?? '-'}  wave ${state.voyage.waveWarn > 0 ? 'WARN' : state.voyage.waveIn.toFixed(0)}  balls ${state.balls.length}  pings ${state.pings.length}  status ${state.status}`,
      ``,
      `water ${totals.volume.toFixed(2)} / ${totals.capacity.toFixed(1)} m²  sinkage ${s.sinkage.toFixed(2)} m`,
      ...state.compartments.map((c, i) => `  ${sim.layout.compartments[i]!.name.padEnd(11)} ${c.volume.toFixed(2).padStart(6)} m²  slope ${c.slope.toFixed(3)}`),
      ...state.leaks.filter((l) => l.active).map((l) => `  leak #${l.id} inflow ${l.inflow.toFixed(3)} m²/s`),
      ``,
      ...state.players.map((pp) => `${pp.name || pp.id} ${pp.anim.padEnd(7)} (${pp.x.toFixed(2)}, ${pp.y.toFixed(2)}) v(${pp.vx.toFixed(1)}, ${pp.vy.toFixed(1)}) ${pp.grounded ? 'G' : '-'}${pp.climbing !== null ? 'L' : ''} water ${pp.inWater.toFixed(2)}`),
      ``,
      `F3 debug  F7 buffer view (${this.r.debugView})  L leak  [ ] sea  F4 fix roll  F6 fog  F2 2 players  F8 reset  K kraken  J rock  Q ping`,
    ];
    this.panel.textContent = lines.join('\n');
  }
}
