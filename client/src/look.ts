import fileDefaults from './look.json';

/**
 * Visual tuning (client only). Defaults live in look.json and can be changed
 * live in the tuning panel (F9) and saved back to the file.
 */
export interface LookTuning {
  /** Overall brightness multiplier applied after lighting. */
  exposure: number;
  /** < 1 lifts dark tones, > 1 deepens them. */
  gamma: number;
  /** Moonlight on everything outside the hull (multiplies a cold blue tint). */
  ambientExt: number;
  /** Base light inside the hull (multiplies a warm tint). */
  ambientInt: number;
  lanternIntensity: number;
  lanternRadius: number;
  searchlightIntensity: number;
  fogDensity: number;
  /** How strongly lights brighten the fog. */
  fogScatter: number;
  /** Visible light beams in clear air. */
  beamScatter: number;
  /** Number of light bands (posterisation). */
  lightSteps: number;
}

const CODE_LOOK: LookTuning = {
  exposure: 1.3,
  gamma: 0.85,
  ambientExt: 1.35,
  ambientInt: 0.13,
  lanternIntensity: 2.1,
  lanternRadius: 135,
  searchlightIntensity: 2.8,
  fogDensity: 0.7,
  fogScatter: 1.6,
  beamScatter: 0.06,
  lightSteps: 7,
};

export function applyLookPatch(target: LookTuning, patch: unknown): number {
  if (!patch || typeof patch !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in target) || typeof v !== 'number' || !Number.isFinite(v)) continue;
    (target as unknown as Record<string, number>)[k] = v;
    n++;
  }
  return n;
}

export const DEFAULT_LOOK: Readonly<LookTuning> = (() => {
  const l = { ...CODE_LOOK };
  applyLookPatch(l, fileDefaults);
  return l;
})();

/** Fixed tints the ambient sliders scale. */
export const AMBIENT_EXT_TINT: readonly [number, number, number] = [0.19, 0.24, 0.38];
export const AMBIENT_INT_TINT: readonly [number, number, number] = [1.0, 0.86, 0.9];
export const FOG_COLOR: readonly [number, number, number] = [0.22, 0.27, 0.34];
