import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHUNK_SIZE, CLEARING_RADIUS, chunkCoord, chunkRng, forestDensity, getWorld, isBlocked, patchMask, pathDistance } from './world';
import { smoothstep } from './rng';
import { getTerrainHeight, getTerrainNormal } from './terrain';
import { ChunkCache, StreamedInstances } from './streaming';

/**
 * GLB props: rocks (3 PBR-textured meshes, placed in the world's rock groups) and wildflowers
 * (3 colours, scattered in meadow clusters and around the start meadow). Assets: MIT, from
 * dgreenheck/ez-tree (see public/ASSETS-LICENSES.md).
 */

export interface PropsController {
  update: (playerPos: THREE.Vector3) => void;
  dispose: () => void;
}

interface Baked {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const loader = new GLTFLoader();
const base = import.meta.env.BASE_URL;

/** Loads a GLB and bakes each mesh's node transform into its geometry (so parts can be instanced together). */
async function loadBaked(url: string, fitHeight?: number): Promise<Baked[]> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new THREE.Vector3());
  const k = fitHeight ? fitHeight / size.y : 1;
  const out: Baked[] = [];
  const fix = new THREE.Matrix4()
    .makeScale(k, k, k)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, fitHeight ? -box.min.y : 0, -(box.min.z + box.max.z) / 2));
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().copy(fix).multiply(m.matrixWorld));
    g.computeBoundingSphere();
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
    mat.side = THREE.DoubleSide;
    out.push({ geometry: g, material: mat });
  });
  if (!out.length) throw new Error(`No meshes in ${url}`);
  return out;
}

const FLOWERS = ['flower_white', 'flower_yellow', 'flower_blue'];
const FLOWER_RANGE = 46;

export async function setupProps(scene: THREE.Scene, isSoftwareGl: boolean): Promise<PropsController> {
  const group = new THREE.Group();
  group.name = 'Props';
  scene.add(group);
  const disposables: { dispose: () => void }[] = [];
  const pools: StreamedInstances[] = [];

  // ---------------- Rocks ----------------
  const world = getWorld();
  const rockParts: (Baked[] | null)[] = await Promise.all(
    [1, 2, 3].map((i) =>
      loadBaked(`${base}models/rock${i}.glb`).catch((e) => {
        console.warn(`[props] rock${i}.glb failed, using fallback geometry`, e);
        return null;
      })
    )
  );
  const dummy = new THREE.Object3D();
  rockParts.forEach((parts, type) => {
    const specs = world.rocks.filter((r) => r.type === type);
    if (!specs.length) return;
    const fallbackGeo = new THREE.DodecahedronGeometry(1, 1);
    const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x777c80, roughness: 0.9, flatShading: true });
    const list: Baked[] = parts ?? [{ geometry: fallbackGeo, material: fallbackMat }];
    if (!parts) disposables.push(fallbackGeo, fallbackMat);
    const pool = new StreamedInstances(
      list.map((p) => ({ geometry: p.geometry, material: p.material, castShadow: !isSoftwareGl, receiveShadow: true })),
      specs.length
    );
    specs.forEach((r, i) => {
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(r.tiltX, r.rotY, r.tiltZ);
      dummy.scale.setScalar(r.scale);
      dummy.updateMatrix();
      dummy.matrix.toArray(pool.matrices, i * 16);
    });
    pool.commit(specs.length);
    group.add(pool.group);
    pools.push(pool);
    if (parts) parts.forEach((p) => disposables.push(p.geometry));
  });

  // ---------------- Flowers (streamed per chunk) ----------------
  const flowerParts = await Promise.all(
    FLOWERS.map((n) =>
      loadBaked(`${base}models/${n}.glb`, 0.36).catch((e) => {
        console.warn(`[props] ${n}.glb failed, flowers of this colour skipped`, e);
        return null;
      })
    )
  );
  interface FlowerChunk { m: Float32Array[]; n: number[]; xz: Float32Array[] }
  const flowerCache = new ChunkCache<FlowerChunk>((cx, cz) => {
    const rnd = chunkRng(cx, cz, 23);
    const res: FlowerChunk = { m: [], n: [], xz: [] };
    const lists: number[][] = [[], [], []];
    const up = new THREE.Vector3(0, 1, 0);
    for (let c = 0; c < 10; c++) {
      const ccx = (cx + rnd()) * CHUNK_SIZE;
      const ccz = (cz + rnd()) * CHUNK_SIZE;
      const r = Math.hypot(ccx, ccz);
      const f = forestDensity(ccx, ccz);
      const meadow = smoothstep(0.52, 0.7, patchMask(ccx, ccz, 7, 0.04)) * (1 - f);
      const zone = r < 4.5 ? 0 : r < CLEARING_RADIUS + 5 ? 0.75 : meadow * 0.7;
      const colour = Math.floor(rnd() * 3);
      const count = 7 + Math.floor(rnd() * 12);
      const spread = 1.6 + rnd() * 1.1;
      if (rnd() > zone) continue;
      for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * spread;
        const x = ccx + Math.cos(a) * d;
        const z = ccz + Math.sin(a) * d;
        if (pathDistance(x, z) < 1.4 || isBlocked(x, z, 0.3) || getTerrainNormal(x, z).y < 0.9) continue;
        const s = 0.8 + rnd() * 0.7;
        dummy.position.set(x, getTerrainHeight(x, z) - 0.01, z);
        dummy.quaternion.setFromUnitVectors(up, up);
        dummy.rotation.set((rnd() - 0.5) * 0.25, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.25);
        dummy.scale.setScalar(s);
        dummy.updateMatrix();
        lists[colour].push(...dummy.matrix.elements, x, z);
      }
    }
    lists.forEach((l, k) => {
      const n = l.length / 18;
      const m = new Float32Array(n * 16);
      const xz = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 16; j++) m[i * 16 + j] = l[i * 18 + j];
        xz[i * 2] = l[i * 18 + 16];
        xz[i * 2 + 1] = l[i * 18 + 17];
      }
      res.m.push(m);
      res.xz.push(xz);
      res.n.push(n);
    });
    return res;
  }, 80);

  const flowerPools = flowerParts.map((parts) => {
    if (!parts) return null;
    const pool = new StreamedInstances(
      parts.map((p) => ({ geometry: p.geometry, material: p.material, receiveShadow: true })),
      isSoftwareGl ? 500 : 2600
    );
    group.add(pool.group);
    pools.push(pool);
    parts.forEach((p) => disposables.push(p.geometry));
    return pool;
  });

  let lx = Infinity;
  let lz = Infinity;
  function rebuildFlowers(px: number, pz: number) {
    const cx0 = chunkCoord(px - FLOWER_RANGE);
    const cx1 = chunkCoord(px + FLOWER_RANGE);
    const cz0 = chunkCoord(pz - FLOWER_RANGE);
    const cz1 = chunkCoord(pz + FLOWER_RANGE);
    flowerPools.forEach((pool, k) => {
      if (!pool) return;
      let n = 0;
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const ch = flowerCache.get(cx, cz);
          for (let i = 0; i < ch.n[k] && n < pool.capacity; i++) {
            if (Math.hypot(ch.xz[k][i * 2] - px, ch.xz[k][i * 2 + 1] - pz) > FLOWER_RANGE) continue;
            pool.matrices.set(ch.m[k].subarray(i * 16, i * 16 + 16), n * 16);
            n++;
          }
        }
      }
      pool.commit(n);
    });
  }

  return {
    update: (p) => {
      if (Math.hypot(p.x - lx, p.z - lz) > 4) {
        lx = p.x;
        lz = p.z;
        rebuildFlowers(p.x, p.z);
      }
    },
    dispose: () => {
      pools.forEach((p) => p.dispose());
      scene.remove(group);
      disposables.forEach((d) => d.dispose());
      flowerCache.clear();
    },
  };
}
