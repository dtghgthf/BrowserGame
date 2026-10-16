import { Container, Mesh, MeshGeometry, type Shader, type Texture } from 'pixi.js';
import { glShader } from '../gl';
import { LIGHT_FRAG, LIGHT_VERT } from '../shaders';
import { visibilityPolygon, type Segment } from './visibility';

export interface LightDef {
  /** Which coordinate system x/y are in: the rotating ship (local px) or the world (px). */
  space: 'ship' | 'world';
  x: number;
  y: number;
  color: [number, number, number];
  intensity: number;
  radius: number;
  /** Height above the surface for normal mapping (px). */
  height: number;
  /** Cone direction (radians) and half angle; null = omni. */
  cone: { direction: number; half: number; soft: number } | null;
  /** Contribution to fog scattering (alpha channel). */
  scatter: number;
  /** Ship lights are blocked by the hull; world lights are not. */
  occluded: boolean;
  enabled: boolean;
  /** Far away behind the ship (the lighthouse): neither lights nor scatters where the ship is drawn. */
  behindShip?: boolean;
}

interface LightRuntime {
  def: LightDef;
  mesh: Mesh<MeshGeometry, Shader>;
  shader: Shader;
  cacheKey: string;
  /** Last computed polygon (flat x,y list) for the debug overlay. */
  polygon: number[];
}

/**
 * Builds one additive mesh per light from its visibility polygon. The meshes
 * live inside the light pass containers (ship lights in the rotating ship
 * container), so shadows are computed in ship space and rotate with the ship.
 */
export class LightSystem {
  private readonly lights: LightRuntime[] = [];
  private occluders: readonly Segment[] = [];
  private occluderVersion = 0;
  /** Wall penetration in px so lit surfaces include the wall face. */
  penetration = 4;
  /** Light buffer scale relative to the internal resolution (for the normal-mapping height). */
  bufferScale = 1;
  polygonsComputed = 0;

  constructor(
    private readonly shipLayer: Container,
    private readonly worldLayer: Container,
    private readonly normals: Texture,
    private readonly mask: Texture,
    private readonly resolution: { width: number; height: number },
  ) {}

  setOccluders(segments: readonly Segment[]): void {
    this.occluders = segments;
    this.occluderVersion++;
  }

  add(def: LightDef): LightDef {
    const shader = glShader(LIGHT_VERT, LIGHT_FRAG, {
      uNormals: this.normals.source,
      uMask: this.mask.source,
      lightUniforms: {
        uResolution: { value: new Float32Array([this.resolution.width, this.resolution.height]), type: 'vec2<f32>' },
        uLightLocal: { value: new Float32Array(2), type: 'vec2<f32>' },
        uLightRT: { value: new Float32Array(2), type: 'vec2<f32>' },
        uLightColor: { value: new Float32Array(def.color), type: 'vec3<f32>' },
        uIntensity: { value: def.intensity, type: 'f32' },
        uRadius: { value: def.radius, type: 'f32' },
        uHeight: { value: def.height, type: 'f32' },
        uCone: { value: new Float32Array([1, 0, -2, 0]), type: 'vec4<f32>' },
        uScatter: { value: def.scatter, type: 'f32' },
        uBehind: { value: def.behindShip ? 1 : 0, type: 'f32' },
      },
    }, 'light');
    const geometry = new MeshGeometry({
      positions: new Float32Array(6),
      uvs: new Float32Array(6),
      indices: new Uint32Array([0, 1, 2]),
    });
    const mesh = new Mesh({ geometry, shader });
    mesh.blendMode = 'add';
    (def.space === 'ship' ? this.shipLayer : this.worldLayer).addChild(mesh);
    this.lights.push({ def, mesh, shader, cacheKey: '', polygon: [] });
    return def;
  }

  setResolution(width: number, height: number, scale = 1): void {
    this.resolution.width = width;
    this.resolution.height = height;
    this.bufferScale = scale;
    for (const l of this.lights) {
      const res = (l.shader.resources.lightUniforms as { uniforms: Record<string, unknown> }).uniforms.uResolution as Float32Array;
      res[0] = width;
      res[1] = height;
    }
  }

  /**
   * Rebuilds polygons that changed and updates the uniforms.
   * @param toRT maps a light position (in its space) to render-target pixels
   */
  update(toRT: (space: 'ship' | 'world', x: number, y: number) => { x: number; y: number }): void {
    this.polygonsComputed = 0;
    for (const l of this.lights) {
      const d = l.def;
      l.mesh.visible = d.enabled && d.intensity > 0.001;
      if (!l.mesh.visible) continue;
      const u = (l.shader.resources.lightUniforms as { uniforms: Record<string, unknown> }).uniforms;
      const rt = toRT(d.space, d.x, d.y);
      const lr = u.uLightRT as Float32Array;
      lr[0] = rt.x;
      lr[1] = rt.y;
      const ll = u.uLightLocal as Float32Array;
      ll[0] = d.x;
      ll[1] = d.y;
      (u.uLightColor as Float32Array).set(d.color);
      u.uIntensity = d.intensity;
      u.uRadius = d.radius;
      u.uHeight = d.height * this.bufferScale;
      u.uScatter = d.scatter;
      const cone = u.uCone as Float32Array;
      if (d.cone) {
        cone[0] = Math.cos(d.cone.direction);
        cone[1] = Math.sin(d.cone.direction);
        cone[2] = Math.cos(d.cone.half);
        cone[3] = d.cone.soft;
      } else {
        cone[2] = -2;
      }

      // polygons are cached while the light stays on the same (sub)pixel
      const key = `${Math.round(d.x * 4)},${Math.round(d.y * 4)},${d.radius},${d.cone ? Math.round(d.cone.direction * 400) : 'o'},${this.occluderVersion}`;
      if (key === l.cacheKey) continue;
      l.cacheKey = key;
      this.polygonsComputed++;
      const half = d.cone ? d.cone.half + d.cone.soft * 3 : Math.PI;
      const poly = d.occluded
        ? visibilityPolygon(d.x, d.y, d.radius, this.occluders, {
            direction: d.cone ? d.cone.direction : undefined,
            halfAngle: d.cone ? Math.min(half, Math.PI - 0.01) : undefined,
            penetration: this.penetration,
          })
        : simplePolygon(d.x, d.y, d.radius, d.cone ? d.cone.direction : 0, d.cone ? half : Math.PI);
      l.polygon = poly;
      this.writeFan(l, d, poly);
    }
  }

  private writeFan(l: LightRuntime, d: LightDef, poly: number[]): void {
    const n = poly.length / 2;
    const positions = new Float32Array((n + 1) * 2);
    positions[0] = d.x;
    positions[1] = d.y;
    positions.set(poly, 2);
    const closed = !d.cone;
    const tris = closed ? n : n - 1;
    const indices = new Uint32Array(Math.max(tris, 1) * 3);
    for (let i = 0; i < tris; i++) {
      indices[i * 3] = 0;
      indices[i * 3 + 1] = 1 + i;
      indices[i * 3 + 2] = 1 + ((i + 1) % n);
    }
    const g = l.mesh.geometry;
    g.positions = positions;
    g.uvs = new Float32Array(positions.length);
    g.indices = indices;
  }

  /** Light polygons in their own space, for the debug overlay. */
  debugPolygons(): { space: 'ship' | 'world'; x: number; y: number; points: number[] }[] {
    return this.lights.filter((l) => l.mesh.visible).map((l) => ({ space: l.def.space, x: l.def.x, y: l.def.y, points: l.polygon }));
  }

  get count(): number {
    return this.lights.filter((l) => l.mesh.visible).length;
  }
}

function simplePolygon(x: number, y: number, r: number, dir: number, half: number): number[] {
  const out: number[] = [];
  const steps = half >= Math.PI ? 24 : 12;
  for (let i = 0; i <= steps; i++) {
    const a = dir - half + (2 * half * i) / steps;
    out.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  if (half >= Math.PI) out.length -= 2;
  return out;
}
