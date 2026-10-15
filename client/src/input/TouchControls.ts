import { EMPTY_INPUT, type HintIcon, type PlayerInput } from '@lw/shared';
import type { Sheet } from '../render/assets';
import { drawGlyphText } from '../ui/PixelFont';

const ICONS: Record<HintIcon, string> = {
  wheel: 'ui_i_wheel',
  pump: 'ui_i_pump',
  searchlight: 'ui_i_light',
  cannon: 'ui_i_cannon',
  workshop: 'ui_i_plank',
  plank: 'ui_i_plank',
  hatch: 'ui_i_hatch',
  repair: 'ui_i_hammer',
  exit: 'ui_i_exit',
  grab: 'ui_i_grab',
  drop: 'ui_i_drop',
  fire: 'ui_i_fire',
};

type ButtonKey = 'jump' | 'interact' | 'pick';

interface PixelButton {
  key: ButtonKey;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  size: number;
  letter: string;
  icon: string;
  enabled: boolean;
  down: boolean;
  pressed: boolean;
  drawn: string;
}

/**
 * On-screen controls for touch devices, drawn as pixel art in the game's pixel
 * size: a floating stick on the left half (walk / climb / operate stations) and
 * three round brass buttons on the right. E and F show what they would do right
 * now (context icon) - important when nobody can talk.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly base: HTMLCanvasElement;
  private readonly knob: HTMLCanvasElement;
  private readonly buttons: Record<ButtonKey, PixelButton>;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stick = { x: 0, y: 0 };
  private enabled = false;
  private px = 3;
  /** Ping button: tap it, then tap a spot (or tap it twice for "here"). */
  private readonly ping: PixelButton;
  private pingMode = false;
  private pingTimer = 0;
  /** Called with screen coordinates, or null for "where I stand". */
  onPing: (clientX: number | null, clientY: number | null) => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly props: Sheet,
    private readonly pixelSize: () => number,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    const zone = document.createElement('div');
    zone.className = 'touch-zone';
    this.root.appendChild(zone);
    this.base = this.spriteCanvas('ui_stick_base', 'touch-stick');
    this.knob = this.spriteCanvas('ui_stick_knob', 'touch-knob');
    this.root.append(this.base, this.knob);

    const mk = (key: ButtonKey, size: number, letter: string, icon: string, cls: string): PixelButton => {
      const el = document.createElement('div');
      el.className = `touch-btn ${cls}`;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      el.appendChild(canvas);
      this.root.appendChild(el);
      const b: PixelButton = { key, el, canvas, size, letter, icon, enabled: true, down: false, pressed: false, drawn: '' };
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.down = true;
        b.pressed = true;
        el.setPointerCapture?.(e.pointerId);
        this.drawButton(b);
      });
      const up = () => {
        b.down = false;
        this.drawButton(b);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      return b;
    };
    this.buttons = {
      jump: mk('jump', 30, '', 'ui_i_jump', 'btn-jump'),
      interact: mk('interact', 24, 'E', 'ui_i_hand', 'btn-e'),
      pick: mk('pick', 24, 'F', 'ui_i_grab', 'btn-f'),
    };
    this.ping = mk('pick', 24, '', 'ui_i_ping', 'btn-ping');
    this.ping.el.addEventListener('pointerdown', () => {
      this.ping.pressed = false;
      if (this.pingMode) {
        this.setPingMode(false);
        this.onPing(null, null);
      } else this.setPingMode(true);
    });
    this.ping.el.addEventListener('pointerup', () => {
      this.ping.down = this.pingMode;
      this.drawButton(this.ping);
    });
    // in ping mode the next tap anywhere marks that spot (before the stick or a station widget gets it)
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.pingMode || this.ping.el.contains(e.target as Node)) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this.setPingMode(false);
        this.onPing(e.clientX, e.clientY);
      },
      { capture: true },
    );
    parent.appendChild(this.root);

    zone.addEventListener('pointerdown', (e) => this.stickStart(e));
    window.addEventListener('pointermove', (e) => this.stickMove(e));
    window.addEventListener('pointerup', (e) => this.stickEnd(e));
    window.addEventListener('pointercancel', (e) => this.stickEnd(e));

    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (coarse || navigator.maxTouchPoints > 0) this.setEnabled(true);
    window.addEventListener('touchstart', () => this.setEnabled(true), { once: true, passive: true });
    preventBrowserZoom();
    this.relayout();
  }

  /** A canvas showing one sprite of the atlas at 1 canvas px per game px. */
  private spriteCanvas(name: string, cls: string): HTMLCanvasElement {
    const f = this.props.byName.get(name)!;
    const c = document.createElement('canvas');
    c.width = f.width;
    c.height = f.height;
    c.className = cls;
    this.blit(c.getContext('2d')!, name, 0, 0);
    return c;
  }

  private blit(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, alpha = 1): void {
    const f = this.props.byName.get(name);
    if (!f) return;
    const img = f.texture.source.resource as CanvasImageSource;
    const fr = f.texture.frame;
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, fr.x, fr.y, fr.width, fr.height, x, y, fr.width, fr.height);
    ctx.globalAlpha = 1;
  }

  private drawButton(b: PixelButton): void {
    const key = `${b.icon}|${b.enabled}|${b.down}`;
    if (key === b.drawn) return;
    b.drawn = key;
    const ctx = b.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, b.size, b.size);
    const big = b.size > 26;
    this.blit(ctx, big ? (b.down ? 'ui_btn_big_down' : 'ui_btn_big') : b.down ? 'ui_btn_down' : 'ui_btn', 0, 0);
    const o = Math.floor((b.size - 12) / 2) + (b.down ? 1 : 0);
    this.blit(ctx, b.icon, o, o - (b.letter ? 1 : 0), b.enabled ? 1 : 0.3);
    if (b.letter) drawGlyphText(ctx, b.letter, b.size - 8, b.size - 8, b.enabled ? '#f0cc72' : '#7a5520');
  }

  private setPingMode(on: boolean): void {
    this.pingMode = on;
    this.ping.down = on;
    window.clearTimeout(this.pingTimer);
    if (on) this.pingTimer = window.setTimeout(() => this.setPingMode(false), 4000);
    this.root.classList.toggle('ping-mode', on);
    this.drawButton(this.ping);
  }

  /** Updates the context icons of E and F (call every frame; redraws only on change). */
  setContext(interact: HintIcon | null, pick: HintIcon | null): void {
    const e = this.buttons.interact;
    e.icon = interact ? ICONS[interact] : 'ui_i_hand';
    e.enabled = interact !== null;
    const f = this.buttons.pick;
    f.icon = pick ? ICONS[pick] : 'ui_i_grab';
    f.enabled = pick !== null;
    this.drawButton(e);
    this.drawButton(f);
  }

  /** Sizes everything to the game's current pixel size (CSS px per game pixel). */
  relayout(): void {
    this.px = Math.max(1, this.pixelSize());
    const p = this.px;
    const size = (c: HTMLElement, w: number, h: number) => {
      c.style.width = `${w * p}px`;
      c.style.height = `${h * p}px`;
    };
    size(this.base, this.base.width, this.base.height);
    size(this.knob, this.knob.width, this.knob.height);
    for (const b of [...Object.values(this.buttons), this.ping]) {
      size(b.el, b.size, b.size);
      this.drawButton(b);
    }
    const margin = 6 * p;
    const j = this.buttons.jump.el.style;
    j.right = `${margin}px`;
    j.bottom = `${margin + 4 * p}px`;
    const e = this.buttons.interact.el.style;
    e.right = `${margin + 34 * p}px`;
    e.bottom = `${margin}px`;
    const f = this.buttons.pick.el.style;
    f.right = `${margin + 3 * p}px`;
    f.bottom = `${margin + 38 * p}px`;
    const pg = this.ping.el.style;
    pg.right = `${margin + 32 * p}px`;
    pg.bottom = `${margin + 30 * p}px`;
    if (this.stickId === null) this.placeStick(margin + 20 * p, window.innerHeight - margin - 22 * p);
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.root.style.display = v ? 'block' : 'none';
    document.body.classList.toggle('is-touch', v);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private placeStick(x: number, y: number): void {
    this.base.style.left = `${x}px`;
    this.base.style.top = `${y}px`;
    this.moveKnob(0, 0);
  }

  private moveKnob(dx: number, dy: number): void {
    const bx = parseFloat(this.base.style.left) || 0;
    const by = parseFloat(this.base.style.top) || 0;
    this.knob.style.left = `${bx + dx}px`;
    this.knob.style.top = `${by + dy}px`;
  }

  private stickStart(e: PointerEvent): void {
    if (this.stickId !== null) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    this.stickOrigin = { x: e.clientX, y: e.clientY };
    this.stick = { x: 0, y: 0 };
    this.placeStick(e.clientX, e.clientY);
    this.base.classList.add('active');
    this.knob.classList.add('active');
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    const max = 11 * this.px;
    let dx = e.clientX - this.stickOrigin.x;
    let dy = e.clientY - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.stick = { x: dx / max, y: dy / max };
    // snap the knob to whole game pixels so it stays crisp
    this.moveKnob(Math.round(dx / this.px) * this.px, Math.round(dy / this.px) * this.px);
  }

  private stickEnd(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.stick = { x: 0, y: 0 };
    this.base.classList.remove('active');
    this.knob.classList.remove('active');
    this.relayout();
  }

  /** Current input; button presses since the last read count as held for this frame. */
  read(): PlayerInput {
    if (!this.enabled) return { ...EMPTY_INPUT };
    const dead = 0.35;
    const input: PlayerInput = {
      ...EMPTY_INPUT,
      left: this.stick.x < -dead,
      right: this.stick.x > dead,
      up: this.stick.y < -0.55,
      down: this.stick.y > 0.55,
    };
    for (const k of ['jump', 'interact', 'pick'] as const) {
      const b = this.buttons[k];
      input[k] = b.down || b.pressed;
      b.pressed = false;
    }
    return input;
  }
}

let zoomGuard = false;

/**
 * iOS Safari ignores `user-scalable=no`: double-tapping a button zooms the page
 * and pinching scales it. Block the default touch gestures everywhere except in
 * scrollable UI (the tuning panel).
 */
function preventBrowserZoom(): void {
  if (zoomGuard) return;
  zoomGuard = true;
  const allowed = (t: EventTarget | null) => t instanceof Element && !!t.closest('.allow-touch');
  const block = (e: Event) => {
    if (!allowed(e.target) && e.cancelable) e.preventDefault();
  };
  document.addEventListener('touchstart', block, { passive: false });
  document.addEventListener('touchmove', block, { passive: false });
  document.addEventListener('touchend', block, { passive: false });
  document.addEventListener('dblclick', block);
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault());
}
