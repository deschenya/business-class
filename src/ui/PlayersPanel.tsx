import { useEffect, useRef, useState } from 'react';
import type { GameState, Player } from '../engine/types';
import { COLORS, LEVEL_RU, ROLE_RU, type RoleId } from '../engine/types';
import { netWorth, propValue } from '../engine/engine';
import { useStore } from '../store';
import { PawnIcon, STOCK_HEX, cls, fmt, pn } from './helpers';

function Money({ v }: { v: number }) {
  const [shown, setShown] = useState(v);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prev = useRef(v);
  useEffect(() => {
    const from = prev.current; prev.current = v;
    if (from === v) return;
    setFlash(v > from ? 'up' : 'down');
    const t0 = performance.now();
    let raf = 0;
    const step = () => { const k = Math.min(1, (performance.now() - t0) / 700); setShown(Math.round(from + (v - from) * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    const to = setTimeout(() => setFlash(null), 900);
    return () => { cancelAnimationFrame(raf); clearTimeout(to); };
  }, [v]);
  return <span className={cls('money', flash)}>{fmt(shown)}</span>;
}

export function PlayersPanel({ s }: { s: GameState }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="players">
      {s.order.map((id) => {
        const p = s.players.find((x) => x.id === id)!;
        return <PlayerCard key={id} s={s} p={p} open={open === id} toggle={() => setOpen(open === id ? null : id)} />;
      })}
    </div>
  );
}

function PlayerCard({ s, p, open, toggle }: { s: GameState; p: Player; open: boolean; toggle: () => void }) {
  const net = useStore((st) => st.net);
  const can = useStore((st) => st.can);
  const online = net.mode !== 'local';
  const props = Object.values(s.props).filter((x) => x.owner === p.id);
  const roles = (Object.keys(s.roles) as RoleId[]).filter((r) => s.roles[r] === p.id);
  const loans = s.loans.filter((l) => l.player === p.id && l.status === 'active');
  const debt = s.debts.filter((d) => d.debtor === p.id).reduce((a, d) => a + d.amount, 0);
  return (
    <div className={cls('pcard glass', s.turn.player === p.id && 'current', p.bankrupt && 'out')} style={{ ['--c' as any]: p.color }} onClick={toggle}>
      <div className="pcard-head">
        <PawnIcon color={p.color} size={38} />
        <div className="pcard-name">
          <b>{p.name}</b>
          <span className="muted small">{p.bankrupt ? 'банкрот' : `капитал ${fmt(netWorth(s, p.id))}`}</span>
        </div>
        <Money v={p.money} />
      </div>
      <div className="pcard-stocks">
        {COLORS.map((c) => (
          <div key={c} className="stock" title={`${c}: ${p.stocks[c]} шт. по ${fmt(p.quotes[c])}`}>
            <span className="stock-chip" style={{ background: STOCK_HEX[c] }}>{p.stocks[c]}</span>
            <span className="small">{(p.quotes[c] / 1000).toLocaleString('ru-RU')}k</span>
          </div>
        ))}
      </div>
      <div className="pcard-tags">
        {online && can(p.id) && <span className="tag you">вы</span>}
        {online && !p.bankrupt && !net.seats[p.id] && <span className="tag bad" title="Игрок отключился — фишка ждёт переподключения">нет связи</span>}
        {props.length > 0 && <span className="tag">🏢 {props.length}</span>}
        {loans.length > 0 && <span className="tag warn">залог {loans.length}</span>}
        {debt > 0 && <span className="tag bad">долг {fmt(debt)}</span>}
        {p.skip > 0 && <span className="tag bad">пропуск ×{p.skip}</span>}
        {p.oneDieNext && <span className="tag">1 кубик</span>}
        {p.rentWaivers.map((w, i) => <span key={i} className="tag good" title="Освобождение от аренды">🎁 {pn(s, w)}</span>)}
        {roles.map((r) => <span key={r} className="tag role" title={ROLE_RU[r]}>{ROLE_RU[r].split(' ')[0]}</span>)}
      </div>
      {open && (
        <div className="pcard-more" onClick={(e) => e.stopPropagation()}>
          {props.length === 0 && <span className="muted small">Нет собственности</span>}
          {props.map((pr) => {
            const cell = s.data.board.cells.find((c) => c.id === pr.cell)!;
            return (
              <div key={pr.cell} className="prop-row">
                <span className="dot" style={{ background: cell.color ? STOCK_HEX[cell.color] : '#aaa' }} />
                №{pr.cell} {cell.name} <span className="muted">· {LEVEL_RU[pr.level]}{pr.pledged ? ' · в залоге' : ''}</span>
                <span className="right">{fmt(propValue(s, pr))}</span>
              </div>
            );
          })}
          {loans.map((l) => <div key={l.id} className="prop-row warn">Кредит {fmt(l.amount)} под №{l.cell} · осталось {Math.max(0, l.remaining)} кл.</div>)}
        </div>
      )}
    </div>
  );
}
