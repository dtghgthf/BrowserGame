import { autoDetectRenderer, Container, Mesh, RenderTexture, Sprite, type MeshGeometry, type Renderer, type Shader } from 'pixi.js';
import { fullscreenQuad, glShader, setQuad } from './gl';
import { computePixelLayout, type PixelLayout } from './pixelScale';
import { COMPOSITE_FRAG, QUAD_VERT } from './shaders';

/** One render pass: a root, a camera-transformed world layer and a ship layer (rotated by the roll). */
export interface PassRoot {
  root: Container;
  world: Container;
  ship: Container;
}

function makePass(): PassRoot {
  const root = new Container();
  const world = new Container();
  const ship = new Container();
  world.addChild(ship);
  root.addChild(world);
  return { root, world, ship };
}

export interface LookSettings {
  ambientExt: [number, number, number];
  ambientInt: [number, number, number];
  fogColor: [number, number, number];
  fogDensity: number;
  fogScatter: number;
  fogHeight: number;
  fogEnabled: boolean;
  lightSteps: number;
}

/**
 * Quality levels (auto-selected at runtime, or forced with ?quality=):
 *  high   - WebGL nearest upscale, full-res light buffer
 *  medium - CSS upscale (image-rendering: pixelated, done by the compositor), full-res light buffer
 *  low    - CSS upscale, half-res light buffer (2x2 px light cells)
 */
export type Quality = 'high' | 'medium' | 'low';

export const DEFAULT_LOOK: LookSettings = {
  ambientExt: [0.2, 0.25, 0.4],
  ambientInt: [0.085, 0.075, 0.08],
  fogColor: [0.2, 0.25, 0.32],
  fogDensity: 0.75,
  fogScatter: 1.6,
  fogHeight: 260,
  fogEnabled: true,
  lightSteps: 7,
};

/**
 * Low-res multi-pass renderer:
 *  1. albedo   -> scene RT      (sprites, sea, hull water, lit particles)
 *  2. normals  -> normal RT     (normal maps rotated with their sprites)
 *  3. mask     -> mask RT       (r = ship, g = interior, b = sea)
 *  4. lights   -> light RT      (additive visibility polygons, normal mapped)
 *  5. composite-> final RT      (ambient + lights, sky, reflections, fog) + emissive + HUD
 *  6. upscale  -> canvas        (integer nearest-neighbour scale)
 */
export class GameRenderer {
  readonly renderer: Renderer;
  layout: PixelLayout;
  readonly albedo = makePass();
  readonly normal = makePass();
  readonly mask = makePass();
  readonly light = makePass();
  /** Emissive / unlit things drawn on top of the composite (lantern flames, bubbles, debug). */
  readonly final = makePass();
  readonly hud = new Container();
  readonly look: LookSettings = { ...DEFAULT_LOOK };
  readonly rt: { scene: RenderTexture; normal: RenderTexture; mask: RenderTexture; light: RenderTexture; final: RenderTexture };

  private readonly composite: Mesh<MeshGeometry, Shader>;
  private readonly screen = new Container();
  private readonly finalSprite: Sprite;
  /** Camera (world px at the centre of the screen) after pixel snapping. */
  camera = { x: 0, y: 0 };
  quality: Quality = 'high';
  /** Light buffer resolution relative to the internal resolution (1 or 0.5). */
  lightScale = 1;
  /** Profiling switches: a disabled pass keeps its previous buffer content. */
  readonly passEnabled = { albedo: true, normal: true, mask: true, light: true, final: true, screen: true };

  private constructor(renderer: Renderer, layout: PixelLayout, quality: Quality) {
    this.renderer = renderer;
    this.layout = layout;
    this.quality = quality;
    this.lightScale = quality === 'low' ? 0.5 : 1;
    const mk = () => RenderTexture.create({ width: layout.width, height: layout.height, resolution: 1, scaleMode: 'nearest', antialias: false });
    this.rt = { scene: mk(), normal: mk(), mask: mk(), light: mk(), final: mk() };
    this.rt.light.resize(this.lightWidth, this.lightHeight);

    this.composite = fullscreenQuad(
      layout.width,
      layout.height,
      glShader(QUAD_VERT, COMPOSITE_FRAG, {
        uScene: this.rt.scene.source,
        uLight: this.rt.light.source,
        uMask: this.rt.mask.source,
        compositeUniforms: {
          uResolution: { value: new Float32Array([layout.width, layout.height]), type: 'vec2<f32>' },
          uCamera: { value: new Float32Array(2), type: 'vec2<f32>' },
          uTime: { value: 0, type: 'f32' },
          uAmbientExt: { value: new Float32Array(3), type: 'vec3<f32>' },
          uAmbientInt: { value: new Float32Array(3), type: 'vec3<f32>' },
          uFogColor: { value: new Float32Array(3), type: 'vec3<f32>' },
          uFog: { value: new Float32Array(4), type: 'vec4<f32>' },
          uMoon: { value: new Float32Array(2), type: 'vec2<f32>' },
          uLightSteps: { value: 7, type: 'f32' },
          uSeaLevel: { value: 0, type: 'f32' },
        },
      }, 'composite'),
    );
    this.final.root.addChildAt(this.composite, 0);
    this.final.root.addChild(this.hud);

    this.finalSprite = new Sprite(this.rt.final);
    this.screen.addChild(this.finalSprite);
    this.applyLayout();
  }

  static async create(host: HTMLElement, quality: Quality = 'high'): Promise<GameRenderer> {
    const layout = GameRenderer.measure(host);
    const renderer = await autoDetectRenderer({
      preference: 'webgl',
      width: layout.deviceWidth,
      height: layout.deviceHeight,
      resolution: 1,
      autoDensity: false,
      antialias: false,
      background: '#05070d',
      powerPreference: 'high-performance',
      roundPixels: false,
    });
    host.appendChild(renderer.canvas);
    return new GameRenderer(renderer, layout, quality);
  }

  static measure(host: HTMLElement): PixelLayout {
    const rect = host.getBoundingClientRect();
    const params = new URLSearchParams(location.search);
    const target = Number(params.get('h')) || undefined;
    return computePixelLayout(rect.width || window.innerWidth, rect.height || window.innerHeight, window.devicePixelRatio || 1, target);
  }

  /** Re-measures the host and resizes all buffers if the pixel layout changed. Returns true if changed. */
  resize(host: HTMLElement): boolean {
    const next = GameRenderer.measure(host);
    const l = this.layout;
    if (next.width === l.width && next.height === l.height && next.scale === l.scale && next.cssWidth === l.cssWidth) return false;
    this.layout = next;
    for (const rt of Object.values(this.rt)) rt.resize(next.width, next.height);
    this.rt.light.resize(this.lightWidth, this.lightHeight);
    setQuad(this.composite.geometry, 0, 0, next.width, next.height, 0, 0, 1, 1);
    this.applyLayout();
    return true;
  }

  get lightWidth(): number {
    return Math.ceil(this.layout.width * this.lightScale);
  }

  get lightHeight(): number {
    return Math.ceil(this.layout.height * this.lightScale);
  }

  /** Switches quality at runtime (resizes buffers, changes the upscale path). */
  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    this.lightScale = q === 'low' ? 0.5 : 1;
    this.rt.light.resize(this.lightWidth, this.lightHeight);
    this.applyLayout();
  }

  private get cssUpscale(): boolean {
    return this.quality !== 'high';
  }

  private applyLayout(): void {
    const l = this.layout;
    // CSS mode: the canvas has the low internal size and the browser scales it (nearest)
    if (this.cssUpscale) this.renderer.resize(l.width, l.height);
    else this.renderer.resize(l.deviceWidth, l.deviceHeight);
    const c = this.renderer.canvas;
    c.style.width = `${l.cssWidth}px`;
    c.style.height = `${l.cssHeight}px`;
    this.finalSprite.scale.set(l.scale);
    this.light.root.scale.set(this.lightScale);
    const u = this.compositeUniforms();
    const res = u.uResolution as Float32Array;
    res[0] = l.width;
    res[1] = l.height;
  }

  private compositeUniforms(): Record<string, unknown> {
    return (this.composite.shader!.resources.compositeUniforms as { uniforms: Record<string, unknown> }).uniforms;
  }

  /** Sets the camera (world px, centre of the screen) and the ship transform (world px + roll) for all passes. */
  setTransforms(camX: number, camY: number, shipX: number, shipY: number, roll: number): void {
    const l = this.layout;
    const cx = Math.round(camX - l.width / 2);
    const cy = Math.round(camY - l.height / 2);
    this.camera.x = cx + l.width / 2;
    this.camera.y = cy + l.height / 2;
    for (const p of [this.albedo, this.normal, this.mask, this.light, this.final]) {
      p.world.position.set(-cx, -cy);
      p.ship.position.set(shipX, shipY);
      p.ship.rotation = roll;
    }
  }

  /** Top-left world px of the screen. */
  get viewLeft(): number {
    return this.camera.x - this.layout.width / 2;
  }

  get viewTop(): number {
    return this.camera.y - this.layout.height / 2;
  }

  /** Converts a world px position to render target px. */
  worldToScreen(x: number, y: number): { x: number; y: number } {
    return { x: x - this.viewLeft, y: y - this.viewTop };
  }

  render(time: number): void {
    const u = this.compositeUniforms();
    const cam = u.uCamera as Float32Array;
    cam[0] = this.viewLeft;
    cam[1] = this.viewTop;
    u.uTime = time;
    (u.uAmbientExt as Float32Array).set(this.look.ambientExt);
    (u.uAmbientInt as Float32Array).set(this.look.ambientInt);
    (u.uFogColor as Float32Array).set(this.look.fogColor);
    const fog = u.uFog as Float32Array;
    fog[0] = this.look.fogDensity;
    fog[1] = this.look.fogScatter;
    fog[2] = this.look.fogHeight;
    fog[3] = this.look.fogEnabled ? 1 : 0;
    u.uLightSteps = this.look.lightSteps;
    const moon = u.uMoon as Float32Array;
    moon[0] = Math.round(this.layout.width * 0.32);
    moon[1] = Math.round(this.layout.height * 0.16);

    const r = this.renderer;
    const on = this.passEnabled;
    if (on.albedo) r.render({ container: this.albedo.root, target: this.rt.scene, clear: true, clearColor: [0, 0, 0, 0] });
    if (on.normal) r.render({ container: this.normal.root, target: this.rt.normal, clear: true, clearColor: [0.5, 0.5, 1, 0] });
    if (on.mask) r.render({ container: this.mask.root, target: this.rt.mask, clear: true, clearColor: [0, 0, 0, 0] });
    if (on.light) r.render({ container: this.light.root, target: this.rt.light, clear: true, clearColor: [0, 0, 0, 0] });
    if (this.cssUpscale) {
      // composite straight into the low-res canvas; the browser upscales it
      if (on.final) r.render({ container: this.final.root, clear: true, clearColor: [0, 0, 0, 1] });
    } else {
      if (on.final) r.render({ container: this.final.root, target: this.rt.final, clear: true, clearColor: [0, 0, 0, 1] });
      if (on.screen) r.render({ container: this.screen });
    }
  }
}
