import * as THREE from 'three';
import { chooseResolution } from './resolution.js';

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
    this.ratioCap = 1.5;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.ratioCap);
    this.onResize = [];

    // A driver that drops the context leaves a canvas that still has its size
    // and paints nothing, which from the outside looks exactly like the page not
    // being drawn at all. Say so, and let the driver restore it.
    this.contextLost = false;
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
      console.error('[tanuki-web] WebGL context lost at ' +
        this.renderer.getContext().drawingBufferWidth + 'x' +
        this.renderer.getContext().drawingBufferHeight);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      console.warn('[tanuki-web] WebGL context restored');
      this.resize();
    });

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setPixelRatioCap(cap) {
    this.ratioCap = cap;
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const r = chooseResolution(w, h, window.devicePixelRatio || 1, this.ratioCap);
    this.pixelRatio = r.pixelRatio;
    this.renderer.setPixelRatio(r.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w; this.height = h;
    this.bufferWidth = r.width;
    this.bufferHeight = r.height;
    for (const fn of this.onResize) fn(r.width, r.height);
  }
}
