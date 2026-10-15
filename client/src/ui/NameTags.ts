import { Container } from 'pixi.js';
import { PIXELS_PER_METER, PLAYER_HALF_HEIGHT, shipToWorld, type GameState } from '@lw/shared';
import type { Snapshot } from '../game/snapshot';
import { PLAYER_COLORS } from '../render/ShipView';
import { PixelFont, PixelText } from './PixelFont';

const PPM = PIXELS_PER_METER;

/** Lighter version of a coat colour, readable on the dark background. */
function light(c: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const m = (v: number) => Math.round(v + (255 - v) * 0.45);
  return (m(r) << 16) | (m(g) << 8) | m(b);
}

/** Names above the other players' heads (online play). Drawn in the HUD layer, screen pixels. */
export class NameTags {
  readonly root = new Container();
  private readonly tags = new Map<string, PixelText>();

  constructor(private readonly font: PixelFont) {}

  update(state: GameState, view: Snapshot, localIds: readonly string[], left: number, top: number, time: number): void {
    const seen = new Set<string>();
    for (const p of state.players) {
      if (localIds.includes(p.id) || !p.name || p.overboard > 0) continue;
      const v = view.players.get(p.id);
      if (!v) continue;
      seen.add(p.id);
      let t = this.tags.get(p.id);
      if (!t) {
        t = new PixelText(this.font, '', light(PLAYER_COLORS[p.color % PLAYER_COLORS.length]!));
        this.tags.set(p.id, t);
        this.root.addChild(t);
      }
      t.text = p.away ? `${p.name}...` : p.name;
      // above the head; higher while a speech bubble is shown
      const lift = p.bubble ? 1.15 : 0.35;
      const w = shipToWorld(view.ship, { x: v.x, y: v.y - PLAYER_HALF_HEIGHT - lift });
      t.position.set(Math.round(w.x * PPM - left - t.textWidth / 2), Math.round(w.y * PPM - top - 6));
      t.alpha = p.away ? 0.45 + 0.2 * Math.sin(time * 4) : 0.9;
      t.visible = true;
    }
    for (const [id, t] of this.tags) {
      if (seen.has(id)) continue;
      if (!state.players.some((p) => p.id === id)) {
        t.destroy();
        this.tags.delete(id);
      } else t.visible = false;
    }
  }
}
