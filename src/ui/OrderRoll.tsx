import type { GameState } from '../engine/types';
import { DieFace } from './ActionBar';
import { PawnIcon, pn } from './helpers';

/** Розыгрыш очерёдности: игроки сами бросают кубики (кнопка внизу), здесь — результаты бросков. */
export function OrderPanel({ s }: { s: GameState }) {
  const ph = s.orderPhase;
  if (s.turn.stage !== 'order' || !ph || !s.orderRoll) return null;
  const placeOf = (id: string) => {
    // уже определённые места: группы из одного игрока по порядку
    let k = 0;
    for (const b of ph.buckets) { if (b.length === 1 && b[0] === id) return k + 1; if (b.includes(id)) return 0; k += b.length; }
    return 0;
  };
  const allRolledOnce = s.orderRoll.every((r) => r.rolls.length > 0);
  return (
    <div className="order-panel glass">
      <b>🎲 Розыгрыш очерёдности</b>
      <span className="muted small">Каждый бросает один кубик — у кого больше, тот ходит раньше. При равенстве — переброс.</span>
      <div className="order-rows">
        {s.orderRoll.map((r) => {
          const rolling = s.turn.player === r.player;
          const place = allRolledOnce ? placeOf(r.player) : 0;
          return (
            <div key={r.player} className={`order-row ${rolling ? 'rolling' : ''}`}>
              <PawnIcon color={s.players.find((p) => p.id === r.player)!.color} size={22} />
              <span className="order-name">{pn(s, r.player)}</span>
              <div className="order-dice">
                {r.rolls.map((d, k) => (
                  <span key={k} className={`order-throw ${k ? 'reroll' : ''}`}>{d.map((v, j) => <DieFace key={j} v={v} />)}{d.length > 1 && <em>{d.reduce((a, b) => a + b, 0)}</em>}</span>
                ))}
                {rolling && <span className="muted small">бросает…</span>}
              </div>
              {place > 0 && <span className="order-place">{place}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
