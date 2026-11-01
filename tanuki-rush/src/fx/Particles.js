import * as THREE from 'three';

// Pooled CPU particles rendered as one THREE.Points with soft round sprites.
export class Particles {
  constructor(max = 2400) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.head = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setAttribute('size', this.aSize);
    g.setAttribute('alpha', this.aAlpha);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute float size; attribute float alpha; attribute vec3 color;
        uniform float uScale;
        varying vec3 vCol; varying float vA;
        void main() {
          vCol = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // fade out particles that get too close to the camera (no screen-filling blobs)
          float dz = -mv.z;
          vA = alpha * smoothstep(1.5, 5.0, dz);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * uScale / max(dz, 0.1), 0.0, 120.0);
          if (vA <= 0.0) gl_PointSize = 0.0;
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol; varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0;
          float a = clamp(1.0 - r, 0.0, 1.0);
          a = a * a * vA;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vCol * a, a);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  setViewportHeight(h) { this.material.uniforms.uScale.value = h * 0.9; }

  spawn(p, v, { color = 0xffffff, size = 0.5, life = 0.6, drag = 1, gravity = 0, grow = 0, alpha = 1 } = {}) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const c = _c.set(color);
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.size0[i] = size; this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.drag[i] = drag; this.grav[i] = gravity; this.grow[i] = grow;
    this.alpha[i] = alpha;
    this.a0[i] = alpha;
  }

  burst(p, n, { speed = 8, color = 0xffffff, size = 0.5, life = 0.6, drag = 2, gravity = 0, up = 0, spread = 1, grow = 0, alpha = 1, colors = null } = {}) {
    for (let k = 0; k < n; k++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.65) * spread);
      _v.y += up;
      const col = colors ? colors[(Math.random() * colors.length) | 0] : color;
      this.spawn(p, _v, { color: col, size: size * (0.6 + Math.random() * 0.8), life: life * (0.6 + Math.random() * 0.6), drag, gravity, grow, alpha });
    }
  }

  update(dt) {
    const n = this.max;
    for (let i = 0; i < n; i++) {
      if (this.life[i] <= 0) { if (this.alpha[i] !== 0) this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      this.vel[j] *= k; this.vel[j + 1] = this.vel[j + 1] * k - this.grav[i] * dt; this.vel[j + 2] *= k;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.alpha[i] = this.a0[i] * Math.min(1, t * 2.5);
      this.size[i] = this.size0[i] * (1 + this.grow[i] * (1 - t));
      if (this.life[i] <= 0) this.alpha[i] = 0;
    }
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true;
  }

  clear() { this.life.fill(0); this.alpha.fill(0); }
}

const _c = new THREE.Color();
const _v = new THREE.Vector3();
