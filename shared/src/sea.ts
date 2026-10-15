/**
 * Ocean surface model shared by the simulation (ship motion, leak depth) and the
 * client renderer (sea mesh, shader uniforms). Heights are in meters, y-up;
 * use `seaSurfaceY` for the y-down world coordinate of the surface.
 */
export interface WaveComponent {
  /** Amplitude in meters at sea state 1. */
  amplitude: number;
  /** Wavelength in meters. */
  wavelength: number;
  /** Phase offset in radians. */
  phase: number;
}

/** Deep water dispersion uses real gravity so the waves look plausible. */
const WAVE_G = 9.81;

export const WAVES: readonly WaveComponent[] = [
  { amplitude: 1.1, wavelength: 34, phase: 0 },
  { amplitude: 0.9, wavelength: 55, phase: 1.7 },
  { amplitude: 0.55, wavelength: 21, phase: 4.1 },
  { amplitude: 0.2, wavelength: 11, phase: 2.3 },
];

export interface WaveTerms {
  k: number;
  omega: number;
  amplitude: number;
  phase: number;
}

/** Precomputed wave numbers and angular frequencies (also handy as shader uniforms). */
export const WAVE_TERMS: readonly WaveTerms[] = WAVES.map((w) => {
  const k = (Math.PI * 2) / w.wavelength;
  return { k, omega: Math.sqrt(WAVE_G * k), amplitude: w.amplitude, phase: w.phase };
});

/** Wave height (y-up, meters) at world x and time t for a given sea state (amplitude scale). */
export function waveHeight(x: number, t: number, seaState: number): number {
  let h = 0;
  for (const w of WAVE_TERMS) h += w.amplitude * Math.sin(w.k * x - w.omega * t + w.phase);
  return h * seaState;
}

/** Derivative dh/dx of the wave height. */
export function waveSlope(x: number, t: number, seaState: number): number {
  let s = 0;
  for (const w of WAVE_TERMS) s += w.amplitude * w.k * Math.cos(w.k * x - w.omega * t + w.phase);
  return s * seaState;
}

/** World y (y-down) of the sea surface. */
export function seaSurfaceY(x: number, t: number, seaState: number): number {
  return -waveHeight(x, t, seaState);
}
