import * as THREE from 'three';
import { getTerrainHeight } from './terrain';

export interface ThirdPersonCamera {
  camera: THREE.PerspectiveCamera;
  update: (delta: number, playerPos: THREE.Vector3) => void;
  onPointerMove: (deltaX: number, deltaY: number) => void;
  onZoom: (deltaZoom: number) => void;
  getYaw: () => number;
  getHorizontalVectors: () => { forward: THREE.Vector3; right: THREE.Vector3 };
}

export function createThirdPersonCamera(aspect: number): ThirdPersonCamera {
  const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 800);

  // Spherical orbit parameters
  let targetYaw = 0;
  let targetPitch = 0.28; // ~16 degrees downward angle
  let currentYaw = 0;
  let currentPitch = 0.28;

  let targetDistance = 6.8;
  let currentDistance = 6.8;

  const currentLookAt = new THREE.Vector3(0, 1.4, 0);
  const targetLookAt = new THREE.Vector3(0, 1.4, 0);

  const forwardHelper = new THREE.Vector3();
  const rightHelper = new THREE.Vector3();
  const upAxis = new THREE.Vector3(0, 1, 0);

  return {
    camera,
    getYaw: () => currentYaw,
    getHorizontalVectors: () => {
      camera.getWorldDirection(forwardHelper);
      forwardHelper.y = 0;
      forwardHelper.normalize();

      rightHelper.crossVectors(forwardHelper, upAxis).normalize();
      return { forward: forwardHelper, right: rightHelper };
    },
    onPointerMove: (deltaX: number, deltaY: number) => {
      const sensitivity = 0.0035;
      // Inverted sign: dragging right rotates camera right, dragging left rotates left
      targetYaw += deltaX * sensitivity;
      targetPitch -= deltaY * sensitivity;

      // Clamp pitch to avoid ground clipping and upside-down flip
      targetPitch = Math.max(-0.08, Math.min(1.25, targetPitch));
    },
    onZoom: (deltaZoom: number) => {
      targetDistance = Math.max(3.2, Math.min(13.0, targetDistance + deltaZoom * 0.004));
    },
    update: (delta: number, playerPos: THREE.Vector3) => {
      const dt = Math.min(delta, 0.05);

      // Smooth camera orbit angles
      currentYaw = THREE.MathUtils.damp(currentYaw, targetYaw, 16, dt);
      currentPitch = THREE.MathUtils.damp(currentPitch, targetPitch, 16, dt);
      currentDistance = THREE.MathUtils.damp(currentDistance, targetDistance, 10, dt);

      // Focus target at player upper torso/head
      targetLookAt.set(playerPos.x, playerPos.y + 1.45, playerPos.z);
      currentLookAt.x = THREE.MathUtils.damp(currentLookAt.x, targetLookAt.x, 14, dt);
      currentLookAt.y = THREE.MathUtils.damp(currentLookAt.y, targetLookAt.y, 14, dt);
      currentLookAt.z = THREE.MathUtils.damp(currentLookAt.z, targetLookAt.z, 14, dt);

      // Spherical coordinates offset from player
      const horizontalDist = currentDistance * Math.cos(currentPitch);
      const verticalDist = currentDistance * Math.sin(currentPitch);

      const desiredX = currentLookAt.x + Math.sin(currentYaw) * horizontalDist;
      const desiredZ = currentLookAt.z + Math.cos(currentYaw) * horizontalDist;
      let desiredY = currentLookAt.y + verticalDist;

      // Ground clearance prevention (camera will never clip below the landscape)
      const terrainH = getTerrainHeight(desiredX, desiredZ);
      const minCamY = terrainH + 0.65;
      if (desiredY < minCamY) {
        desiredY = minCamY;
      }

      camera.position.set(desiredX, desiredY, desiredZ);
      camera.lookAt(currentLookAt);
    },
  };
}
