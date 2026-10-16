import { DEFAULT_TUNING, Simulation, dailySeed, diffTuning, layoutFromDesign, normalizeRoomCode, parseMode, type TuningPatch } from '@lw/shared';
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
import { shipLayers } from './render/procedural/shipTextures';
import { playable, resolveShip, savedShips, setCurrentShip } from './ships';
import { Editor } from './editor/Editor';
import { decodeDesign, DEFAULT_DESIGN } from '@lw/shared';

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
    // the ship: the standard one (hand-made art) or one from the editor (art drawn now)
    const ship = resolveShip(params);
    const layout = ship.code ? layoutFromDesign(ship.design) : undefined;
    const generated = layout ? shipLayers(layout, ship.design.decorOff) : null;
    const [sim, renderer, hull, back, player, props] = await Promise.all([
      Simulation.create({
        layout,
        mode: parseMode(params.get('mode') ?? 'campaign'),
        seed: Number(params.get('seed')) || (params.get('mode') === 'daily' ? dailySeed(new Date()) : Math.floor(Math.random() * 2 ** 31)),
        seaState: params.has('sea') ? Number(params.get('sea')) : undefined,
      }),
      GameRenderer.create(host, quality),
      generated ? Promise.resolve(generated.hull) : loadImageLayer('assets/ship_hull.png'),
      generated ? Promise.resolve(generated.back) : loadImageLayer('assets/ship_back.png'),
      loadSheet('assets/player', { coat: 'assets/player_coat.png' }),
      loadSheet('assets/props'),
    ]);
    const font = new PixelFont();
    const keyboard = new Keyboard();
    const touch = new TouchControls(document.body, props, () => renderer.layout.scale / (window.devicePixelRatio || 1));
    const game = new Game(sim, renderer, { hull, back, player, props }, font, keyboard, touch, document.body);
    window.__game = game;
    game.designCode = ship.code;
    game.designName = ship.design.name;
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
    // follow every change of the window: resize events alone miss some (Safari full screen transitions, moving to a
    // screen with another pixel density, rotating a phone), so the size is also compared once per frame
    let seen = '';
    let checked = 0;
    const fit = () => {
      const r = host.getBoundingClientRect();
      const key = `${Math.round(r.width)}x${Math.round(r.height)}@${window.devicePixelRatio}`;
      // a few times a second: the canvas itself still matches (else apply everything again)
      const now = performance.now();
      const verify = now - checked > 250;
      if (key === seen && !verify) return;
      if (verify) checked = now;
      const stale = verify && renderer.outOfShape();
      if (key === seen && !stale) return;
      seen = key;
      renderer.resize(host, stale);
      touch.relayout();
    };
    for (const ev of ['resize', 'orientationchange', 'fullscreenchange'] as const) window.addEventListener(ev, fit);
    document.addEventListener('fullscreenchange', fit);
    window.visualViewport?.addEventListener('resize', fit);
    new ResizeObserver(fit).observe(host);
    const watch = () => {
      fit();
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
    status.remove();
    setupHelp();
    setupPhone(game);
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
      create: async (name, color, role, mode) => enter(await NetLink.create(serverUrl!, name, color, role, mode, game.designCode, lag), true),
      join: async (code, name, color, role) => enter(await NetLink.join(serverUrl!, code, name, color, role, lag), false),
      solo: (role, mode) => {
        setRoomInUrl(null);
        game.startSolo(role, mode);
      },
      shipName: () => game.designName || 'Leuchtturmwärter',
      ships: () => {
        const list = savedShips().filter((s) => playable(s.code));
        const cur = game.designCode;
        const out = [{ name: 'Leuchtturmwärter (Standard)', code: null as string | null, current: !cur }];
        for (const s of list) out.push({ name: s.name, code: s.code, current: s.code === cur });
        // a ship from a link that is not saved here still shows up
        if (cur && !list.some((s) => s.code === cur)) out.push({ name: game.designName || 'Geteiltes Schiff', code: cur, current: true });
        return out;
      },
      chooseShip: (code) => {
        // the hull art is drawn at start: a different ship means a reload
        setCurrentShip(code);
        const url = new URL(location.href);
        url.search = '';
        location.assign(url.toString());
      },
      shipyard: () => openShipyard(),
      leave: async () => {
        const link = game.net?.link;
        game.goOffline();
        setRoomInUrl(null);
        await link?.leave();
        game.startShowcase();
      },
      quitSolo: () => game.startShowcase(),
      paused: (on) => (game.paused = on && !game.net),
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
  // the shipyard: an overlay over the game; trying a ship or choosing it reloads the page with it
  let editor: Editor | null = null;
  const openShipyard = () => {
    if (editor) return;
    const start = (game.designCode && decodeDesign(game.designCode)) || DEFAULT_DESIGN;
    editor = new Editor(
      document.body,
      {
        test: (code) => {
          const url = new URL(location.href);
          url.search = '';
          url.searchParams.set('ship', code);
          url.searchParams.set('solo', '');
          url.searchParams.set('mode', 'single');
          location.assign(url.toString());
        },
        use: (code) => {
          setCurrentShip(code);
          const url = new URL(location.href);
          url.search = '';
          location.assign(url.toString());
        },
        close: () => {
          editor?.destroy();
          editor = null;
          if (game.playing) lobby.show('ingame', '', false, game.net !== null);
          else lobby.show('start');
        },
      },
      start,
    );
  };
  if (params.has('editor')) {
    openShipyard();
    return;
  }

  // the room sails another ship than this page shows: reload with that ship and take the same seat again
  game.onDesignMismatch = (design, room) => {
    const url = new URL(location.href);
    url.searchParams.set('ship', design ?? 'standard');
    url.searchParams.set('room', room);
    url.searchParams.delete('solo');
    location.replace(url.toString());
  };
  game.onNetClosed = (reason) => {
    setRoomInUrl(null);
    game.startShowcase();
    lobby.show('start', `Verbindung zum Schiff verloren${reason ? ` (${reason})` : ''}.`, true);
  };

  // menu: Escape or the ☰ button
  const menu = document.createElement('button');
  menu.className = 'menu-btn allow-touch';
  menu.textContent = '☰';
  menu.title = 'Menü (Esc)';
  menu.addEventListener('click', () => lobby.toggle(game.net !== null, game.playing));
  document.body.appendChild(menu);
  // waiting for the crew in the harbour: the host casts off with a button on screen
  const castOff = document.createElement('button');
  castOff.className = 'castoff-btn allow-touch';
  castOff.textContent = 'Ablegen – alle da!';
  castOff.addEventListener('click', () => {
    game.command({ type: 'castOff' });
    castOff.style.display = 'none';
  });
  document.body.appendChild(castOff);
  const syncCastOff = () => {
    const s = game.sim.state;
    castOff.style.display = game.isHost && s.status === 'harbor' && s.hold && !lobby.visible ? '' : 'none';
    requestAnimationFrame(syncCastOff);
  };
  syncCastOff();
  // Esc or Tab: Tab never leaves the browser's full screen (Safari cannot keep Esc for the page)
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (e.key === 'Tab' && !typing) e.preventDefault();
    if ((e.key === 'Escape' || (e.key === 'Tab' && !typing)) && !e.repeat) lobby.toggle(game.net !== null, game.playing);
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
  // the launch screen over the menu scene
  game.startShowcase();
  lobby.show('start');
}

/**
 * Phones: landscape only. Upright shows a "turn the phone" card (and holds solo
 * play); where the browser allows it (Android), the first tap goes full screen
 * and locks the orientation to landscape.
 */
function setupPhone(game: Game): void {
  const upright = window.matchMedia('(orientation: portrait) and (pointer: coarse)');
  const sync = () => (game.upright = upright.matches);
  upright.addEventListener('change', sync);
  sync();
  const phone = Math.min(screen.width, screen.height) < 600 && window.matchMedia('(pointer: coarse)').matches;
  if (!phone || !document.fullscreenEnabled) return;
  const go = () => {
    if (document.fullscreenElement) return;
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => {});
  };
  window.addEventListener('pointerup', go, { once: true });
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
