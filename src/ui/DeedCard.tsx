import { useState } from 'react';
import type { GameState, Level } from '../engine/types';
import { ruRent } from '../engine/engine';
import { STOCK_HEX, fmt } from './helpers';

/** Карточка собственности: логотип фирмы из оригинального набора + цены и аренда. */
export function DeedCard({ s, cell, highlight }: { s: GameState; cell: number; highlight?: Level | 'buy' }) {
  const c = s.data.board.cells.find((x) => x.id === cell);
  const [img, setImg] = useState(true);
  if (!c) return null;
  const color = c.color ? STOCK_HEX[c.color] : '#d9b45a';
  const row = (label: string, value: number | null | undefined, on?: boolean) => (
    <div className={`deed-row ${on ? 'on' : ''}`}><span>{label}</span><b>{value == null ? '—' : fmt(value)}</b></div>
  );
  return (
    <div className="deed" style={{ ['--dc' as any]: color }}>
      {img ? (
        <img className="deed-logo" src={`res/firms/${c.id}.webp`} alt={c.name} onError={() => setImg(false)} />
      ) : (
        <div className="deed-head"><span className="muted small">{c.kind ?? (c.type === 'supermarket' ? 'Супермаркет' : 'Компания')}</span><b>{c.name}</b></div>
      )}
      <div className="deed-body">
        <div className="deed-title">№{c.id} {c.name}<span className="muted small"> · {c.zone === 'outer' ? 'бизнес за рубежом' : 'бизнес в России'}</span></div>
        {c.type === 'company' && c.rent && (
          <>
            {row('Котировка', c.quote)}
            {row('Цена предприятия', c.price)}
            <div className="deed-sep">Аренда владельцу</div>
            {row('участок', c.rent.plot, highlight === 'plot')}
            {row('филиал', c.rent.branch, highlight === 'branch')}
            {row('предприятие', c.rent.enterprise, highlight === 'enterprise')}
          </>
        )}
        {c.type === 'ru_company' && (
          <>
            {row('Стоимость', c.price)}
            {row('участок / филиал', c.price ? c.price / 2 : 0)}
            {row('Аренда владельцу', ruRent(c, 'branch'), highlight === 'plot' || highlight === 'branch' || highlight === 'firm')}
          </>
        )}
        {c.type === 'supermarket' && (<>{row('Покупка', c.price, true)}{row('Плата с посетителя', c.fee)}{row('Налог владельца', c.ownerTax)}</>)}
        {(c.проверить || c.требует_оцифровки) && <div className="warn small">⚠ {c.проверить || c.требует_оцифровки}</div>}
      </div>
    </div>
  );
}
