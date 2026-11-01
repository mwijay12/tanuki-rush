import * as THREE from 'three';
import { getTextures } from './textures.js';

// Shared GLSL helpers injected into patched built-in materials.
const HASH = /* glsl */ `
float bHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

/**
 * Lambert material whose vertical faces get a procedural, anti-aliased window grid
 * computed from WORLD coordinates (works for instanced boxes and extruded track solids alike).
 */
export function createBuildingMaterial({ color = 0xffffff, instanced = false, glassTint = null } = {}) {
  const mat = new THREE.MeshLambertMaterial({ color });
  mat.userData.glassTint = glassTint;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vBWorld; varying vec3 vBNormal; varying vec3 vBSeed;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 bw = vec4(transformed, 1.0);
  vec3 bn = objectNormal;
  #ifdef USE_INSTANCING
    bw = instanceMatrix * bw;
    bn = mat3(instanceMatrix) * bn;
    vBSeed = instanceMatrix[3].xyz;
  #else
    vBSeed = vec3(0.0);
  #endif
  bw = modelMatrix * bw;
  vBWorld = bw.xyz;
  vBNormal = mat3(modelMatrix) * bn;
}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vBWorld; varying vec3 vBNormal; varying vec3 vBSeed;
${HASH}
float bBox(float x, float lo, float hi, float w) {
  return smoothstep(lo - w, lo + w, x) - smoothstep(hi - w, hi + w, x);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 n = normalize(vBNormal + vec3(0.0, 1e-5, 0.0));
  float vertical = 1.0 - smoothstep(0.35, 0.65, abs(n.y));
  float seed = bHash(vBSeed.xz * 0.013 + 0.17);
  vec3 tdir = normalize(vec3(-n.z, 0.0, n.x) + vec3(1e-5, 0.0, 0.0));
  float colW = mix(2.4, 3.8, seed);
  float rowH = mix(3.3, 4.0, fract(seed * 7.3));
  vec2 cell = vec2(dot(vBWorld, tdir) / colW, (vBWorld.y + seed * 3.0) / rowH);
  vec2 f = fract(cell);
  vec2 id = floor(cell);
  vec2 fw = fwidth(cell) + 1e-4;
  float wx = mix(0.14, 0.26, fract(seed * 13.1));
  float win = bBox(f.x, wx, 1.0 - wx, fw.x) * bBox(f.y, 0.24, 0.86, fw.y);
  float far = smoothstep(0.25, 0.7, max(fw.x, fw.y));
  win = mix(win, 0.45, far);
  float r = bHash(id + seed * 31.0);
  vec3 glass = mix(vec3(0.16, 0.27, 0.42), vec3(0.62, 0.78, 0.92), clamp(f.y * 0.8 + r * 0.35, 0.0, 1.0));
  glass *= mix(0.7, 1.05, r);
  // floor band (slab edge) between rows
  float band = bBox(f.y, 0.0, 0.07, fw.y) * (1.0 - far);
  vec3 wall = diffuseColor.rgb * (1.0 - band * 0.25);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(wall, glass, win), vertical);
  // roofs: slightly darker, gravel-ish
  diffuseColor.rgb *= mix(0.82 + 0.1 * bHash(floor(vBWorld.xz * 0.5)), 1.0, vertical);
}`);
  };
  mat.customProgramCacheKey = () => 'building' + (instanced ? '_i' : '');
  return mat;
}

let shared = null;
export function getMaterials() {
  if (shared) return shared;
  const tex = getTextures();
  const lam = (map, extra = {}) => new THREE.MeshLambertMaterial({ map, ...extra });
  shared = {
    street: lam(tex.street),
    roof: lam(tex.roof),
    loop: lam(tex.loop, { emissive: new THREE.Color(0x0a1a40) }),
    bridge: lam(tex.bridge),
    pier: lam(tex.pier),
    plaza: lam(tex.plaza),
    highway: lam(tex.bridge),
    board: lam(tex.street),
    facade: createBuildingMaterial({ color: 0xf1e3c8 }),
    solid: createBuildingMaterial({ color: 0xf1e3c8 }),
    skirt: lam(tex.concrete, { color: 0xb8b4ac }),
    underside: new THREE.MeshLambertMaterial({ color: 0xb3ada2, emissive: 0x2a2826 }),
    railing: lam(tex.railing, { side: THREE.DoubleSide }),
    parapet: new THREE.MeshLambertMaterial({ color: 0xd9d4c8, side: THREE.DoubleSide }),
    rail: new THREE.MeshPhongMaterial({ color: 0xdfe6ee, specular: 0xffffff, shininess: 90 }),
    railPost: new THREE.MeshLambertMaterial({ color: 0x5d6570 }),
  };
  return shared;
}
