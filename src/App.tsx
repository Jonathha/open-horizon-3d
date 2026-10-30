/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { LoadingScreen } from './components/LoadingScreen';
import { CharacterCreator } from './components/CharacterCreator';
import { GameCanvas } from './components/GameCanvas';
import {
  initAraLibrary,
  type AraLoadingProgress,
  type AraCharacterInstance,
} from './ara3d/araManager';
import type { HumanParams } from './ara3d/core/params';

type AppState = 'loading' | 'creator' | 'world';

export default function App() {
  const [appState, setAppState] = useState<AppState>('loading');
  const [loadingProgress, setLoadingProgress] = useState<AraLoadingProgress>({
    stage: 'Iniciando carregador de ativos Ara 3D...',
    percent: 5,
  });
  const [isReady, setIsReady] = useState(false);
  const [activeAvatar, setActiveAvatar] = useState<AraCharacterInstance | null>(null);

  useEffect(() => {
    let mounted = true;
    initAraLibrary((prog) => {
      if (mounted) {
        setLoadingProgress(prog);
        if (prog.percent >= 100) {
          setIsReady(true);
        }
      }
    }).catch((err) => {
      console.error('Erro na inicialização da biblioteca Ara:', err);
      if (mounted) {
        setLoadingProgress({
          stage: 'Pronto com recursos locais e procedurais',
          percent: 100,
        });
        setIsReady(true);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleEnterWorld = (avatar: AraCharacterInstance, _params: HumanParams) => {
    setActiveAvatar(avatar);
    setAppState('world');
  };

  return (
    <main className="w-screen h-screen overflow-hidden bg-slate-950 font-sans">
      {appState === 'loading' && (
        <LoadingScreen
          progress={loadingProgress}
          isReady={isReady}
          onComplete={() => setAppState('world')}
        />
      )}

      {appState === 'creator' && (
        <CharacterCreator onEnterWorld={handleEnterWorld} />
      )}

      {appState === 'world' && (
        <GameCanvas
          customAvatar={activeAvatar}
          onOpenCreator={() => setAppState('creator')}
        />
      )}
    </main>
  );
}
