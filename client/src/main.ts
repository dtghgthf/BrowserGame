import { DEFAULT_TUNING, Simulation, dailySeed, diffTuning, normalizeRoomCode, parseMode, type GameMode, type TuningPatch } from '@lw/shared';
import { AudioEngine } from './audio/AudioEngine';
import { GameAudio } from './audio/GameAudio';
import { Game, saveStage3d } from './game/Game';
import { resolveServerUrl } from './net/config';
import { NetLink } from './net/NetLink';
import { Keyboard } from './input/Keyboard';
import { TouchControls } from './input/TouchControls';
import { configureTextureDefaults, loadImageLayer, loadSheet } from './render/assets';
import { GameRenderer, type Quality } from './render/GameRenderer';
import { Lobby } from './ui/Lobby';
import { PixelFont } from './ui/PixelFont';
import { TuningPanel } from './ui/TuningPanel';

declare global {
  interface Window {
    /** Handle for automated tests and console debugging. */
    __game?: Game;
  }
}

async function boot(): Promise<void> {
  const host = document.getElementById('game')!;
  const status = document.getElementById('status')!;
  try {
    configureTextureDefaults();
    const params = new URLSearchParams(location.search);
    const forced = params.get('quality');
    const quality: Quality = forced === 'low' || forced === 'medium' || forced === 'high' ? forced : 'high';
    const [sim, renderer, hull, back, player, props] = await Promise.all([
      Simulation.create({
        mode: parseMode(params.get('mode') ?? 'campaign'),
        seed: Number(params.get('seed')) || (params.get('mode') === 'daily' ? dailySeed(new Date()) : Math.floor(Math.random() * 2 ** 31)),
        seaState: params.has('sea') ? Number(params.get('sea')) : undefined,
      }),
      GameRenderer.create(host, quality),
      loadImageLayer('assets/ship_hull.png'),
      loadImageLayer('assets/ship_back.png'),
      loadSheet('assets/player', { coat: 'assets/player_coat.png' }),
      loadSheet('assets/props'),
    ]);
    const font = new PixelFont();
    const keyboard = new Keyboard();
    const touch = new TouchControls(document.body, props, () => renderer.layout.scale / (window.devicePixelRatio || 1));
    const game = new Game(sim, renderer, { hull, back, player, props }, font, keyboard, touch, document.body);
    window.__game = game;
    const audio = new GameAudio(new AudioEngine(), sim);
    game.audio = audio;
    game.storm.onLightning = (strength) => audio.thunder(strength);
    game.autoQuality = !forced;
    if (params.has('debug')) game.debug.toggle();
    if (params.has('p2')) game.addLocalPlayer('secondary');
    if (params.get('stage3d') === '0') game.stage3d = false;
    game.tuningPanel = new TuningPanel(
      {
        tuning: sim.baseTuning,
        look: renderer.look,
        tune: (patch) => game.command({ type: 'tune', patch }),
        setSeaState: (value) => game.command({ type: 'seaState', value }),
      },
      import.meta.env.DEV || params.has('tune') || params.has('debug'),
    );
    if (params.has('tune')) game.tuningPanel.toggle(true);
    window.addEventListener('resize', () => {
      renderer.resize(host);
      touch.relayout();
    });
    status.remove();
    setupHelp();
    game.start();
    await setupOnline(game, sim, params, audio.engine);
  } catch (err) {
    console.error(err);
    status.textContent = `Fehler beim Start: ${err instanceof Error ? err.message : String(err)}. WebGL2 wird benötigt.`;
    status.classList.add('error');
  }
}

/** Lobby, room code in the URL, reconnect after a reload. */
async function setupOnline(game: Game, sim: Simulation, params: URLSearchParams, sound: AudioEngine): Promise<void> {
  const serverUrl = resolveServerUrl(params, import.meta.env, location);
  const lag = Number(params.get('lag')) || 0;
  const setRoomInUrl = (code: string | null) => {
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    history.replaceState(null, '', url);
  };
  const hasKeys = (p: TuningPatch) => Object.values(p).some((g) => g && Object.keys(g).length > 0);

  const enter = (link: NetLink, opened: boolean) => {
    // values tuned on this device travel with the person who opens the ship
    const local = diffTuning(DEFAULT_TUNING, sim.baseTuning);
    game.goOnline(link);
    if (opened && hasKeys(local)) link.sendCommand({ type: 'tune', patch: local });
    lobby.roomCode = link.code;
    setRoomInUrl(link.code);
    lobby.hide();
  };

  const lobby = new Lobby(
    document.body,
    {
      serverUrl,
      create: async (name, color, role, mode) => enter(await NetLink.create(serverUrl!, name, color, role, mode, lag), true),
      join: async (code, name, color, role) => enter(await NetLink.join(serverUrl!, code, name, color, role, lag), false),
      solo: (role, mode) => {
        setRoomInUrl(null);
        game.startSolo(role, mode);
      },
      leave: async () => {
        const link = game.net?.link;
        game.goOffline();
        setRoomInUrl(null);
        await link?.leave();
      },
    },
    normalizeRoomCode(params.get('room') ?? '') || null,
    sound,
    {
      get stage3d() {
        return game.stage3d;
      },
      setStage3d(on: boolean) {
        game.stage3d = on;
        saveStage3d(on);
      },
    },
  );
  game.onNetClosed = (reason) => {
    setRoomInUrl(null);
    lobby.show('start', `Verbindung zum Schiff verloren${reason ? ` (${reason})` : ''}.`, true);
  };

  // menu: Escape or the ☰ button
  const menu = document.createElement('button');
  menu.className = 'menu-btn allow-touch';
  menu.textContent = '☰';
  menu.title = 'Menü (Esc)';
  menu.addEventListener('click', () => lobby.toggle(game.net !== null));
  document.body.appendChild(menu);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.repeat) lobby.toggle(game.net !== null);
  });
  (window as { __lobby?: Lobby }).__lobby = lobby;

  if (params.has('solo')) return;
  if (serverUrl) {
    // a reload in the middle of a game: continue the same seat
    const resumed = await NetLink.resume(serverUrl, lag);
    if (resumed) {
      enter(resumed, false);
      return;
    }
  }
  lobby.show('start');
}

function setupHelp(): void {
  const help = document.getElementById('help');
  if (!help) return;
  const hide = () => help.classList.add('hidden');
  window.setTimeout(hide, 9000);
  window.addEventListener('keydown', hide, { once: true });
  window.addEventListener('pointerdown', hide, { once: true });
}

void boot();
