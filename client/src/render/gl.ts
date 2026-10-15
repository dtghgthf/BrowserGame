import { GlProgram, Mesh, MeshGeometry, Shader, type Container, type Texture } from 'pixi.js';

const programs = new Map<string, GlProgram>();

/** Creates a WebGL-only shader. Programs are cached by source. */
export function glShader(vertex: string, fragment: string, resources: Record<string, unknown>, name = 'custom'): Shader {
  const key = `${vertex}\n//--\n${fragment}`;
  let program = programs.get(key);
  if (!program) {
    program = new GlProgram({ vertex, fragment, name });
    programs.set(key, program);
  }
  return new Shader({ glProgram: program, resources });
}

/** Geometry for an axis aligned quad with UVs. */
export function quadGeometry(x: number, y: number, w: number, h: number, u0 = 0, v0 = 0, u1 = 1, v1 = 1): MeshGeometry {
  return new MeshGeometry({
    positions: new Float32Array([x, y, x + w, y, x + w, y + h, x, y + h]),
    uvs: new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
}

export function setQuad(geom: MeshGeometry, x: number, y: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number): void {
  const p = geom.positions;
  p[0] = x;
  p[1] = y;
  p[2] = x + w;
  p[3] = y;
  p[4] = x + w;
  p[5] = y + h;
  p[6] = x;
  p[7] = y + h;
  geom.getBuffer('aPosition').update();
  const uv = geom.uvs;
  uv[0] = u0;
  uv[1] = v0;
  uv[2] = u1;
  uv[3] = v0;
  uv[4] = u1;
  uv[5] = v1;
  uv[6] = u0;
  uv[7] = v1;
  geom.getBuffer('aUV').update();
}

/** Full screen quad mesh with a custom shader. */
export function fullscreenQuad(w: number, h: number, shader: Shader, parent?: Container): Mesh<MeshGeometry, Shader> {
  const mesh = new Mesh({ geometry: quadGeometry(0, 0, w, h), shader });
  parent?.addChild(mesh);
  return mesh;
}

/** UV rectangle of a texture frame inside its source. */
export function frameUV(t: Texture): [number, number, number, number] {
  const sw = t.source.width;
  const sh = t.source.height;
  return [t.frame.x / sw, t.frame.y / sh, (t.frame.x + t.frame.width) / sw, (t.frame.y + t.frame.height) / sh];
}
