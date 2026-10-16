import {
  compartmentAtLocal,
  hatchGeometry,
  monsterHead,
  worldToShip,
  type GameEvent,
  type GameState,
  type Simulation,
  type Vec2,
} from '@lw/shared';
import type { AudioEngine } from './AudioEngine';

const STEP_INTERVAL = 0.27;
const LADDER_INTERVAL = 0.32;
const HAMMER_INTERVAL = 0.42;

/**
 * Turns what happens in the game into sound: events (jumps, hatches, cannon,
 * kraken ...) and continuous things (footsteps, hammering, creaking timbers,
 * sea / wind / rain / leak loops). Sounds are quieter and panned by distance to
 * the local player.
 */
export class GameAudio {
  private readonly steps = new Map<string, number>();
  private creakIn = 3;
  private listener: Vec2 = { x: 0, y: 0 };

  constructor(
    readonly engine: AudioEngine,
    private readonly sim: Simulation,
  ) {}

  /** Volume and pan for a sound at a ship-local position. */
  private at(p: Vec2, base = 1, range = 30): { volume: number; pan: number } {
    const dx = p.x - this.listener.x;
    const d = Math.hypot(dx, p.y - this.listener.y);
    return { volume: base * Math.max(0.12, Math.min(1, 1 - d / range)), pan: Math.max(-0.8, Math.min(0.8, dx / 18)) };
  }

  private atWorld(state: GameState, x: number, y: number, base = 1, range = 40): { volume: number; pan: number } {
    return this.at(worldToShip(state.ship, { x, y }), base, range);
  }

  private player(state: GameState, id: string): Vec2 | null {
    return state.players.find((p) => p.id === id) ?? null;
  }

  event(e: GameEvent, state: GameState): void {
    const a = this.engine;
    const rate = () => 0.94 + Math.random() * 0.12;
    switch (e.type) {
      case 'jump': {
        const p = this.player(state, e.player);
        if (p) a.play('jump', { ...this.at(p, 0.7), rate: rate() });
        break;
      }
      case 'land': {
        const p = this.player(state, e.player);
        if (p) a.play('land', { ...this.at(p, Math.min(1, e.speed / 10)), rate: rate() });
        break;
      }
      case 'pickup':
      case 'drop': {
        const p = this.player(state, e.player);
        if (p) a.play(e.type, { ...this.at(p, 0.8), rate: rate() });
        break;
      }
      case 'station':
        if (e.enter) {
          const st = state.stations[e.station];
          if (st) a.play('station', { ...this.at(st, 0.7), rate: rate() });
        }
        break;
      case 'hatch': {
        const def = this.sim.layout.hatches[e.hatch];
        if (def) {
          const g = hatchGeometry(this.sim.layout, def);
          a.play(e.open ? 'hatch_open' : 'hatch_close', { ...this.at({ x: g.x, y: g.top }), rate: rate() });
        }
        break;
      }
      case 'pumpStroke': {
        const st = state.stations[e.station];
        if (st) a.play('pump', { ...this.at(st, 0.8), rate: rate() });
        break;
      }
      case 'leak': {
        const leak = state.leaks[e.leak];
        if (leak) a.play('leak_start', this.at(this.sim.leakInteriorPoint(leak.point), 1, 40));
        break;
      }
      case 'repaired': {
        const leak = state.leaks[e.leak];
        if (leak) a.play('repaired', this.at(this.sim.leakInteriorPoint(leak.point), 1, 40));
        break;
      }
      case 'splash':
        a.play(e.strength >= 1 ? 'splash_big' : 'splash_small', { ...this.at({ x: e.x, y: e.y }, Math.min(1, 0.5 + e.strength * 0.4), 45), rate: rate() });
        break;
      case 'sunk':
        a.play('sink', { volume: 1 });
        break;
      case 'rockHit':
        a.play('rock_hit', { volume: 1, rate: 0.95 + Math.random() * 0.1 });
        break;
      case 'rockBreak':
        a.play('rock_break', this.atWorld(state, e.x, 0, 1, 80));
        break;
      case 'cannonFire':
        a.play('cannon', { ...this.atWorld(state, e.x, e.y, 1, 60), rate: rate() });
        break;
      case 'ballSplash':
        a.play('splash_small', this.atWorld(state, e.x, e.y, 0.9, 80));
        break;
      case 'monsterAppear':
      case 'monsterAttack':
      case 'monsterFlee':
      case 'monsterHit': {
        const h = monsterHead(state);
        const pos = h ? this.atWorld(state, h.x, h.y, 1, 70) : { volume: 0.6, pan: 0.5 };
        if (e.type === 'monsterHit') a.play('kraken_hit', pos);
        else a.play('kraken_roar', { ...pos, rate: e.type === 'monsterFlee' ? 1.25 : e.type === 'monsterAppear' ? 0.85 : 1, volume: pos.volume * (e.type === 'monsterAppear' ? 0.6 : 1) });
        if (e.type === 'monsterFlee') a.play('splash_big', pos);
        break;
      }
      case 'ping':
        a.play('ping', { volume: 0.8 });
        break;
      case 'shout': {
        const p = this.player(state, e.player);
        if (p) a.play('shout', { ...this.at(p, 0.9, 40), rate: 0.9 + (e.key.length % 4) * 0.08 });
        if (e.key === 'land') a.play('foghorn', { volume: 0.7, delay: 0.6 });
        break;
      }
      case 'arrived':
        a.play('arrive', { volume: 0.9 });
        a.play('foghorn', { volume: 0.8, delay: 1.2 });
        break;
      case 'sawStroke': {
        const st = state.stations[e.station];
        if (st) a.play('saw', { ...this.at(st, 0.7), rate: rate() });
        break;
      }
      case 'plankMade': {
        const st = state.stations[e.station];
        if (st) a.play('drop', { ...this.at(st, 0.8), rate: 1.2 });
        break;
      }
      case 'crateOpen': {
        const o = state.objects.find((ob) => ob.id === e.object);
        const pos = o ? this.at(o, 0.9) : { volume: 0.6, pan: 0 };
        a.play('crate_open', { ...pos, rate: rate() });
        if (e.loot.includes('coins')) a.play('coins', { ...pos, delay: 0.5 });
        if (e.loot.includes('rat')) a.play('rat', { ...pos, delay: 0.45 });
        break;
      }
      case 'breakUp': {
        const p = this.player(state, e.player);
        if (p) a.play('rock_break', { ...this.at(p, 0.4), rate: 1.6 });
        break;
      }
      case 'cannonLoad': {
        const st = state.stations[e.station];
        if (st) a.play('cannon_load', { ...this.at(st, 0.8), rate: e.charge >= 2 ? 1.15 : 0.9 });
        break;
      }
      case 'refill': {
        const p = this.player(state, e.player);
        if (p) a.play('glug', this.at(p, 0.8));
        break;
      }
      case 'fire':
        a.play('fire_start', { ...this.at({ x: e.x, y: e.y }, 0.9, 40), rate: rate() });
        break;
      case 'extinguish':
        a.play('steam', { ...this.at({ x: e.x, y: e.y }, 0.9, 40), rate: rate() });
        break;
      case 'bucket': {
        const p = this.player(state, e.player);
        if (p) a.play(e.what === 'scoop' ? 'splash_small' : 'splash_big', { ...this.at(p, e.what === 'scoop' ? 0.6 : 0.8), rate: e.what === 'scoop' ? 1.3 : 1.1 });
        break;
      }
      case 'waveWarn':
        a.play('creak', { volume: 0.8, rate: 0.6 });
        break;
      case 'wave':
        a.play('wave_crash', { volume: 1 });
        break;
      case 'lightning':
        a.play('thunder', { volume: 1, rate: 0.9 + Math.random() * 0.2 });
        break;
      case 'pirateAppear':
        a.play('foghorn', { volume: 0.5, rate: 1.5 });
        break;
      case 'pirateFire':
        a.play('cannon', { ...this.atWorld(state, e.x, e.y, 0.9, 80), rate: 0.8 + Math.random() * 0.1 });
        break;
      case 'pirateHit':
        a.play('rock_break', { volume: 0.8, pan: 0.6, rate: 0.8 });
        break;
      case 'pirateFlee':
        a.play('repaired', { volume: 0.6 });
        break;
      case 'shipHit':
        a.play('rock_hit', { ...this.at({ x: e.x, y: e.y }, 0.8, 50), rate: 1.2 });
        break;
      case 'hook':
        a.play(e.on ? 'hook' : 'hammer', { volume: 0.9, pan: 0.6 });
        break;
      case 'whirlAppear':
        break;
      case 'stow': {
        const p = this.player(state, e.player);
        if (p) a.play(e.into ? 'drop' : 'pickup', this.at(p, 0.8));
        break;
      }
      case 'cargoLoose':
        a.play('rope_snap', this.at({ x: e.x, y: e.y }, 1));
        break;
      case 'lashed': {
        const p = this.player(state, e.player);
        if (p) a.play('rope_tie', this.at(p, 0.9));
        break;
      }
      case 'pumpHot': {
        const st = state.stations[e.station];
        if (st) a.play('steam', this.at(st, 0.6));
        break;
      }
      case 'whirlHit':
      case 'iceHit':
        a.play('rock_hit', { volume: 0.8, rate: e.type === 'iceHit' ? 1.5 : 0.8 });
        break;
      case 'flotsamFished': {
        const p = this.player(state, e.player);
        if (p) a.play('pickup', this.at(p, 1));
        break;
      }
      case 'ringThrow': {
        const p = this.player(state, e.player);
        if (p) a.play('ring_throw', this.at(p, 0.9));
        break;
      }
      case 'ringCatch':
        a.play('splash_small', { volume: 0.7 });
        break;
      case 'rescued':
        a.play('repaired', { volume: 0.9 });
        break;
      case 'harbor':
        a.play('arrive', { volume: 0.7 });
        a.play('coins', { volume: 0.8, delay: 0.8 });
        break;
      case 'depart':
        a.play('foghorn', { volume: 0.6 });
        break;
      case 'chooseLeg':
        a.play('ui_click', { volume: 0.7 });
        break;
      case 'bought':
        a.play('coins', { volume: 0.9 });
        break;
      default:
        break;
    }
  }

  /** Continuous sounds; call once per frame. */
  update(dt: number, state: GameState, listenerId: string | undefined): void {
    const a = this.engine;
    if (!a.ready) return;
    const me = state.players.find((p) => p.id === listenerId);
    this.listener = me ? { x: me.x, y: me.y } : { x: 0, y: -2 };
    const inside = me ? compartmentAtLocal(this.sim.layout, me.x, me.y) >= 0 : false;
    a.setMuffled(inside ? 0.75 : 0);

    // footsteps, ladders, hammering
    for (const p of state.players) {
      if (p.overboard > 0) continue;
      let t = (this.steps.get(p.id) ?? 0) - dt;
      if (p.anim === 'run' && p.grounded) {
        if (t <= 0) {
          a.play('step', { ...this.at(p, 0.55), rate: 0.9 + Math.random() * 0.2 });
          t = STEP_INTERVAL;
        }
      } else if (p.anim === 'climb' && Math.abs(p.vy) > 0.5) {
        if (t <= 0) {
          a.play('ladder', { ...this.at(p, 0.6), rate: 0.9 + Math.random() * 0.2 });
          t = LADDER_INTERVAL;
        }
      } else if (p.action) {
        if (t <= 0) {
          a.play('hammer', { ...this.at(p, 0.8), rate: 0.95 + Math.random() * 0.1 });
          t = HAMMER_INTERVAL;
        }
      } else t = Math.min(t, 0.05);
      this.steps.set(p.id, t);
    }

    // timbers creak more in rough sea
    const sea = state.ship.seaState;
    this.creakIn -= dt * (0.4 + Math.abs(state.ship.rollVel) * 3 + sea * 0.6);
    if (this.creakIn <= 0) {
      this.creakIn = 2 + Math.random() * 4;
      a.play('creak', { volume: (inside ? 0.5 : 0.25) * (0.5 + Math.random() * 0.5), pan: Math.random() * 1.2 - 0.6, rate: 0.8 + Math.random() * 0.4 });
    }

    // ambience
    a.loop('loop_sea', 0.45 + 0.3 * Math.min(1.3, sea));
    a.loop('loop_wind', Math.max(0, Math.min(1, (sea - 0.6) * 1.4)) * 0.8);
    a.loop('loop_rain', Math.max(0, Math.min(1, (sea - 0.9) / 0.4)) * 0.6);
    let leak = 0;
    for (const l of state.leaks) {
      if (!l.active) continue;
      leak += this.at(this.sim.leakInteriorPoint(l.point), Math.min(1, l.inflow * 2 + 0.3), 25).volume;
    }
    a.loop('loop_leak', Math.min(1, leak) * 0.8);
    let fire = 0;
    for (const f of state.fires) {
      const c = { x: (f.tx + 0.5 - this.sim.layout.origin.x) * this.sim.layout.tileSize, y: (f.ty + 0.5 - this.sim.layout.origin.y) * this.sim.layout.tileSize };
      fire += this.at(c, 0.25 + f.heat * 0.35, 25).volume;
    }
    a.loop('loop_fire', Math.min(1, fire) * 0.9);
  }

  thunder(strength: number): void {
    this.engine.play('thunder', { volume: 0.5 + strength * 0.5, delay: 0.25 + Math.random() * 1.4, rate: 0.85 + Math.random() * 0.3 });
  }
}
