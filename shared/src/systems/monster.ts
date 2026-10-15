import type { Vec2 } from '../math';
import { seaSurfaceY } from '../sea';
import type { GameState } from '../state';
import { BOW_OFFSET, MONSTER_ATTACK_OFFSET } from './constants';
import type { SimContext } from './context';

/** World position of the kraken's head. */
export function monsterHead(state: Pick<GameState, 'ship' | 'time' | 'monster'>): Vec2 | null {
  const m = state.monster;
  if (!m) return null;
  const x = state.ship.x + m.offset;
  return { x, y: seaSurfaceY(x, state.time, state.ship.seaState) - 1.3 + m.depth * 4 };
}

/** Surfaces the kraken ahead of the ship (does nothing if one is already there). */
export function spawnMonster(ctx: SimContext): void {
  const s = ctx.state;
  if (s.monster) return;
  s.monster = { offset: 55, depth: 1, hp: ctx.tuning.gameplay.monsterHp, phase: 'approach', timer: 0, attackIn: 2, spotted: false, hurt: 0 };
  ctx.emit({ type: 'monsterAppear' });
}

export function updateMonster(ctx: SimContext, dt: number): void {
  const s = ctx.state;
  const G = ctx.tuning.gameplay;
  const m = s.monster;
  if (!m) return;
  m.timer += dt;
  m.hurt = Math.max(0, m.hurt - dt);
  const head = monsterHead(s)!;
  if (!m.spotted && m.depth < 0.6) {
    const light = ctx.searchlightRay();
    if (m.offset < 26 || (light && ctx.inBeam(light, head.x, head.y, 2, G.rockSpotRange))) {
      m.spotted = true;
      const st = s.stations.find((x) => x.kind === 'searchlight');
      const who = (st?.occupant && s.players.find((p) => p.id === st.occupant)) || ctx.closestPlayer(BOW_OFFSET, -1);
      if (who) ctx.say(who, 'monster');
    }
  }
  switch (m.phase) {
    case 'approach':
      m.depth = Math.max(0, m.depth - dt * 0.5);
      m.offset = Math.max(MONSTER_ATTACK_OFFSET, m.offset - G.monsterSpeed * dt);
      if (m.offset <= MONSTER_ATTACK_OFFSET) {
        m.phase = 'attack';
        m.timer = 0;
        m.attackIn = 2.5;
      }
      break;
    case 'attack':
      m.attackIn -= dt;
      if (m.attackIn <= 0) {
        m.attackIn = G.monsterAttackInterval;
        s.ship.rollVel += 0.25;
        ctx.emit({ type: 'monsterAttack' });
        // no planks left to break: it squeezes the hull and water pours in
        if (!ctx.leakAt('bow')) ctx.addWater(s.compartments.length - 1, 0.8);
      }
      break;
    case 'flee':
      m.depth = Math.min(1.2, m.depth + dt * 0.6);
      m.offset += dt * 3;
      if (m.depth >= 1.2) s.monster = null;
      break;
  }
}

export function hitMonster(ctx: SimContext): void {
  const m = ctx.state.monster;
  if (!m) return;
  m.hp--;
  m.hurt = 0.4;
  ctx.emit({ type: 'monsterHit', hp: m.hp });
  if (m.hp <= 0) {
    m.phase = 'flee';
    m.timer = 0;
    ctx.state.voyage.monstersRepelled++;
    ctx.emit({ type: 'monsterFlee' });
  }
}
