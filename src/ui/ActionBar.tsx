import { useState } from 'react';
import type { GameState, PlayerId } from '../engine/types';
import { ROLE_RU } from '../engine/types';
import { awaitingRoll, assetsValue } from '../engine/engine';
import { useStore } from '../store';
import { Avatar, fmt, pn } from './helpers';
import { StocksDialog, LoanDialog, AuctionDialog, TradeDialog } from './Ops';

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export const DieFace = ({ v }: { v: number }) => (
  <span className="die-face">{Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[v]?.includes(i) ? 'on' : ''} />)}</span>
);

export function ActionBar({ s, busy }: { s: GameState; busy: boolean }) {
  const { dispatch, can } = useStore();
  const [dlg, setDlg] = useState<null | 'stocks' | 'loan' | 'auction' | 'trade'>(null);
  const cur = s.players.find((p) => p.id === s.turn.player)!;
  const mine = can(cur.id);
  const roll = awaitingRoll(s);
  const debts = s.debts;
  const myDebtor = debts.find((d) => can(d.debtor));
  const actor: PlayerId | null = myDebtor ? myDebtor.debtor : mine && s.turn.stage === 'pre' && !s.turn.rolled && !s.exchange && !s.roulette ? cur.id : null;
  const claims = s.claims.filter((c) => c.status === 'open');
  const trades = s.trades.filter((t) => t.status === 'proposed' || t.status === 'accepted');
  const over = s.turn.stage === 'over';
  return (
    <>
      <div className="claims">
        {claims.map((c) => (
          <div key={c.id} className="claim glass">
            <span className="dot" style={{ background: s.players.find((p) => p.id === c.owner)?.color }} />
            <span><b>{pn(s, c.payer)}</b> на собственности <b>{pn(s, c.owner)}</b> (№{c.cell}) — аренда {fmt(c.amount)}</span>
            {can(c.owner) && <button className="btn gold sm pulse" onClick={() => dispatch({ type: 'claimRent', by: c.owner, claim: c.id })}>Потребовать</button>}
          </div>
        ))}
        {debts.map((d) => (
          <div key={d.id} className="claim glass bad">
            <span><b>{pn(s, d.debtor)}</b> должен {pn(s, d.creditor)} {fmt(d.amount)} — {d.reason}. Деньги {fmt(s.players.find((p) => p.id === d.debtor)!.money)}, имущество {fmt(assetsValue(s, d.debtor))}</span>
            {can(d.debtor) && <>
              <button className="btn sm gold" disabled={s.players.find((p) => p.id === d.debtor)!.money < d.amount} onClick={() => dispatch({ type: 'payDebt', by: d.debtor, debt: d.id })}>Оплатить</button>
              <button className="btn sm danger" onClick={() => dispatch({ type: 'declareBankrupt', by: d.debtor, player: d.debtor })}>Банкротство</button>
            </>}
          </div>
        ))}
        {trades.map((t) => {
          const role = t.give.cells.length || t.take.cells.length ? 'chairman' : 'broker';
          return (
            <div key={t.id} className="claim glass">
              <span>Сделка: <b>{pn(s, t.from)}</b> ⇄ <b>{pn(s, t.to)}</b> — отдаёт {bt(s, t.give)}, получает {bt(s, t.take)} {t.status === 'accepted' && <em>(ждёт подтверждения: {ROLE_RU[role]})</em>}</span>
              {t.status === 'proposed' && can(t.to) && <><button className="btn sm gold" onClick={() => dispatch({ type: 'tradeRespond', by: t.to, trade: t.id, accept: true })}>Принять</button><button className="btn sm" onClick={() => dispatch({ type: 'tradeRespond', by: t.to, trade: t.id, accept: false })}>Отклонить</button></>}
              {t.status === 'accepted' && (can(s.roles[role] as any) || can('host')) && <><button className="btn sm gold" onClick={() => dispatch({ type: 'tradeConfirm', by: can(s.roles[role] as any) && s.roles[role] !== 'host' ? (s.roles[role] as PlayerId) : 'host', trade: t.id, ok: true })}>Подтвердить</button><button className="btn sm" onClick={() => dispatch({ type: 'tradeConfirm', by: 'host', trade: t.id, ok: false })}>Отменить</button></>}
            </div>
          );
        })}
        {s.auction && <AuctionLive s={s} />}
      </div>
      <div className="actionbar glass" style={{ ['--c' as any]: cur.color }}>
        <div className="ab-who">
          <Avatar s={s} id={cur.id} size={46} />
          <div>
            <span className="muted small">{over ? 'Партия окончена' : 'Ходит'}</span>
            <b>{over && s.winner ? `Победитель: ${pn(s, s.winner)}` : cur.name}</b>
            {s.exchange && <span className="small chip">на бирже · {s.exchange.mode === 'risk' ? 'риск' : 'простой'}{s.exchange.lane ? ` · клетка ${s.exchange.n}` : ''}</span>}
            {s.roulette && <span className="small chip">рулетка · кругов {Math.floor(s.roulette.traveled / 12)}</span>}
          </div>
        </div>
        {s.turn.dice && <div className="ab-dice">{s.turn.dice.map((v, i) => <DieFace key={i} v={v} />)}</div>}
        <div className="ab-actions">
          {roll && mine && !busy && (
            <button className="btn roll" onClick={() => dispatch({ type: 'roll', by: cur.id })}>
              🎲 {roll === 'order' ? 'Бросить на очерёдность' : roll === 'extra' ? (s.turn.extraOneDie ? 'Дополнительный ход (один кубик)' : 'Дополнительный ход') : roll === 'exchange' ? 'Ход по бирже' : roll === 'roulette' ? 'Крутить рулетку' : s.turn.oneDie || cur.oneDieNext ? 'Бросить один кубик' : 'Бросить кубики'}
            </button>
          )}
          {s.turn.stage === 'post' && !s.turn.extra && mine && !busy && !s.prompts.length && (
            <button className="btn gold" disabled={debts.some((d) => d.debtor === cur.id)} onClick={() => dispatch({ type: 'endTurn', by: cur.id })}>Завершить ход →</button>
          )}
          {!mine && !over && <span className="ab-hint"><span className="spinner sm" />{s.turn.stage === 'order' ? `${cur.name} бросает на очерёдность` : `Ходит ${cur.name} — ждём`}</span>}
          {mine && !busy && !over && s.prompts.length > 0 && !roll && <span className="ab-hint">Сделайте выбор в окне ↑</span>}
        </div>
        {actor && !busy && (
          <div className="ab-ops">
            <span className="muted small">{myDebtor ? 'Погашение долга:' : 'До броска:'}</span>
            <button className="btn sm" onClick={() => setDlg('stocks')}>Акции</button>
            <button className="btn sm" onClick={() => setDlg('loan')}>Кредит</button>
            {!myDebtor && <button className="btn sm" onClick={() => setDlg('auction')} disabled={!!s.auction}>Торги</button>}
            {!myDebtor && <button className="btn sm" onClick={() => setDlg('trade')}>Сделка</button>}
          </div>
        )}
      </div>
      {dlg === 'stocks' && actor && <StocksDialog s={s} pid={actor} onClose={() => setDlg(null)} />}
      {dlg === 'loan' && actor && <LoanDialog s={s} pid={actor} onClose={() => setDlg(null)} />}
      {dlg === 'auction' && actor && <AuctionDialog s={s} pid={actor} onClose={() => setDlg(null)} />}
      {dlg === 'trade' && actor && <TradeDialog s={s} pid={actor} onClose={() => setDlg(null)} />}
    </>
  );
}

const bt = (s: GameState, b: { money: number; stocks: Record<string, number | undefined>; cells: number[] }) =>
  [b.money ? fmt(b.money) : '', ...Object.entries(b.stocks).filter(([, n]) => n).map(([c, n]) => `${c === 'red' ? 'красн.' : c === 'yellow' ? 'жёлт.' : c === 'green' ? 'зел.' : 'син.'}×${n}`), ...b.cells.map((id) => `№${id} ${s.data.board.cells.find((c) => c.id === id)?.name}`)].filter(Boolean).join(', ') || 'ничего';

function AuctionLive({ s }: { s: GameState }) {
  const { dispatch, can } = useStore();
  const au = s.auction!;
  const top = Object.entries(au.bids).sort((a, b) => b[1] - a[1])[0];
  const [amt, setAmt] = useState((top?.[1] ?? 0) + 5000);
  const bidders = s.players.filter((p) => !p.bankrupt && p.id !== au.seller && can(p.id));
  const [who, setWho] = useState(bidders[0]?.id);
  const lot = au.lot.type === "prop" ? `№${(au.lot as any).cell} ${s.data.board.cells.find((c) => c.id === (au.lot as any).cell)?.name}` : `акции ×${(au.lot as any).count}`;
  const conductor = s.roles[au.conductor];
  return (
    <div className="claim glass auction">
      <span>🔨 Торги: <b>{lot}</b> · продавец {pn(s, au.seller)} · лучшая ставка {top ? `${fmt(top[1])} (${pn(s, top[0])})` : '—'}</span>
      {bidders.length > 0 && <>
        <select value={who} onChange={(e) => setWho(e.target.value)}>{bidders.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <input type="number" step={1000} value={amt} onChange={(e) => setAmt(Number(e.target.value))} style={{ width: 100 }} />
        <button className="btn sm gold" onClick={() => who && dispatch({ type: 'auctionBid', by: who, amount: amt })}>Ставка</button>
      </>}
      {(can(conductor as any) || can('host')) && <>
        <button className="btn sm" onClick={() => dispatch({ type: 'auctionClose', by: conductor !== 'host' && can(conductor as any) ? (conductor as PlayerId) : 'host' })}>Продано! ({ROLE_RU[au.conductor].split(' ')[0]})</button>
        <button className="btn sm ghost" onClick={() => dispatch({ type: 'auctionCancel', by: 'host' })}>Отменить</button>
      </>}
    </div>
  );
}
