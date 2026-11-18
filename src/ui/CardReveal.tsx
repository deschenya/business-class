import { useStore } from '../store';
import type { GameState } from '../engine/types';
import { closeReveal } from './Game';
import { pn } from './helpers';

export function CardReveal({ s }: { s: GameState }) {
  const reveal = useStore((st) => st.reveal);
  if (!reveal) return null;
  const deck = reveal.deck === 'exchange' ? s.data.cards.decks.exchange : s.data.cards.decks[reveal.deck as 'notice'];
  const card = (deck.cards as { id: string; image: string; text: string }[]).find((c) => c.id === reveal.card);
  if (!card) return null;
  const ex = reveal.deck === 'exchange';
  return (
    <div className="reveal-back" onClick={closeReveal}>
      <div className={`reveal ${ex ? 'ex' : ''}`}>
        <div className="reveal-card">
          <div className="face back"><img src={deck.back} alt="" /></div>
          <div className="face front"><img src={card.image} alt="" /></div>
        </div>
        <div className="reveal-text glass">
          <span className="muted small">{pn(s, reveal.player)} · «{deck.name}»</span>
          <p>{card.text}</p>
          <span className="muted small">нажмите, чтобы продолжить</span>
        </div>
      </div>
    </div>
  );
}
