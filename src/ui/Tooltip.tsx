import { useLayoutEffect, useRef, useState } from 'react';
import type { GameState } from '../engine/types';
import { COLOR_RU_PL, LEVEL_RU } from '../engine/types';
import { ruRent } from '../engine/engine';
import type { HoverInfo } from '../three/TableScene';
import { STOCK_HEX, fmt, pn } from './helpers';

export function Tooltip({ s, h, pinned, onClose }: { s: GameState; h: HoverInfo; pinned: boolean; onClose: () => void }) {
  const b = s.data.board;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, hh = el.offsetHeight, m = 10;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = h.x + 18, top = h.y + 18;
    if (left + w > vw - m) left = h.x - w - 18; // не влезает справа — слева от курсора
    if (top + hh > vh - m) top = h.y - hh - 18; // не влезает снизу — над курсором
    setPos({ left: Math.max(m, Math.min(left, vw - w - m)), top: Math.max(m, Math.min(top, vh - hh - m)) });
  }, [h.x, h.y, h.id, h.kind]);
  let body: React.ReactNode = null;
  if (h.kind === 'cell') {
    const c = b.cells.find((x) => x.id === h.id)!;
    const pr = s.props[c.id];
    const here = s.players.filter((p) => !p.bankrupt && p.pos.z === 'c' && p.pos.id === c.id);
    body = (
      <>
        <div className="tt-head" style={{ borderColor: c.color ? STOCK_HEX[c.color] : '#d6b25e' }}>
          <span className="tt-num">№{c.id}</span><b>{c.name}</b>
          <span className="muted small">{c.zone === 'outer' ? 'Бизнес за рубежом' : 'Бизнес в России'}</span>
        </div>
        {c.type === 'company' && c.rent && (
          <>
            {s.data.cards && <img className="tt-firm" src={`res/firms/${c.id}.webp`} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} alt="" />}
            <div className="tt-grid">
              <span>Котировка</span><b>{fmt(c.quote ?? 0)}</b>
              <span>Цена предприятия</span><b>{fmt(c.price ?? 0)}</b>
              <span>Участок (½)</span><b>{fmt((c.price ?? 0) / 2)}</b>
              <span>Аренда: участок</span><b>{fmt(c.rent.plot)}</b>
              <span>филиал</span><b>{fmt(c.rent.branch)}</b>
              <span>предприятие</span><b>{fmt(c.rent.enterprise)}</b>
            </div>
          </>
        )}
        {c.type === 'ru_company' && (
          <>
            <img className="tt-firm" src={`res/firms/${c.id}.webp`} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} alt="" />
            <div className="tt-grid"><span>{c.kind}</span><b /><span>Стоимость</span><b>{fmt(c.price ?? 0)}</b><span>Участок / филиал</span><b>{fmt((c.price ?? 0) / 2)}</b><span>Аренда владельцу</span><b>{fmt(ruRent(c, 'branch'))}</b></div>
          </>
        )}
        {c.type === 'win' && <p>Остановка: +{fmt(c.amount ?? 0)} из банка</p>}
        {c.type === 'win50' && <p>Остановка: +{fmt(c.amount ?? 0)} и {c.stocks} акций; затем можно сыграть на рулетке</p>}
        {c.type === 'card' && <p>Вытяните одну из пяти карточек «{c.name}»</p>}
        {c.type === 'bank' && <p>Клиент банка: премия {fmt(c.premium ?? 0)}; переход 24↔52 — пошлина {fmt(c.transferFee ?? 0)}</p>}
        {c.type === 'hotel' && <p>Плата {fmt(c.fee ?? 0)} владельцу или банку; далее — автострада, рулетка ×2 или фирма в России за ½</p>}
        {c.type === 'supermarket' && <p>Плата {fmt(c.fee ?? 0)} владельцу/банку; покупка {fmt(c.price ?? 0)}; налог владельца {fmt(c.ownerTax ?? 0)}</p>}
        {c.type === 'customs' && <p>Въезд с 31: {fmt(c.entryFee ?? 0)}. Выезд на «Старт»: {fmt(c.exitDuty ?? 0)} + {fmt(c.exitPerRuProperty ?? 0)} за каждую недвижимость в России</p>}
        {c.type === 'exchange_gate' && <p>Можно сыграть на бирже или пройти как обычную клетку</p>}
        {c.type === 'broker' && <p>Выход на биржу за {fmt(c.exchangeFee ?? 0)}</p>}
        {c.type === 'roulette_gate' && <p>Вход на рулетку</p>}
        {c.type === 'start' && <p>За каждое прохождение — {fmt(c.bonusPass ?? 0)}</p>}
        {(c.проверить || c.требует_оцифровки) && <p className="warn small">⚠ {c.проверить || c.требует_оцифровки}</p>}
        {pr && <p className="tt-owner"><span className="dot" style={{ background: s.players.find((p) => p.id === pr.owner)?.color ?? '#888' }} />{pn(s, pr.owner)} — {LEVEL_RU[pr.level]}{pr.pledged ? ' (в залоге)' : ''}</p>}
        {here.length > 0 && <p className="muted small">Здесь: {here.map((p) => p.name).join(', ')}</p>}
      </>
    );
  } else if (h.kind === 'hw') {
    const c = b.highway[Number(h.id) - 1];
    body = <><div className="tt-head"><span className="tt-num">А{c.n}</span><b>Автострада</b></div><p>{c.name}</p>{c.n === 10 && <p className="muted small">Съезд: на №46 или №37</p>}</>;
  } else if (h.kind === 'rl') {
    const c = b.roulette.sectors.find((x) => x.slot === h.id)!;
    body = <><div className="tt-head"><b>Рулетка: {c.label}</b></div>{c.exit && <p>Зелёный сектор «ВЫХОД»</p>}{c.start && <p>Начальный сектор</p>}{c.требует_оцифровки && <p className="warn small">⚠ {c.требует_оцифровки}</p>}</>;
  } else if (h.kind === 'ex') {
    const [col, n] = String(h.id).split(':');
    const sp = b.exchange.specialCells.includes(Number(n));
    body = <><div className="tt-head"><b>Биржа · {COLOR_RU_PL[col as 'red']} дорожка, клетка {n}</b></div><p>+{n} п. ({fmt(Number(n) * 1000)}) к номиналу {COLOR_RU_PL[col as 'red']} акций игрока{sp ? `, и +${n} п. ко всем остальным цветам` : ''}</p></>;
  }
  return (
    <div className={`tooltip glass ${pinned ? 'pinned' : ''}`} ref={ref} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}>
      {pinned && <button className="icon-btn tt-close" onClick={onClose}>✕</button>}
      {body}
    </div>
  );
}
