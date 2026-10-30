import * as THREE from 'three';
import { getTerrainHeight, getTerrainNormal } from './terrain';
import { CHUNK_SIZE, CLEARING_RADIUS, chunkCoord, chunkRng, forestDensity, isBlocked, patchMask, pathDistance } from './world';
import { smoothstep } from './rng';
import { ChunkCache, StreamedInstances } from './streaming';

/**
 * Grass system: real 3D blade geometry (curved, tapered, V-folded), five grass types, three distance
 * rings (full tuft / reduced tuft / sparse tuft), density driven by the world's zone masks, chunked
 * deterministic generation and GPU wind. Short and medium grass dominate; tall grass is rare and only
 * grows in specific patches far from the start meadow.
 */

export interface VegetationController {
  meshGroup: THREE.Group;
  update: (time: number, playerPos: THREE.Vector3) => void;
  dispose: () => void;
}

export type GrassType = 'short' | 'medium' | 'fine' | 'broad' | 'tall';

interface TuftSpec {
  blades: number;
  height: number;
  spread: number;
  width: number;
  lean: number;
  segments: number;
}

const TYPE_SPECS: Record<GrassType, TuftSpec> = {
  short: { blades: 9, height: 0.2, spread: 0.1, width: 0.02, lean: 0.35, segments: 3 },
  medium: { blades: 8, height: 0.38, spread: 0.13, width: 0.022, lean: 0.4, segments: 4 },
  fine: { blades: 14, height: 0.28, spread: 0.07, width: 0.011, lean: 0.5, segments: 3 },
  broad: { blades: 5, height: 0.46, spread: 0.12, width: 0.055, lean: 0.55, segments: 4 },
  tall: { blades: 7, height: 0.78, spread: 0.17, width: 0.026, lean: 0.5, segments: 5 },
};

const TYPES = Object.keys(TYPE_SPECS) as GrassType[];

/** Distance rings: [start, end, instance keep-rate, blade factor, size boost] */
const RINGS = [
  { start: 0, end: 24, keep: 1.0, bladeFactor: 1.0, segFactor: 1, boost: 1.0 },
  { start: 24, end: 46, keep: 0.34, bladeFactor: 0.5, segFactor: 0.6, boost: 1.18 },
  { start: 46, end: 70, keep: 0.14, bladeFactor: 0.34, segFactor: 0.4, boost: 1.4 },
] as const;
const FADE_END = 70;

/**
 * One tuft = several blades arranged around a root point. Each blade is a tapered ribbon with a V-fold
 * along the spine, bent outward along a parabolic arc.
 */
export function createTuftGeometry(spec: TuftSpec, rnd: () => number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vo = 0;
  const { blades, height, spread, width, lean, segments } = spec;

  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
    const h = height * (0.65 + rnd() * 0.6);
    const w = width * (0.8 + rnd() * 0.45);
    const bend = (lean * (0.5 + rnd() * 0.7)) * h;
    const rr = spread * (0.15 + rnd() * 0.85);
    const rx = Math.cos(a) * rr;
    const rz = Math.sin(a) * rr;
    const dx = Math.cos(a + (rnd() - 0.5) * 0.9);
    const dz = Math.sin(a + (rnd() - 0.5) * 0.9);
    const px = -dz;
    const pz = dx;

    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const y = t * h;
      const off = Math.pow(t, 1.7) * bend;
      const cx = rx + dx * off;
      const cz = rz + dz * off;
      const wt = w * Math.pow(1 - t, 0.75) + w * 0.06; // leaf-like taper, tip stays a point-ish
      const fold = (1 - t) * w * 0.55;
      positions.push(cx - px * wt, y, cz - pz * wt);
      uvs.push(0, t);
      positions.push(cx + dx * fold, y, cz + dz * fold);
      uvs.push(0.5, t);
      positions.push(cx + px * wt, y, cz + pz * wt);
      uvs.push(1, t);
    }
    for (let s = 0; s < segments; s++) {
      const r0 = vo + s * 3;
      const r1 = vo + (s + 1) * 3;
      indices.push(r0, r0 + 1, r1, r1, r0 + 1, r1 + 1);
      indices.push(r0 + 1, r0 + 2, r1 + 1, r1 + 1, r0 + 2, r1 + 2);
    }
    vo += (segments + 1) * 3;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

interface GrassUniforms {
  time: { value: number };
  windDir: { value: THREE.Vector2 };
  playerPos: { value: THREE.Vector3 };
  fadeEnd: { value: number };
}

/** PBR grass material with GPU wind, root->tip gradient, and distance fade-out of the outermost ring. */
export function createGrassMaterial(uniforms: GrassUniforms, tone: { root: number[]; mid: number[]; tip: number[] }) {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = uniforms.time;
    shader.uniforms.windDir = uniforms.windDir;
    shader.uniforms.playerPos = uniforms.playerPos;
    shader.uniforms.fadeEnd = uniforms.fadeEnd;
    shader.uniforms.rootCol = { value: new THREE.Vector3(...tone.root) };
    shader.uniforms.midCol = { value: new THREE.Vector3(...tone.mid) };
    shader.uniforms.tipCol = { value: new THREE.Vector3(...tone.tip) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float time; uniform vec2 windDir; uniform vec3 playerPos; uniform float fadeEnd;
        varying float vBladeH;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vBladeH = uv.y;
        vec4 wRoot = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float dPlayer = distance(wRoot.xz, playerPos.xz);
        float fade = 1.0 - smoothstep(fadeEnd - 14.0, fadeEnd, dPlayer);
        transformed *= mix(0.0, 1.0, fade);
        float ph = wRoot.x * 0.16 + wRoot.z * 0.14 + time * 2.4;
        float wave = sin(ph) * cos(wRoot.z * 0.21 - time * 1.7);
        float gust = sin(time * 0.7 + wRoot.x * 0.04) * 0.35 + 0.65;
        float bendF = pow(clamp(uv.y, 0.0, 1.0), 1.6) * 0.3 * gust;
        transformed.x += (windDir.x * wave + 0.1) * bendF;
        transformed.z += (windDir.y * wave + 0.1) * bendF;
        transformed.y -= abs(wave) * bendF * 0.2;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n varying float vBladeH; uniform vec3 rootCol; uniform vec3 midCol; uniform vec3 tipCol;`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float hh = clamp(vBladeH, 0.0, 1.0);
        vec3 grad = mix(rootCol, midCol, smoothstep(0.0, 0.5, hh));
        grad = mix(grad, tipCol, smoothstep(0.5, 1.0, hh));
        diffuseColor.rgb *= grad;`
      );
  };
  return material;
}

/** Natural tint palettes (multiplied with the blade gradient). Slightly dry/yellow tufts add variety. */
const TINTS = [0xc9e08a, 0xb4d37a, 0xa9cf6f, 0xd6e49a, 0x9cc468, 0xd8d68a, 0xbfdc82].map((c) => new THREE.Color(c));

interface TypeChunk {
  m: Float32Array; // 16 per instance
  c: Float32Array; // 3 per instance
  xz: Float32Array; // 2 per instance
  rank: Float32Array; // 0..1 (used for ring thinning)
  n: number;
}
type GrassChunk = Record<GrassType, TypeChunk>;

/** Instances per m² (before zone modulation). */
const BASE_DENSITY: Record<GrassType, number> = { short: 3.6, medium: 1.2, fine: 2.4, broad: 0.55, tall: 0.07 };

function generateChunk(cx: number, cz: number, densityScale: number): GrassChunk {
  const rnd = chunkRng(cx, cz, 11);
  const dummy = new THREE.Object3D();
  const normal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const out = {} as GrassChunk;
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;

  for (const type of TYPES) {
    const cap = Math.ceil(BASE_DENSITY[type] * CHUNK_SIZE * CHUNK_SIZE * densityScale);
    const m = new Float32Array(cap * 16);
    const c = new Float32Array(cap * 3);
    const xz = new Float32Array(cap * 2);
    const rank = new Float32Array(cap);
    let n = 0;
    for (let i = 0; i < cap; i++) {
      const x = x0 + rnd() * CHUNK_SIZE;
      const z = z0 + rnd() * CHUNK_SIZE;
      const keepRoll = rnd();
      const r = Math.hypot(x, z);
      const f = forestDensity(x, z);
      const pd = pathDistance(x, z);
      const inClearing = r < CLEARING_RADIUS + 4;
      const meadow = patchMask(x, z, 1, 0.045);
      const tallMask = patchMask(x, z, 2, 0.03);

      // Zone-based keep probability per type
      let p = 1;
      switch (type) {
        case 'short':
          p = 1 - 0.55 * f; // everywhere, thinner under forest canopy
          break;
        case 'medium':
          p = smoothstep(0.35, 0.65, meadow) * (1 - 0.7 * f) * (inClearing ? 0.55 : 1);
          break;
        case 'fine':
          p = smoothstep(0.3, 0.55, patchMask(x, z, 3, 0.07)) * (1 - 0.6 * f);
          break;
        case 'broad':
          p = smoothstep(0.1, 0.35, f) * (1 - smoothstep(0.7, 1, f) * 0.6) + (inClearing ? 0 : 0.06);
          break;
        case 'tall':
          p = r < CLEARING_RADIUS + 14 ? 0 : smoothstep(0.62, 0.78, tallMask) * (1 - 0.5 * f);
          break;
      }
      if (pd < 2.4) p *= smoothstep(0.8, 2.4, pd) * 0.6; // worn trail: almost bare soil
      if (keepRoll > p) continue;
      if (isBlocked(x, z, 0.25)) continue;

      getTerrainNormal(x, z, normal);
      if (normal.y < 0.88) continue; // skip steep slopes (rock faces)

      const y = getTerrainHeight(x, z);
      const sBase = type === 'tall' ? 0.85 + rnd() * 0.4 : 0.75 + rnd() * 0.55;
      // very short grass right where the player spawns so the character stays clearly visible
      const spawnMul = r < 7 && (type === 'medium' || type === 'broad' || type === 'tall') ? 0.6 : 1;
      const s = sBase * spawnMul;
      dummy.position.set(x, y - 0.02, z);
      q.setFromUnitVectors(up, normal.lerp(up, 0.5).normalize());
      dummy.quaternion.copy(q);
      dummy.rotateY(rnd() * Math.PI * 2);
      dummy.scale.set(s, s * (0.8 + rnd() * 0.45), s);
      dummy.updateMatrix();
      dummy.matrix.toArray(m, n * 16);

      const tint = TINTS[Math.floor(rnd() * TINTS.length)];
      const dry = smoothstep(0.55, 0.8, patchMask(x, z, 4, 0.06)) * 0.35; // dry-grass patches
      c[n * 3] = tint.r + dry * 0.25;
      c[n * 3 + 1] = tint.g - dry * 0.05;
      c[n * 3 + 2] = tint.b - dry * 0.15;
      xz[n * 2] = x;
      xz[n * 2 + 1] = z;
      rank[n] = rnd();
      n++;
    }
    out[type] = { m, c, xz, rank, n };
  }
  return out;
}

export function setupVegetationSystem(scene: THREE.Scene, isSoftwareGl: boolean): VegetationController {
  const group = new THREE.Group();
  group.name = 'VegetationSystem';
  const densityScale = isSoftwareGl ? 0.3 : 1;

  const uniforms: GrassUniforms = {
    time: { value: 0 },
    windDir: { value: new THREE.Vector2(0.75, 0.45).normalize() },
    playerPos: { value: new THREE.Vector3() },
    fadeEnd: { value: FADE_END },
  };
  const tones: Record<GrassType, { root: number[]; mid: number[]; tip: number[] }> = {
    short: { root: [0.09, 0.2, 0.06], mid: [0.2, 0.46, 0.12], tip: [0.38, 0.66, 0.2] },
    medium: { root: [0.08, 0.19, 0.06], mid: [0.19, 0.44, 0.11], tip: [0.42, 0.66, 0.2] },
    fine: { root: [0.1, 0.22, 0.07], mid: [0.24, 0.5, 0.14], tip: [0.5, 0.7, 0.24] },
    broad: { root: [0.07, 0.17, 0.05], mid: [0.15, 0.4, 0.1], tip: [0.28, 0.58, 0.16] },
    tall: { root: [0.1, 0.2, 0.06], mid: [0.3, 0.5, 0.14], tip: [0.62, 0.66, 0.26] },
  };

  const geometries: THREE.BufferGeometry[] = [];
  const materials = {} as Record<GrassType, THREE.Material>;
  const pools: { type: GrassType; ring: number; pool: StreamedInstances }[] = [];

  TYPES.forEach((type, ti) => {
    materials[type] = createGrassMaterial(uniforms, tones[type]);
    RINGS.forEach((ring, ri) => {
      if (type === 'tall' && ri === 2) return; // tall grass is never needed in the far ring
      const base = TYPE_SPECS[type];
      const spec: TuftSpec = {
        ...base,
        blades: Math.max(2, Math.round(base.blades * ring.bladeFactor)),
        segments: Math.max(1, Math.round(base.segments * ring.segFactor)),
        width: base.width * (1 + (1 - ring.bladeFactor) * 1.2),
      };
      const geo = createTuftGeometry(spec, chunkRng(ti, ri, 99));
      geometries.push(geo);
      const cap = Math.ceil(BASE_DENSITY[type] * Math.PI * ring.end * ring.end * ring.keep * densityScale * 1.25) + 64;
      const pool = new StreamedInstances(
        [{ geometry: geo, material: materials[type], colored: true, castShadow: false, receiveShadow: true }],
        cap
      );
      pools.push({ type, ring: ri, pool });
      group.add(pool.group);
    });
  });

  const cache = new ChunkCache<GrassChunk>((cx, cz) => generateChunk(cx, cz, densityScale), isSoftwareGl ? 80 : 200);
  let lastX = Infinity;
  let lastZ = Infinity;
  const tmpMat = new THREE.Matrix4();
  const scaleM = new THREE.Matrix4();

  function rebuild(px: number, pz: number) {
    const reach = FADE_END + 4;
    const cx0 = chunkCoord(px - reach);
    const cx1 = chunkCoord(px + reach);
    const cz0 = chunkCoord(pz - reach);
    const cz1 = chunkCoord(pz + reach);

    const counts = new Map<string, number>();
    for (const { type, ring, pool } of pools) {
      let n = 0;
      const cfg = RINGS[ring];
      const cap = pool.capacity;
      for (let cx = cx0; cx <= cx1 && n < cap; cx++) {
        for (let cz = cz0; cz <= cz1 && n < cap; cz++) {
          // skip chunks that cannot reach this ring
          const ccx = (cx + 0.5) * CHUNK_SIZE - px;
          const ccz = (cz + 0.5) * CHUNK_SIZE - pz;
          const cd = Math.hypot(ccx, ccz);
          const half = CHUNK_SIZE * 0.72;
          if (cd - half > cfg.end || cd + half < cfg.start) continue;
          const ch = cache.get(cx, cz)[type];
          for (let i = 0; i < ch.n && n < cap; i++) {
            const d = Math.hypot(ch.xz[i * 2] - px, ch.xz[i * 2 + 1] - pz);
            if (d < cfg.start || d >= cfg.end || ch.rank[i] >= cfg.keep) continue;
            if (cfg.boost !== 1) {
              tmpMat.fromArray(ch.m, i * 16);
              scaleM.makeScale(cfg.boost, cfg.boost, cfg.boost);
              tmpMat.multiply(scaleM).toArray(pool.matrices, n * 16);
            } else {
              pool.matrices.set(ch.m.subarray(i * 16, i * 16 + 16), n * 16);
            }
            pool.colors!.set(ch.c.subarray(i * 3, i * 3 + 3), n * 3);
            n++;
          }
        }
      }
      pool.commit(n);
      counts.set(`${type}${ring}`, n);
    }
  }

  scene.add(group);

  return {
    meshGroup: group,
    update: (time: number, playerPos: THREE.Vector3) => {
      uniforms.time.value = time;
      uniforms.playerPos.value.copy(playerPos);
      if (Math.hypot(playerPos.x - lastX, playerPos.z - lastZ) > 4) {
        lastX = playerPos.x;
        lastZ = playerPos.z;
        rebuild(playerPos.x, playerPos.z);
      }
    },
    dispose: () => {
      scene.remove(group);
      pools.forEach((p) => p.pool.dispose());
      geometries.forEach((g) => g.dispose());
      Object.values(materials).forEach((m) => m.dispose());
      cache.clear();
    },
  };
}
