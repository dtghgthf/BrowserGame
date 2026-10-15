import { Mesh, MeshGeometry, type Container, type Shader } from 'pixi.js';
import { PIXELS_PER_METER, type CompartmentGeometry, type CompartmentState } from '@lw/shared';
import { glShader } from './gl';
import { HULLWATER_FRAG, HULLWATER_VERT } from './shaders';

/**
 * Water inside the hull compartments. Each compartment is one mesh made of its
 * interior columns; the fragment shader cuts the surface line (with ripples)
 * per pixel, so the rendered water exactly matches the simulated level & slope.
 */
export class WaterView {
  private readonly meshes: Mesh<MeshGeometry, Shader>[] = [];

  constructor(
    parent: Container,
    private readonly geoms: readonly CompartmentGeometry[],
    surfaceOnly = false,
  ) {
    for (const g of geoms) {
      const pos: number[] = [];
      const idx: number[] = [];
      const w = g.colWidth * PIXELS_PER_METER;
      for (const col of g.columns) {
        const x = col.x * PIXELS_PER_METER - w / 2;
        for (const s of col.spans) {
          const y0 = s.top * PIXELS_PER_METER;
          const y1 = s.bottom * PIXELS_PER_METER;
          const b = pos.length / 2;
          pos.push(x, y0, x + w, y0, x + w, y1, x, y1);
          idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        }
      }
      const shader = glShader(HULLWATER_VERT, HULLWATER_FRAG, {
        waterUniforms: {
          uSurface: { value: new Float32Array(3), type: 'vec3<f32>' },
          uTime: { value: 0, type: 'f32' },
          uAgitation: { value: 0, type: 'f32' },
          uSurfaceOnly: { value: surfaceOnly ? 1 : 0, type: 'f32' },
        },
      }, 'hullwater');
      const mesh = new Mesh({
        geometry: new MeshGeometry({ positions: new Float32Array(pos), uvs: new Float32Array(pos.length), indices: new Uint32Array(idx) }),
        shader,
      });
      mesh.visible = false;
      parent.addChild(mesh);
      this.meshes.push(mesh);
    }
  }

  get displayObjects(): readonly Mesh<MeshGeometry, Shader>[] {
    return this.meshes;
  }

  update(comps: readonly CompartmentState[], time: number): void {
    comps.forEach((c, i) => {
      const mesh = this.meshes[i];
      const g = this.geoms[i];
      if (!mesh || !g) return;
      mesh.visible = c.volume > 0.02;
      if (!mesh.visible) return;
      const u = (mesh.shader!.resources.waterUniforms as { uniforms: Record<string, unknown> }).uniforms;
      const s = u.uSurface as Float32Array;
      s[0] = c.surfaceY * PIXELS_PER_METER;
      s[1] = c.slope;
      s[2] = g.xMid * PIXELS_PER_METER;
      u.uTime = time;
      u.uAgitation = Math.min(2, Math.abs(c.slopeVel) * 6);
    });
  }
}
