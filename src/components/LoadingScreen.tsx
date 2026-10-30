import React, { useEffect, useRef, useState } from 'react';
import type { AraLoadingProgress } from '../ara3d/araManager';

interface LoadingScreenProps {
  progress: AraLoadingProgress;
  onComplete?: () => void;
  isReady: boolean;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ progress, onComplete, isReady }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const hasTriggeredRef = useRef(false);

  // Automatic transition: as soon as ready or 100%, initiate smooth dissolve and proceed without button clicks
  useEffect(() => {
    if ((isReady || progress.percent >= 100) && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true;
      setIsFadingOut(true);
      const timer = window.setTimeout(() => {
        onComplete?.();
      }, 550);
      return () => window.clearTimeout(timer);
    }
  }, [isReady, progress.percent, onComplete]);

  // Ambient landscape & atmospheric canvas backdrop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Atmospheric particles representing motes of dust and light in open horizon
    const particles = Array.from({ length: 45 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 1.8 + 0.6,
      vx: (Math.random() - 0.5) * 0.25,
      vy: -Math.random() * 0.45 - 0.15,
      alpha: Math.random() * 0.5 + 0.2,
      fadeSpeed: Math.random() * 0.008 + 0.004,
    }));

    let t = 0;

    const render = () => {
      t += 0.012;
      ctx.clearRect(0, 0, width, height);

      // 1. Deep atmospheric sky dome gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, height);
      skyGrad.addColorStop(0, '#040711');
      skyGrad.addColorStop(0.55, '#0a1326');
      skyGrad.addColorStop(0.82, '#152b48');
      skyGrad.addColorStop(1, '#08101e');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      // 2. Horizon glow (luminous atmospheric dawn/dusk line)
      const horizonY = height * 0.72;
      const glowGrad = ctx.createRadialGradient(
        width * 0.5,
        horizonY,
        10,
        width * 0.5,
        horizonY,
        width * 0.65
      );
      glowGrad.addColorStop(0, 'rgba(100, 190, 255, 0.22)');
      glowGrad.addColorStop(0.35, 'rgba(64, 140, 230, 0.12)');
      glowGrad.addColorStop(0.7, 'rgba(25, 60, 120, 0.04)');
      glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, horizonY - height * 0.4, width, height * 0.6);

      // 3. Far distant mountain silhouette 1
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      for (let x = 0; x <= width; x += 30) {
        const nx = x * 0.002;
        const elev =
          Math.sin(nx * 3.5 + 1.2) * 45 +
          Math.cos(nx * 7.2) * 22 +
          Math.sin(nx * 14.0) * 10;
        ctx.lineTo(x, horizonY - 35 - elev);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fillStyle = '#0a1628';
      ctx.fill();

      // 4. Midground mountain silhouette 2
      ctx.beginPath();
      ctx.moveTo(0, horizonY);
      for (let x = 0; x <= width; x += 25) {
        const nx = x * 0.0035 + 2.0;
        const elev =
          Math.sin(nx * 4.2) * 35 +
          Math.cos(nx * 8.5) * 16 +
          Math.sin(nx * 18.0) * 6;
        ctx.lineTo(x, horizonY - 12 - elev);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.fillStyle = '#060d1a';
      ctx.fill();

      // 5. Horizon ground plane gradient
      const groundGrad = ctx.createLinearGradient(0, horizonY - 5, 0, height);
      groundGrad.addColorStop(0, '#081120');
      groundGrad.addColorStop(0.3, '#040912');
      groundGrad.addColorStop(1, '#020409');
      ctx.fillStyle = groundGrad;
      ctx.fillRect(0, horizonY - 5, width, height - horizonY + 5);

      // 6. Perspective terrain grid lines receding toward the horizon
      ctx.save();
      ctx.strokeStyle = 'rgba(70, 130, 200, 0.06)';
      ctx.lineWidth = 1;
      const vanishingX = width * 0.5;
      const vanishingY = horizonY - 2;

      for (let i = -14; i <= 14; i++) {
        ctx.beginPath();
        ctx.moveTo(vanishingX + i * 22, vanishingY);
        ctx.lineTo(vanishingX + i * 160, height);
        ctx.stroke();
      }

      // Horizontal depth lines
      for (let j = 1; j <= 8; j++) {
        const py = horizonY + Math.pow(j / 8, 2.2) * (height - horizonY);
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(width, py);
        ctx.stroke();
      }
      ctx.restore();

      // 7. Atmospheric particles
      ctx.save();
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha += Math.sin(t * 2 + p.x) * 0.005;
        if (p.y < 0) {
          p.y = height + 10;
          p.x = Math.random() * width;
        }
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;

        ctx.fillStyle = `rgba(140, 210, 255, ${Math.max(0.1, Math.min(0.65, p.alpha))})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // 8. Subtle center sun beam/pulse
      const beamGrad = ctx.createLinearGradient(width * 0.5 - 120, horizonY, width * 0.5 + 120, horizonY);
      beamGrad.addColorStop(0, 'rgba(0,0,0,0)');
      beamGrad.addColorStop(0.5, `rgba(130, 210, 255, ${0.12 + Math.sin(t) * 0.03})`);
      beamGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = beamGrad;
      ctx.fillRect(width * 0.5 - 200, horizonY - 140, 400, 140);

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-50 w-full h-full overflow-hidden select-none bg-[#050811] text-white transition-opacity duration-500 ease-out ${
        isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Dynamic 2D Landscape & Horizon Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

      {/* Cinematic Vignette */}
      <div className="pointer-events-none absolute inset-0 bg-radial from-transparent via-black/40 to-black/85" />

      {/* Top Telemetry Bar */}
      <header className="relative z-10 w-full px-8 py-7 flex items-center justify-between text-xs tracking-widest text-slate-400 font-mono">
        <div className="flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400" />
          <span className="text-slate-300 font-semibold uppercase">WORLD: OPEN HORIZON TERRAIN</span>
          <span className="hidden sm:inline text-slate-600">/</span>
          <span className="hidden sm:inline text-slate-500">COORD: 45°12&apos;N 12°04&apos;E</span>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-slate-500">
          <span className="hidden md:inline">SYSTEM: MAKEHUMAN CC0 · PBR SHADERS</span>
          <span className="hidden md:inline text-slate-700">|</span>
          <span className="text-cyan-400/90 font-semibold">WEBGL2 READY</span>
        </div>
      </header>

      {/* Center Cinematic Title Lockup */}
      <div className="relative z-10 w-full h-[55%] flex flex-col items-center justify-center text-center px-6">
        <div className="text-[11px] font-mono tracking-[0.35em] text-cyan-400/80 uppercase mb-3">
          Expedição ao Mundo Aberto 3D
        </div>

        <h1 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-b from-white via-slate-100 to-slate-400 drop-shadow-[0_15px_30px_rgba(0,0,0,0.8)]">
          OPEN HORIZON
        </h1>

        <div className="flex items-center gap-3 my-4 w-full max-w-md justify-center">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-cyan-500/40 to-cyan-400" />
          <span className="w-1.5 h-1.5 rotate-45 bg-cyan-400 shadow-sm shadow-cyan-400" />
          <div className="h-px flex-1 bg-gradient-to-l from-transparent via-cyan-500/40 to-cyan-400" />
        </div>

        <p className="text-xs sm:text-sm text-slate-300/80 tracking-wide font-light max-w-md">
          Ambiente imersivo em tempo real com sistema generativo de personagens humanos
        </p>
      </div>

      {/* Bottom Telemetry & Real Progress Architecture */}
      <footer className="absolute bottom-0 left-0 right-0 z-10 w-full px-8 pb-10 pt-6 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/50 to-transparent">
        <div className="max-w-4xl w-full mx-auto flex flex-col gap-3">
          {/* Status line & Numerical readout */}
          <div className="flex items-end justify-between text-xs font-mono">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] tracking-widest text-cyan-400/70 uppercase">
                {progress.percent >= 100 ? 'SISTEMA PRONTO' : 'CARREGANDO RECURSOS'}
              </span>
              <span className="text-sm font-medium text-slate-200 tracking-wide">
                {progress.percent >= 100
                  ? 'Recursos sincronizados • Entrando na experiência...'
                  : progress.stage}
              </span>
            </div>

            <div className="flex items-baseline gap-1">
              <span className="font-mono text-3xl font-light tabular-nums text-white tracking-tighter">
                {progress.percent}
              </span>
              <span className="text-sm font-mono text-cyan-400">%</span>
            </div>
          </div>

          {/* Full-width sleek progress bar */}
          <div className="w-full h-1.5 rounded-none bg-slate-800/80 overflow-hidden relative backdrop-blur-sm border-t border-b border-white/5">
            <div
              className="h-full bg-gradient-to-r from-cyan-500 via-sky-400 to-indigo-400 transition-all duration-300 ease-out relative"
              style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }}
            >
              {/* Luminous leading head */}
              <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-r from-transparent to-white shadow-[0_0_12px_rgba(255,255,255,0.9)]" />
            </div>
          </div>

          {/* Subsystem status badges */}
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1">
            <div className="flex items-center gap-6">
              <span className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    progress.percent >= 30 ? 'bg-cyan-400' : 'bg-slate-700'
                  }`}
                />
                <span className={progress.percent >= 30 ? 'text-slate-300' : 'text-slate-600'}>
                  Catálogo Ara
                </span>
              </span>

              <span className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    progress.percent >= 65 ? 'bg-cyan-400' : 'bg-slate-700'
                  }`}
                />
                <span className={progress.percent >= 65 ? 'text-slate-300' : 'text-slate-600'}>
                  Malhas MakeHuman
                </span>
              </span>

              <span className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    progress.percent >= 90 ? 'bg-cyan-400' : 'bg-slate-700'
                  }`}
                />
                <span className={progress.percent >= 90 ? 'text-slate-300' : 'text-slate-600'}>
                  Shaders & Terreno
                </span>
              </span>
            </div>

            <span className="text-slate-600 tracking-wider">
              AUTO TRANSITION
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
};
