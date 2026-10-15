import { EMPTY_INPUT, type PlayerInput } from '@lw/shared';

/**
 * Simple on-screen controls for touch devices: a floating virtual stick on the
 * left half (x = walk / station control, y = climb) and three buttons on the
 * right (jump, E = action, F = carry). Shown automatically on touch devices.
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stick = { x: 0, y: 0 };
  private readonly buttons: Record<'jump' | 'interact' | 'pick', { el: HTMLDivElement; down: boolean; pressed: boolean }>;
  private enabled = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.base = document.createElement('div');
    this.base.className = 'touch-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.base.appendChild(this.knob);
    this.root.appendChild(this.base);

    const mk = (cls: string, label: string) => {
      const el = document.createElement('div');
      el.className = `touch-btn ${cls}`;
      el.textContent = label;
      this.root.appendChild(el);
      return { el, down: false, pressed: false };
    };
    this.buttons = { jump: mk('btn-jump', '⤒'), interact: mk('btn-e', 'E'), pick: mk('btn-f', 'F') };
    parent.appendChild(this.root);

    const zone = document.createElement('div');
    zone.className = 'touch-zone';
    this.root.prepend(zone);
    zone.addEventListener('pointerdown', (e) => this.stickStart(e));
    window.addEventListener('pointermove', (e) => this.stickMove(e));
    window.addEventListener('pointerup', (e) => this.stickEnd(e));
    window.addEventListener('pointercancel', (e) => this.stickEnd(e));

    for (const b of Object.values(this.buttons)) {
      b.el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.down = true;
        b.pressed = true;
        b.el.classList.add('down');
      });
      const up = () => {
        b.down = false;
        b.el.classList.remove('down');
      };
      b.el.addEventListener('pointerup', up);
      b.el.addEventListener('pointercancel', up);
      b.el.addEventListener('pointerleave', up);
    }

    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    if (coarse || navigator.maxTouchPoints > 0) this.setEnabled(true);
    window.addEventListener('touchstart', () => this.setEnabled(true), { once: true, passive: true });
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    this.root.style.display = v ? 'block' : 'none';
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private stickStart(e: PointerEvent): void {
    if (this.stickId !== null) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    this.stickOrigin = { x: e.clientX, y: e.clientY };
    this.stick = { x: 0, y: 0 };
    this.base.style.left = `${e.clientX}px`;
    this.base.style.top = `${e.clientY}px`;
    this.base.classList.add('active');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private stickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    const max = 48;
    let dx = e.clientX - this.stickOrigin.x;
    let dy = e.clientY - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.stick = { x: dx / max, y: dy / max };
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private stickEnd(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    this.stickId = null;
    this.stick = { x: 0, y: 0 };
    this.base.classList.remove('active');
    this.knob.style.transform = 'translate(-50%, -50%)';
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
