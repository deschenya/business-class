import type { Color, GameState, Party, PlayerId } from '../engine/types';
import { COLORS } from '../engine/types';
export { fmt, fmtSigned } from '../engine/util';

export const STOCK_HEX: Record<Color, string> = { red: '#e8436d', yellow: '#f39a2b', green: '#5fae3b', blue: '#2f86d6' };
export const STOCK_IMG: Record<Color, string> = { red: 'res/stocks/red.webp', yellow: 'res/stocks/yellow.webp', green: 'res/stocks/green.webp', blue: 'res/stocks/blue.webp' };

// Модная палитра фишек (по мотивам трендовых цветов последних лет)
export const PAWN_PALETTE: { hex: string; name: string }[] = [
  { hex: '#BB2649', name: 'Вива маджента' },
  { hex: '#2F6BFF', name: 'Электрик' },
  { hex: '#2FD3A0', name: 'Нео-мята' },
  { hex: '#9B7BFF', name: 'Цифровая лаванда' },
  { hex: '#FFB08A', name: 'Персик' },
  { hex: '#F5C02B', name: 'Горчица' },
  { hex: '#A47864', name: 'Мокко' },
  { hex: '#00B3C6', name: 'Бирюза' },
  { hex: '#FF5E5B', name: 'Коралл' },
  { hex: '#26262E', name: 'Оникс' },
];
export const PAWN_COLORS = PAWN_PALETTE.map((c) => c.hex);
export const colorName = (hex: string) => PAWN_PALETTE.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex;

/** Иконка фишки (SVG) — используется вместо портретов. */
export function pawnSvg(color: string, size = 28) {
  const id = `g${color.slice(1)}`;
  return `<svg class="pawn-svg" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="1"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient></defs><path d="M16 3.2a5 5 0 0 1 3.1 8.9 2.2 2.2 0 0 1 1.4 2c0 .8-.5 1.5-1.2 1.8.6 3.3 1.8 5.9 3.8 7.5 1 .8 1.6 1.7 1.6 2.8V27a1.8 1.8 0 0 1-1.8 1.8H9.1A1.8 1.8 0 0 1 7.3 27v-.8c0-1.1.6-2 1.6-2.8 2-1.6 3.2-4.2 3.8-7.5-.7-.3-1.2-1-1.2-1.8a2.2 2.2 0 0 1 1.4-2A5 5 0 0 1 16 3.2z" fill="${color}"/><path d="M16 3.2a5 5 0 0 1 3.1 8.9 2.2 2.2 0 0 1 1.4 2c0 .8-.5 1.5-1.2 1.8.6 3.3 1.8 5.9 3.8 7.5 1 .8 1.6 1.7 1.6 2.8V27a1.8 1.8 0 0 1-1.8 1.8H9.1A1.8 1.8 0 0 1 7.3 27v-.8c0-1.1.6-2 1.6-2.8 2-1.6 3.2-4.2 3.8-7.5-.7-.3-1.2-1-1.2-1.8a2.2 2.2 0 0 1 1.4-2A5 5 0 0 1 16 3.2z" fill="url(#${id})"/></svg>`;
}
export function PawnIcon({ color, size = 28 }: { color: string; size?: number }) {
  return <span className="pawn-icon" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: pawnSvg(color, size) }} />;
}

export const pn = (s: GameState, id: Party | string) => (id === 'bank' ? 'Банк' : id === 'host' ? 'Ведущий' : s.players.find((p) => p.id === id)?.name ?? id);
export const pc = (s: GameState, id: PlayerId) => s.players.find((p) => p.id === id)?.color ?? '#999';

export function Avatar({ s, id, size = 28 }: { s: GameState; id: PlayerId; size?: number }) {
  const p = s.players.find((x) => x.id === id);
  if (!p) return null;
  return <PawnIcon color={p.color} size={size} />;
}
export function StockDot({ c, n }: { c: Color; n?: number | string }) {
  return <span className="stock-dot" style={{ background: STOCK_HEX[c] }}>{n}</span>;
}
export const colorsOf = COLORS;
export const cls = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');
