import * as THREE from 'three';
import { AssetLibrary, fetchSource, decodeTargets } from './core/assets';
import { decodePack } from './core/pack';
import { buildHuman, type Character } from './core/human';
import { DEFAULT_PARAMS, PRESETS, type HumanParams } from './core/params';
import { Animator, type Frame } from './core/anim/evaluate';
import { clipById, type Clip } from './core/anim/clips';
import { localTransform, quatOf } from './core/rig/rig';

export const ARA_ASSETS_BASE_URL = '/ara-assets/';

export interface AraLoadingProgress {
  stage: string;
  percent: number;
}

export interface AraCharacterInstance {
  group: THREE.Group;
  mesh: THREE.Mesh | THREE.SkinnedMesh;
  bones: THREE.Bone[];
  animator: Animator | null;
  character: Character;
  updateAnimation: (state: 'idle' | 'walk' | 'run' | 'jump', delta: number) => void;
  playCustomClip: (clipId: string, time: number) => void;
  dispose: () => void;
}

let libraryInstance: AssetLibrary | null = null;
let libraryInitPromise: Promise<AssetLibrary> | null = null;

export async function initAraLibrary(
  onProgress?: (progress: AraLoadingProgress) => void
): Promise<AssetLibrary> {
  if (libraryInstance) {
    onProgress?.({ stage: 'Pronto para personalização', percent: 100 });
    return libraryInstance;
  }

  if (libraryInitPromise) {
    return libraryInitPromise;
  }

  libraryInitPromise = (async () => {
    onProgress?.({ stage: 'Carregando catálogo de ativos Ara 3D (catalog.json)...', percent: 15 });

    const source = fetchSource(ARA_ASSETS_BASE_URL);
    const lib = new AssetLibrary(source);

    // 1. Fetch catalog
    onProgress?.({ stage: 'Carregando definições e catálogo de personagens...', percent: 30 });
    await lib.initCatalog();

    // 2. Fetch base mesh pack
    onProgress?.({ stage: 'Carregando malha base de personagem (base.pack)...', percent: 55 });
    const baseBuffer = await source.read('base.pack');
    lib.base = decodePack(baseBuffer);

    // 3. Fetch targets pack for morphology and detail sliders
    onProgress?.({ stage: 'Processando alvos morfométricos (targets.pack)...', percent: 80 });
    const targetsBuffer = await source.read('targets.pack');
    lib.targets = decodeTargets(decodePack(targetsBuffer));

    onProgress?.({ stage: 'Inicializando biblioteca de tecidos procedurais...', percent: 95 });
    libraryInstance = lib;

    onProgress?.({ stage: 'Pronto para personalização', percent: 100 });
    return lib;
  })().catch((err) => {
    libraryInitPromise = null;
    throw err;
  });

  return libraryInitPromise;
}

export function getAraPresets(): Record<string, Partial<HumanParams>> {
  return PRESETS;
}

export async function buildAraCharacter(
  params: Partial<HumanParams>,
  lib?: AssetLibrary
): Promise<Character> {
  const library = lib || libraryInstance || (await initAraLibrary());
  if (!library) {
    throw new Error('Ara AssetLibrary not initialized. Call initAraLibrary first.');
  }

  const fullParams: HumanParams = {
    ...DEFAULT_PARAMS,
    ...params,
    detail: 'low', // optimized for 60fps real-time gameplay in open world
    rig: 'game',
  };

  return buildHuman(library, fullParams);
}

/**
 * Converts an Ara 3D Gen Character into a fully rigged Three.js SkinnedMesh
 * with materials, procedural fabric patterns, normal maps, and an Animator.
 */
export function createThreeCharacter(
  ch: Character,
  lib: AssetLibrary
): AraCharacterInstance {
  const group = new THREE.Group();
  group.name = `ara_character_${ch.params.name || 'player'}`;

  const { mesh: m } = ch;
  const texCache = new Map<string, THREE.Texture>();

  const getTexture = (file: string, color: boolean) => {
    const key = file + color;
    let t = texCache.get(key);
    if (!t) {
      const url = lib.textureUrl(file);
      t = new THREE.TextureLoader().load(url);
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 8;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      texCache.set(key, t);
    }
    return t;
  };

  // 1. Build BufferGeometry
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(m.uvs, 2));

  // Multi-material groups
  const totalIndices = m.groups.reduce((acc, g) => acc + g.indices.length, 0);
  const indexBuffer = new Uint32Array(totalIndices);
  let offset = 0;
  for (const g of m.groups) {
    indexBuffer.set(g.indices, offset);
    geo.addGroup(offset, g.indices.length, g.material);
    offset += g.indices.length;
  }
  geo.setIndex(new THREE.BufferAttribute(indexBuffer, 1));

  // 2. Build Materials (PBR MeshStandardMaterial)
  const materials = m.materials.map((mt) => {
    const mat = new THREE.MeshStandardMaterial({
      name: mt.name,
      color: new THREE.Color(mt.color),
      roughness: mt.roughnessMap ? 1 : mt.roughness,
      metalness: mt.metalness,
      map: mt.map ? getTexture(mt.map, true) : null,
      normalMap: mt.normalMap ? getTexture(mt.normalMap, false) : null,
      roughnessMap: mt.roughnessMap ? getTexture(mt.roughnessMap, false) : null,
      side: mt.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
      emissive: mt.emissive ? new THREE.Color(mt.emissive) : new THREE.Color(0),
      emissiveIntensity: mt.emissive ? 1.6 : 0,
    });

    if (mt.doubleSided) mat.shadowSide = THREE.FrontSide;
    if (mt.alpha === 'mask') {
      mat.alphaTest = 0.5;
    } else if (mt.alpha === 'blend') {
      mat.transparent = true;
      mat.opacity = mt.opacity ?? 1;
      mat.depthWrite = false;
      if (mt.map) mat.alphaTest = 0.01;
    }
    return mat;
  });

  // 3. Setup Skeleton & SkinnedMesh
  let bones: THREE.Bone[] = [];
  let mainMesh: THREE.Mesh | THREE.SkinnedMesh;

  if (ch.rig && m.joints && m.weights) {
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(m.joints, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(m.weights, 4));

    const skMesh = new THREE.SkinnedMesh(geo, materials);
    bones = ch.rig.bones.map((b, i) => {
      const bone = new THREE.Bone();
      bone.name = b.name;
      const { t, R } = localTransform(ch.rig!.bones, i);
      bone.position.set(t[0], t[1], t[2]);
      const [qx, qy, qz, qw] = quatOf(R);
      bone.quaternion.set(qx, qy, qz, qw);
      return bone;
    });

    ch.rig.bones.forEach((b, i) => {
      if (b.parent >= 0) {
        bones[b.parent].add(bones[i]);
      } else {
        skMesh.add(bones[i]);
      }
    });

    skMesh.updateMatrixWorld(true);
    skMesh.bind(new THREE.Skeleton(bones));
    mainMesh = skMesh;
  } else {
    mainMesh = new THREE.Mesh(geo, materials);
  }

  mainMesh.castShadow = true;
  mainMesh.receiveShadow = true;
  group.add(mainMesh);

  // 4. Animator & Animation Clips setup
  const animator = ch.rig && bones.length ? new Animator(ch.rig, ch.face) : null;

  const idleClip = clipById.get('idle');
  const walkClip = clipById.get('walk');
  const runClip = clipById.get('run');
  const jumpClip = clipById.get('jump');

  let activeClip: Clip | null = idleClip || null;
  let animTime = 0;
  let previousFrame: Frame | null = null;
  let blendFactor = 1;

  return {
    group,
    mesh: mainMesh,
    bones,
    animator,
    character: ch,

    updateAnimation: (state: 'idle' | 'walk' | 'run' | 'jump', delta: number) => {
      if (!animator || bones.length === 0) return;

      let targetClip = idleClip;
      if (state === 'run') targetClip = runClip || walkClip;
      else if (state === 'walk') targetClip = walkClip;
      else if (state === 'jump') targetClip = jumpClip;

      if (targetClip && targetClip !== activeClip) {
        activeClip = targetClip;
        blendFactor = 0;
      }

      const speedMultiplier = state === 'run' ? 1.25 : 1.0;
      animTime += delta * speedMultiplier;

      if (activeClip) {
        const loopTime = activeClip.loop ? animTime % activeClip.duration : Math.min(animTime, activeClip.duration);
        const currentFrame = animator.frame(activeClip, loopTime, { rootMotion: false, faceTime: animTime });

        if (blendFactor < 1 && previousFrame) {
          blendFactor = Math.min(1, blendFactor + delta * 6);
          const qa = new THREE.Quaternion();
          const qb = new THREE.Quaternion();

          currentFrame.rot.forEach((q, i) => {
            if (previousFrame && previousFrame.rot[i]) {
              qa.set(previousFrame.rot[i][0], previousFrame.rot[i][1], previousFrame.rot[i][2], previousFrame.rot[i][3]);
              qb.set(q[0], q[1], q[2], q[3]);
              qa.slerp(qb, blendFactor);
              bones[i].quaternion.copy(qa);
            } else {
              bones[i].quaternion.set(q[0], q[1], q[2], q[3]);
            }
          });
        } else {
          currentFrame.rot.forEach((q, i) => {
            bones[i].quaternion.set(q[0], q[1], q[2], q[3]);
          });
        }

        previousFrame = currentFrame;

        // Apply facial expression morph targets if present
        if (mainMesh.morphTargetInfluences && currentFrame.morph) {
          currentFrame.morph.forEach((val, i) => {
            if (mainMesh.morphTargetInfluences) mainMesh.morphTargetInfluences[i] = val;
          });
        }
      }
    },

    playCustomClip: (clipId: string, time: number) => {
      if (!animator || bones.length === 0) return;
      const clip = clipById.get(clipId);
      if (!clip) return;
      const t = clip.loop ? time % clip.duration : Math.min(time, clip.duration);
      const frame = animator.frame(clip, t, { rootMotion: false, faceTime: time });
      frame.rot.forEach((q, i) => {
        bones[i].quaternion.set(q[0], q[1], q[2], q[3]);
      });
    },

    dispose: () => {
      geo.dispose();
      materials.forEach((m) => m.dispose());
      texCache.forEach((t) => t.dispose());
      group.clear();
    },
  };
}
