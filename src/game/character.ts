import * as THREE from 'three';
import { getTerrainHeight, getTerrainNormal } from './terrain';
import { resolveCollisions } from './world';
import { loadPlayerModel, type PlayerModel } from './playerModel';

import type { AraCharacterInstance } from '../ara3d/araManager';

export interface CharacterController {
  group: THREE.Group;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotationY: number;
  isMoving: boolean;
  isSprinting: boolean;
  isGrounded: boolean;
  gaitPhase: number;
  /** Resolves once the model is instanced in the scene; rejects if it cannot be loaded. */
  ready: Promise<void>;
  /** True when a visible, skinned body is actually attached to the scene graph. */
  isRenderable: () => boolean;
  setCustomAvatar: (avatar: AraCharacterInstance) => void;
  update: (delta: number, moveInput: { x: number; y: number }, sprint: boolean, jump: boolean) => void;
  dispose: () => void;
}

export function createCharacter(isSoftwareGl: boolean): CharacterController {
  let disposed = false;
  const group = new THREE.Group();
  group.name = 'player';

  // Soft contact shadow beneath feet
  const shadowGeo = new THREE.PlaneGeometry(1.6, 1.6);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 128;
  shadowCanvas.height = 128;
  const sCtx = shadowCanvas.getContext('2d')!;
  const sGrad = sCtx.createRadialGradient(64, 64, 8, 64, 64, 60);
  sGrad.addColorStop(0, 'rgba(0, 0, 0, 0.7)');
  sGrad.addColorStop(0.6, 'rgba(0, 0, 0, 0.25)');
  sGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  sCtx.fillStyle = sGrad;
  sCtx.fillRect(0, 0, 128, 128);
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = 0.02;
  group.add(shadowMesh);

  // Actor container (handles rotation, tilt, and mesh hierarchy)
  const actor = new THREE.Group();
  group.add(actor);

  // Kinematic & Animation State
  const position = new THREE.Vector3(0, 0, 0);
  const velocity = new THREE.Vector3();
  let verticalVelocity = 0;
  let rotationY = 0;
  let targetRotationY = 0;
  let currentBank = 0;
  let gaitPhase = 0;
  let isGrounded = true;
  let isMoving = false;
  let isSprinting = false;
  let landVy = 0;

  // Math helpers allocated once at module/scope level
  const normalHelper = new THREE.Vector3();
  const upVector = new THREE.Vector3(0, 1, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const qYaw = new THREE.Quaternion();
  const qSlope = new THREE.Quaternion();
  const qBank = new THREE.Quaternion();

  // Initial positioning on terrain
  position.y = getTerrainHeight(position.x, position.z);
  group.position.copy(position);
  let customAvatar: AraCharacterInstance | null = null;

  // Player model (async). There is no stand-in body: if the GLB fails, `ready` rejects and the loader reports it.
  let playerModel: PlayerModel | null = null;
  const ready: Promise<void> = loadPlayerModel(isSoftwareGl).then((m) => {
    if (disposed) {
      m.dispose();
      return;
    }
    playerModel = m;
    m.root.visible = !customAvatar;
    actor.add(m.root);
  });
  // Avoid an unhandled-rejection warning when nobody awaits `ready` (e.g. disposed early); the engine awaits it.
  ready.catch(() => {});

  return {
    group,
    position,
    ready,
    isRenderable: () => !!customAvatar || (!!playerModel && playerModel.root.visible && playerModel.root.parent === actor && playerModel.skinnedMeshCount > 0),
    velocity,
    get rotationY() {
      return rotationY;
    },
    set rotationY(v) {
      rotationY = v;
      targetRotationY = v;
    },
    get isMoving() {
      return isMoving;
    },
    get isSprinting() {
      return isSprinting;
    },
    get isGrounded() {
      return isGrounded;
    },
    get gaitPhase() {
      return gaitPhase;
    },
    setCustomAvatar: (avatar: AraCharacterInstance) => {
      if (customAvatar) {
        actor.remove(customAvatar.group);
        customAvatar.dispose();
      }
      customAvatar = avatar;
      if (playerModel) playerModel.root.visible = false;
      avatar.group.position.set(0, 0, 0);
      actor.add(avatar.group);
    },

    update: (delta: number, moveInput: { x: number; y: number }, sprint: boolean, jump: boolean) => {
      const dt = Math.min(delta, 0.05);

      const inputLen = Math.sqrt(moveInput.x * moveInput.x + moveInput.y * moveInput.y);
      isMoving = inputLen > 0.05;
      isSprinting = sprint && isMoving;

      // Base locomotion speeds
      const walkSpeed = 5.2;
      const sprintSpeed = 10.4;
      const targetSpeed = isSprinting ? sprintSpeed : walkSpeed;

      if (isMoving) {
        // Move direction in world space (normalized)
        const moveDirX = moveInput.x / inputLen;
        const moveDirZ = moveInput.y / inputLen;

        // Smooth acceleration with responsive damping
        velocity.x = THREE.MathUtils.damp(velocity.x, moveDirX * targetSpeed * inputLen, 12, dt);
        velocity.z = THREE.MathUtils.damp(velocity.z, moveDirZ * targetSpeed * inputLen, 12, dt);

        // Smooth rotation towards travel vector (atan2(x, z))
        targetRotationY = Math.atan2(moveDirX, moveDirZ);

        // Shortest angle difference wrap
        let diff = targetRotationY - rotationY;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // Smooth angular interpolation
        rotationY += diff * Math.min(1.0, dt * 11);

        // Natural banking tilt into curves proportional to angular turn rate
        const turnRate = diff / Math.max(dt, 0.001);
        const targetBank = THREE.MathUtils.clamp(-turnRate * 0.045, -0.14, 0.14);
        currentBank = THREE.MathUtils.damp(currentBank, targetBank, 10, dt);
      } else {
        // Smooth natural deceleration (no sudden snap or continuous drift)
        velocity.x = THREE.MathUtils.damp(velocity.x, 0, 12, dt);
        velocity.z = THREE.MathUtils.damp(velocity.z, 0, 12, dt);
        currentBank = THREE.MathUtils.damp(currentBank, 0, 10, dt);
      }

      // Apply horizontal displacement, then push out of trunks/rocks and keep inside the playable disc
      position.x += velocity.x * dt;
      position.z += velocity.z * dt;
      resolveCollisions(position);

      // Jump & Gravity mechanics (ground height is sampled after the horizontal move)
      const groundY = getTerrainHeight(position.x, position.z);
      if (isGrounded) {
        if (jump) {
          verticalVelocity = 7.6;
          isGrounded = false;
        } else {
          verticalVelocity = 0;
          position.y = groundY;
        }
      } else {
        verticalVelocity -= 22.0 * dt; // Gravity
        position.y += verticalVelocity * dt;
        if (position.y <= groundY) {
          position.y = groundY;
          landVy = verticalVelocity; // remembered for the landing animation
          verticalVelocity = 0;
          isGrounded = true;
        }
      }

      // Update character root transform
      group.position.set(position.x, position.y, position.z);

      // --- DETERMINISTIC ROTATION & ORIENTATION FIX ---
      // 1. Yaw orientation around vertical world Y
      qYaw.setFromAxisAngle(yAxis, rotationY);

      // 2. Dynamic banking roll around local Z (leaning into turns)
      qBank.setFromAxisAngle(zAxis, currentBank);

      // 3. Subtle slope alignment from terrain normal (clamped to prevent extreme tilt)
      getTerrainNormal(position.x, position.z, normalHelper);
      const slopeTilt = Math.acos(Math.min(1.0, Math.max(0.0, normalHelper.y)));
      if (slopeTilt > 0.01) {
        // Damp slope influence to keep character predominantly upright
        const clampedNormal = normalHelper.clone().lerp(upVector, 0.65).normalize();
        qSlope.setFromUnitVectors(upVector, clampedNormal);
      } else {
        qSlope.identity();
      }

      // 4. Clean, deterministic composite orientation:
      // actor.quaternion = qSlope * qYaw * qBank
      // This completely solves the cross-axis compounding/sideways twisting bug!
      actor.quaternion.copy(qSlope).multiply(qYaw).multiply(qBank);

      // Contact shadow update: scales & fades when jumping
      const heightAboveGround = Math.max(0, position.y - groundY);
      const shadowScale = Math.max(0.35, 1.0 - heightAboveGround * 0.15);
      shadowMesh.scale.set(shadowScale, shadowScale, shadowScale);
      shadowMat.opacity = Math.max(0.12, 0.65 - heightAboveGround * 0.2);

      // --- LOCOMOTION ANIMATION (CUSTOM ARA AVATAR OR PROCEDURAL FALLBACK) ---
      const groundSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);

      if (customAvatar) {
        const locomotionState: 'idle' | 'walk' | 'run' | 'jump' = !isGrounded
          ? 'jump'
          : groundSpeed > 0.15
          ? isSprinting
            ? 'run'
            : 'walk'
          : 'idle';

        customAvatar.updateAnimation(locomotionState, dt);

        if (isGrounded && groundSpeed > 0.15) {
          const strideLength = isSprinting ? 2.15 : 1.35;
          gaitPhase += (groundSpeed / strideLength) * Math.PI * 2 * dt;
        }
      } else if (playerModel) {
        playerModel.update(dt, { grounded: isGrounded, speed: groundSpeed, sprinting: isSprinting, vy: isGrounded ? landVy : verticalVelocity });
        landVy = 0;
        if (isGrounded && groundSpeed > 0.15) {
          const strideLength = isSprinting ? 2.15 : 1.35;
          gaitPhase += (groundSpeed / strideLength) * Math.PI * 2 * dt;
        }
      }
    },

    dispose: () => {
      disposed = true;
      playerModel?.dispose();
      playerModel = null;
      if (customAvatar) {
        customAvatar.dispose();
        customAvatar = null;
      }
      shadowGeo.dispose();
      shadowMat.dispose();
      shadowTex.dispose();
    },
  };
}
