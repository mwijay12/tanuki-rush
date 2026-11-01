// Shared materials for the tanuki model (toon ramp, inverted-hull outline, FX shaders).
import * as THREE from 'three';

export const COLORS = {
  fur: 0x8a5a34,
  furLight: 0xa66f40,
  cream: 0xf3e6cf,
  mask: 0x3b2a20,
  limb: 0x34261d,
  nose: 0x1a1412,
  earInner: 0xf0d8b2,
  red: 0xe8262d,
  redDark: 0xb3161f,
  leaf: 0x66cc3a,
  leafDark: 0x3e9a2a,
  stem: 0x5c8a24,
  shoe: 0x19c3c3,
  shoeDark: 0x0d8c96,
  sole: 0xfbfbf7,
  accent: 0xff8a1c,
  eyeWhite: 0xffffff,
  iris: 0x5a3316,
  pupil: 0x0c0806,
  mouth: 0x3a1a14,
  mouthIn: 0x6e1a20,
  tongue: 0xff7d8c,
  outline: 0x24160e,
};

/** 4-step toon ramp (DataTexture, NearestFilter). */
export function makeGradientMap(levels = [0.46, 0.66, 0.86, 1.0]) {
  const data = new Uint8Array(levels.map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255)));
  const tex = new THREE.DataTexture(data, levels.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Inverted-hull outline: back faces pushed out along the normal in clip space.
// Width is specified in world units, converted to pixels and clamped so the line stays
// readable when small on screen but never gets fat in close-ups. Works for skinned and
// static meshes (skinning chunks are compiled in only for SkinnedMesh).
// ---------------------------------------------------------------------------

const outlineVert = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <fog_pars_vertex>
uniform float uWidth;
uniform float uMinPx;
uniform float uMaxPx;
uniform vec2 uResolution;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
  vec3 nView = normalMatrix * objectNormal;
  float nLen = length( nView );
  nView = nLen > 1e-6 ? nView / nLen : vec3( 0.0, 0.0, 1.0 );
  vec4 clip = projectionMatrix * mvPosition;
  vec2 nClip = ( projectionMatrix * vec4( nView, 0.0 ) ).xy;
  float cLen = length( nClip );
  vec2 dir = cLen > 1e-6 ? nClip / cLen : vec2( 0.0 );
  vec2 res = max( uResolution, vec2( 1.0 ) );
  float persp = clamp( -projectionMatrix[2][3], 0.0, 1.0 );
  float depth = mix( 1.0, max( -mvPosition.z, 1e-3 ), persp );
  float pxPerUnit = projectionMatrix[1][1] * res.y * 0.5 / depth;
  float scale = res.y / 1080.0;
  float px = clamp( uWidth * pxPerUnit, uMinPx * scale, uMaxPx * scale );
  clip.xy += dir * ( px * 2.0 / res ) * clip.w;
  // tiny push away from the camera so the hull never pokes through front faces
  clip.z += 0.00002 * clip.w;
  gl_Position = clip;
  #include <fog_vertex>
}
`;

const outlineFrag = /* glsl */ `
uniform vec3 uColor;
#include <common>
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4( uColor, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function makeOutlineMaterial({ color = COLORS.outline, width = 0.016, minPx = 1.0, maxPx = 3.0 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColor: { value: new THREE.Color(color) },
        uWidth: { value: width },
        uMinPx: { value: minPx },
        uMaxPx: { value: maxPx },
        uResolution: { value: new THREE.Vector2(1920, 1080) },
      },
    ]),
    vertexShader: outlineVert,
    fragmentShader: outlineFrag,
    side: THREE.BackSide,
    fog: true,
  });
  mat.name = 'TanukiOutline';
  return mat;
}

/**
 * onBeforeRender hook that feeds the current target size (render target when rendering
 * through post-processing, otherwise the drawing buffer) into the outline material.
 */
export function makeOutlineResolutionHook(material) {
  const v = new THREE.Vector2();
  return function onBeforeRender(renderer) {
    const rt = renderer.getRenderTarget();
    if (rt) v.set(rt.width, rt.height);
    else renderer.getDrawingBufferSize(v);
    material.uniforms.uResolution.value.copy(v);
  };
}

// ---------------------------------------------------------------------------
// Toon materials
// ---------------------------------------------------------------------------

export function makeToonVertexColorMaterial(gradientMap) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
  m.name = 'TanukiToon';
  return m;
}

export function makeFaceMaterial() {
  // Eyes / mouth are unlit so they stay crisp and bright in any lighting.
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  m.name = 'TanukiFace';
  return m;
}

export function makeRibbonMaterial(gradientMap) {
  const m = new THREE.MeshToonMaterial({ color: COLORS.red, gradientMap, side: THREE.DoubleSide });
  m.name = 'TanukiRibbon';
  return m;
}

// ---------------------------------------------------------------------------
// Spin-blur shell for the ball form (additive, pattern rotates about local X)
// ---------------------------------------------------------------------------

const fxVert = /* glsl */ `
varying vec3 vObj;
varying vec3 vNrm;
varying vec3 vView;
void main() {
  vObj = position;
  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
  vNrm = normalMatrix * normal;
  vView = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const spinFrag = /* glsl */ `
uniform float uAngle;
uniform float uRadius;
uniform float uIntensity;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec3 vObj;
varying vec3 vNrm;
varying vec3 vView;
void main() {
  vec3 n = normalize( vNrm + vec3( 1e-6 ) );
  vec3 v = normalize( vView + vec3( 1e-6 ) );
  float facing = clamp( abs( dot( n, v ) ), 0.0, 1.0 );
  float fres = pow( max( 1.0 - facing, 0.0 ), 2.0 );
  float z = abs( vObj.z ) < 1e-5 ? 1e-5 : vObj.z;
  float a = atan( vObj.y, z );
  float lat = clamp( vObj.x / max( uRadius, 1e-4 ), -1.0, 1.0 );
  // streak rings along the spin axis
  float rings = pow( max( 0.5 + 0.5 * cos( lat * 15.0 ), 0.0 ), 6.0 ) * ( 1.0 - lat * lat );
  // comet-shaped arcs travelling around the axis
  float sweep = fract( ( a + uAngle ) * 0.3183099 ); // 2 arcs per turn
  float arc = pow( max( 1.0 - sweep, 0.0 ), 2.2 ) * smoothstep( 0.0, 0.04, sweep );
  float streak = rings * arc * pow( max( fres, 0.0 ), 0.6 );
  float alpha = clamp( streak * 1.5, 0.0, 1.0 ) * uIntensity;
  vec3 col = mix( uColA, uColB, clamp( streak, 0.0, 1.0 ) );
  gl_FragColor = vec4( col, alpha );
}
`;

export function makeSpinBlurMaterial() {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uAngle: { value: 0 },
      uRadius: { value: 0.6 },
      uIntensity: { value: 1 },
      uColA: { value: new THREE.Color(0xfff2b0) },
      uColB: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: fxVert,
    fragmentShader: spinFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  m.name = 'TanukiSpinBlur';
  return m;
}

// ---------------------------------------------------------------------------
// Boost aura: an additive "energy hull" around the silhouette (inverted hull like the
// outline, but wider, flickering and stretched backwards). Hugs every pose, 1 draw call.
// ---------------------------------------------------------------------------

const auraVert = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float uTime;
uniform float uWidth;
uniform float uTrail;
varying float vFlick;
varying float vBack;
void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec3 n = objectNormal;
  float nl = length( n );
  n = nl > 1e-6 ? n / nl : vec3( 0.0, 1.0, 0.0 );
  float wob = 0.5 + 0.5 * sin( transformed.y * 23.0 - uTime * 17.0 + sin( transformed.x * 31.0 + uTime * 5.0 ) * 2.0 );
  float back = max( -n.z, 0.0 );
  vec3 p = transformed + n * uWidth * ( 0.7 + 0.6 * wob );
  p.z -= uTrail * back * ( 0.6 + 0.4 * wob );
  p.y += uWidth * 0.8 * max( n.y, 0.0 ) * wob;
  vFlick = wob;
  vBack = back;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  vec4 clip = projectionMatrix * mv;
  // depth as if 0.35 m further away: the glow only shows around the silhouette,
  // never on top of the body itself
  vec4 far = projectionMatrix * vec4( mv.xy, mv.z - 0.35, 1.0 );
  clip.z = far.z / max( abs( far.w ), 1e-5 ) * clip.w;
  gl_Position = clip;
}
`;

const auraFrag = /* glsl */ `
uniform float uIntensity;
uniform vec3 uColA;
uniform vec3 uColB;
varying float vFlick;
varying float vBack;
void main() {
  float a = clamp( ( 0.4 + 0.6 * vFlick ) * ( 1.0 - 0.4 * vBack ), 0.0, 1.0 ) * uIntensity;
  vec3 col = mix( uColA, uColB, vFlick * vFlick );
  gl_FragColor = vec4( col, a );
}
`;

export function makeAuraMaterial() {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uWidth: { value: 0.045 },
      uTrail: { value: 0.22 },
      uColA: { value: new THREE.Color(0x46e6ff) },
      uColB: { value: new THREE.Color(0xfffbe0) },
    },
    vertexShader: auraVert,
    fragmentShader: auraFrag,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  m.name = 'TanukiAura';
  return m;
}
