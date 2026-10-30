import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  initAraLibrary,
  buildAraCharacter,
  createThreeCharacter,
  getAraPresets,
  type AraCharacterInstance,
} from '../ara3d/araManager';
import type { HumanParams } from '../ara3d/core/params';
import {
  Sparkles,
  User,
  Scissors,
  Shirt,
  Shield,
  RotateCcw,
  Play,
  ZoomIn,
  Check,
  ChevronRight,
  Loader2,
} from 'lucide-react';

interface CharacterCreatorProps {
  onEnterWorld: (avatar: AraCharacterInstance, params: HumanParams) => void;
}

type TabType = 'presets' | 'body' | 'face' | 'hair' | 'clothing' | 'weapons';

const HAIR_OPTIONS = [
  { id: 'buzz', label: 'Buzz Cut' },
  { id: 'mohawk', label: 'Punk Mohawk' },
  { id: 'cornrows', label: 'Cornrows' },
  { id: 'box_braids', label: 'Box Braids' },
  { id: 'none', label: 'Careca' },
];

const BEARD_OPTIONS = [
  { id: 'none', label: 'Limpo' },
  { id: 'stubble', label: 'Por Fazer' },
  { id: 'mustache', label: 'Bigode' },
  { id: 'goatee', label: 'Cavanhaque' },
  { id: 'short_beard', label: 'Barba Curta' },
  { id: 'full_beard', label: 'Barba Cheia' },
];

const FABRIC_PATTERNS = [
  { id: 'solid', label: 'Sólido' },
  { id: 'techwear', label: 'Techwear' },
  { id: 'camo', label: 'Camuflagem' },
  { id: 'kente', label: 'Kente Africano' },
  { id: 'asooke', label: 'Aso-Oke' },
  { id: 'ankara', label: 'Ankara' },
  { id: 'denim', label: 'Denim' },
  { id: 'leather', label: 'Couro' },
];

const WEAPON_OPTIONS = [
  { id: 'sword', label: 'Espada de Aço' },
  { id: 'rifle', label: 'Rifle de Assalto' },
  { id: 'pistol', label: 'Pistola Tática' },
  { id: 'knife', label: 'Faca de Combate' },
  { id: 'none', label: 'Sem Arma' },
];

const EYE_COLORS = [
  { id: 'blackbrown', label: 'Castanho Escuro', hex: '#261b14' },
  { id: 'brownlight', label: 'Castanho Claro', hex: '#634e3a' },
  { id: 'green', label: 'Verde Esmeralda', hex: '#2e5b38' },
  { id: 'lightblue', label: 'Azul Claro', hex: '#4a82b4' },
  { id: 'ice', label: 'Gelo Glacial', hex: '#87ceeb' },
];

const HAIR_COLORS = [
  { hex: '#161311', label: 'Preto Natural' },
  { hex: '#3d2b1f', label: 'Castanho' },
  { hex: '#a88950', label: 'Loiro' },
  { hex: '#8b3a1a', label: 'Ruivo' },
  { hex: '#b0b5be', label: 'Prateado' },
  { hex: '#00d2ff', label: 'Ciano Neon' },
  { hex: '#d946ef', label: 'Magenta' },
];

export const CharacterCreator: React.FC<CharacterCreatorProps> = ({ onEnterWorld }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const presets = getAraPresets();

  const [activeTab, setActiveTab] = useState<TabType>('presets');
  const [selectedPreset, setSelectedPreset] = useState<string>('The Adventurer');
  const [isBuilding, setIsBuilding] = useState<boolean>(false);
  const [previewClip, setPreviewClip] = useState<string>('idle');

  // Character parameters state
  const [params, setParams] = useState<Partial<HumanParams>>({
    name: 'Adventurer',
    gender: 0.5,
    muscle: 0.7,
    weight: 0.45,
    height: 0.5,
    age: 0.45,
    african: 0.4,
    asian: 0.3,
    caucasian: 0.3,
    eyes: 'brownlight',
    hair: 'buzz',
    hairColor: '#161311',
    facialHair: 'stubble',
    weapon: 'sword',
    outfit: 'none',
    top: 'tank_top',
    bottom: 'cargo_shorts',
    shoes: 'combat_boots',
    garmentStyles: {
      tank_top: { pattern: 'techwear', color: '#242c38', color2: '#00d2ff' },
      cargo_shorts: { pattern: 'khaki', color: '#4a5568' },
    },
  });

  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const avatarInstanceRef = useRef<AraCharacterInstance | null>(null);
  const hasTransferredRef = useRef(false);

  // Setup 3D Studio Scene
  useEffect(() => {
    if (!mountRef.current) return;
    const container = mountRef.current;
    const w = container.clientWidth || 600;
    const h = container.clientHeight || 700;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0e1422);
    sceneRef.current = scene;

    // PMREM Environment Reflections
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    // Studio 3-point Lighting Rig
    const keyLight = new THREE.DirectionalLight(0xfff5ea, 2.6);
    keyLight.position.set(3, 5, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.bias = -0.0003;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x70b8ff, 1.4);
    rimLight.position.set(-4, 4, -3);
    scene.add(rimLight);

    const fillLight = new THREE.HemisphereLight(0xb0d8ff, 0x1e2430, 0.85);
    scene.add(fillLight);

    // Studio Pedestal Floor
    const pedestalGeo = new THREE.CylinderGeometry(2.2, 2.4, 0.15, 48);
    pedestalGeo.translate(0, -0.075, 0);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: 0x161e2e,
      roughness: 0.65,
      metalness: 0.25,
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.receiveShadow = true;
    scene.add(pedestal);

    // Camera & Controls
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 50);
    camera.position.set(0, 1.35, 3.6);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 0.95, 0);
    controls.minDistance = 0.8;
    controls.maxDistance = 6.0;
    controls.maxPolarAngle = Math.PI / 2 + 0.05;
    controlsRef.current = controls;

    let animId = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      controls.update();

      if (avatarInstanceRef.current) {
        avatarInstanceRef.current.updateAnimation(previewClip as 'idle' | 'walk' | 'run' | 'jump', delta);
      }

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const nw = mountRef.current.clientWidth;
      const nh = mountRef.current.clientHeight;
      cameraRef.current.aspect = nw / nh;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(nw, nh);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animId);
      if (avatarInstanceRef.current && !hasTransferredRef.current) {
        avatarInstanceRef.current.dispose();
      }
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Build & Rebuild character mesh on parameter change
  const rebuildCharacter = useCallback(async (currentParams: Partial<HumanParams>) => {
    if (!sceneRef.current) return;
    setIsBuilding(true);
    try {
      const lib = await initAraLibrary();
      const ch = await buildAraCharacter(currentParams, lib);

      // Remove existing instance
      if (avatarInstanceRef.current) {
        sceneRef.current.remove(avatarInstanceRef.current.group);
        avatarInstanceRef.current.dispose();
      }

      const instance = createThreeCharacter(ch, lib);
      avatarInstanceRef.current = instance;
      sceneRef.current.add(instance.group);
    } catch (err) {
      console.error('Failed to build Ara character:', err);
    } finally {
      setIsBuilding(false);
    }
  }, []);

  // Initial build with selected preset
  useEffect(() => {
    const presetData = presets[selectedPreset] || {};
    const merged = { ...params, ...presetData };
    setParams(merged);
    rebuildCharacter(merged);
  }, []);

  const handleSelectPreset = (presetName: string) => {
    setSelectedPreset(presetName);
    const presetData = presets[presetName] || {};
    const updated = { ...params, ...presetData, name: presetName };
    setParams(updated);
    rebuildCharacter(updated);
  };

  const updateParam = (key: keyof HumanParams, value: unknown) => {
    const updated = { ...params, [key]: value };
    setParams(updated);
    rebuildCharacter(updated);
  };

  const handleFocus = (mode: 'full' | 'face') => {
    if (!controlsRef.current || !cameraRef.current) return;
    if (mode === 'face') {
      controlsRef.current.target.set(0, 1.55, 0);
      cameraRef.current.position.set(0, 1.58, 0.95);
    } else {
      controlsRef.current.target.set(0, 0.95, 0);
      cameraRef.current.position.set(0, 1.35, 3.6);
    }
  };

  const handleConfirm = () => {
    if (avatarInstanceRef.current) {
      hasTransferredRef.current = true;
      if (sceneRef.current) {
        sceneRef.current.remove(avatarInstanceRef.current.group);
      }
      onEnterWorld(avatarInstanceRef.current, params as HumanParams);
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col md:flex-row bg-slate-950 text-white overflow-hidden select-none">
      {/* 3D Character Studio Viewport */}
      <div className="relative flex-1 w-full h-[45vh] md:h-full overflow-hidden">
        <div ref={mountRef} className="w-full h-full" />

        {/* Studio Overlays */}
        <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
          <div className="px-3.5 py-1.5 rounded-full bg-slate-900/80 border border-slate-700/60 backdrop-blur-md text-xs font-semibold tracking-wide text-cyan-300 flex items-center gap-2 shadow-lg">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Studio de Criação Ara 3D</span>
          </div>
          {isBuilding && (
            <div className="px-3 py-1.5 rounded-full bg-slate-900/80 border border-cyan-500/40 text-cyan-400 text-xs flex items-center gap-1.5 animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Gerando malha...</span>
            </div>
          )}
        </div>

        {/* View Camera Mode Toggles */}
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleFocus('face')}
            className="px-3 py-1.5 rounded-lg bg-slate-900/70 border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
            <span>Focar Rosto</span>
          </button>
          <button
            type="button"
            onClick={() => handleFocus('full')}
            className="px-3 py-1.5 rounded-lg bg-slate-900/70 border border-slate-700 hover:bg-slate-800 text-xs text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Corpo Inteiro</span>
          </button>
        </div>

        {/* Bottom Animation Tester Bar */}
        <div className="absolute bottom-4 left-4 right-4 z-10 flex justify-center pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-slate-900/85 border border-slate-800/80 backdrop-blur-md shadow-xl">
            <span className="text-[11px] font-medium text-slate-400 mr-2 flex items-center gap-1">
              <Play className="w-3 h-3 text-cyan-400" />
              Testar Animação:
            </span>
            {(['idle', 'walk', 'run', 'jump'] as const).map((clip) => (
              <button
                key={clip}
                type="button"
                onClick={() => setPreviewClip(clip)}
                className={`px-3 py-1 rounded-xl text-xs font-semibold capitalize transition-all cursor-pointer ${
                  previewClip === clip
                    ? 'bg-cyan-500 text-black shadow-md shadow-cyan-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {clip === 'idle' ? 'Parado' : clip === 'walk' ? 'Andar' : clip === 'run' ? 'Correr' : 'Salto'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Customization Side Panel */}
      <div className="w-full md:w-[420px] lg:w-[460px] h-[55vh] md:h-full bg-slate-900/95 border-t md:border-t-0 md:border-l border-slate-800 flex flex-col z-20 shadow-2xl">
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 p-2 gap-1 overflow-x-auto scrollbar-none">
          {[
            { id: 'presets', label: 'Arquétipos', icon: Sparkles },
            { id: 'body', label: 'Biotipo', icon: User },
            { id: 'hair', label: 'Cabelo', icon: Scissors },
            { id: 'clothing', label: 'Vestuário', icon: Shirt },
            { id: 'weapons', label: 'Armamento', icon: Shield },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as TabType)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Content Panels */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* TAB 1: PRESETS */}
          {activeTab === 'presets' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Arquétipos Prontos Ara 3D</h3>
                <p className="text-xs text-slate-400">Escolha uma base e personalize os detalhes nas outras abas.</p>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {Object.keys(presets).map((name) => {
                  const isSelected = selectedPreset === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => handleSelectPreset(name)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between h-20 ${
                        isSelected
                          ? 'bg-gradient-to-br from-cyan-950/60 to-slate-900 border-cyan-500 shadow-lg shadow-cyan-950/50'
                          : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
                      }`}
                    >
                      <span className="text-xs font-bold text-slate-200 line-clamp-1">{name}</span>
                      <div className="flex items-center justify-between mt-auto">
                        <span className="text-[10px] text-slate-500">Preset Oficial</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: BODY & MORPHOLOGY */}
          {activeTab === 'body' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Morfologia e Físico</h3>
                <p className="text-xs text-slate-400">Slidadores morfométricos MakeHuman calculados em tempo real.</p>
              </div>

              {/* Sliders */}
              <div className="space-y-4 bg-slate-950/40 p-4 rounded-2xl border border-slate-800/80">
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-300">Gênero Corporal</span>
                    <span className="text-cyan-400 font-mono text-[11px]">
                      {params.gender && params.gender > 0.5 ? 'Masculino' : 'Feminino'}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={params.gender ?? 0.5}
                    onChange={(e) => updateParam('gender', parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-300">Definição Muscular</span>
                    <span className="text-cyan-400 font-mono text-[11px]">{Math.round((params.muscle ?? 0.5) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={params.muscle ?? 0.5}
                    onChange={(e) => updateParam('muscle', parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-300">Peso / Massa</span>
                    <span className="text-cyan-400 font-mono text-[11px]">{Math.round((params.weight ?? 0.5) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={params.weight ?? 0.5}
                    onChange={(e) => updateParam('weight', parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-300">Altura</span>
                    <span className="text-cyan-400 font-mono text-[11px]">{Math.round((params.height ?? 0.5) * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={params.height ?? 0.5}
                    onChange={(e) => updateParam('height', parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-300">Idade</span>
                    <span className="text-cyan-400 font-mono text-[11px]">{Math.round((params.age ?? 0.45) * 80 + 10)} anos</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="0.9"
                    step="0.05"
                    value={params.age ?? 0.45}
                    onChange={(e) => updateParam('age', parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>
              </div>

              {/* Eye Color */}
              <div>
                <span className="text-xs font-semibold text-slate-300 mb-2 block">Cor dos Olhos</span>
                <div className="flex gap-2">
                  {EYE_COLORS.map((eye) => (
                    <button
                      key={eye.id}
                      type="button"
                      onClick={() => updateParam('eyes', eye.id)}
                      className={`flex-1 py-2 px-1 rounded-xl border text-[11px] font-medium flex flex-col items-center gap-1 transition-all cursor-pointer ${
                        params.eyes === eye.id
                          ? 'border-cyan-400 bg-cyan-950/40 text-cyan-200'
                          : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <span className="w-3.5 h-3.5 rounded-full border border-white/20" style={{ backgroundColor: eye.hex }} />
                      <span className="truncate w-full text-center">{eye.label.split(' ')[0]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: HAIR & BEARD */}
          {activeTab === 'hair' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Cabelo e Barba</h3>
                <p className="text-xs text-slate-400">Estilos de penteados procedurais e pelos faciais.</p>
              </div>

              {/* Hairstyle */}
              <div>
                <span className="text-xs font-semibold text-slate-300 mb-2 block">Penteado</span>
                <div className="grid grid-cols-2 gap-2">
                  {HAIR_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updateParam('hair', opt.id)}
                      className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer flex justify-between items-center ${
                        params.hair === opt.id
                          ? 'border-cyan-400 bg-cyan-950/40 text-cyan-200'
                          : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {params.hair === opt.id && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Hair Color Palette */}
              <div>
                <span className="text-xs font-semibold text-slate-300 mb-2 block">Cor do Cabelo</span>
                <div className="flex flex-wrap gap-2.5">
                  {HAIR_COLORS.map((col) => (
                    <button
                      key={col.hex}
                      type="button"
                      onClick={() => updateParam('hairColor', col.hex)}
                      title={col.label}
                      className={`w-8 h-8 rounded-full border transition-all cursor-pointer relative ${
                        params.hairColor === col.hex ? 'border-cyan-400 scale-110 shadow-lg shadow-cyan-500/30' : 'border-white/20 hover:scale-105'
                      }`}
                      style={{ backgroundColor: col.hex }}
                    >
                      {params.hairColor === col.hex && (
                        <Check className="w-4 h-4 text-white absolute inset-0 m-auto drop-shadow" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Facial Hair */}
              <div>
                <span className="text-xs font-semibold text-slate-300 mb-2 block">Barba / Pelos Faciais</span>
                <div className="grid grid-cols-2 gap-2">
                  {BEARD_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => updateParam('facialHair', opt.id)}
                      className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer flex justify-between items-center ${
                        params.facialHair === opt.id
                          ? 'border-cyan-400 bg-cyan-950/40 text-cyan-200'
                          : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <span>{opt.label}</span>
                      {params.facialHair === opt.id && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CLOTHING & FABRICS */}
          {activeTab === 'clothing' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Tecidos e Vestuário</h3>
                <p className="text-xs text-slate-400">Padrões procedurais autênticos do Ara 3D Gen.</p>
              </div>

              <div>
                <span className="text-xs font-semibold text-slate-300 mb-2 block">Padrão de Tecido do Traje</span>
                <div className="grid grid-cols-2 gap-2">
                  {FABRIC_PATTERNS.map((pat) => {
                    const currentPattern = params.garmentStyles?.tank_top?.pattern || 'solid';
                    const isSelected = currentPattern === pat.id;
                    return (
                      <button
                        key={pat.id}
                        type="button"
                        onClick={() => {
                          const updatedStyles = {
                            ...params.garmentStyles,
                            tank_top: { ...(params.garmentStyles?.tank_top || {}), pattern: pat.id },
                            cargo_shorts: { ...(params.garmentStyles?.cargo_shorts || {}), pattern: pat.id },
                          };
                          updateParam('garmentStyles', updatedStyles);
                        }}
                        className={`p-3 rounded-xl border text-left text-xs font-medium transition-all cursor-pointer flex justify-between items-center ${
                          isSelected
                            ? 'border-cyan-400 bg-cyan-950/40 text-cyan-200 shadow-sm'
                            : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        <span>{pat.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: WEAPONS */}
          {activeTab === 'weapons' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-white mb-1">Armamento e Empunhadura</h3>
                <p className="text-xs text-slate-400">Equipamento acoplado ao socket WeaponR do rig.</p>
              </div>

              <div className="space-y-2">
                {WEAPON_OPTIONS.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => updateParam('weapon', w.id)}
                    className={`w-full p-3.5 rounded-xl border text-left text-xs font-semibold transition-all cursor-pointer flex justify-between items-center ${
                      params.weapon === w.id
                        ? 'border-cyan-400 bg-cyan-950/40 text-cyan-200 shadow-md'
                        : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span>{w.label}</span>
                    {params.weapon === w.id && <Check className="w-4 h-4 text-cyan-400" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Enter World Action Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800">
          <button
            type="button"
            disabled={isBuilding}
            onClick={handleConfirm}
            className="w-full py-3.5 px-5 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 via-sky-400 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black shadow-lg shadow-cyan-500/25 transition-all transform active:scale-98 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <span>Confirmar e Entrar no Mundo Aberto</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
