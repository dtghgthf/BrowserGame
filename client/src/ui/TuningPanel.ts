import { DEFAULT_TUNING, diffTuning, type Tuning, type TuningPatch } from '@lw/shared';
import { applyLookPatch, DEFAULT_LOOK, type LookTuning } from '../look';

type Group = 'look' | keyof Tuning;

interface Spec {
  group: Group;
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

/** What the panel shows. Everything else stays editable in the JSON files. */
export const SECTIONS: { title: string; items: Spec[] }[] = [
  {
    title: 'Licht & Look',
    items: [
      { group: 'look', key: 'exposure', label: 'Helligkeit', min: 0.4, max: 3, step: 0.05 },
      { group: 'look', key: 'gamma', label: 'Gamma (kleiner = hellere Schatten)', min: 0.4, max: 1.5, step: 0.05 },
      { group: 'look', key: 'ambientExt', label: 'Mondlicht draußen', min: 0, max: 4, step: 0.05 },
      { group: 'look', key: 'ambientInt', label: 'Grundlicht unter Deck', min: 0, max: 0.6, step: 0.01 },
      { group: 'look', key: 'lanternIntensity', label: 'Laternen', min: 0, max: 5, step: 0.05 },
      { group: 'look', key: 'lanternRadius', label: 'Laternen-Reichweite', min: 40, max: 260, step: 5, unit: 'px' },
      { group: 'look', key: 'searchlightIntensity', label: 'Scheinwerfer', min: 0, max: 6, step: 0.1 },
      { group: 'look', key: 'fogDensity', label: 'Nebel', min: 0, max: 1.5, step: 0.05 },
      { group: 'look', key: 'fogScatter', label: 'Nebel leuchtet im Licht', min: 0, max: 4, step: 0.1 },
      { group: 'look', key: 'beamScatter', label: 'Lichtkegel in der Luft', min: 0, max: 0.3, step: 0.005 },
      { group: 'look', key: 'lightSteps', label: 'Licht-Stufen (Pixel-Look)', min: 2, max: 24, step: 1 },
    ],
  },
  {
    title: 'Spieler',
    items: [
      { group: 'player', key: 'walkSpeed', label: 'Laufgeschwindigkeit', min: 1, max: 12, step: 0.1, unit: 'm/s' },
      { group: 'player', key: 'groundAccel', label: 'Beschleunigung', min: 5, max: 120, step: 1 },
      { group: 'player', key: 'airAccel', label: 'Steuerung in der Luft', min: 0, max: 60, step: 1 },
      { group: 'player', key: 'jumpSpeed', label: 'Sprungkraft', min: 2, max: 14, step: 0.1 },
      { group: 'gameplay', key: 'gravity', label: 'Schwerkraft', min: 6, max: 45, step: 0.5, unit: 'm/s²' },
      { group: 'player', key: 'slideFactor', label: 'Rutschen bei Schlagseite', min: 0, max: 1.2, step: 0.01 },
      { group: 'player', key: 'climbSpeed', label: 'Klettertempo', min: 0.5, max: 8, step: 0.1 },
      { group: 'player', key: 'carrySpeedFactor', label: 'Tempo beim Tragen', min: 0.2, max: 1, step: 0.01, unit: '×' },
      { group: 'player', key: 'repairTime', label: 'Reparaturdauer', min: 0.2, max: 6, step: 0.1, unit: 's' },
    ],
  },
  {
    title: 'Schiff & See',
    items: [
      { group: 'ship', key: 'initialSeaState', label: 'Seegang', min: 0, max: 1.5, step: 0.05 },
      { group: 'ship', key: 'maxWaveRollDeg', label: 'Max. Rollen durch Wellen', min: 0, max: 30, step: 0.5, unit: '°' },
      { group: 'ship', key: 'rollResponse', label: 'Wie stark Wellen kippen', min: 0, max: 2, step: 0.05 },
      { group: 'ship', key: 'rollStiffness', label: 'Roll-Steifigkeit', min: 0.3, max: 8, step: 0.1 },
      { group: 'ship', key: 'rollDamping', label: 'Roll-Dämpfung', min: 0.1, max: 5, step: 0.05 },
      { group: 'ship', key: 'speed', label: 'Fahrt', min: 0, max: 8, step: 0.1, unit: 'm/s' },
      { group: 'ship', key: 'turnRate', label: 'Ruderwirkung', min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    title: 'Spielregeln',
    items: [
      { group: 'gameplay', key: 'leakRate', label: 'Leck-Einstrom', min: 0, max: 1.5, step: 0.01 },
      { group: 'gameplay', key: 'pumpStroke', label: 'Wasser pro Pumpenhub', min: 0.02, max: 0.8, step: 0.01, unit: 'm²' },
      { group: 'gameplay', key: 'pumpHandleSpeed', label: 'Pumpenhebel-Tempo', min: 1, max: 25, step: 0.5 },
      { group: 'gameplay', key: 'wheelSpeed', label: 'Steuerrad-Tempo', min: 0.1, max: 4, step: 0.05 },
      { group: 'gameplay', key: 'sinkFraction', label: 'Sinkt ab Füllung', min: 0.2, max: 1, step: 0.01, unit: '×' },
    ],
  },
  {
    title: 'Fahrt & Gefahren',
    items: [
      { group: 'gameplay', key: 'voyageLength', label: 'Strecke (ab Neustart)', min: 200, max: 4000, step: 50, unit: 'm' },
      { group: 'gameplay', key: 'stormGrowth', label: 'Sturm wächst um', min: 0, max: 1, step: 0.05 },
      { group: 'gameplay', key: 'rockSpacingMin', label: 'Felsen-Abstand min', min: 15, max: 200, step: 5, unit: 'm' },
      { group: 'gameplay', key: 'rockSpacingMax', label: 'Felsen-Abstand max', min: 20, max: 300, step: 5, unit: 'm' },
      { group: 'gameplay', key: 'rockSpotRange', label: 'Scheinwerfer-Reichweite', min: 20, max: 160, step: 5, unit: 'm' },
      { group: 'gameplay', key: 'shipBeam', label: 'Schiffsbreite (halb)', min: 1, max: 5, step: 0.1, unit: 'm' },
      { group: 'gameplay', key: 'encounterEvery', label: 'Begegnung alle', min: 80, max: 1500, step: 10, unit: 'm' },
      { group: 'gameplay', key: 'monsterHp', label: 'Krake: Treffer nötig', min: 1, max: 10, step: 1 },
      { group: 'gameplay', key: 'monsterAttackInterval', label: 'Krake greift an alle', min: 2, max: 30, step: 0.5, unit: 's' },
      { group: 'gameplay', key: 'cannonSoloLoad', label: 'Kanone lädt allein', min: 0.3, max: 10, step: 0.1, unit: 's' },
      { group: 'gameplay', key: 'sawStrokes', label: 'Sägezüge pro Planke', min: 1, max: 20, step: 1 },
      { group: 'gameplay', key: 'startTimber', label: 'Holz am Start', min: 0, max: 30, step: 1 },
      { group: 'gameplay', key: 'oilBurn', label: 'Öl-Verbrauch Scheinwerfer', min: 0, max: 0.05, step: 0.001, unit: '/s' },
      { group: 'gameplay', key: 'ballSpeed', label: 'Kugel-Tempo', min: 8, max: 50, step: 1, unit: 'm/s' },
    ],
  },
];

const STORAGE_KEY = 'lw.tuning.v1';

interface Overrides {
  shared: TuningPatch;
  look: Partial<LookTuning>;
}

export interface TuningHost {
  /** Live gameplay tuning (read only; change it through `tune`). */
  readonly tuning: Readonly<Tuning>;
  /** Live look values (mutated directly). */
  readonly look: LookTuning;
  tune(patch: TuningPatch): void;
  setSeaState(v: number): void;
}

/**
 * Debug panel to tune gameplay and look live. Values are remembered per
 * device (localStorage) until they are saved as the project defaults:
 * on the dev server "Als Standard speichern" writes shared/src/tuning.json and
 * client/src/look.json, which are committed with the code.
 */
export class TuningPanel {
  readonly el: HTMLDivElement;
  private readonly gear: HTMLButtonElement;
  private readonly status: HTMLDivElement;
  private readonly rows = new Map<string, { spec: Spec; input: HTMLInputElement; value: HTMLSpanElement; row: HTMLDivElement }>();
  private readonly look: LookTuning;

  constructor(
    private readonly host: TuningHost,
    showGear: boolean,
  ) {
    this.look = host.look;
    this.el = document.createElement('div');
    this.el.className = 'tuning-panel allow-touch';
    this.el.style.display = 'none';
    const head = document.createElement('div');
    head.className = 'tuning-head';
    head.innerHTML = '<b>Einstellungen</b> <span class="tuning-hint">F9</span>';
    const close = document.createElement('button');
    close.textContent = '✕';
    close.className = 'tuning-close';
    close.addEventListener('click', () => this.toggle(false));
    head.appendChild(close);
    this.el.appendChild(head);

    for (const section of SECTIONS) {
      const h = document.createElement('div');
      h.className = 'tuning-section';
      h.textContent = section.title;
      this.el.appendChild(h);
      for (const spec of section.items) this.el.appendChild(this.makeRow(spec));
    }

    const actions = document.createElement('div');
    actions.className = 'tuning-actions';
    const save = this.button('Als Standard speichern', () => void this.saveDefaults());
    save.classList.add('primary');
    actions.append(save, this.button('Alles zurücksetzen', () => this.resetAll()), this.button('JSON kopieren', () => void this.copyJson()));
    this.el.appendChild(actions);
    this.status = document.createElement('div');
    this.status.className = 'tuning-status';
    this.el.appendChild(this.status);
    document.body.appendChild(this.el);

    this.gear = document.createElement('button');
    this.gear.className = 'tuning-gear allow-touch';
    this.gear.textContent = '⚙';
    this.gear.title = 'Einstellungen (F9)';
    this.gear.style.display = showGear ? 'block' : 'none';
    this.gear.addEventListener('click', () => this.toggle());
    document.body.appendChild(this.gear);

    this.loadOverrides();
  }

  get isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  toggle(open = !this.isOpen): void {
    this.el.style.display = open ? 'block' : 'none';
    if (open) this.refresh();
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  private makeRow(spec: Spec): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'tuning-row';
    const label = document.createElement('label');
    label.textContent = spec.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    const value = document.createElement('span');
    value.className = 'tuning-value';
    const reset = document.createElement('button');
    reset.className = 'tuning-reset';
    reset.textContent = '↺';
    reset.title = 'Standardwert';
    reset.addEventListener('click', () => this.set(spec, this.defaultOf(spec)));
    input.addEventListener('input', () => this.set(spec, Number(input.value)));
    row.append(label, input, value, reset);
    this.rows.set(`${spec.group}.${spec.key}`, { spec, input, value, row });
    return row;
  }

  private current(spec: Spec): number {
    if (spec.group === 'look') return (this.look as unknown as Record<string, number>)[spec.key]!;
    return (this.host.tuning[spec.group] as unknown as Record<string, number>)[spec.key]!;
  }

  private defaultOf(spec: Spec): number {
    if (spec.group === 'look') return (DEFAULT_LOOK as unknown as Record<string, number>)[spec.key]!;
    return (DEFAULT_TUNING[spec.group] as unknown as Record<string, number>)[spec.key]!;
  }

  /** Applies one value live and remembers it locally. */
  private set(spec: Spec, v: number): void {
    if (spec.group === 'look') {
      applyLookPatch(this.look, { [spec.key]: v });
    } else {
      this.host.tune({ [spec.group]: { [spec.key]: v } } as TuningPatch);
      if (spec.key === 'initialSeaState') this.host.setSeaState(v);
    }
    this.updateRow(spec, v);
    this.storeOverrides(spec.group === 'look' ? undefined : { [spec.group]: { [spec.key]: v } });
  }

  private updateRow(spec: Spec, v: number): void {
    const r = this.rows.get(`${spec.group}.${spec.key}`);
    if (!r) return;
    r.input.value = String(v);
    const decimals = spec.step >= 1 ? 0 : spec.step >= 0.1 ? 1 : spec.step >= 0.01 ? 2 : 3;
    r.value.textContent = `${v.toFixed(decimals)}${spec.unit ? ` ${spec.unit}` : ''}`;
    r.row.classList.toggle('modified', Math.abs(v - this.defaultOf(spec)) > 1e-9);
  }

  refresh(): void {
    for (const { spec } of this.rows.values()) this.updateRow(spec, this.current(spec));
  }

  /** Current values that differ from the file defaults. */
  private overrides(pendingShared?: TuningPatch): Overrides {
    const shared = diffTuning(DEFAULT_TUNING, this.host.tuning);
    // the `tune` command is applied on the next simulation step, include it already
    for (const [g, values] of Object.entries(pendingShared ?? {})) {
      const group = g as keyof Tuning;
      for (const [k, v] of Object.entries(values as Record<string, number>)) {
        const def = (DEFAULT_TUNING[group] as unknown as Record<string, number>)[k];
        const target = ((shared[group] ??= {}) as Record<string, number>);
        if (v === def) delete target[k];
        else target[k] = v;
      }
    }
    const look: Partial<LookTuning> = {};
    for (const k of Object.keys(DEFAULT_LOOK) as (keyof LookTuning)[]) {
      if (this.look[k] !== DEFAULT_LOOK[k]) look[k] = this.look[k];
    }
    return { shared, look };
  }

  private storeOverrides(pendingShared?: TuningPatch): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides(pendingShared)));
    } catch {
      /* private mode: values just are not remembered */
    }
  }

  private loadOverrides(): void {
    let o: Overrides | null = null;
    try {
      o = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Overrides | null;
    } catch {
      o = null;
    }
    if (!o) return;
    if (o.shared) {
      this.host.tune(o.shared);
      const sea = o.shared.ship?.initialSeaState;
      if (typeof sea === 'number') this.host.setSeaState(sea);
    }
    if (o.look) applyLookPatch(this.look, o.look);
    this.say('Lokale Änderungen geladen (noch nicht als Standard gespeichert).');
  }

  private resetAll(): void {
    this.host.tune(DEFAULT_TUNING);
    this.host.setSeaState(DEFAULT_TUNING.ship.initialSeaState);
    applyLookPatch(this.look, DEFAULT_LOOK);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    for (const { spec } of this.rows.values()) this.updateRow(spec, this.defaultOf(spec));
    this.say('Alles auf die gespeicherten Standardwerte zurückgesetzt.');
  }

  /** Full current values (what would be written to the JSON files). */
  private snapshot(): { shared: Tuning; look: LookTuning } {
    return { shared: JSON.parse(JSON.stringify(this.host.tuning)) as Tuning, look: { ...this.look } };
  }

  private async saveDefaults(): Promise<void> {
    const body = JSON.stringify(this.snapshot());
    try {
      const res = await fetch('__tuning', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      this.say('Gespeichert in shared/src/tuning.json und client/src/look.json – die Seite lädt neu.');
    } catch {
      this.say('Speichern geht nur mit dem Dev-Server (npm run dev). Die Werte stehen unten zum Kopieren.');
      this.showJson(body);
    }
  }

  private async copyJson(): Promise<void> {
    const text = JSON.stringify(this.snapshot(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      this.say('JSON in die Zwischenablage kopiert.');
    } catch {
      this.showJson(text);
      this.say('Zwischenablage nicht verfügbar – JSON unten markieren und kopieren.');
    }
  }

  private showJson(text: string): void {
    let ta = this.el.querySelector('textarea');
    if (!ta) {
      ta = document.createElement('textarea');
      ta.readOnly = true;
      this.el.appendChild(ta);
    }
    ta.value = text;
  }

  private say(msg: string): void {
    this.status.textContent = msg;
  }
}
