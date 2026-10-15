/** Tracks which physical keys (KeyboardEvent.code) are held, plus one-shot presses. */
export class Keyboard {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly listeners: ((code: string) => void)[] = [];

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.pressed.add(e.code);
        for (const l of this.listeners) l(e.code);
      }
      this.held.add(e.code);
    });
    target.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
    });
    target.addEventListener('blur', () => this.held.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c));
  }

  /** True if one of the keys went down since the last `consumePresses`. */
  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  consumePresses(): void {
    this.pressed.clear();
  }

  onKeyDown(cb: (code: string) => void): void {
    this.listeners.push(cb);
  }
}

const PREVENT = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'Tab', 'ShiftRight', 'Enter',
]);
