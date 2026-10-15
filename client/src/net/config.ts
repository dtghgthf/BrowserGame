import { DEFAULT_SERVER_PORT } from '@lw/shared';

/** Turns http(s)/ws(s)/bare host strings into a WebSocket base URL. */
export function normalizeServerUrl(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(s)) s = 'wss://' + s.slice(8);
  else if (/^http:\/\//i.test(s)) s = 'ws://' + s.slice(7);
  else if (!/^wss?:\/\//i.test(s)) s = 'wss://' + s;
  return s;
}

/**
 * Where the game server lives, in this order:
 * 1. `?server=...` in the page URL (testing a laptop server or a tunnel),
 * 2. VITE_SERVER_URL at build time (set it in Vercel's environment variables),
 * 3. in `npm run dev`: the same machine on port 2567 (works from an iPad in the same WLAN),
 * otherwise null: online play is not available.
 */
export function resolveServerUrl(params: URLSearchParams, env: { DEV: boolean; VITE_SERVER_URL?: string }, loc: { protocol: string; hostname: string }): string | null {
  const fromUrl = params.get('server');
  if (fromUrl) return normalizeServerUrl(fromUrl);
  if (env.VITE_SERVER_URL) return normalizeServerUrl(env.VITE_SERVER_URL);
  if (env.DEV) return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.hostname}:${DEFAULT_SERVER_PORT}`;
  return null;
}
