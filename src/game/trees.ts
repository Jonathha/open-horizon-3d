import * as THREE from 'three';
import { CHUNK_SIZE, TREE_VARIANTS, chunkCoord, chunkKey, getWorld, type TreeSpecies, type TreeSpec } from './world';
import { StreamedInstances } from './streaming';
import { mulberry32 } from './rng';

/**
 * Trees are generated procedurally with ez-tree (MIT, github.com/dgreenheck/ez-tree): real branch
 * geometry along recursive levels, PBR bark (colour/normal/roughness/AO) and alpha-tested leaf cards.
 * A handful of seeded variants per species are generated once, then instanced. Two LODs per variant
 * (detailed up close, reduced branch/leaf budget far away); only regions near the player are drawn.
 */

export interface TreeSystem {
  update: (playerPos: THREE.Vector3) => void;
  dispose: () => void;
}

const PRESETS: Record<TreeSpecies, string> = {
  oak: 'Oak Medium',
  pine: 'Pine Medium',
  aspen: 'Aspen Medium',
  ash: 'Ash Medium',
  bush: 'Bush 1',
};
const LOD0_RANGE = 52;

interface Variant {
  hi: StreamedInstances;
}

export async function setupTrees(scene: THREE.Scene, isSoftwareGl: boolean): Promise<TreeSystem> {
  const { Tree, TreePreset } = await import('@dgreenheck/ez-tree');
  const world = getWorld();
  const group = new THREE.Group();
  group.name = 'Trees';
  scene.add(group);

  const disposables: { dispose: () => void }[] = [];
  const variants = new Map<string, Variant>();

  // Count instances per (species, variant) to size each pool exactly
  const counts = new Map<string, number>();
  for (const t of world.trees) {
    const k = `${t.species}:${t.variant}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const rnd = mulberry32(4242);
  const leafTints = [0xffffff, 0xe9f5d4, 0xd8ecb8, 0xf4f0c8];

  function build(species: TreeSpecies, variant: number, lod: 0 | 1): StreamedInstances {
    const opts = structuredClone((TreePreset as Record<string, any>)[PRESETS[species]]);
    opts.seed = 1000 + variant * 7919 + (species.charCodeAt(0) << 4);
    if (lod === 1) {
      opts.branch.levels = Math.min(opts.branch.levels, 2);
      for (const key of ['sections', 'segments'] as const) {
        const v = opts.branch[key];
        for (const lv of Object.keys(v)) v[lv] = Math.max(key === 'sections' ? 3 : 3, Math.round(v[lv] * 0.5));
      }
      opts.leaves.count = Math.max(40, Math.round(opts.leaves.count * 0.45));
      opts.leaves.size *= 1.45;
    } else if (isSoftwareGl) {
      opts.leaves.count = Math.round(opts.leaves.count * 0.6);
    }
    opts.leaves.tint = leafTints[Math.floor(rnd() * leafTints.length)];
    const tree = new Tree();
    tree.loadFromJson(opts);
    tree.generate();

    const parts = [
      { geometry: tree.branchesMesh.geometry, material: tree.branchesMesh.material as THREE.Material, castShadow: lod === 0 && !isSoftwareGl, receiveShadow: true },
      { geometry: tree.leavesMesh.geometry, material: tree.leavesMesh.material as THREE.Material, castShadow: lod === 0 && !isSoftwareGl, receiveShadow: true },
    ];
    disposables.push(tree.branchesMesh.geometry, tree.leavesMesh.geometry, parts[0].material, parts[1].material);
    const cap = counts.get(`${species}:${variant}`) ?? 0;
    const pool = new StreamedInstances(parts, Math.max(cap, 1));
    group.add(pool.group);
    return pool;
  }

  for (const species of Object.keys(TREE_VARIANTS) as TreeSpecies[]) {
    for (let v = 0; v < TREE_VARIANTS[species]; v++) {
      if (!counts.get(`${species}:${v}`)) continue;
      variants.set(`${species}:${v}`, { hi: build(species, v, 0) });
    }
  }

  const dummy = new THREE.Object3D();
  let lx = Infinity;
  let lz = Infinity;

  function rebuild(px: number, pz: number) {
    const reach = LOD0_RANGE + CHUNK_SIZE;
    const lists = new Map<StreamedInstances, number>();
    variants.forEach((v) => {
      lists.set(v.hi, 0);
    });
    for (let cx = chunkCoord(px - reach); cx <= chunkCoord(px + reach); cx++) {
      for (let cz = chunkCoord(pz - reach); cz <= chunkCoord(pz + reach); cz++) {
        const arr: TreeSpec[] | undefined = world.treesByChunk.get(chunkKey(cx, cz));
        if (!arr) continue;
        for (const t of arr) {
          const d = Math.hypot(t.x - px, t.z - pz);
          if (d > LOD0_RANGE) continue; // only detailed trees near the player
          const v = variants.get(`${t.species}:${t.variant}`);
          if (!v) continue;
          const pool = v.hi;
          const n = lists.get(pool)!;
          if (n >= pool.capacity) continue;
          dummy.position.set(t.x, t.y - 0.05, t.z);
          dummy.rotation.set(0, t.rotY, 0);
          dummy.scale.setScalar(t.scale);
          dummy.updateMatrix();
          dummy.matrix.toArray(pool.matrices, n * 16);
          lists.set(pool, n + 1);
        }
      }
    }
    lists.forEach((n, pool) => pool.commit(n));
  }

  return {
    update: (p) => {
      if (Math.hypot(p.x - lx, p.z - lz) > 3) {
        lx = p.x;
        lz = p.z;
        rebuild(p.x, p.z);
      }
    },
    dispose: () => {
      variants.forEach((v) => {
        v.hi.dispose();
      });
      scene.remove(group);
      new Set(disposables).forEach((d) => d.dispose());
    },
  };
}
