import { useEffect, useState } from 'react';
import { hasLanServer, useStore } from '../store';
import { RULINGS, DEFAULT_RULINGS } from '../engine/rulings';
import { ROLE_RU, type RoleId } from '../engine/types';
import { PAWN_PALETTE, PawnIcon, colorName, fmt } from './helpers';
import type { SetupPlayer } from '../engine/engine';

const NAMES = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дарья', 'Егор', 'Жанна', 'Захар'];

export function SetupScreen() {
  const { newGame, setScreen, hostOnline, net } = useStore();
  const [players, setPlayers] = useState<SetupPlayer[]>(() => [0, 1, 2].map((i) => ({ name: NAMES[i], color: PAWN_PALETTE[i].hex, avatar: '', lady: i % 2 === 0 })));
  const [roles, setRoles] = useState<Record<RoleId, number | 'host'>>({ banker: 'host', broker: 'host', chairman: 'host', inspector: 'host' });
  const [money, setMoney] = useState(350000);
  const [quote, setQuote] = useState(10000);
  const [stocks, setStocks] = useState(1);
  const [claim, setClaim] = useState(true);
  const [rulings, setRulings] = useState({ ...DEFAULT_RULINGS });
  const [title, setTitle] = useState(`Партия ${new Date().toLocaleDateString('ru-RU')}`);
  const [online, setOnline] = useState<'none' | 'ws' | 'p2p'>('none');
  const [lan, setLan] = useState(false);
  useEffect(() => { hasLanServer().then(setLan); }, []);
  const upd = (i: number, p: Partial<SetupPlayer>) => setPlayers((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const add = () => {
    const i = players.length;
    const color = PAWN_PALETTE.find((c) => !players.some((p) => p.color === c.hex))?.hex ?? '#888';
    setPlayers([...players, { name: NAMES[i] ?? `Игрок ${i + 1}`, color, avatar: '', lady: false }]);
  };
  const start = async () => {
    if (online !== 'none' && net.mode !== 'host') await hostOnline(online);
    newGame({ title, players, roles, settings: { startMoney: money, startQuote: quote, startStocks: stocks, rentNeedsClaim: claim }, rulings });
  };
  return (
    <div className="screen setup">
      <header className="screen-head">
        <button className="btn ghost" onClick={() => setScreen('menu')}>← Меню</button>
        <h1>Подготовка партии</h1>
        <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </header>
      <div className="setup-grid">
        <section className="glass card">
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
        <section className="glass card">
          <h2>Роли ведущих</h2>
          <p className="muted small">Один человек может совмещать роли. «Ведущий» — тот, кто управляет хостом.</p>
          {(Object.keys(ROLE_RU) as RoleId[]).map((r) => (
            <label key={r} className="field">
              <span>{ROLE_RU[r]}</span>
              <select value={String(roles[r])} onChange={(e) => setRoles({ ...roles, [r]: e.target.value === 'host' ? 'host' : Number(e.target.value) })}>
                <option value="host">Ведущий (хост)</option>
                {players.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
              </select>
            </label>
          ))}
          <h2 style={{ marginTop: 18 }}>Стартовые ресурсы</h2>
          <label className="field"><span>Деньги</span><input type="number" step={1000} value={money} onChange={(e) => setMoney(Number(e.target.value))} /><em>{fmt(money)}</em></label>
          <label className="field"><span>Номинал акции</span><input type="number" step={1000} value={quote} onChange={(e) => setQuote(Number(e.target.value))} /><em>{fmt(quote)}</em></label>
          <label className="field"><span>Акций каждого цвета</span><input type="number" min={0} value={stocks} onChange={(e) => setStocks(Number(e.target.value))} /></label>
          <label className="check"><input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} /> Аренду нужно требовать до броска следующего игрока (по правилам)</label>
          <h2 style={{ marginTop: 18 }}>Игра по сети</h2>
          <div className="seg">
            <button className={online === 'none' ? 'on' : ''} onClick={() => setOnline('none')}>За одним экраном</button>
            {lan && <button className={online === 'ws' ? 'on' : ''} onClick={() => setOnline('ws')}>Локальный хост</button>}
            <button className={online === 'p2p' ? 'on' : ''} onClick={() => setOnline('p2p')}>Через интернет (P2P)</button>
          </div>
          <p className="muted small">
            {online === 'ws' && 'Требуется запущенный сервер «npm run host»; друг открывает адрес вашего компьютера в локальной сети.'}
            {online === 'p2p' && 'Прямое соединение браузеров (WebRTC). Друг вводит код комнаты — сервер не нужен.'}
            {online === 'none' && 'Все игроки ходят по очереди на этом компьютере. Сеть можно включить позже в игре.'}
          </p>
        </section>
        <section className="glass card wide">
          <h2>Решения ведущего по неясным местам правил</h2>
          <p className="muted small">Буклет не решает эти ситуации однозначно. Выбор записывается в журнал и может быть изменён в панели ведущего.</p>
          <div className="rulings">
            {RULINGS.map((r) => (
              <div key={r.key} className="ruling">
                <b>{r.title}</b>
                {r.note && <span className="muted small">{r.note}</span>}
                <select value={rulings[r.key]} onChange={(e) => setRulings({ ...rulings, [r.key]: e.target.value })}>
                  {r.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        </section>
      </div>
      <footer className="setup-foot">
        <button className="btn gold big" onClick={start} disabled={players.length < 2}>Начать партию →</button>
      </footer>
    </div>
  );
}
