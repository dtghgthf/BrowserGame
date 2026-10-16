/**
 * Headless balance check: sails every sea area (biome) with a simple bot crew
 * and prints how often the ship survives, how many leaks it took and how full
 * it got. No browser, no players - the "crew" acts directly on the state with
 * human-like delays.
 *
 *   npx tsx scripts/balance.ts            # 12 seeds per biome, average crew
 *   npx tsx scripts/balance.ts 30 slow    # 30 seeds, a slow crew
 */
import {
  BIOMES,
  SIM_DT,
  Simulation,
  predictCourse,
  rockThreat,
  type Biome,
  type GameState,
} from '@lw/shared';

interface Crew {
  name: string;
  /** Seconds until a leak gets patched / a fire put out / a monster driven off. */
  repair: number;
  fire: number;
  fight: number;
  /** Water the crew pumps out per second (m^2). */
  pump: number;
  /** Probability per second that the helmsman notices a rock in the way. */
  steer: number;
}

const CREWS: Record<string, Crew> = {
  good: { name: 'gut', repair: 9, fire: 10, fight: 15, pump: 0.6, steer: 0.8 },
  average: { name: 'mittel', repair: 15, fire: 16, fight: 25, pump: 0.4, steer: 0.45 },
  slow: { name: 'langsam', repair: 25, fire: 25, fight: 40, pump: 0.25, steer: 0.25 },
};

function crewStep(s: GameState, sim: Simulation, crew: Crew, timers: Map<string, number>, dt: number): void {
  const tick = (key: string) => {
    const t = (timers.get(key) ?? 0) + dt;
    timers.set(key, t);
    return t;
  };
  // the helmsman: steers out of the way of spotted rocks (with a reaction delay), back to the line otherwise
  const course = predictCourse(s, sim.tuning, 90);
  const danger = s.rocks.find((r) => r.spotted && !r.hit && r.x - s.ship.x < 90 && rockThreat(r, s.ship.x, course, sim.tuning.gameplay.shipBeam).danger);
  if (danger) {
    if (sim.rand(0, 1) < crew.steer * dt * 4) s.ship.rudder = rockThreat(danger, s.ship.x, course, sim.tuning.gameplay.shipBeam).steer;
  } else s.ship.rudder = Math.max(-1, Math.min(1, -s.ship.heading * 2));
  // leaks, fires, monsters
  for (const l of s.leaks) if (l.active && tick(`leak${l.id}`) > crew.repair) l.active = false;
  if (s.fires.length && tick('fire') > crew.fire) {
    s.fires = [];
    timers.set('fire', 0);
  }
  if (s.monster && s.monster.phase !== 'flee' && tick('monster') > crew.fight) {
    s.monster.phase = 'flee';
    timers.set('monster', 0);
  }
  if (s.pirate && s.pirate.phase !== 'flee' && tick('pirate') > crew.fight) {
    s.pirate.phase = 'flee';
    s.pirate.hook = 0;
    timers.set('pirate', 0);
  }
  // loose cargo is lashed again after a while
  for (const o of s.objects) if ((o.kind === 'crate' || o.kind === 'barrel') && !o.lashed && o.spawn && tick(`cargo${o.id}`) > crew.repair) {
    sim.setLashed(o, true);
    timers.set(`cargo${o.id}`, 0);
  }
  // pumping the fullest compartment
  let fullest = 0;
  s.compartments.forEach((c, i) => {
    if (c.volume > s.compartments[fullest]!.volume) fullest = i;
  });
  sim.addWater(fullest, -crew.pump * dt);
}

async function sail(biome: Biome, seed: number, crew: Crew): Promise<{ survived: boolean; leaks: number; maxWater: number; cargo: number; encounters: string[] }> {
  const sim = await Simulation.create({ seed, mode: 'campaign' });
  const c = sim.state.campaign;
  // force a first-column leg of this biome (with the run modifiers stripped: we measure the sea area)
  const node = c.nodes.find((n) => n.col === 2) ?? c.nodes[0]!;
  node.biome = biome;
  c.modifiers = [];
  c.choice = node.id;
  sim.state.statusTimer = SIM_DT;
  sim.step({});
  const s0 = sim.state;
  const timers = new Map<string, number>();
  let maxWater = 0;
  let cargo = 0;
  const encounters = new Set<string>();
  const { capacity } = sim.waterTotals();
  const limit = (s0.voyage.length / Math.max(0.5, sim.tuning.ship.speed)) * 2.5;
  for (let t = 0; t < limit; t += SIM_DT) {
    const s = sim.state;
    if (s.status !== 'sailing') break;
    crewStep(s, sim, crew, timers, SIM_DT);
    sim.step({});
    cargo += s.events.filter((e) => e.type === 'cargoLoose').length;
    maxWater = Math.max(maxWater, sim.waterTotals().volume / capacity);
    if (s.monster) encounters.add('kraken');
    if (s.pirate) encounters.add('pirates');
    if (s.whirl) encounters.add('whirl');
    if (s.flotsam.length) encounters.add('flotsam');
    if (s.rocks.some((r) => r.kind === 'ice')) encounters.add('ice');
    if (s.fires.length) encounters.add('fire');
  }
  const s = sim.state;
  return { survived: s.status === 'harbor' || s.status === 'arrived', leaks: s.leaks.length, maxWater, cargo, encounters: [...encounters] };
}

const seeds = Number(process.argv[2]) || 12;
const crew = CREWS[process.argv[3] ?? 'average'] ?? CREWS.average!;
console.log(`Bot-Crew "${crew.name}", ${seeds} Seeds pro Meeresart (Etappe 3)\n`);
console.log('Meeresart      überlebt  Lecks Ø  max. Wasser Ø  Ladung los Ø  Begegnungen');
for (const biome of BIOMES) {
  let survived = 0;
  let leaks = 0;
  let water = 0;
  let cargo = 0;
  const seen = new Map<string, number>();
  for (let i = 0; i < seeds; i++) {
    const r = await sail(biome, 1000 + i * 17, crew);
    if (r.survived) survived++;
    leaks += r.leaks;
    water += r.maxWater;
    cargo += r.cargo;
    for (const e of r.encounters) seen.set(e, (seen.get(e) ?? 0) + 1);
  }
  const enc = [...seen].map(([k, n]) => `${k} ${n}`).join(', ');
  console.log(
    `${biome.padEnd(14)} ${`${Math.round((survived / seeds) * 100)} %`.padStart(7)}  ${(leaks / seeds).toFixed(1).padStart(7)}  ${`${Math.round((water / seeds) * 100)} %`.padStart(13)}  ${(cargo / seeds).toFixed(1).padStart(12)}  ${enc}`,
  );
}
