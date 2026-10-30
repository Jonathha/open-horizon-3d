import * as THREE from 'three';

/**
 * High-fidelity procedural texture generator for 100% self-contained PBR rendering.
 * All textures, bump/normal maps and material finishes are generated procedurally via HTML5 Canvas.
 */

function makeTexture(canvas: HTMLCanvasElement, isColor = true): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (isColor) {
    texture.colorSpace = THREE.SRGBColorSpace;
  }
  return texture;
}

export function generateNormalMap(sourceCanvas: HTMLCanvasElement, intensity = 1.6): THREE.CanvasTexture {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const sCtx = sourceCanvas.getContext('2d');
  if (!sCtx) return new THREE.CanvasTexture(sourceCanvas);

  const srcData = sCtx.getImageData(0, 0, w, h).data;
  const nCanvas = document.createElement('canvas');
  nCanvas.width = w;
  nCanvas.height = h;
  const nCtx = nCanvas.getContext('2d');
  if (!nCtx) return new THREE.CanvasTexture(nCanvas);

  const nImg = nCtx.createImageData(w, h);
  const dstData = nImg.data;

  const getHeight = (x: number, y: number) => {
    const px = ((x + w) % w);
    const py = ((y + h) % h);
    const idx = (py * w + px) * 4;
    return (srcData[idx] * 0.299 + srcData[idx + 1] * 0.587 + srcData[idx + 2] * 0.114) / 255.0;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const left = getHeight(x - 1, y);
      const right = getHeight(x + 1, y);
      const top = getHeight(x, y - 1);
      const bottom = getHeight(x, y + 1);

      const dx = (left - right) * intensity;
      const dy = (top - bottom) * intensity;
      const dz = 1.0;

      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1.0;
      const nx = (dx / len) * 0.5 + 0.5;
      const ny = (dy / len) * 0.5 + 0.5;
      const nz = (dz / len) * 0.5 + 0.5;

      const idx = (y * w + x) * 4;
      dstData[idx] = Math.round(nx * 255);
      dstData[idx + 1] = Math.round(ny * 255);
      dstData[idx + 2] = Math.round(nz * 255);
      dstData[idx + 3] = 255;
    }
  }

  nCtx.putImageData(nImg, 0, 0);
  const nTex = new THREE.CanvasTexture(nCanvas);
  nTex.wrapS = THREE.RepeatWrapping;
  nTex.wrapT = THREE.RepeatWrapping;
  return nTex;
}

/**
 * Rich open-world alpine meadow grass texture with micro-vegetation
 */
export function createGrassTexture(): { diffuse: THREE.CanvasTexture; normal: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Base grass tone with soft organic vignette
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#366826');
  grad.addColorStop(0.35, '#42782e');
  grad.addColorStop(0.7, '#4c8636');
  grad.addColorStop(1, '#2f5720');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Micro-clumps & blades
  for (let i = 0; i < 4500; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 3 + Math.random() * 9;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random();
    if (r > 0.6) {
      ctx.strokeStyle = 'rgba(102, 178, 68, 0.45)';
    } else if (r > 0.25) {
      ctx.strokeStyle = 'rgba(74, 134, 48, 0.4)';
    } else {
      ctx.strokeStyle = 'rgba(28, 52, 18, 0.5)';
    }
    ctx.lineWidth = 1 + Math.random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }

  // Soft moss & wild clover specks
  for (let i = 0; i < 350; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillStyle = Math.random() > 0.8 ? 'rgba(238, 224, 138, 0.65)' : 'rgba(56, 114, 38, 0.45)';
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + Math.random() * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  const diffuse = makeTexture(canvas, true);
  const normal = generateNormalMap(canvas, 1.7);

  // Roughness map
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = '#b8b8b8';
  rCtx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2000; i++) {
    rCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
    rCtx.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  }
  const roughness = makeTexture(roughCanvas, false);

  return { diffuse, normal, roughness };
}

/**
 * Rich packed dirt, soil and earth texture for trails and paths
 */
export function createSoilTrailTexture(): { diffuse: THREE.CanvasTexture; normal: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Warm earthy soil base with subtle tone mottling
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.5, 20, size * 0.5, size * 0.5, size * 0.7);
  grad.addColorStop(0, '#5a4632');
  grad.addColorStop(0.5, '#4f3c2b');
  grad.addColorStop(1, '#443424');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Micro-granules & soil particles
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = Math.random();
    if (r > 0.7) {
      ctx.fillStyle = 'rgba(118, 98, 76, 0.45)';
    } else if (r > 0.3) {
      ctx.fillStyle = 'rgba(56, 42, 28, 0.55)';
    } else {
      ctx.fillStyle = 'rgba(28, 20, 14, 0.6)';
    }
    ctx.fillRect(x, y, 1.2 + Math.random() * 2, 1.2 + Math.random() * 2);
  }

  // Small embedded pebbles & gravel
  for (let i = 0; i < 400; i++) {
    const px = Math.random() * size;
    const py = Math.random() * size;
    const pr = 1.5 + Math.random() * 3.5;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(148, 138, 124, 0.75)' : 'rgba(88, 80, 72, 0.8)';
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fill();
    // Pebble shadow/rim
    ctx.strokeStyle = 'rgba(25, 20, 15, 0.5)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  const diffuse = makeTexture(canvas, true);
  const normal = generateNormalMap(canvas, 2.2);

  // Roughness map (matte soil with slight sheen variations)
  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;
  rCtx.fillStyle = '#c4b5a0';
  rCtx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2500; i++) {
    rCtx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)';
    rCtx.fillRect(Math.random() * size, Math.random() * size, 3, 3);
  }
  const roughness = makeTexture(rCanvas, false);

  return { diffuse, normal, roughness };
}

/**
 * Embedded river rock, gravel and weathered stone texture
 */
export function createPebbleGravelTexture(): { diffuse: THREE.CanvasTexture; normal: THREE.CanvasTexture; roughness: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#686054';
  ctx.fillRect(0, 0, size, size);

  // Dense cobblestone / pebble distribution
  for (let i = 0; i < 1200; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const rx = 2.5 + Math.random() * 5.5;
    const ry = 2.0 + Math.random() * 4.5;
    const rot = Math.random() * Math.PI;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);

    const shade = Math.floor(100 + Math.random() * 85);
    ctx.fillStyle = `rgb(${shade + 8}, ${shade + 4}, ${shade - 6})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(30, 26, 22, 0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  const diffuse = makeTexture(canvas, true);
  const normal = generateNormalMap(canvas, 2.8);

  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d')!;
  rCtx.fillStyle = '#a0a0a0';
  rCtx.fillRect(0, 0, size, size);
  const roughness = makeTexture(rCanvas, false);

  return { diffuse, normal, roughness };
}

/**
 * Earthy granite rock / cliff texture
 */
export function createRockTexture(): { diffuse: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#636a72';
  ctx.fillRect(0, 0, size, size);

  // Geological strata fractures
  for (let i = 0; i < 1000; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 2 + Math.random() * 9;
    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(38,42,46,0.38)' : 'rgba(142,150,158,0.32)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Lichen & moss patches
  for (let i = 0; i < 45; i++) {
    const cx = Math.random() * size;
    const cy = Math.random() * size;
    const rad = 14 + Math.random() * 26;
    const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
    grad.addColorStop(0, 'rgba(74, 98, 48, 0.5)');
    grad.addColorStop(1, 'rgba(74, 98, 48, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  const diffuse = makeTexture(canvas, true);
  const normal = generateNormalMap(canvas, 2.6);
  return { diffuse, normal };
}

/**
 * Tree bark texture
 */
export function createBarkTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#483525';
  ctx.fillRect(0, 0, size, size);

  // Vertical bark grooves
  for (let x = 0; x < size; x += 3 + Math.random() * 3) {
    ctx.strokeStyle = Math.random() > 0.45 ? 'rgba(28, 18, 11, 0.75)' : 'rgba(105, 80, 56, 0.55)';
    ctx.lineWidth = 1.5 + Math.random() * 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    let curX = x;
    for (let y = 0; y < size; y += 18) {
      curX += (Math.random() - 0.5) * 4;
      ctx.lineTo(curX, y);
    }
    ctx.stroke();
  }
  return makeTexture(canvas, true);
}

/**
 * Character suit / armor procedural panel texture
 */
export function createArmorTexture(): { diffuse: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Deep slate navy / titanium base
  ctx.fillStyle = '#1c222c';
  ctx.fillRect(0, 0, size, size);

  // Hexagonal tech weave / carbon fiber grid
  ctx.strokeStyle = 'rgba(48, 58, 74, 0.65)';
  ctx.lineWidth = 1;
  const step = 16;
  for (let x = 0; x < size; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }
  for (let y = 0; y < size; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  // Panel borders and reinforcement bevels
  ctx.strokeStyle = 'rgba(82, 94, 114, 0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(32, 32, size - 64, size - 64);
  ctx.strokeRect(96, 96, size - 192, size - 192);

  const diffuse = makeTexture(canvas, true);
  const normal = generateNormalMap(canvas, 1.6);
  return { diffuse, normal };
}
