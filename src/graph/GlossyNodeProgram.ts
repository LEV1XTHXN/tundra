/**
 * A custom sigma node program (Phase 2 step 4 polish) that renders each node
 * as a glossy 2D sphere instead of a flat circle — radial highlight toward
 * one corner, a small specular dot, a softly contained rim shadow. Modeled
 * directly on sigma's own built-in `NodeCircleProgram` (verified against the
 * INSTALLED sigma 3.0.3 — `node_modules/sigma/dist/index-fad77a13.esm.js`,
 * the `NodeCircleProgram` class): same vertex shader, same triangle-per-node
 * geometry (3 vertices circumscribing the circle, `CONSTANT_ATTRIBUTES`
 * supplying each vertex's fixed angle), same antialiased-edge technique in
 * the fragment shader — only the fragment shader's COLOR computation differs.
 *
 * This keeps it a real batched WebGL program (one draw call for every node
 * sharing this type, like every other sigma node program) rather than
 * per-node canvas/DOM work, and it never touches node positions — orthogonal
 * to ForceAtlas2 and the layout worker.
 *
 * `processVisibleItem` reads `data.color` — the value AFTER `nodeReducer` has
 * already run (sigma resolves reducers before feeding programs), so the
 * hover/dim behavior in `GraphView.tsx` (dimming non-neighbors to a flat
 * gray) is honored automatically: dimmed nodes get their shading computed
 * from the dimmed color, same as every other node attribute driven by data.
 *
 * Registered under the `"glossy"` node type (`nodeProgramClasses.glossy` in
 * `GraphView.tsx`'s Sigma constructor) — sigma's default `"circle"` type
 * (`NodeCircleProgram`) is untouched and still selectable as the "Flat"
 * node-style option.
 */
import { NodeProgram } from "sigma/rendering";
import type { InstancedProgramDefinition, ProgramInfo } from "sigma/rendering";
import type { NodeDisplayData, RenderParams } from "sigma/types";
import { floatColor } from "sigma/utils";

const { UNSIGNED_BYTE, FLOAT } = WebGLRenderingContext;

const UNIFORMS = ["u_sizeRatio", "u_correctionRatio", "u_matrix"] as const;

// Same vertex shader as sigma's own NodeCircleProgram, verbatim: places 3
// vertices at `size` distance from the node center at 0°/120°/240° (a
// triangle that circumscribes a circle of radius `size / 2`), and passes the
// per-vertex offset + radius to the fragment shader for the actual circle
// (and now sphere) math.
const VERTEX_SHADER_SOURCE = /*glsl*/ `
attribute vec4 a_id;
attribute vec4 a_color;
attribute vec2 a_position;
attribute float a_size;
attribute float a_angle;

uniform mat3 u_matrix;
uniform float u_sizeRatio;
uniform float u_correctionRatio;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

const float bias = 255.0 / 254.0;

void main() {
  float size = a_size * u_correctionRatio / u_sizeRatio * 4.0;
  vec2 diffVector = size * vec2(cos(a_angle), sin(a_angle));
  vec2 position = a_position + diffVector;
  gl_Position = vec4(
    (u_matrix * vec3(position, 1)).xy,
    0,
    1
  );

  v_diffVector = diffVector;
  v_radius = size / 2.0;

  #ifdef PICKING_MODE
  v_color = a_id;
  #else
  v_color = a_color;
  #endif

  v_color.a *= bias;
}
`;

// The fragment shader is where this diverges from NodeCircleProgram: the
// PICKING_MODE branch is untouched (hit-testing reads the raw id-color, no
// shading), but the normal branch reconstructs a hemisphere normal from the
// fragment's position within the node's own radius (0 at center, 1 at the
// rim — the classic "2D circle silhouette of a 3D sphere" trick: the visible
// radius IS the sphere's XY extent, so Z falls out of |normal| = 1) and
// lights it with one fixed directional light. Everything stays inside the
// existing antialiased circle boundary (same `border`/`t` logic as the
// original) — no glow, no extra overdraw, same triangle geometry as flat mode.
const FRAGMENT_SHADER_SOURCE = /*glsl*/ `
precision highp float;

varying vec4 v_color;
varying vec2 v_diffVector;
varying float v_radius;

uniform float u_correctionRatio;

const vec4 transparent = vec4(0.0, 0.0, 0.0, 0.0);

// Light direction in the sphere's own local frame (x/y in node-space, z out
// of the screen toward the viewer) — fixed rather than theme-dependent: the
// shading is relative to the node's OWN color (lighten toward white, darken
// toward black), which reads correctly against any canvas background.
const vec3 LIGHT_DIR = vec3(-0.5477, -0.5477, 0.6325); // normalize(vec3(-0.6, -0.6, 0.7)), precomputed
const float AMBIENT = 0.62;
const float DIFFUSE = 0.5;
const float SPECULAR = 0.55;
const float SPECULAR_POWER = 20.0;
const float RIM_DARKEN = 0.22;

void main(void) {
  float border = u_correctionRatio * 2.0;
  float dist = length(v_diffVector) - v_radius + border;

  // No shading for picking mode — the encoded id color must stay exact.
  #ifdef PICKING_MODE
  if (dist > border)
    gl_FragColor = transparent;
  else
    gl_FragColor = v_color;

  #else
  float t = 0.0;
  if (dist > border)
    t = 1.0;
  else if (dist > 0.0)
    t = dist / border;

  float safeRadius = max(v_radius, 0.0001);
  float r = clamp(length(v_diffVector) / safeRadius, 0.0, 1.0);
  vec2 xy = v_diffVector / safeRadius;
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 normal = vec3(xy, z);

  float diffuse = max(dot(normal, LIGHT_DIR), 0.0);
  float specular = pow(diffuse, SPECULAR_POWER);

  vec3 shaded = v_color.rgb * (AMBIENT + DIFFUSE * diffuse);
  shaded += vec3(1.0) * specular * SPECULAR;
  // Soft contained rim shadow — stays within the existing circle radius.
  shaded *= mix(1.0, 1.0 - RIM_DARKEN, smoothstep(0.72, 1.0, r));

  gl_FragColor = mix(vec4(shaded, v_color.a), transparent, t);
  #endif
}
`;

export default class GlossyNodeProgram extends NodeProgram<(typeof UNIFORMS)[number]> {
  static readonly ANGLE_1 = 0;
  static readonly ANGLE_2 = (2 * Math.PI) / 3;
  static readonly ANGLE_3 = (4 * Math.PI) / 3;

  getDefinition(): InstancedProgramDefinition<(typeof UNIFORMS)[number]> {
    return {
      VERTICES: 3,
      VERTEX_SHADER_SOURCE,
      FRAGMENT_SHADER_SOURCE,
      METHOD: WebGLRenderingContext.TRIANGLES,
      UNIFORMS,
      ATTRIBUTES: [
        { name: "a_position", size: 2, type: FLOAT },
        { name: "a_size", size: 1, type: FLOAT },
        { name: "a_color", size: 4, type: UNSIGNED_BYTE, normalized: true },
        { name: "a_id", size: 4, type: UNSIGNED_BYTE, normalized: true },
      ],
      CONSTANT_ATTRIBUTES: [{ name: "a_angle", size: 1, type: FLOAT }],
      CONSTANT_DATA: [[GlossyNodeProgram.ANGLE_1], [GlossyNodeProgram.ANGLE_2], [GlossyNodeProgram.ANGLE_3]],
    };
  }

  processVisibleItem(nodeIndex: number, startIndex: number, data: NodeDisplayData): void {
    const array = this.array;
    const color = floatColor(data.color);
    array[startIndex++] = data.x;
    array[startIndex++] = data.y;
    array[startIndex++] = data.size;
    array[startIndex++] = color;
    array[startIndex++] = nodeIndex;
  }

  setUniforms(params: RenderParams, { gl, uniformLocations }: ProgramInfo): void {
    const { u_sizeRatio, u_correctionRatio, u_matrix } = uniformLocations;
    gl.uniform1f(u_correctionRatio, params.correctionRatio);
    gl.uniform1f(u_sizeRatio, params.sizeRatio);
    gl.uniformMatrix3fv(u_matrix, false, params.matrix);
  }
}
