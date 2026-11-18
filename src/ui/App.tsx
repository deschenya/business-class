import { useEffect } from 'react';
import { useStore } from '../store';
import { Menu } from './Menu';
import { SetupScreen } from './Setup';
import { GameScreen } from './Game';
import { RulesScreen } from './Rules';
import { EditorScreen } from './Editor';
import { JoinScreen } from './Join';
import { Toasts } from './Toasts';

export function App() {
  const { screen, data, loadData } = useStore();
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    if (q.get('join')) useStore.getState().setScreen('join');
  }, []);
  if (!data) return <div className="loading"><div className="spinner" />Загрузка…</div>;
  return (
    <>
      {screen === 'menu' && <Menu />}
      {screen === 'setup' && <SetupScreen />}
      {screen === 'game' && <GameScreen />}
      {screen === 'rules' && <RulesScreen />}
      {screen === 'editor' && <EditorScreen />}
      {screen === 'join' && <JoinScreen />}
      <Toasts />
    </>
  );
}
