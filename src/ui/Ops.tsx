import { useState } from 'react';
import type { Bundle, Color, GameState, PlayerId } from '../engine/types';
import { COLORS, COLOR_RU, COLOR_RU_PL, LEVEL_RU } from '../engine/types';
import { maxQuote, propValue } from '../engine/engine';
import { useStore } from '../store';
import { STOCK_HEX, STOCK_IMG, fmt, pn } from './helpers';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`modal glass ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h3>{title}</h3><button className="icon-btn" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

export function StocksDialog({ s, pid, onClose }: { s: GameState; pid: PlayerId; onClose: () => void }) {
  const dispatch = useStore((st) => st.dispatch);
  const p = s.players.find((x) => x.id === pid)!;
  const [n, setN] = useState<Record<Color, number>>({ red: 1, yellow: 1, green: 1, blue: 1 });
  return (
    <Modal title={`Акции — ${p.name}`} onClose={onClose} wide>
      <p className="muted small">Продажа банку — по вашей котировке. Покупка у банка — по максимальной котировке цвета среди игроков.</p>
      <div className="stock-grid">
        {COLORS.map((c) => (
          <div key={c} className="stock-card" style={{ ['--sc' as any]: STOCK_HEX[c] }}>
            <img src={STOCK_IMG[c]} alt="" />
            <div className="row between"><b>{COLOR_RU_PL[c]}</b><span>у вас {p.stocks[c]}</span></div>
            <div className="small">Ваша котировка {fmt(p.quotes[c])} · у банка {fmt(maxQuote(s, c))}</div>
            <div className="row">
              <input type="number" min={1} value={n[c]} onChange={(e) => setN({ ...n, [c]: Math.max(1, Number(e.target.value)) })} style={{ width: 60 }} />
              <button className="btn sm" disabled={p.stocks[c] < n[c]} onClick={() => dispatch({ type: 'sellStock', by: pid, color: c, count: n[c] })}>Продать +{fmt(p.quotes[c] * n[c])}</button>
              <button className="btn sm gold" disabled={p.money < maxQuote(s, c) * n[c]} onClick={() => dispatch({ type: 'buyStock', by: pid, color: c, count: n[c] })}>Купить −{fmt(maxQuote(s, c) * n[c])}</button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function LoanDialog({ s, pid, onClose }: { s: GameState; pid: PlayerId; onClose: () => void }) {
  const dispatch = useStore((st) => st.dispatch);
  const mine = Object.values(s.props).filter((x) => x.owner === pid);
  const free = mine.filter((x) => !x.pledged);
  const [cell, setCell] = useState(free[0]?.cell ?? 0);
  const [kind, setKind] = useState<'money' | 'stocks'>('money');
  const pr = s.props[cell];
  const value = pr ? propValue(s, pr) : 0;
  const [amount, setAmount] = useState(Math.floor(value / 1000) * 1000);
  const [color, setColor] = useState<Color>('red');
  const [count, setCount] = useState(1);
  const loans = s.loans.filter((l) => l.player === pid && l.status === 'active');
  const p = s.players.find((x) => x.id === pid)!;
  return (
    <Modal title="Кредит в банке под залог" onClose={onClose}>
      <p className="muted small">Сумма не выше стоимости залога. Срок — один полный проход большого или малого периметра. Карточка хранится в банке, метка остаётся на поле. Выдаёт банкир.</p>
      {free.length === 0 ? <p>Нет свободной собственности для залога.</p> : (
        <>
          <label className="field"><span>Залог</span>
            <select value={cell} onChange={(e) => { const c = Number(e.target.value); setCell(c); setAmount(Math.floor(propValue(s, s.props[c]) / 1000) * 1000); }}>
              {free.map((x) => <option key={x.cell} value={x.cell}>№{x.cell} {s.data.board.cells.find((c) => c.id === x.cell)?.name} — {LEVEL_RU[x.level]}, оценка {fmt(propValue(s, x))}</option>)}
            </select>
          </label>
          <div className="seg"><button className={kind === 'money' ? 'on' : ''} onClick={() => setKind('money')}>Деньгами</button><button className={kind === 'stocks' ? 'on' : ''} onClick={() => setKind('stocks')}>Акциями</button></div>
          {kind === 'money' ? (
            <label className="field"><span>Сумма</span><input type="number" step={1000} max={value} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /><em>макс. {fmt(value)}</em></label>
          ) : (
            <div className="row">
              <select value={color} onChange={(e) => setColor(e.target.value as Color)}>{COLORS.map((c) => <option key={c} value={c}>{COLOR_RU_PL[c]} ({fmt(maxQuote(s, c))})</option>)}</select>
              <input type="number" min={1} value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 70 }} />
              <em>= {fmt(maxQuote(s, color) * count)} по наибольшей котировке</em>
            </div>
          )}
          <button className="btn gold" onClick={() => { dispatch(kind === 'money' ? { type: 'requestLoan', by: pid, cell, kind, amount } : { type: 'requestLoan', by: pid, cell, kind, color, count }); onClose(); }}>Подать заявку банкиру</button>
        </>
      )}
      {loans.length > 0 && <h4>Действующие кредиты</h4>}
      {loans.map((l) => (
        <div key={l.id} className="row between">
          <span>№{l.cell}: {l.kind === 'stocks' && l.stocks ? `${l.stocks.count} ${COLOR_RU[l.stocks.color]} акц. (${fmt(l.amount)})` : fmt(l.amount)} · осталось {Math.max(0, l.remaining)} кл.</span>
          <button className="btn sm gold" disabled={p.money < l.amount} onClick={() => dispatch({ type: 'repayLoan', by: pid, loan: l.id })}>Погасить</button>
        </div>
      ))}
    </Modal>
  );
}

export function AuctionDialog({ s, pid, onClose }: { s: GameState; pid: PlayerId; onClose: () => void }) {
  const dispatch = useStore((st) => st.dispatch);
  const mine = Object.values(s.props).filter((x) => x.owner === pid && !x.pledged);
  const bank = Object.values(s.props).filter((x) => x.owner === 'bank');
  const p = s.players.find((x) => x.id === pid)!;
  const name = (id: number) => `№${id} ${s.data.board.cells.find((c) => c.id === id)?.name}`;
  return (
    <Modal title="Открытые торги" onClose={onClose}>
      <p className="muted small">Торги проводит председатель (имущество) или брокер (акции); побеждает наибольшая ставка. Торги по банковскому залогу засчитываются как ваш очередной ход.</p>
      {bank.length > 0 && <h4>Банковские залоги (выручка — банку)</h4>}
      {bank.map((x) => <button key={x.cell} className="btn sm" onClick={() => { dispatch({ type: 'auctionStart', by: pid, lot: { type: 'prop', cell: x.cell } }); onClose(); }}>{name(x.cell)} · {LEVEL_RU[x.level]}</button>)}
      <h4>Своё имущество</h4>
      {mine.length === 0 && <p className="muted small">Нет</p>}
      {mine.map((x) => <button key={x.cell} className="btn sm" onClick={() => { dispatch({ type: 'auctionStart', by: pid, lot: { type: 'prop', cell: x.cell } }); onClose(); }}>{name(x.cell)} · {LEVEL_RU[x.level]}</button>)}
      <h4>Свои акции (по одной)</h4>
      <div className="row wrap">{COLORS.filter((c) => p.stocks[c] > 0).map((c) => <button key={c} className="btn sm" style={{ borderColor: STOCK_HEX[c] }} onClick={() => { dispatch({ type: 'auctionStart', by: pid, lot: { type: 'stock', color: c, count: 1 } }); onClose(); }}>{COLOR_RU[c]} акция</button>)}</div>
    </Modal>
  );
}

const emptyB = (): Bundle => ({ money: 0, stocks: {}, cells: [] });
function BundleEditor({ s, pid, b, set }: { s: GameState; pid: PlayerId; b: Bundle; set: (b: Bundle) => void }) {
  const p = s.players.find((x) => x.id === pid)!;
  const props = Object.values(s.props).filter((x) => x.owner === pid && !x.pledged);
  return (
    <div className="bundle">
      <label className="field small"><span>Деньги</span><input type="number" step={1000} min={0} max={p.money} value={b.money} onChange={(e) => set({ ...b, money: Number(e.target.value) })} /></label>
      <div className="row wrap">{COLORS.map((c) => <label key={c} className="small stock-in" style={{ borderColor: STOCK_HEX[c] }}>{COLOR_RU[c]} <input type="number" min={0} max={p.stocks[c]} value={b.stocks[c] ?? 0} onChange={(e) => set({ ...b, stocks: { ...b.stocks, [c]: Number(e.target.value) } })} /></label>)}</div>
      {props.map((x) => <label key={x.cell} className="check small"><input type="checkbox" checked={b.cells.includes(x.cell)} onChange={(e) => set({ ...b, cells: e.target.checked ? [...b.cells, x.cell] : b.cells.filter((k) => k !== x.cell) })} />№{x.cell} {s.data.board.cells.find((c) => c.id === x.cell)?.name} ({LEVEL_RU[x.level]})</label>)}
    </div>
  );
}
export function TradeDialog({ s, pid, onClose }: { s: GameState; pid: PlayerId; onClose: () => void }) {
  const dispatch = useStore((st) => st.dispatch);
  const others = s.players.filter((p) => p.id !== pid && !p.bankrupt);
  const [to, setTo] = useState(others[0]?.id);
  const [give, setGive] = useState(emptyB());
  const [take, setTake] = useState(emptyB());
  return (
    <Modal title="Предложить сделку" onClose={onClose} wide>
      <label className="field"><span>Партнёр</span><select value={to} onChange={(e) => { setTo(e.target.value); setTake(emptyB()); }}>{others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <div className="trade-cols">
        <div><h4>Вы отдаёте</h4><BundleEditor s={s} pid={pid} b={give} set={setGive} /></div>
        <div><h4>{pn(s, to)} отдаёт</h4>{to && <BundleEditor s={s} pid={to} b={take} set={setTake} />}</div>
      </div>
      <p className="muted small">Акции переходят по котировке нового владельца. После согласия партнёра сделку подтверждает председатель (имущество) или брокер (акции).</p>
      <button className="btn gold" onClick={() => { if (to) dispatch({ type: 'tradePropose', by: pid, to, give, take }); onClose(); }}>Отправить предложение</button>
    </Modal>
  );
}
