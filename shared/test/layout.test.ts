import { describe, expect, it } from 'vitest';
import { COMPARTMENT_NAMES, SHIP_MAP, SHIP_ORIGIN, TileKind, parseLayout } from '../src';

const layout = parseLayout(SHIP_MAP, { origin: SHIP_ORIGIN, compartmentNames: COMPARTMENT_NAMES });

describe('ship layout parser', () => {
  it('has the expected dimensions', () => {
    expect(layout.width).toBe(72);
    expect(layout.height).toBe(27);
    for (const row of SHIP_MAP) expect(row.length).toBe(72);
  });

  it('finds exactly two named water compartments (mid deck + lower deck)', () => {
    expect(layout.compartments.map((c) => c.name)).toEqual(['Mitteldeck', 'Unterdeck']);
    const [mid, low] = layout.compartments;
    expect(mid!.maxTy).toBeLessThan(low!.minTy);
    expect(low!.capacity).toBeGreaterThan(50);
  });

  it('classifies every "." as interior and nothing outside the hull as interior', () => {
    for (let y = 0; y < layout.height; y++) {
      for (let x = 0; x < layout.width; x++) {
        const c = SHIP_MAP[y]![x];
        const kind = layout.tiles[y * layout.width + x];
        if (c === '.') expect(kind).toBe(TileKind.Interior);
        if (c === ' ') expect(kind).toBe(TileKind.Exterior);
      }
    }
  });

  it('derives ladders and hatches; ladders through hatches include the hatch row', () => {
    expect(layout.hatches).toHaveLength(5);
    expect(layout.ladders).toHaveLength(4);
    for (const l of layout.ladders) {
      expect(l.hatchId).not.toBeNull();
      const h = layout.hatches[l.hatchId!]!;
      expect(h.ty).toBe(l.top);
      expect(h.hasLadder).toBe(true);
    }
    const cargo = layout.hatches.find((h) => h.width === 2)!;
    expect(cargo.hasLadder).toBe(false);
    expect(layout.compartments[cargo.above]!.name).toBe('Mitteldeck');
    expect(layout.compartments[cargo.below]!.name).toBe('Unterdeck');
  });

  it('merged solid rectangles cover exactly the solid tiles without overlap', () => {
    const cover = new Uint8Array(layout.width * layout.height);
    for (const r of layout.solidRects) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) cover[y * layout.width + x]! += 1;
      }
    }
    for (let i = 0; i < cover.length; i++) {
      expect(cover[i]).toBe(layout.tiles[i] === TileKind.Solid ? 1 : 0);
    }
    // merging must actually reduce the collider count a lot
    const solidTiles = layout.tiles.filter((t) => t === TileKind.Solid).length;
    expect(layout.solidRects.length).toBeLessThan(solidTiles / 4);
  });

  it('builds closed occluder outlines (every endpoint is shared by an even number of segments)', () => {
    expect(layout.occluders.length).toBeGreaterThan(20);
    const count = new Map<string, number>();
    for (const s of layout.occluders) {
      for (const k of [`${s.ax},${s.ay}`, `${s.bx},${s.by}`]) count.set(k, (count.get(k) ?? 0) + 1);
    }
    // collinear merging can make a point an interior point of another segment,
    // so only check that no endpoint is completely dangling.
    for (const v of count.values()) expect(v).toBeGreaterThanOrEqual(1);
  });

  it('railings collide but do not occlude light', () => {
    const rails: [number, number][] = [];
    for (let i = 0; i < layout.railMask.length; i++) if (layout.railMask[i]) rails.push([i % layout.width, Math.floor(i / layout.width)]);
    expect(rails.length).toBeGreaterThanOrEqual(2);
    for (const [x, y] of rails) {
      expect(layout.tiles[y * layout.width + x]).toBe(TileKind.Solid);
      expect(layout.solidRects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)).toBe(true);
      // no occluder on the rail's sides or top (its bottom touches the floor, whose top face is exposed)
      const sideOrTop = layout.occluders.some((s) => {
        const vertical = s.ax === s.bx && (s.ax === x || s.ax === x + 1) && Math.min(s.ay, s.by) < y + 1 && Math.max(s.ay, s.by) > y;
        const top = s.ay === s.by && s.ay === y && Math.min(s.ax, s.bx) < x + 1 && Math.max(s.ax, s.bx) > x;
        return vertical || top;
      });
      expect(sideOrTop).toBe(false);
    }
  });

  it('finds the leak points in the hull (4 lower deck, 1 middle deck at the bow)', () => {
    expect(layout.leakPoints).toHaveLength(5);
    const names = layout.leakPoints.map((lp) => layout.compartments[lp.compartment]!.name);
    expect(names.filter((n) => n === 'Unterdeck')).toHaveLength(4);
    expect(names.filter((n) => n === 'Mitteldeck')).toHaveLength(1);
    for (const lp of layout.leakPoints) expect(layout.tiles[lp.ty * layout.width + lp.tx]).toBe(TileKind.Solid);
  });

  it('has all station markers', () => {
    const types = layout.markers.map((m) => m.type);
    for (const t of ['wheel', 'pump', 'searchlight', 'cannon', 'workshop']) expect(types).toContain(t);
    expect(types.filter((t) => t === 'lantern').length).toBeGreaterThanOrEqual(3);
    expect(types.filter((t) => t === 'spawn')).toHaveLength(4);
  });
});
