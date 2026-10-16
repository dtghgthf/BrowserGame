import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN, SHIP_ORIGIN, decodeDesign, designOrigin, encodeDesign, layoutFromDesign, validateShipDesign, type ShipDesign } from '../src';

const errors = (d: ShipDesign) => validateShipDesign(d).filter((i) => i.level === 'error');

describe('ship designs', () => {
  it('the default ship is valid and its derived waterline is close to the hand-set one', () => {
    expect(errors(DEFAULT_DESIGN)).toEqual([]);
    const o = designOrigin(DEFAULT_DESIGN.map);
    expect(Math.abs(o.x - SHIP_ORIGIN.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(o.y - SHIP_ORIGIN.y)).toBeLessThanOrEqual(2);
    // the default design keeps the exact pivot and room names
    const L = layoutFromDesign(DEFAULT_DESIGN);
    expect(L.origin).toEqual(SHIP_ORIGIN);
    expect(L.compartments.map((c) => c.name)).toContain('Unterdeck');
  });

  it('code round trip', () => {
    const code = encodeDesign(DEFAULT_DESIGN);
    expect(code.length).toBeLessThan(1200);
    expect(/^[A-Za-z0-9_-]+$/.test(code)).toBe(true);
    const back = decodeDesign(code)!;
    expect(back.name).toBe(DEFAULT_DESIGN.name.replace(/[^\u0000-ÿ]/g, '?'));
    expect(back.map).toEqual(DEFAULT_DESIGN.map);
    expect(decodeDesign('not a code!')).toBeNull();
    expect(decodeDesign('')).toBeNull();
  });

  it('finds what is missing or broken', () => {
    const noWheel: ShipDesign = { name: 'x', map: DEFAULT_DESIGN.map.map((r) => r.replace('w', ' ')) };
    expect(errors(noWheel).some((i) => i.message.includes('Steuerrad'))).toBe(true);
    // a hole in the hull: the rooms are open to the sea
    const holed: ShipDesign = { name: 'x', map: DEFAULT_DESIGN.map.map((r) => r.replace(/#/g, ' ').replace(/x/g, ' ').replace(/=/g, ' ')) };
    expect(errors(holed).some((i) => i.message.includes('Innenraum'))).toBe(true);
    const tiny: ShipDesign = { name: 'x', map: ['###', '#@#', '###'] };
    expect(errors(tiny).some((i) => i.message.includes('klein'))).toBe(true);
    const odd: ShipDesign = { name: 'x', map: DEFAULT_DESIGN.map.map((r, i) => (i === 14 ? r.replace('.', 'Q') : r)) };
    expect(errors(odd).some((i) => i.message.includes('Zeichen'))).toBe(true);
  });

  it('warns about stations nobody can reach', () => {
    // the mast basket without its ladder
    const noLadder: ShipDesign = { name: 'x', map: DEFAULT_DESIGN.map.map((r, i) => (i >= 5 && i <= 12 ? r.replace('H', ' ') : r)) };
    const w = validateShipDesign(noLadder).filter((i) => i.level === 'warning');
    expect(w.some((i) => i.message.includes('erreichbar'))).toBe(true);
    expect(validateShipDesign(DEFAULT_DESIGN).some((i) => i.message.includes('erreichbar'))).toBe(false);
  });
});

describe('templates', () => {
  it('every template is valid, reachable and sails', async () => {
    const { DESIGN_TEMPLATES, Simulation, layoutFromDesign: lay } = await import('../src');
    for (const [key, d] of Object.entries(DESIGN_TEMPLATES)) {
      const issues = validateShipDesign(d);
      expect(issues.filter((i) => i.level === 'error'), key).toEqual([]);
      expect(issues.filter((i) => i.message.includes('erreichbar') || i.message.includes('schwebt')), key).toEqual([]);
      // the code survives a round trip and a simulation runs on the ship
      expect(decodeDesign(encodeDesign(d))!.map).toEqual(d.map);
      const sim = await Simulation.create({ layout: lay(d), seaState: 0.5 });
      sim.addPlayer('a');
      for (let i = 0; i < 120; i++) sim.step({});
      expect(sim.state.players[0]!.grounded, key).toBe(true);
      expect(sim.state.stations.some((s) => s.kind === 'wheel')).toBe(true);
      expect(sim.bowOffset).toBeGreaterThan(5);
    }
  });
});
