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
/** Phones in landscape (little CSS height): fewer, bigger game pixels so text and controls stay readable. */
export const PHONE_TARGET_HEIGHT = 190;
/** CSS height below which the screen counts as a phone. */
export const PHONE_CSS_HEIGHT = 520;
const MIN_HEIGHT = 200;
const PHONE_MIN_HEIGHT = 150;
const MAX_WIDTH = 760;
const MIN_WIDTH = 240;

export function computePixelLayout(cssW: number, cssH: number, dpr: number, targetHeight?: number): PixelLayout {
  const phone = cssH < PHONE_CSS_HEIGHT;
  const target = targetHeight ?? (phone ? PHONE_TARGET_HEIGHT : TARGET_HEIGHT);
  const minHeight = phone ? PHONE_MIN_HEIGHT : MIN_HEIGHT;
  const devW = Math.max(1, Math.round(cssW * dpr));
  const devH = Math.max(1, Math.round(cssH * dpr));
  let scale = 1;
  let bestErr = Infinity;
  for (let s = 1; s <= 16; s++) {
    const h = devH / s;
    if (h < minHeight && s > 1) break;
    const err = Math.abs(h - target);
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
