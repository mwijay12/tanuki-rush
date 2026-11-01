// Builds the tanuki skeleton and the merged, skinned body / face / outline geometries.
// Units: metres. Model faces +Z, up is +Y, origin at the feet. Bind pose = all bone
// rotations zero (arms hang straight down; poses add the outward angle).
import * as THREE from 'three';
import {
  ellipsoid,
  smoothSphere,
  deform,
  limbCapsule,
  superEllipsoid,
  flatTorus,
  revolve,
  EllipsoidSurface,
  RevolvedSurface,
  ellipseShape,
  clipShape,
  fillDecal,
  strokeDecal,
  headBand,
  RigGeometryBuilder,
} from './geometry.js';
import { COLORS } from './materials.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------------------
// Key dimensions (bind pose, model space)
// ---------------------------------------------------------------------------
export const DIM = {
  headC: V(0, 0.975, 0.02),
  headR: V(0.285, 0.255, 0.265),
  // torso: egg-shaped surface of revolution
  torsoYc: 0.5,
  torsoH: 0.265,
  torsoR: 0.218,
  torsoEgg: 0.13,
  torsoZs: 0.9,
  muzzleR: V(0.122, 0.086, 0.104),
  tailDir: V(0, 0.3, -1).normalize(),
  tailSeg: 0.115,
  tailLen: 0.6,
};
/** muzzle ellipsoid centre (model space, bind pose) */
DIM.muzzleC = DIM.headC.clone().add(V(0, -0.088, 0.186));
/** hachimaki knot at the back of the head (model space, bind pose); ribbons start here */
DIM.knot = DIM.headC.clone().add(V(0, 0.03, -0.285));

export function torsoRadius(y) {
  const u = (y - DIM.torsoYc) / DIM.torsoH;
  if (u <= -1 || u >= 1) return 0;
  return DIM.torsoR * Math.sqrt(1 - u * u) * (1 - DIM.torsoEgg * u);
}
function torsoDRadius(y) {
  const u = (y - DIM.torsoYc) / DIM.torsoH;
  const S = Math.sqrt(Math.max(1 - u * u, 1e-4));
  return (DIM.torsoR * ((-u / S) * (1 - DIM.torsoEgg * u) + S * -DIM.torsoEgg)) / DIM.torsoH;
}

function headDir(yaw, pitch) {
  return V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
}

function headSurfacePoint(dir) {
  const d = dir.clone().normalize();
  const r = DIM.headR;
  const k = Math.sqrt((d.x / r.x) ** 2 + (d.y / r.y) ** 2 + (d.z / r.z) ** 2);
  return d.multiplyScalar(1 / k).add(DIM.headC);
}

// ---------------------------------------------------------------------------
// Skeleton definition: [name, parent, world bind position, euler order]
// ---------------------------------------------------------------------------
function boneTable() {
  const C = DIM.headC;
  const eyeCenter = headSurfacePoint(headDir(0, 0.04));
  const leafBase = headSurfacePoint(V(0.12, 1, -0.06));
  const mouthSurf = new EllipsoidSurface(DIM.muzzleC, DIM.muzzleR, V(0, -0.5, 0.87));
  const mouthPt = V();
  mouthSurf.map(0, -0.02, 0, mouthPt, V());
  const tailRoot = V(0, 0.37, -0.12);
  const D = DIM.tailDir;
  const T = (i) => tailRoot.clone().addScaledVector(D, DIM.tailSeg * i);
  const t = [
    ['hips', null, V(0, 0.36, 0), 'YXZ'],
    ['spine', 'hips', V(0, 0.4, 0), 'YXZ'],
    ['head', 'spine', V(0, 0.74, 0), 'YXZ'],
    ['earL', 'head', C.clone().add(V(0.165, 0.185, -0.03)), 'XYZ'],
    ['earR', 'head', C.clone().add(V(-0.165, 0.185, -0.03)), 'XYZ'],
    ['leaf', 'head', leafBase, 'XYZ'],
    ['eyes', 'head', V(0, eyeCenter.y, eyeCenter.z), 'XYZ'],
    ['eyesHappy', 'head', V(0, eyeCenter.y, eyeCenter.z), 'XYZ'],
    ['mouth', 'head', mouthPt.clone(), 'XYZ'],
    ['mouthOpen', 'head', mouthPt.clone(), 'XYZ'],
    ['shL', 'spine', V(0.178, 0.615, 0), 'ZXY'],
    ['elL', 'shL', V(0.178, 0.485, 0), 'XYZ'],
    ['wrL', 'elL', V(0.178, 0.375, 0), 'XYZ'],
    ['shR', 'spine', V(-0.178, 0.615, 0), 'ZXY'],
    ['elR', 'shR', V(-0.178, 0.485, 0), 'XYZ'],
    ['wrR', 'elR', V(-0.178, 0.375, 0), 'XYZ'],
    ['thL', 'hips', V(0.095, 0.33, 0), 'ZXY'],
    ['knL', 'thL', V(0.095, 0.215, 0), 'XYZ'],
    ['anL', 'knL', V(0.095, 0.105, 0), 'XZY'],
    ['thR', 'hips', V(-0.095, 0.33, 0), 'ZXY'],
    ['knR', 'thR', V(-0.095, 0.215, 0), 'XYZ'],
    ['anR', 'knR', V(-0.095, 0.105, 0), 'XZY'],
    ['t0', 'hips', T(0), 'YXZ'],
    ['t1', 't0', T(1), 'YXZ'],
    ['t2', 't1', T(2), 'YXZ'],
    ['t3', 't2', T(3), 'YXZ'],
    ['t4', 't3', T(4), 'YXZ'],
  ];
  return t;
}

/**
 * Creates bones (attached under `parent`) and returns { bones, byName, bonePos, boneIndex }.
 */
export function createSkeletonBones(parent) {
  const table = boneTable();
  const bones = [];
  const byName = {};
  const bonePos = {};
  const boneIndex = {};
  table.forEach(([name, par, wpos, order], i) => {
    const b = new THREE.Bone();
    b.name = name;
    b.rotation.order = order;
    const pp = par ? bonePos[par] : V(0, 0, 0);
    b.position.copy(wpos).sub(pp);
    (par ? byName[par] : parent).add(b);
    bones.push(b);
    byName[name] = b;
    bonePos[name] = wpos.clone();
    boneIndex[name] = i;
  });
  // remember bind positions for channels that offset positions
  for (const b of bones) b.userData.bindPos = b.position.clone();
  return { bones, byName, bonePos, boneIndex };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export function buildTanukiGeometry(bonePos, boneIndex) {
  const B = new RigGeometryBuilder(bonePos, boneIndex);
  const C = DIM.headC;
  const HR = DIM.headR;
  const col = (hex) => new THREE.Color(hex);

  // ---------------- torso (spine) ----------------
  {
    const prof = [];
    const y0 = DIM.torsoYc - DIM.torsoH;
    const y1 = DIM.torsoYc + DIM.torsoH;
    const rows = 30;
    for (let i = 0; i <= rows; i++) {
      // cosine spacing = denser rows near the poles
      const t = 0.5 - 0.5 * Math.cos((i / rows) * Math.PI);
      const y = y0 + (y1 - y0) * t;
      prof.push([y, i === 0 || i === rows ? 0 : torsoRadius(y)]);
    }
    const g = revolve(prof, 28);
    g.scale(1, 1, DIM.torsoZs);
    B.add(g, { bone: 'spine', color: COLORS.fur, world: true, outline: true });

    // cream belly patch (decal on the torso surface)
    const surf = new RevolvedSurface(
      V(0, 0.47, 0),
      V(0, -0.12, 1),
      torsoRadius,
      torsoDRadius,
      DIM.torsoZs,
      0.5,
    );
    const belly = fillDecal(ellipseShape(0, -0.02, 0.62, 0.78, 0, 36), surf, 0.0025, 6);
    B.add(belly, { bone: 'spine', color: COLORS.cream, world: true });
  }

  // ---------------- head ----------------
  {
    B.add(ellipsoid(HR.x, HR.y, HR.z, 36, 26), {
      bone: 'head',
      color: COLORS.fur,
      pos: [C.x, C.y, C.z],
      world: true,
      outline: true,
    });

    // muzzle + cheeks (cream)
    const M = DIM.muzzleC;
    const MR = DIM.muzzleR;
    B.add(ellipsoid(MR.x, MR.y, MR.z, 24, 16), {
      bone: 'head',
      color: COLORS.cream,
      pos: [M.x, M.y, M.z],
      world: true,
      outline: true,
    });
    for (const s of [1, -1]) {
      B.add(ellipsoid(0.105, 0.082, 0.095, 20, 14), {
        bone: 'head',
        color: COLORS.cream,
        pos: [C.x + s * 0.165, C.y - 0.1, C.z + 0.115],
        rot: [0, s * 0.55, s * -0.25],
        world: true,
        outline: true,
      });
    }
    // nose
    const noseC = C.clone().add(V(0, -0.05, 0.282));
    const noseR = V(0.047, 0.033, 0.031);
    B.add(ellipsoid(noseR.x, noseR.y, noseR.z, 16, 12), {
      bone: 'head',
      color: COLORS.nose,
      pos: [noseC.x, noseC.y, noseC.z],
      world: true,
    });
    {
      const ns = new EllipsoidSurface(noseC, noseR, V(0.35, 0.75, 0.55));
      B.add(fillDecal(ellipseShape(0, 0, 0.32, 0.2, 0.3, 14), ns, 0.002, 2), {
        bone: 'head',
        color: 0xf2f2f2,
        world: true,
        target: 'face',
      });
    }

    // tanuki mask patches, eyes, brows
    for (const s of [1, -1]) {
      const maskSurf = new EllipsoidSurface(C, HR, headDir(s * 0.42, -0.035));
      const mask = fillDecal(ellipseShape(0, 0, 0.35, 0.28, -s * 0.42, 36), maskSurf, 0.0025, 6);
      B.add(mask, { bone: 'head', color: COLORS.mask, world: true });

      // eye (white) with a slanted "determined" upper lid line
      const eyeSurf = new EllipsoidSurface(C, HR, headDir(s * 0.36, 0.04));
      const lidA = 0.28 * s; // a*x + b*y + c >= 0  <=>  y <= 0.15 + 0.28 * (s*x)
      const lidB = -1;
      const lidC = 0.15;
      const eyeShape = clipShape(ellipseShape(0, 0, 0.19, 0.25, 0, 36), lidA, lidB, lidC);
      B.add(fillDecal(eyeShape, eyeSurf, 0.006, 5), { bone: 'eyes', color: COLORS.eyeWhite, world: true, target: 'face' });
      const iris = clipShape(ellipseShape(-s * 0.03, -0.005, 0.125, 0.17, 0, 30), lidA, lidB, lidC - 0.004);
      B.add(fillDecal(iris, eyeSurf, 0.0078, 4), { bone: 'eyes', color: COLORS.iris, world: true, target: 'face' });
      const pupil = clipShape(ellipseShape(-s * 0.035, -0.012, 0.085, 0.125, 0, 26), lidA, lidB, lidC - 0.006);
      B.add(fillDecal(pupil, eyeSurf, 0.0092, 3), { bone: 'eyes', color: COLORS.pupil, world: true, target: 'face' });
      B.add(fillDecal(ellipseShape(s * 0.025, 0.055, 0.045, 0.05, 0, 16), eyeSurf, 0.0106, 2), {
        bone: 'eyes',
        color: 0xffffff,
        world: true,
        target: 'face',
      });
      B.add(fillDecal(ellipseShape(-s * 0.075, -0.085, 0.022, 0.022, 0, 12), eyeSurf, 0.0106, 2), {
        bone: 'eyes',
        color: 0xffffff,
        world: true,
        target: 'face',
      });

      // happy closed eyes (^ ^) - hidden unless the pose asks for them
      const arc = [];
      for (let i = 0; i <= 12; i++) {
        const u = i / 12;
        const x = -0.17 + 0.34 * u;
        arc.push([x, -0.02 + 0.13 * Math.sin(u * Math.PI)]);
      }
      B.add(strokeDecal(arc, (u) => 0.07 * (0.55 + 0.45 * Math.sin(u * Math.PI)), eyeSurf, 0.007), {
        bone: 'eyesHappy',
        color: COLORS.cream,
        world: true,
        target: 'face',
      });

    }

    // mouth: philtrum + confident smirk (closed), open smile (hidden by default)
    {
      const ms = new EllipsoidSurface(DIM.muzzleC, DIM.muzzleR, V(0, -0.5, 0.87));
      const smile = [];
      for (let i = 0; i <= 16; i++) {
        const u = i / 16;
        const x = -0.42 + 0.84 * u;
        smile.push([x, 0.55 * x * x - 0.06 + 0.07 * x]);
      }
      B.add(strokeDecal(smile, (u) => 0.055 * (0.55 + 0.45 * Math.sin(u * Math.PI)), ms, 0.002), {
        bone: 'mouth',
        color: COLORS.mouth,
        world: true,
        target: 'face',
      });
      B.add(strokeDecal([[0, 0.5], [0, 0.22], [0, -0.05]], 0.05, ms, 0.002), {
        bone: 'mouth',
        color: COLORS.mouth,
        world: true,
        target: 'face',
      });
      // open mouth: D shape (lower half-ellipse closed by a flat top), CCW
      const dCCW = [];
      for (let i = 0; i <= 20; i++) {
        const t = Math.PI + (i / 20) * Math.PI;
        dCCW.push([Math.cos(t) * 0.36, 0.03 + Math.sin(t) * 0.34]);
      }
      B.add(fillDecal(dCCW, ms, 0.0022, 4), { bone: 'mouthOpen', color: COLORS.mouthIn, world: true, target: 'face' });
      const tongue = clipShape(ellipseShape(0, -0.2, 0.17, 0.1, 0, 20), 0, 1, 0.28);
      B.add(fillDecal(tongue, ms, 0.0032, 3), { bone: 'mouthOpen', color: COLORS.tongue, world: true, target: 'face' });
    }

    // hachimaki band + knot
    const band = headBand(HR.x, HR.y, HR.z, 0.078, -0.16, 0.037, 0.02, 0.003, 72, 14);
    band.translate(C.x, C.y, C.z);
    B.add(band, { bone: 'head', color: COLORS.red, world: true, outline: true });
    const K = DIM.knot;
    B.add(ellipsoid(0.046, 0.04, 0.032, 16, 12), { bone: 'head', color: COLORS.red, pos: [K.x, K.y, K.z], world: true, outline: true });
    for (const s of [1, -1]) {
      B.add(ellipsoid(0.05, 0.028, 0.022, 14, 10), {
        bone: 'head',
        color: COLORS.redDark,
        pos: [K.x + s * 0.046, K.y + 0.012, K.z - 0.004],
        rot: [0, 0, s * 0.55],
        world: true,
        outline: true,
      });
    }

    // ears (dark outer, brown ring, warm inner)
    for (const s of [1, -1]) {
      const bone = s > 0 ? 'earL' : 'earR';
      const ec = V(0, 0.058, 0);
      const er = V(0.088, 0.084, 0.04);
      const rot = [0, s * 0.28, -s * 0.36];
      const outer = smoothSphere(20, 14);
      deform(outer, (v) => {
        const taper = 1 - 0.18 * Math.max(0, v.y);
        v.set(v.x * er.x * taper + ec.x, v.y * er.y + ec.y, v.z * er.z + ec.z);
      });
      B.add(outer, { bone, color: COLORS.mask, rot, order: 'YXZ', outline: true });
      const es = new EllipsoidSurface(ec, er, V(0, 0, 1));
      B.add(fillDecal(ellipseShape(0, -0.12, 0.84, 0.78, 0, 28), es, 0.002, 3), { bone, color: COLORS.fur, rot, order: 'YXZ' });
      B.add(fillDecal(ellipseShape(0, -0.2, 0.6, 0.54, 0, 24), es, 0.0036, 3), { bone, color: COLORS.earInner, rot, order: 'YXZ' });
    }

    // leaf sprout
    {
      const stem = limbCapsule(0.011, 0.05, 8, 3);
      stem.rotateZ(Math.PI); // point up
      const blade = smoothSphere(20, 14);
      const L = 0.16;
      const W = 0.052;
      const T = 0.011;
      deform(blade, (v) => {
        const u = (v.y + 1) * 0.5; // 0 base .. 1 tip
        const x = v.x * W * (1 - 0.55 * u) * (0.55 + 0.45 * Math.sin(Math.min(u * 1.25, 1) * Math.PI * 0.5 + 0.2));
        const y = u * L;
        const z = v.z * T + 1.9 * x * x - 0.05 * u * u;
        v.set(x, y + 0.045, z);
      });
      const tilt = [-0.3, 0, -0.38];
      B.add(stem, { bone: 'leaf', color: COLORS.stem, rot: tilt, order: 'XYZ' });
      // two-tone blade: front lighter, back darker (reads as a leaf from any side)
      const nrm = blade.attributes.normal;
      const colA = col(COLORS.leaf);
      const colB = col(COLORS.leafDark);
      const bladeColor = (i, p, out) => {
        const nz = nrm.getZ(i);
        out.copy(nz >= 0 ? colA : colB);
      };
      B.add(blade, { bone: 'leaf', colorFn: bladeColor, rot: tilt, order: 'XYZ', outline: true });
    }
  }

  // ---------------- arms ----------------
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    B.add(limbCapsule(0.052, 0.13, 12, 5), { bone: 'sh' + S, color: COLORS.fur, outline: true });
    B.add(limbCapsule(0.047, 0.11, 12, 5), { bone: 'el' + S, color: COLORS.limb, outline: true });
    B.add(ellipsoid(0.066, 0.061, 0.06, 16, 12), { bone: 'wr' + S, color: COLORS.limb, pos: [0, -0.038, 0.004], outline: true });
    B.add(ellipsoid(0.024, 0.03, 0.022, 10, 8), {
      bone: 'wr' + S,
      color: COLORS.limb,
      pos: [-s * 0.034, -0.018, 0.042],
      rot: [0.4, 0, s * 0.5],
      outline: true,
    });
  }

  // ---------------- legs + sneakers ----------------
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    B.add(limbCapsule(0.07, 0.115, 14, 5), { bone: 'th' + S, color: COLORS.fur, outline: true });
    B.add(limbCapsule(0.052, 0.11, 12, 5), { bone: 'kn' + S, color: COLORS.limb, outline: true });
    const an = 'an' + S;
    const upC = V(0, -0.044, 0.034);
    const upR = V(0.074, 0.06, 0.118);
    B.add(ellipsoid(upR.x, upR.y, upR.z, 22, 14), { bone: an, color: COLORS.shoe, pos: [upC.x, upC.y, upC.z], outline: true });
    B.add(superEllipsoid(0.082, 0.027, 0.13, 0.5, 26, 12), { bone: an, color: COLORS.sole, pos: [0, -0.08, 0.034], outline: true });
    B.add(ellipsoid(0.046, 0.044, 0.026, 12, 10), { bone: an, color: COLORS.accent, pos: [0, -0.034, -0.078], outline: true });
    B.add(flatTorus(0.057, 0.016, 8, 22), { bone: an, color: COLORS.shoeDark, pos: [0, 0.006, -0.004], outline: true });
    // orange side stripe on the outer side
    const ss = new EllipsoidSurface(upC, upR, V(s, -0.1, 0.1));
    const stripe = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      const x = (-0.55 + 1.1 * u) * s * -1; // back -> front as seen from outside
      stripe.push([x, -0.12 + 0.18 * u]);
    }
    B.add(strokeDecal(stripe, (u) => 0.16 * (0.6 + 0.4 * Math.sin(u * Math.PI)), ss, 0.0025), {
      bone: an,
      color: COLORS.accent,
      world: false,
    });
    // white toe cap
    const ts = new EllipsoidSurface(upC, upR, V(0, 0.15, 1));
    B.add(fillDecal(ellipseShape(0, -0.05, 0.62, 0.42, 0, 24), ts, 0.002, 3), { bone: an, color: COLORS.sole });
  }

  // ---------------- tail (smooth, skinned over 5 bones) ----------------
  {
    const L = DIM.tailLen;
    const Rm = 0.13;
    const prof = [];
    const rows = 56;
    for (let i = 0; i <= rows; i++) {
      const u = i / rows;
      let env;
      if (u < 0.42) env = 0.32 + 0.68 * Math.sin(((u / 0.42) * Math.PI) / 2);
      else env = Math.sqrt(Math.max(0, 1 - ((u - 0.42) / 0.58) ** 2));
      if (u < 0.05) env *= Math.sqrt(u / 0.05);
      const tuft = 1 + 0.045 * Math.sin(u * Math.PI * 9);
      prof.push([u * L, i === 0 || i === rows ? 0 : Rm * env * tuft]);
    }
    const g = revolve(prof, 18);
    // orient +Y along the tail direction, then move to the tail root
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), DIM.tailDir);
    g.applyQuaternion(q);
    const root = bonePos.t0;
    g.translate(root.x, root.y, root.z);
    const fur = col(COLORS.fur);
    const dark = col(COLORS.mask);
    const tmp = V();
    const seg = DIM.tailSeg;
    const names = ['t0', 't1', 't2', 't3', 't4'];
    B.addCustom(g, {
      outline: true,
      colorFn: (i, p, out) => {
        const s = tmp.copy(p).sub(root).dot(DIM.tailDir);
        const u = s / L;
        const isDark = (u > 0.45 && u < 0.55) || (u > 0.665 && u < 0.76) || u > 0.87;
        out.copy(isDark ? dark : fur);
      },
      weightFn: (i, p, idx, w) => {
        const s = tmp.copy(p).sub(root).dot(DIM.tailDir);
        const f = (s - seg * 0.5) / seg;
        const k = Math.floor(f);
        if (k < 0) {
          idx[0] = boneIndex[names[0]];
          w[0] = 1;
        } else if (k >= names.length - 1) {
          idx[0] = boneIndex[names[names.length - 1]];
          w[0] = 1;
        } else {
          const t = f - k;
          const sm = t * t * (3 - 2 * t);
          idx[0] = boneIndex[names[k]];
          w[0] = 1 - sm;
          idx[1] = boneIndex[names[k + 1]];
          w[1] = sm;
        }
      },
    });
  }

  return B.build();
}
