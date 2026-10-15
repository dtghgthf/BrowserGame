import { Container, Sprite } from 'pixi.js';
import {
  BOW_OFFSET,
  HARBOR_TIME,
  PIXELS_PER_METER,
  SHOP_STALLS,
  UPGRADE_INFO,
  seaSurfaceY,
  shipToWorld,
  type GameState,
  type Simulation,
} from '@lw/shared';
import { frameOf, type Sheet } from './assets';
import type { GameRenderer } from './GameRenderer';
import { LitSprite } from './LitSprite';
import type { Snapshot } from '../game/snapshot';
import { PixelFont, PixelText } from '../ui/PixelFont';

const PPM = PIXELS_PER_METER;

interface Stall {
  crate: LitSprite;
  icon: Sprite;
  price: PixelText;
  name: PixelText;
}

/**
 * The harbour between two legs: quay, pier and harbour office ahead of the bow,
 * and three market stalls on the top deck (crate + what it is + price).
 */
export class HarborView {
  private readonly harbor: LitSprite;
  private readonly glow: Sprite;
  private readonly stalls: Stall[] = [];
  /** World x of the pier head while in harbour (fixed when the ship arrives). */
  private anchorX: number | null = null;
  readonly hud = new Container();

  constructor(
    private readonly r: GameRenderer,
    private readonly props: Sheet,
    landmarks: Container,
    landmarksNormal: Container | null,
    font: PixelFont,
    private readonly sim: Simulation,
  ) {
    this.harbor = new LitSprite(frameOf(props, 'harbor'), landmarks, landmarksNormal);
    const gf = frameOf(props, 'harbor_glow');
    this.glow = new Sprite(gf.texture);
    this.glow.anchor.set(gf.pivot.x / gf.width, gf.pivot.y / gf.height);
    r.final.world.addChild(this.glow);
    for (let i = 0; i < SHOP_STALLS.length; i++) {
      const crate = new LitSprite(frameOf(props, 'crate_open'), r.albedo.ship, r.normal.ship);
      const icon = new Sprite();
      r.final.ship.addChild(icon);
      const price = new PixelText(font, '', 0xe0b860);
      const name = new PixelText(font, '', 0xd8dde6);
      this.hud.addChild(price, name);
      this.stalls.push({ crate, icon, price, name });
    }
  }

  update(state: GameState, view: Snapshot, localId: string | undefined, time: number): void {
    const harbor = state.status === 'harbor';
    const c = state.campaign;
    if (!harbor) this.anchorX = null;
    else if (this.anchorX === null) {
      // the ship still glides a bit after arriving (4 s from full speed to a stop)
      const since = (c.node < 0 ? 0 : HARBOR_TIME) - state.statusTimer;
      const glide = c.node < 0 ? 0 : Math.max(0, 4 - since) * state.ship.speed * 0.5;
      this.anchorX = state.ship.x + glide + BOW_OFFSET + 1.5;
    }
    this.harbor.visible = harbor;
    this.glow.visible = harbor;
    if (harbor && this.anchorX !== null) {
      const x = Math.round(this.anchorX * PPM);
      const y = Math.round((seaSurfaceY(this.anchorX, view.time, state.ship.seaState) - 1.4) * PPM);
      this.harbor.setTransform(x, y);
      this.glow.position.set(x, y);
      this.glow.alpha = 0.85 + 0.15 * Math.sin(time * 3);
    }

    // market stalls on the top deck
    const deck = this.sim.deckFeetY();
    const me = state.players.find((p) => p.id === localId);
    this.stalls.forEach((st, i) => {
      const offer = harbor ? c.shop[i] : undefined;
      const show = !!offer && !offer.sold;
      st.crate.visible = show;
      st.icon.visible = show;
      st.price.visible = show;
      st.name.visible = false;
      if (!offer || !show) return;
      const sx = SHOP_STALLS[i]!;
      st.crate.setTransform(Math.round(sx * PPM), Math.round(deck * PPM) - 6);
      const f = frameOf(this.props, `up_${offer.kind}`);
      st.icon.texture = f.texture;
      st.icon.anchor.set(0.5);
      st.icon.position.set(Math.round(sx * PPM), Math.round(deck * PPM) - 20 + Math.round(Math.sin(time * 2 + i) * 1.5));
      // price (and the name when somebody stands at the stall) in screen space
      const w = shipToWorld(view.ship, { x: sx, y: deck - 1.9 });
      const left = this.r.viewLeft;
      const top = this.r.viewTop;
      const afford = state.voyage.coins >= offer.price;
      st.price.text = `${offer.price}`;
      st.price.setColor(afford ? 0xe0b860 : 0xe8584a);
      st.price.position.set(Math.round(w.x * PPM - left - st.price.textWidth / 2), Math.round(w.y * PPM - top - 6));
      if (me && Math.abs(me.x - sx) < 1.2 && me.y < deck) {
        // what it does: just above the prompt line at the bottom
        st.name.text = UPGRADE_INFO[offer.kind].desc;
        st.name.visible = true;
        st.name.position.set(Math.round(this.r.layout.width / 2 - st.name.textWidth / 2), this.r.layout.height - 26);
      }
    });
  }
}
