import { useEffect, useState } from 'react';
import { Loader } from './Loader';
import { useStore } from '../store';
import { Menu } from './Menu';
import { SetupScreen } from './Setup';
import { GameScreen } from './Game';
import { RulesScreen } from './Rules';
import { EditorScreen } from './Editor';
import { JoinScreen } from './Join';
import { LobbyScreen } from './Lobby';
import { Toasts } from './Toasts';

export function App() {
  const { screen, data, loadData } = useStore();
  const [ready, setReady] = useState(false);
  useEffect(() => { if (ready) loadData(); }, [ready, loadData]);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('join')) useStore.getState().setScreen('join');
  }, []);
  if (!ready) return <Loader onReady={() => setReady(true)} />;
  if (!data) return <div className="loading"><div className="spinner" />Загрузка…</div>;
  return (
    <>
      {screen === 'menu' && <Menu />}
      {screen === 'setup' && <SetupScreen />}
      {screen === 'game' && <GameScreen />}
      {screen === 'rules' && <RulesScreen />}
      {screen === 'editor' && <EditorScreen />}
      {screen === 'join' && <JoinScreen />}
      {screen === 'lobby' && <LobbyScreen />}
      <Toasts />
    </>
  );
}
