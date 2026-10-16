import { DEFAULT_DESIGN, decodeDesign, encodeDesign, isDefaultDesign, validateShipDesign, type ShipDesign } from '@lw/shared';

/**
 * Ships from the editor on this device (localStorage): the one in use and a
 * list of saved ones. Ships travel as design codes (links, rooms).
 */
const CURRENT = 'lw.ship.current.v1';
const SAVED = 'lw.ships.v1';

export interface SavedShip {
  name: string;
  code: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function savedShips(): SavedShip[] {
  return read<SavedShip[]>(SAVED, []).filter((s) => typeof s?.code === 'string');
}

/** Saves (or replaces by name) a ship. Returns its code. */
export function saveShip(d: ShipDesign): string {
  const code = encodeDesign(d);
  const list = savedShips().filter((s) => s.name !== d.name);
  list.unshift({ name: d.name, code });
  write(SAVED, list.slice(0, 30));
  return code;
}

export function deleteShip(name: string): void {
  write(
    SAVED,
    savedShips().filter((s) => s.name !== name),
  );
}

/** The ship used for new voyages (null = the standard ship). */
export function currentShipCode(): string | null {
  return read<string | null>(CURRENT, null);
}

export function setCurrentShip(code: string | null): void {
  write(CURRENT, code);
}

/** A design that can be sailed (no validation errors), else null. */
export function playable(code: string | null): ShipDesign | null {
  if (!code) return null;
  const d = decodeDesign(code);
  if (!d || validateShipDesign(d).some((i) => i.level === 'error')) return null;
  return d;
}

/** The ship to load: ?ship= in the URL, then the current ship, else the standard ship. */
export function resolveShip(params: URLSearchParams): { design: ShipDesign; code: string | null } {
  // ?ship=standard: the standard ship even if another one is selected (an online room with the standard ship)
  if (params.get('ship') === 'standard') return { design: DEFAULT_DESIGN, code: null };
  for (const code of [params.get('ship'), currentShipCode()]) {
    const d = playable(code);
    if (d && !isDefaultDesign(d)) return { design: d, code: encodeDesign(d) };
  }
  return { design: DEFAULT_DESIGN, code: null };
}
