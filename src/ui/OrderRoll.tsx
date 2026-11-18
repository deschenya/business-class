import { useEffect, useState } from 'react';
import type { GameState } from '../engine/types';
import { DieFace } from './ActionBar';
import { PawnIcon, pn } from './helpers';
import { sfx } from './sound';

const seenKey = (id: string) => `bk.orderShown.${id}`;
const STEP = 650; // мс на бросок одного игрока

/** Розыгрыш очерёдности в начале партии: все по очереди бросают два кубика, затем — итоговый порядок. */
export function OrderRoll({ s }: { s: GameState }) {
  const fresh = !!s.orderRoll && s.turn.n === 1 && !s.turn.rolled;
  const [open, setOpen] = useState(() => { try { return fresh && !sessionStorage.getItem(seenKey(s.id)); } catch { return fresh; } });
  // последовательность бросков: первый круг — все, затем перебросы равных
  const throws = (s.orderRoll ?? []).flatMap((r) => r.rolls.map((d, round) => ({ player: r.player, d, round }))).sort((a, b) => a.round - b.round);
  const [step, setStep] = useState(0); // сколько бросков уже показано
  const [spin, setSpin] = useState([1, 1]);
  useEffect(() => {
    if (!open) return;
    if (step >= throws.length) { sfx.good(); return; }
    sfx.shake();
    const tick = setInterval(() => setSpin([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]), 70);
    const t = setTimeout(() => { clearInterval(tick); sfx.clack(); setStep((x) => x + 1); }, STEP);
    return () => { clearInterval(tick); clearTimeout(t); };
  }, [open, step, throws.length]);
  if (!open || !s.orderRoll) return null;
  const close = () => { try { sessionStorage.setItem(seenKey(s.id), '1'); } catch { /* */ } setOpen(false); };
  const done = step >= throws.length;
  const current = throws[step];
  return (
    <div className="order-back">
      <div className="order glass">
        <h3>🎲 Розыгрыш очерёдности</h3>
        <p className="muted small">Каждый бросает два кубика: кто выбросит больше — ходит раньше. При равенстве — переброс.</p>
        <div className="order-rows">
          {s.orderRoll.map((r) => {
            const mine = throws.map((t, k) => ({ ...t, k })).filter((t) => t.player === r.player);
            const rolling = current?.player === r.player;
            const place = done ? s.order.indexOf(r.player) + 1 : 0;
            return (
              <div key={r.player} className={`order-row ${rolling ? 'rolling' : ''} ${done && place === 1 ? 'first' : ''}`}>
                <PawnIcon color={s.players.find((p) => p.id === r.player)!.color} size={26} />
                <b className="order-name">{pn(s, r.player)}</b>
                <div className="order-dice">
                  {mine.map((t) => t.k < step ? (
                    <span key={t.k} className={`order-throw ${t.round ? 'reroll' : ''}`}><DieFace v={t.d[0]} /><DieFace v={t.d[1]} /><em>{t.d[0] + t.d[1]}</em></span>
                  ) : t.k === step ? (
                    <span key={t.k} className="order-throw spinning"><DieFace v={spin[0]} /><DieFace v={spin[1]} /></span>
                  ) : null)}
                </div>
                {done && <span className="order-place">{place}</span>}
              </div>
            );
          })}
        </div>
        {done && (
          <div className="order-result">
            <span>Очерёдность: {s.order.map((id) => pn(s, id)).join(' → ')}</span>
            <button className="btn gold shine" onClick={close}>Начать игру →</button>
          </div>
        )}
        {!done && <button className="btn ghost sm order-skip" onClick={() => setStep(throws.length)}>Пропустить анимацию</button>}
      </div>
    </div>
  );
}
