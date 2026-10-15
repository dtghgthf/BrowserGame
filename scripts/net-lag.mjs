#!/usr/bin/env node
/**
 * Network feel check (needs `npm run dev` running): two headless browsers join
 * one room with an artificial round trip delay, player A walks, and the script
 * prints how fast A's own figure reacts and how much the server corrected.
 *
 *   node scripts/net-lag.mjs 200   # 200 ms round trip
 */
import { chromium } from 'playwright';
const lag = Number(process.argv[2] ?? 200);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];
async function open(name, q) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') logs.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`${name} pageerror: ${e.message}`));
  await page.goto(`http://localhost:5173/?quality=low&lag=${lag}${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game && !!window.__lobby, null, { timeout: 30000 });
  return page;
}
const a = await open('A', '');
await a.fill('.lobby-name', 'Anna');
await a.click('.lobby-create');
await a.waitForFunction(() => window.__game.net?.predictor.synced, null, { timeout: 15000 });
const code = await a.evaluate(() => window.__game.net.link.code);
const b = await open('B', '');
await b.fill('.lobby-name', 'Ben');
await b.fill('.lobby-code', code);
await b.click('.lobby-join-btn');
await b.waitForFunction(() => window.__game.net?.predictor.synced, null, { timeout: 15000 });
await sleep(1500);
const record = (page, who) => page.evaluate(([who, ms]) => new Promise((res) => {
  const g = window.__game; const id = g.sim.state.players.find((p) => p.name === who).id;
  const xs = []; const t0 = performance.now();
  const f = () => { const v = g.view.players.get(id); if (v) xs.push(v.x); if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(xs); };
  requestAnimationFrame(f);
}), [who, 2500]);
// A walks; record own view on A and remote view on B
const recA = record(a, 'ANNA');
const recB = record(b, 'ANNA');
await sleep(200);
const t0 = Date.now();
const respA = a.evaluate(() => new Promise((res) => { const g = window.__game; const id = g.net.link.sessionId; const x0 = g.view.players.get(id).x; const t = performance.now(); const f = () => { if (Math.abs(g.view.players.get(id).x - x0) > 0.05) res(performance.now() - t); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
await a.keyboard.down('KeyD'); await sleep(900); await a.keyboard.up('KeyD');
const response = await respA;
const [xa, xb] = await Promise.all([recA, recB]);
const jerk = (xs) => { let m = 0, back = 0; for (let i = 2; i < xs.length; i++) { m = Math.max(m, Math.abs(xs[i] - 2 * xs[i - 1] + xs[i - 2])); } for (let i = 1; i < xs.length; i++) if (xs[i] < xs[i - 1] - 0.01) back++; return { frames: xs.length, maxSecondDiff: m.toFixed(3), backSteps: back, dist: (xs[xs.length - 1] - xs[0]).toFixed(2) }; };
console.log('lag', lag, 'own response ms', Math.round(response));
console.log('A own', JSON.stringify(jerk(xa)));
console.log('B remote', JSON.stringify(jerk(xb)));
console.log('stats A', JSON.stringify(await a.evaluate(() => ({ ...window.__game.net.predictor.stats, rtt: window.__game.net.link.rtt, corr: window.__game.net.correction }))));
console.log(logs.slice(0, 10).join('\n'));
await browser.close();
