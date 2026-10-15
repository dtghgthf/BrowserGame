#!/usr/bin/env node
/**
 * `npm run dev`: starts the game server (Colyseus, port 2567) and the Vite dev
 * server (port 5173) together, with prefixed output. Ctrl+C stops both.
 */
import { spawn } from 'node:child_process';

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
