import * as THREE from 'three';
import { getTerrainHeight, getTerrainNormal } from './terrain';
import { createArmorTexture } from './proceduralTextures';

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
  setCustomAvatar: (avatar: AraCharacterInstance) => void;
  update: (delta: number, moveInput: { x: number; y: number }, sprint: boolean, jump: boolean) => void;
  dispose: () => void;
}

export function createCharacter(isSoftwareGl: boolean): CharacterController {
  const group = new THREE.Group();
  group.name = 'player';

  // Procedural Materials
  const { diffuse: armorDiff, normal: armorNorm } = createArmorTexture();

  // Dark slate cyber-armor
  const armorMat = new THREE.MeshStandardMaterial({
    map: armorDiff,
    normalMap: armorNorm,
    roughness: 0.35,
    metalness: 0.65,
    color: 0x242c3b,
  });

  // Matte under-suit / joints
  const underSuitMat = new THREE.MeshStandardMaterial({
    roughness: 0.8,
    metalness: 0.1,
    color: 0x14171d,
  });

  // Metallic accents & pauldrons
  const plateMat = new THREE.MeshStandardMaterial({
    roughness: 0.22,
    metalness: 0.92,
    color: 0x8a9ba8,
  });

  // Visor emissive glow
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x00d2ff,
    emissive: 0x00b4d8,
    emissiveIntensity: 2.0,
    roughness: 0.1,
    metalness: 0.2,
  });

  // Accent emissive reactor
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 2.4,
    roughness: 0.2,
  });

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

  // --- Pelvis / Hips ---
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.95;
  actor.add(pelvis);

  const pelvisMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.24), armorMat);
  pelvisMesh.castShadow = !isSoftwareGl;
  pelvis.add(pelvisMesh);

  // Belt / pouch details
  const beltMesh = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.06, 0.26), plateMat);
  pelvis.add(beltMesh);

  // --- Torso / Chest ---
  const spine = new THREE.Group();
  spine.position.y = 0.16;
  pelvis.add(spine);

  const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.42, 0.28), armorMat);
  torsoMesh.position.y = 0.22;
  torsoMesh.castShadow = !isSoftwareGl;
  spine.add(torsoMesh);

  // Chest armor reinforcement plate
  const chestPlate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.08), plateMat);
  chestPlate.position.set(0, 0.24, 0.13);
  chestPlate.castShadow = !isSoftwareGl;
  spine.add(chestPlate);

  // Power core reactor
  const coreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.06, 12), coreMat);
  coreMesh.rotateX(Math.PI / 2);
  coreMesh.position.set(0, 0.26, 0.17);
  spine.add(coreMesh);

  // Backpack battery unit
  const backpackMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.12), plateMat);
  backpackMesh.position.set(0, 0.24, -0.16);
  backpackMesh.castShadow = !isSoftwareGl;
  spine.add(backpackMesh);

  // --- Neck & Head ---
  const neck = new THREE.Group();
  neck.position.y = 0.45;
  spine.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.y = 0.12;
  neck.add(headGroup);

  // Helmet
  const helmetMesh = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.26, 0.26), armorMat);
  helmetMesh.castShadow = !isSoftwareGl;
  headGroup.add(helmetMesh);

  // Visor
  const visorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.06), visorMat);
  visorMesh.position.set(0, 0.02, 0.125);
  headGroup.add(visorMesh);

  // Helmet crest
  const crestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.24), plateMat);
  crestMesh.position.set(0, 0.14, -0.01);
  headGroup.add(crestMesh);

  // --- Shoulders and Arms ---
  // Left Arm
  const leftShoulder = new THREE.Group();
  leftShoulder.position.set(-0.28, 0.38, 0);
  spine.add(leftShoulder);

  const leftPauldron = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.18), plateMat);
  leftPauldron.position.set(-0.02, 0.02, 0);
  leftPauldron.castShadow = !isSoftwareGl;
  leftShoulder.add(leftPauldron);

  const leftUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.28, 8), underSuitMat);
  leftUpperArm.position.y = -0.15;
  leftUpperArm.castShadow = !isSoftwareGl;
  leftShoulder.add(leftUpperArm);

  const leftElbow = new THREE.Group();
  leftElbow.position.y = -0.28;
  leftShoulder.add(leftElbow);

  const leftLowerArm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.11), armorMat);
  leftLowerArm.position.y = -0.12;
  leftLowerArm.castShadow = !isSoftwareGl;
  leftElbow.add(leftLowerArm);

  // Right Arm
  const rightShoulder = new THREE.Group();
  rightShoulder.position.set(0.28, 0.38, 0);
  spine.add(rightShoulder);

  const rightPauldron = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.18), plateMat);
  rightPauldron.position.set(0.02, 0.02, 0);
  rightPauldron.castShadow = !isSoftwareGl;
  rightShoulder.add(rightPauldron);

  const rightUpperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.28, 8), underSuitMat);
  rightUpperArm.position.y = -0.15;
  rightUpperArm.castShadow = !isSoftwareGl;
  rightShoulder.add(rightUpperArm);

  const rightElbow = new THREE.Group();
  rightElbow.position.y = -0.28;
  rightShoulder.add(rightElbow);

  const rightLowerArm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.11), armorMat);
  rightLowerArm.position.y = -0.12;
  rightLowerArm.castShadow = !isSoftwareGl;
  rightElbow.add(rightLowerArm);

  // --- Legs ---
  // Left Leg
  const leftHip = new THREE.Group();
  leftHip.position.set(-0.14, -0.06, 0);
  pelvis.add(leftHip);

  const leftUpperLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.42, 8), underSuitMat);
  leftUpperLeg.position.y = -0.21;
  leftUpperLeg.castShadow = !isSoftwareGl;
  leftHip.add(leftUpperLeg);

  const leftThighArmor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.18), armorMat);
  leftThighArmor.position.set(0, -0.18, 0.02);
  leftThighArmor.castShadow = !isSoftwareGl;
  leftHip.add(leftThighArmor);

  const leftKnee = new THREE.Group();
  leftKnee.position.y = -0.42;
  leftHip.add(leftKnee);

  const leftLowerLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.42, 8), underSuitMat);
  leftLowerLeg.position.y = -0.21;
  leftLowerLeg.castShadow = !isSoftwareGl;
  leftKnee.add(leftLowerLeg);

  const leftBoot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.18, 0.24), plateMat);
  leftBoot.position.set(0, -0.36, 0.04);
  leftBoot.castShadow = !isSoftwareGl;
  leftKnee.add(leftBoot);

  // Right Leg
  const rightHip = new THREE.Group();
  rightHip.position.set(0.14, -0.06, 0);
  pelvis.add(rightHip);

  const rightUpperLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.42, 8), underSuitMat);
  rightUpperLeg.position.y = -0.21;
  rightUpperLeg.castShadow = !isSoftwareGl;
  rightHip.add(rightUpperLeg);

  const rightThighArmor = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.18), armorMat);
  rightThighArmor.position.set(0, -0.18, 0.02);
  rightThighArmor.castShadow = !isSoftwareGl;
  rightHip.add(rightThighArmor);

  const rightKnee = new THREE.Group();
  rightKnee.position.y = -0.42;
  rightHip.add(rightKnee);

  const rightLowerLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.42, 8), underSuitMat);
  rightLowerLeg.position.y = -0.21;
  rightLowerLeg.castShadow = !isSoftwareGl;
  rightKnee.add(rightLowerLeg);

  const rightBoot = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.18, 0.24), plateMat);
  rightBoot.position.set(0, -0.36, 0.04);
  rightBoot.castShadow = !isSoftwareGl;
  rightKnee.add(rightBoot);

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

  return {
    group,
    position,
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
      pelvis.visible = false;
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

      // Jump & Gravity mechanics
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
          verticalVelocity = 0;
          isGrounded = true;
        }
      }

      // Apply horizontal displacement
      position.x += velocity.x * dt;
      position.z += velocity.z * dt;

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
      } else {
        if (!isGrounded) {
          // Airborne pose
          pelvis.position.y = THREE.MathUtils.damp(pelvis.position.y, 0.98, 8, dt);
          spine.rotation.x = THREE.MathUtils.damp(spine.rotation.x, 0.15, 6, dt);
          leftHip.rotation.x = THREE.MathUtils.damp(leftHip.rotation.x, -0.4, 8, dt);
          rightHip.rotation.x = THREE.MathUtils.damp(rightHip.rotation.x, 0.3, 8, dt);
          leftKnee.rotation.x = THREE.MathUtils.damp(leftKnee.rotation.x, 0.6, 8, dt);
          rightKnee.rotation.x = THREE.MathUtils.damp(rightKnee.rotation.x, 0.5, 8, dt);
          leftShoulder.rotation.x = THREE.MathUtils.damp(leftShoulder.rotation.x, -0.5, 8, dt);
          rightShoulder.rotation.x = THREE.MathUtils.damp(rightShoulder.rotation.x, -0.5, 8, dt);
          leftElbow.rotation.x = THREE.MathUtils.damp(leftElbow.rotation.x, -0.4, 8, dt);
          rightElbow.rotation.x = THREE.MathUtils.damp(rightElbow.rotation.x, -0.4, 8, dt);
        } else if (groundSpeed > 0.15) {
          // Real-time stride synchronization
          const strideLength = isSprinting ? 2.15 : 1.35;
          gaitPhase += (groundSpeed / strideLength) * Math.PI * 2 * dt;

          const stride = Math.sin(gaitPhase);
          const counterStride = -stride;
          const bounce = Math.abs(Math.sin(gaitPhase)) * (isSprinting ? 0.08 : 0.04);

          pelvis.position.y = 0.95 + bounce;
          pelvis.rotation.z = Math.sin(gaitPhase) * 0.035;

          const speedNorm = groundSpeed / sprintSpeed;
          const forwardLean = THREE.MathUtils.lerp(0.06, 0.24, speedNorm);
          spine.rotation.x = forwardLean;
          spine.rotation.y = Math.sin(gaitPhase) * 0.07;

          const legAmp = THREE.MathUtils.lerp(0.5, 0.85, speedNorm);
          leftHip.rotation.x = stride * legAmp;
          rightHip.rotation.x = counterStride * legAmp;

          leftKnee.rotation.x = Math.max(0, Math.sin(gaitPhase - 0.4)) * (isSprinting ? 1.2 : 0.75);
          rightKnee.rotation.x = Math.max(0, Math.sin(gaitPhase + Math.PI - 0.4)) * (isSprinting ? 1.2 : 0.75);

          const armAmp = THREE.MathUtils.lerp(0.5, 0.95, speedNorm);
          leftShoulder.rotation.x = counterStride * armAmp;
          rightShoulder.rotation.x = stride * armAmp;

          leftShoulder.rotation.z = -0.15;
          rightShoulder.rotation.z = 0.15;

          leftElbow.rotation.x = -Math.abs(Math.sin(gaitPhase)) * (isSprinting ? 0.85 : 0.4);
          rightElbow.rotation.x = -Math.abs(Math.sin(gaitPhase + Math.PI)) * (isSprinting ? 0.85 : 0.4);

          headGroup.rotation.x = -forwardLean * 0.75;
        } else {
          // Idle breathing
          const idleTime = performance.now() * 0.002;
          const breath = Math.sin(idleTime) * 0.015;

          pelvis.position.y = THREE.MathUtils.damp(pelvis.position.y, 0.95 + breath, 5, dt);
          pelvis.rotation.z = THREE.MathUtils.damp(pelvis.rotation.z, 0, 6, dt);
          spine.rotation.x = THREE.MathUtils.damp(spine.rotation.x, breath * 0.5, 5, dt);
          spine.rotation.y = THREE.MathUtils.damp(spine.rotation.y, 0, 5, dt);

          leftHip.rotation.x = THREE.MathUtils.damp(leftHip.rotation.x, 0, 8, dt);
          rightHip.rotation.x = THREE.MathUtils.damp(rightHip.rotation.x, 0, 8, dt);
          leftKnee.rotation.x = THREE.MathUtils.damp(leftKnee.rotation.x, 0.05, 8, dt);
          rightKnee.rotation.x = THREE.MathUtils.damp(rightKnee.rotation.x, 0.05, 8, dt);

          leftShoulder.rotation.x = THREE.MathUtils.damp(leftShoulder.rotation.x, Math.sin(idleTime) * 0.04, 5, dt);
          rightShoulder.rotation.x = THREE.MathUtils.damp(rightShoulder.rotation.x, -Math.sin(idleTime) * 0.04, 5, dt);
          leftShoulder.rotation.z = THREE.MathUtils.damp(leftShoulder.rotation.z, -0.1, 5, dt);
          rightShoulder.rotation.z = THREE.MathUtils.damp(rightShoulder.rotation.z, 0.1, 5, dt);
          leftElbow.rotation.x = THREE.MathUtils.damp(leftElbow.rotation.x, -0.15, 5, dt);
          rightElbow.rotation.x = THREE.MathUtils.damp(rightElbow.rotation.x, -0.15, 5, dt);

          headGroup.rotation.x = THREE.MathUtils.damp(headGroup.rotation.x, 0, 5, dt);
        }
      }
    },

    dispose: () => {
      if (customAvatar) {
        customAvatar.dispose();
        customAvatar = null;
      }
      armorMat.dispose();
      underSuitMat.dispose();
      plateMat.dispose();
      visorMat.dispose();
      coreMat.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      shadowTex.dispose();
    },
  };
}
