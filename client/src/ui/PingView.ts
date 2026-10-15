import { Container, Graphics, Sprite } from 'pixi.js';
import { PIXELS_PER_METER, shipToWorld, type GameState, type PingKind } from '@lw/shared';
import { frameOf, type Sheet } from '../render/assets';
import { PLAYER_COLORS } from '../render/ShipView';
import type { Snapshot } from '../game/snapshot';

const PPM = PIXELS_PER_METER;

const ICON: Record<PingKind, string> = {
  here: 'icon_here',
  help: 'icon_help',
  danger: 'icon_help',
  leak: 'icon_leak',
  hatch: 'ui_i_hatch',
  plank: 'icon_plank',
  wheel: 'icon_wheel',
  pump: 'ui_i_pump',
  searchlight: 'ui_i_light',
  cannon: 'ui_i_cannon',
  fire: 'icon_fire',
  crate: 'ui_i_crate',
  ring: 'ui_i_ring',
};

/**
 * Ping markers (HUD layer, screen pixels): a bouncing icon in a ring of the
 * player's coat colour. Off screen, the marker sticks to the edge with an arrow.
 */
export class PingView {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly icons = new Map<number, Sprite>();

  constructor(private readonly props: Sheet) {
    this.root.addChild(this.g);
  }

  update(state: GameState, view: Snapshot, left: number, top: number, width: number, height: number, time: number): void {
    this.g.clear();
    const seen = new Set<number>();
    for (const p of state.pings) {
      seen.add(p.id);
      const owner = state.players.find((pl) => pl.id === p.player);
      const color = PLAYER_COLORS[(owner?.color ?? 0) % PLAYER_COLORS.length]!;
      const w = shipToWorld(view.ship, { x: p.x, y: p.y });
      let sx = w.x * PPM - left;
      let sy = w.y * PPM - top;
      const off = sx < 8 || sx > width - 8 || sy < 8 || sy > height - 8;
      const age = 4 - p.time;
      const bounce = off ? 0 : Math.round(Math.abs(Math.sin(age * 5)) * 4 * Math.max(0, 1 - age));
      if (off) {
        const cx = width / 2;
        const cy = height / 2;
        const ang = Math.atan2(sy - cy, sx - cx);
        sx = Math.max(10, Math.min(width - 10, sx));
        sy = Math.max(10, Math.min(height - 10, sy));
        const ax = Math.round(sx + Math.cos(ang) * 8);
        const ay = Math.round(sy + Math.sin(ang) * 8);
        this.g.moveTo(Math.round(sx), Math.round(sy)).lineTo(ax, ay).stroke({ color, width: 1, pixelLine: true });
      }
      sx = Math.round(sx);
      sy = Math.round(sy) - bounce - (off ? 0 : 8);
      const blink = p.time < 1 ? Math.floor(time * 8) % 2 === 0 : true;
      // ring (expanding wave when fresh) + pin
      if (age < 0.6 && !off) {
        const rr = Math.round(4 + age * 18);
        this.g.circle(sx, sy, rr).stroke({ color, width: 1, alpha: 1 - age / 0.6, pixelLine: true });
      }
      this.g.rect(sx - 6, sy - 6, 13, 13).fill({ color: 0x05070d, alpha: 0.8 }).stroke({ color, width: 1, pixelLine: true });
      if (!off) this.g.rect(sx, sy + 7, 1, 3 + bounce).fill(color);
      let icon = this.icons.get(p.id);
      if (!icon) {
        const f = frameOf(this.props, ICON[p.kind]);
        icon = new Sprite(f.texture);
        icon.anchor.set(0.5);
        this.root.addChild(icon);
        this.icons.set(p.id, icon);
      }
      icon.position.set(sx + (icon.width % 2 ? 0.5 : 0), sy + (icon.height % 2 ? 0.5 : 0));
      icon.visible = blink;
    }
    for (const [id, s] of this.icons) {
      if (seen.has(id)) continue;
      s.destroy();
      this.icons.delete(id);
    }
  }
}
