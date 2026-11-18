import { useEffect, useState } from 'react';
import { hasLanServer, myName, useStore } from '../store';
import { ROLE_RU, type RoleId } from '../engine/types';
import { TutorToggle } from './Tutor';
import { PAWN_PALETTE, PawnIcon, colorName, fmt } from './helpers';
import type { SetupPlayer } from '../engine/engine';

const NAMES = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дарья', 'Егор', 'Жанна', 'Захар'];

// настройки новой партии запоминаются на устройстве
const PREFS = 'bk.setup';
type Prefs = { mode: 'local' | 'host'; via: 'p2p' | 'ws'; players: SetupPlayer[]; rollOrder: boolean; money: number; quote: number; stocks: number; claim: boolean; roles: Record<RoleId, number | 'host'> };
const loadPrefs = (): Partial<Prefs> => { try { return JSON.parse(localStorage.getItem(PREFS) || '{}'); } catch { return {}; } };

export function SetupScreen() {
  const { newGame, setScreen, openLobby } = useStore();
  const [hostName, setHostName] = useState(myName());
  const saved = useState(loadPrefs)[0];
  const [players, setPlayers] = useState<SetupPlayer[]>(() => saved.players?.length ? saved.players : [0, 1, 2].map((i) => ({ name: NAMES[i], color: PAWN_PALETTE[i].hex, avatar: '', lady: i % 2 === 0 })));
  const [roles, setRoles] = useState<Record<RoleId, number | 'host'>>(saved.roles ?? { banker: 'host', broker: 'host', chairman: 'host', inspector: 'host' });
  const [money, setMoney] = useState(saved.money ?? 350000);
  const [quote, setQuote] = useState(saved.quote ?? 10000);
  const [stocks, setStocks] = useState(saved.stocks ?? 1);
  const [claim, setClaim] = useState(saved.claim ?? true);
  const [rollOrder, setRollOrder] = useState(saved.rollOrder ?? true);
  const [title, setTitle] = useState(`Партия ${new Date().toLocaleDateString('ru-RU')}`);
  const [mode, setMode] = useState<'local' | 'host'>(saved.mode ?? 'local');
  const [via, setVia] = useState<'p2p' | 'ws'>(saved.via ?? 'p2p');
  const [lan, setLan] = useState(false);
  useEffect(() => { hasLanServer().then(setLan); }, []);
  useEffect(() => { try { localStorage.setItem(PREFS, JSON.stringify({ mode, via, players, rollOrder, money, quote, stocks, claim, roles } satisfies Prefs)); } catch { /* */ } }, [mode, via, players, rollOrder, money, quote, stocks, claim, roles]);
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
      await openLobby(lan ? via : 'p2p', { title, roles: hostRoles, settings, rollOrder }, null, hostName);
      return;
    }
    newGame({ title, players, roles, settings, rollOrder });
  };
  return (
    <div className="glass card setup-card enter">
      <div className="setup-head">
        <h2>Новая партия</h2>
        <input className="title-input" value={title} onChange={(e) => setTitle(e.target.value)} title="Название партии" />
      </div>
      <div className="seg mode-seg">
        <button className={mode === 'local' ? 'on' : ''} onClick={() => setMode('local')}>🖥️ На одном устройстве</button>
        <button className={mode === 'host' ? 'on' : ''} onClick={() => setMode('host')}>🌐 По сети (хост)</button>
      </div>
      <p className="muted small mode-hint">
        {mode === 'local' ? 'Все ходят по очереди за этим экраном. Интернет не нужен.' : 'Вы создаёте комнату, друзья открывают ссылку и выбирают свои фишки. Партия хранится у вас.'}
      </p>
      <div className="setup-body">
        {mode === 'local' ? (
          <>
            {players.map((p, i) => (
              <div key={i} className="setup-player">
                <PawnIcon color={p.color} size={30} />
                <div className="setup-player-main">
                  <div className="row">
                    <input value={p.name} onChange={(e) => upd(i, { name: e.target.value })} />
                    <span className="sex" title="Пол (нужен для карточки «Сюрприз» про даму)"><button className={!p.lady ? 'on' : ''} onClick={() => upd(i, { lady: false })}>М</button><button className={p.lady ? 'on' : ''} onClick={() => upd(i, { lady: true })}>Ж</button></span>
                    <span className="color-name" style={{ color: p.color }}>{colorName(p.color)}</span>
                    {players.length > 2 && <button className="icon-btn" title="Убрать" onClick={() => setPlayers(players.filter((_, j) => j !== i))}>✕</button>}
                  </div>
                  <div className="swatches sm">
                    {PAWN_PALETTE.map((c) => {
                      const taken = players.some((x, j) => j !== i && x.color === c.hex);
                      return <button key={c.hex} title={taken ? `${c.name} — занят` : c.name} className={`swatch ${p.color === c.hex ? 'on' : ''}`} style={{ ['--sw' as any]: c.hex }} onClick={() => upd(i, { color: c.hex })} disabled={taken} />;
                    })}
                  </div>
                </div>
              </div>
            ))}
            {players.length < 8 && <button className="btn sm add-player" onClick={add}>+ Игрок</button>}
          </>
        ) : (
          <>
            <label className="field"><span>Ваше имя</span><input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Хост" /></label>
            {lan && (
              <div className="seg sm">
                <button className={via === 'p2p' ? 'on' : ''} onClick={() => setVia('p2p')}>Через интернет</button>
                <button className={via === 'ws' ? 'on' : ''} onClick={() => setVia('ws')}>В локальной сети</button>
              </div>
            )}
          </>
        )}
        <details className="advanced-mini">
          <summary>Дополнительно: роли ведущих и стартовые ресурсы</summary>
          {(Object.keys(ROLE_RU) as RoleId[]).map((r) => (
            <label key={r} className="field small">
              <span>{ROLE_RU[r]}</span>
              <select value={mode === 'host' ? 'host' : String(roles[r])} onChange={(e) => setRoles({ ...roles, [r]: e.target.value === 'host' ? 'host' : Number(e.target.value) })}>
                <option value="host">Ведущий (хост)</option>
                {mode === 'local' && players.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
              </select>
            </label>
          ))}
          <label className="field small"><span>Деньги, $</span><input type="number" step={1000} value={money} onChange={(e) => setMoney(Number(e.target.value))} /></label>
          <label className="field small"><span>Номинал акции, $</span><input type="number" step={1000} value={quote} onChange={(e) => setQuote(Number(e.target.value))} /></label>
          <label className="field small"><span>Акций каждого цвета</span><input type="number" min={0} value={stocks} onChange={(e) => setStocks(Number(e.target.value))} /></label>
          <label className="check small"><input type="checkbox" checked={claim} onChange={(e) => setClaim(e.target.checked)} /> Аренду требовать до броска следующего игрока</label>
          <span className="muted small">Сейчас: {fmt(money)} и по {stocks} акции номиналом {fmt(quote)}</span>
        </details>
      </div>
      <div className="row join-actions">
        <button className="btn ghost" onClick={() => setScreen('menu')}>← Назад</button>
        <span className="spacer" />
        <label className="tutor-toggle check" title="Каждый бросает по два кубика: кто выбросит больше — ходит раньше"><input type="checkbox" checked={rollOrder} onChange={(e) => setRollOrder(e.target.checked)} /><span>Разыграть очередь хода</span></label>
        <TutorToggle />
        <button className="btn gold shine" onClick={start} disabled={mode === 'local' && players.length < 2}>{mode === 'host' ? 'Создать комнату →' : 'Начать партию →'}</button>
      </div>
    </div>
  );
}
