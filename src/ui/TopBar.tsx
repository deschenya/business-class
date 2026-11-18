import { useState } from 'react';
import { useStore } from '../store';
import { sceneRef } from './Game';
import { sfx } from './sound';
import { NetPanel } from './NetPanel';
import { tutor, useTutorOn } from './Tutor';

export function TopBar() {
  const { view, setScreen, net, leave, setDemo } = useStore();
  const [sound, setSound] = useState(sfx.on);
  const [netOpen, setNetOpen] = useState(false);
  const [follow, setFollow] = useState(true);
  const tutorOn = useTutorOn();
  if (!view) return null;
  const exit = () => { setDemo(null); if (net.mode !== 'local' && !confirm(net.mode === 'host' ? 'Выйти в меню? Комната закроется, все игроки будут отключены. Партия сохранится у вас.' : 'Выйти из сетевой игры?')) return; if (net.mode !== 'local') leave(); setScreen('menu'); };
  return (
    <div className="topbar">
      <button className="btn ghost sm" onClick={exit}>☰ Меню</button>
      <img src="art/logo.webp" className="top-logo" alt="" />
      <span className="top-title">{view.title} · ход {view.turn.n}</span>
      <div className="spacer" />
      <div className="seg sm">
        <button onClick={() => sceneRef?.resetView()} title="Обзор">Обзор</button>
        <button onClick={() => sceneRef?.topView()} title="Сверху">Сверху</button>
        <button className={follow ? 'on' : ''} onClick={() => { const f = !follow; setFollow(f); if (sceneRef) sceneRef.follow = f; }} title="Камера следует за фишкой">Следить</button>
      </div>
      {net.mode !== 'local' && <button className={`btn sm ${net.status === 'online' ? 'online' : ''}`} onClick={() => setNetOpen(!netOpen)}>
        {net.mode === 'host' ? `Хост ${net.code ?? ''} · ${net.peers.length}` : `Клиент ${net.code ?? ''}`}
      </button>}
      <button className={`btn sm ${tutorOn ? 'on-gold' : ''}`} title="Обучение: подсказки по правилам во время хода" onClick={() => tutor.set(!tutorOn)}>Обучение</button>
      <button className="btn sm" onClick={() => setScreen('rules')}>Правила</button>
      <button className="icon-btn" onClick={() => setSound(sfx.toggle())} title="Звук">{sound ? '🔊' : '🔇'}</button>
      {netOpen && net.mode !== 'local' && <NetPanel onClose={() => setNetOpen(false)} />}
    </div>
  );
}
