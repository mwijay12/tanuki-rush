import * as THREE from 'three';

// Gradient sky dome with sun glow and procedural drifting cumulus clouds.
export class Sky {
  constructor({ sunDir, zenith = 0x2f86e6, horizon = 0xcfeaff, sunColor = 0xfff4d6 } = {}) {
    this.uniforms = {
      uSunDir: { value: sunDir.clone().normalize() },
      uZenith: { value: new THREE.Color(zenith) },
      uHorizon: { value: new THREE.Color(horizon) },
      uSun: { value: new THREE.Color(sunColor) },
      uTime: { value: 0 },
      uCloudOffset: { value: new THREE.Vector2() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // push to far plane
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir, uZenith, uHorizon, uSun;
        uniform float uTime;
        uniform vec2 uCloudOffset;
        varying vec3 vDir;
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(h2(i), h2(i + vec2(1, 0)), u.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float a = 0.5, s = 0.0;
          for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
          return s;
        }
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y;
          float t = pow(clamp(max(y, 0.0) * 1.35, 0.0, 1.0), 0.55);
          vec3 col = mix(uHorizon, uZenith, t);
          // below horizon: hazy sea-ish tone
          col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.08, y));
          float sd = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSun * (pow(sd, 900.0) * 6.0 + pow(sd, 48.0) * 0.35 + pow(sd, 6.0) * 0.12);
          // clouds on a virtual plane
          if (y > 0.005) {
            vec2 uv = d.xz / (y + 0.08) * 1.4 + uCloudOffset;
            float c = fbm(uv * 0.9);
            float c2 = fbm(uv * 2.7 + 5.0);
            float m = smoothstep(0.52, 0.78, c * 0.75 + c2 * 0.35);
            m *= smoothstep(0.005, 0.12, y) * (1.0 - smoothstep(0.55, 0.95, y) * 0.6);
            vec3 cloudCol = mix(vec3(0.78, 0.84, 0.93), vec3(1.0), smoothstep(0.5, 0.9, c2 + sd * 0.4));
            col = mix(col, cloudCol, m * 0.92);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
  }

  update(dt, camera) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value += dt;
    this.uniforms.uCloudOffset.value.x += dt * 0.004;
    this.uniforms.uCloudOffset.value.y += dt * 0.0015;
  }
}
