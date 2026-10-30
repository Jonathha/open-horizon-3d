import * as THREE from 'three';
import {
  createGrassTexture,
  createSoilTrailTexture,
  createRockTexture,
  createPebbleGravelTexture,
} from './proceduralTextures';

export const TERRAIN_SIZE = 360;
export const TERRAIN_SEGMENTS = 160;

/**
 * Deterministic terrain elevation function.
 * Center is expansive, predominantly flat, with gentle subtle rolling swells (< 0.8m)
 * Outskirts gradually curve into scenic natural ridges to bound the open world organically.
 */
export function getTerrainHeight(x: number, z: number): number {
  const distFromCenter = Math.sqrt(x * x + z * z);

  // Subtle natural undulating ground in the explorable heart
  const microRoll =
    Math.sin(x * 0.04) * Math.cos(z * 0.04) * 0.45 +
    Math.sin(x * 0.08 + 1.2) * Math.cos(z * 0.06 - 0.7) * 0.25 +
    Math.sin(x * 0.015) * 0.3;

  // Gentle boundary ridges that frame the open world past radius 110m
  let perimeterRise = 0;
  if (distFromCenter > 110) {
    const factor = (distFromCenter - 110) / (TERRAIN_SIZE * 0.5 - 110);
    const clampedFactor = Math.min(Math.max(factor, 0), 1);
    perimeterRise = Math.pow(clampedFactor, 2) * 16.0;
    // Add ridge variation
    perimeterRise += Math.sin(x * 0.06) * Math.cos(z * 0.06) * 3.5 * clampedFactor;
  }

  return microRoll + perimeterRise;
}

/**
 * Computes terrain normal for slope-aware foot placement and physics
 */
export function getTerrainNormal(x: number, z: number, target = new THREE.Vector3()): THREE.Vector3 {
  const eps = 0.5;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);

  target.set(hL - hR, 2 * eps, hD - hU).normalize();
  return target;
}

export function createTerrain(): { mesh: THREE.Mesh; materials: THREE.Material[]; textures: THREE.Texture[] } {
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const posAttr = geometry.attributes.position;
  const count = posAttr.count;

  for (let i = 0; i < count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const vy = getTerrainHeight(vx, vz);
    posAttr.setY(i, vy);
  }
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();

  // Multi-biome vertex color blending:
  // - Meadow grass (vibrant fresh green)
  // - Natural worn path / dirt trails (warm earthy tan)
  // - Rocky cliffs & ridges on steep slopes
  const colors = new Float32Array(count * 3);
  const normalAttr = geometry.attributes.normal;

  const grassColor = new THREE.Color(0x76b852);
  const darkGrassColor = new THREE.Color(0x3e7228);
  const pathColor = new THREE.Color(0x927856);
  const cliffColor = new THREE.Color(0x6e767c);

  const tempColor = new THREE.Color();

  for (let i = 0; i < count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    const ny = normalAttr.getY(i);

    const slope = Math.acos(Math.min(1.0, Math.max(0.0, ny)));
    const pathDist = Math.abs(vz - (Math.sin(vx * 0.03) * 18.0 + Math.cos(vx * 0.015) * 8.0));
    const isPath = pathDist < 3.2;

    if (slope > 0.28) {
      const t = Math.min(1.0, (slope - 0.28) / 0.35);
      tempColor.copy(grassColor).lerp(cliffColor, t);
    } else if (isPath && Math.sqrt(vx * vx + vz * vz) < 130) {
      const t = 1.0 - (pathDist / 3.2);
      tempColor.copy(grassColor).lerp(pathColor, t * 0.85);
    } else {
      const noise = (Math.sin(vx * 0.1) * Math.cos(vz * 0.1) + 1) * 0.5;
      tempColor.copy(grassColor).lerp(darkGrassColor, noise * 0.45);
    }

    colors[i * 3] = tempColor.r;
    colors[i * 3 + 1] = tempColor.g;
    colors[i * 3 + 2] = tempColor.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  // PBR Textures
  const grassTex = createGrassTexture();
  const soilTex = createSoilTrailTexture();
  const rockTex = createRockTexture();
  const pebbleTex = createPebbleGravelTexture();

  const allTextures = [
    grassTex.diffuse,
    grassTex.normal,
    grassTex.roughness,
    soilTex.diffuse,
    soilTex.normal,
    soilTex.roughness,
    rockTex.diffuse,
    rockTex.normal,
    pebbleTex.diffuse,
    pebbleTex.normal,
    pebbleTex.roughness,
  ];

  allTextures.forEach((t) => {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  });

  const material = new THREE.MeshStandardMaterial({
    map: grassTex.diffuse,
    normalMap: grassTex.normal,
    roughnessMap: grassTex.roughness,
    roughness: 0.86,
    metalness: 0.02,
    vertexColors: true,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.soilMap = { value: soilTex.diffuse };
    shader.uniforms.soilNormal = { value: soilTex.normal };
    shader.uniforms.rockMap = { value: rockTex.diffuse };
    shader.uniforms.rockNormal = { value: rockTex.normal };
    shader.uniforms.pebbleMap = { value: pebbleTex.diffuse };
    shader.uniforms.pebbleNormal = { value: pebbleTex.normal };

    material.userData.shader = shader;

    shader.vertexShader = `
      varying vec3 vWorldPosition;
      varying float vSlopeAngle;
      varying float vPathDist;
      ${shader.vertexShader}
    `;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vec4 wPos = modelMatrix * vec4(position, 1.0);
      vWorldPosition = wPos.xyz;

      vec3 wNormal = normalize(mat3(modelMatrix) * normal);
      vSlopeAngle = acos(clamp(wNormal.y, 0.0, 1.0));
      vPathDist = abs(wPos.z - (sin(wPos.x * 0.03) * 18.0 + cos(wPos.x * 0.015) * 8.0));
      `
    );

    shader.fragmentShader = `
      uniform sampler2D soilMap;
      uniform sampler2D soilNormal;
      uniform sampler2D rockMap;
      uniform sampler2D rockNormal;
      uniform sampler2D pebbleMap;
      uniform sampler2D pebbleNormal;
      varying vec3 vWorldPosition;
      varying float vSlopeAngle;
      varying float vPathDist;
      ${shader.fragmentShader}
    `;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      // Multi-scale procedural PBR blending
      vec2 uvDetail = vWorldPosition.xz * 0.25;
      vec2 uvMacro = vWorldPosition.xz * 0.04;

      vec4 grassCol = texture2D(map, uvDetail);
      vec4 grassMacro = texture2D(map, uvMacro);
      grassCol = mix(grassCol, grassMacro, 0.35);

      vec4 soilCol = texture2D(soilMap, uvDetail * 1.3);
      vec4 pebbleCol = texture2D(pebbleMap, uvDetail * 2.1);
      vec4 trailCol = mix(soilCol, pebbleCol, 0.42);

      vec4 rockCol = texture2D(rockMap, uvDetail * 0.85);

      float distCenter = length(vWorldPosition.xz);
      float isTrail = (distCenter < 135.0) ? smoothstep(3.6, 1.2, vPathDist) : 0.0;
      float isRock = smoothstep(0.26, 0.52, vSlopeAngle);

      vec4 groundColor = mix(grassCol, trailCol, isTrail);
      groundColor = mix(groundColor, rockCol, isRock);

      diffuseColor = groundColor * vec4(vColor, 1.0);
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      `
      #include <normal_fragment_maps>
      vec2 uvDet = vWorldPosition.xz * 0.25;
      vec3 nGrass = texture2D(normalMap, uvDet).xyz * 2.0 - 1.0;
      vec3 nSoil = texture2D(soilNormal, uvDet * 1.3).xyz * 2.0 - 1.0;
      vec3 nRock = texture2D(rockNormal, uvDet * 0.85).xyz * 2.0 - 1.0;

      float distC = length(vWorldPosition.xz);
      float trailFac = (distC < 135.0) ? smoothstep(3.6, 1.2, vPathDist) : 0.0;
      float rockFac = smoothstep(0.26, 0.52, vSlopeAngle);

      vec3 blendedN = mix(nGrass, nSoil, trailFac);
      blendedN = mix(blendedN, nRock, rockFac);

      normal = normalize(tbn * blendedN);
      `
    );
  };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;

  return { mesh, materials: [material], textures: allTextures };
}

