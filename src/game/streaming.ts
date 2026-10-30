import * as THREE from 'three';

export interface InstancePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** attach a per-instance colour buffer (shared by all parts that ask for it) */
  colored?: boolean;
}

/**
 * A fixed-capacity pool of instances rendered by one or more InstancedMeshes that share the same
 * matrix buffer (multi-material GLB props, tree branches + leaves, ...). The contents are rewritten
 * whenever the player crosses a region boundary, so only nearby regions cost GPU time.
 */
export class StreamedInstances {
  readonly group = new THREE.Group();
  readonly matrices: Float32Array;
  readonly colors: Float32Array | null;
  private meshes: THREE.InstancedMesh[] = [];
  private matAttr: THREE.InstancedBufferAttribute;
  private colAttr: THREE.InstancedBufferAttribute | null = null;

  constructor(parts: InstancePart[], readonly capacity: number) {
    this.matrices = new Float32Array(capacity * 16);
    this.matAttr = new THREE.InstancedBufferAttribute(this.matrices, 16);
    this.matAttr.setUsage(THREE.DynamicDrawUsage);
    this.colors = parts.some((p) => p.colored) ? new Float32Array(capacity * 3) : null;
    if (this.colors) {
      this.colAttr = new THREE.InstancedBufferAttribute(this.colors, 3);
      this.colAttr.setUsage(THREE.DynamicDrawUsage);
    }
    for (const p of parts) {
      const mesh = new THREE.InstancedMesh(p.geometry, p.material, 1);
      mesh.instanceMatrix = this.matAttr;
      if (p.colored && this.colAttr) mesh.instanceColor = this.colAttr;
      mesh.count = 0;
      mesh.frustumCulled = false; // contents are already limited to nearby regions
      mesh.castShadow = !!p.castShadow;
      mesh.receiveShadow = p.receiveShadow ?? true;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
  }

  /** Call after writing `count` instances into `matrices` (and `colors`). */
  commit(count: number) {
    const n = Math.min(count, this.capacity);
    this.matAttr.clearUpdateRanges();
    this.matAttr.addUpdateRange(0, n * 16);
    this.matAttr.needsUpdate = true;
    if (this.colAttr) {
      this.colAttr.clearUpdateRanges();
      this.colAttr.addUpdateRange(0, n * 3);
      this.colAttr.needsUpdate = true;
    }
    for (const m of this.meshes) m.count = n;
  }

  dispose() {
    this.group.removeFromParent();
    // geometries/materials are owned (and disposed) by whoever created them
    this.meshes.forEach((m) => m.dispose());
    this.meshes = [];
  }
}

/** Small LRU-ish cache for lazily generated per-chunk data. */
export class ChunkCache<T> {
  private map = new Map<string, T>();
  constructor(private gen: (cx: number, cz: number) => T, private max = 120) {}
  get(cx: number, cz: number): T {
    const k = `${cx},${cz}`;
    let v = this.map.get(k);
    if (v) {
      this.map.delete(k); // refresh recency
    } else {
      v = this.gen(cx, cz);
      if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string);
    }
    this.map.set(k, v);
    return v;
  }
  clear() {
    this.map.clear();
  }
}
