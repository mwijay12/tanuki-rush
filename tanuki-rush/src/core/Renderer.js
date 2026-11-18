import * as THREE from 'three';
import { bootNote } from './bootTracer.js';

// Owns the WebGLRenderer, main scene/camera and the resize logic.
export class Renderer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0xbfe3ff, 1);
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.3, 6000);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.onResize = [];
    window.addEventListener('resize', () => this.resize());
    this.resize();

    // A driver that drops the context leaves a canvas that still has its size
    // and paints nothing, which from the outside is indistinguishable from the
    // page not being drawn at all. Say so, and let the driver restore it.
    this.contextLost = false;
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
      bootNote('WebGL context lost');
      console.error('[tanuki-web] WebGL context lost; waiting for the driver to restore it');
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      bootNote('WebGL context restored');
      console.warn('[tanuki-web] WebGL context restored');
      this.resize();
    });
  }

  setPixelRatioCap(cap) {
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, cap);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w; this.height = h;
    for (const fn of this.onResize) fn(w * this.pixelRatio, h * this.pixelRatio);
  }
}
