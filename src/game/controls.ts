import * as THREE from 'three';

export interface InputState {
  moveX: number; // -1 to 1
  moveZ: number; // -1 to 1
  sprint: boolean;
  jump: boolean;
}

export class InputManager {
  private keys: Record<string, boolean> = {};
  private joystickInput: { x: number; y: number } = { x: 0, y: 0 };
  private jumpRequested: boolean = false;

  constructor() {
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onBlur = this.onBlur.bind(this);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private onKeyDown(e: KeyboardEvent) {
    this.keys[e.code] = true;
    if (e.code === 'Space') {
      this.jumpRequested = true;
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    this.keys[e.code] = false;
  }

  private onBlur() {
    this.keys = {};
    this.joystickInput = { x: 0, y: 0 };
    this.jumpRequested = false;
  }

  public setJoystick(x: number, y: number) {
    this.joystickInput.x = x;
    this.joystickInput.y = y;
  }

  public triggerJump() {
    this.jumpRequested = true;
  }

  /**
   * Translates keyboard and virtual joystick input into camera-oriented world movement vector
   * using the camera's true horizontal forward and right vectors.
   */
  public getMovementVector(cameraForward: THREE.Vector3, cameraRight: THREE.Vector3): {
    moveVector: { x: number; y: number };
    sprint: boolean;
    jump: boolean;
  } {
    let rawX = 0;
    let rawZ = 0;

    // Keyboard WASD / Arrows
    // W = Forward (rawZ = -1), S = Backward (rawZ = +1)
    if (this.keys['KeyW'] || this.keys['ArrowUp']) rawZ -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) rawZ += 1;
    // A = Left (rawX = -1), D = Right (rawX = +1)
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) rawX -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) rawX += 1;

    // Virtual Joystick contribution
    // joystickInput.x > 0 is right, < 0 is left
    // joystickInput.y < 0 is forward, > 0 is backward
    if (Math.abs(this.joystickInput.x) > 0.05 || Math.abs(this.joystickInput.y) > 0.05) {
      rawX += this.joystickInput.x;
      rawZ += this.joystickInput.y;
    }

    // Clamp diagonal input magnitude to 1
    const len = Math.sqrt(rawX * rawX + rawZ * rawZ);
    if (len > 1) {
      rawX /= len;
      rawZ /= len;
    }

    // Forward amount: pushing forward (rawZ = -1) moves along +cameraForward
    const forwardAmount = -rawZ;
    // Right amount: pushing right (rawX = +1) moves along +cameraRight
    const rightAmount = rawX;

    // Exact projection in world coordinates
    const worldX = cameraForward.x * forwardAmount + cameraRight.x * rightAmount;
    const worldZ = cameraForward.z * forwardAmount + cameraRight.z * rightAmount;

    const sprint = !!(this.keys['ShiftLeft'] || this.keys['ShiftRight'] || len > 0.85);
    const jump = this.jumpRequested;
    this.jumpRequested = false;

    return {
      moveVector: { x: worldX, y: worldZ },
      sprint,
      jump,
    };
  }

  public dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}
