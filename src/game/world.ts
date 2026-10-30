import * as THREE from 'three';
import { fbm2, hash2, mulberry32, smoothstep } from './rng';
import { getTerrainHeight, getTerrainNormal, pathCenterZ } from './terrain';

/**
 * World layout: a deterministic, planned map.
 *   - Start meadow (radius CLEARING_RADIUS): short grass + flowers only, nothing tall in view of the player.
 *   - Winding trail crossing the map (kept open).
 *   - Forest density field: open meadows near the centre, groves further out, dense tree wall on the rim.
 *   - Rocks only in small groups (never uniformly scattered).
 * Everything (trees, rocks, grass, flowers) queries the same fields, so regions agree with each other.
 */

export const WORLD_SEED = 7319;
export const CLEARING_RADIUS = 20;
export const PLAY_RADIUS = 148;
export const CHUNK_SIZE = 32;

export type TreeSpecies = 'oak' | 'pine' | 'aspen' | 'ash' | 'bush';

export interface TreeSpec {
  species: TreeSpecies;
  variant: number; // index into the species' pre-generated variants
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
}

export interface RockSpec {
  type: number; // 0..2
  x: number;
  y: number;
  z: number;
  scale: number;
  rotY: number;
  tiltX: number;
  tiltZ: number;
}

interface Collider {
  x: number;
  z: number;
  r: number;
}

export interface WorldLayout {
  trees: TreeSpec[];
  rocks: RockSpec[];
  treesByChunk: Map<string, TreeSpec[]>;
  rocksByChunk: Map<string, RockSpec[]>;
}

export const chunkCoord = (v: number) => Math.floor(v / CHUNK_SIZE);
export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;

export function pathDistance(x: number, z: number): number {
  return Math.abs(z - pathCenterZ(x));
}

/** 0 = open meadow, 1 = dense forest */
export function forestDensity(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const ramp = smoothstep(CLEARING_RADIUS + 10, 78, r);
  const n = fbm2(x * 0.011 + 13.7, z * 0.011 - 8.1, WORLD_SEED, 4);
  let f = smoothstep(0.42, 0.6, n) * ramp;
  f = Math.max(f, smoothstep(104, 128, r)); // framing tree wall around the playable area
  if (r < 135) f *= smoothstep(5, 12, pathDistance(x, z)); // trail corridor stays open
  return f;
}

/** 0..1 patchiness mask used to place grass variants (meadow patches). */
export function patchMask(x: number, z: number, seed: number, scale = 0.05): number {
  return fbm2(x * scale, z * scale, WORLD_SEED + seed, 3);
}

// ---------------------------------------------------------------------------
// Colliders (circles on the XZ plane) in a spatial hash
// ---------------------------------------------------------------------------
const HASH = 8;
const colliderGrid = new Map<string, Collider[]>();
const hkey = (ix: number, iz: number) => `${ix},${iz}`;

function addCollider(c: Collider) {
  const k = hkey(Math.floor(c.x / HASH), Math.floor(c.z / HASH));
  const arr = colliderGrid.get(k);
  if (arr) arr.push(c);
  else colliderGrid.set(k, [c]);
}

function nearColliders(x: number, z: number, range: number, cb: (c: Collider) => void) {
  const x0 = Math.floor((x - range) / HASH);
  const x1 = Math.floor((x + range) / HASH);
  const z0 = Math.floor((z - range) / HASH);
  const z1 = Math.floor((z + range) / HASH);
  for (let ix = x0; ix <= x1; ix++) {
    for (let iz = z0; iz <= z1; iz++) {
      const arr = colliderGrid.get(hkey(ix, iz));
      if (arr) for (const c of arr) cb(c);
    }
  }
}

/** True when (x,z) is inside a solid object (+margin). Used to keep grass out of trunks and rocks. */
export function isBlocked(x: number, z: number, margin = 0): boolean {
  let hit = false;
  nearColliders(x, z, 3 + margin, (c) => {
    if (!hit && Math.hypot(x - c.x, z - c.z) < c.r + margin) hit = true;
  });
  return hit;
}

/** Pushes the player out of trunks/rocks and keeps them inside the playable disc. */
export function resolveCollisions(pos: THREE.Vector3, radius = 0.4): void {
  getWorld();
  nearColliders(pos.x, pos.z, 4, (c) => {
    const dx = pos.x - c.x;
    const dz = pos.z - c.z;
    const min = c.r + radius;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min) {
      const d = Math.sqrt(d2) || 0.0001;
      pos.x = c.x + (dx / d) * min;
      pos.z = c.z + (dz / d) * min;
    }
  });
  const r = Math.hypot(pos.x, pos.z);
  if (r > PLAY_RADIUS) {
    pos.x *= PLAY_RADIUS / r;
    pos.z *= PLAY_RADIUS / r;
  }
}

// ---------------------------------------------------------------------------
// Layout generation
// ---------------------------------------------------------------------------
let cached: WorldLayout | null = null;

export const TREE_VARIANTS: Record<TreeSpecies, number> = { oak: 3, pine: 3, aspen: 2, ash: 2, bush: 2 };
/** Approx. trunk collision radius (metres at scale 1) */
const TRUNK_R: Record<TreeSpecies, number> = { oak: 0.55, pine: 0.4, aspen: 0.3, ash: 0.45, bush: 0 };

function pushByChunk<T extends { x: number; z: number }>(map: Map<string, T[]>, item: T) {
  const k = chunkKey(chunkCoord(item.x), chunkCoord(item.z));
  const arr = map.get(k);
  if (arr) arr.push(item);
  else map.set(k, [item]);
}

export function getWorld(): WorldLayout {
  if (cached) return cached;
  const rnd = mulberry32(WORLD_SEED);
  const trees: TreeSpec[] = [];
  const rocks: RockSpec[] = [];

  // spatial hash for spacing checks between placed objects
  const placed = new Map<string, { x: number; z: number; r: number }[]>();
  const tooClose = (x: number, z: number, r: number) => {
    const ix = Math.floor(x / HASH);
    const iz = Math.floor(z / HASH);
    for (let a = ix - 1; a <= ix + 1; a++) {
      for (let b = iz - 1; b <= iz + 1; b++) {
        const arr = placed.get(hkey(a, b));
        if (arr) for (const p of arr) if (Math.hypot(x - p.x, z - p.z) < Math.max(r, p.r)) return true;
      }
    }
    return false;
  };
  const markPlaced = (x: number, z: number, r: number) => {
    const k = hkey(Math.floor(x / HASH), Math.floor(z / HASH));
    const arr = placed.get(k);
    if (arr) arr.push({ x, z, r });
    else placed.set(k, [{ x, z, r }]);
  };

  const slopeAt = (x: number, z: number) => Math.acos(Math.min(1, getTerrainNormal(x, z).y));

  const addTree = (species: TreeSpecies, x: number, z: number, scale: number) => {
    const spec: TreeSpec = {
      species,
      variant: Math.floor(rnd() * TREE_VARIANTS[species]),
      x,
      y: getTerrainHeight(x, z),
      z,
      scale,
      rotY: rnd() * Math.PI * 2,
    };
    trees.push(spec);
    if (TRUNK_R[species] > 0) addCollider({ x, z, r: TRUNK_R[species] * scale });
  };

  // 1) Landmark oaks in the meadows (big, well spaced, give the open areas focal points)
  let landmarks = 0;
  for (let i = 0; i < 400 && landmarks < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 30 + rnd() * 48;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (pathDistance(x, z) < 9 || forestDensity(x, z) > 0.25 || slopeAt(x, z) > 0.2 || tooClose(x, z, 22)) continue;
    addTree('oak', x, z, 1.3 + rnd() * 0.25);
    markPlaced(x, z, 22);
    landmarks++;
  }

  // 2) Forest groves from the density field (jittered grid + spacing check)
  const STEP = 4.2;
  for (let gx = -PLAY_RADIUS - 14; gx <= PLAY_RADIUS + 14; gx += STEP) {
    for (let gz = -PLAY_RADIUS - 14; gz <= PLAY_RADIUS + 14; gz += STEP) {
      const x = gx + (rnd() - 0.5) * STEP * 0.9;
      const z = gz + (rnd() - 0.5) * STEP * 0.9;
      const r = Math.hypot(x, z);
      if (r < CLEARING_RADIUS + 4 || r > PLAY_RADIUS + 16) continue;
      const f = forestDensity(x, z);
      if (rnd() > Math.pow(f, 0.85) * 0.92) continue;
      if (slopeAt(x, z) > 0.34) continue;
      const spacing = 4.4 + (1 - f) * 3.2;
      if (tooClose(x, z, spacing)) continue;

      const grove = fbm2(x * 0.02 + 91, z * 0.02 - 40, WORLD_SEED + 5, 3);
      const pick = rnd();
      let species: TreeSpecies;
      if (r > 88 || grove > 0.6) species = pick < 0.68 ? 'pine' : pick < 0.82 ? 'aspen' : 'oak';
      else if (grove < 0.36) species = pick < 0.62 ? 'oak' : pick < 0.82 ? 'ash' : 'aspen';
      else species = pick < 0.34 ? 'oak' : pick < 0.58 ? 'aspen' : pick < 0.8 ? 'pine' : 'ash';
      const base = species === 'pine' ? 1.0 : species === 'oak' ? 1.0 : 0.95;
      addTree(species, x, z, base * (0.85 + rnd() * 0.4));
      markPlaced(x, z, spacing);
    }
  }

  // 3) Understory bushes along forest edges (transition zones between meadow and forest)
  for (let i = 0; i < 2500; i++) {
    const a = rnd() * Math.PI * 2;
    const d = CLEARING_RADIUS + 6 + rnd() * (PLAY_RADIUS - CLEARING_RADIUS - 10);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const f = forestDensity(x, z);
    if (f < 0.12 || f > 0.6 || pathDistance(x, z) < 5 || slopeAt(x, z) > 0.3 || tooClose(x, z, 3.2)) continue;
    addTree('bush', x, z, 0.7 + rnd() * 0.5);
    markPlaced(x, z, 3.2);
    if (trees.filter((t) => t.species === 'bush').length >= 110) break;
  }

  // 4) Rocks in small groups. A few small ones frame the start meadow, the rest sit by the trail / forest edges.
  const addRock = (cx: number, cz: number, spread: number, n: number, sMin: number, sMax: number) => {
    for (let k = 0; k < n; k++) {
      const a = rnd() * Math.PI * 2;
      const d = k === 0 ? 0 : 0.8 + rnd() * spread;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const s = k === 0 ? sMax : sMin + rnd() * (sMax - sMin) * 0.7;
      const y = getTerrainHeight(x, z);
      rocks.push({
        type: Math.floor(rnd() * 3),
        x,
        y: y + s * 0.38,
        z,
        scale: s,
        rotY: rnd() * Math.PI * 2,
        tiltX: (rnd() - 0.5) * 0.35,
        tiltZ: (rnd() - 0.5) * 0.35,
      });
      addCollider({ x, z, r: s * 0.78 });
    }
  };
  // start-meadow rim: small, low, off the camera's initial line of sight
  const rimAngles = [2.3, 3.6, 4.5, 5.6, 0.7];
  for (const a of rimAngles) {
    const d = CLEARING_RADIUS - 2 + rnd() * 3;
    addRock(Math.cos(a) * d, Math.sin(a) * d, 1.4, 2, 0.35, 0.8);
  }
  let groups = 0;
  for (let i = 0; i < 800 && groups < 16; i++) {
    const a = rnd() * Math.PI * 2;
    const d = CLEARING_RADIUS + 8 + rnd() * 95;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const f = forestDensity(x, z);
    const pd = pathDistance(x, z);
    if (f > 0.7 || slopeAt(x, z) > 0.3 || isBlocked(x, z, 3) || (pd > 22 && f < 0.15)) continue;
    addRock(x, z, 2.6, 2 + Math.floor(rnd() * 3), 0.6, 1.5 + rnd() * 0.5);
    groups++;
  }

  const treesByChunk = new Map<string, TreeSpec[]>();
  const rocksByChunk = new Map<string, RockSpec[]>();
  trees.forEach((t) => pushByChunk(treesByChunk, t));
  rocks.forEach((r) => pushByChunk(rocksByChunk, r));
  cached = { trees, rocks, treesByChunk, rocksByChunk };
  return cached;
}

/** Deterministic per-chunk RNG (independent of generation order, so chunks can stream in any order). */
export function chunkRng(cx: number, cz: number, salt: number) {
  return mulberry32(Math.floor(hash2(cx, cz, WORLD_SEED + salt) * 4294967295));
}
