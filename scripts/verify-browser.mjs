#!/usr/bin/env node
/**
 * Browser verification: starts the game server and the Vite dev server (or
 * `--preview` for the production build), opens the game headless in Chromium
 * (and WebKit if it is installed), checks the console for errors, takes
 * screenshots of several scenes into screenshots/, plays a two-player online
 * round and measures the frame rate.
 *
 *   npm run verify               # dev server
 *   npm run verify -- --preview  # built client (run `npm run build` first)
 *   npm run verify -- --browsers=chromium,webkit
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'screenshots');
mkdirSync(outDir, { recursive: true });
const args = process.argv.slice(2);
const preview = args.includes('--preview');
const browsersArg = args.find((a) => a.startsWith('--browsers='));
const wanted = browsersArg ? browsersArg.split('=')[1].split(',') : ['chromium', 'webkit'];
const fpsSeconds = Number(args.find((a) => a.startsWith('--fps-seconds='))?.split('=')[1] ?? 8);
const port = preview ? 4173 : 5179;
const gamePort = 2599;
const url = `http://localhost:${port}/`;
const serverParam = `server=ws://localhost:${gamePort}`;

function startServer() {
  const cmd = preview ? ['vite', 'preview', '--port', String(port), '--strictPort'] : ['vite', '--port', String(port), '--strictPort'];
  const proc = spawn('npx', cmd, { cwd: join(root, 'client'), stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write(d));
  return proc;
}

function startGameServer() {
  const proc = spawn('npx', ['tsx', 'src/main.ts'], { cwd: join(root, 'server'), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PORT: String(gamePort), HOST: '127.0.0.1' } });
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', (d) => process.stderr.write(d));
  return proc;
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('dev server did not start');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Places the local player on a tile (feet on the floor of that tile row). */
async function placePlayer(page, tx, ty) {
  await page.evaluate(
    ([tx, ty]) => {
      const g = window.__game;
      const L = g.sim.layout;
      g.sim.teleportPlayer('p1', (tx + 0.5 - L.origin.x) * L.tileSize, (ty + 1 - L.origin.y) * L.tileSize - 0.66);
    },
    [tx, ty],
  );
}

async function runBrowser(name, launcher) {
  const result = { browser: name, ok: true, errors: [], warnings: [], screenshots: [], fps: null };
  let browser;
  try {
    browser = await launcher.launch({
      headless: true,
      args:
        name === 'chromium'
          ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
          : [],
    });
  } catch (e) {
    result.ok = false;
    result.skipped = true;
    result.errors.push(`could not launch ${name}: ${String(e.message).split('\n')[0]}`);
    return result;
  }
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') result.errors.push(text);
    else if (msg.type() === 'warning') result.warnings.push(text);
  });
  page.on('pageerror', (err) => result.errors.push(`pageerror: ${err.message}`));

  await page.goto(`${url}?sea=0.8&quality=high&solo&mode=single&stage3d=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
  const info = await page.evaluate(() => {
    const g = window.__game;
    const gl = g.r.renderer.gl;
    return {
      layout: g.r.layout,
      webgl: gl ? gl.getParameter(gl.VERSION) : 'n/a',
      renderer: gl ? gl.getParameter(gl.RENDERER) : 'n/a',
    };
  });
  result.info = info;

  const shot = async (file) => {
    const p = join(outDir, `${name}-${file}.png`);
    await page.screenshot({ path: p });
    result.screenshots.push(p);
  };
  const key = async (k) => {
    await page.keyboard.down(k);
    await sleep(60);
    await page.keyboard.up(k);
  };

  // 1) top deck at start
  await sleep(3000);
  await shot('01-oberdeck');

  // 2) lower deck: leak at the bow, water rising, spray from the leak
  await placePlayer(page, 55, 24);
  await page.evaluate(() => window.__game.command({ type: 'debugLeak', point: 3 }));
  await sleep(12000);
  await shot('02-unterdeck-leck');

  // 3) debug overlay (colliders, gravity vector, water surfaces, light polygons)
  await key('F3');
  await sleep(900);
  await shot('03-debug-overlay');
  await key('F3');

  // 4) light scene: mid deck between lanterns
  await placePlayer(page, 30, 18);
  await sleep(1500);
  await shot('04-licht-mitteldeck');

  // 5) intermediate buffers (F7): normals and light buffer
  await key('F7');
  await key('F7');
  await sleep(400);
  await shot('05-normal-buffer');
  await key('F7');
  await sleep(400);
  await shot('06-light-buffer');
  await key('F7');
  await key('F7');

  // 7) searchlight from the crow's nest, aimed down across the deck into the fog
  await placePlayer(page, 36, 3);
  await sleep(600);
  await key('KeyE');
  await page.keyboard.down('KeyD');
  await sleep(250);
  await page.keyboard.up('KeyD');
  await sleep(300);
  await placePlayer(page, 62, 12);
  await sleep(1800);
  await shot('07-scheinwerfer-nebel');

  // leave the searchlight, then: interactive steering wheel (dragged with the mouse)
  await key('KeyE');
  await page.evaluate(() => {
    const g = window.__game;
    const st = g.sim.state.stations.find((s) => s.kind === 'wheel');
    g.sim.teleportPlayer('p1', st.x, st.y - 0.66);
  });
  await sleep(500);
  await key('KeyE');
  await sleep(400);
  const box = await page.evaluate(() => {
    const r = window.__game.r;
    const c = r.renderer.canvas.getBoundingClientRect();
    return { x: c.left, y: c.top, w: c.width, h: c.height, lw: r.layout.width, lh: r.layout.height };
  });
  const at = (ix, iy) => ({ x: box.x + (ix / box.lw) * box.w, y: box.y + (iy / box.lh) * box.h });
  const wc = { x: box.lw / 2, y: box.lh - 60 };
  let a = -Math.PI / 2;
  const p0 = at(wc.x + Math.cos(a) * 22, wc.y + Math.sin(a) * 22);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (; a < 1.2; a += 0.15) {
    const p = at(wc.x + Math.cos(a) * 22, wc.y + Math.sin(a) * 22);
    await page.mouse.move(p.x, p.y);
    await sleep(30);
  }
  await sleep(600);
  await shot('09-steuerrad-widget');
  await page.mouse.up();
  result.wheelRudder = await page.evaluate(() => Math.round(window.__game.sim.state.ship.rudder * 100) / 100);
  await key('KeyE');

  // tuning panel (F9)
  await key('F9');
  await sleep(400);
  await shot('10-einstellungen');
  await key('F9');

  // phase 4: a rock ahead, spotted by the searchlight, on the sea chart
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.sim.state;
    s.voyage.nextRockX = 1e9;
    s.voyage.nextEncounterX = 1e9;
    s.rocks.length = 0;
    s.rocks.push({ id: 9001, x: s.ship.x + 30, lateral: s.ship.lateral, radius: 3, spotted: false, hit: false, kind: 'rock', hp: 1 });
    s.stations.find((x) => x.kind === 'searchlight').value = 0.32;
    // a calm moment: level ship, rudder amidships (the wheel test before turned it; heeled, the beam missed the rock)
    s.ship.rudder = 0;
    s.ship.heading = 0;
    s.stations.find((x) => x.kind === 'wheel').value = 0;
    g.command({ type: 'debugRoll', value: 0 });
    g.sim.teleportPlayer('p1', 13, -0.7);
  });
  await sleep(2500);
  result.rockSpotted = await page.evaluate(() => window.__game.sim.state.rocks.some((r) => r.spotted));
  await page.evaluate(() => window.__game.command({ type: 'debugRoll', value: null }));
  await shot('13-felsen-scheinwerfer');

  // the kraken attacks the bow, the cannon fires at it
  await page.evaluate(() => {
    const g = window.__game;
    g.sim.state.rocks.length = 0;
    g.sim.state.monster = { offset: 19, depth: 0, hp: 3, phase: 'attack', timer: 0, attackIn: 5, spotted: true, hurt: 0 };
    const st = g.sim.state.stations.find((x) => x.kind === 'cannon');
    // loaded (loading has its own tests; here we check that F fires)
    st.charge = 2;
    g.sim.teleportPlayer('p1', st.x, st.y - 0.66);
  });
  await sleep(400);
  await key('KeyE');
  await sleep(300);
  await key('KeyF');
  await sleep(300);
  // the ball may already have hit the kraken (it is close): fired = a ball in the air or the cannon reloading
  result.cannonFired = await page.evaluate(() => {
    const s = window.__game.sim.state;
    return s.balls.length > 0 || s.stations.find((x) => x.kind === 'cannon').charge < 2;
  });
  await shot('14-krake-kanone');
  await key('KeyE');

  // arrival at the lighthouse
  await page.evaluate(() => {
    const g = window.__game;
    const s = g.sim.state;
    s.monster = null;
    s.ship.x = s.voyage.length - 2;
    g.sim.teleportPlayer('p1', 4, -0.7);
  });
  await sleep(2500);
  result.arrived = await page.evaluate(() => window.__game.sim.state.status);
  await shot('15-ankunft');
  await page.evaluate(() => window.__game.command({ type: 'reset' }));

  // 2.5D station view: helm, pump, cannon, opening a crate
  await page.evaluate(() => {
    const g = window.__game;
    g.stage3d = true;
    g.autoQuality = false;
    g.r.setQuality('high');
  });
  for (const [kind, file] of [
    ['wheel', '16-3d-steuerrad'],
    ['pump', '17-3d-pumpe'],
    ['cannon', '18-3d-kanone'],
  ]) {
    await page.evaluate((k) => {
      const g = window.__game;
      const st = g.sim.state.stations.find((x) => x.kind === k);
      g.sim.teleportPlayer('p1', st.x, st.y - 0.68);
    }, kind);
    await sleep(500);
    await key('KeyE');
    await sleep(1300);
    await shot(file);
    await key('KeyE');
    await sleep(900);
  }
  await page.evaluate(() => {
    const g = window.__game;
    const c = g.sim.state.objects.find((o) => o.kind === 'crate' && !o.opened);
    c.contents = ['plank', 'coins'];
    g.sim.teleportPlayer('p1', c.x - 0.7, c.y - 0.3);
  });
  await sleep(500);
  await key('KeyE');
  for (let i = 0; i < 6; i++) await key(i % 2 ? 'KeyA' : 'KeyD');
  await sleep(1400);
  await shot('19-3d-kiste');
  result.crateOpened = await page.evaluate(() => window.__game.sim.state.voyage.cratesOpened);
  await sleep(2500);

  // campaign: the start harbour and the chart table
  await page.evaluate(() => window.__game.startSolo('none', 'campaign'));
  await sleep(1500);
  await placePlayer(page, 50, 12);
  await sleep(1200);
  await shot('20-hafen');
  await placePlayer(page, 19, 18);
  await sleep(500);
  await key('KeyE');
  await sleep(1400);
  await shot('21-kartentisch');
  await key('KeyE');
  result.campaign = await page.evaluate(() => ({ status: window.__game.sim.state.campaign.mode, legs: window.__game.sim.state.campaign.nodes.length }));
  await page.evaluate(() => window.__game.startSolo('none', 'single'));
  await page.evaluate(() => {
    window.__game.stage3d = false;
  });

  // 8) frame rate per quality level (top deck, 1920x1080)
  await placePlayer(page, 20, 12);
  result.fps = {};
  for (const q of ['high', 'medium', 'low']) {
    await page.evaluate((q) => {
      const g = window.__game;
      g.autoQuality = false;
      g.r.setQuality(q);
      g.perf.samples.length = 0;
    }, q);
    await sleep(fpsSeconds * 1000);
    result.fps[q] = await page.evaluate(() => {
      const s = window.__game.perf.samples.slice(1);
      const avg = s.reduce((a, b) => a + b, 0) / Math.max(s.length, 1);
      return { avg: Math.round(avg * 10) / 10, min: Math.round(Math.min(...s) * 10) / 10, samples: s.length };
    });
  }

  result.state = await page.evaluate(() => {
    const s = window.__game.sim.state;
    return {
      tick: s.tick,
      water: s.compartments.map((c) => Math.round(c.volume * 100) / 100),
      leaks: s.leaks.filter((l) => l.active).length,
      roll: Math.round((s.ship.roll * 1800) / Math.PI) / 10,
    };
  });
  // 9) the shipyard: the standard ship loads, passes the check, the Kutter template too
  const ep = await context.newPage();
  ep.on('pageerror', (err) => result.errors.push(`editor pageerror: ${err.message}`));
  await ep.goto(`${url}?editor`, { waitUntil: 'load' });
  await ep.waitForSelector('.ed-canvas', { timeout: 30000 });
  await sleep(1500);
  const epath = join(outDir, `${name}-22-werft.png`);
  await ep.screenshot({ path: epath });
  result.screenshots.push(epath);
  await ep.selectOption('.ed-template', 'kutter');
  await sleep(800);
  result.editor = await ep.evaluate(() => ({
    check: document.querySelector('.ed-issues')?.textContent ?? '',
    name: document.querySelector('.ed-name')?.value ?? '',
  }));
  await ep.close();

  // 10) iPad-like touch device: on-screen controls must appear
  const touchCtx = await browser.newContext({ viewport: { width: 1080, height: 810 }, deviceScaleFactor: 2, hasTouch: true, isMobile: name === 'chromium' });
  const tp = await touchCtx.newPage();
  tp.on('pageerror', (err) => result.errors.push(`touch pageerror: ${err.message}`));
  await tp.goto(`${url}?sea=0.8&quality=high&solo&mode=single`, { waitUntil: 'load' });
  await tp.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
  await sleep(2500);
  result.touch = await tp.evaluate(() => ({
    controlsVisible: getComputedStyle(document.querySelector('.touch')).display !== 'none',
    pingButton: !!document.querySelector('.btn-ping'),
    layout: window.__game.r.layout,
  }));
  const tpath = join(outDir, `${name}-08-touch-ipad.png`);
  await tp.screenshot({ path: tpath });
  result.screenshots.push(tpath);
  await touchCtx.close();

  // 10) online: lobby, one player opens a ship, a second one comes aboard with the code
  result.online = await playOnline(browser, name, result);

  await browser.close();
  result.ok = result.errors.length === 0;
  return result;
}

async function playOnline(browser, name, result) {
  const open = async (who) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') result.errors.push(`${who}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => result.errors.push(`${who} pageerror: ${err.message}`));
    await page.goto(`${url}?quality=medium&${serverParam}`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__game && !!window.__lobby, null, { timeout: 30000 });
    return { ctx, page };
  };
  const a = await open('A');
  await a.page.fill('.lobby-name', 'Anna');
  await sleep(600);
  const lobbyShot = join(outDir, `${name}-11-lobby.png`);
  await a.page.screenshot({ path: lobbyShot });
  result.screenshots.push(lobbyShot);
  await a.page.click('.lobby-create');
  await a.page.waitForFunction(() => window.__game.net?.predictor.synced, null, { timeout: 15000 });
  const code = await a.page.evaluate(() => window.__game.net.link.code);
  const b = await open('B');
  await b.page.fill('.lobby-name', 'Ben');
  await b.page.fill('.lobby-code', code);
  await b.page.click('.lobby-join-btn');
  await b.page.waitForFunction(() => window.__game.net?.predictor.synced, null, { timeout: 15000 });
  await sleep(1500);
  await a.page.keyboard.down('KeyD');
  await sleep(500);
  await a.page.keyboard.up('KeyD');
  await sleep(1200);
  // Ben pings a spot on deck (right click); Anna sees the marker
  await b.page.mouse.click(700, 330, { button: 'right' });
  await a.page.waitForFunction(() => window.__game.sim.state.pings.length > 0, null, { timeout: 5000 }).catch(() => {});
  const pingSeen = await a.page.evaluate(() => window.__game.sim.state.pings.map((p) => p.kind));
  await sleep(150);
  const shot = join(outDir, `${name}-12-mehrspieler.png`);
  await b.page.screenshot({ path: shot });
  result.screenshots.push(shot);
  const seen = await b.page.evaluate(() => {
    const g = window.__game;
    return { players: g.sim.state.players.map((p) => p.name), rtt: g.net.link.rtt, stats: g.net.predictor.stats };
  });
  await a.ctx.close();
  await b.ctx.close();
  return { code, pingSeen, ...seen };
}

const gameServer = startGameServer();
const server = startServer();
let exitCode = 0;
try {
  await waitForServer();
  const results = [];
  for (const b of wanted) {
    const launcher = b === 'webkit' ? webkit : chromium;
    console.log(`\n== ${b}`);
    const r = await runBrowser(b, launcher);
    results.push(r);
    console.log(JSON.stringify({ ...r, warnings: r.warnings.slice(0, 5) }, null, 2));
    if (!r.ok && !r.skipped) exitCode = 1;
  }
  writeFileSync(join(outDir, 'verify-report.json'), JSON.stringify(results, null, 2));
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  server.kill('SIGTERM');
  gameServer.kill('SIGTERM');
}
process.exit(exitCode);
