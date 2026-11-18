import { useEffect, useState } from 'react';
import { hasLanServer, saves, useStore } from '../store';

export function Menu() {
  const { setScreen, loadState, toast, openLobby, leave } = useStore();
  const [lan, setLan] = useState(false);
  useEffect(() => { hasLanServer().then(setLan); }, []);
  const [list, setList] = useState(saves.list());
  const last = list[0];
  const open = async (id: string, asHost = false) => {
    const s = saves.get(id);
    if (!s) return toast('Сохранение повреждено', 'bad');
    leave();
    if (asHost) { await openLobby(lan ? 'ws' : 'p2p', null, s); return; } // друзья займут свои фишки в лобби
    loadState(s);
  };
  return (
    <div className="menu" style={{ backgroundImage: 'url(art/title_bg.jpg)' }}>
      <div className="menu-shade" />
      <div className="menu-left">
        <img className="menu-logo" src="art/logo.webp" alt="Бизнес-класс!!!" />
        <div className="menu-buttons">
          {last && <button className="btn gold big" onClick={() => open(last.id)}>Продолжить «{last.title}»</button>}
          <button className={`btn big ${last ? '' : 'gold'}`} onClick={() => setScreen('setup')}>Новая партия</button>
          <button className="btn big" onClick={() => setScreen('join')}>Присоединиться к другу</button>
        </div>
        <div className="menu-links">
          <button className="menu-link" onClick={() => setScreen('rules')}><span>📖</span>Правила и словарь</button>
          <button className="menu-link" onClick={() => setScreen('editor')}><span>🗂️</span>Справочники</button>
        </div>
      </div>
      <aside className="menu-right glass">
        <div className="saves-head">
          <h2>Мои партии</h2>
        </div>
        {list.length === 0 && <p className="muted small">Пока нет сохранённых партий. Партия сохраняется автоматически после каждого действия.</p>}
        <div className="saves-list">
          {list.map((m) => (
            <div key={m.id} className="save-row" title="Продолжить на этом устройстве" onClick={() => open(m.id)}>
              <div className="save-main">
                <b>{m.title}</b>
                <span className="muted small">{m.players.join(', ')}</span>
                <span className="muted small">ход {m.turn} · {new Date(m.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <button className="btn sm" title="Продолжить как хост — друзья подключатся по ссылке" onClick={(e) => { e.stopPropagation(); open(m.id, true); }}>🌐 Хост</button>
              <button className="icon-btn" title="Удалить" onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить сохранение «${m.title}»?`)) { saves.remove(m.id); setList(saves.list()); } }}>✕</button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
