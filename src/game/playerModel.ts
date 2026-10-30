import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Player model: Mixamo "Vanguard" soldier (Soldier.glb from the three.js examples, 49-bone humanoid rig,
 * clips Idle / Walk / Run). The glb has no jump clips, so airborne states reuse single frames of the Run
 * cycle (take-off stride, mid-air stride) held while airborne, and landing adds a short squash.
 * Locomotion clips are time-scaled to the real ground speed to limit foot sliding.
 */

export type LocoState = 'idle' | 'walk' | 'run' | 'rise' | 'fall';

export interface PlayerModel {
  root: THREE.Group;
  update: (dt: number, s: { grounded: boolean; speed: number; sprinting: boolean; vy: number }) => void;
  dispose: () => void;
}

const HEIGHT = 1.8;
// ground speed (m/s) at which each clip's feet are planted at timeScale 1 (estimated from stride length)
const WALK_REF = 1.9;
const RUN_REF = 4.2;

export async function loadPlayerModel(isSoftwareGl: boolean): Promise<PlayerModel> {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/Soldier.glb`);
  const model = gltf.scene;

  const find = (n: string) => gltf.animations.find((a) => a.name.toLowerCase() === n);
  const idleClip = find('idle');
  const walkClip = find('walk');
  const runClip = find('run');
  if (!idleClip || !walkClip || !runClip) throw new Error('Soldier.glb is missing Idle/Walk/Run clips');

  // Normalise size & pivot: feet on y=0, 1.8 m tall
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const k = HEIGHT / (box.max.y - box.min.y);
  const root = new THREE.Group();
  root.name = 'playerModel';
  const holder = new THREE.Group();
  holder.add(model);
  holder.scale.setScalar(k);
  holder.position.y = -box.min.y * k;
  root.add(holder);

  const ownedMaterials = new Set<THREE.Material>();
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    m.castShadow = !isSoftwareGl;
    m.receiveShadow = true;
    m.frustumCulled = false; // skinned bounds are not tracking the animated pose
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach((mt) => {
      ownedMaterials.add(mt);
      const std = mt as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) {
        std.envMapIntensity = 0.6;
        std.metalness = Math.min(std.metalness, 0.35);
        if (std.map) std.map.anisotropy = 8;
      }
    });
  });

  const mixer = new THREE.AnimationMixer(model);
  const idle = mixer.clipAction(idleClip);
  const walk = mixer.clipAction(walkClip);
  const run = mixer.clipAction(runClip);
  // Independent actions on cloned Run clips, frozen on a single pose each
  const rise = mixer.clipAction(runClip.clone());
  const fall = mixer.clipAction(runClip.clone());
  const actions: Record<LocoState, THREE.AnimationAction> = { idle, walk, run, rise, fall };
  const poseTime: Partial<Record<LocoState, number>> = { rise: runClip.duration * 0.12, fall: runClip.duration * 0.62 };

  let state: LocoState = 'idle';
  let current = idle;
  idle.play();
  let wasGrounded = true;
  let landSquash = 0;
  let airTime = 0;

  function switchTo(next: LocoState, fade: number) {
    if (next === state) return;
    const prev = current;
    const a = actions[next];
    const fixedT = poseTime[next];
    a.reset();
    if (fixedT !== undefined) {
      a.time = fixedT;
      a.timeScale = 0;
    } else if ((state === 'walk' || state === 'run') && (next === 'walk' || next === 'run')) {
      // keep the stride phase when changing gait to avoid a foot pop
      a.time = (prev.time / prev.getClip().duration) * a.getClip().duration;
    }
    a.setEffectiveWeight(1).play();
    a.crossFadeFrom(prev, fade, false);
    current = a;
    state = next;
  }

  return {
    root,
    update: (dt, s) => {
      // --- state selection ---
      let next: LocoState;
      if (!s.grounded) {
        airTime += dt;
        next = s.vy > 1.5 ? 'rise' : 'fall';
      } else {
        airTime = 0;
        next = s.speed < 0.35 ? 'idle' : s.speed > 3.4 || s.sprinting ? 'run' : 'walk';
      }
      const fade = !s.grounded ? 0.1 : wasGrounded ? 0.22 : 0.14;
      switchTo(next, fade);

      // --- landing squash ---
      if (s.grounded && !wasGrounded) landSquash = THREE.MathUtils.clamp(-s.vy / 14, 0.35, 1);
      wasGrounded = s.grounded;
      landSquash = THREE.MathUtils.damp(landSquash, 0, 9, dt);
      const sy = 1 - 0.07 * landSquash;
      root.scale.set(1 + 0.03 * landSquash, sy, 1 + 0.03 * landSquash);

      // --- stride speed matching ---
      if (state === 'walk') walk.timeScale = THREE.MathUtils.clamp(s.speed / WALK_REF, 0.7, 2.2);
      else if (state === 'run') run.timeScale = THREE.MathUtils.clamp(s.speed / RUN_REF, 0.8, 2.4);
      else if (state === 'idle') idle.timeScale = 1;

      mixer.update(dt);
    },
    dispose: () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
      model.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      ownedMaterials.forEach((m) => {
        const std = m as THREE.MeshStandardMaterial;
        std.map?.dispose();
        std.normalMap?.dispose();
        std.roughnessMap?.dispose();
        std.metalnessMap?.dispose();
        std.aoMap?.dispose();
        std.emissiveMap?.dispose();
        m.dispose();
      });
      root.removeFromParent();
    },
  };
}
