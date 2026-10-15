import { nextRandom } from './rng';
import { cloneTuning, type Tuning } from './tuning';

/**
 * Runs and replayability: a campaign is a route of legs (a small node graph,
 * one column per leg) from the harbour to the lighthouse. Every leg is a sea
 * area with a biome that changes the encounter table and the weather; between
 * the legs the ship lies in a harbour (choose the next leg at the chart table,
 * buy upgrades). Run modifiers and upgrades change the gameplay numbers.
 *
 * Everything here is pure data + functions of the seed, so the server and every
 * predicting client derive exactly the same effective tuning from the state.
 */

export type GameMode = 'single' | 'campaign' | 'daily';
export const GAME_MODES: readonly GameMode[] = ['single', 'campaign', 'daily'];

export type Biome = 'calm' | 'fog' | 'reef' | 'kraken' | 'pirates' | 'ice' | 'storm';
export const BIOMES: readonly Biome[] = ['calm', 'fog', 'reef', 'kraken', 'pirates', 'ice', 'storm'];

export type ModifierKind = 'night' | 'rusty' | 'hungry' | 'stormSeason' | 'scarce' | 'leaky' | 'rich';
export const MODIFIERS: readonly ModifierKind[] = ['night', 'rusty', 'hungry', 'stormSeason', 'scarce', 'leaky', 'rich'];

export type UpgradeKind = 'brassPump' | 'bilge' | 'doublePlanks' | 'quickLoader' | 'lens' | 'oilTank' | 'copper' | 'swiftHull' | 'timber' | 'tools';
export const UPGRADES: readonly UpgradeKind[] = ['brassPump', 'bilge', 'doublePlanks', 'quickLoader', 'lens', 'oilTank', 'copper', 'swiftHull', 'timber', 'tools'];

export type Role = 'none' | 'carpenter' | 'engineer' | 'lookout' | 'gunner';
export const ROLES: readonly Role[] = ['none', 'carpenter', 'engineer', 'lookout', 'gunner'];

/** One leg of the route. */
export interface RouteNode {
  id: number;
  /** Leg index (0 = first leg after the start harbour). */
  col: number;
  /** Position in the column (for drawing). */
  row: number;
  biome: Biome;
  /** Distance of the leg (m). */
  length: number;
  /** Coins for reaching the end of the leg. */
  reward: number;
  /** Nodes of the next column this one leads to. */
  next: number[];
}

export interface ShopOffer {
  kind: UpgradeKind;
  price: number;
  sold: boolean;
}

export interface CampaignState {
  mode: GameMode;
  seed: number;
  nodes: RouteNode[];
  /** The leg being sailed (node id), -1 in the start harbour. */
  node: number;
  /** Legs finished in this run. */
  leg: number;
  modifiers: ModifierKind[];
  upgrades: UpgradeKind[];
  /** Next leg chosen at the chart table (node id), -1 = none. */
  choice: number;
  /** What the harbour sells (empty while sailing). */
  shop: ShopOffer[];
  /** Runs started in this room (the seed changes with every new run). */
  run: number;
}

export interface BiomeInfo {
  name: string;
  /** Sea state at the start of the leg (the storm still grows on the way). */
  sea: number;
  apply(t: Tuning): void;
}

/** What each sea area does to the numbers. Weights are relative to the default table. */
export const BIOME_INFO: Record<Biome, BiomeInfo> = {
  calm: {
    name: 'Ruhige See',
    sea: 0.45,
    apply: (t) => {
      const g = t.gameplay;
      g.weightFlotsam *= 2.5;
      g.weightKraken *= 0.5;
      g.weightPirates *= 0.5;
      g.rockSpacingMin *= 1.4;
      g.rockSpacingMax *= 1.4;
      g.stormGrowth *= 0.4;
    },
  },
  fog: {
    name: 'Nebelbank',
    sea: 0.65,
    apply: (t) => {
      t.gameplay.rockSpotRange *= 0.65;
      t.gameplay.rockSeeRange *= 0.7;
      t.gameplay.weightWhirl *= 1.5;
    },
  },
  reef: {
    name: 'Riff',
    sea: 0.7,
    apply: (t) => {
      t.gameplay.rockSpacingMin *= 0.55;
      t.gameplay.rockSpacingMax *= 0.55;
      t.gameplay.weightFlotsam *= 1.5;
    },
  },
  kraken: {
    name: 'Krakengrund',
    sea: 0.7,
    apply: (t) => {
      t.gameplay.weightKraken *= 4;
      t.gameplay.encounterEvery *= 0.8;
    },
  },
  pirates: {
    name: 'Piratenküste',
    sea: 0.6,
    apply: (t) => {
      t.gameplay.weightPirates *= 4;
      t.gameplay.weightFlotsam *= 1.5;
      t.gameplay.encounterEvery *= 0.85;
    },
  },
  ice: {
    name: 'Eismeer',
    sea: 0.7,
    apply: (t) => {
      t.gameplay.weightIce *= 5;
      t.gameplay.iceFieldLength *= 1.6;
      t.gameplay.weightPirates *= 0.3;
    },
  },
  storm: {
    name: 'Sturmfront',
    sea: 1.0,
    apply: (t) => {
      t.gameplay.stormGrowth *= 0.8;
      t.gameplay.waveEvery *= 0.65;
      t.gameplay.lightningEvery *= 0.55;
    },
  },
};

export interface ModifierInfo {
  name: string;
  desc: string;
  apply(t: Tuning): void;
}

export const MODIFIER_INFO: Record<ModifierKind, ModifierInfo> = {
  night: { name: 'Neumond', desc: 'Der Scheinwerfer verbraucht mehr Öl.', apply: (t) => (t.gameplay.oilBurn *= 1.6) },
  rusty: { name: 'Rostige Pumpe', desc: 'Jeder Pumpenhub schafft weniger Wasser.', apply: (t) => (t.gameplay.pumpStroke *= 0.72) },
  hungry: {
    name: 'Hungriger Krake',
    desc: 'Der Krake kommt öfter und hält mehr aus.',
    apply: (t) => {
      t.gameplay.weightKraken *= 2;
      t.gameplay.monsterHp += 1;
    },
  },
  stormSeason: {
    name: 'Sturmzeit',
    desc: 'Mehr Brecher und Blitze.',
    apply: (t) => {
      t.gameplay.waveEvery *= 0.7;
      t.gameplay.lightningEvery *= 0.7;
      t.gameplay.stormGrowth *= 1.2;
    },
  },
  scarce: { name: 'Knappes Holz', desc: 'Weniger Holz an Bord.', apply: (t) => (t.gameplay.startTimber = Math.min(t.gameplay.startTimber, 2)) },
  leaky: { name: 'Morsche Planken', desc: 'Lecks laufen schneller voll.', apply: (t) => (t.gameplay.leakRate *= 1.3) },
  rich: { name: 'Fette Beute', desc: 'Mehr Münzen am Ziel jeder Etappe.', apply: (t) => (t.gameplay.rewardFactor *= 1.5) },
};

export interface UpgradeInfo {
  name: string;
  desc: string;
  price: number;
  /** Used up on purchase (can be bought again). */
  consumable: boolean;
  apply?(t: Tuning): void;
}

export const UPGRADE_INFO: Record<UpgradeKind, UpgradeInfo> = {
  brassPump: { name: 'Messingpumpe', desc: 'Mehr Wasser pro Hub.', price: 40, consumable: false, apply: (t) => (t.gameplay.pumpStroke *= 1.35) },
  bilge: { name: 'Bilgenpumpe', desc: 'Lenzt langsam von selbst.', price: 55, consumable: false, apply: (t) => (t.gameplay.bilgeRate += 0.035) },
  doublePlanks: { name: 'Doppelte Planken', desc: 'Lecks laufen langsamer voll.', price: 45, consumable: false, apply: (t) => (t.gameplay.leakRate *= 0.75) },
  quickLoader: {
    name: 'Schnelllader',
    desc: 'Die Kanone lädt schneller.',
    price: 35,
    consumable: false,
    apply: (t) => {
      t.gameplay.cannonSoloLoad *= 0.55;
      t.player.ramTime *= 0.6;
    },
  },
  lens: { name: 'Scheinwerfer-Linse', desc: 'Der Scheinwerfer reicht weiter.', price: 30, consumable: false, apply: (t) => (t.gameplay.rockSpotRange *= 1.35) },
  oilTank: { name: 'Großer Öltank', desc: 'Der Scheinwerfer braucht halb so viel Öl.', price: 25, consumable: false, apply: (t) => (t.gameplay.oilBurn *= 0.5) },
  copper: { name: 'Kupferbeschlag', desc: 'Manche Treffer schlagen kein Leck.', price: 60, consumable: false, apply: (t) => (t.gameplay.hullArmor = Math.min(0.8, t.gameplay.hullArmor + 0.35)) },
  swiftHull: { name: 'Schnelle Segel', desc: 'Das Schiff fährt schneller.', price: 50, consumable: false, apply: (t) => (t.ship.speed *= 1.15) },
  timber: { name: 'Holzbündel', desc: '+4 Holz für die Werkbank.', price: 15, consumable: true },
  tools: { name: 'Werkzeugkiste', desc: 'Hammer und Brecheisen.', price: 30, consumable: true },
};

export interface RoleInfo {
  name: string;
  desc: string;
  /** One letter for the name tag. */
  badge: string;
}

export const ROLE_INFO: Record<Role, RoleInfo> = {
  none: { name: 'Matrose', desc: 'Keine besondere Rolle.', badge: '' },
  carpenter: { name: 'Zimmermann', desc: 'Flickt und sägt schneller.', badge: 'Z' },
  engineer: { name: 'Maschinist', desc: 'Pumpt mehr Wasser pro Hub.', badge: 'M' },
  lookout: { name: 'Ausguck', desc: 'Sieht mit dem Scheinwerfer weiter.', badge: 'A' },
  gunner: { name: 'Kanonier', desc: 'Lädt die Kanone allein schneller.', badge: 'K' },
};

/** Legs from the harbour to the lighthouse. */
export const CAMPAIGN_LEGS = 6;
/** Seconds the ship waits in a harbour before it sails on by itself. */
export const HARBOR_TIME = 60;
/** Seconds in the very first harbour (nothing to buy yet). */
export const START_HARBOR_TIME = 40;

/**
 * Route graph: one column per leg, 2-3 choices per column (the last leg is
 * always the storm front before the lighthouse). Every node can be reached
 * and leads on.
 */
export function generateRoute(seed: number, legs = CAMPAIGN_LEGS): RouteNode[] {
  const rng = { rng: seed >>> 0 };
  const r = () => nextRandom(rng);
  const nodes: RouteNode[] = [];
  const cols: RouteNode[][] = [];
  for (let col = 0; col < legs; col++) {
    const last = col === legs - 1;
    const count = last ? 1 : 2 + (r() < 0.5 ? 1 : 0);
    const pool: Biome[] = last ? ['storm'] : col === 0 ? ['calm', 'fog', 'reef'] : BIOMES.filter((b) => b !== 'storm' || col >= 3);
    const used = new Set<Biome>();
    const column: RouteNode[] = [];
    for (let row = 0; row < count; row++) {
      let biome = pool[Math.floor(r() * pool.length) % pool.length]!;
      for (let k = 0; k < 6 && used.has(biome); k++) biome = pool[Math.floor(r() * pool.length) % pool.length]!;
      used.add(biome);
      const node: RouteNode = {
        id: nodes.length,
        col,
        row,
        biome,
        length: Math.round((560 + r() * 220 + col * 40) / 10) * 10,
        reward: 20 + col * 6 + Math.floor(r() * 10),
        next: [],
      };
      nodes.push(node);
      column.push(node);
    }
    cols.push(column);
  }
  // edges: each node to the nearest one or two of the next column, every next node gets at least one
  for (let c = 0; c < cols.length - 1; c++) {
    const a = cols[c]!;
    const b = cols[c + 1]!;
    for (const n of a) {
      const pos = a.length === 1 ? 0.5 : n.row / (a.length - 1);
      const target = Math.round(pos * (b.length - 1));
      n.next.push(b[target]!.id);
      const other = target + (r() < 0.5 ? -1 : 1);
      if (r() < 0.6 && other >= 0 && other < b.length) n.next.push(b[other]!.id);
    }
    for (const m of b) {
      if (a.some((n) => n.next.includes(m.id))) continue;
      const pos = b.length === 1 ? 0.5 : m.row / (b.length - 1);
      a[Math.round(pos * (a.length - 1))]!.next.push(m.id);
    }
    for (const n of a) n.next.sort((x, y) => x - y);
  }
  return nodes;
}

/** Seed of the daily voyage: the same for everybody on the same (UTC) day. */
export function dailySeed(date: Date): number {
  const key = date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  let h = 2166136261 ^ key;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Day key for display and best scores, e.g. "15.10.2026". */
export function dailyLabel(date: Date): string {
  return `${date.getUTCDate()}.${date.getUTCMonth() + 1}.${date.getUTCFullYear()}`;
}

/** A new run: the route and the run modifiers come from the seed. */
export function createCampaign(mode: GameMode, seed: number, run = 0): CampaignState {
  const s = (seed + run * 7919) >>> 0;
  const c: CampaignState = { mode, seed: s, nodes: [], node: -1, leg: 0, modifiers: [], upgrades: [], choice: -1, shop: [], run };
  if (mode === 'single') return c;
  c.nodes = generateRoute(s);
  const rng = { rng: (s ^ 0x5bd1e995) >>> 0 };
  const count = mode === 'daily' ? 2 : 1;
  const pool = [...MODIFIERS];
  for (let i = 0; i < count; i++) {
    const k = pool.splice(Math.floor(nextRandom(rng) * pool.length) % pool.length, 1)[0]!;
    c.modifiers.push(k);
  }
  c.choice = firstLegs(c)[0]?.id ?? -1;
  return c;
}

export function currentNode(c: Pick<CampaignState, 'nodes' | 'node'>): RouteNode | null {
  return c.node >= 0 ? (c.nodes[c.node] ?? null) : null;
}

export function firstLegs(c: Pick<CampaignState, 'nodes'>): RouteNode[] {
  return c.nodes.filter((n) => n.col === 0);
}

/** The legs the crew can choose from in the harbour. */
export function nextLegs(c: Pick<CampaignState, 'nodes' | 'node'>): RouteNode[] {
  const cur = currentNode(c);
  if (!cur) return firstLegs(c);
  return cur.next.map((id) => c.nodes[id]!).filter(Boolean);
}

/** The current leg is the last one (the lighthouse is at its end). */
export function isFinalLeg(c: Pick<CampaignState, 'nodes' | 'node' | 'mode'>): boolean {
  if (c.mode === 'single') return true;
  const cur = currentNode(c);
  return !!cur && cur.next.length === 0;
}

/** Sea state at the start of the current leg (later legs are rougher). */
export function legSeaState(c: CampaignState, fallback: number): number {
  const cur = currentNode(c);
  if (!cur) return fallback;
  return Math.min(1.4, BIOME_INFO[cur.biome].sea + cur.col * 0.04 + (c.modifiers.includes('stormSeason') ? 0.15 : 0));
}

/** The numbers the simulation actually uses: base tuning + modifiers + biome + upgrades. */
export function effectiveTuning(base: Readonly<Tuning>, c: Readonly<CampaignState>): Tuning {
  const t = cloneTuning(base);
  for (const m of c.modifiers) MODIFIER_INFO[m]?.apply(t);
  const cur = currentNode(c);
  if (cur) {
    BIOME_INFO[cur.biome].apply(t);
    // later legs come thicker and faster
    t.gameplay.encounterEvery *= Math.max(0.6, 1 - cur.col * 0.06);
    t.gameplay.voyageLength = cur.length;
    t.gameplay.encounterFirstAt = 0.12;
  }
  for (const u of c.upgrades) UPGRADE_INFO[u]?.apply?.(t);
  return t;
}

/** Three things to buy in the harbour (no upgrade twice; consumables always possible). */
export function rollShop(state: { rng: number }, c: Pick<CampaignState, 'upgrades'>): ShopOffer[] {
  const pool = UPGRADES.filter((u) => UPGRADE_INFO[u].consumable || !c.upgrades.includes(u));
  const out: ShopOffer[] = [];
  while (out.length < 3 && pool.length > 0) {
    const k = pool.splice(Math.floor(nextRandom(state) * pool.length) % pool.length, 1)[0]!;
    out.push({ kind: k, price: UPGRADE_INFO[k].price, sold: false });
  }
  return out;
}

/** Ship-local x of the three harbour stalls on the top deck (m from the pivot). */
export const SHOP_STALLS: readonly number[] = [3, 6.5, 10];
