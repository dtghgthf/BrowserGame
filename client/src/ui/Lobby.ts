import { MAX_NAME_LENGTH, ROLES, ROLE_INFO, isRoomCode, normalizeRoomCode, sanitizeName, type GameMode, type Role } from '@lw/shared';
import { bestLine } from './best';
import { PLAYER_COLORS } from '../render/ShipView';

/** What the menu needs from the sound engine. */
export interface VolumeControl {
  volume: number;
  muted: boolean;
  setVolume(v: number): void;
  toggleMute(): void;
}

export interface LobbyActions {
  /** null = no game server configured (only local play). */
  serverUrl: string | null;
  create(name: string, color: number, role: Role, mode: GameMode): Promise<void>;
  join(code: string, name: string, color: number, role: Role): Promise<void>;
  solo(role: Role, mode: GameMode): void;
  /** Leaves the current online room. */
  leave(): Promise<void>;
}

export type LobbyMode = 'start' | 'ingame';

const PROFILE_KEY = 'lw.profile.v1';
const COLOR_NAMES = ['Rot', 'Blau', 'Grün', 'Lila'];

interface Profile {
  name: string;
  color: number;
  role: Role;
  mode: GameMode;
}

const MODE_LABELS: [GameMode, string, string][] = [
  ['campaign', 'Kampagne', 'Sechs Etappen bis zum Leuchtturm, Häfen dazwischen.'],
  ['daily', 'Tagesfahrt', 'Heute für alle dieselbe Route.'],
  ['single', 'Einzelfahrt', 'Eine lange Fahrt wie früher.'],
];

function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') as Partial<Profile>;
    return {
      name: sanitizeName(p.name ?? ''),
      color: typeof p.color === 'number' ? p.color % 4 : Math.floor(Math.random() * 4),
      role: ROLES.includes(p.role as Role) ? (p.role as Role) : 'none',
      mode: MODE_LABELS.some(([m]) => m === p.mode) ? (p.mode as GameMode) : 'campaign',
    };
  } catch {
    return { name: '', color: 0, role: 'none', mode: 'campaign' };
  }
}

function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

/** Turns SDK / network errors into something a player understands. */
export function explainError(e: unknown, code?: string): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not found|invalid room|522/i.test(msg)) return `Raum ${code ?? ''} gibt es nicht (mehr). Code richtig?`;
  if (/locked|full|maxClients/i.test(msg)) return 'Das Schiff ist voll (4 von 4).';
  if (/Version/i.test(msg)) return msg;
  if (/fetch|network|ECONNREFUSED|Failed|timeout|offline/i.test(msg)) return 'Server nicht erreichbar. Läuft er? Gleiches WLAN?';
  return `Fehler: ${msg}`;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * Start menu and in-game menu (DOM, so text inputs and the iPad keyboard work):
 * name, coat colour, open a new ship (room code) or come aboard with a code.
 */
export class Lobby {
  readonly el: HTMLDivElement;
  private mode: LobbyMode = 'start';
  private profile = loadProfile();
  private readonly nameInput: HTMLInputElement;
  private readonly codeInput: HTMLInputElement;
  private readonly status: HTMLDivElement;
  private readonly startPane: HTMLDivElement;
  private readonly gamePane: HTMLDivElement;
  private readonly roomLabel: HTMLDivElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly roleButtons: HTMLButtonElement[] = [];
  private readonly modeButtons: HTMLButtonElement[] = [];
  private busy = false;
  private syncSound: () => void = () => {};
  /** Current room code while online (for the in-game menu). */
  roomCode = '';

  constructor(
    parent: HTMLElement,
    private readonly actions: LobbyActions,
    invitedCode: string | null,
    private readonly sound: VolumeControl | null = null,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'lobby allow-touch hidden';
    this.el.innerHTML = `
      <div class="lobby-card">
        <h1>LEUCHTTURMWÄRTER</h1>
        <div class="lobby-start">
          <label class="lobby-row">Dein Name
            <input class="lobby-name" maxlength="${MAX_NAME_LENGTH}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="NAME" />
          </label>
          <div class="lobby-row">Mantelfarbe <div class="lobby-colors"></div></div>
          <div class="lobby-row">Rolle <div class="lobby-roles lobby-seg"></div></div>
          <div class="lobby-role-desc"></div>
          <div class="lobby-row">Fahrt <div class="lobby-modes lobby-seg"></div></div>
          <div class="lobby-mode-desc"></div>
          <div class="lobby-best"></div>
          <div class="lobby-online">
            <button class="lobby-btn primary lobby-create">Neues Schiff</button>
            <div class="lobby-join">
              <input class="lobby-code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE" />
              <button class="lobby-btn lobby-join-btn">An Bord</button>
            </div>
          </div>
          <div class="lobby-offline">Online-Modus: kein Server eingerichtet.</div>
          <button class="lobby-btn subtle lobby-solo">Allein üben</button>
        </div>
        <div class="lobby-game">
          <div class="lobby-room"></div>
          <button class="lobby-btn primary lobby-share">Einladungslink teilen</button>
          <button class="lobby-btn lobby-back">Weiterspielen</button>
          <button class="lobby-btn subtle lobby-leave">Schiff verlassen</button>
        </div>
        <div class="lobby-sound">
          <span>Ton</span>
          <input class="lobby-volume" type="range" min="0" max="100" step="1" />
          <button class="lobby-mute" title="Ton an/aus (M)">🔊</button>
        </div>
        <div class="lobby-status"></div>
      </div>`;
    parent.appendChild(this.el);
    const q = <T extends Element>(sel: string) => this.el.querySelector(sel) as T;
    this.nameInput = q<HTMLInputElement>('.lobby-name');
    this.codeInput = q<HTMLInputElement>('.lobby-code');
    this.status = q<HTMLDivElement>('.lobby-status');
    this.startPane = q<HTMLDivElement>('.lobby-start');
    this.gamePane = q<HTMLDivElement>('.lobby-game');
    this.roomLabel = q<HTMLDivElement>('.lobby-room');
    const online = actions.serverUrl !== null;
    q<HTMLDivElement>('.lobby-online').style.display = online ? '' : 'none';
    q<HTMLDivElement>('.lobby-offline').style.display = online ? 'none' : '';

    const colors = q<HTMLDivElement>('.lobby-colors');
    PLAYER_COLORS.forEach((c, i) => {
      const b = document.createElement('button');
      b.className = 'lobby-swatch';
      b.style.background = hex(c);
      b.title = COLOR_NAMES[i] ?? '';
      b.setAttribute('aria-label', COLOR_NAMES[i] ?? `Farbe ${i + 1}`);
      b.addEventListener('click', () => this.setColor(i));
      colors.appendChild(b);
      this.swatches.push(b);
    });
    this.setColor(this.profile.color);
    const roles = q<HTMLDivElement>('.lobby-roles');
    for (const r of ROLES) {
      const b = document.createElement('button');
      b.className = 'lobby-seg-btn';
      b.textContent = ROLE_INFO[r].name;
      b.addEventListener('click', () => this.setRole(r));
      roles.appendChild(b);
      this.roleButtons.push(b);
    }
    const modes = q<HTMLDivElement>('.lobby-modes');
    for (const [m, label] of MODE_LABELS) {
      const b = document.createElement('button');
      b.className = 'lobby-seg-btn';
      b.textContent = label;
      b.addEventListener('click', () => this.setMode(m));
      modes.appendChild(b);
      this.modeButtons.push(b);
    }
    this.setRole(this.profile.role);
    this.setMode(this.profile.mode);
    this.nameInput.value = this.profile.name;
    this.nameInput.addEventListener('input', () => {
      const clean = sanitizeName(this.nameInput.value);
      if (clean !== this.nameInput.value.toUpperCase().trim()) this.nameInput.value = clean;
      this.profile.name = clean;
      saveProfile(this.profile);
    });
    this.codeInput.addEventListener('input', () => (this.codeInput.value = normalizeRoomCode(this.codeInput.value)));
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.doJoin();
    });

    q<HTMLButtonElement>('.lobby-create').addEventListener('click', () => void this.doCreate());
    q<HTMLButtonElement>('.lobby-join-btn').addEventListener('click', () => void this.doJoin());
    q<HTMLButtonElement>('.lobby-solo').addEventListener('click', () => {
      this.hide();
      actions.solo(this.profile.role, this.profile.mode);
    });
    q<HTMLButtonElement>('.lobby-back').addEventListener('click', () => this.hide());
    q<HTMLButtonElement>('.lobby-share').addEventListener('click', () => void this.share());
    q<HTMLButtonElement>('.lobby-leave').addEventListener('click', () => {
      void actions.leave().then(() => this.show('start', 'Du hast das Schiff verlassen.'));
    });
    const vol = q<HTMLInputElement>('.lobby-volume');
    const mute = q<HTMLButtonElement>('.lobby-mute');
    const syncSound = () => {
      if (!this.sound) return;
      vol.value = String(Math.round(this.sound.volume * 100));
      mute.textContent = this.sound.muted ? '🔇' : '🔊';
    };
    if (sound) {
      syncSound();
      vol.addEventListener('input', () => {
        sound.setVolume(Number(vol.value) / 100);
        if (sound.muted) sound.toggleMute();
        syncSound();
      });
      mute.addEventListener('click', () => {
        sound.toggleMute();
        syncSound();
      });
      this.syncSound = syncSound;
    } else q<HTMLDivElement>('.lobby-sound').style.display = 'none';
    // keys typed into the menu must not steer the ship
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && this.mode === 'ingame') this.hide();
    });

    if (invitedCode && isRoomCode(invitedCode)) {
      this.codeInput.value = invitedCode;
      this.setStatus(`Einladung zu Raum ${invitedCode} – Name eingeben und „An Bord“.`);
    }
  }

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  show(mode: LobbyMode, message = '', error = false): void {
    this.mode = mode;
    this.startPane.style.display = mode === 'start' ? '' : 'none';
    this.gamePane.style.display = mode === 'ingame' ? '' : 'none';
    this.roomLabel.innerHTML = `Raum <b>${this.roomCode}</b>Code an die anderen weitergeben`;
    if (message || mode === 'ingame') this.setStatus(message, error);
    this.el.classList.remove('hidden');
    document.body.classList.add('lobby-open');
    this.syncSound();
    (this.el.querySelector('.lobby-best') as HTMLDivElement).textContent = bestLine();
  }

  hide(): void {
    this.el.classList.add('hidden');
    document.body.classList.remove('lobby-open');
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  /** Escape / menu button: opens the menu matching the current situation. */
  toggle(online: boolean): void {
    if (this.visible) this.hide();
    else this.show(online ? 'ingame' : 'start');
  }

  private setColor(i: number): void {
    this.profile.color = i;
    saveProfile(this.profile);
    this.swatches.forEach((b, k) => b.classList.toggle('selected', k === i));
  }

  private setRole(r: Role): void {
    this.profile.role = r;
    saveProfile(this.profile);
    this.roleButtons.forEach((b, k) => b.classList.toggle('selected', ROLES[k] === r));
    (this.el.querySelector('.lobby-role-desc') as HTMLDivElement).textContent = ROLE_INFO[r].desc;
  }

  private setMode(m: GameMode): void {
    this.profile.mode = m;
    saveProfile(this.profile);
    this.modeButtons.forEach((b, k) => b.classList.toggle('selected', MODE_LABELS[k]![0] === m));
    (this.el.querySelector('.lobby-mode-desc') as HTMLDivElement).textContent = MODE_LABELS.find(([x]) => x === m)![2];
  }

  private setStatus(text: string, error = false): void {
    this.status.textContent = text;
    this.status.classList.toggle('error', error);
  }

  private name(): string {
    return sanitizeName(this.nameInput.value);
  }

  private async run(label: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    if (!this.name()) {
      this.setStatus('Bitte zuerst einen Namen eingeben.', true);
      this.nameInput.focus();
      return;
    }
    this.busy = true;
    this.el.classList.add('busy');
    this.setStatus(label);
    try {
      await fn();
      this.setStatus('');
    } catch (e) {
      console.warn('[lobby]', e);
      this.setStatus(explainError(e, this.codeInput.value), true);
    } finally {
      this.busy = false;
      this.el.classList.remove('busy');
    }
  }

  private doCreate(): Promise<void> {
    return this.run('Schiff wird klargemacht …', () => this.actions.create(this.name(), this.profile.color, this.profile.role, this.profile.mode));
  }

  private doJoin(): Promise<void> {
    const code = normalizeRoomCode(this.codeInput.value);
    if (!isRoomCode(code)) {
      this.setStatus('Der Code hat 4 Buchstaben (z. B. KJMX).', true);
      this.codeInput.focus();
      return Promise.resolve();
    }
    return this.run(`Gehe an Bord von ${code} …`, () => this.actions.join(code, this.name(), this.profile.color, this.profile.role));
  }

  private async share(): Promise<void> {
    const url = new URL(location.href);
    url.search = '';
    const keep = new URLSearchParams(location.search).get('server');
    if (keep) url.searchParams.set('server', keep);
    url.searchParams.set('room', this.roomCode);
    const link = url.toString();
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Leuchtturmwärter', text: `Komm an Bord! Raum ${this.roomCode}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      this.setStatus('Link kopiert.');
    } catch {
      this.setStatus(link);
    }
  }
}
