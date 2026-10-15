/**
 * Generates the placeholder pixel art into client/public/assets.
 *
 *   npm run assets
 *
 * Every image comes with a `_n.png` normal map (R = +x, G = +y up, B = towards
 * viewer - the default of Laigter / SpriteIlluminator) and sprite sheets come
 * with Aseprite-compatible JSON (hash format, frameTags, slices with pivots).
 * Replace any file 1:1 with an Aseprite export of the same name - files that
 * were replaced are detected (hash manifest) and kept unless --force is passed.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getShipLayout } from '@lw/shared';
import { asepriteJson, type SheetFrame } from './assets/aseprite';
import { Canvas } from './assets/canvas';
import { normalMap } from './assets/normals';
import { encodePng } from './assets/png';
import { drawPlayerSheet, PLAYER_FRAME } from './assets/player';
import { drawProps, packSprites } from './assets/props';
import { drawBack, drawHull } from './assets/ship';
import { drawSounds } from './assets/sfx';
import { encodeWav } from './assets/synth';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'client', 'public', 'assets');
const preview = process.env.ASSET_PREVIEW_DIR;
const force = process.argv.includes('--force');
mkdirSync(out, { recursive: true });

/**
 * Generated files are recorded with their hash. A file whose content no longer
 * matches (= replaced by real art, e.g. an Aseprite export) is never overwritten
 * unless --force is given.
 */
const manifestPath = join(out, '.generated.json');
const manifest: Record<string, string> = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>) : {};
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');

function writeAsset(name: string, content: Buffer | string): boolean {
  const path = join(out, name);
  if (!force && existsSync(path)) {
    const current = sha(readFileSync(path));
    if (manifest[name] !== current) {
      console.log(`  ${name}: replaced by hand - kept (use --force to overwrite)`);
      return false;
    }
  }
  writeFileSync(path, content);
  manifest[name] = sha(typeof content === 'string' ? Buffer.from(content) : content);
  return true;
}

function save(name: string, w: number, h: number, data: Uint8Array): void {
  const written = writeAsset(name, encodePng(w, h, data));
  if (preview) {
    // 4x nearest preview for eyeballing the art
    const s = 4;
    const big = new Uint8Array(w * s * h * s * 4);
    for (let y = 0; y < h * s; y++) {
      for (let x = 0; x < w * s; x++) {
        const si = (Math.floor(y / s) * w + Math.floor(x / s)) * 4;
        const di = (y * w * s + x) * 4;
        const a = data[si + 3]!;
        // composite on a dark checker so transparency is visible
        const bg = ((x >> 4) + (y >> 4)) % 2 ? 40 : 56;
        for (let k = 0; k < 3; k++) big[di + k] = Math.round((data[si + k]! * a + bg * (255 - a)) / 255);
        big[di + 3] = 255;
      }
    }
    mkdirSync(preview, { recursive: true });
    writeFileSync(join(preview, name), encodePng(w * s, h * s, big));
  }
  if (written) console.log(`  ${name} (${w}x${h})`);
}

function saveCanvas(name: string, c: Canvas, normalStrength: number, bevel: number): void {
  save(`${name}.png`, c.w, c.h, c.data);
  save(`${name}_n.png`, c.w, c.h, normalMap(c, normalStrength, bevel));
}

console.log('Generating assets ->', out);
const layout = getShipLayout();

// --- ship layers
saveCanvas('ship_hull', drawHull(layout), 1.4, 2);
saveCanvas('ship_back', drawBack(layout), 1.2, 0);

// --- player (base + tintable coat layer share one layout and one normal map)
{
  const sheet = drawPlayerSheet();
  const n = sheet.frames.length;
  const W = PLAYER_FRAME.w * n;
  const H = PLAYER_FRAME.h;
  const base = new Canvas(W, H);
  const coat = new Canvas(W, H);
  const full = new Canvas(W, H);
  const frames: SheetFrame[] = [];
  sheet.frames.forEach((f, i) => {
    base.blit(f.base, i * PLAYER_FRAME.w, 0);
    coat.blit(f.coat, i * PLAYER_FRAME.w, 0);
    full.blit(f.full, i * PLAYER_FRAME.w, 0);
    frames.push({ name: `player ${i}.aseprite`, x: i * PLAYER_FRAME.w, y: 0, w: PLAYER_FRAME.w, h: H, duration: sheet.durations[i] });
  });
  save('player.png', W, H, base.data);
  save('player_coat.png', W, H, coat.data);
  save('player_n.png', W, H, normalMap(full, 1.6, 1));
  frames[0]!.pivot = PLAYER_FRAME.pivot;
  const json = JSON.parse(asepriteJson('player.png', { w: W, h: H }, frames, sheet.tags)) as { meta: { slices: { name: string }[] } };
  json.meta.slices = [{ name: 'player', color: '#0000ffff', keys: [{ frame: 0, bounds: { x: 0, y: 0, w: PLAYER_FRAME.w, h: H }, pivot: PLAYER_FRAME.pivot }] } as never];
  if (writeAsset('player.json', JSON.stringify(json, null, 1))) console.log(`  player.json (${n} frames, tags: ${sheet.tags.map((t) => t.name).join(', ')})`);
}

// --- props atlas
{
  const sprites = drawProps();
  const width = 192;
  const pos = packSprites(sprites, width);
  const H = pos.height ?? 64;
  const atlas = new Canvas(width, H);
  const frames: SheetFrame[] = [];
  sprites.forEach((s, i) => {
    const p = pos[i]!;
    atlas.blit(s.canvas, p.x, p.y);
    frames.push({ name: s.name, x: p.x, y: p.y, w: s.canvas.w, h: s.canvas.h, pivot: s.pivot });
  });
  save('props.png', width, H, atlas.data);
  save('props_n.png', width, H, normalMap(atlas, 1.5, 1));
  if (writeAsset('props.json', asepriteJson('props.png', { w: width, h: H }, frames))) console.log(`  props.json (${frames.length} sprites)`);
}
// --- placeholder sounds (WAV, 22 kHz mono). Replace any file with your own recording / Ableton export.
{
  mkdirSync(join(out, 'sfx'), { recursive: true });
  const sounds = drawSounds();
  let bytes = 0;
  let written = 0;
  for (const s of sounds) {
    const wav = encodeWav(s.data);
    bytes += wav.length;
    if (writeAsset(`sfx/${s.name}.wav`, wav)) written++;
  }
  // the list of sound files the game loads (also lists replaced files)
  writeFileSync(join(out, 'sfx', 'index.json'), JSON.stringify(sounds.map((s) => s.name), null, 1));
  console.log(`  sfx/*.wav (${written} of ${sounds.length} written, ${(bytes / 1024).toFixed(0)} KB)`);
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log('done.');
