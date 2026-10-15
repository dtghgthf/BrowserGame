import { Mesh, MeshGeometry, type Container, type Shader } from 'pixi.js';
import { glShader } from './gl';
import { SEA_FRAG, SEA_MASK_FRAG, SEA_VERT } from './shaders';

const COLUMN = 2;

interface SeaLayerOpts {
  deep: [number, number, number];
  shallow: [number, number, number];
  foam: number;
  levelOffset: number;
  waveScale: number;
  mask: boolean;
}

/**
 * A strip mesh covering the visible sea. The top edge follows the shared wave
 * function (evaluated on the CPU per 2 px column); the surface height is also
 * passed per vertex so the fragment shader needs no wave math.
 */
class SeaLayer {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  private columns = 0;

  constructor(
    parent: Container,
    private readonly opts: SeaLayerOpts,
  ) {
    const shader = opts.mask
      ? glShader(SEA_VERT, SEA_MASK_FRAG, {}, 'sea-mask')
      : glShader(SEA_VERT, SEA_FRAG, {
          seaUniforms: {
            uTime: { value: 0, type: 'f32' },
            uDeep: { value: new Float32Array(opts.deep), type: 'vec3<f32>' },
            uShallow: { value: new Float32Array(opts.shallow), type: 'vec3<f32>' },
            uFoam: { value: opts.foam, type: 'f32' },
          },
        }, 'sea');
    this.mesh = new Mesh({
      geometry: new MeshGeometry({ positions: new Float32Array(8), uvs: new Float32Array(8), indices: new Uint32Array(6) }),
      shader,
    });
    parent.addChild(this.mesh);
  }

  update(left: number, right: number, bottom: number, time: number, surfaceAt: (x: number) => number): void {
    const x0 = Math.floor(left / COLUMN) * COLUMN - COLUMN;
    const cols = Math.ceil((right - x0) / COLUMN) + 2;
    if (cols !== this.columns) {
      this.columns = cols;
      const idx = new Uint32Array(cols * 6);
      for (let i = 0; i < cols; i++) {
        const a = i * 2;
        idx.set([a, a + 2, a + 3, a, a + 3, a + 1], i * 6);
      }
      this.mesh.geometry.positions = new Float32Array((cols + 1) * 4);
      this.mesh.geometry.uvs = new Float32Array((cols + 1) * 4);
      this.mesh.geometry.indices = idx;
    }
    const pos = this.mesh.geometry.positions;
    const uv = this.mesh.geometry.uvs;
    for (let i = 0; i <= cols; i++) {
      const x = x0 + i * COLUMN;
      const surf = surfaceAt(x) * this.opts.waveScale + this.opts.levelOffset;
      const top = Math.min(surf, bottom - 1);
      pos[i * 4] = x;
      pos[i * 4 + 1] = top;
      pos[i * 4 + 2] = x;
      pos[i * 4 + 3] = bottom;
      uv[i * 4] = surf;
      uv[i * 4 + 2] = surf;
    }
    this.mesh.geometry.getBuffer('aPosition').update();
    this.mesh.geometry.getBuffer('aUV').update();
    if (!this.opts.mask) {
      const u = (this.mesh.shader!.resources.seaUniforms as { uniforms: Record<string, unknown> }).uniforms;
      u.uTime = time;
    }
  }
}

/** Far sea band + near sea in the albedo pass, and the near sea in the mask pass. */
export class SeaView {
  private readonly far: SeaLayer;
  private readonly near: SeaLayer;
  private readonly mask: SeaLayer;

  constructor(albedoWorld: Container, maskWorld: Container) {
    this.far = new SeaLayer(albedoWorld, { deep: [0.02, 0.05, 0.08], shallow: [0.06, 0.11, 0.16], foam: 0, levelOffset: -34, waveScale: 0.25, mask: false });
    this.near = new SeaLayer(albedoWorld, { deep: [0.03, 0.08, 0.12], shallow: [0.11, 0.24, 0.32], foam: 1.0, levelOffset: 0, waveScale: 1, mask: false });
    this.mask = new SeaLayer(maskWorld, { deep: [0, 0, 0], shallow: [0, 0, 0], foam: 0, levelOffset: 0, waveScale: 1, mask: true });
    albedoWorld.setChildIndex(this.far.mesh, 0);
    albedoWorld.setChildIndex(this.near.mesh, 1);
    maskWorld.setChildIndex(this.mask.mesh, 0);
  }

  /** `surfaceAt(x)` returns the world px y of the sea surface; `farSurfaceAt` the same for the far band. */
  update(left: number, right: number, bottom: number, time: number, surfaceAt: (x: number) => number, farSurfaceAt: (x: number) => number): void {
    this.far.update(left, right, bottom, time * 0.6, farSurfaceAt);
    this.near.update(left, right, bottom, time, surfaceAt);
    this.mask.update(left, right, bottom, time, surfaceAt);
  }
}
