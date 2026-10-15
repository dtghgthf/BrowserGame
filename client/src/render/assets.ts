import { Assets, Rectangle, Texture, TextureSource } from 'pixi.js';

/**
 * Loads PNG + Aseprite JSON sprite sheets. Supports Aseprite's "Hash" and
 * "Array" JSON exports, frameTags (animations) and slices (pivots). Normal maps
 * are looked up as `<image>_n.png` next to the image.
 */
export interface AseFrameJson {
  filename?: string;
  frame: { x: number; y: number; w: number; h: number };
  duration?: number;
}

export interface AseJson {
  frames: Record<string, AseFrameJson> | AseFrameJson[];
  meta: {
    image: string;
    size: { w: number; h: number };
    frameTags?: { name: string; from: number; to: number; direction?: string }[];
    slices?: { name: string; keys: { frame: number; bounds: { x: number; y: number; w: number; h: number }; pivot?: { x: number; y: number } }[] }[];
  };
}

export interface SheetFrame {
  name: string;
  texture: Texture;
  normal: Texture | null;
  /** Extra layers with identical layout (e.g. the tintable player coat). */
  layers: Record<string, Texture>;
  width: number;
  height: number;
  pivot: { x: number; y: number };
  duration: number;
}

export interface Sheet {
  frames: SheetFrame[];
  byName: Map<string, SheetFrame>;
  tags: Map<string, { from: number; to: number }>;
}

export function configureTextureDefaults(): void {
  TextureSource.defaultOptions.scaleMode = 'nearest';
  TextureSource.defaultOptions.autoGenerateMipmaps = false;
}

async function loadTexture(url: string): Promise<Texture> {
  const tex = await Assets.load<Texture>(url);
  tex.source.scaleMode = 'nearest';
  return tex;
}

async function tryLoadTexture(url: string): Promise<Texture | null> {
  try {
    return await loadTexture(url);
  } catch {
    return null;
  }
}

/**
 * @param base   asset path without extension, e.g. `assets/player`
 * @param layers extra image layers sharing the same frames, e.g. `{ coat: 'assets/player_coat.png' }`
 */
export async function loadSheet(base: string, layers: Record<string, string> = {}): Promise<Sheet> {
  const json = (await (await fetch(`${base}.json`)).json()) as AseJson;
  const dir = base.slice(0, base.lastIndexOf('/') + 1);
  const image = await loadTexture(dir + json.meta.image);
  const normal = await tryLoadTexture(dir + json.meta.image.replace(/\.png$/, '_n.png'));
  const layerTex: Record<string, Texture> = {};
  for (const [k, url] of Object.entries(layers)) layerTex[k] = await loadTexture(url);

  const entries: [string, AseFrameJson][] = Array.isArray(json.frames)
    ? json.frames.map((f, i) => [f.filename ?? String(i), f])
    : Object.entries(json.frames);
  const slices = json.meta.slices ?? [];
  const defaultPivot = slices.length === 1 && slices[0]!.keys[0]?.pivot ? slices[0]!.keys[0]!.pivot! : null;

  const frames: SheetFrame[] = entries.map(([name, f]) => {
    const r = new Rectangle(f.frame.x, f.frame.y, f.frame.w, f.frame.h);
    const slice = slices.find((s) => s.name === name);
    const pivot = slice?.keys[0]?.pivot ?? defaultPivot ?? { x: Math.floor(f.frame.w / 2), y: Math.floor(f.frame.h / 2) };
    const lay: Record<string, Texture> = {};
    for (const [k, t] of Object.entries(layerTex)) lay[k] = new Texture({ source: t.source, frame: r.clone() });
    return {
      name,
      texture: new Texture({ source: image.source, frame: r }),
      normal: normal ? new Texture({ source: normal.source, frame: r.clone() }) : null,
      layers: lay,
      width: f.frame.w,
      height: f.frame.h,
      pivot,
      duration: f.duration ?? 100,
    };
  });
  const byName = new Map(frames.map((f) => [f.name, f]));
  const tags = new Map((json.meta.frameTags ?? []).map((t) => [t.name, { from: t.from, to: t.to }]));
  return { frames, byName, tags };
}

export interface ImageLayer {
  texture: Texture;
  normal: Texture | null;
}

export async function loadImageLayer(url: string): Promise<ImageLayer> {
  return { texture: await loadTexture(url), normal: await tryLoadTexture(url.replace(/\.png$/, '_n.png')) };
}

/** Picks the frame of an animation tag for a time in seconds (looping). */
export function animFrame(sheet: Sheet, tag: string, time: number): SheetFrame {
  const t = sheet.tags.get(tag) ?? sheet.tags.get('idle') ?? { from: 0, to: 0 };
  let total = 0;
  for (let i = t.from; i <= t.to; i++) total += sheet.frames[i]!.duration;
  let ms = (time * 1000) % Math.max(total, 1);
  for (let i = t.from; i <= t.to; i++) {
    ms -= sheet.frames[i]!.duration;
    if (ms < 0) return sheet.frames[i]!;
  }
  return sheet.frames[t.to]!;
}

export function frameOf(sheet: Sheet, name: string): SheetFrame {
  const f = sheet.byName.get(name);
  if (!f) throw new Error(`sprite '${name}' missing in sheet`);
  return f;
}
