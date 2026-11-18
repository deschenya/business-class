import { useEffect, useState } from 'react';
import { hasLanServer, lastRoom, roomCodes, saves, useStore } from '../store';
import { Shell, stagger } from './Shell';

export function Menu() {
  const { setScreen, loadState, toast, openLobby, leave, join, net } = useStore();
  const room = lastRoom();
  const [lan, setLan] = useState(false);
  useEffect(() => { hasLanServer().then(setLan); }, []);
  const [list, setList] = useState(saves.list());
  const open = async (id: string, asHost = false) => {
    const s = saves.get(id);
    if (!s) return toast('Сохранение повреждено', 'bad');
    leave();
    // тем же способом связи и с тем же кодом, что и раньше — друзья переподключатся сами
    if (asHost) { const prev = roomCodes.get(s.id); await openLobby(prev?.kind ?? (lan ? 'ws' : 'p2p'), null, s); return; }
    loadState(s);
  };
  let k = 0;
  return (
    <Shell>
      <img className="shell-logo" src="art/logo.webp" alt="Бизнес-Класс!!!" />
      <div className="menu-buttons">
        <button className="btn gold big shine enter" style={stagger(k++)} onClick={() => setScreen('setup')}>Начать партию</button>
        <button className="btn big enter" style={stagger(k++)} onClick={() => setScreen('join')}>Присоединиться</button>
      </div>
      {(list.length > 0 || room) && (
        <section className="saves glass enter" style={stagger(k++)}>
          <h2>Мои партии</h2>
          <div className="saves-list">
            {room && (
              <div className="save-row room enter" style={stagger(k++)} onClick={() => { if (net.status !== 'connecting') { setScreen('join'); join(room.code, room.kind, room.server, room.name); } }}>
                <div className="save-main">
                  <b>Сетевая партия · комната {room.code}</b>
                  <span className="muted small">вы играли как «{room.name}» — вернуться за свою фишку</span>
                </div>
                <span className="save-go">↻ Вернуться</span>
              </div>
            )}
            {list.map((m) => (
              <div key={m.id} className="save-row enter" style={stagger(k++)} onClick={() => open(m.id)}>
                <div className="save-main">
                  <b>{m.title}</b>
                  <span className="muted small">{m.players.join(', ')} · ход {m.turn} · {new Date(m.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="save-actions">
                  <span className="save-go" title="Продолжить на этом устройстве">▶ Играть</span>
                  <button className="btn sm" title="Продолжить по сети: друзья подключатся по ссылке" onClick={(e) => { e.stopPropagation(); open(m.id, true); }}>🌐 Хост</button>
                  <button className="icon-btn" title="Удалить" onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить сохранение «${m.title}»?`)) { saves.remove(m.id); setList(saves.list()); } }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="menu-links enter" style={stagger(k++)}>
        <button className="menu-link" onClick={() => setScreen('rules')}><span>📖</span>Правила и словарь</button>
        <button className="menu-link" onClick={() => setScreen('editor')}><span>🗂️</span>Справочники</button>
      </div>
      {net.mode === 'host' && net.status === 'connecting' && (
        <div className="reconnect-back"><div className="reconnect glass"><span className="spinner" /><h3>Открываем комнату {net.code}</h3><p className="muted">{net.error ?? 'Подключаемся к серверу соединения…'}</p><button className="btn ghost" onClick={() => leave()}>Отмена</button></div></div>
      )}
    </Shell>
  );
}
