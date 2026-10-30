import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
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
  const hemiLight = new THREE.HemisphereLight(0xa9cdf0, 0x5a6a3e, 0.9);
  scene.add(hemiLight);

  // Key directional light (Golden sunlight)
  const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sunLight.position.set(65, 115, 55);
  sunLight.castShadow = !isSoftwareGl;
  if (!isSoftwareGl) {
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 280;
    const shadowDist = 48;
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

  // 5. Grass system (trees / rocks / flowers are streamed by their own systems, see trees.ts / props.ts)
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
  // Soft round sprite: PointsMaterial without a map renders hard-edged squares
  const dotCanvas = document.createElement('canvas');
  dotCanvas.width = dotCanvas.height = 32;
  const dctx = dotCanvas.getContext('2d')!;
  const dg = dctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  dg.addColorStop(0, 'rgba(255,255,255,1)');
  dg.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  dg.addColorStop(1, 'rgba(255,255,255,0)');
  dctx.fillStyle = dg;
  dctx.fillRect(0, 0, 32, 32);
  const dotTex = new THREE.CanvasTexture(dotCanvas);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  const particleMat = new THREE.PointsMaterial({
    map: dotTex,
    color: 0xfff0c8,
    size: 0.12,
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
      scene.remove(particleSystem);

      skyGeo.dispose();
      skyMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      dotTex.dispose();
    },
  };
}
