/**
 * Small deterministic PRNG (mulberry32). The state is a single uint32 so it
 * can live inside the serialisable game state and be replayed on the server.
 */
export function nextRandom(state: { rng: number }): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomRange(state: { rng: number }, min: number, max: number): number {
  return min + (max - min) * nextRandom(state);
}
