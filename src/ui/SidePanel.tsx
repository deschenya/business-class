import { useMemo, useState } from 'react';
import type { Color, GameState, Level, RoleId } from '../engine/types';
import { COLORS, COLOR_RU_PL, LEVEL_RU, ROLE_RU } from '../engine/types';
import { maxQuote, netWorth } from '../engine/engine';
import { useStore } from '../store';
import { STOCK_HEX, cls, fmt, pn } from './helpers';

type Tab = 'log' | 'ledger' | 'market' | 'registry' | 'host';
const TABS: [Tab, string][] = [['log', 'Журнал'], ['ledger', 'Расчёты'], ['market', 'Котировки'], ['registry', 'Реестр'], ['host', 'Ведущий']];

export function SidePanel({ s }: { s: GameState }) {
  // null — панель свёрнута (видны только табы); нажатие на таб разворачивает, повторное — сворачивает
  const [tab, setTab] = useState<Tab | null>(null);
  const can = useStore((st) => st.can);
  return (
    <div className={cls('side glass', !tab && 'collapsed')}>
      <div className="tabs">
        {TABS.filter(([k]) => k !== 'host' || can('host')).map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(tab === k ? null : k)} title={tab === k ? 'Свернуть' : 'Открыть'}>
            {label}<i className="tab-caret">{tab === k ? '▴' : '▾'}</i>
          </button>
        ))}
      </div>
      {tab && (
        <div className="tab-body" key={tab}>
          {tab === 'log' && <LogTab s={s} />}
          {tab === 'ledger' && <LedgerTab s={s} />}
          {tab === 'market' && <MarketTab s={s} />}
          {tab === 'registry' && <RegistryTab s={s} />}
          {tab === 'host' && <HostTab s={s} />}
        </div>
      )}
    </div>
  );
}

function LogTab({ s }: { s: GameState }) {
  const [filter, setFilter] = useState<string>('all');
  const items = s.log.filter((l) => filter === 'all' || l.kind === filter || (filter === 'money' && l.kind === 'prop')).slice(-300).reverse();
  return (
    <>
      <div className="seg sm">
        {[['all', 'Всё'], ['money', 'Деньги'], ['market', 'Биржа'], ['card', 'Карты'], ['ruling', 'Ведущий'], ['warn', 'Важное']].map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
      </div>
      <div className="log">
        {items.map((l) => (
          <div key={l.i} className={`log-item ${l.kind}`}>
            <span className="log-turn">{l.turn}</span>
            {l.player && <span className="dot" style={{ background: s.players.find((p) => p.id === l.player)?.color }} />}
            <span>{l.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function LedgerTab({ s }: { s: GameState }) {
  const rows = s.ledger.slice(-400).reverse();
  return (
    <>
      <div className="bank-stats">
        <div>Банк выплатил <b>{fmt(s.bankStats.paidOut)}</b></div>
        <div>Банк получил <b>{fmt(s.bankStats.received)}</b></div>
      </div>
      <table className="tbl">
        <thead><tr><th>Ход</th><th>Откуда → куда</th><th>Сумма</th><th>Основание</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.i}><td>{t.turn}</td><td>{pn(s, t.from)} → {pn(s, t.to)}</td><td className="num">{fmt(t.amount)}</td><td className="small">{t.reason}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Spark({ s, color }: { s: GameState; color: Color }) {
  const series = s.players.map((p) => ({ p, pts: [s.settings.startQuote, ...s.market.filter((m) => m.player === p.id && m.color === color && m.turn > 0).map((m) => m.to)] }));
  const max = Math.max(1, ...series.flatMap((x) => x.pts));
  const min = Math.min(0, ...series.flatMap((x) => x.pts));
  const len = Math.max(2, ...series.map((x) => x.pts.length));
  const W = 260, H = 70;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`}>
      {series.map(({ p, pts }) => (
        <polyline key={p.id} fill="none" stroke={p.color} strokeWidth={2} points={pts.map((v, i) => `${(i / (len - 1)) * W},${H - ((v - min) / (max - min)) * (H - 6) - 3}`).join(' ')} />
      ))}
    </svg>
  );
}

function MarketTab({ s }: { s: GameState }) {
  const act = s.players.filter((p) => !p.bankrupt);
  return (
    <>
      <table className="tbl quotes">
        <thead><tr><th>Игрок</th>{COLORS.map((c) => <th key={c}><span className="dot" style={{ background: STOCK_HEX[c] }} /> </th>)}<th>Капитал</th></tr></thead>
        <tbody>
          {act.map((p) => (
            <tr key={p.id}><td><span className="dot" style={{ background: p.color }} />{p.name}</td>{COLORS.map((c) => <td key={c} className="num">{p.stocks[c]}×{(p.quotes[c] / 1000).toLocaleString('ru-RU')}k</td>)}<td className="num">{fmt(netWorth(s, p.id))}</td></tr>
          ))}
          <tr className="bank-row"><td>Цена у банка</td>{COLORS.map((c) => <td key={c} className="num">{fmt(maxQuote(s, c))}</td>)}<td /></tr>
        </tbody>
      </table>
      <p className="muted small">Продажа — по своей котировке; покупка у банка — по максимальной котировке цвета среди игроков. 1 пункт = $1 000.</p>
      {COLORS.map((c) => (
        <div key={c} className="spark-box"><span className="small" style={{ color: STOCK_HEX[c] }}>{COLOR_RU_PL[c]}</span><Spark s={s} color={c} /></div>
      ))}
      <h4>История рынка</h4>
      <div className="log">
        {s.market.filter((m) => m.turn > 0).slice(-200).reverse().map((m) => (
          <div key={m.i} className="log-item market"><span className="log-turn">{m.turn}</span><span className="dot" style={{ background: STOCK_HEX[m.color] }} />{pn(s, m.player)}: {fmt(m.from)} → {fmt(m.to)} <span className="muted small">({m.reason})</span></div>
        ))}
      </div>
    </>
  );
}

function RegistryTab({ s }: { s: GameState }) {
  const cells = s.data.board.cells.filter((c) => c.type === 'company' || c.type === 'ru_company' || c.type === 'supermarket' || c.type === 'hotel');
  return (
    <>
      <table className="tbl">
        <thead><tr><th>№</th><th>Фирма</th><th>Владелец</th><th>Уровень</th></tr></thead>
        <tbody>
          {cells.map((c) => {
            const pr = s.props[c.id];
            return (
              <tr key={c.id} className={pr ? '' : 'muted'}>
                <td>{c.id}</td>
                <td><span className="dot" style={{ background: c.color ? STOCK_HEX[c.color] : '#999' }} />{c.name}{(c.проверить || c.требует_оцифровки) && <span className="flag" title={c.проверить || c.требует_оцифровки}>?</span>}</td>
                <td>{pr ? pn(s, pr.owner) : '—'}</td>
                <td>{pr ? `${LEVEL_RU[pr.level]}${pr.pledged ? ' (залог)' : ''}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h4>Кредиты</h4>
      {s.loans.length === 0 && <p className="muted small">Нет</p>}
      {s.loans.map((l) => <div key={l.id} className="small">{pn(s, l.player)}: {fmt(l.amount)} под №{l.cell} — {l.status === 'active' ? `осталось ${Math.max(0, l.remaining)} кл.` : l.status === 'repaid' ? 'погашен' : 'не возвращён'}</div>)}
    </>
  );
}

function HostTab({ s }: { s: GameState }) {
  const dispatch = useStore((st) => st.dispatch);
  const setScreen = useStore((st) => st.setScreen);
  const [pid, setPid] = useState(s.players[0].id);
  const [money, setMoney] = useState(0);
  const [color, setColor] = useState<Color>('red');
  const [stk, setStk] = useState(0);
  const [quote, setQuote] = useState<string>('');
  const [reason, setReason] = useState('');
  const [cell, setCell] = useState(1);
  const [owner, setOwner] = useState<string>('');
  const [level, setLevel] = useState<Level>('plot');
  const [note, setNote] = useState('');
  const owned = useMemo(() => s.data.board.cells.filter((c) => ['company', 'ru_company', 'supermarket', 'hotel'].includes(c.type)), [s.data]);
  return (
    <div className="host-tab">
      <h4>Корректировка (с записью в журнал)</h4>
      <div className="grid2">
        <select value={pid} onChange={(e) => setPid(e.target.value)}>{s.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input placeholder="Основание" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="field small"><span>Деньги ±</span><input type="number" step={1000} value={money} onChange={(e) => setMoney(Number(e.target.value))} /></label>
        <select value={color} onChange={(e) => setColor(e.target.value as Color)}>{COLORS.map((c) => <option key={c} value={c}>{COLOR_RU_PL[c]}</option>)}</select>
        <label className="field small"><span>Акции ±</span><input type="number" value={stk} onChange={(e) => setStk(Number(e.target.value))} /></label>
        <label className="field small"><span>Котировка =</span><input type="number" step={1000} value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="—" /></label>
      </div>
      <button className="btn sm" disabled={!reason} onClick={() => { dispatch({ type: 'hostAdjust', by: 'host', player: pid, money: money || undefined, color, stocks: stk || undefined, quote: quote === '' ? undefined : Number(quote), reason }); setMoney(0); setStk(0); setQuote(''); }}>Применить</button>
      <h4>Реестр собственности</h4>
      <div className="grid2">
        <select value={cell} onChange={(e) => setCell(Number(e.target.value))}>{owned.map((c) => <option key={c.id} value={c.id}>№{c.id} {c.name}</option>)}</select>
        <select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">— свободна —</option><option value="bank">Банк</option>{s.players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select value={level} onChange={(e) => setLevel(e.target.value as Level)}>{(['plot', 'branch', 'enterprise', 'firm'] as Level[]).map((l) => <option key={l} value={l}>{LEVEL_RU[l]}</option>)}</select>
        <button className="btn sm" disabled={!reason} onClick={() => dispatch({ type: 'hostSetOwner', by: 'host', cell, owner: owner || null, level, reason })}>Записать</button>
      </div>
      <h4>Штраф ведущему ($10 000 в банк)</h4>
      <div className="row wrap">
        {(Object.keys(ROLE_RU) as RoleId[]).filter((r) => s.roles[r] !== 'host').map((r) => <button key={r} className="btn sm" disabled={!reason} onClick={() => dispatch({ type: 'roleFine', by: 'host', role: r, reason })}>{ROLE_RU[r]} ({pn(s, s.roles[r])})</button>)}
      </div>
      <h4>Прочее</h4>
      <div className="row"><input placeholder="Запись в журнал" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn sm" disabled={!note} onClick={() => { dispatch({ type: 'hostNote', by: 'host', text: note }); setNote(''); }}>Записать</button></div>
      <div className="row wrap">
        <button className="btn sm" onClick={() => setScreen('editor')}>Справочники поля и карт</button>
        <button className="btn sm danger" onClick={() => { const p = prompt('Объявить банкротом (имя игрока):'); const pl = s.players.find((x) => x.name === p); if (pl) dispatch({ type: 'declareBankrupt', by: 'host', player: pl.id }); }}>Банкротство…</button>
        <button className="btn sm gold" onClick={() => confirm('Завершить партию и подвести итоги?') && dispatch({ type: 'endGame', by: 'host' })}>Завершить партию</button>
      </div>
    </div>
  );
}
