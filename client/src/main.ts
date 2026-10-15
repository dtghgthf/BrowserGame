import { Simulation } from '@lw/shared';
import { Game } from './game/Game';
import { Keyboard } from './input/Keyboard';
import { TouchControls } from './input/TouchControls';
import { configureTextureDefaults, loadImageLayer, loadSheet } from './render/assets';
import { GameRenderer, type Quality } from './render/GameRenderer';
import { PixelFont } from './ui/PixelFont';

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
      Simulation.create({ seed: Number(params.get('seed')) || 1337, seaState: params.has('sea') ? Number(params.get('sea')) : 0.75 }),
      GameRenderer.create(host, quality),
      loadImageLayer('assets/ship_hull.png'),
      loadImageLayer('assets/ship_back.png'),
      loadSheet('assets/player', { coat: 'assets/player_coat.png' }),
      loadSheet('assets/props'),
    ]);
    const font = new PixelFont();
    const keyboard = new Keyboard();
    const touch = new TouchControls(document.body);
    const game = new Game(sim, renderer, { hull, back, player, props }, font, keyboard, touch, document.body);
    window.__game = game;
    game.autoQuality = !forced;
    if (params.has('debug')) game.debug.toggle();
    if (params.has('p2')) game.addLocalPlayer('secondary');
    window.addEventListener('resize', () => renderer.resize(host));
    status.remove();
    setupHelp();
    game.start();
  } catch (err) {
    console.error(err);
    status.textContent = `Fehler beim Start: ${err instanceof Error ? err.message : String(err)}. WebGL2 wird benötigt.`;
    status.classList.add('error');
  }
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
