import { TileKind, tileKindAt, tileToLocal, type ShipLayout } from '../layout/parseLayout';
import { depthBelowSurface } from '../water';
import type { FireState } from '../state';
import type { SimContext } from './context';

/** Most fire tiles at once (the whole ship ablaze, not a performance problem). */
const MAX_FIRES = 28;

/** A tile fire can burn on: air with a deck / wall top below. */
export function isFloorTile(layout: ShipLayout, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= layout.width || ty >= layout.height - 1) return false;
  const k = tileKindAt(layout, tx, ty);
  if (k === TileKind.Solid || k === TileKind.Hatch) return false;
  const below = tileKindAt(layout, tx, ty + 1);
  return below === TileKind.Solid || below === TileKind.Hatch;
}

/** Ship-local centre of a fire tile. */
export function fireCenter(layout: ShipLayout, f: Pick<FireState, 'tx' | 'ty'>): { x: number; y: number } {
  return tileToLocal(layout, f.tx + 0.5, f.ty + 0.5);
}

/** Lights a fire on the floor at or below a tile. Returns the fire, or null if nothing can burn there. */
export function ignite(ctx: SimContext, tx: number, ty: number, heat = 0.3): FireState | null {
  const L = ctx.layout;
  const s = ctx.state;
  if (s.fires.length >= MAX_FIRES) return null;
  let y = Math.floor(ty);
  const x = Math.floor(tx);
  for (let i = 0; i < 8 && !isFloorTile(L, x, y); i++) y++;
  if (!isFloorTile(L, x, y)) return null;
  if (s.fires.some((f) => f.tx === x && f.ty === y)) return null;
  const f: FireState = { id: ctx.nextId(), tx: x, ty: y, heat, age: 0 };
  s.fires.push(f);
  const c = fireCenter(L, f);
  ctx.emit({ type: 'fire', x: c.x, y: c.y });
  if (s.shouts.fire <= 0) {
    const p = ctx.closestPlayer(c.x, c.y);
    if (p) ctx.say(p, 'fire');
    s.shouts.fire = 12;
  }
  return f;
}

/** Puts out every fire within `radius` m of a ship-local point. Returns how many went out. */
export function douse(ctx: SimContext, x: number, y: number, radius: number): number {
  const s = ctx.state;
  const before = s.fires.length;
  s.fires = s.fires.filter((f) => {
    const c = fireCenter(ctx.layout, f);
    return Math.hypot(c.x - x, c.y - y) > radius;
  });
  const n = before - s.fires.length;
  if (n > 0) {
    s.voyage.firesPut += n;
    ctx.emit({ type: 'extinguish', x, y });
  }
  return n;
}

export function updateFire(ctx: SimContext, dt: number): void {
  const s = ctx.state;
  if (s.fires.length === 0) return;
  const G = ctx.tuning.gameplay;
  const L = ctx.layout;
  const raining = s.ship.seaState > 1.0;
  const out: FireState[] = [];
  for (const f of s.fires) {
    const c = fireCenter(L, f);
    // flooding puts it out, rain slowly on the open deck
    const comp = L.compartmentOf[f.ty * L.width + f.tx]!;
    if (comp >= 0 && depthBelowSurface(ctx.waterGeometry[comp]!, s.compartments[comp]!, c.x, c.y + L.tileSize * 0.3) > 0) {
      s.voyage.firesPut++;
      ctx.emit({ type: 'extinguish', x: c.x, y: c.y });
      continue;
    }
    f.heat = Math.min(1, f.heat + G.fireGrowth * dt - (comp < 0 && raining ? G.rainDouse * dt : 0));
    if (f.heat <= 0) continue;
    f.age += dt;
    out.push(f);
  }
  s.fires = out;

  // spreading along the floor (snapshot: new fires do not spread in the same tick)
  for (const f of [...s.fires]) {
    if (ctx.rand(0, 1) >= f.heat * G.fireSpread * dt) continue;
    const dir = ctx.rand(0, 1) < 0.5 ? -1 : 1;
    for (const dy of [0, -1, 1]) {
      const nx = f.tx + dir;
      const ny = f.ty + dy;
      if (isFloorTile(L, nx, ny) && !s.fires.some((o) => o.tx === nx && o.ty === ny)) {
        ignite(ctx, nx, ny, 0.25);
        break;
      }
    }
  }

  // long fires eat through the hull (or the wood stock) and singe the crew
  for (const f of s.fires) {
    const c = fireCenter(L, f);
    for (const p of s.players) {
      if (p.overboard > 0 || p.station !== null) continue;
      if (Math.abs(p.x - c.x) < 0.35 && Math.abs(p.y - (c.y - 0.5)) < 0.7 && f.heat > 0.5) ctx.knock(p, p.x < c.x ? -3 : 3, -4.5);
    }
    if (f.age < G.fireDamageTime || f.heat < 0.9) continue;
    f.age = 0;
    let best = -1;
    let bd = 3.2;
    for (const lp of L.leakPoints) {
      const d = Math.hypot(lp.tx - f.tx, lp.ty - f.ty);
      if (d < bd && !s.leaks.some((l) => l.point === lp.id && l.active)) {
        bd = d;
        best = lp.id;
      }
    }
    if (best >= 0) ctx.createLeak(best);
    else {
      const ws = s.stations.find((st) => st.kind === 'workshop');
      if (ws && Math.hypot(ws.x - c.x, ws.y - c.y) < 3 && s.voyage.timber > 0) s.voyage.timber--;
    }
  }
}
