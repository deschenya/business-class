import { useState } from 'react';
import { saves, useStore } from '../store';

export function Menu() {
  const { setScreen, loadState, toast } = useStore();
  const [list, setList] = useState(saves.list());
  const last = list[0];
  const open = (id: string) => { const s = saves.get(id); if (s) loadState(s); else toast('Сохранение повреждено', 'bad'); };
  return (
    <div className="menu" style={{ backgroundImage: 'url(art/title_bg.jpg)' }}>
      <div className="menu-shade" />
      <div className="menu-left">
        <img className="menu-logo" src="art/logo.webp" alt="Бизнес-класс!!!" />
        <p className="menu-sub">Финансово-экономическая настольная игра</p>
        <div className="menu-buttons">
          {last && <button className="btn gold big" onClick={() => open(last.id)}>Продолжить «{last.title}»</button>}
          <button className={`btn big ${last ? '' : 'gold'}`} onClick={() => setScreen('setup')}>Новая партия</button>
          <button className="btn big" onClick={() => setScreen('join')}>Присоединиться к другу</button>
          <div className="row">
            <button className="btn" onClick={() => setScreen('rules')}>Правила и словарь</button>
            <button className="btn" onClick={() => setScreen('editor')}>Справочники</button>
          </div>
        </div>
      </div>
      <aside className="menu-right glass">
        <div className="saves-head">
          <h2>Мои партии</h2>
        </div>
        {list.length === 0 && <p className="muted small">Пока нет сохранённых партий. Партия сохраняется автоматически после каждого действия.</p>}
        <div className="saves-list">
          {list.map((m) => (
            <div key={m.id} className="save-row" onClick={() => open(m.id)}>
              <div className="save-main">
                <b>{m.title}</b>
                <span className="muted small">{m.players.join(', ')}</span>
                <span className="muted small">ход {m.turn} · {new Date(m.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <button className="icon-btn" title="Удалить" onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить сохранение «${m.title}»?`)) { saves.remove(m.id); setList(saves.list()); } }}>✕</button>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
