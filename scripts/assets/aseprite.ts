/** Writes sprite sheet metadata in Aseprite's JSON export format (hash variant). */
export interface SheetFrame {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  duration?: number;
  /** Pivot inside the frame (written as an Aseprite slice with the frame's name). */
  pivot?: { x: number; y: number };
}

export interface SheetTag {
  name: string;
  from: number;
  to: number;
}

export function asepriteJson(image: string, size: { w: number; h: number }, frames: SheetFrame[], tags: SheetTag[] = []): string {
  const frameObj: Record<string, unknown> = {};
  for (const f of frames) {
    frameObj[f.name] = {
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
      sourceSize: { w: f.w, h: f.h },
      duration: f.duration ?? 100,
    };
  }
  const slices = frames
    .filter((f) => f.pivot)
    .map((f) => ({
      name: f.name,
      color: '#0000ffff',
      keys: [{ frame: 0, bounds: { x: 0, y: 0, w: f.w, h: f.h }, pivot: f.pivot }],
    }));
  return JSON.stringify(
    {
      frames: frameObj,
      meta: {
        app: 'leuchtturmwaerter/scripts/generate-assets.ts (Aseprite-compatible)',
        version: '1.0',
        image,
        format: 'RGBA8888',
        size,
        scale: '1',
        frameTags: tags.map((t) => ({ name: t.name, from: t.from, to: t.to, direction: 'forward', color: '#000000ff' })),
        layers: [],
        slices,
      },
    },
    null,
    1,
  );
}
