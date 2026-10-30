import React, { useRef, useState, useEffect } from 'react';

interface VirtualJoystickProps {
  onMove: (x: number, y: number) => void;
  onJump: () => void;
}

export const VirtualJoystick: React.FC<VirtualJoystickProps> = ({ onMove, onJump }) => {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knobPos, setKnobPos] = useState({ x: 0, y: 0 });
  const [isActive, setIsActive] = useState(false);
  const activeTouchId = useRef<number | null>(null);

  const radius = 55; // Base radius in pixels

  const handleStart = (clientX: number, clientY: number, touchId: number | null = null) => {
    if (!baseRef.current) return;
    activeTouchId.current = touchId;
    setIsActive(true);
    updateKnob(clientX, clientY);
  };

  const updateKnob = (clientX: number, clientY: number) => {
    if (!baseRef.current) return;
    const rect = baseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    let normX = dx / radius;
    let normY = dy / radius;

    if (dist > radius) {
      normX = (dx / dist);
      normY = (dy / dist);
    }

    setKnobPos({ x: normX * radius, y: normY * radius });
    onMove(normX, normY);
  };

  const handleEnd = () => {
    setIsActive(false);
    activeTouchId.current = null;
    setKnobPos({ x: 0, y: 0 });
    onMove(0, 0);
  };

  useEffect(() => {
    const onTouchMove = (e: TouchEvent) => {
      if (activeTouchId.current === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === activeTouchId.current) {
          updateKnob(touch.clientX, touch.clientY);
          break;
        }
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (activeTouchId.current === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === activeTouchId.current) {
          handleEnd();
          break;
        }
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isActive && activeTouchId.current === null) {
        updateKnob(e.clientX, e.clientY);
      }
    };

    const onMouseUp = () => {
      if (isActive && activeTouchId.current === null) {
        handleEnd();
      }
    };

    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isActive]);

  return (
    <div className="absolute inset-0 pointer-events-none z-20 flex justify-between items-end p-6 select-none">
      {/* Left side: Analog stick */}
      <div className="pointer-events-auto flex flex-col items-center">
        <div
          ref={baseRef}
          onMouseDown={(e) => {
            e.stopPropagation();
            handleStart(e.clientX, e.clientY, null);
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            if (e.changedTouches.length > 0) {
              handleStart(e.changedTouches[0].clientX, e.changedTouches[0].clientY, e.changedTouches[0].identifier);
            }
          }}
          className={`relative w-32 h-32 rounded-full border border-white/20 bg-slate-900/40 backdrop-blur-none flex items-center justify-center transition-colors duration-200 cursor-grab active:cursor-grabbing ${
            isActive ? 'border-cyan-400/50 bg-slate-900/60 shadow-[0_0_20px_rgba(6,182,212,0.15)]' : ''
          }`}
          style={{ touchAction: 'none' }}
        >
          {/* Subtle directional indicators */}
          <div className="absolute w-1.5 h-1.5 rounded-full bg-white/25 top-2" />
          <div className="absolute w-1.5 h-1.5 rounded-full bg-white/25 bottom-2" />
          <div className="absolute w-1.5 h-1.5 rounded-full bg-white/25 left-2" />
          <div className="absolute w-1.5 h-1.5 rounded-full bg-white/25 right-2" />

          {/* Stick Knob */}
          <div
            className={`w-14 h-14 rounded-full border border-white/30 flex items-center justify-center transition-transform duration-75 shadow-lg ${
              isActive
                ? 'bg-gradient-to-tr from-cyan-600 to-sky-400 border-cyan-200'
                : 'bg-gradient-to-tr from-slate-700 to-slate-600'
            }`}
            style={{
              transform: `translate(${knobPos.x}px, ${knobPos.y}px)`,
              touchAction: 'none',
            }}
          >
            <div className="w-4 h-4 rounded-full bg-white/40" />
          </div>
        </div>
      </div>

      {/* Right side: Action Jump Button */}
      <div className="pointer-events-auto flex items-end">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onJump();
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            onJump();
          }}
          className="w-16 h-16 rounded-full bg-slate-900/50 border border-white/25 text-white/80 active:bg-cyan-500/80 active:border-cyan-300 active:scale-95 transition-all flex flex-col items-center justify-center shadow-lg"
          style={{ touchAction: 'none' }}
          aria-label="Salto"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
};
