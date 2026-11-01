import * as THREE from 'three';

// Single full-screen composite pass: radial "zoom" blur toward the vanishing point,
// speed lines, chromatic aberration, vignette, flash, grading.
export class PostFX {
  constructor(renderer, { samples = 4 } = {}) {
    this.renderer = renderer;
    this.samples = samples;
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
    });
    this.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this.uniforms = {
      tScene: { value: this.rt.texture },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
      uBlur: { value: 0 },
      uLines: { value: 0 },
      uCA: { value: 0 },
      uVignette: { value: 0.25 },
      uTime: { value: 0 },
      uFlash: { value: new THREE.Vector4(1, 1, 1, 0) },
      uWarn: { value: 0 },
      uFade: { value: 0 },
      uSat: { value: 1.08 },
      uShock: { value: -1 },
      uTexel: { value: new THREE.Vector2(1 / 4, 1 / 4) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tScene;
        uniform vec2 uCenter, uTexel;
        uniform float uAspect, uBlur, uLines, uCA, uVignette, uTime, uWarn, uFade, uSat, uShock;
        uniform vec4 uFlash;
        varying vec2 vUv;
        float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
          vec2 d = uv - uCenter;
          vec2 da = d * vec2(uAspect, 1.0);
          float r = length(da);
          // boost shockwave: an expanding refraction ring
          if (uShock >= 0.0) {
            float ringR = uShock * 1.3;
            float band = (r - ringR) / 0.07;
            float w = exp(-band * band) * (1.0 - uShock);
            uv -= (da / max(r, 1e-4)) * vec2(1.0 / uAspect, 1.0) * w * 0.035;
            d = uv - uCenter;
          }
          // radial zoom blur, keep the centre crisp
          float k = uBlur * smoothstep(0.08, 0.55, r);
          vec3 acc = vec3(0.0);
          float wsum = 0.0;
          const int N = 10;
          for (int i = 0; i < N; i++) {
            float t = float(i) / float(N - 1);
            float w = 1.0 - t * 0.6;
            vec2 suv = uCenter + d * (1.0 - k * t);
            acc += texture2D(tScene, suv).rgb * w;
            wsum += w;
          }
          vec3 col = acc / max(wsum, 1e-4);
          // chromatic aberration on the outer ring
          float ca = uCA * smoothstep(0.25, 0.9, r);
          if (ca > 0.0005) {
            vec2 off = d * ca;
            col.r = mix(col.r, texture2D(tScene, uv + off).r, 0.85);
            col.b = mix(col.b, texture2D(tScene, uv - off).b, 0.85);
          }
          // saturation
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(l), col, uSat);
          // speed lines
          if (uLines > 0.001) {
            float ang = atan(da.y, da.x);
            float bins = 110.0;
            float a = (ang / 6.28318 + 0.5) * bins;
            float id = floor(a);
            float f = fract(a);
            float h = hash(id + floor(uTime * 24.0) * 3.17);
            float h2 = hash(id * 1.7 + 11.0);
            float thin = smoothstep(0.0, 0.18, f) * smoothstep(0.5 + h2 * 0.3, 0.22, f);
            float len = fract(r * 1.6 - uTime * (3.0 + h2 * 3.0) + h2 * 7.0);
            float seg = smoothstep(0.0, 0.25, len) * smoothstep(0.95, 0.55, len);
            float on = step(1.0 - 0.28 * uLines, h);
            float radial = smoothstep(0.28, 0.75, r);
            float line = on * thin * seg * radial * uLines;
            col = mix(col, vec3(1.0), clamp(line * 0.55, 0.0, 1.0));
          }
          // vignette
          float vig = smoothstep(0.35, 1.05, r);
          col *= 1.0 - vig * uVignette;
          // warning pulse (red edges)
          if (uWarn > 0.0) {
            float pulse = 0.5 + 0.5 * sin(uTime * 14.0);
            col = mix(col, vec3(1.0, 0.1, 0.05), vig * uWarn * (0.35 + 0.35 * pulse));
          }
          col = mix(col, uFlash.rgb, uFlash.a);
          col *= 1.0 - uFade;
          gl_FragColor = vec4(max(col, 0.0), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.quad = new THREE.Mesh(geo, this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.flash = { r: 1, g: 1, b: 1, a: 0 };
  }

  setSize(w, h) {
    this.rt.setSize(Math.max(1, w | 0), Math.max(1, h | 0));
    this.uniforms.uAspect.value = w / Math.max(1, h);
    this.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  setSamples(n) {
    this.rt.samples = n;
    this.rt.dispose();
  }

  doFlash(color = 0xffffff, a = 0.6) {
    const c = new THREE.Color(color);
    this.flash.r = c.r; this.flash.g = c.g; this.flash.b = c.b; this.flash.a = Math.max(this.flash.a, a);
  }

  shock() { this.uniforms.uShock.value = 0; }

  update(dt) {
    this.uniforms.uTime.value += dt;
    const sh = this.uniforms.uShock;
    if (sh.value >= 0) { sh.value += dt / 0.45; if (sh.value > 1) sh.value = -1; }
    this.flash.a = Math.max(0, this.flash.a - dt * 2.5);
    this.uniforms.uFlash.value.set(this.flash.r, this.flash.g, this.flash.b, this.flash.a);
  }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.scene, this.cam);
  }
}
