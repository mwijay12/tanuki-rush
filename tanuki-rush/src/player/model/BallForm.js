// Ball form: the tanuki curled into a ball, wrapped in its dark tail rings.
// Two dark bands cross at the spin axis (local X) so the forward roll reads from any angle;
// a cream belly quadrant and the ears add asymmetry. An additive shell adds motion streaks.
import * as THREE from 'three';
import {
  ellipsoid,
  sphereBand,
  StaticGeometryBuilder,
  EllipsoidSurface,
  fillDecal,
  ellipseShape,
} from './geometry.js';
import { COLORS, makeSpinBlurMaterial } from './materials.js';

export class BallForm {
  constructor(toonMaterial, outlineMaterial, outlineHook, radius = 0.55) {
    this.radius = radius;
    this.group = new THREE.Object3D();
    this.group.name = 'TanukiBall';
    this.group.position.set(0, radius, 0);
    this.spinner = new THREE.Object3D();
    this.group.add(this.spinner);

    const R = radius;
    const coreR = R * 0.985;
    const b = new StaticGeometryBuilder();
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    b.add(ellipsoid(coreR, coreR, coreR, 40, 28), { color: COLORS.fur, outline: true });

    // cream belly patch in one quadrant
    const core = V(coreR, coreR, coreR);
    const belly = new EllipsoidSurface(V(0, 0, 0), core, V(0, 0.7071, 0.7071));
    b.add(fillDecal(ellipseShape(0, 0, 0.44, 0.36, 0, 36), belly, 0.004, 6), { color: COLORS.cream });

    // the ringed tail wrapped around the ball: a band on the great circle in the XY plane
    // (contains the spin axis X, so it tumbles visibly) with alternating tail-ring colours,
    // crossed by the red hachimaki band in the XZ plane
    const furC = new THREE.Color(COLORS.furLight);
    const darkC = new THREE.Color(COLORS.mask);
    const tailBand = sphereBand(coreR + 0.004, 0.2, 120, 4);
    b.add(tailBand, {
      colorFn: (i, p, out) => {
        const a = Math.atan2(p.y, p.x);
        const u = (a + Math.PI) / (Math.PI * 2);
        out.copy(Math.floor(u * 12) % 2 === 0 ? darkC : furC);
      },
    });
    const band2 = sphereBand(coreR + 0.007, 0.13, 96, 4);
    band2.rotateX(Math.PI / 2); // XZ plane (contains X): the red hachimaki
    b.add(band2, { color: COLORS.red });

    // ears poking out of the quadrant opposite the belly
    for (const s of [1, -1]) {
      const dir = V(s * 0.42, -0.64, -0.64).normalize();
      const p = dir.clone().multiplyScalar(coreR * 0.96);
      const ear = ellipsoid(0.085, 0.078, 0.05, 16, 12);
      ear.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir));
      ear.translate(p.x, p.y, p.z);
      b.add(ear, { color: COLORS.furLight, outline: true });
    }

    const geos = b.build();
    this.geometry = geos.main;
    this.outlineGeometry = geos.outline;
    this.mesh = new THREE.Mesh(this.geometry, toonMaterial);
    this.mesh.castShadow = true;
    this.outline = new THREE.Mesh(this.outlineGeometry, outlineMaterial);
    this.outline.onBeforeRender = outlineHook;
    this.spinner.add(this.mesh, this.outline);

    // spin blur shell (not rotating; its pattern is animated in the shader)
    this.blurMaterial = makeSpinBlurMaterial();
    this.blurMaterial.uniforms.uRadius.value = R * 1.04;
    this.blurGeometry = new THREE.SphereGeometry(R * 1.04, 40, 24);
    this.blur = new THREE.Mesh(this.blurGeometry, this.blurMaterial);
    this.blur.renderOrder = 2;
    this.group.add(this.blur);

    this.spin = 0;
    this.blurAngle = 0;
    this.pop = 10;
    this.group.visible = false;
  }

  triggerPop() {
    this.pop = 0;
  }

  update(dt, t, speed, boost) {
    const w = Math.min(24, 9 + speed * 0.45);
    this.spin = (this.spin + w * dt) % (Math.PI * 2);
    this.spinner.rotation.set(this.spin, 0, Math.sin(t * 7) * 0.04);
    // squash & stretch pop on entering the ball
    this.pop += dt;
    const k = Math.exp(-this.pop * 9) * Math.cos(this.pop * 26);
    const sy = 1 - 0.28 * k;
    const sxz = 1 + 0.2 * k;
    this.group.scale.set(sxz, sy, sxz);
    this.group.position.y = this.radius * sy;
    const u = this.blurMaterial.uniforms;
    this.blurAngle = (this.blurAngle + w * 1.15 * dt) % (Math.PI * 2);
    u.uAngle.value = this.blurAngle;
    u.uIntensity.value = 0.5 + 0.4 * Math.min(1, speed / 40) + 0.6 * boost;
  }

  dispose() {
    this.geometry.dispose();
    this.outlineGeometry.dispose();
    this.blurGeometry.dispose();
    this.blurMaterial.dispose();
  }
}
