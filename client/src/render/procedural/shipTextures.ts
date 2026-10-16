import { Texture } from 'pixi.js';
import type { ShipLayout } from '@lw/shared';
import type { ImageLayer } from '../assets';
import type { Canvas } from './canvas';
import { normalMap } from './normals';
import { drawBack, drawHull } from './ship';

/** RGBA pixels -> a nearest-filtered texture (via a 2D canvas). */
export function textureFromPixels(w: number, h: number, data: Uint8Array): Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(c);
  tex.source.scaleMode = 'nearest';
  return tex;
}

function layer(c: Canvas, strength: number, bevel: number): ImageLayer {
  return { texture: textureFromPixels(c.w, c.h, c.data), normal: textureFromPixels(c.w, c.h, normalMap(c, strength, bevel)) };
}

/**
 * Hull and back wall art for a ship from the editor, drawn at runtime with the
 * same code (and the same normal map settings) as the placeholder generator.
 */
export function shipLayers(layout: ShipLayout): { hull: ImageLayer; back: ImageLayer } {
  return { hull: layer(drawHull(layout), 1.4, 2), back: layer(drawBack(layout), 1.2, 0) };
}
