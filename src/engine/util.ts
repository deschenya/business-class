import type { Color, CompanyCell, GameEvent, GameState, Party, Player, PlayerId, Pos, Prompt, Property } from './types';
import { COLORS } from './types';
import { RULES, type RuleKey } from './rulings';

export interface Ctx { s: GameState; ev: GameEvent[] }

export const fmt = (n: number) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('ru-RU').replace(/ /g, ' ');
export const fmtSigned = (n: number) => (n >= 0 ? '+' : '') + fmt(n);

// ---------------------------------------------------------------- RNG (mulberry32, состояние в GameState)
export function rand(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const die = (s: GameState) => 1 + Math.floor(rand(s) * 6);
export function shuffle<T>(s: GameState, arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const uid = (s: GameState, p: string) => `${p}${++s.seq}`;

// ---------------------------------------------------------------- доступ
export const P = (s: GameState, id: PlayerId): Player => {
  const p = s.players.find((x) => x.id === id);
  if (!p) throw new Error(`Нет игрока ${id}`);
  return p;
};
export const pname = (s: GameState, id: Party) => (id === 'bank' ? 'Банк' : s.players.find((x) => x.id === id)?.name ?? id);
export const cellOf = (s: GameState, id: number): CompanyCell => s.data.board.cells.find((c) => c.id === id)!;
export const cellName = (s: GameState, id: number) => { const c = cellOf(s, id); return `№${id} ${c.name}`; };
export const active = (s: GameState) => s.order.map((id) => P(s, id)).filter((p) => !p.bankrupt);
export const posEq = (a: Pos, b: Pos) => JSON.stringify(a) === JSON.stringify(b);
export const C = (id: number): Pos => ({ z: 'c', id });

export function posLabel(s: GameState, pos: Pos): string {
  switch (pos.z) {
    case 'c': return cellName(s, pos.id);
    case 'h': return `Автострада ${pos.n}: ${s.data.board.highway[pos.n - 1]?.name ?? ''}`;
    case 'x': return pos.n === 0 ? 'Биржа (вход)' : `Биржа, клетка ${pos.n}`;
    case 'r': return `Рулетка: ${s.data.board.roulette.sectors.find((x) => x.slot === pos.slot)?.label}`;
  }
}

// ---------------------------------------------------------------- журнал
export function log(c: Ctx, kind: GameState['log'][number]['kind'], text: string, player?: PlayerId) {
  c.s.log.push({ i: c.s.log.length, turn: c.s.turn?.n ?? 0, kind, text, player });
}
/** Уточнённое правило (единое для всех партий, см. rulings.ts). */
export function ruling(_c: Ctx, key: RuleKey): string {
  return RULES[key];
}
export const toast = (c: Ctx, text: string, tone: 'good' | 'bad' | 'info' = 'info') => c.ev.push({ t: 'toast', text, tone });

// ---------------------------------------------------------------- деньги
export function transfer(c: Ctx, from: Party, to: Party, amount: number, reason: string) {
  amount = Math.round(amount);
  if (amount <= 0 || from === to) return;
  const s = c.s;
  if (from !== 'bank') P(s, from).money -= amount; else s.bankStats.paidOut += amount;
  if (to !== 'bank') P(s, to).money += amount; else s.bankStats.received += amount;
  s.ledger.push({ i: s.ledger.length, turn: s.turn.n, from, to, amount, reason });
  log(c, 'money', `${pname(s, from)} → ${pname(s, to)}: ${fmt(amount)} — ${reason}`, from === 'bank' ? (to as string) : from);
  c.ev.push({ t: 'money', from, to, amount, reason });
}

/** Обязательный платёж. Если денег не хватает — создаётся долг, который блокирует ход должника. */
export function charge(c: Ctx, payer: PlayerId, to: Party, amount: number, reason: string): boolean {
  amount = Math.round(amount);
  if (amount <= 0) return true;
  const p = P(c.s, payer);
  if (p.money >= amount) { transfer(c, payer, to, amount, reason); return true; }
  c.s.debts.push({ id: uid(c.s, 'd'), debtor: payer, creditor: to, amount, reason });
  log(c, 'warn', `${p.name}: не хватает средств на платёж ${fmt(amount)} (${reason}). Есть ${fmt(p.money)} — нужно продать имущество, взять кредит или объявить банкротство.`, payer);
  toast(c, `${p.name}: недостаточно средств (${fmt(amount)})`, 'bad');
  return false;
}

// ---------------------------------------------------------------- котировки
export function setQuote(c: Ctx, pid: PlayerId, color: Color, value: number, reason: string, changes?: { player: PlayerId; color: Color; from: number; to: number }[]) {
  const p = P(c.s, pid);
  let v = Math.round(value);
  if (v < 0 && ruling(c, 'quoteFloor') === 'zero') v = 0;
  const from = p.quotes[color];
  if (from === v) return;
  p.quotes[color] = v;
  c.s.market.push({ i: c.s.market.length, turn: c.s.turn.n, player: pid, color, from, to: v, reason });
  const ch = { player: pid, color, from, to: v };
  if (changes) changes.push(ch); else c.ev.push({ t: 'quotes', changes: [ch] });
}
export const maxQuote = (s: GameState, color: Color) => Math.max(...active(s).map((p) => p.quotes[color]), 0);

// ---------------------------------------------------------------- собственность
export function propValue(s: GameState, pr: Property): number {
  const cell = cellOf(s, pr.cell);
  if (pr.paid > 0) return pr.paid;
  const price = cell.price ?? 0;
  if (cell.type === 'company') return pr.level === 'plot' ? price / 2 : price;
  return price;
}
export const propsOf = (s: GameState, pid: Party) => Object.values(s.props).filter((x) => x.owner === pid);
export function stocksValue(s: GameState, p: Player) { return COLORS.reduce((a, col) => a + p.stocks[col] * Math.max(0, p.quotes[col]), 0); }
export function assetsValue(s: GameState, pid: PlayerId) {
  const p = P(s, pid);
  return stocksValue(s, p) + propsOf(s, pid).reduce((a, pr) => a + propValue(s, pr), 0);
}
export function netWorth(s: GameState, pid: PlayerId) {
  const p = P(s, pid);
  const loans = s.loans.filter((l) => l.player === pid && l.status === 'active').reduce((a, l) => a + l.amount, 0);
  return p.money + assetsValue(s, pid) - loans;
}
export function setProp(c: Ctx, cell: number, owner: Party | null, level: Property['level'] | null, paidAdd = 0) {
  const s = c.s;
  if (!owner || !level) { delete s.props[cell]; c.ev.push({ t: 'prop', cell, owner: null, level: null }); return; }
  const cur = s.props[cell];
  s.props[cell] = { cell, owner, level, pledged: cur?.pledged ?? null, paid: (cur && cur.owner === owner ? cur.paid : 0) + paidAdd };
  c.ev.push({ t: 'prop', cell, owner: owner === 'bank' ? null : owner, level: owner === 'bank' ? null : level });
}

// ---------------------------------------------------------------- соседи
export function neighbor(c: Ctx, pid: PlayerId, dir: 'next' | 'prev'): PlayerId | null {
  const list = active(c.s);
  if (list.length < 2) return null;
  const i = list.findIndex((p) => p.id === pid);
  const j = dir === 'next' ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
  return list[j].id;
}
export function rightNeighbor(c: Ctx, pid: PlayerId) {
  return neighbor(c, pid, ruling(c, 'rightNeighbor') === 'next' ? 'next' : 'prev');
}
export function opposite(s: GameState, pid: PlayerId): PlayerId | null {
  const list = active(s);
  if (list.length < 2 || list.length % 2 === 1) return list.length === 2 ? list.find((p) => p.id !== pid)!.id : null;
  const i = list.findIndex((p) => p.id === pid);
  return list[(i + list.length / 2) % list.length].id;
}

// ---------------------------------------------------------------- подсказки
export function ask(c: Ctx, p: Omit<Prompt, 'id'>): Prompt {
  const pr = { ...p, id: uid(c.s, 'q') } as Prompt;
  c.s.prompts.push(pr);
  return pr;
}
export function resolveTarget(s: GameState, to: Prompt['to']): PlayerId | 'host' {
  if (to === 'banker' || to === 'broker' || to === 'chairman' || to === 'inspector') return s.roles[to];
  return to;
}
