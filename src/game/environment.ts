import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getTerrainHeight } from './terrain';
import { createBarkTexture, createRockTexture } from './proceduralTextures';
import { setupVegetationSystem } from './vegetation';

export interface EnvironmentController {
  update: (playerPos: THREE.Vector3, time: number) => void;
  dispose: () => void;
}

export function setupEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  isSoftwareGl: boolean
): EnvironmentController {
  // 1. Procedural Studio Environment Reflection
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnv = new RoomEnvironment();
  scene.environment = pmremGenerator.fromScene(roomEnv, 0.04).texture;
  roomEnv.dispose();
  pmremGenerator.dispose();

  // 2. Horizon Fog matching atmospheric horizon
  const fogColor = new THREE.Color(0xaec7dc);
  scene.background = fogColor;
  scene.fog = new THREE.FogExp2(fogColor.getHex(), 0.0048);

  // 3. Cinematic Atmospheric Sky Dome with Procedural Sun Disc & Drifting Clouds
  const skyGeo = new THREE.SphereGeometry(460, 36, 28);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x2d6db0) },
      horizonColor: { value: new THREE.Color(0xbfd7eb) },
      sunColor: { value: new THREE.Color(0xfff6dc) },
      sunDirection: { value: new THREE.Vector3(0.55, 0.65, 0.45).normalize() },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      uniform float time;
      varying vec3 vWorldPosition;

      // Hash & 2D value noise for procedural clouds
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 4; i++) {
          v += a * noise(p);
          p *= 2.05;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 dir = normalize(vWorldPosition);
        float h = max(dir.y, 0.0);

        // Rayleigh sky gradient
        float gradient = pow(h, 0.55);
        vec3 sky = mix(horizonColor, topColor, gradient);

        // Solar Disc & Mie scattering halo
        float sunDot = max(dot(dir, sunDirection), 0.0);
        float sunDisc = step(0.9993, sunDot);
        float sunHalo = pow(sunDot, 128.0) * 1.5 + pow(sunDot, 16.0) * 0.35;
        sky += sunColor * (sunDisc * 2.2 + sunHalo);

        // Procedural drifting clouds in upper sky
        if (dir.y > 0.04) {
          vec2 cloudUV = dir.xz / (dir.y + 0.15) * 0.45 + vec2(time * 0.004, time * 0.002);
          float cloudDensity = fbm(cloudUV);
          cloudDensity = smoothstep(0.48, 0.72, cloudDensity);
          float cloudFade = smoothstep(0.04, 0.35, dir.y);
          vec3 cloudColor = mix(vec3(0.95, 0.96, 1.0), vec3(1.0, 0.98, 0.92), sunDot * 0.5);
          sky = mix(sky, cloudColor, cloudDensity * cloudFade * 0.7);
        }

        gl_FragColor = vec4(sky, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  scene.add(skyMesh);

  // 4. Balanced Daylight Rig
  // Hemisphere light: clear azure sky fill + warm meadow earth bounce
  const hemiLight = new THREE.HemisphereLight(0x9eccf8, 0x485834, 1.05);
  scene.add(hemiLight);

  // Key directional light (Golden sunlight)
  const sunLight = new THREE.DirectionalLight(0xfffaec, 2.4);
  sunLight.position.set(65, 115, 55);
  sunLight.castShadow = !isSoftwareGl;
  if (!isSoftwareGl) {
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 280;
    const shadowDist = 55;
    sunLight.shadow.camera.left = -shadowDist;
    sunLight.shadow.camera.right = shadowDist;
    sunLight.shadow.camera.top = shadowDist;
    sunLight.shadow.camera.bottom = -shadowDist;
    sunLight.shadow.bias = -0.0003;
    sunLight.shadow.normalBias = 0.025;
  }
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Soft sky ambient bounce
  const fillLight = new THREE.DirectionalLight(0x88a8c4, 0.7);
  fillLight.position.set(-60, 45, -60);
  scene.add(fillLight);

  // 5. Instanced High-Fidelity 3D Conifer Pines (Multi-Tier Layered Needles & Flared Bark Trunk)
  const pineCount = 240;
  const pineTrunkMain = new THREE.CylinderGeometry(0.24, 0.48, 3.8, 8);
  pineTrunkMain.translate(0, 1.9, 0);
  const pineRootFlare = new THREE.CylinderGeometry(0.48, 0.72, 0.6, 8);
  pineRootFlare.translate(0, 0.3, 0);
  const pineTrunkGeo = mergeGeometries([pineTrunkMain, pineRootFlare])!;
  pineTrunkGeo.computeVertexNormals();
  pineTrunkMain.dispose();
  pineRootFlare.dispose();

  const pineTrunkTex = createBarkTexture();
  const pineTrunkMat = new THREE.MeshStandardMaterial({
    map: pineTrunkTex,
    roughness: 0.9,
    metalness: 0.02,
  });
  const pineTrunkMesh = new THREE.InstancedMesh(pineTrunkGeo, pineTrunkMat, pineCount);
  pineTrunkMesh.castShadow = !isSoftwareGl;
  pineTrunkMesh.receiveShadow = true;

  // 4 Overlapping tiered needle skirts with realistic conical overhang
  const pTier1 = new THREE.ConeGeometry(2.8, 2.2, 8); pTier1.translate(0, 2.8, 0);
  const pTier2 = new THREE.ConeGeometry(2.3, 1.9, 8); pTier2.translate(0, 4.1, 0);
  const pTier3 = new THREE.ConeGeometry(1.8, 1.7, 8); pTier3.translate(0, 5.3, 0);
  const pTier4 = new THREE.ConeGeometry(1.2, 1.5, 8); pTier4.translate(0, 6.4, 0);
  const pineFoliageGeo = mergeGeometries([pTier1, pTier2, pTier3, pTier4])!;
  pineFoliageGeo.computeVertexNormals();
  pTier1.dispose();
  pTier2.dispose();
  pTier3.dispose();
  pTier4.dispose();

  const pineFoliageMat = new THREE.MeshStandardMaterial({
    color: 0x224c26,
    roughness: 0.85,
    metalness: 0.04,
    flatShading: true,
  });
  const pineFoliageMesh = new THREE.InstancedMesh(pineFoliageGeo, pineFoliageMat, pineCount);
  pineFoliageMesh.castShadow = !isSoftwareGl;
  pineFoliageMesh.receiveShadow = true;

  // 6. Instanced High-Fidelity 3D Broadleaf Trees (Sculpted Branching Trunk & Multi-Cluster Organic Canopy)
  const oakCount = 120;
  const oakTrunkBase = new THREE.CylinderGeometry(0.36, 0.62, 3.2, 8); oakTrunkBase.translate(0, 1.6, 0);
  const oakRootFlare = new THREE.CylinderGeometry(0.62, 0.88, 0.5, 8); oakRootFlare.translate(0, 0.25, 0);
  const oakBough1 = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 7);
  oakBough1.rotateZ(-0.38); oakBough1.rotateX(0.12); oakBough1.translate(0.65, 3.2, 0.15);
  const oakBough2 = new THREE.CylinderGeometry(0.20, 0.30, 2.0, 7);
  oakBough2.rotateZ(0.40); oakBough2.rotateX(-0.18); oakBough2.translate(-0.62, 3.3, -0.2);
  const oakBough3 = new THREE.CylinderGeometry(0.18, 0.26, 1.8, 7);
  oakBough3.rotateX(0.38); oakBough3.translate(0.1, 3.4, 0.6);
  const oakTrunkGeo = mergeGeometries([oakTrunkBase, oakRootFlare, oakBough1, oakBough2, oakBough3])!;
  oakTrunkGeo.computeVertexNormals();
  oakTrunkBase.dispose();
  oakRootFlare.dispose();
  oakBough1.dispose();
  oakBough2.dispose();
  oakBough3.dispose();

  const oakTrunkMat = new THREE.MeshStandardMaterial({
    map: pineTrunkTex,
    roughness: 0.88,
    metalness: 0.04,
  });
  const oakTrunkMesh = new THREE.InstancedMesh(oakTrunkGeo, oakTrunkMat, oakCount);
  oakTrunkMesh.castShadow = !isSoftwareGl;
  oakTrunkMesh.receiveShadow = true;

  // Multi-cluster volumetric canopy with 5 interpenetrating foliage clusters
  const cCenter = new THREE.DodecahedronGeometry(2.3, 1); cCenter.translate(0, 5.2, 0);
  const c1 = new THREE.DodecahedronGeometry(1.8, 1); c1.translate(1.4, 4.6, 0.4);
  const c2 = new THREE.DodecahedronGeometry(1.7, 1); c2.translate(-1.3, 4.7, -0.4);
  const c3 = new THREE.DodecahedronGeometry(1.6, 1); c3.translate(0.2, 4.8, 1.3);
  const cTop = new THREE.DodecahedronGeometry(1.5, 1); cTop.translate(-0.1, 6.2, 0.1);
  const oakCanopyGeo = mergeGeometries([cCenter, c1, c2, c3, cTop])!;
  oakCanopyGeo.computeVertexNormals();
  cCenter.dispose();
  c1.dispose();
  c2.dispose();
  c3.dispose();
  cTop.dispose();

  const oakCanopyMat = new THREE.MeshStandardMaterial({
    color: 0x3d7428,
    roughness: 0.82,
    metalness: 0.03,
    flatShading: true,
  });
  const oakCanopyMesh = new THREE.InstancedMesh(oakCanopyGeo, oakCanopyMat, oakCount);
  oakCanopyMesh.castShadow = !isSoftwareGl;
  oakCanopyMesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  const pineColors = [
    new THREE.Color(0x245228),
    new THREE.Color(0x1a421f),
    new THREE.Color(0x2c6230),
    new THREE.Color(0x1d3d20),
    new THREE.Color(0x356e39),
  ];

  const oakColors = [
    new THREE.Color(0x4a822f),
    new THREE.Color(0x3b6f24),
    new THREE.Color(0x569637),
    new THREE.Color(0x386121),
  ];

  // Distribute Pines
  let pineIdx = 0;
  for (let i = 0; i < pineCount * 2 && pineIdx < pineCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 14 + Math.pow(Math.random(), 0.7) * 140;
    const tx = Math.cos(angle) * dist;
    const tz = Math.sin(angle) * dist;
    const ty = getTerrainHeight(tx, tz);

    const sY = 0.85 + Math.random() * 0.45;
    const sXZ = 0.85 + Math.random() * 0.35;

    dummy.position.set(tx, ty, tz);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    dummy.scale.set(sXZ, sY, sXZ);
    dummy.updateMatrix();

    pineTrunkMesh.setMatrixAt(pineIdx, dummy.matrix);
    pineFoliageMesh.setMatrixAt(pineIdx, dummy.matrix);
    pineFoliageMesh.setColorAt(pineIdx, pineColors[Math.floor(Math.random() * pineColors.length)]);
    pineIdx++;
  }
  pineTrunkMesh.instanceMatrix.needsUpdate = true;
  pineFoliageMesh.instanceMatrix.needsUpdate = true;
  if (pineFoliageMesh.instanceColor) pineFoliageMesh.instanceColor.needsUpdate = true;
  pineTrunkMesh.computeBoundingSphere();
  pineFoliageMesh.computeBoundingSphere();
  scene.add(pineTrunkMesh);
  scene.add(pineFoliageMesh);

  // Distribute Oaks
  let oakIdx = 0;
  for (let i = 0; i < oakCount * 2 && oakIdx < oakCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 18 + Math.pow(Math.random(), 0.65) * 135;
    const tx = Math.cos(angle) * dist;
    const tz = Math.sin(angle) * dist;
    const ty = getTerrainHeight(tx, tz);

    const s = 0.85 + Math.random() * 0.4;
    dummy.position.set(tx, ty, tz);
    dummy.rotation.y = Math.random() * Math.PI * 2;
    dummy.scale.set(s, s * (0.9 + Math.random() * 0.25), s);
    dummy.updateMatrix();

    oakTrunkMesh.setMatrixAt(oakIdx, dummy.matrix);
    oakCanopyMesh.setMatrixAt(oakIdx, dummy.matrix);
    oakCanopyMesh.setColorAt(oakIdx, oakColors[Math.floor(Math.random() * oakColors.length)]);
    oakIdx++;
  }
  oakTrunkMesh.instanceMatrix.needsUpdate = true;
  oakCanopyMesh.instanceMatrix.needsUpdate = true;
  if (oakCanopyMesh.instanceColor) oakCanopyMesh.instanceColor.needsUpdate = true;
  oakTrunkMesh.computeBoundingSphere();
  oakCanopyMesh.computeBoundingSphere();
  scene.add(oakTrunkMesh);
  scene.add(oakCanopyMesh);

  // 7. Instanced Boulders & Rock Outcrops
  const rockCount = 200;
  const rockGeo = new THREE.DodecahedronGeometry(1.5, 1);
  const rockPosAttr = rockGeo.attributes.position;
  for (let i = 0; i < rockPosAttr.count; i++) {
    const vy = rockPosAttr.getY(i);
    if (vy < 0) rockPosAttr.setY(i, vy * 0.6);
  }
  rockGeo.computeVertexNormals();

  const { diffuse: rockDiff, normal: rockNorm } = createRockTexture();
  const rockMat = new THREE.MeshStandardMaterial({
    map: rockDiff,
    normalMap: rockNorm,
    roughness: 0.85,
    metalness: 0.08,
    flatShading: true,
  });

  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rockMesh.castShadow = !isSoftwareGl;
  rockMesh.receiveShadow = true;

  const rockColors = [
    new THREE.Color(0x82888e),
    new THREE.Color(0x6a7076),
    new THREE.Color(0x9aa1a8),
    new THREE.Color(0x54595e),
  ];

  let rockIdx = 0;
  for (let i = 0; i < rockCount * 2 && rockIdx < rockCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 8 + Math.pow(Math.random(), 0.6) * 145;
    const rx = Math.cos(angle) * dist;
    const rz = Math.sin(angle) * dist;
    const ry = getTerrainHeight(rx, rz);

    const s = 0.6 + Math.random() * 1.7;
    dummy.position.set(rx, ry + 0.35 * s, rz);
    dummy.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.4);
    dummy.scale.set(s * (0.85 + Math.random() * 0.35), s, s * (0.85 + Math.random() * 0.35));
    dummy.updateMatrix();

    rockMesh.setMatrixAt(rockIdx, dummy.matrix);
    rockMesh.setColorAt(rockIdx, rockColors[Math.floor(Math.random() * rockColors.length)]);
    rockIdx++;
  }
  rockMesh.instanceMatrix.needsUpdate = true;
  if (rockMesh.instanceColor) rockMesh.instanceColor.needsUpdate = true;
  rockMesh.computeBoundingSphere();
  scene.add(rockMesh);

  // 8. High-Quality 3D Volumetric Vegetation System (Curved 3D Grass Tufts, Meadow Plumes & 3D Wildflowers)
  const vegetation = setupVegetationSystem(scene, isSoftwareGl);

  // 9. Floating Airborne Motes / Pollen in Sunlight
  const particleCount = 140;
  const particleGeo = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    particlePositions[i * 3] = (Math.random() - 0.5) * 45;
    particlePositions[i * 3 + 1] = 0.5 + Math.random() * 10;
    particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 45;
  }
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  const particleMat = new THREE.PointsMaterial({
    color: 0xfff0c8,
    size: 0.18,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const particleSystem = new THREE.Points(particleGeo, particleMat);
  scene.add(particleSystem);

  return {
    update: (playerPos: THREE.Vector3, time: number) => {
      // Dynamic sunlight & shadow cascade tracking
      sunLight.position.set(playerPos.x + 50, playerPos.y + 85, playerPos.z + 45);
      sunLight.target.position.set(playerPos.x, playerPos.y, playerPos.z);
      sunLight.target.updateMatrixWorld();

      // Sky shader time update for slow cloud drift
      skyMat.uniforms.time.value = time;

      // Wrap atmospheric particles around player
      particleSystem.position.set(playerPos.x, playerPos.y, playerPos.z);

      // Animate 3D vegetation wind simulation
      vegetation.update(time, playerPos);
    },
    dispose: () => {
      vegetation.dispose();

      scene.remove(skyMesh);
      scene.remove(hemiLight);
      scene.remove(sunLight);
      scene.remove(fillLight);
      scene.remove(pineTrunkMesh);
      scene.remove(pineFoliageMesh);
      scene.remove(oakTrunkMesh);
      scene.remove(oakCanopyMesh);
      scene.remove(rockMesh);
      scene.remove(particleSystem);

      skyGeo.dispose();
      skyMat.dispose();
      pineTrunkGeo.dispose();
      pineTrunkMat.dispose();
      pineFoliageGeo.dispose();
      pineFoliageMat.dispose();
      oakTrunkGeo.dispose();
      oakTrunkMat.dispose();
      oakCanopyGeo.dispose();
      oakCanopyMat.dispose();
      rockGeo.dispose();
      rockMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
    },
  };
}
