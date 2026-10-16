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
  /** Opens the shipyard (ship editor). */
  shipyard(): void;
  /** Name of the ship new voyages use. */
  shipName(): string;
  /** Ships to choose from (standard + saved), the one in use marked. */
  ships(): { name: string; code: string | null; current: boolean }[];
  /** Use this ship for new voyages (null = the standard ship). */
  chooseShip(code: string | null): void;
  /** Leaves the current online room. */
  leave(): Promise<void>;
  /** Ends a solo voyage (back to the main menu). */
  quitSolo(): void;
  /** The menu opened / closed while playing (solo pauses). */
  paused(on: boolean): void;
}

/** start = the main menu (launch screen), ingame = the pause menu. */
export type LobbyMode = 'start' | 'ingame';

type Screen = 'main' | 'solo' | 'multi' | 'host' | 'join' | 'settings' | 'pause';

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

type KeyboardLock = { lock?(keys?: string[]): Promise<void>; unlock?(): void };

/** Page full screen; in Chromium browsers the Escape key is locked to the page (the browser leaves on a long press). */
async function toggleFullscreen(): Promise<void> {
  const kb = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
  try {
    if (document.fullscreenElement) {
      kb?.unlock?.();
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await kb?.lock?.(['Escape']);
  } catch {
    /* not allowed here (iframe, old browser): nothing happens */
  }
}

/**
 * The menus (DOM, so text inputs and the iPad keyboard work): the launch
 * screen over the menu scene (single player, multiplayer with host / join,
 * shipyard, settings) and the pause menu while playing.
 */
export class Lobby {
  readonly el: HTMLDivElement;
  private mode: LobbyMode = 'start';
  private screen: Screen = 'main';
  /** Where "back" in the settings goes. */
  private settingsFrom: Screen = 'main';
  private profile = loadProfile();
  private readonly codeInput: HTMLInputElement;
  private readonly status: HTMLDivElement;
  private readonly screens: Record<Screen, HTMLDivElement>;
  private readonly roomLabel: HTMLDivElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly roleButtons: HTMLButtonElement[] = [];
  private readonly modeButtons: HTMLButtonElement[] = [];
  private busy = false;
  private syncSound: () => void = () => {};
  /** Current room code while online (for the pause menu). */
  roomCode = '';
  /** The pause menu is for an online room (else a solo voyage). */
  private online = false;

  constructor(
    parent: HTMLElement,
    private readonly actions: LobbyActions,
    invitedCode: string | null,
    private readonly sound: VolumeControl | null = null,
    private readonly view: { stage3d: boolean; setStage3d(on: boolean): void } | null = null,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'lobby allow-touch hidden';
    const shipRow = `<div class="lobby-ship"><label class="lobby-ship-name">Schiff <select class="lobby-ship-select"></select></label></div>`;
    const modeRow = `<div class="lobby-row">Fahrt <div class="lobby-modes lobby-seg"></div></div><div class="lobby-mode-desc"></div>`;
    const roleRow = `<div class="lobby-row">Rolle <div class="lobby-roles lobby-seg"></div></div><div class="lobby-role-desc"></div>`;
    this.el.innerHTML = `
      <div class="lobby-card">
        <h1>LEUCHTTURMWÄRTER</h1>
        <div class="lobby-screen" data-screen="main">
          <button class="lobby-btn primary big" data-go="solo">Einzelspieler</button>
          <button class="lobby-btn primary big" data-go="multi">Mehrspieler</button>
          <button class="lobby-btn big lobby-yard">Werft</button>
          <button class="lobby-btn big" data-go="settings">Einstellungen</button>
          <div class="lobby-best"></div>
        </div>
        <div class="lobby-screen" data-screen="solo">
          <h2>Einzelspieler</h2>
          <div class="lobby-slot-mode"></div>
          <div class="lobby-slot-role"></div>
          <div class="lobby-slot-ship"></div>
          <button class="lobby-btn primary lobby-solo">Ablegen</button>
          <button class="lobby-btn subtle" data-go="main">Zurück</button>
        </div>
        <div class="lobby-screen" data-screen="multi">
          <h2>Mehrspieler</h2>
          <label class="lobby-row">Dein Name
            <input class="lobby-name" maxlength="${MAX_NAME_LENGTH}" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="NAME" />
          </label>
          <div class="lobby-row">Mantelfarbe <div class="lobby-colors"></div></div>
          <div class="lobby-slot-role2"></div>
          <div class="lobby-online">
            <button class="lobby-btn primary" data-go="host">Hosten</button>
            <button class="lobby-btn primary" data-go="join">Beitreten</button>
          </div>
          <div class="lobby-offline">Online-Modus: kein Server eingerichtet.</div>
          <button class="lobby-btn subtle" data-go="main">Zurück</button>
        </div>
        <div class="lobby-screen" data-screen="host">
          <h2>Schiff hosten</h2>
          <div class="lobby-slot-mode2"></div>
          <div class="lobby-slot-ship2"></div>
          <div class="lobby-hint">Ihr wartet im Hafen, bis alle an Bord sind – du legst ab, wenn es losgehen soll.</div>
          <button class="lobby-btn primary lobby-create">Schiff öffnen</button>
          <button class="lobby-btn subtle" data-go="multi">Zurück</button>
        </div>
        <div class="lobby-screen" data-screen="join">
          <h2>Beitreten</h2>
          <div class="lobby-join">
            <input class="lobby-code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="CODE" />
            <button class="lobby-btn primary lobby-join-btn">An Bord</button>
          </div>
          <button class="lobby-btn subtle" data-go="multi">Zurück</button>
        </div>
        <div class="lobby-screen" data-screen="settings">
          <h2>Einstellungen</h2>
          <div class="lobby-sound">
            <span>Ton</span>
            <input class="lobby-volume" type="range" min="0" max="100" step="1" />
            <button class="lobby-mute" title="Ton an/aus (M)">🔊</button>
          </div>
          <button class="lobby-btn lobby-3d"></button>
          <button class="lobby-btn lobby-fullscreen">Vollbild</button>
          <div class="lobby-hint lobby-fs-hint"></div>
          <button class="lobby-btn subtle lobby-settings-back">Zurück</button>
        </div>
        <div class="lobby-screen" data-screen="pause">
          <h2 class="lobby-pause-title">Pause</h2>
          <div class="lobby-room"></div>
          <button class="lobby-btn primary lobby-back">Weiterspielen</button>
          <button class="lobby-btn lobby-share">Einladungslink teilen</button>
          <button class="lobby-btn" data-go="settings">Einstellungen</button>
          <button class="lobby-btn subtle lobby-leave">Zum Hauptmenü</button>
        </div>
        <div class="lobby-status"></div>
      </div>`;
    parent.appendChild(this.el);
    const q = <T extends Element>(sel: string) => this.el.querySelector(sel) as T;
    this.screens = Object.fromEntries([...this.el.querySelectorAll<HTMLDivElement>('.lobby-screen')].map((e) => [e.dataset.screen, e])) as Record<Screen, HTMLDivElement>;
    // the same rows appear on several screens: built once, moved where needed
    const mk = (html: string) => {
      const d = document.createElement('div');
      d.className = 'lobby-group';
      d.innerHTML = html;
      return d;
    };
    const modeGroup = mk(modeRow);
    const roleGroup = mk(roleRow);
    const shipGroup = mk(shipRow);
    q('.lobby-slot-mode').replaceWith(modeGroup);
    q('.lobby-slot-role').replaceWith(roleGroup);
    q('.lobby-slot-ship').replaceWith(shipGroup);
    this.moveGroups = (s: Screen) => {
      if (s === 'solo') {
        const sc = this.screens.solo;
        sc.insertBefore(shipGroup, sc.querySelector('.lobby-solo'));
        sc.insertBefore(roleGroup, shipGroup);
        sc.insertBefore(modeGroup, roleGroup);
      } else if (s === 'multi') this.screens.multi.insertBefore(roleGroup, this.screens.multi.querySelector('.lobby-online'));
      else if (s === 'host') {
        const sc = this.screens.host;
        sc.insertBefore(modeGroup, sc.querySelector('.lobby-hint'));
        sc.insertBefore(shipGroup, sc.querySelector('.lobby-hint'));
      }
    };
    q('.lobby-slot-role2').remove();
    q('.lobby-slot-mode2').remove();
    q('.lobby-slot-ship2').remove();

    this.codeInput = q<HTMLInputElement>('.lobby-code');
    this.status = q<HTMLDivElement>('.lobby-status');
    this.roomLabel = q<HTMLDivElement>('.lobby-room');
    const online = actions.serverUrl !== null;
    q<HTMLDivElement>('.lobby-online').style.display = online ? '' : 'none';
    q<HTMLDivElement>('.lobby-offline').style.display = online ? 'none' : '';

    this.el.querySelectorAll<HTMLButtonElement>('[data-go]').forEach((b) =>
      b.addEventListener('click', () => {
        const to = b.dataset.go as Screen;
        if (to === 'settings') this.settingsFrom = this.screen;
        this.go(to);
      }),
    );
    q<HTMLButtonElement>('.lobby-settings-back').addEventListener('click', () => this.go(this.settingsFrom));

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
    const roles = roleGroup.querySelector('.lobby-roles') as HTMLDivElement;
    for (const r of ROLES) {
      const b = document.createElement('button');
      b.className = 'lobby-seg-btn';
      b.textContent = ROLE_INFO[r].name;
      b.addEventListener('click', () => this.setRole(r));
      roles.appendChild(b);
      this.roleButtons.push(b);
    }
    const modes = modeGroup.querySelector('.lobby-modes') as HTMLDivElement;
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
    const nameInput = q<HTMLInputElement>('.lobby-name');
    nameInput.value = this.profile.name;
    nameInput.addEventListener('input', () => {
      const clean = sanitizeName(nameInput.value);
      if (clean !== nameInput.value.toUpperCase().trim()) nameInput.value = clean;
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
    q<HTMLButtonElement>('.lobby-yard').addEventListener('click', () => {
      this.hide();
      actions.shipyard();
    });
    q<HTMLButtonElement>('.lobby-share').addEventListener('click', () => void this.share());
    q<HTMLButtonElement>('.lobby-leave').addEventListener('click', () => {
      if (this.online) void actions.leave().then(() => this.show('start', 'Du hast das Schiff verlassen.'));
      else {
        actions.quitSolo();
        this.show('start');
      }
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
    const b3d = q<HTMLButtonElement>('.lobby-3d');
    if (view) {
      const sync3d = () => (b3d.textContent = `Stationen in 3D: ${view.stage3d ? 'an' : 'aus'}`);
      sync3d();
      b3d.addEventListener('click', () => {
        view.setStage3d(!view.stage3d);
        sync3d();
      });
    } else b3d.style.display = 'none';
    // full screen of the page: where the browser allows it, Esc stays with the game (hold Esc to leave)
    const fs = q<HTMLButtonElement>('.lobby-fullscreen');
    const fsHint = q<HTMLDivElement>('.lobby-fs-hint');
    const lockable = !!(navigator as Navigator & { keyboard?: { lock?: unknown } }).keyboard?.lock;
    const syncFs = () => {
      fs.textContent = document.fullscreenElement ? 'Vollbild beenden' : 'Vollbild';
      // iPhone: no full screen for pages - the web app from the home screen runs without the browser bars
      const ios = /iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      fsHint.textContent =
        ios && !standalone
          ? 'iPhone: Teilen → „Zum Home-Bildschirm“ – dann startet das Spiel ohne Browserleiste.'
          : lockable
            ? 'Im Vollbild öffnet Esc das Menü – zum Verlassen Esc gedrückt halten.'
            : 'Tab öffnet das Menü ebenfalls, ohne das Vollbild zu verlassen.';
    };
    fs.style.display = document.fullscreenEnabled ? '' : 'none';
    fs.addEventListener('click', () => void toggleFullscreen().then(syncFs));
    document.addEventListener('fullscreenchange', syncFs);
    syncFs();
    // keys typed into the menu must not steer the ship
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Tab' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement))) {
        if (e.key === 'Tab') e.preventDefault();
        this.escape();
      }
    });

    if (invitedCode && isRoomCode(invitedCode)) {
      this.codeInput.value = invitedCode;
      this.invited = true;
      this.setStatus(`Einladung zu Raum ${invitedCode} – Name eingeben und „An Bord“.`);
    }
  }

  private readonly moveGroups: (s: Screen) => void;
  /** Opened through an invitation link: the menu starts at "join". */
  private invited = false;

  get visible(): boolean {
    return !this.el.classList.contains('hidden');
  }

  private go(s: Screen): void {
    this.screen = s;
    this.moveGroups(s);
    for (const [k, e] of Object.entries(this.screens)) e.style.display = k === s ? '' : 'none';
    this.el.classList.toggle('lobby-main', s === 'main');
    if (s !== 'join' && s !== 'multi') this.setStatus('');
    if (s === 'pause') this.refreshPause();
    if (s === 'solo' || s === 'host') this.refreshShips();
    if (s === 'join') this.codeInput.focus();
  }

  /** Escape: one screen back; from the main menu nothing, from the pause menu back into the game. */
  private escape(): void {
    if (this.mode === 'ingame' && (this.screen === 'pause' || this.screen === 'settings')) {
      if (this.screen === 'settings') this.go('pause');
      else this.hide();
      return;
    }
    const back: Partial<Record<Screen, Screen>> = { solo: 'main', multi: 'main', host: 'multi', join: 'multi', settings: this.settingsFrom };
    const to = back[this.screen];
    if (to) this.go(to);
  }

  /**
   * @param mode start = the launch screen (main menu), ingame = the pause menu
   */
  show(mode: LobbyMode, message = '', error = false, online = this.online): void {
    this.mode = mode;
    this.online = online;
    this.el.classList.remove('hidden');
    this.el.classList.toggle('lobby-pause', mode === 'ingame');
    document.body.classList.add('lobby-open');
    this.syncSound();
    (this.el.querySelector('.lobby-best') as HTMLDivElement).textContent = bestLine();
    if (mode === 'ingame') {
      this.go('pause');
      this.actions.paused(true);
    } else if (this.invited) {
      this.invited = false;
      this.go('multi');
      this.go('join');
    } else this.go('main');
    if (message) this.setStatus(message, error);
  }

  hide(): void {
    const wasPause = this.mode === 'ingame' && this.visible;
    this.el.classList.add('hidden');
    document.body.classList.remove('lobby-open');
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (wasPause) this.actions.paused(false);
  }

  /** Escape / menu button while playing: the pause menu opens and closes; on the launch screen it stays. */
  toggle(online: boolean, playing = true): void {
    if (!playing) {
      if (!this.visible) this.show('start');
      else this.escape();
      return;
    }
    if (this.visible && this.mode === 'ingame') this.escape();
    else this.show('ingame', '', false, online);
  }

  private refreshPause(): void {
    const q = <T extends Element>(sel: string) => this.el.querySelector(sel) as T;
    q<HTMLElement>('.lobby-pause-title').textContent = this.online ? 'Menü' : 'Pause';
    this.roomLabel.style.display = this.online ? '' : 'none';
    this.roomLabel.innerHTML = `Raum <b>${this.roomCode}</b>Code an die anderen weitergeben`;
    q<HTMLElement>('.lobby-share').style.display = this.online ? '' : 'none';
    q<HTMLElement>('.lobby-leave').textContent = this.online ? 'Schiff verlassen' : 'Zum Hauptmenü';
  }

  /** The ship for new voyages: the standard one or one from the shipyard. */
  private refreshShips(): void {
    const select = this.el.querySelector('.lobby-ship-select') as HTMLSelectElement;
    const ships = this.actions.ships();
    select.innerHTML = ships.map((s, i) => `<option value="${i}"${s.current ? ' selected' : ''}>${s.name.replace(/[<&]/g, '')}</option>`).join('');
    select.onchange = () => {
      const s = ships[Number(select.value)];
      if (s && !s.current) this.actions.chooseShip(s.code);
    };
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
    return this.profile.name;
  }

  private async run(label: string, fn: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    if (!this.name()) {
      this.setStatus('Bitte zuerst einen Namen eingeben.', true);
      this.go('multi');
      (this.el.querySelector('.lobby-name') as HTMLInputElement).focus();
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
