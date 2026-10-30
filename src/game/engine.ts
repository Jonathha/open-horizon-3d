import * as THREE from 'three';
import { createTerrain } from './terrain';
import { setupEnvironment } from './environment';
import { createCharacter } from './character';
import { createThirdPersonCamera } from './camera';
import { InputManager } from './controls';
import { sound } from './audio';
import { setupTrees, type TreeSystem } from './trees';
import { setupProps, type PropsController } from './props';

import type { AraCharacterInstance } from '../ara3d/araManager';

export interface GameEngine {
  start: () => void;
  stop: () => void;
  resize: (width: number, height: number) => void;
  handlePointerDrag: (dx: number, dy: number) => void;
  handleZoom: (delta: number) => void;
  inputManager: InputManager;
  toggleAudio: () => boolean;
  isAudioMuted: () => boolean;
  setCustomAvatar: (avatar: AraCharacterInstance) => void;
  dispose: () => void;
}

export function initGameEngine(container: HTMLElement): GameEngine {
  // 1. Detect software WebGL per Three.js skill guidelines
  // `?hq` forces the full-quality path (shadows, MSAA, full densities) even on software renderers (used for testing)
  const forceHq = /[?&]hq\b/.test(window.location.search);
  const isSoftwareGl = !forceHq && (() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  })();

  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;

  // 2. Setup Three.js WebGL Renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  container.appendChild(renderer.domElement);

  // 3. Scene & Systems
  const scene = new THREE.Scene();

  // Terrain
  const terrain = createTerrain();
  scene.add(terrain.mesh);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  terrain.textures.forEach((tex) => {
    tex.anisotropy = maxAniso;
  });

  // Environment (Sky, lights, instanced trees, rocks, vegetation)
  const environment = setupEnvironment(scene, renderer, isSoftwareGl);

  // Trees (ez-tree) and GLB props (rocks, flowers) stream in asynchronously; failures are logged, never fatal
  let trees: TreeSystem | null = null;
  let props: PropsController | null = null;
  let disposed = false;
  setupTrees(scene, isSoftwareGl)
    .then((t) => (disposed ? t.dispose() : (trees = t)))
    .catch((e) => console.error('[engine] tree system failed to initialise', e));
  setupProps(scene, isSoftwareGl)
    .then((p) => (disposed ? p.dispose() : (props = p)))
    .catch((e) => console.error('[engine] props failed to initialise', e));

  // Character
  const character = createCharacter(isSoftwareGl);
  scene.add(character.group);

  // Third-person camera
  const tpCamera = createThirdPersonCamera(width / height);

  // Input manager
  const inputManager = new InputManager();

  // Audio system init on first user touch/action
  sound.init();

  // Pre-warm shaders
  if (!isSoftwareGl) {
    renderer.compile(scene, tpCamera.camera);
  }

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__oh = { renderer, scene, character, camera: tpCamera.camera, isSoftwareGl };
  }

  // Loop & Timing
  const timer = new THREE.Timer();
  let animationFrameId = 0;
  let isRunning = false;
  let lastGaitStep = 0;

  function afterDraw(cb: () => void) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        animationFrameId = window.setTimeout(poll, 5);
      } else {
        gl.deleteSync(sync);
        animationFrameId = window.setTimeout(cb, 80);
      }
    };
    animationFrameId = window.setTimeout(poll, 5);
  }

  function tick() {
    if (!isRunning) return;

    timer.update();
    const delta = timer.getDelta();

    // 1. Process movement inputs relative to camera perspective
    const { forward: camForward, right: camRight } = tpCamera.getHorizontalVectors();
    const { moveVector, sprint, jump } = inputManager.getMovementVector(camForward, camRight);

    // 2. Play jump sound if triggered
    if (jump && character.isGrounded) {
      sound.playJump();
    }

    // 3. Update character kinematics & animation
    character.update(delta, moveVector, sprint, jump);

    // 4. Synchronize procedural footstep sounds with gait cycle
    if (character.isGrounded && character.isMoving) {
      const currentStep = Math.floor(character.gaitPhase / Math.PI);
      if (currentStep !== lastGaitStep) {
        lastGaitStep = currentStep;
        sound.playFootstep(character.isSprinting);
      }
    }

    // 5. Update environment lighting & shadow cascades
    environment.update(character.position, timer.getElapsed());
    trees?.update(character.position);
    props?.update(character.position);

    // 6. Smooth third person camera tracking
    tpCamera.update(delta, character.position);

    // 7. Render frame
    renderer.render(scene, tpCamera.camera);

    // Pace loop per Three.js guidelines
    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      animationFrameId = requestAnimationFrame(tick);
    }
  }

  return {
    start: () => {
      if (isRunning) return;
      isRunning = true;
      timer.reset();
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        animationFrameId = requestAnimationFrame(tick);
      }
    },
    stop: () => {
      isRunning = false;
      cancelAnimationFrame(animationFrameId);
      clearTimeout(animationFrameId);
    },
    resize: (w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      tpCamera.camera.aspect = w / h;
      tpCamera.camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    },
    handlePointerDrag: (dx: number, dy: number) => {
      tpCamera.onPointerMove(dx, dy);
    },
    handleZoom: (delta: number) => {
      tpCamera.onZoom(delta);
    },
    inputManager,
    toggleAudio: () => sound.toggleMute(),
    isAudioMuted: () => sound.getMuted(),
    setCustomAvatar: (avatar: AraCharacterInstance) => {
      character.setCustomAvatar(avatar);
    },
    dispose: () => {
      disposed = true;
      trees?.dispose();
      props?.dispose();
      isRunning = false;
      cancelAnimationFrame(animationFrameId);
      clearTimeout(animationFrameId);

      inputManager.dispose();
      environment.dispose();
      character.dispose();
      terrain.materials.forEach((m) => m.dispose());
      terrain.textures.forEach((t) => t.dispose());
      terrain.disposeExtra();
      terrain.mesh.geometry.dispose();

      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    },
  };
}
