import type { Graphics } from 'pixi.js';
import { ROCK_LOOKAHEAD, type GameState } from '@lw/shared';

/** Meters to each side shown on the chart. */
const HALF_WIDTH = 14;

/**
 * Top-down sea chart: the ship at the bottom, the course straight up. Shows
 * the rocks the crew has spotted (red = in the way), the kraken and - near the
 * end - the lighthouse. Unspotted rocks stay invisible: that is the
 * searchlight's job.
 */
export function drawSeaChart(g: Graphics, x: number, y: number, w: number, h: number, state: GameState, time: number): void {
  const ship = state.ship;
  const shipBeam = 2.6;
  g.rect(x, y, w, h).fill({ color: 0x0a1620, alpha: 0.85 });
  g.rect(x, y, w, 1).fill(0x2c3a4c);
  g.rect(x, y + h - 1, w, 1).fill(0x2c3a4c);
  g.rect(x, y, 1, h).fill(0x2c3a4c);
  g.rect(x + w - 1, y, 1, h).fill(0x2c3a4c);
  const cx = x + Math.floor(w / 2);
  const toX = (lateral: number) => cx + Math.round(((lateral - ship.lateral) / HALF_WIDTH) * (w / 2 - 2));
  const toY = (ahead: number) => y + h - 4 - Math.round((ahead / ROCK_LOOKAHEAD) * (h - 7));
  // the ship's lane (where rocks would hit)
  const laneW = Math.max(1, Math.round((shipBeam / HALF_WIDTH) * (w / 2 - 2)));
  for (let yy = y + 2; yy < y + h - 4; yy += 3) g.rect(cx - laneW, yy, 1, 1).fill(0x2c4a5c).rect(cx + laneW, yy, 1, 1).fill(0x2c4a5c);
  // heading: where the bow points
  const hx = Math.round(Math.sin(ship.heading) * 10);
  g.moveTo(cx, y + h - 4).lineTo(cx + hx, y + h - 14).stroke({ color: Math.abs(ship.heading) > 0.35 ? 0xe8584a : 0x6cc070, width: 1, pixelLine: true });
  for (const r of state.rocks) {
    if (!r.spotted || r.hit) continue;
    const ahead = r.x - ship.x;
    if (ahead < 0 || ahead > ROCK_LOOKAHEAD) continue;
    const px = toX(r.lateral);
    if (px < x + 1 || px > x + w - 2) continue;
    const size = Math.max(1, Math.round((r.radius / HALF_WIDTH) * (w / 2 - 2)));
    const danger = Math.abs(r.lateral - ship.lateral) < r.radius + shipBeam;
    const col = danger ? (Math.floor(time * 4) % 2 ? 0xff6a50 : 0xc83a2c) : 0x8a96a6;
    g.rect(px - size, toY(ahead) - 1, size * 2 + 1, 2).fill(col);
  }
  if (state.monster && state.monster.spotted && state.monster.phase !== 'flee') {
    const my = toY(Math.max(0, state.monster.offset - 16));
    g.rect(cx - 2, my - 2, 5, 3).fill(0xb04a8a).rect(cx - 2, my + 1, 1, 1).fill(0xb04a8a).rect(cx + 2, my + 1, 1, 1).fill(0xb04a8a);
  }
  const left = state.voyage.length - ship.x;
  if (left < ROCK_LOOKAHEAD) {
    const ly = toY(left);
    g.rect(toX(0), ly - 2, 1, 3).fill(0xe0b860).rect(toX(0) - 1, ly - 3, 3, 1).fill(0xfff0c0);
  }
  // the ship
  g.rect(cx - 1, y + h - 5, 3, 3).fill(0xd8dde6).rect(cx, y + h - 6, 1, 1).fill(0xd8dde6);
}
