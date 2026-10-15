import { tileToLocal, type CompartmentDef, type HatchDef, type ShipLayout } from './layout/parseLayout';
import { clamp, type Vec2 } from './math';
import type { CompartmentState } from './state';

/**
 * Water in the hull is a fill volume per compartment (no fluid simulation).
 * The surface is a straight line whose slope follows the apparent gravity with a
 * little spring ("slosh"), so the water stays roughly level in the world while
 * the ship rolls. The level for a given volume and slope is solved numerically
 * against the real (curved) compartment shape, column by column.
 */

export interface WaterColumn {
  /** Ship-local x of the column centre. */
  x: number;
  /** Vertical interior spans (ship-local y, top < bottom). */
  spans: { top: number; bottom: number }[];
}

export interface CompartmentGeometry {
  id: number;
  columns: WaterColumn[];
  colWidth: number;
  xMid: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  capacity: number;
}

export const WATER = {
  /** Slosh spring (1/s^2) and damping (1/s) of the surface slope. */
  sloshStiffness: 14,
  sloshDamping: 1.1,
  /** Orifice discharge coefficient for hatches. */
  hatchDischarge: 0.6,
  /** Gravity used for water flow (m/s^2). */
  flowGravity: 9.81,
} as const;

export function buildCompartmentGeometry(layout: ShipLayout, def: CompartmentDef): CompartmentGeometry {
  const ts = layout.tileSize;
  const byColumn = new Map<number, WaterColumn>();
  for (const s of def.spans) {
    const top = tileToLocal(layout, s.tx, s.top).y;
    const bottom = tileToLocal(layout, s.tx, s.bottom + 1).y;
    const x = tileToLocal(layout, s.tx + 0.5, 0).x;
    let col = byColumn.get(s.tx);
    if (!col) {
      col = { x, spans: [] };
      byColumn.set(s.tx, col);
    }
    col.spans.push({ top, bottom });
  }
  const columns = [...byColumn.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const xMin = tileToLocal(layout, def.minTx, 0).x;
  const xMax = tileToLocal(layout, def.maxTx + 1, 0).x;
  return {
    id: def.id,
    columns,
    colWidth: ts,
    xMid: (xMin + xMax) / 2,
    xMin,
    xMax,
    yMin: tileToLocal(layout, 0, def.minTy).y,
    yMax: tileToLocal(layout, 0, def.maxTy + 1).y,
    capacity: def.capacity,
  };
}

/** Surface y at ship-local x for surface offset `c` (value at xMid) and slope. */
export function surfaceLineY(geom: CompartmentGeometry, c: number, slope: number, x: number): number {
  return c + slope * (x - geom.xMid);
}

/** Water area below the surface line, plus its first moment in x (for the centroid). */
export function filledArea(geom: CompartmentGeometry, c: number, slope: number): { area: number; moment: number } {
  let area = 0;
  let moment = 0;
  for (const col of geom.columns) {
    const sy = c + slope * (col.x - geom.xMid);
    let h = 0;
    for (const s of col.spans) {
      h += clamp(s.bottom - Math.max(sy, s.top), 0, s.bottom - s.top);
    }
    const a = h * geom.colWidth;
    area += a;
    moment += a * col.x;
  }
  return { area, moment };
}

/** Finds the surface offset c such that the filled area equals `volume`. */
export function solveSurface(geom: CompartmentGeometry, volume: number, slope: number): number {
  const spread = Math.abs(slope) * (geom.xMax - geom.xMin);
  let lo = geom.yMin - spread - 0.01; // surface above everything: full
  let hi = geom.yMax + spread + 0.01; // surface below everything: empty
  if (volume <= 0) return hi;
  if (volume >= geom.capacity) return lo;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (filledArea(geom, mid, slope).area > volume) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function createCompartmentState(geom: CompartmentGeometry): CompartmentState {
  return { id: geom.id, volume: 0, surfaceY: geom.yMax + 0.01, slope: 0, slopeVel: 0, centroidX: geom.xMid };
}

/** Re-solves the surface after the volume or slope changed. */
export function refreshSurface(geom: CompartmentGeometry, comp: CompartmentState): void {
  comp.volume = clamp(comp.volume, 0, geom.capacity);
  comp.surfaceY = solveSurface(geom, comp.volume, comp.slope);
  if (comp.volume > 1e-6) {
    const f = filledArea(geom, comp.surfaceY, comp.slope);
    comp.centroidX = f.area > 0 ? f.moment / f.area : geom.xMid;
  } else {
    comp.centroidX = geom.xMid;
  }
}

/** Ship-local y of the water surface of a compartment at x. */
export function compartmentSurfaceY(geom: CompartmentGeometry, comp: CompartmentState, x: number): number {
  return surfaceLineY(geom, comp.surfaceY, comp.slope, x);
}

/** How deep (m) the point (x,y) lies below the water surface of the compartment (0 if above). */
export function depthBelowSurface(geom: CompartmentGeometry, comp: CompartmentState, x: number, y: number): number {
  if (comp.volume <= 1e-6) return 0;
  return Math.max(0, y - compartmentSurfaceY(geom, comp, x));
}

/** Target slope of the water surface: perpendicular to apparent gravity. */
export function targetSlope(gravity: Vec2): number {
  return clamp(-gravity.x / Math.max(gravity.y, 1e-3), -1.5, 1.5);
}

/** Local geometry of a hatch: centre x, top y of the hatch (= floor of the room above), width (m). */
export function hatchGeometry(layout: ShipLayout, hatch: HatchDef): { x: number; top: number; bottom: number; width: number } {
  const a = tileToLocal(layout, hatch.tx, hatch.ty);
  const b = tileToLocal(layout, hatch.tx + hatch.width, hatch.ty + 1);
  return { x: (a.x + b.x) / 2, top: a.y, bottom: b.y, width: b.x - a.x };
}

/**
 * One water step: slosh the surfaces towards the apparent gravity, then let water
 * drain through open hatches into the compartment below.
 */
export function updateWater(
  layout: ShipLayout,
  geoms: readonly CompartmentGeometry[],
  comps: CompartmentState[],
  hatchOpen: (id: number) => boolean,
  gravity: Vec2,
  dt: number,
): void {
  const target = targetSlope(gravity);
  for (const comp of comps) {
    const acc = WATER.sloshStiffness * (target - comp.slope) - WATER.sloshDamping * comp.slopeVel;
    comp.slopeVel += acc * dt;
    comp.slope = clamp(comp.slope + comp.slopeVel * dt, -1.5, 1.5);
  }
  for (const comp of comps) refreshSurface(geoms[comp.id]!, comp);

  for (const hatch of layout.hatches) {
    if (hatch.above < 0 || hatch.below < 0 || !hatchOpen(hatch.id)) continue;
    const upper = comps[hatch.above]!;
    const lower = comps[hatch.below]!;
    if (upper.volume <= 1e-6) continue;
    const g = hatchGeometry(layout, hatch);
    const depth = depthBelowSurface(geoms[upper.id]!, upper, g.x, g.top);
    if (depth <= 0) continue;
    const rate = WATER.hatchDischarge * g.width * Math.sqrt(2 * WATER.flowGravity * depth);
    const room = geoms[lower.id]!.capacity - lower.volume;
    const flow = Math.min(rate * dt, upper.volume, Math.max(0, room));
    if (flow <= 0) continue;
    upper.volume -= flow;
    lower.volume += flow;
    refreshSurface(geoms[upper.id]!, upper);
    refreshSurface(geoms[lower.id]!, lower);
  }
}
