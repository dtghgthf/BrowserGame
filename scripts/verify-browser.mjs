#!/usr/bin/env node
/**
 * Browser verification: starts the Vite dev server (or `--preview` for the
 * production build), opens the game headless in Chromium (and WebKit if it is
 * installed), checks the console for errors, takes screenshots of several
 * scenes into screenshots/ and measures the frame rate.
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
const url = `http://localhost:${port}/`;

function startServer() {
  const cmd = preview ? ['vite', 'preview', '--port', String(port), '--strictPort'] : ['vite', '--port', String(port), '--strictPort'];
  const proc = spawn('npx', cmd, { cwd: join(root, 'client'), stdio: ['ignore', 'pipe', 'pipe'] });
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

  await page.goto(`${url}?sea=0.8&quality=high`, { waitUntil: "load" });
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

  // 2) lower deck with a leak, water rising
  await placePlayer(page, 50, 24);
  await key('KeyL');
  await sleep(9000);
  await shot('02-unterdeck-leck');

  // 3) debug overlay (colliders, gravity, water, light polygons)
  await key('F3');
  await sleep(900);
  await shot('03-debug-overlay');
  await key('F3');

  // 4) light scene: mid deck between lanterns
  await placePlayer(page, 30, 18);
  await sleep(1500);
  await shot('04-licht-mitteldeck');

  // 5) searchlight sweeping the fog from the crow's nest
  await placePlayer(page, 36, 3);
  await sleep(600);
  await key('KeyE');
  await page.keyboard.down('KeyD');
  await sleep(700);
  await page.keyboard.up('KeyD');
  await sleep(1200);
  await shot('05-scheinwerfer-nebel');
  await key('KeyE');

  // 6) frame rate over a few seconds on the top deck
  await placePlayer(page, 20, 12);
  await sleep(500);
  await page.evaluate(() => {
    window.__game.perf.samples.length = 0;
  });
  await sleep(fpsSeconds * 1000);
  result.fps = await page.evaluate(() => {
    const s = window.__game.perf.samples.slice(1);
    const avg = s.reduce((a, b) => a + b, 0) / Math.max(s.length, 1);
    return { avg: Math.round(avg * 10) / 10, min: Math.round(Math.min(...s) * 10) / 10, samples: s.length };
  });

  result.state = await page.evaluate(() => {
    const s = window.__game.sim.state;
    return {
      tick: s.tick,
      water: s.compartments.map((c) => Math.round(c.volume * 100) / 100),
      leaks: s.leaks.filter((l) => l.active).length,
      roll: Math.round((s.ship.roll * 1800) / Math.PI) / 10,
    };
  });
  await browser.close();
  result.ok = result.errors.length === 0;
  return result;
}

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
}
process.exit(exitCode);
