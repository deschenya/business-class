import { useEffect, useState } from 'react';
import { hasLanServer, myName, useStore } from '../store';
import { ROLE_RU, type RoleId } from '../engine/types';
import { TutorToggle } from './Tutor';
import { PAWN_PALETTE, PawnIcon, colorName, fmt } from './helpers';
import type { SetupPlayer } from '../engine/engine';

const NAMES = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дарья', 'Егор', 'Жанна', 'Захар'];

export function SetupScreen() {
  const { newGame, setScreen, openLobby } = useStore();
  const [hostName, setHostName] = useState(myName());
  const [players, setPlayers] = useState<SetupPlayer[]>(() => [0, 1, 2].map((i) => ({ name: NAMES[i], color: PAWN_PALETTE[i].hex, avatar: '', lady: i % 2 === 0 })));
  const [roles, setRoles] = useState<Record<RoleId, number | 'host'>>({ banker: 'host', broker: 'host', chairman: 'host', inspector: 'host' });
  const [money, setMoney] = useState(350000);
  const [quote, setQuote] = useState(10000);
  const [stocks, setStocks] = useState(1);
  const [claim, setClaim] = useState(true);
  const [title, setTitle] = useState(`Партия ${new Date().toLocaleDateString('ru-RU')}`);
  const [mode, setMode] = useState<'local' | 'host'>('local');
  const [via, setVia] = useState<'p2p' | 'ws'>('p2p');
  const [lan, setLan] = useState(false);
  useEffect(() => { hasLanServer().then(setLan); }, []);
  const upd = (i: number, p: Partial<SetupPlayer>) => setPlayers((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const add = () => {
    const i = players.length;
    const color = PAWN_PALETTE.find((c) => !players.some((p) => p.color === c.hex))?.hex ?? '#888';
    setPlayers([...players, { name: NAMES[i] ?? `Игрок ${i + 1}`, color, avatar: '', lady: false }]);
  };
  const start = async () => {
    const settings = { startMoney: money, startQuote: quote, startStocks: stocks, rentNeedsClaim: claim };
    if (mode === 'host') {
      try { localStorage.setItem('bk.name', hostName); } catch { /* */ }
      // в сетевой игре роли ведёт хост: состав игроков станет известен только в лобби
      const hostRoles = { banker: 'host', broker: 'host', chairman: 'host', inspector: 'host' } as const;
      await openLobby(lan ? via : 'p2p', { title, roles: hostRoles, settings }, null, hostName);
      return;
    }
    newGame({ title, players, roles, settings });
  };
  return (
    <div className="screen setup">
      <header className="screen-head">
        <button className="btn ghost" onClick={() => setScreen('menu')}>← Меню</button>
        <h1>Подготовка партии</h1>
        <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </header>
      <div className="setup-grid">
        <section className="mode-pick wide">
          <button className={`mode-card glass ${mode === 'local' ? 'on' : ''}`} onClick={() => setMode('local')}>
            <span className="mode-ico">🖥️</span>
            <b>На одном устройстве</b>
            <span className="muted small">Все игроки ходят по очереди за этим экраном. Интернет не нужен.</span>
          </button>
          <button className={`mode-card glass ${mode === 'host' ? 'on' : ''}`} onClick={() => setMode('host')}>
            <span className="mode-ico">🌐</span>
            <b>Хост — играть по сети</b>
            <span className="muted small">Вы создаёте комнату, друзья открывают ссылку на своих устройствах и выбирают фишки. Партия хранится у вас.</span>
            {mode === 'host' && lan && (
              <span className="seg sm" onClick={(e) => e.stopPropagation()}>
                <span role="button" className={via === 'p2p' ? 'on' : ''} onClick={() => setVia('p2p')}>Через интернет</span>
                <span role="button" className={via === 'ws' ? 'on' : ''} onClick={() => setVia('ws')}>В локальной сети</span>
              </span>
            )}
          </button>
        </section>
{mode === 'local' ? (
        <section className="glass card wide">
          <h2>Игроки <span className="muted">({players.length})</span></h2>
          <p className="muted small">По правилам — 2–4 игрока; при большем числе добавьте фишки вручную.</p>
          {players.map((p, i) => (
            <div key={i} className="player-row">
              <span className="pawn-preview"><PawnIcon color={p.color} size={44} /></span>
              <div className="player-main">
                <div className="row">
                  <input value={p.name} onChange={(e) => upd(i, { name: e.target.value })} />
                  <span className="color-name" style={{ color: p.color }}>{colorName(p.color)}</span>
                  <span className="sex" title="Пол (нужен для карточки «Сюрприз» про даму)"><button className={!p.lady ? 'on' : ''} onClick={() => upd(i, { lady: false })}>М</button><button className={p.lady ? 'on' : ''} onClick={() => upd(i, { lady: true })}>Ж</button></span>
                  {players.length > 2 && <button className="icon-btn" onClick={() => setPlayers(players.filter((_, j) => j !== i))}>✕</button>}
                </div>
                <div className="swatches">
                  {PAWN_PALETTE.map((c) => {
                    const taken = players.some((x, j) => j !== i && x.color === c.hex);
                    return <button key={c.hex} title={taken ? `${c.name} — занят` : c.name} className={`swatch ${p.color === c.hex ? 'on' : ''}`} style={{ ['--sw' as any]: c.hex }} onClick={() => upd(i, { color: c.hex })} disabled={taken} />;
                  })}
                </div>
              </div>
            </div>
          ))}
          {players.length < 8 && <button className="btn" onClick={add}>+ Добавить фишку</button>}
        </section>
        ) : (
        <section className="glass card wide">
          <h2>Игроки</h2>
          <p className="muted small">Игроки соберутся в лобби: каждый, кто откроет вашу ссылку, получит свою фишку и сам выберет имя и цвет. Можно добавить и игроков за этим устройством.</p>
          <label className="field"><span>Ваше имя</span><input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Хост" /></label>
        </section>
        )}
        <details className="advanced glass">
          <summary>Дополнительные настройки <span className="muted small">— роли ведущих и стартовые ресурсы (можно не трогать)</span></summary>
          <div className="advanced-grid">
        <section>
          <h2>Роли ведущих</h2>
          <p className="muted small">Один человек может совмещать роли. «Ведущий» — тот, кто управляет хостом.</p>
          {(Object.keys(ROLE_RU) as RoleId[]).map((r) => (
            <label key={r} className="field">
              <span>{ROLE_RU[r]}</span>
              <select value={mode === 'host' ? 'host' : String(roles[r])} onChange={(e) => setRoles({ ...roles, [r]: e.target.value === 'host' ? 'host' : Number(e.target.value) })}>
                <option value="host">Ведущий (хост)</option>
                {mode === 'local' && players.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
              </select>
            </label>
          ))}
          <h2 style={{ marginTop: 18 }}>Стартовые ресурсы</h2>
          <label className="field"><span>Деньги</span><input type="number" step={1000} value={money} onChange={(e) => setMoney(Number(e.target.value))} /><em>{fmt(money)}</em></label>
          <label className="field"><span>Номинал акции</span><input type="number" step={1000} value={quote} onChange={(e) => setQuote(Number(e.target.value))} /><em>{fmt(quote)}</em></label>
          <label className="field"><span>Акций каждого цвета</span><input type="number" min={0} value={stocks} onChange={(e) => setStocks(Number(e.target.value))} /></label>
          <label className="check"><input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} /> Аренду нужно требовать до броска следующего игрока (по правилам)</label>
        </section>
          </div>
        </details>
      </div>
      <footer className="setup-foot">
        <TutorToggle />
        <button className="btn gold big" onClick={start} disabled={mode === 'local' && players.length < 2}>{mode === 'host' ? 'Создать комнату →' : 'Начать партию →'}</button>
      </footer>
    </div>
  );
}
