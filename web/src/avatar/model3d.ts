import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { Body } from "./body";
import type { AudioTap, Avatar, AvatarState } from "./types";

// 3D talking bust: lip sync from facial morph targets (ARKit blendshapes
// and/or Oculus visemes, as Avaturn and most avatar exporters provide) plus
// procedural posture from the skeleton. Loaded lazily so photo mode stays light.

type Morph = { mesh: THREE.Mesh; index: number };

function collectMorphs(scene: THREE.Object3D) {
  const map = new Map<string, Morph[]>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.morphTargetDictionary) return;
    for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
      const list = map.get(name) ?? [];
      list.push({ mesh, index });
      map.set(name, list);
    }
  });
  return map;
}

export async function createModelAvatar(root: HTMLElement, url: string, audio: AudioTap): Promise<Avatar> {
  const canvas = document.createElement("canvas");
  canvas.className = "three";
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 1, 0.05, 50);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1f2b, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.2, 1.8, 2.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xfff4e8, 1.1); // soft front fill so the face isn't in shadow
  fill.position.set(-0.6, 0.4, 3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x38bdf8, 1.6);
  rim.position.set(-2, 1.5, -1.5);
  scene.add(rim);

  // Meshopt-compressed models (see `gltf-transform optimize --compress meshopt`) load ~6x smaller.
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  const model = gltf.scene;
  scene.add(model);
  const morphs = collectMorphs(model);

  // Dev-only: ?mouth=0.5&state=speaking freezes the avatar for tuning.
  const params = import.meta.env.DEV ? new URLSearchParams(location.search) : new URLSearchParams();
  const debugMouth = Number(params.get("mouth")) || 0;
  const debugState = params.get("state") as AvatarState | null;

  const body = new Body(model);
  body.update(0, 1, "idle", 0, { x: 0, y: 0 });
  model.updateMatrixWorld(true);

  // Frame head and shoulders.
  const head = body.head;
  const headPos = head ? head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1.65, 0);
  const target = new THREE.Vector3(0, headPos.y - 0.1, 0);
  camera.position.set(0, headPos.y - 0.02, 1.75);
  camera.lookAt(target);

  root.appendChild(canvas);
  root.classList.add("is-3d");

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const set = (name: string, value: number) => {
    for (const m of morphs.get(name) ?? []) m.mesh.morphTargetInfluences![m.index] = value;
  };
  const has = (name: string) => morphs.has(name);

  const pointer = { x: 0, y: 0 };
  const onPointer = (e: PointerEvent) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  let state: AvatarState = debugState ?? "idle";
  let mouth = 0;
  let nextBlink = performance.now() + 2000;
  let blinkStart = -1;
  const smoothLook = { x: 0, y: 0 };
  let last = performance.now();
  let raf = 0;

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = now / 1000;
    // rAF timestamps can predate `last` on the first frame; never step backwards.
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;

    // Lip sync: loudness drives the jaw; spectrum shape picks a vowel.
    const level = debugMouth || audio.level();
    mouth += (level - mouth) * 0.5;
    const freq = audio.frequencies();
    let lo = 0, hi = 0;
    for (let i = 2; i < 12; i++) lo += freq[i] ?? 0;
    for (let i = 12; i < 40; i++) hi += freq[i] ?? 0;
    const bright = lo + hi > 0 ? hi / (lo + hi) : 0.4;
    const open = Math.min(1, mouth * 1.4);

    let jaw = 0;
    if (has("viseme_aa")) {
      // Proper viseme rig: the vowel shapes carry the mouth; the jaw only adds a little drop.
      set("viseme_aa", open * (1 - bright) * 0.55);
      set("viseme_E", open * bright * 0.45);
      set("viseme_O", open * Math.max(0, 0.5 - bright) * 0.6);
      jaw = open * 0.12;
    } else {
      // ARKit-only rig: approximate with jaw + funnel.
      jaw = open * 0.45;
      if (has("mouthOpen")) set("mouthOpen", open * 0.4);
      if (has("mouthFunnel")) set("mouthFunnel", open * Math.max(0, 0.45 - bright) * 0.6);
    }
    if (has("jawOpen")) set("jawOpen", jaw);

    // Blinks every few seconds.
    if (now > nextBlink && blinkStart < 0) blinkStart = now;
    if (blinkStart >= 0) {
      const p = (now - blinkStart) / 160;
      const v = p < 1 ? Math.sin(p * Math.PI) : 0;
      // Prefer per-eye ARKit blinks; eyesClosed on top of them would over-close the lids.
      if (has("eyeBlinkLeft")) { set("eyeBlinkLeft", v); set("eyeBlinkRight", v); }
      else set("eyesClosed", v);
      if (p >= 1) { blinkStart = -1; nextBlink = now + 2500 + Math.random() * 3500; }
    }

    // Posture, head and hands.
    smoothLook.x += (pointer.x - smoothLook.x) * Math.min(1, dt * 4);
    smoothLook.y += (pointer.y - smoothLook.y) * Math.min(1, dt * 4);
    body.update(t, dt, state, mouth, smoothLook);

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);

  return {
    setState(s) {
      state = debugState ?? s;
      root.dataset.state = s;
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("pointermove", onPointer);
      renderer.dispose();
      canvas.remove();
      root.classList.remove("is-3d");
    },
  };
}
