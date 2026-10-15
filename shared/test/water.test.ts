import { describe, expect, it } from 'vitest';
import {
  COMPARTMENT_NAMES,
  GRAVITY,
  SHIP_MAP,
  SHIP_ORIGIN,
  apparentGravity,
  buildCompartmentGeometry,
  createCompartmentState,
  filledArea,
  parseLayout,
  refreshSurface,
  solveSurface,
  targetSlope,
  updateWater,
} from '../src';

const layout = parseLayout(SHIP_MAP, { origin: SHIP_ORIGIN, compartmentNames: COMPARTMENT_NAMES });
const geoms = layout.compartments.map((c) => buildCompartmentGeometry(layout, c));
const [MID, LOW] = [0, 1];

describe('water volume <-> level', () => {
  it('solveSurface is the inverse of filledArea for flat and tilted surfaces', () => {
    for (const g of geoms) {
      for (const frac of [0.02, 0.2, 0.5, 0.9]) {
        for (const slope of [0, 0.15, -0.25]) {
          const v = g.capacity * frac;
          const c = solveSurface(g, v, slope);
          expect(filledArea(g, c, slope).area).toBeCloseTo(v, 3);
        }
      }
    }
  });

  it('capacity equals the interior area of the compartment', () => {
    const g = geoms[LOW]!;
    const full = filledArea(g, g.yMin - 1, 0).area;
    expect(full).toBeCloseTo(g.capacity, 6);
  });

  it('the surface tilts perpendicular to the apparent gravity and water moves to the low side', () => {
    const g = geoms[LOW]!;
    const comp = createCompartmentState(g);
    comp.volume = 10;
    const gravity = apparentGravity((10 * Math.PI) / 180, 0);
    const slope = targetSlope(gravity);
    expect(slope).toBeLessThan(0); // right side down -> water higher on the right
    comp.slope = slope;
    refreshSurface(g, comp);
    expect(comp.centroidX).toBeGreaterThan(g.xMid);
  });
});

describe('water flow between compartments', () => {
  const allOpen = () => true;
  const allClosed = () => false;

  it('drains from the mid deck to the lower deck through open hatches', () => {
    const comps = geoms.map((g) => createCompartmentState(g));
    comps[MID]!.volume = 8;
    refreshSurface(geoms[MID]!, comps[MID]!);
    const total = comps[MID]!.volume + comps[LOW]!.volume;
    for (let i = 0; i < 60 * 30; i++) updateWater(layout, geoms, comps, allOpen, { x: 0, y: GRAVITY }, 1 / 60);
    expect(comps[MID]!.volume).toBeLessThan(0.5);
    expect(comps[LOW]!.volume).toBeGreaterThan(7.5);
    expect(comps[MID]!.volume + comps[LOW]!.volume).toBeCloseTo(total, 6); // mass conservation
  });

  it('does not flow when all hatches are closed', () => {
    const comps = geoms.map((g) => createCompartmentState(g));
    comps[MID]!.volume = 8;
    refreshSurface(geoms[MID]!, comps[MID]!);
    for (let i = 0; i < 600; i++) updateWater(layout, geoms, comps, allClosed, { x: 0, y: GRAVITY }, 1 / 60);
    expect(comps[MID]!.volume).toBeCloseTo(8, 6);
    expect(comps[LOW]!.volume).toBe(0);
  });

  it('sloshes: the slope follows a sudden gravity change with overshoot and settles', () => {
    const comps = geoms.map((g) => createCompartmentState(g));
    comps[LOW]!.volume = 15;
    const g = apparentGravity(0.2, 0);
    let maxAbs = 0;
    for (let i = 0; i < 60 * 12; i++) {
      updateWater(layout, geoms, comps, allClosed, g, 1 / 60);
      maxAbs = Math.max(maxAbs, Math.abs(comps[LOW]!.slope));
    }
    const target = targetSlope(g);
    expect(maxAbs).toBeGreaterThan(Math.abs(target)); // overshoot = slosh
    expect(comps[LOW]!.slope).toBeCloseTo(target, 2);
  });
});
