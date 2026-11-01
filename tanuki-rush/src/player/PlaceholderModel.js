import * as THREE from 'three';

// Stand-in with the same API as TanukiModel (used until / if the real model fails to load).
export class PlaceholderModel {
  constructor() {
    this.root = new THREE.Group();
    this.ballRadius = 0.55;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 0.5, 4, 8), new THREE.MeshLambertMaterial({ color: 0x8a5a34 }));
    body.position.y = 0.65;
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshLambertMaterial({ color: 0x222222 }));
    nose.position.set(0, 0.95, 0.35);
    this.figure = new THREE.Group();
    this.figure.add(body, nose);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(this.ballRadius, 16, 12), new THREE.MeshLambertMaterial({ color: 0x8a5a34 }));
    this.ball.position.y = this.ballRadius;
    const band = new THREE.Mesh(new THREE.TorusGeometry(this.ballRadius, 0.06, 6, 20), new THREE.MeshLambertMaterial({ color: 0x3b2a20 }));
    band.rotation.y = Math.PI / 2;
    this.ball.add(band);
    this.root.add(this.figure, this.ball);
    this.state = 'idle';
    this.spin = 0;
  }
  setState(s) { this.state = s; }
  update(dt, { speed = 0 } = {}) {
    const ball = this.state === 'ball';
    this.figure.visible = !ball;
    this.ball.visible = ball;
    if (ball) { this.spin += dt * (18 + speed * 0.4); this.ball.rotation.x = this.spin; }
  }
  dispose() {}
}
