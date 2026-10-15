import { Sprite } from 'pixi.js';
import {
  DEFAULT_TUNING,
  EMPTY_INPUT,
  FixedStepper,
  PIXELS_PER_METER,
  Predictor,
  SIM_DT,
  applyTuningPatch,
  clamp,
  seaSurfaceY,
  shipToWorld,
  type GameEvent,
  type PlayerInput,
  type SimCommand,
  type Simulation,
} from '@lw/shared';
import type { NetLink, NetStatus } from '../net/NetLink';
import { InputSampler } from '../input/InputSampler';
import type { Keyboard } from '../input/Keyboard';
import type { TouchControls } from '../input/TouchControls';
import { frameOf } from '../render/assets';
import type { GameRenderer } from '../render/GameRenderer';
import type { LightDef } from '../render/lighting/LightSystem';
import { Particles } from '../render/Particles';
import { SeaView } from '../render/SeaView';
import { ShipView, type GameAssets } from '../render/ShipView';
import { DebugOverlay, type FrameStats } from '../ui/DebugOverlay';
import { Hud } from '../ui/Hud';
import { StationWidget } from '../ui/StationWidget';
import type { TuningPanel } from '../ui/TuningPanel';
import type { PixelFont } from '../ui/PixelFont';
import { NameTags } from '../ui/NameTags';
import {
  applyCorrections,
  clearCorrections,
  emptyCorrections,
  emptySnapshot,
  interpolate,
  recordCorrection,
  takeSnapshot,
  type Snapshot,
} from './snapshot';

const PPM = PIXELS_PER_METER;

interface LocalPlayer {
  id: string;
  sampler: InputSampler;
  scheme: 'primary' | 'secondary';
}

/** Online state: the connection plus client-side prediction. */
export interface NetState {
  link: NetLink;
  predictor: Predictor;
  status: NetStatus;
  /** Largest correction of the last reconciliation (m), for the debug overlay. */
  correction: number;
}

/** Glues simulation, input and rendering together; owns the main loop. */
export class Game {
  readonly stepper = new FixedStepper(SIM_DT);
  readonly shipView: ShipView;
  readonly sea: SeaView;
  readonly hud: Hud;
  readonly station: StationWidget;
  /** Set by main.ts (F9 / gear button). */
  tuningPanel: TuningPanel | null = null;
  readonly debug: DebugOverlay;
  private readonly spray: Particles;
  private readonly names: NameTags;
  /** Set while playing online (see goOnline). */
  net: NetState | null = null;
  /** Called when an online session ends for good (room closed, reconnect failed). */
  onNetClosed: (reason: string) => void = () => {};
  private readonly corrections = emptyCorrections();
  private readonly before = emptySnapshot();
  private readonly locals: LocalPlayer[] = [];
  private readonly commands: SimCommand[] = [];
  private prev: Snapshot = emptySnapshot();
  private cur: Snapshot = emptySnapshot();
  private view: Snapshot = emptySnapshot();
  private readonly angularStations: Set<number>;
  private camera: { x: number; y: number } | null = null;
  private last = performance.now();
  private time = 0;
  private forcedRollIndex = 0;
  private readonly lighthouse: Sprite;
  private readonly lighthouseGlow: Sprite;
  private readonly lighthouseLight: LightDef;
  private readonly sprayState = [0, 0];
  private stats: FrameStats = { fps: 60, frameMs: 16.7, worstMs: 16.7, steps: 1, dropped: 0, particles: 0, lightPolys: 0, net: '' };
  private fpsFrames = 0;
  private fpsTime = 0;
  private worst = 0;
  /** Exposed for automated tests (Playwright). */
  readonly perf = { frames: 0, samples: [] as number[] };
  /** Automatic quality fallback (disabled when ?quality= is given). */
  autoQuality = true;
  private qualityTime = -2;
  private qualityFrames = 0;
  running = true;

  constructor(
    readonly sim: Simulation,
    readonly r: GameRenderer,
    assets: GameAssets,
    font: PixelFont,
    private readonly keyboard: Keyboard,
    private readonly touch: TouchControls,
    host: HTMLElement,
  ) {
    this.sea = new SeaView(r.albedo.world, r.mask.world);
    this.shipView = new ShipView(r, assets, sim);
    this.spray = new Particles(r.albedo.world, 500);
    this.hud = new Hud(font);
    this.names = new NameTags(font);
    r.hud.addChild(this.names.root);
    this.station = new StationWidget(r, assets.props, font);
    r.hud.addChild(this.station.root);
    r.hud.addChild(this.hud.root);
    this.debug = new DebugOverlay(host, r);
    this.angularStations = new Set(sim.state.stations.filter((s) => s.kind === 'searchlight').map((s) => s.id));

    // distant lighthouse on the horizon (lit silhouette + unlit lamp + rotating beam)
    const lf = frameOf(assets.props, 'lighthouse');
    this.lighthouse = new Sprite(lf.texture);
    this.lighthouse.anchor.set(lf.pivot.x / lf.width, lf.pivot.y / lf.height);
    r.albedo.world.addChildAt(this.lighthouse, 0);
    const gf = frameOf(assets.props, 'lighthouse_glow');
    this.lighthouseGlow = new Sprite(gf.texture);
    this.lighthouseGlow.anchor.set(gf.pivot.x / gf.width, gf.pivot.y / gf.height);
    r.final.world.addChildAt(this.lighthouseGlow, 0);
    this.lighthouseLight = this.shipView.lights.add({
      space: 'world',
      x: 0,
      y: 0,
      color: [1.0, 0.86, 0.62],
      intensity: 0,
      radius: 420,
      height: 60,
      cone: { direction: Math.PI, half: 0.07, soft: 0.004 },
      scatter: 1.1,
      occluded: false,
      enabled: true,
    });

    this.addLocalPlayer('primary');
    takeSnapshot(sim.state, this.prev);
    takeSnapshot(sim.state, this.cur);
    keyboard.onKeyDown((code) => this.onKey(code));
  }

  addLocalPlayer(scheme: LocalPlayer['scheme']): void {
    const id = scheme === 'primary' ? 'p1' : 'p2';
    if (this.locals.some((l) => l.id === id)) return;
    this.sim.addPlayer(id);
    this.locals.push({ id, sampler: new InputSampler(), scheme });
  }

  removeLocalPlayer(id: string): void {
    const i = this.locals.findIndex((l) => l.id === id);
    if (i < 0) return;
    this.locals.splice(i, 1);
    this.sim.removePlayer(id);
  }

  /** Queues a command for the next simulation step (debug keys, tests). Online it goes to the server. */
  command(c: SimCommand): void {
    if (this.net) this.net.link.sendCommand(c);
    else this.commands.push(c);
  }

  /**
   * Switches from local play to an online room. The simulation keeps running
   * here for prediction, but the server's snapshots are the truth.
   */
  goOnline(link: NetLink): void {
    for (const l of this.locals.splice(0)) this.sim.removePlayer(l.id);
    this.commands.length = 0;
    const net: NetState = { link, predictor: new Predictor(this.sim, link.sessionId), status: 'connected', correction: 0 };
    this.net = net;
    this.locals.push({ id: link.sessionId, sampler: new InputSampler(), scheme: 'primary' });
    link.onSnapshot = (m) => net.predictor.receive(m);
    link.onWelcome = (w) => {
      // everybody predicts with the server's numbers
      applyTuningPatch(this.sim.tuning, DEFAULT_TUNING);
      applyTuningPatch(this.sim.tuning, w.tuning);
    };
    link.onTuning = (patch) => applyTuningPatch(this.sim.tuning, patch);
    link.onStatus = (st, reason) => {
      net.status = st;
      if (st === 'closed' && this.net === net) {
        this.goOffline();
        this.onNetClosed(reason ?? '');
      }
    };
    link.start();
  }

  /** Back to local single player (after leaving or losing the room). */
  goOffline(): void {
    if (!this.net) return;
    this.net = null;
    this.locals.length = 0;
    for (const p of [...this.sim.state.players]) this.sim.removePlayer(p.id);
    this.sim.reset();
    this.addLocalPlayer('primary');
    clearCorrections(this.corrections);
    takeSnapshot(this.sim.state, this.prev);
    takeSnapshot(this.sim.state, this.cur);
  }

  private onKey(code: string): void {
    switch (code) {
      case 'F3':
        this.debug.toggle();
        break;
      case 'KeyL':
        this.command({ type: 'debugLeak' });
        break;
      case 'BracketRight':
        this.command({ type: 'seaState', value: this.sim.state.ship.seaState + 0.15 });
        break;
      case 'BracketLeft':
        this.command({ type: 'seaState', value: this.sim.state.ship.seaState - 0.15 });
        break;
      case 'F4': {
        const options = [null, 15, -15, 8];
        this.forcedRollIndex = (this.forcedRollIndex + 1) % options.length;
        const v = options[this.forcedRollIndex]!;
        this.command({ type: 'debugRoll', value: v === null ? null : (v * Math.PI) / 180 });
        break;
      }
      case 'F6':
        this.r.fogEnabled = !this.r.fogEnabled;
        break;
      case 'F2':
        if (this.net) break; // online everybody has their own device
        if (this.locals.some((l) => l.id === 'p2')) this.removeLocalPlayer('p2');
        else this.addLocalPlayer('secondary');
        break;
      case 'F8':
        this.command({ type: 'reset' });
        break;
      case 'F9':
        this.tuningPanel?.toggle();
        break;
      case 'F7': {
        const views = ['final', 'albedo', 'normal', 'light', 'mask'] as const;
        this.r.debugView = views[(views.indexOf(this.r.debugView) + 1) % views.length]!;
        break;
      }
    }
  }

  private readDevices(l: LocalPlayer): PlayerInput {
    const k = this.keyboard;
    const both = (...codes: string[]) => k.isDown(...codes) || k.wasPressed(...codes);
    if (l.scheme === 'primary') {
      const t = this.touch.read();
      const solo = this.locals.length === 1;
      return {
        left: t.left || k.isDown('KeyA') || (solo && k.isDown('ArrowLeft')),
        right: t.right || k.isDown('KeyD') || (solo && k.isDown('ArrowRight')),
        up: t.up || k.isDown('KeyW') || (solo && k.isDown('ArrowUp')),
        down: t.down || k.isDown('KeyS') || (solo && k.isDown('ArrowDown')),
        jump: t.jump || both('Space'),
        interact: t.interact || both('KeyE'),
        pick: t.pick || both('KeyF'),
        target: this.station.target,
      };
    }
    return {
      ...EMPTY_INPUT,
      left: k.isDown('ArrowLeft'),
      right: k.isDown('ArrowRight'),
      up: k.isDown('ArrowUp'),
      down: k.isDown('ArrowDown'),
      jump: both('ShiftRight', 'Numpad0'),
      interact: both('Enter', 'NumpadEnter', 'Numpad1'),
      pick: both('ControlRight', 'Numpad2', 'Period'),
    };
  }

  start(): void {
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  frame(now: number): void {
    const dt = Math.min((now - this.last) / 1000, 0.25);
    this.last = now;
    this.time += dt;
    const t0 = performance.now();

    for (const l of this.locals) l.sampler.setHeld(this.readDevices(l));
    this.keyboard.consumePresses();

    const net = this.net;
    if (net) this.reconcile(net);

    const droppedBefore = this.stepper.droppedSteps;
    const steps = this.stepper.advance(dt, (stepDt) => {
      // online: nothing to predict until the first snapshot has arrived
      if (net && !net.predictor.synced) return;
      takeSnapshot(this.sim.state, this.prev);
      if (net) {
        const l = this.locals[0]!;
        const events = net.predictor.predict(l.sampler.sample(), stepDt);
        l.sampler.consumed();
        this.handleEvents(events);
      } else {
        const inputs: Record<string, PlayerInput> = {};
        for (const l of this.locals) inputs[l.id] = l.sampler.sample();
        this.sim.step(inputs, stepDt, this.commands.splice(0));
        for (const l of this.locals) l.sampler.consumed();
        this.handleEvents(this.sim.state.events);
      }
      takeSnapshot(this.sim.state, this.cur);
    });
    if (net) {
      const out = net.predictor.takeOutgoing();
      if (out) net.link.sendInputs(out);
    }
    interpolate(this.prev, this.cur, this.stepper.alpha, this.angularStations, this.view);
    applyCorrections(this.view, this.corrections, dt);
    this.renderFrame(dt, now);

    // stats
    const ms = performance.now() - t0;
    this.fpsFrames++;
    this.fpsTime += dt;
    this.worst = Math.max(this.worst, dt * 1000);
    this.perf.frames++;
    if (this.fpsTime >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsTime;
      this.perf.samples.push(this.stats.fps);
      if (this.perf.samples.length > 240) this.perf.samples.shift();
      this.stats.worstMs = this.worst;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.worst = 0;
    }
    this.stats.frameMs = this.stats.frameMs * 0.9 + ms * 0.1;
    this.updateAutoQuality(dt);
    this.stats.steps = steps;
    this.stats.dropped += this.stepper.droppedSteps - droppedBefore;
  }

  /** Steps quality down (high -> medium -> low) if the frame rate stays below 50 fps. */
  private updateAutoQuality(dt: number): void {
    if (!this.autoQuality || this.r.quality === 'low' || document.hidden) return;
    this.qualityTime += dt;
    if (this.qualityTime < 0) return; // warm-up
    this.qualityFrames++;
    if (this.qualityTime < 3) return;
    const fps = this.qualityFrames / this.qualityTime;
    this.qualityTime = -1;
    this.qualityFrames = 0;
    if (fps < 50) {
      const next = this.r.quality === 'high' ? 'medium' : 'low';
      console.info(`[quality] ${fps.toFixed(1)} fps -> switching to ${next}`);
      this.r.setQuality(next);
    }
  }

  /** Applies the newest server snapshot; the visible jump is turned into a fading offset. */
  private reconcile(net: NetState): void {
    const wasSynced = net.predictor.synced;
    const events = net.predictor.reconcile();
    if (!events) return;
    takeSnapshot(this.sim.state, this.before);
    if (!wasSynced) {
      takeSnapshot(this.sim.state, this.prev);
      takeSnapshot(this.sim.state, this.cur);
      return;
    }
    // this.cur is what was predicted before; this.before now holds the corrected state
    net.correction = recordCorrection(this.cur, this.before, this.prev, this.corrections);
    takeSnapshot(this.sim.state, this.cur);
    this.handleEvents(events);
  }

  private handleEvents(events: readonly GameEvent[]): void {
    const s = this.sim.state;
    for (const e of events) {
      if (e.type === 'reset') {
        takeSnapshot(s, this.prev);
        clearCorrections(this.corrections);
      } else if (e.type === 'pumpStroke') {
        // a gush of water out of the pump spout
        const st = s.stations[e.station];
        if (!st) continue;
        const local = { x: st.x + 0.75, y: st.y - 0.65 };
        for (let i = 0; i < 6; i++) {
          this.shipView.leakParticles.spawn(local.x * PPM, local.y * PPM, 10 + Math.random() * 25, -5 - Math.random() * 15, 0.5, 0x9cc8e0, s.ship.gravity.x * PPM * 0.5, s.ship.gravity.y * PPM * 0.5, 0.5, st.y * PPM - 1);
        }
      } else if (e.type === 'splash') {
        const w = shipToWorld(s.ship, { x: e.x, y: e.y });
        this.splash(w.x * PPM, seaSurfaceY(w.x, s.time, s.ship.seaState) * PPM, 18 * e.strength);
      }
    }
  }

  private splash(x: number, y: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.spray.spawn(x + (Math.random() - 0.5) * 8, y, (Math.random() - 0.5) * 70, -40 - Math.random() * 90, 0.6 + Math.random() * 0.6, 0xd8ecf4, 0, 260, 0.3, y + 2);
    }
  }

  private renderFrame(dt: number, now: number): void {
    const s = this.sim.state;
    const v = this.view;
    const r = this.r;
    const shipPx = { x: v.ship.x * PPM, y: v.ship.y * PPM };

    // camera: smooth follow of the local player(s), pixel snapped in GameRenderer
    const targets = this.locals
      .map((l) => v.players.get(l.id))
      .filter((p): p is { x: number; y: number } => !!p)
      .map((p) => shipToWorld(v.ship, p));
    let tx = shipPx.x;
    let ty = shipPx.y - 40;
    if (targets.length) {
      tx = (targets.reduce((a, p) => a + p.x, 0) / targets.length) * PPM;
      ty = (targets.reduce((a, p) => a + p.y, 0) / targets.length) * PPM + 18;
    }
    if (!this.camera) this.camera = { x: tx, y: ty };
    const k = 1 - Math.exp(-dt * 5);
    this.camera.x += (tx - this.camera.x) * k;
    this.camera.y += (ty - this.camera.y) * k;
    r.setTransforms(this.camera.x, this.camera.y, shipPx.x, shipPx.y, v.ship.roll);

    const left = r.viewLeft;
    const top = r.viewTop;
    const width = r.layout.width;
    const height = r.layout.height;
    const seaState = s.ship.seaState;
    const surfaceAt = (x: number) => seaSurfaceY(x / PPM, v.time, seaState) * PPM;
    // the far sea band moves slower and with flatter waves
    const farSurfaceAt = (x: number) => seaSurfaceY(x / PPM, v.time * 0.6, seaState) * PPM;
    this.sea.update(left, left + width, top + height + 8, v.time, surfaceAt, farSurfaceAt);

    // lighthouse far away on the horizon, drifting very slowly
    const lx = left + width * 0.86;
    const ly = -34 + 4;
    this.lighthouse.position.set(Math.round(lx), Math.round(ly));
    this.lighthouseGlow.position.set(Math.round(lx), Math.round(ly));
    const phase = this.time * 0.9;
    const beam = Math.cos(phase);
    this.lighthouseLight.x = Math.round(lx);
    this.lighthouseLight.y = Math.round(ly) - 25;
    this.lighthouseLight.cone!.direction = beam > 0 ? Math.PI + 0.06 : 0.06;
    this.lighthouseLight.intensity = 1.3 * Math.pow(Math.abs(Math.sin(phase * 0.5 + 0.3)), 6);
    this.lighthouseGlow.alpha = 0.55 + 0.45 * Math.pow(Math.abs(Math.sin(phase * 0.5 + 0.3)), 4);

    this.updateSpray(dt, v);
    this.shipView.update(s, v, dt);
    const ls = r.lightScale;
    this.shipView.lights.setResolution(r.lightWidth, r.lightHeight, ls);
    const shipRot = v.ship.roll;
    const c = Math.cos(shipRot);
    const sn = Math.sin(shipRot);
    this.shipView.lights.update((space, x, y) => {
      if (space === 'world') return { x: (x - left) * ls, y: (y - top) * ls };
      return { x: (shipPx.x + x * c - y * sn - left) * ls, y: (shipPx.y + x * sn + y * c - top) * ls };
    });
    this.spray.update(dt);
    const ids = this.locals.map((l) => l.id);
    this.station.update(s, v, ids[0]);
    this.names.update(s, v, ids, left, top, this.time);
    this.hud.update(this.sim, s, ids, width, height, this.time, this.net ? { code: this.net.link.code, status: this.net.status, synced: this.net.predictor.synced } : null);
    if (this.touch.isEnabled && ids[0]) {
      const h = this.sim.interactionHints(ids[0]);
      this.touch.setContext(h.interact?.icon ?? null, h.pick?.icon ?? null);
    }
    this.stats.particles = this.spray.count + this.shipView.leakParticles.count;
    this.stats.lightPolys = this.shipView.lights.polygonsComputed;
    this.stats.net = this.net
      ? `NET ${this.net.link.code} ${this.net.status} rtt ${Math.round(this.net.link.rtt)} ms · pending ${this.net.predictor.stats.pending} · replay ${this.net.predictor.stats.replayed} · server tick ${this.net.predictor.stats.serverTick} · korrektur ${(this.net.correction * 100).toFixed(1)} cm · host ${this.net.predictor.host === this.net.link.sessionId ? 'ja' : 'nein'}`
      : '';
    this.debug.update(this.sim, s, this.shipView.lights, this.stats, ids[0] ?? 'p1', now);
    r.render(this.time);
  }

  /** Spray where the bow and stern meet the waves. */
  private updateSpray(dt: number, v: Snapshot): void {
    const s = this.sim.state;
    const ends = [
      { x: 15.6, y: 0.4, dir: 1 },
      { x: -15.8, y: 0.4, dir: -1 },
    ];
    ends.forEach((e, i) => {
      const w = shipToWorld(v.ship, e);
      const surf = seaSurfaceY(w.x, v.time, s.ship.seaState);
      const sub = w.y - surf;
      const rel = (sub - this.sprayState[i]!) / Math.max(dt, 1e-3);
      this.sprayState[i] = sub;
      if (Math.abs(sub) > 1.4) return;
      const rate = clamp(Math.abs(rel) * 14 + (e.dir > 0 ? s.ship.speed * 4 : 2), 0, 90) * s.ship.seaState;
      const n = rate * dt + Math.random();
      for (let k = 0; k < Math.floor(n); k++) {
        const sx = w.x * PPM + e.dir * Math.random() * 6;
        const sy = surf * PPM;
        this.spray.spawn(sx, sy, e.dir * (10 + Math.random() * 50) + s.ship.speed * PPM * 0.15, -30 - Math.random() * (60 + Math.abs(rel) * 25), 0.5 + Math.random() * 0.7, Math.random() > 0.4 ? 0xdcecf2 : 0x9fc4d8, 0, 240, 0.4, sy + 3);
      }
    });
  }
}
