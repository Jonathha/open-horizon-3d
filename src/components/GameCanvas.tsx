import React, { useEffect, useRef, useState, useCallback } from 'react';
import { initGameEngine, GameEngine } from '../game/engine';
import { VirtualJoystick } from './VirtualJoystick';
import { Volume2, VolumeX, Compass, User } from 'lucide-react';
import type { AraCharacterInstance } from '../ara3d/araManager';

interface GameCanvasProps {
  customAvatar?: AraCharacterInstance | null;
  onOpenCreator?: () => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ customAvatar, onOpenCreator }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const isDraggingCamera = useRef(false);
  const lastPointerPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!mountRef.current) return;

    const engine = initGameEngine(mountRef.current);
    engineRef.current = engine;

    if (customAvatar) {
      engine.setCustomAvatar(customAvatar);
    }

    engine.start();

    const handleResize = () => {
      if (mountRef.current) {
        engine.resize(mountRef.current.clientWidth, mountRef.current.clientHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      engine.dispose();
      engineRef.current = null;
    };
  }, [customAvatar]);

  // Camera Orbit via touch / mouse drag on screen
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    isDraggingCamera.current = true;
    lastPointerPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingCamera.current || !engineRef.current) return;
    const dx = e.clientX - lastPointerPos.current.x;
    const dy = e.clientY - lastPointerPos.current.y;
    lastPointerPos.current = { x: e.clientX, y: e.clientY };
    engineRef.current.handlePointerDrag(dx, dy);
  }, []);

  const onPointerUp = useCallback(() => {
    isDraggingCamera.current = false;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!engineRef.current) return;
    engineRef.current.handleZoom(e.deltaY);
  }, []);

  const handleJoystickMove = useCallback((x: number, y: number) => {
    if (engineRef.current) {
      engineRef.current.inputManager.setJoystick(x, y);
    }
  }, []);

  const handleJoystickJump = useCallback(() => {
    if (engineRef.current) {
      engineRef.current.inputManager.triggerJump();
    }
  }, []);

  const toggleMute = () => {
    if (engineRef.current) {
      const muted = engineRef.current.toggleAudio();
      setIsMuted(muted);
    }
  };

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none bg-slate-950"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ touchAction: 'none' }}
    >
      {/* Isolated Three.js Canvas container */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Top Minimal Perimeter Status */}
      <div className="absolute top-4 left-4 right-4 pointer-events-none z-10 flex justify-between items-center">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/60 border border-white/10 text-white/90">
          <Compass className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold tracking-wider uppercase text-slate-200">
            Open Horizon 3D
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {onOpenCreator && (
            <button
              type="button"
              onClick={onOpenCreator}
              className="px-3.5 py-1.5 rounded-full bg-slate-900/60 border border-white/10 text-xs font-semibold text-white/80 hover:text-white hover:bg-slate-900/80 transition-colors flex items-center gap-1.5 shadow-md cursor-pointer"
              title="Personalizar Personagem"
            >
              <User className="w-3.5 h-3.5 text-cyan-400" />
              <span>Personalizar</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleMute}
            className="p-2.5 rounded-full bg-slate-900/60 border border-white/10 text-white/80 hover:text-white hover:bg-slate-900/80 transition-colors cursor-pointer"
            title={isMuted ? 'Ativar Áudio' : 'Desativar Áudio'}
            aria-label="Áudio"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-cyan-400" />}
          </button>
        </div>
      </div>

      {/* Virtual Analog Joystick & Action Controls */}
      <VirtualJoystick onMove={handleJoystickMove} onJump={handleJoystickJump} />
    </div>
  );
};
