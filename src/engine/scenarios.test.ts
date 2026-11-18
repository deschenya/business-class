import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { createGame, applyAction, awaitingRoll } from './engine';
import type { Action, GameData, GameState } from './types';
import { fmt } from './util';

const data: GameData = {
  board: JSON.parse(fs.readFileSync('public/data/board.json', 'utf8')),
  cards: JSON.parse(fs.readFileSync('public/data/cards.json', 'utf8')),
};

function newGame(n = 2): GameState {
  const players = Array.from({ length: n }, (_, i) => ({ name: ['Анна', 'Борис', 'Вера', 'Глеб'][i], color: '#fff', avatar: '', lady: i === 0 || i === 2 }));
  let s = createGame(data, { players, roles: { banker: 'host', broker: 'host', chairman: 'host', inspector: 'host' }, settings: { allowForcedDice: true }, seed: 42, keepOrder: true }).state;
  // фиксируем очерёдность p1, p2, ...
  s.order = s.players.map((p) => p.id);
  s.turn.player = 'p1';
  return s;
}
function act(s: GameState, a: Action): GameState {
  const r = applyAction(s, a);
  if (r.error) throw new Error(`${a.type}: ${r.error}`);
  return r.state;
}
const answer = (s: GameState, option: string, payload?: any, by?: any) => {
  const q = s.prompts[0];
  if (!q) throw new Error('нет вопроса');
  return act(s, { type: 'answer', by: by ?? (q.to.startsWith('p') ? q.to : 'host'), prompt: q.id, option, payload });
};
const roll = (s: GameState, d: number[]) => act(s, { type: 'roll', by: s.turn.player, force: d });
/** Закрыть все вопросы «по умолчанию» (отказ/первый вариант, валидные данные для форм) — между ходами в сценариях. */
function clear(s: GameState): GameState {
  for (let k = 0; k < 20 && s.prompts.length; k++) {
    const q = s.prompts[0];
    const f = q.form;
    const payload = !f ? undefined
      : f.kind === 'pickCard' ? { index: 0 }
      : f.kind === 'stockCounts' ? { counts: { red: f.total, yellow: 0, green: 0, blue: 0 } }
      : f.kind === 'distribute' ? { amounts: Object.fromEntries(f.players!.map((pl, i) => [pl, i === 0 ? f.total : 0])) }
      : f.kind === 'assignColors' ? { colors: ['red', 'yellow', 'green', 'blue'].slice(0, f.values!.length) }
      : f.kind === 'amount' ? { amount: 0 }
      : f.kind === 'pickPlayer' ? { player: f.players![0] }
      : f.kind === 'pickCell' ? { cell: f.cells![0], player: f.players?.[0] }
      : undefined;
    const opts = q.options.filter((o) => !o.disabled);
    const pref = ['skip', 'pass', 'stay', 'move', 'default', 'no', 'more', 'none'];
    const option = f?.kind === 'pickCard' ? (f.faceUp ? '0' : 'pick') : (opts.find((o) => pref.includes(o.id)) ?? opts[0] ?? q.options[0]).id;
    s = act(s, { type: 'answer', by: (q.to.startsWith('p') ? q.to : 'host') as any, prompt: q.id, option, payload });
  }
  return s;
}
const end = (s: GameState) => act(s, { type: 'endTurn', by: s.turn.player });
const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const place = (s: GameState, id: string, cell: number) => { P(s, id).pos = { z: 'c', id: cell }; return s; };

describe('Бизнес-класс: сценарии', () => {
  it('1. стартовые ресурсы', () => {
    const s = newGame(4);
    for (const p of s.players) {
      expect(p.money).toBe(350000);
      expect(p.stocks).toEqual({ red: 1, yellow: 1, green: 1, blue: 1 });
      expect(p.quotes).toEqual({ red: 10000, yellow: 10000, green: 10000, blue: 10000 });
      expect(p.pos).toEqual({ z: 'c', id: 0 });
    }
  });

  it('2. покупка участка и филиала', () => {
    let s = newGame();
    s = roll(s, [1, 2]); // Старт -> 3 Nike (цена 50 000)
    expect(s.prompts[0].ctx.type).toBe('buyPlot');
    s = answer(s, 'buy');
    expect(P(s, 'p1').money).toBe(350000 - 25000);
    expect(s.props[3]).toMatchObject({ owner: 'p1', level: 'plot' });
    s = end(s); s = roll(s, [1, 1]); s = clear(s); s = end(s);
    place(s, 'p1', 0);
    s = roll(s, [1, 2]);
    expect(s.prompts[0].ctx.type).toBe('buyBranch');
    s = answer(s, 'buy');
    expect(s.props[3].level).toBe('branch');
    expect(P(s, 'p1').money).toBe(350000 - 50000);
  });

  it('3. комплект из трёх филиалов → предприятие', () => {
    let s = newGame();
    for (const id of [1, 3, 5]) s.props[id] = { cell: id, owner: 'p1', level: 'branch', pledged: null, paid: 0 };
    s = roll(s, [1, 2]);
    expect(s.prompts[0].ctx.type).toBe('buyEnterprise');
    const before = P(s, 'p1').money;
    s = answer(s, 'buy');
    expect(s.props[3].level).toBe('enterprise');
    expect(P(s, 'p1').money).toBe(before - 50000); // по скану: оплачивает стоимость
  });

  it('4. аренда и срок её требования', () => {
    let s = newGame(3);
    s.props[3] = { cell: 3, owner: 'p2', level: 'branch', pledged: null, paid: 50000 };
    s = roll(s, [1, 2]);
    const claim = s.claims.find((c) => c.status === 'open')!;
    expect(claim.amount).toBe(14000);
    expect(P(s, 'p1').money).toBe(350000); // без требования — не платит
    s = act(s, { type: 'claimRent', by: 'p2', claim: claim.id });
    expect(P(s, 'p1').money).toBe(350000 - 14000);
    expect(P(s, 'p2').money).toBe(350000 + 14000);
    // второй случай: владелец не успел до броска следующего игрока
    s = end(s); s = roll(s, [3, 4]); s = clear(s); s = end(s);
    place(s, 'p3', 0);
    s = roll(s, [1, 2]); // p3 на 3
    const c2 = s.claims.find((c) => c.status === 'open')!;
    s = end(s);
    s = roll(s, [1, 1]); // бросок следующего игрока (p1)
    expect(s.claims.find((c) => c.id === c2.id)!.status).toBe('expired');
    expect(P(s, 'p3').money).toBe(350000);
  });

  it('5. переход 24↔52 и таможня', () => {
    let s = newGame();
    place(s, 'p1', 20);
    s = roll(s, [2, 2]); // 24 Банк
    expect(P(s, 'p1').money).toBe(400000);
    expect(s.prompts[0].ctx.type).toBe('bankSwitch');
    s = answer(s, 'switch');
    expect(P(s, 'p1').pos).toEqual({ z: 'c', id: 52 });
    expect(P(s, 'p1').money).toBe(375000);
    s = end(s); s = roll(s, [1, 1]); s = clear(s); s = end(s);
    // въезд через таможню 31→40
    place(s, 'p1', 29);
    const m0 = P(s, 'p1').money;
    s = roll(s, [1, 2]); // 29→30→31→(32 | 40)
    expect(s.prompts[0].ctx.type).toBe('route');
    const opt = s.prompts[0].options.find((o) => o.label.includes('Таможня'))!;
    s = answer(s, opt.id);
    expect(P(s, 'p1').pos).toEqual({ z: 'c', id: 40 });
    expect(m0 - P(s, 'p1').money).toBe(10000);
    // выезд 40→Старт с одной недвижимостью в России
    s = end(s); s = roll(s, [1, 1]); s = clear(s); s = end(s);
    s.props[42] = { cell: 42, owner: 'p1', level: 'firm', pledged: null, paid: 50000 };
    place(s, 'p1', 40);
    const m1 = P(s, 'p1').money;
    s = roll(s, [1, 1]);
    const ex = s.prompts[0].options.find((o) => o.label.includes('Старт'))!;
    s = answer(s, ex.id);
    // 15 000 пошлины + 5 000 × 1 − 20 000 за Старт (прохождение)
    expect(P(s, 'p1').money - m1).toBe(-15000 - 5000 + 20000);
  });

  it('6. биржа: простой ход с остановкой на 20', () => {
    let s = newGame();
    place(s, 'p1', 8);
    s = roll(s, [1, 1]); // 10 Биржа
    s = answer(s, 'play');
    s = answer(s, 'green');
    s = answer(s, 'simple');
    expect(awaitingRoll(s)).toBe('exchange');
    s = roll(s, [1, 3]); // 4
    s = roll(s, [3, 4]); // 11
    s = roll(s, [4, 5]); // 20
    const p = P(s, 'p1');
    expect(p.quotes.green).toBe(10000 + 35000);
    expect(p.quotes.red).toBe(10000 + 20000);
    expect(p.quotes.blue).toBe(30000);
    expect(s.prompts[0].ctx.type).toBe('exExit');
    s = answer(s, '50');
    expect(P(s, 'p1').pos).toEqual({ z: 'c', id: 50 });
  });

  it('7. рискованная карта действует на всех', () => {
    let s = newGame(3);
    s.exchange = { player: 'p1', lane: 'yellow', n: 0, mode: 'risk', origin: { z: 'c', id: 10 }, from66: false, done: false, stops: [] };
    P(s, 'p1').pos = { z: 'x', lane: 'yellow', n: 0 };
    s.turn.rolled = true;
    s = roll(s, [4, 6]); // 10 — особая клетка
    expect(P(s, 'p1').quotes.yellow).toBe(20000);
    expect(P(s, 'p1').quotes.blue).toBe(20000);
    // подменим порядок колоды: найдём карточку «синий +10»
    const idx = s.data.cards.decks.exchange.cards.findIndex((c) => c.id === 'ex-blue-3');
    s.data.cards.decks.exchange.cards = [s.data.cards.decks.exchange.cards[idx]];
    s = answer(s, 'pick', { index: 0 });
    expect(P(s, 'p1').quotes.blue).toBe(30000);
    expect(P(s, 'p2').quotes.blue).toBe(20000);
    expect(P(s, 'p3').quotes.blue).toBe(20000);
    expect(s.market.filter((m) => m.reason.includes('биржевая карточка')).length).toBe(3);
  });

  it('8. залог и истечение срока', () => {
    let s = newGame();
    s.props[3] = { cell: 3, owner: 'p1', level: 'branch', pledged: null, paid: 50000 };
    s = act(s, { type: 'requestLoan', by: 'p1', cell: 3, kind: 'money', amount: 40000 });
    s = answer(s, 'ok', undefined, 'host');
    expect(P(s, 'p1').money).toBe(390000);
    expect(s.props[3].pledged).toBeTruthy();
    expect(() => act(s, { type: 'requestLoan', by: 'p1', cell: 3, kind: 'money', amount: 1000 })).toThrow();
    // проходим 40 клеток
    const loan = s.loans[0];
    s.loans[0].remaining = 3;
    place(s, 'p1', 5);
    s = roll(s, [1, 2]); // 8 Apple
    while (s.prompts.length && s.prompts[0].ctx.type !== 'loanDue') s = answer(s, s.prompts[0].options.at(-1)!.id);
    expect(s.prompts[0].ctx.type).toBe('loanDue');
    s = answer(s, 'default');
    expect(s.props[3].owner).toBe('bank');
    expect(s.loans.find((l) => l.id === loan.id)!.status).toBe('defaulted');
    // выкуп с торгов: торги по банковскому залогу — это ход заявившего
    s = end(s);
    s = act(s, { type: 'auctionStart', by: 'p2', lot: { type: 'prop', cell: 3 } });
    s = act(s, { type: 'auctionBid', by: 'p2', amount: 30000 });
    s = act(s, { type: 'auctionClose', by: 'host' });
    expect(s.props[3].owner).toBe('p2');
    expect(s.turn.stage).toBe('post');
  });

  it('9. банкротство', () => {
    let s = newGame(3);
    s.props[26] = { cell: 26, owner: 'p2', level: 'enterprise', pledged: null, paid: 300000 };
    const p1 = P(s, 'p1');
    p1.money = 50000; p1.stocks = { red: 0, yellow: 0, green: 0, blue: 0 };
    place(s, 'p1', 24);
    s = roll(s, [1, 1]); // 26 Форд, аренда предприятия 100 000
    const cl = s.claims.find((c) => c.status === 'open')!;
    s = act(s, { type: 'claimRent', by: 'p2', claim: cl.id });
    expect(s.debts.length).toBe(1);
    s = act(s, { type: 'declareBankrupt', by: 'p1', player: 'p1' });
    s = answer(s, 'ok', undefined, 'host');
    expect(P(s, 'p1').bankrupt).toBe(true);
    expect(P(s, 'p2').money).toBe(350000 + 100000); // банк выплатил кредитору весь долг
    expect(s.turn.player).toBe('p2');
  });

  it('рулетка: обход против часовой и выход на зелёном', () => {
    let s = newGame();
    place(s, 'p1', 49);
    s = roll(s, [1, 1]); // 51
    s = answer(s, 'play');
    expect(awaitingRoll(s)).toBe('roulette');
    s = roll(s, [1, 1]); // -25000 -> +65000 -> -30000
    expect(P(s, 'p1').money).toBe(350000 - 30000);
    s = roll(s, [3, 3]); // -30000 → В БАНК, В БАНК, -20000, +20000, -1000, +30000 (выход)
    expect(P(s, 'p1').money).toBe(350000);
    expect(s.prompts[0].ctx.type).toBe('rlLeave');
    s = answer(s, '52');
    expect(P(s, 'p1').pos).toEqual({ z: 'c', id: 52 });
  });

  it('уточнённые правила: фирма в России за полную цену', () => {
    let s = newGame();
    place(s, 'p1', 40);
    s = roll(s, [1, 1]); // 40→41→42 АЗЛК (цена 100 000)
    while (s.prompts[0]?.ctx.type === 'route') s = answer(s, s.prompts[0].options.find((o) => !o.label.includes('Старт'))!.id);
    expect(s.prompts[0].ctx.type).toBe('buyRu');
    expect(s.prompts[0].ctx.cost).toBe(100000);
  });

  it('уточнённые правила: «сосед справа» — следующий по очереди', () => {
    let s = newGame(3);
    s.data.cards.decks.fine.cards = [s.data.cards.decks.fine.cards.find((c) => c.id === 'fine-3')!];
    place(s, 'p1', 20);
    s = roll(s, [1, 2]); // 23 Штраф
    s = answer(s, 'pick', { index: 0 });
    expect(P(s, 'p2').money).toBe(355000);
    expect(P(s, 'p1').money).toBe(345000);
  });

  it('уточнённые правила: бросок дальше 20 на бирже — без прибавки, ровно на «Старт» — $20 000', () => {
    let s = newGame();
    s.exchange = { player: 'p1', lane: 'red', n: 15, mode: 'simple', origin: { z: 'c', id: 10 }, from66: false, done: false, stops: [15] };
    P(s, 'p1').pos = { z: 'x', lane: 'red', n: 15 };
    s.turn.rolled = true;
    const q0 = P(s, 'p1').quotes.red;
    s = roll(s, [4, 5]);
    expect(P(s, 'p1').quotes.red).toBe(q0);
    expect(s.prompts[0].ctx.type).toBe('exExit');
    let t = newGame();
    place(t, 'p1', 37);
    t = roll(t, [1, 2]); // 37 → 0
    expect(P(t, 'p1').money).toBe(370000);
  });

  it('розыгрыш очерёдности: два кубика, по убыванию суммы, равные перебрасывают', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const players = ['А', 'Б', 'В', 'Г'].map((name) => ({ name, color: '#fff', avatar: '', lady: false }));
      const s = createGame(data, { players, roles: { banker: 'host', broker: 'host', chairman: 'host', inspector: 'host' }, seed }).state;
      expect(s.orderRoll?.length).toBe(4);
      expect(new Set(s.order).size).toBe(4);
      expect(s.turn.player).toBe(s.order[0]);
      const first = (id: string) => s.orderRoll!.find((r) => r.player === id)!.rolls[0];
      const sum = (d: number[]) => d[0] + d[1];
      // по первым броскам порядок не возрастает; при равенстве решает переброс
      for (let k = 1; k < 4; k++) expect(sum(first(s.order[k - 1]))).toBeGreaterThanOrEqual(sum(first(s.order[k])));
      for (const r of s.orderRoll!) for (const d of r.rolls) { expect(d.length).toBe(2); d.forEach((v) => expect(v >= 1 && v <= 6).toBe(true)); }
    }
    const off = createGame(data, { players: [{ name: 'А', color: '#fff', avatar: '', lady: false }, { name: 'Б', color: '#fff', avatar: '', lady: false }], roles: { banker: 'host', broker: 'host', chairman: 'host', inspector: 'host' }, rollOrder: false }).state;
    expect(off.order).toEqual(['p1', 'p2']);
    expect(off.orderRoll).toBeUndefined();
  });

  it('демо-журнал расчётов ведётся', () => {
    let s = newGame();
    s = roll(s, [1, 2]); s = answer(s, 'buy');
    expect(s.ledger.at(-1)).toMatchObject({ from: 'p1', to: 'bank', amount: 25000 });
    expect(fmt(25000)).toBe('$25 000');
  });
});
