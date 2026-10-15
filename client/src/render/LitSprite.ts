import { Container, Mesh, Sprite, type MeshGeometry, type Shader, type Texture } from 'pixi.js';
import type { SheetFrame } from './assets';
import { frameUV, glShader, quadGeometry, setQuad } from './gl';
import { NORMAL_FRAG, NORMAL_VERT } from './shaders';

/**
 * A sprite that exists in two passes: the albedo scene (regular batched Sprite)
 * and the normal pass (a quad mesh whose shader rotates/flips the normal map
 * with the sprite's world transform). Both share position/rotation/scale.
 */
export class LitSprite {
  readonly albedo: Sprite;
  readonly normalMesh: Mesh<MeshGeometry, Shader> | null;
  private frame: SheetFrame;
  private normalSource: Texture | null;

  constructor(frame: SheetFrame, albedoParent: Container, normalParent: Container | null, opts: { normal?: Texture | null } = {}) {
    this.frame = frame;
    this.albedo = new Sprite(frame.texture);
    this.applyAnchor(frame);
    albedoParent.addChild(this.albedo);
    this.normalSource = opts.normal !== undefined ? opts.normal : frame.normal;
    if (normalParent && this.normalSource) {
      const n = this.normalSource;
      const [u0, v0, u1, v1] = frameUV(n);
      const geom = quadGeometry(-frame.pivot.x, -frame.pivot.y, frame.width, frame.height, u0, v0, u1, v1);
      const shader = glShader(NORMAL_VERT, NORMAL_FRAG, { uNormal: n.source }, 'normal-sprite');
      this.normalMesh = new Mesh({ geometry: geom, shader });
      normalParent.addChild(this.normalMesh);
    } else {
      this.normalMesh = null;
    }
  }

  private applyAnchor(f: SheetFrame): void {
    this.albedo.anchor.set(f.pivot.x / f.width, f.pivot.y / f.height);
  }

  setFrame(frame: SheetFrame): void {
    if (frame === this.frame) return;
    this.frame = frame;
    this.albedo.texture = frame.texture;
    this.applyAnchor(frame);
    if (this.normalMesh && frame.normal) {
      const [u0, v0, u1, v1] = frameUV(frame.normal);
      setQuad(this.normalMesh.geometry, -frame.pivot.x, -frame.pivot.y, frame.width, frame.height, u0, v0, u1, v1);
    }
  }

  setTransform(x: number, y: number, rotation = 0, scaleX = 1, scaleY = 1): void {
    this.albedo.position.set(x, y);
    this.albedo.rotation = rotation;
    this.albedo.scale.set(scaleX, scaleY);
    if (this.normalMesh) {
      this.normalMesh.position.set(x, y);
      this.normalMesh.rotation = rotation;
      this.normalMesh.scale.set(scaleX, scaleY);
    }
  }

  set visible(v: boolean) {
    this.albedo.visible = v;
    if (this.normalMesh) this.normalMesh.visible = v;
  }

  destroy(): void {
    this.albedo.destroy();
    this.normalMesh?.destroy();
  }
}
