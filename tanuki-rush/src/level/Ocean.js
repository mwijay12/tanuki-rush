import * as THREE from 'three';

// Big stylised sea plane with sun glitter; follows the camera horizontally.
export class Ocean {
  constructor({ sunDir, level = 0 } = {}) {
    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: sunDir.clone().normalize() },
      uDeep: { value: new THREE.Color(0x0f5aa6) },
      uShallow: { value: new THREE.Color(0x2b93c9) },
      uCamPos: { value: new THREE.Vector3() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, this.uniforms]),
      fog: true,
      vertexShader: /* glsl */`
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform vec3 uSunDir, uDeep, uShallow, uCamPos;
        varying vec3 vWorld;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
        }
        void main() {
          vec2 p = vWorld.xz;
          float w = noise(p * 0.05 + vec2(uTime * 0.2, uTime * 0.13)) * 0.6 + noise(p * 0.21 - vec2(uTime * 0.35, 0.0)) * 0.4;
          vec3 V = normalize(uCamPos - vWorld);
          float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
          vec3 col = mix(uDeep, uShallow, w * 0.5 + 0.2);
          col = mix(col, vec3(0.62, 0.8, 0.95), fres * 0.45);
          // sun glitter
          vec3 Rf = reflect(-V, normalize(vec3((w - 0.5) * 0.25, 1.0, (noise(p * 0.3 + uTime) - 0.5) * 0.25)));
          float g = pow(max(dot(Rf, normalize(uSunDir)), 0.0), 400.0);
          float sparkle = step(0.82, noise(p * 1.7 + uTime * 1.3));
          col += vec3(1.0, 0.97, 0.88) * g * (0.4 + sparkle * 1.2);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(24000, 24000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = level;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    this.mat = mat;
  }

  update(dt, camera) {
    this.mat.uniforms.uTime.value += dt;
    this.mat.uniforms.uCamPos.value.copy(camera.position);
    this.mesh.position.x = camera.position.x;
    this.mesh.position.z = camera.position.z;
  }
}
