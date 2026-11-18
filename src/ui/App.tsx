import { useEffect, useState } from 'react';
import { Loader } from './Loader';
import { Shell } from './Shell';
import { lastRoom, useStore } from '../store';
import { Menu } from './Menu';
import { SetupScreen } from './Setup';
import { GameScreen } from './Game';
import { RulesScreen } from './Rules';
import { EditorScreen } from './Editor';
import { JoinScreen } from './Join';
import { LobbyScreen } from './Lobby';
import { Toasts } from './Toasts';
import { ReconnectOverlay } from './Reconnect';

const SHELL = ['menu', 'setup', 'join', 'lobby'];

export function App() {
  const { screen, data, loadData } = useStore();
  const [ready, setReady] = useState(false);
  useEffect(() => { if (ready) loadData(); }, [ready, loadData]);
  useEffect(() => {
    if (!ready) return;
    const q = new URLSearchParams(location.search);
    const code = q.get('join');
    if (!code) return;
    // ссылка-приглашение: если это та же комната, где мы уже были (перезагрузка/вылет) — возвращаемся сразу
    const r = lastRoom();
    if (r && r.code === code.toUpperCase()) { useStore.getState().setScreen('join'); useStore.getState().join(r.code, r.kind, r.server, r.name); }
    else useStore.getState().setScreen('join');
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return <Loader onReady={() => setReady(true)} />;
  if (!data) return <div className="loading"><div className="spinner" />Загрузка…</div>;
  return (
    <>
      {SHELL.includes(screen) && (
        // оболочка с фоном и логотипом живёт, пока мы в меню: логотип не перезагружается, а плавно меняет размер
        <Shell logo={screen === 'menu' ? 'big' : 'small'} wide={screen === 'lobby' ? 'wide' : screen === 'setup' ? 'mid' : false}>
          <div key={screen} className="shell-screen">
            {screen === 'menu' && <Menu />}
            {screen === 'setup' && <SetupScreen />}
            {screen === 'join' && <JoinScreen />}
            {screen === 'lobby' && <LobbyScreen />}
          </div>
        </Shell>
      )}
      {screen === 'game' && <GameScreen />}
      {screen === 'rules' && <RulesScreen />}
      {screen === 'editor' && <EditorScreen />}
      <ReconnectOverlay />
      <Toasts />
    </>
  );
}
