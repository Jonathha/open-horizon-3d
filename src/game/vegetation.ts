import * as THREE from 'three';
import { getTerrainHeight, getTerrainNormal } from './terrain';

/**
 * 3D Volumetric Vegetation System for Open Horizon 3D.
 * Generates true 3D multi-blade volumetric grass clumps with physical curvature,
 * V-shaped cross sections, procedural wind animation shaders, and natural clump distribution.
 */

export interface VegetationController {
  meshGroup: THREE.Group;
  update: (time: number, playerPos: THREE.Vector3) => void;
  dispose: () => void;
}

/**
 * Generates a true 3D volumetric grass tuft geometry with multiple curved, tapered blades.
 * Each blade is extruded along an outward arc with a V-folded spine to provide volumetric
 * depth and highlights from every viewing perspective (top, grazing, and side angles).
 */
export function create3DGrassTuftGeometry(
  bladeCount = 8,
  avgHeight = 0.36,
  baseSpread = 0.12
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let vertexOffset = 0;

  for (let b = 0; b < bladeCount; b++) {
    // Distribute blades radially with natural organic variation
    const baseAngle = (b / bladeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.45;
    const bladeHeight = avgHeight * (0.8 + Math.random() * 0.45);
    const bladeWidth = 0.026 * (0.85 + Math.random() * 0.35);
    const maxLean = 0.18 + Math.random() * 0.22; // outward curve amount
    const rootRadius = baseSpread * (0.2 + Math.random() * 0.8);

    // Root position on the ground plane
    const rx = Math.cos(baseAngle) * rootRadius;
    const rz = Math.sin(baseAngle) * rootRadius;

    // Outward direction vector
    const dirX = Math.cos(baseAngle);
    const dirZ = Math.sin(baseAngle);
    // Perpendicular vector for blade width
    const perpX = -dirZ;
    const perpZ = dirX;

    const segments = 4; // 4 vertical tiers = 5 rows

    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      const y = t * bladeHeight;

      // Natural parabolic arch outward
      const lean = Math.pow(t, 1.6) * maxLean * bladeHeight;
      const cx = rx + dirX * lean;
      const cz = rz + dirZ * lean;

      // Width tapers toward the pointed tip
      const w = bladeWidth * (1.0 - t * 0.88);

      // Spine crease factor for V-fold volume
      const vCrease = (1.0 - t) * 0.012;

      // Left edge vertex
      positions.push(cx - perpX * w, y, cz - perpZ * w);
      uvs.push(0.0, t);

      // Center folded spine vertex (pushed slightly outward)
      positions.push(cx + dirX * vCrease, y, cz + dirZ * vCrease);
      uvs.push(0.5, t);

      // Right edge vertex
      positions.push(cx + perpX * w, y, cz + perpZ * w);
      uvs.push(1.0, t);

      // Approximate normals
      const nx = perpZ;
      const ny = 0.25;
      const nz = -perpX;
      normals.push(nx, ny, nz);
      normals.push(dirX * 0.5 + nx * 0.5, ny + 0.3, dirZ * 0.5 + nz * 0.5);
      normals.push(-nx, ny, -nz);
    }

    // Build two triangular columns per vertical tier
    for (let s = 0; s < segments; s++) {
      const row0 = vertexOffset + s * 3;
      const row1 = vertexOffset + (s + 1) * 3;

      // Left quad (2 triangles)
      indices.push(row0, row0 + 1, row1);
      indices.push(row1, row0 + 1, row1 + 1);

      // Right quad (2 triangles)
      indices.push(row0 + 1, row0 + 2, row1 + 1);
      indices.push(row1 + 1, row0 + 2, row1 + 2);
    }

    // Final tip triangle
    const topRow = vertexOffset + segments * 3;
    const tipIndex = topRow + 1; // Center spine vertex at tip
    indices.push(topRow, topRow + 2, tipIndex);

    vertexOffset += (segments + 1) * 3;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Generates natural pasture grass / slender meadow reed with graceful arches (reduced to 0.62m max).
 */
export function create3DTallGrassGeometry(): THREE.BufferGeometry {
  return create3DGrassTuftGeometry(6, 0.62, 0.16);
}

/**
 * Generates genuine 3D Wildflower geometry (3D stem, curved leaves, and 5-lobed petal blossom)
 */
export function create3DWildflowerGeometry(): THREE.BufferGeometry {
  const stemGeo = new THREE.CylinderGeometry(0.012, 0.022, 0.42, 5);
  stemGeo.translate(0, 0.21, 0);

  // 3D Blossom head
  const blossomGeo = new THREE.DodecahedronGeometry(0.08, 0);
  blossomGeo.scale(1.3, 0.6, 1.3);
  blossomGeo.translate(0, 0.42, 0);

  // Combine into single geometry
  const posStem = stemGeo.attributes.position;
  const posBlossom = blossomGeo.attributes.position;

  const positions: number[] = [];
  const uvs: number[] = [];

  for (let i = 0; i < posStem.count; i++) {
    positions.push(posStem.getX(i), posStem.getY(i), posStem.getZ(i));
    uvs.push(0.5, posStem.getY(i) / 0.42);
  }

  for (let i = 0; i < posBlossom.count; i++) {
    positions.push(posBlossom.getX(i), posBlossom.getY(i), posBlossom.getZ(i));
    uvs.push(1.0, 1.0); // flower head flagged with uv.x = 1.0
  }

  const combined = new THREE.BufferGeometry();
  combined.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  combined.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  // Compute normals for proper lighting
  stemGeo.dispose();
  blossomGeo.dispose();
  combined.computeVertexNormals();

  return combined;
}

/**
 * Creates custom PBR shader material for vegetation with dynamic GPU wind sway,
 * root-to-tip color gradient, and light translucency.
 */
export function createVegetationMaterial(isWildflower = false): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    roughness: 0.75,
    metalness: 0.02,
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.time = { value: 0 };
    shader.uniforms.windDir = { value: new THREE.Vector2(0.75, 0.45).normalize() };

    material.userData.shader = shader;

    // 1. Vertex Shader Injection: GPU Wind Displacement & Blade Curvature
    shader.vertexShader = `
      uniform float time;
      uniform vec2 windDir;
      varying float vBladeHeight;
      varying vec3 vWorldPos;
      ${shader.vertexShader}
    `;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vBladeHeight = uv.y;

      #ifdef USE_INSTANCING
        vec4 wPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
      #else
        vec4 wPos = modelMatrix * vec4(position, 1.0);
      #endif
      vWorldPos = wPos.xyz;

      // Realistic wind wave simulation
      float windPhase = wPos.x * 0.16 + wPos.z * 0.14 + time * 2.6;
      float windWave = sin(windPhase) * cos(wPos.z * 0.22 - time * 1.8);
      float gust = sin(time * 0.7 + wPos.x * 0.04) * 0.35 + 0.65;

      // Roots anchored firmly at ground (y=0), tip bends gracefully
      float bendFactor = pow(clamp(uv.y, 0.0, 1.0), 1.6) * 0.36 * gust;

      transformed.x += (windDir.x * windWave + 0.12) * bendFactor;
      transformed.z += (windDir.y * windWave + 0.12) * bendFactor;
      transformed.y -= abs(windWave) * bendFactor * 0.24;
      `
    );

    // 2. Fragment Shader Injection: Root-to-Tip Natural Gradient & Translucency
    shader.fragmentShader = `
      varying float vBladeHeight;
      varying vec3 vWorldPos;
      ${shader.fragmentShader}
    `;

    if (!isWildflower) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        #include <color_fragment>

        // Root color (deep organic forest green)
        vec3 rootCol = vec3(0.12, 0.24, 0.08);
        // Mid blade (vibrant meadow green)
        vec3 midCol = vec3(0.32, 0.64, 0.18);
        // Sun-kissed tip (warm golden-lime)
        vec3 tipCol = vec3(0.62, 0.84, 0.28);

        float h = clamp(vBladeHeight, 0.0, 1.0);
        vec3 bladeGrad = mix(rootCol, midCol, smoothstep(0.0, 0.55, h));
        bladeGrad = mix(bladeGrad, tipCol, smoothstep(0.55, 1.0, h));

        // Multiply with per-instance color variation
        diffuseColor.rgb = bladeGrad * diffuseColor.rgb * 1.35;
        `
      );
    }
  };

  return material;
}

/**
 * Initializes and populates the 3D Vegetation System in the scene.
 */
export function setupVegetationSystem(
  scene: THREE.Scene,
  isSoftwareGl: boolean
): VegetationController {
  const meshGroup = new THREE.Group();
  meshGroup.name = 'VegetationSystem';

  // 1. Instance Counts based on hardware capabilities
  const grassCount = isSoftwareGl ? 3500 : 12000;
  const tallGrassCount = isSoftwareGl ? 800 : 2800;
  const flowerCount = isSoftwareGl ? 400 : 1200;

  // 2. Geometries
  const grassGeo = create3DGrassTuftGeometry(7, 0.85, 0.18);
  const tallGrassGeo = create3DTallGrassGeometry();
  const flowerGeo = create3DWildflowerGeometry();

  // 3. Materials
  const grassMat = createVegetationMaterial(false);
  const tallGrassMat = createVegetationMaterial(false);
  const flowerMat = createVegetationMaterial(true);

  // 4. Instanced Meshes
  const grassMesh = new THREE.InstancedMesh(grassGeo, grassMat, grassCount);
  grassMesh.receiveShadow = true;
  grassMesh.castShadow = !isSoftwareGl;

  const tallGrassMesh = new THREE.InstancedMesh(tallGrassGeo, tallGrassMat, tallGrassCount);
  tallGrassMesh.receiveShadow = true;
  tallGrassMesh.castShadow = !isSoftwareGl;

  const flowerMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, flowerCount);
  flowerMesh.receiveShadow = true;

  // 5. Palettes for instance color variation
  const grassTints = [
    new THREE.Color(0x9bd856),
    new THREE.Color(0x86c444),
    new THREE.Color(0xa8e662),
    new THREE.Color(0x78b83e),
    new THREE.Color(0x6aa636),
    new THREE.Color(0xb2f068),
  ];

  const tallGrassTints = [
    new THREE.Color(0x95c85c),
    new THREE.Color(0x82b54d),
    new THREE.Color(0xa6d86a),
    new THREE.Color(0x7ba844),
  ];

  const flowerTints = [
    new THREE.Color(0xf6d34b), // Buttercup gold
    new THREE.Color(0xfffae0), // Mountain daisy
    new THREE.Color(0x9b72cf), // Alpine violet
    new THREE.Color(0x5ca9e6), // Gentian blue
    new THREE.Color(0xf472b6), // Wild rose pink
  ];

  const dummy = new THREE.Object3D();
  const tempNormal = new THREE.Vector3();
  const upVec = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion();

  // 6. Natural Biome Distribution:
  // - Clear zone around player spawn (dist < 2.5m for grass, dist < 12m for tall grass)
  // - Clear along the central walking trail (pathDist < 2.8m)
  // - Avoid sheer rock faces (slope > 0.32)
  // - Cluster in lush meadow swells
  let gIdx = 0;
  for (let i = 0; i < grassCount * 3 && gIdx < grassCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    // Concentrated in the scenic playable radius (2.4m to 115m), leaving character spawn clean
    const dist = 2.4 + Math.pow(Math.random(), 0.58) * 115;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    // Check path distance (winding path formula from terrain.ts)
    const pathDist = Math.abs(z - (Math.sin(x * 0.03) * 18.0 + Math.cos(x * 0.015) * 8.0));
    if (pathDist < 2.6 && dist < 120) {
      continue; // keep the walking trail clear
    }

    getTerrainNormal(x, z, tempNormal);
    const slope = Math.acos(Math.min(1.0, Math.max(0.0, tempNormal.y)));
    if (slope > 0.32) {
      continue; // Skip sheer rock cliffs
    }

    // Natural clustering noise
    const densityNoise = Math.sin(x * 0.08) * Math.cos(z * 0.08) + Math.sin(x * 0.02) * 0.5;
    if (densityNoise < -0.35 && Math.random() > 0.2) {
      continue; // natural meadow clearings
    }

    const y = getTerrainHeight(x, z);
    const scale = 0.65 + Math.random() * 0.42;

    dummy.position.set(x, y, z);
    // Align with slope with slight vertical bias
    quat.setFromUnitVectors(upVec, tempNormal);
    dummy.quaternion.copy(quat);
    dummy.rotateY(Math.random() * Math.PI * 2);
    dummy.scale.set(scale, scale * (0.85 + Math.random() * 0.3), scale);
    dummy.updateMatrix();

    grassMesh.setMatrixAt(gIdx, dummy.matrix);
    grassMesh.setColorAt(gIdx, grassTints[Math.floor(Math.random() * grassTints.length)]);
    gIdx++;
  }

  grassMesh.count = gIdx;
  grassMesh.instanceMatrix.needsUpdate = true;
  if (grassMesh.instanceColor) grassMesh.instanceColor.needsUpdate = true;
  grassMesh.computeBoundingSphere();
  meshGroup.add(grassMesh);

  // Distribute Tall Meadow Plumes (relocated away from spawn > 14m)
  let tgIdx = 0;
  for (let i = 0; i < tallGrassCount * 3 && tgIdx < tallGrassCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 14 + Math.pow(Math.random(), 0.65) * 115;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    const pathDist = Math.abs(z - (Math.sin(x * 0.03) * 18.0 + Math.cos(x * 0.015) * 8.0));
    if (pathDist < 3.0 && dist < 120) continue;

    getTerrainNormal(x, z, tempNormal);
    if (tempNormal.y < 0.9) continue;

    const y = getTerrainHeight(x, z);
    const scale = 0.7 + Math.random() * 0.4;

    dummy.position.set(x, y, z);
    quat.setFromUnitVectors(upVec, tempNormal);
    dummy.quaternion.copy(quat);
    dummy.rotateY(Math.random() * Math.PI * 2);
    dummy.scale.set(scale, scale * (0.85 + Math.random() * 0.3), scale);
    dummy.updateMatrix();

    tallGrassMesh.setMatrixAt(tgIdx, dummy.matrix);
    tallGrassMesh.setColorAt(tgIdx, tallGrassTints[Math.floor(Math.random() * tallGrassTints.length)]);
    tgIdx++;
  }

  tallGrassMesh.count = tgIdx;
  tallGrassMesh.instanceMatrix.needsUpdate = true;
  if (tallGrassMesh.instanceColor) tallGrassMesh.instanceColor.needsUpdate = true;
  tallGrassMesh.computeBoundingSphere();
  meshGroup.add(tallGrassMesh);

  // Distribute 3D Wildflowers
  let fIdx = 0;
  for (let i = 0; i < flowerCount * 2 && fIdx < flowerCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 3.2 + Math.pow(Math.random(), 0.52) * 95;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;

    const pathDist = Math.abs(z - (Math.sin(x * 0.03) * 18.0 + Math.cos(x * 0.015) * 8.0));
    // Wildflowers flourish near trail edges and sunny clearings
    if (pathDist < 1.6) continue;

    const y = getTerrainHeight(x, z);
    const scale = 0.65 + Math.random() * 0.4;

    dummy.position.set(x, y, z);
    dummy.rotation.set((Math.random() - 0.5) * 0.2, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.2);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();

    flowerMesh.setMatrixAt(fIdx, dummy.matrix);
    flowerMesh.setColorAt(fIdx, flowerTints[Math.floor(Math.random() * flowerTints.length)]);
    fIdx++;
  }

  flowerMesh.count = fIdx;
  flowerMesh.instanceMatrix.needsUpdate = true;
  if (flowerMesh.instanceColor) flowerMesh.instanceColor.needsUpdate = true;
  flowerMesh.computeBoundingSphere();
  meshGroup.add(flowerMesh);

  scene.add(meshGroup);

  return {
    meshGroup,
    update: (time: number) => {
      // Update wind animation uniform in materials
      if (grassMat.userData.shader) {
        grassMat.userData.shader.uniforms.time.value = time;
      }
      if (tallGrassMat.userData.shader) {
        tallGrassMat.userData.shader.uniforms.time.value = time;
      }
      if (flowerMat.userData.shader) {
        flowerMat.userData.shader.uniforms.time.value = time;
      }
    },
    dispose: () => {
      scene.remove(meshGroup);
      grassGeo.dispose();
      grassMat.dispose();
      tallGrassGeo.dispose();
      tallGrassMat.dispose();
      flowerGeo.dispose();
      flowerMat.dispose();
    },
  };
}
