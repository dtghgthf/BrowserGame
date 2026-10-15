import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const FILES = {
  shared: `${here}../shared/src/tuning.json`,
  look: `${here}src/look.json`,
} as const;

/**
 * Keeps only keys that already exist in the target file and only finite
 * numbers, so nothing but tuning values can ever be written.
 */
function sanitize(existing: unknown, incoming: unknown): unknown {
  if (typeof existing === 'number') return typeof incoming === 'number' && Number.isFinite(incoming) ? incoming : existing;
  if (!existing || typeof existing !== 'object') return existing;
  const out: Record<string, unknown> = {};
  const inc = (incoming && typeof incoming === 'object' ? incoming : {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(existing as Record<string, unknown>)) out[k] = sanitize(v, inc[k]);
  return out;
}

/**
 * Dev-server endpoint for the in-game tuning panel: POST /__tuning writes the
 * current values as the new defaults into shared/src/tuning.json and
 * client/src/look.json (Vite then reloads the page with the new defaults).
 * Only active in `npm run dev`, never in a production build.
 */
function tuningSaver(): Plugin {
  return {
    name: 'lw-tuning-saver',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__tuning', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 64_000) req.destroy();
        });
        req.on('end', () => {
          try {
            const data = JSON.parse(body) as Record<string, unknown>;
            for (const [key, file] of Object.entries(FILES)) {
              if (!existsSync(file) || !data[key]) continue;
              const existing = JSON.parse(readFileSync(file, 'utf8')) as unknown;
              writeFileSync(file, `${JSON.stringify(sanitize(existing, data[key]), null, 2)}\n`);
            }
            res.setHeader('content-type', 'application/json');
            res.end('{"ok":true}');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [tuningSaver()],
  server: {
    host: true,
    port: 5173,
    // never silently move to 5174: an old dev server on 5173 would keep serving stale code
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4000,
  },
});
