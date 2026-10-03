import * as THREE from "three";
import type { AvatarState } from "./types";

// Procedural posture for a T-pose humanoid rig (Avaturn / Mixamo bone
// names): relaxed arms, breathing, and a head that listens and follows the
// visitor's pointer. Arm poses are world-space directions, so they work
// regardless of how an exporter oriented its bone axes.

class Rig {
  private restLocal = new Map<THREE.Object3D, THREE.Quaternion>();
  private restWorld = new Map<THREE.Object3D, THREE.Quaternion>();
  private restDir = new Map<THREE.Object3D, THREE.Vector3>();
  private bones = new Map<string, THREE.Object3D>();
  private tq = new THREE.Quaternion();
  private tq2 = new THREE.Quaternion();
  private tv = new THREE.Vector3();

  constructor(model: THREE.Object3D) {
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      this.bones.set(o.name, o);
      this.restLocal.set(o, o.quaternion.clone());
      this.restWorld.set(o, o.getWorldQuaternion(new THREE.Quaternion()));
      const child = o.children.find((c) => (c as THREE.Bone).isBone);
      if (child) {
        const a = o.getWorldPosition(new THREE.Vector3());
        const b = child.getWorldPosition(new THREE.Vector3());
        this.restDir.set(o, b.sub(a).normalize());
      }
    });
  }

  get(name: string) {
    return this.bones.get(name);
  }

  reset() {
    for (const [b, q] of this.restLocal) b.quaternion.copy(q);
  }

  /** Rotate a bone by a world-axis rotation, expressed as if its parent were still at rest. */
  rotate(name: string, x: number, y: number, z: number) {
    const b = this.bones.get(name);
    const w = b && this.restWorld.get(b);
    if (!b || !w) return;
    const r = this.tq.setFromEuler(new THREE.Euler(x, y, z, "XYZ"));
    // local ← local · W⁻¹ · R · W
    b.quaternion.multiply(this.tq2.copy(w).invert().multiply(r).multiply(w));
  }

  /** Point a bone (toward its child) along a world direction, then roll it by `twist`. */
  aim(name: string, dir: THREE.Vector3, twist = 0) {
    const b = this.bones.get(name);
    const restDir = b && this.restDir.get(b);
    if (!b?.parent || !restDir) return;
    const parentNow = b.parent.getWorldQuaternion(new THREE.Quaternion());
    const parentRest = this.restWorld.get(b.parent) ?? new THREE.Quaternion();
    const carry = parentNow.clone().multiply(parentRest.clone().invert()); // how far the parent has moved
    const world = carry.clone().multiply(this.restWorld.get(b)!);
    const current = this.tv.copy(restDir).applyQuaternion(carry);
    const swing = new THREE.Quaternion().setFromUnitVectors(current, dir);
    if (twist) swing.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, twist));
    world.premultiply(swing);
    b.quaternion.copy(parentNow.invert().multiply(world));
    b.updateMatrixWorld(true);
  }
}

// Arms hang relaxed at the sides (left arm; mirrored for the right).
const ARM = new THREE.Vector3(0.14, -0.98, 0.06).normalize();
const FORE = new THREE.Vector3(0.06, -0.97, 0.22).normalize();
const HAND = new THREE.Vector3(0.02, -0.98, 0.18).normalize();
const mirror = (d: THREE.Vector3) => new THREE.Vector3(-d.x, d.y, d.z);

/** Relaxed bust: breathing, listening lean, head follows the visitor, nods with speech. */
export class Body {
  private rig: Rig;
  private lean = 0;

  constructor(model: THREE.Object3D) {
    this.rig = new Rig(model);
  }

  get head() {
    return this.rig.get("Head") ?? null;
  }

  update(t: number, dt: number, state: AvatarState, level: number, look: { x: number; y: number }) {
    const rig = this.rig;
    rig.reset();

    const targetLean = state === "listening" ? 0.06 : state === "speaking" ? 0.03 : 0.01;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 3);
    rig.rotate("Spine", this.lean, Math.sin(t * 0.35) * 0.015, 0);
    rig.rotate("Spine2", Math.sin(t * 1.6) * 0.012, 0, 0); // breathing

    const nod = state === "speaking" ? level * 0.06 : 0;
    rig.rotate("Neck", look.y * 0.06, look.x * 0.12, 0);
    rig.rotate(
      "Head",
      look.y * 0.08 + Math.sin(t * 0.7) * 0.02 + nod - this.lean * 0.6,
      look.x * 0.16 + Math.sin(t * 0.45) * 0.03,
      (state === "listening" ? 0.06 : 0) + Math.sin(t * 0.5) * 0.015,
    );

    // Arms at rest, with a breath of movement so they don't look frozen.
    const sway = Math.sin(t * 1.6) * 0.01;
    for (const [side, m] of [["Left", false], ["Right", true]] as const) {
      const f = (d: THREE.Vector3) => (m ? mirror(d) : d.clone());
      rig.aim(`${side}Arm`, f(ARM).setZ(ARM.z + sway).normalize());
      rig.aim(`${side}ForeArm`, f(FORE));
      rig.aim(`${side}Hand`, f(HAND));
      for (const finger of ["Index", "Middle", "Ring", "Pinky"]) {
        for (let i = 1; i <= 3; i++) rig.rotate(`${side}Hand${finger}${i}`, 0, 0, (m ? 1 : -1) * 0.25);
      }
    }
  }
}
