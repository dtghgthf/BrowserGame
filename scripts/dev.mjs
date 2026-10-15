#!/usr/bin/env node
/**
 * `npm run dev`: starts the game server (Colyseus, port 2567) and the Vite dev
 * server (port 5173) together, with prefixed output. Ctrl+C stops both.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * After a `git pull` with new dependencies the dev server would fail with
 * "Failed to resolve import". Install first if packages are missing or the
 * lockfile is newer than the last install.
 */
function ensureDependencies() {
  const installed = join(root, 'node_modules', '.package-lock.json');
  const lock = join(root, 'package-lock.json');
  const stale = !existsSync(installed) || statSync(lock).mtimeMs > statSync(installed).mtimeMs + 1000;
  const missing = [
    ['client', '@colyseus/sdk'],
    ['client', 'pixi.js'],
    ['server', '@colyseus/core'],
    ['shared', '@dimforge/rapier2d-compat'],
  ].filter(([ws, pkg]) => !existsSync(join(root, ws, 'node_modules', pkg, 'package.json')) && !existsSync(join(root, 'node_modules', pkg, 'package.json')));
  if (!stale && missing.length === 0) return;
  console.log(`[dev] Abhängigkeiten fehlen oder sind veraltet${missing.length ? ` (${missing.map((m) => m[1]).join(', ')})` : ''} – führe npm install aus …`);
  const r = spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
  // Vite's pre-bundled dependencies are rebuilt from scratch
  rmSync(join(root, 'node_modules', '.vite'), { recursive: true, force: true });
  rmSync(join(root, 'client', 'node_modules', '.vite'), { recursive: true, force: true });
}

/** Resolves true if nothing listens on the port yet. */
function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '0.0.0.0');
  });
}

/**
 * An old `npm run dev` still running (e.g. in another terminal tab) keeps
 * serving the old code - with errors like "Failed to resolve import" after a
 * pull. Stop with a clear message instead of starting a second copy.
 */
async function ensurePortsFree() {
  const busy = [];
  for (const port of [5173, 2567]) if (!(await portFree(port))) busy.push(port);
  if (busy.length === 0) return;
  console.error(`\n[dev] Port ${busy.join(' und ')} ist schon belegt – da läuft noch ein alter Dev-Server.`);
  console.error('[dev] Alten Server beenden (Strg+C im anderen Terminal) oder:');
  console.error(`[dev]   lsof -ti ${busy.map((p) => `:${p}`).join(' ')} | xargs kill`);
  console.error('[dev] Danach npm run dev erneut starten.\n');
  process.exit(1);
}

ensureDependencies();
await ensurePortsFree();

const procs = [
  { name: 'server', color: 36, args: ['run', 'dev', '-w', '@lw/server'] },
  { name: 'client', color: 33, args: ['run', 'dev', '-w', '@lw/client'] },
].map(({ name, color, args }) => {
  const p = spawn('npm', args, { stdio: ['inherit', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let rest = '';
    stream.on('data', (d) => {
      const lines = (rest + d.toString()).split('\n');
      rest = lines.pop() ?? '';
      for (const l of lines) out.write(prefix + l + '\n');
    });
  };
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code) => {
    console.log(`${prefix}exited (${code ?? 'signal'})`);
    shutdown();
  });
  return p;
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
