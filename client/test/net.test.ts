import { describe, expect, it } from 'vitest';
import { normalizeServerUrl, resolveServerUrl } from '../src/net/config';
import { applyCorrections, emptyCorrections, emptySnapshot, recordCorrection, type Snapshot } from '../src/game/snapshot';
import { explainError } from '../src/ui/Lobby';

describe('server url', () => {
  const loc = { protocol: 'http:', hostname: '192.168.1.20' };
  it('normalizes http(s) and bare hosts to WebSocket urls', () => {
    expect(normalizeServerUrl('https://lw.fly.dev/')).toBe('wss://lw.fly.dev');
    expect(normalizeServerUrl('http://10.0.0.2:2567')).toBe('ws://10.0.0.2:2567');
    expect(normalizeServerUrl('lw.example.org')).toBe('wss://lw.example.org');
    expect(normalizeServerUrl('ws://localhost:2567')).toBe('ws://localhost:2567');
  });
  it('prefers ?server=, then the build variable, then the dev machine', () => {
    expect(resolveServerUrl(new URLSearchParams('server=https://a.dev'), { DEV: true, VITE_SERVER_URL: 'https://b.dev' }, loc)).toBe('wss://a.dev');
    expect(resolveServerUrl(new URLSearchParams(''), { DEV: false, VITE_SERVER_URL: 'https://b.dev' }, loc)).toBe('wss://b.dev');
    expect(resolveServerUrl(new URLSearchParams(''), { DEV: true }, loc)).toBe('ws://192.168.1.20:2567');
    expect(resolveServerUrl(new URLSearchParams(''), { DEV: false }, loc)).toBeNull();
  });
});

describe('correction smoothing', () => {
  const snap = (x: number): Snapshot => {
    const s = emptySnapshot();
    s.players.set('a', { x, y: 0 });
    return s;
  };
  it('keeps the drawn position at the moment of a correction and fades the offset', () => {
    const c = emptyCorrections();
    const prev = snap(0.9);
    const before = snap(1.0);
    const after = snap(1.2);
    recordCorrection(before, after, prev, c);
    // drawn = interpolated(new) + offset = old position
    const view = snap(1.2);
    applyCorrections(view, c, 0);
    expect(view.players.get('a')!.x).toBeCloseTo(1.0, 6);
    expect(prev.players.get('a')!.x).toBeCloseTo(1.1, 6);
    for (let i = 0; i < 60; i++) applyCorrections(snap(1.2), c, 1 / 60);
    const later = snap(1.2);
    applyCorrections(later, c, 1 / 60);
    expect(later.players.get('a')!.x).toBeCloseTo(1.2, 3);
  });
  it('does not smooth teleports', () => {
    const c = emptyCorrections();
    recordCorrection(snap(0), snap(5), snap(0), c);
    expect(c.players.size).toBe(0);
  });
});

describe('lobby errors', () => {
  it('explains common failures in German', () => {
    expect(explainError(new Error('room "ZZZZ" not found'), 'ZZZZ')).toContain('gibt es nicht');
    expect(explainError(new TypeError('Failed to fetch'))).toContain('nicht erreichbar');
  });
});
