import { describe, expect, it } from 'vitest';
import {
  BIOME_INFO,
  CAMPAIGN_LEGS,
  DEFAULT_TUNING,
  EMPTY_INPUT,
  HARBOR_TIME,
  PLAYER_HALF_HEIGHT,
  SHOP_STALLS,
  SIM_DT,
  Simulation,
  createCampaign,
  dailySeed,
  decodeState,
  effectiveTuning,
  encodeState,
  generateRoute,
  nextLegs,
  type GameEvent,
  type PlayerInput,
} from '../src';

const input = (over: Partial<PlayerInput> = {}): PlayerInput => ({ ...EMPTY_INPUT, ...over });

function run(sim: Simulation, seconds: number, inp: () => Record<string, PlayerInput> = () => ({})): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < Math.round(seconds / SIM_DT); i++) {
    sim.step(inp());
    events.push(...sim.state.events);
  }
  return events;
}

function tap(sim: Simulation, id: string, key: keyof PlayerInput): GameEvent[] {
  sim.step({ [id]: input({ [key]: true }) });
  const ev = [...sim.state.events];
  sim.step({ [id]: input() });
  return [...ev, ...sim.state.events];
}

/** A campaign without random encounters or rocks getting in the way. */
async function campaign(seed = 5) {
  const sim = await Simulation.create({
    seed,
    seaState: 0,
    mode: 'campaign',
    tuning: { gameplay: { weightKraken: 0, weightPirates: 0, weightIce: 0, weightWhirl: 0, weightFlotsam: 0, waveEvery: 0, lightningEvery: 0, rockSpacingMin: 1e6, rockSpacingMax: 1e6 } },
  });
  sim.addPlayer('a');
  return sim;
}

function stand(sim: Simulation, x: number, feetY: number): void {
  sim.teleportPlayer('a', x, feetY - PLAYER_HALF_HEIGHT - 0.02);
  run(sim, 0.3);
}

describe('route', () => {
  it('is the same for the same seed, every leg leads on and the lighthouse is reachable from everywhere', () => {
    const a = generateRoute(42);
    expect(generateRoute(42)).toEqual(a);
    expect(generateRoute(43)).not.toEqual(a);
    const cols = Math.max(...a.map((n) => n.col)) + 1;
    expect(cols).toBe(CAMPAIGN_LEGS);
    const last = a.filter((n) => n.col === cols - 1);
    expect(last).toHaveLength(1);
    expect(last[0]!.biome).toBe('storm');
    for (const n of a) {
      if (n.col < cols - 1) expect(n.next.length).toBeGreaterThan(0);
      for (const id of n.next) expect(a[id]!.col).toBe(n.col + 1);
      // reachable from the start
      if (n.col > 0) expect(a.some((m) => m.next.includes(n.id))).toBe(true);
    }
  });

  it('the daily voyage is the same for everybody on a day', () => {
    const d1 = new Date(Date.UTC(2026, 9, 15, 3));
    const d2 = new Date(Date.UTC(2026, 9, 15, 22));
    const d3 = new Date(Date.UTC(2026, 9, 16, 1));
    expect(dailySeed(d1)).toBe(dailySeed(d2));
    expect(dailySeed(d1)).not.toBe(dailySeed(d3));
    const c = createCampaign('daily', dailySeed(d1));
    expect(c.modifiers).toHaveLength(2);
    expect(createCampaign('daily', dailySeed(d2))).toEqual(c);
  });

  it('modifiers, the biome and upgrades change the effective numbers', () => {
    const c = createCampaign('campaign', 9);
    c.modifiers = ['rusty'];
    c.node = c.nodes.find((n) => n.col === 0)!.id;
    c.nodes[c.node]!.biome = 'reef';
    let t = effectiveTuning(DEFAULT_TUNING, c);
    expect(t.gameplay.pumpStroke).toBeCloseTo(DEFAULT_TUNING.gameplay.pumpStroke * 0.72, 6);
    expect(t.gameplay.rockSpacingMax).toBeLessThan(DEFAULT_TUNING.gameplay.rockSpacingMax);
    expect(t.gameplay.voyageLength).toBe(c.nodes[c.node]!.length);
    c.upgrades = ['brassPump'];
    t = effectiveTuning(DEFAULT_TUNING, c);
    expect(t.gameplay.pumpStroke).toBeCloseTo(DEFAULT_TUNING.gameplay.pumpStroke * 0.72 * 1.35, 6);
    expect(Object.keys(BIOME_INFO)).toHaveLength(7);
  });
});

describe('campaign run', () => {
  it('starts in the harbour; the chart table chooses the leg; the timer casts off', async () => {
    const sim = await campaign();
    expect(sim.state.status).toBe('harbor');
    const x0 = sim.state.ship.x;
    run(sim, 2);
    expect(sim.state.ship.x).toBeCloseTo(x0, 1);
    const legs = nextLegs(sim.state.campaign);
    expect(legs.length).toBeGreaterThanOrEqual(2);
    // at the chart table: D picks the next option, F casts off
    const table = sim.state.stations.find((s) => s.kind === 'table')!;
    stand(sim, table.x, table.y);
    tap(sim, 'a', 'interact');
    expect(sim.state.players[0]!.station).toBe(table.id);
    tap(sim, 'a', 'right');
    expect(sim.state.campaign.choice).toBe(legs[1]!.id);
    tap(sim, 'a', 'pick');
    const events = run(sim, 3.5);
    expect(events.some((e) => e.type === 'depart')).toBe(true);
    expect(sim.state.status).toBe('sailing');
    expect(sim.state.campaign.node).toBe(legs[1]!.id);
    expect(sim.state.voyage.length).toBe(legs[1]!.length);
    // the leg's biome is in effect
    expect(sim.tuning.gameplay.voyageLength).toBe(legs[1]!.length);
  });

  it('a leg ends in a harbour: reward, shop, repairs; stock and coins carry over', async () => {
    const sim = await campaign();
    sim.state.statusTimer = 0.01;
    run(sim, 0.1);
    expect(sim.state.status).toBe('sailing');
    sim.state.voyage.timber = 9;
    sim.state.voyage.coins = 100;
    run(sim, 0.1, () => ({}));
    sim.step({}, SIM_DT, [{ type: 'debugLeak' }]);
    expect(sim.state.leaks.some((l) => l.active)).toBe(true);
    // jump to the end of the leg
    sim.state.ship.x = sim.state.voyage.length - 0.05;
    const events = run(sim, 0.5);
    const h = events.find((e) => e.type === 'harbor') as { coins: number } | undefined;
    expect(h).toBeDefined();
    expect(sim.state.status).toBe('harbor');
    expect(sim.state.campaign.leg).toBe(1);
    expect(sim.state.voyage.coins).toBe(100 + h!.coins);
    expect(sim.state.campaign.shop).toHaveLength(3);
    run(sim, 2);
    expect(sim.state.leaks.some((l) => l.active)).toBe(false);

    // buy the first offer at its stall on the top deck
    const offer = sim.state.campaign.shop[0]!;
    stand(sim, SHOP_STALLS[0]!, sim.deckFeetY());
    expect(sim.interactionHints('a').interact?.icon).toBe('buy');
    const coins = sim.state.voyage.coins;
    tap(sim, 'a', 'interact');
    expect(offer.sold).toBe(true);
    expect(sim.state.voyage.coins).toBe(coins - offer.price);

    // cast off: the stock carries over
    const timber = sim.state.voyage.timber;
    sim.state.statusTimer = 0.01;
    run(sim, 0.1);
    expect(sim.state.status).toBe('sailing');
    expect(sim.state.voyage.timber).toBe(timber);
    expect(sim.state.voyage.coins).toBe(coins - offer.price);
    expect(sim.state.leaks).toHaveLength(0);
  });

  it('the last leg ends at the lighthouse; sinking starts a new run', async () => {
    const sim = await campaign();
    const c = sim.state.campaign;
    // sail straight to the last leg
    const last = c.nodes.find((n) => n.next.length === 0)!;
    sim.state.campaign.choice = last.id;
    sim.state.statusTimer = 0.01;
    run(sim, 0.1);
    expect(sim.state.campaign.node).toBe(last.id);
    sim.state.ship.x = sim.state.voyage.length - 0.05;
    let events = run(sim, 0.5);
    expect(events.some((e) => e.type === 'runOver' && e.won)).toBe(true);
    expect(sim.state.status).toBe('arrived');

    // sinking: a new run with a new route
    const sim2 = await campaign();
    const seed = sim2.state.campaign.seed;
    sim2.state.statusTimer = 0.01;
    run(sim2, 0.1);
    for (let i = 0; i < sim2.state.compartments.length; i++) sim2.step({}, SIM_DT, [{ type: 'debugWater', compartment: i, volume: 200 }]);
    events = run(sim2, 1);
    expect(sim2.state.status).toBe('sunk');
    run(sim2, DEFAULT_TUNING.gameplay.sunkResetTime + 0.2);
    expect(sim2.state.status).toBe('harbor');
    expect(sim2.state.campaign.run).toBe(1);
    expect(sim2.state.campaign.seed).not.toBe(seed);
    expect(sim2.state.campaign.leg).toBe(0);
  });

  it('the harbour casts off by itself after its time', async () => {
    const sim = await campaign();
    sim.state.statusTimer = 0.01;
    run(sim, 0.1);
    sim.state.ship.x = sim.state.voyage.length - 0.05;
    run(sim, 0.5);
    expect(sim.state.status).toBe('harbor');
    const events = run(sim, HARBOR_TIME + 0.5);
    expect(events.some((e) => e.type === 'depart')).toBe(true);
    expect(sim.state.status).toBe('sailing');
  });

  it('a campaign state survives the codec', async () => {
    const sim = await campaign();
    sim.state.campaign.shop = [{ kind: 'lens', price: 30, sold: true }];
    sim.state.campaign.upgrades = ['bilge'];
    const back = decodeState(encodeState(sim.state));
    expect(back.campaign).toEqual(sim.state.campaign);
    expect(back.status).toBe('harbor');
  });
});

describe('roles', () => {
  it('the engineer pumps more water per stroke, the carpenter repairs faster', async () => {
    const strokes = async (role: 'none' | 'engineer') => {
      const sim = await Simulation.create({ seaState: 0 });
      sim.addPlayer('a', { role });
      run(sim, 0.3);
      sim.step({}, SIM_DT, [{ type: 'debugWater', compartment: 1, volume: 15 }]);
      const pump = sim.state.stations.find((s) => s.kind === 'pump')!;
      stand(sim, pump.x, pump.y);
      tap(sim, 'a', 'interact');
      const v0 = sim.state.compartments[1]!.volume;
      for (let k = 0; k < 10; k++) run(sim, 0.3, () => ({ a: input({ left: k % 2 === 0, right: k % 2 === 1 }) }));
      return v0 - sim.state.compartments[1]!.volume;
    };
    const plain = await strokes('none');
    const eng = await strokes('engineer');
    expect(eng).toBeGreaterThan(plain * 1.2);

    const sim = await Simulation.create({ seaState: 0 });
    expect(sim.actionDuration('repair', 'carpenter')).toBeLessThan(sim.actionDuration('repair', 'none'));
  });
});
