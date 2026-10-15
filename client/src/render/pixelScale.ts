/**
 * Picks the low internal resolution and an integer upscale factor so the
 * picture is always pixel-exact. The internal height stays close to 270 px
 * (480x270 on a 1080p screen); the width follows the screen's aspect ratio.
 */
export interface PixelLayout {
  /** Internal (low) resolution. */
  width: number;
  height: number;
  /** Integer scale from internal pixels to device pixels. */
  scale: number;
  /** Canvas size in device pixels and CSS pixels. */
  deviceWidth: number;
  deviceHeight: number;
  cssWidth: number;
  cssHeight: number;
}

export const TARGET_HEIGHT = 270;
const MIN_HEIGHT = 200;
const MAX_WIDTH = 640;
const MIN_WIDTH = 240;

export function computePixelLayout(cssW: number, cssH: number, dpr: number, targetHeight = TARGET_HEIGHT): PixelLayout {
  const devW = Math.max(1, Math.round(cssW * dpr));
  const devH = Math.max(1, Math.round(cssH * dpr));
  let scale = 1;
  let bestErr = Infinity;
  for (let s = 1; s <= 16; s++) {
    const h = devH / s;
    if (h < MIN_HEIGHT && s > 1) break;
    const err = Math.abs(h - targetHeight);
    if (err < bestErr) {
      bestErr = err;
      scale = s;
    }
  }
  const height = Math.max(1, Math.floor(devH / scale));
  const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(devW / scale)));
  const deviceWidth = width * scale;
  const deviceHeight = height * scale;
  return {
    width,
    height,
    scale,
    deviceWidth,
    deviceHeight,
    cssWidth: deviceWidth / dpr,
    cssHeight: deviceHeight / dpr,
  };
}
