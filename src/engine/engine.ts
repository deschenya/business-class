import type {
  Action, ApplyResult, Card, CardEffect, Color, DeckId, ExCard, GameData, GameState, HighwayEffect, Loan, Lot, PlayerId,
  Pos, Prompt, RoleId, Settings, Bundle,
} from './types';
import { COLORS, COLOR_RU, COLOR_RU_PL, LEVEL_RU, ROLE_RU } from './types';
import { RULES } from './rulings';
import {
  type Ctx, C, P, active, ask, assetsValue, cellName, cellOf, charge, die, fmt, fmtSigned, log, maxQuote,
  neighbor, netWorth, opposite, pname, posLabel, propValue, propsOf, resolveTarget, rightNeighbor, ruling, setProp,
  setQuote, shuffle, toast, transfer, uid,
} from './util';

// ====================================================================== создание партии
export interface SetupPlayer { name: string; color: string; avatar: string; lady: boolean }
export interface Setup {
  title?: string;
  players: SetupPlayer[];
  roles: Record<RoleId, number | 'host'>; // индекс игрока или ведущий
  settings?: Partial<Settings>;
  seed?: number;
  keepOrder?: boolean; // очерёдность задаёт ведущий (тесты)
  rollOrder?: boolean; // разыграть очередь хода двумя кубиками (по умолчанию да)
}

export const DEFAULT_SETTINGS: Settings = { startMoney: 350000, startQuote: 10000, startStocks: 1, rentNeedsClaim: true, allowForcedDice: false };

export function createGame(data: GameData, setup: Setup): ApplyResult {
  const settings = { ...DEFAULT_SETTINGS, ...(setup.settings || {}) };
  const seed = setup.seed ?? (Date.now() & 0x7fffffff);
  const players = setup.players.map((sp, i) => ({
    id: `p${i + 1}`, name: sp.name.trim() || `Игрок ${i + 1}`, color: sp.color, avatar: sp.avatar, lady: sp.lady,
    money: settings.startMoney,
    stocks: { red: settings.startStocks, yellow: settings.startStocks, green: settings.startStocks, blue: settings.startStocks },
    quotes: { red: settings.startQuote, yellow: settings.startQuote, green: settings.startQuote, blue: settings.startQuote },
    pos: C(0), skip: 0, oneDieNext: false, bankrupt: false, rentWaivers: [],
  }));
  const roles = Object.fromEntries(Object.entries(setup.roles).map(([r, v]) => [r, v === 'host' ? 'host' : players[v]?.id ?? 'host'])) as Record<RoleId, PlayerId | 'host'>;
  const s: GameState = {
    v: 1, id: `g${seed.toString(36)}${Date.now().toString(36)}`, title: setup.title || 'Партия', createdAt: Date.now(), updatedAt: Date.now(),
    data: structuredClone(data), settings, rulings: { ...RULES }, roles,
    players, order: players.map((p) => p.id),
    turn: { n: 1, player: players[0].id, stage: 'pre', dice: null, extra: false, extraOneDie: false, oneDie: false, rolled: false },
    rollIndex: 0, props: {}, loans: [], claims: [], debts: [], auction: null, trades: [], prompts: [], exchange: null, roulette: null,
    log: [], ledger: [], market: [], bankStats: { paidOut: 0, received: 0 }, rng: seed, seq: 0, winner: null,
  };
  const c: Ctx = { s, ev: [] };
  log(c, 'turn', `Новая партия «${s.title}». Игроков: ${players.length}. Каждому — ${fmt(settings.startMoney)} и по ${settings.startStocks} акции каждого цвета номиналом ${fmt(settings.startQuote)}.`);
  for (const [r, v] of Object.entries(roles)) log(c, 'info', `${ROLE_RU[r as RoleId]}: ${v === 'host' ? 'ведущий' : pname(s, v)}`);
  for (const p of players) for (const col of COLORS) s.market.push({ i: s.market.length, turn: 0, player: p.id, color: col, from: settings.startQuote, to: settings.startQuote, reason: 'стартовая' });
  // очерёдность: каждый бросает два кубика, порядок — по убыванию суммы; равные перебрасывают между собой
  if (setup.keepOrder || setup.rollOrder === false) {
    log(c, 'info', 'Очерёдность — в порядке списка игроков.');
  } else {
    const rollsOf = new Map<PlayerId, number[][]>(players.map((p) => [p.id, []]));
    const rank = (ids: PlayerId[], depth: number): PlayerId[] => {
      if (ids.length <= 1 || depth > 12) return ids;
      const res = ids.map((id) => { const d = [die(s), die(s)]; rollsOf.get(id)!.push(d); return { id, sum: d[0] + d[1] }; });
      const sums = [...new Set(res.map((r) => r.sum))].sort((x, y) => y - x);
      return sums.flatMap((v) => rank(res.filter((r) => r.sum === v).map((r) => r.id), depth + 1));
    };
    s.order = rank(players.map((p) => p.id), 0);
    s.orderRoll = players.map((p) => ({ player: p.id, rolls: rollsOf.get(p.id)! }));
    log(c, 'info', 'Розыгрыш очерёдности (два кубика): ' + players.map((p) => `${p.name} — ${rollsOf.get(p.id)!.map((d) => `${d[0]}+${d[1]}`).join(', затем ')}`).join('; ') + '.');
    log(c, 'turn', 'Очерёдность ходов: ' + s.order.map((id, k) => `${k + 1}. ${pname(s, id)}`).join(', ') + '.');
  }
  const first = s.order[0];
  s.turn.player = first;
  log(c, 'turn', `Первым ходит ${pname(s, first)}. Все фишки на клетке «Старт».`);
  log(c, 'turn', `Ход 1 — ${pname(s, first)}`);
  return { state: s, events: c.ev };
}

// ====================================================================== движение
interface Step { to: Pos; fee?: number; feeKey?: string; label?: string }
function stepsFrom(s: GameState, pos: Pos): Step[] {
  const b = s.data.board;
  if (pos.z === 'h') {
    if (pos.n < 10) return [{ to: { z: 'h', n: pos.n + 1 } }];
    return b.edges.highway.exits.map((id) => ({ to: C(id), label: `съезд с автострады на ${cellName(s, id)}` }));
  }
  if (pos.z !== 'c') return [];
  const id = pos.id;
  const out: Step[] = [];
  const loop = b.edges.innerLoop;
  if (id < 40) out.push({ to: C((id + 1) % 40) });
  else { const i = loop.indexOf(id); if (i >= 0) out.push({ to: C(loop[(i + 1) % loop.length]) }); }
  for (const br of b.edges.branches) if (br.from === id) out.push({ to: C(br.to), fee: br.fee, feeKey: br.feeKey, label: br.label });
  return out;
}

interface Path { steps: Step[] }
function enumerate(s: GameState, start: Pos, n: number): Path[] {
  const res: Path[] = [];
  const rec = (pos: Pos, left: number, acc: Step[]) => {
    if (left === 0) { res.push({ steps: acc }); return; }
    const nx = stepsFrom(s, pos);
    if (!nx.length) { res.push({ steps: acc }); return; }
    for (const st of nx) rec(st.to, left - 1, [...acc, st]);
  };
  rec(start, n, []);
  // уникальность по конечной клетке + использованным развилкам
  const seen = new Set<string>();
  return res.filter((p) => { const k = JSON.stringify([p.steps.at(-1)?.to, p.steps.filter((x) => x.label).map((x) => x.label)]); if (seen.has(k)) return false; seen.add(k); return true; });
}
function pathLabel(s: GameState, p: Path): string {
  const end = p.steps.at(-1)?.to;
  const via = p.steps.filter((x) => x.label).map((x) => x.label!.replace(/\s*\(.*\)/, ''));
  return `${end ? posLabel(s, end) : '—'}${via.length ? ` · ${via.join(', ')}` : ''}`;
}

function ruProperties(s: GameState, pid: PlayerId) {
  return propsOf(s, pid).filter((pr) => cellOf(s, pr.cell).zone === 'inner').length;
}

function executePath(c: Ctx, pid: PlayerId, path: Path) {
  const s = c.s;
  const p = P(s, pid);
  const poss: Pos[] = [p.pos];
  let perimeterSteps = 0;
  path.steps.forEach((st, i) => {
    const last = i === path.steps.length - 1;
    if (st.feeKey === 'customsEntry') charge(c, pid, 'bank', st.fee ?? 10000, 'таможенная пошлина при въезде в Россию (31→40)');
    if (st.feeKey === 'customsExit') {
      const cell = cellOf(s, 40);
      const n = ruProperties(s, pid);
      charge(c, pid, 'bank', (cell.exitDuty ?? 15000) + (cell.exitPerRuProperty ?? 5000) * n, `выезд через таможенный пост: пошлина ${fmt(cell.exitDuty ?? 15000)} + ${fmt(cell.exitPerRuProperty ?? 5000)} × ${n} (недвижимость в России)`);
    }
    if (st.to.z === 'c' && st.to.id === 0) {
      if (!last || ruling(c, 'startOnLand') === 'yes') transfer(c, 'bank', pid, cellOf(s, 0).bonusPass ?? 20000, last ? 'остановка на «Старте»' : 'прохождение «Старта»');
    }
    if (st.to.z === 'c') perimeterSteps++;
    poss.push(st.to);
  });
  const end = path.steps.at(-1)?.to ?? p.pos;
  p.pos = end;
  c.ev.push({ t: 'move', player: pid, path: poss });
  log(c, 'info', `${p.name} перемещается: ${posLabel(s, end)}`, pid);
  // сроки кредитов — по пройденным клеткам периметров
  for (const l of s.loans) if (l.player === pid && l.status === 'active') l.remaining -= perimeterSteps;
  land(c, pid, end);
  checkLoans(c, pid);
}

function moveBy(c: Ctx, pid: PlayerId, steps: number) {
  const p = P(c.s, pid);
  const paths = enumerate(c.s, p.pos, steps);
  if (paths.length <= 1) return executePath(c, pid, paths[0] ?? { steps: [] });
  ask(c, {
    to: pid, title: 'Выберите маршрут', text: `Выпало ${steps}. Доступно несколько путей:`,
    options: paths.map((pa, i) => ({ id: String(i), label: pathLabel(c.s, pa), hint: pa.steps.some((x) => x.fee || x.feeKey) ? 'платный переход' : undefined })),
    ctx: { type: 'route', paths },
  });
}

// ====================================================================== эффекты клеток
function land(c: Ctx, pid: PlayerId, pos: Pos) {
  const s = c.s;
  const p = P(s, pid);
  if (pos.z === 'h') return landHighway(c, pid, pos.n);
  if (pos.z !== 'c') return;
  const cell = cellOf(s, pos.id);
  switch (cell.type) {
    case 'company': return landCompany(c, pid, pos.id);
    case 'ru_company': return landRuCompany(c, pid, pos.id);
    case 'win':
      transfer(c, 'bank', pid, cell.amount ?? 0, `клетка «${cell.name}»`);
      toast(c, `${p.name}: ${cell.name} ${fmtSigned(cell.amount ?? 0)}`, 'good');
      return;
    case 'card': return drawPrompt(c, pid, cell.deck as DeckId);
    case 'exchange_gate':
      ask(c, { to: pid, title: 'Биржа', text: `Сыграть на бирже или пройти «${cell.name}» как обычную клетку №${pos.id}?`, options: [{ id: 'play', label: 'Сыграть на бирже', tone: 'primary' }, { id: 'pass', label: 'Пройти как обычную клетку' }], ctx: { type: 'exGate' } });
      return;
    case 'broker':
      ask(c, { to: pid, title: 'Маклер', text: `Можно пройти на биржу, оплатив в банк взнос ${fmt(cell.exchangeFee ?? 5000)}.`, options: [{ id: 'play', label: `На биржу (${fmt(cell.exchangeFee ?? 5000)})`, tone: 'primary', disabled: p.money < (cell.exchangeFee ?? 5000) }, { id: 'pass', label: 'Остаться' }], ctx: { type: 'brokerGate' } });
      return;
    case 'bank': {
      transfer(c, 'bank', pid, cell.premium ?? 50000, 'премия клиенту банка');
      const twin = cell.twin!;
      ask(c, {
        to: pid, title: 'Клиент банка', text: `Выберите периметр для следующего хода. Переход ${pos.id}→${twin} — пошлина ${fmt(cell.transferFee ?? 25000)}.`,
        options: [{ id: 'stay', label: pos.id === 24 ? 'Остаться за рубежом (клетка 24)' : 'Остаться в России (клетка 52)' }, { id: 'switch', label: twin === 52 ? `Перейти в Россию (52) −${fmt(cell.transferFee ?? 25000)}` : `Выехать за рубеж (24) −${fmt(cell.transferFee ?? 25000)}` }],
        ctx: { type: 'bankSwitch', from: pos.id, to: twin, fee: cell.transferFee ?? 25000 },
      });
      return;
    }
    case 'hotel': return landHotel(c, pid);
    case 'supermarket': return landSupermarket(c, pid, pos.id);
    case 'win50': {
      transfer(c, 'bank', pid, cell.amount ?? 20000, `клетка «${cell.name}» №50`);
      askStocks(c, pid, cell.stocks ?? 5, `Выигрыш: ${cell.stocks ?? 5} акций`);
      ask(c, { to: pid, title: 'Рулетка', text: 'После остановки на клетке 50 можно сыграть на рулетке.', options: [{ id: 'play', label: 'Сыграть на рулетке', tone: 'primary' }, { id: 'pass', label: 'Не играть' }], ctx: { type: 'rlGate', returnTo: null } });
      return;
    }
    case 'roulette_gate':
      ask(c, { to: pid, title: 'Рулетка', text: 'Сыграть на рулетке или пройти клетку №51 как обычную?', options: [{ id: 'play', label: 'Сыграть на рулетке', tone: 'primary' }, { id: 'pass', label: 'Пройти как обычную клетку' }], ctx: { type: 'rlGate', returnTo: null } });
      return;
    default:
      return;
  }
}

function inTriple(s: GameState, pid: PlayerId, cellId: number, c: Ctx): boolean {
  for (const g of s.data.board.groups) {
    if (!g.cells.includes(cellId)) continue;
    if (g.cells.every((id) => { const pr = s.props[id]; return pr && pr.owner === pid && (pr.level === 'branch' || pr.level === 'enterprise'); })) {
      return true;
    }
  }
  return false;
}

function landCompany(c: Ctx, pid: PlayerId, id: number) {
  const s = c.s;
  const cell = cellOf(s, id);
  const p = P(s, pid);
  const pr = s.props[id];
  const price = cell.price ?? 0;
  if (!pr) {
    const cost = Math.round(price / 2);
    ask(c, { to: pid, title: `${cell.name} — свободный участок`, text: `Купить участок за половину цены предприятия: ${fmt(cost)} (цена ${fmt(price)}).`, options: [{ id: 'buy', label: `Купить участок ${fmt(cost)}`, tone: 'primary', disabled: p.money < cost }, { id: 'skip', label: 'Отказаться' }], ctx: { type: 'buyPlot', cell: id, cost } });
    return;
  }
  if (pr.owner === pid) {
    if (pr.level === 'plot') {
      const cost = price - Math.round(price / 2);
      ask(c, { to: pid, title: `${cell.name} — ваш участок`, text: `Открыть филиал, уплатив вторую половину стоимости: ${fmt(cost)}.`, options: [{ id: 'buy', label: `Открыть филиал ${fmt(cost)}`, tone: 'primary', disabled: p.money < cost }, { id: 'skip', label: 'Не сейчас' }], ctx: { type: 'buyBranch', cell: id, cost } });
    } else if (pr.level === 'branch' && inTriple(s, pid, id, c)) {
      const pay = ruling(c, 'enterpriseCost') !== 'receive';
      ask(c, { to: pid, title: `${cell.name} — комплект из трёх филиалов`, text: pay ? `Можно открыть предприятие, оплатив в банк его стоимость ${fmt(price)}.` : `Можно открыть предприятие и получить в банке его стоимость ${fmt(price)}.`, options: [{ id: 'buy', label: `Открыть предприятие (${pay ? '−' : '+'}${fmt(price)})`, tone: 'primary', disabled: pay && p.money < price }, { id: 'skip', label: 'Не сейчас' }], ctx: { type: 'buyEnterprise', cell: id, cost: price } });
    }
    return;
  }
  if (pr.owner === 'bank') { log(c, 'info', `${cellName(s, id)} принадлежит банку (изъятый залог) — можно выкупить с торгов.`); return; }
  createClaim(c, pid, pr.owner, id, cell.rent ? cell.rent[pr.level as 'plot' | 'branch' | 'enterprise'] ?? 0 : 0);
}

function innerPrice(c: Ctx, id: number) {
  const cell = cellOf(c.s, id);
  return ruling(c, 'innerPrice') === 'full' ? cell.price ?? 0 : Math.round((cell.price ?? 0) / 2);
}

function landRuCompany(c: Ctx, pid: PlayerId, id: number) {
  const s = c.s;
  const cell = cellOf(s, id);
  const pr = s.props[id];
  const p = P(s, pid);
  if (!pr) {
    const cost = innerPrice(c, id);
    ask(c, { to: pid, title: `${cell.name} — свободная фирма`, text: `${cell.kind ?? ''} «${cell.name}». Цена на поле ${fmt(cell.price ?? 0)}; аренда ${fmt(cell.rentSingle ?? 0)}.`, options: [{ id: 'buy', label: `Купить за ${fmt(cost)}`, tone: 'primary', disabled: p.money < cost }, { id: 'skip', label: 'Отказаться' }], ctx: { type: 'buyRu', cell: id, cost } });
    return;
  }
  if (pr.owner === pid || pr.owner === 'bank') return;
  createClaim(c, pid, pr.owner, id, cell.rentSingle ?? 0);
}

function landHotel(c: Ctx, pid: PlayerId) {
  const s = c.s;
  const cell = cellOf(s, 30);
  const pr = s.props[30];
  if (!pr || pr.owner !== pid) charge(c, pid, pr && pr.owner !== 'bank' ? pr.owner : 'bank', cell.fee ?? 10000, 'плата в отеле (клетка 30)');
  const free = s.data.board.cells.filter((x) => x.type === 'ru_company' && !s.props[x.id]);
  ask(c, {
    to: pid, title: 'Отель', text: 'Дальнейшие действия:',
    options: [
      { id: 'stay', label: 'Двигаться дальше обычным порядком' },
      { id: 'highway', label: 'Проехать по автостраде (с клетки 1)' },
      { id: 'roulette', label: 'Сыграть два раза на рулетке и вернуться в отель' },
      { id: 'buyRu', label: 'Открыть фирму в России за ½ цены', disabled: !free.length },
    ],
    ctx: { type: 'hotel' },
  });
}

function landSupermarket(c: Ctx, pid: PlayerId, id: number) {
  const s = c.s;
  const cell = cellOf(s, id);
  const pr = s.props[id];
  const p = P(s, pid);
  if (pr && pr.owner === pid) return;
  if (pr && pr.owner !== 'bank') {
    if (charge(c, pid, pr.owner, cell.fee ?? 15000, 'покупки в супермаркете')) charge(c, pr.owner, 'bank', cell.ownerTax ?? 5000, 'налог владельца супермаркета');
    return;
  }
  charge(c, pid, 'bank', cell.fee ?? 15000, 'покупки в супермаркете');
  if (!pr) ask(c, { to: pid, title: 'Супермаркет', text: `Приобрести супермаркет, оплатив в банк ${fmt(cell.price ?? 60000)}?`, options: [{ id: 'buy', label: `Купить ${fmt(cell.price ?? 60000)}`, tone: 'primary', disabled: p.money < (cell.price ?? 60000) }, { id: 'skip', label: 'Нет' }], ctx: { type: 'buyRu', cell: id, cost: cell.price ?? 60000 } });
}

function landHighway(c: Ctx, pid: PlayerId, n: number) {
  const h = c.s.data.board.highway[n - 1];
  log(c, 'info', `Автострада, клетка ${n}: «${h.name}»`, pid);
  applyHighway(c, pid, h.effect);
}
function applyHighway(c: Ctx, pid: PlayerId, e: HighwayEffect) {
  const p = P(c.s, pid);
  switch (e.kind) {
    case 'money':
      if (e.amount > 0) transfer(c, 'bank', pid, e.amount, 'автострада');
      else charge(c, pid, 'bank', -e.amount, 'автострада');
      return;
    case 'draw': return drawPrompt(c, pid, e.deck);
    case 'stocks': return askStocks(c, pid, e.count, `Автострада: ${e.count} акций`);
    case 'skip': p.skip++; log(c, 'info', `${p.name} пропускает следующий ход (автострада).`, pid); toast(c, `${p.name}: пропуск хода`, 'bad'); return;
    case 'chooseCard': {
      const deck = c.s.data.cards.decks[e.deck];
      ask(c, { to: pid, title: 'Выберите себе подарок', text: 'Карточки открыты — выберите любую.', options: deck.cards.map((cd, i) => ({ id: String(i), label: cd.text })), form: { kind: 'pickCard', deck: e.deck, faceUp: deck.cards.map((x) => x.id), cards: deck.cards.length }, ctx: { type: 'chooseCard', deck: e.deck } });
    }
  }
}

function askStocks(c: Ctx, pid: PlayerId, count: number, title: string) {
  ask(c, { to: pid, title, text: `Выберите цвета ${count} акций (номинал — по вашей котировке).`, options: [{ id: 'ok', label: 'Получить', tone: 'primary' }], form: { kind: 'stockCounts', total: count }, ctx: { type: 'freeStocks', count } });
}

// ====================================================================== аренда
function createClaim(c: Ctx, payer: PlayerId, owner: PlayerId, cell: number, amount: number) {
  const s = c.s;
  const pr = s.props[cell];
  if (pr?.pledged) {
    if (ruling(c, 'pledgedRent') === 'none') return;
  }
  if (amount <= 0) return;
  const cl = { id: uid(s, 'r'), payer, owner, cell, amount, level: pr.level, rollIndex: s.rollIndex, status: 'open' as const };
  const payerP = P(s, payer);
  if (payerP.rentWaivers.includes(owner)) {
    s.claims.push(cl);
    ask(c, { to: payer, title: 'Подарок: освобождение от аренды', text: `У вас есть карточка «${pname(s, owner)} не берёт с Вас плату за аренду». Использовать её для ${cellName(s, cell)} (${fmt(amount)})?`, options: [{ id: 'use', label: 'Использовать', tone: 'primary' }, { id: 'keep', label: 'Сохранить на потом' }], ctx: { type: 'waiver', claim: cl.id } });
    return;
  }
  s.claims.push(cl);
  log(c, 'info', `${pname(s, payer)} на чужой собственности ${cellName(s, cell)} (${LEVEL_RU[pr.level]} игрока ${pname(s, owner)}). Аренда ${fmt(amount)} — владелец должен потребовать до броска следующего игрока.`, payer);
  if (!s.settings.rentNeedsClaim) payClaim(c, cl.id, 'автоматически');
  else toast(c, `${pname(s, owner)}: потребуйте аренду ${fmt(amount)}!`, 'info');
}
function payClaim(c: Ctx, id: string, how: string) {
  const cl = c.s.claims.find((x) => x.id === id);
  if (!cl || cl.status !== 'open') return;
  cl.status = 'paid';
  charge(c, cl.payer, cl.owner, cl.amount, `аренда ${cellName(c.s, cl.cell)} (${how})`);
}
function expireClaims(c: Ctx, roller: PlayerId) {
  for (const cl of c.s.claims) {
    if (cl.status === 'open' && cl.payer !== roller) {
      cl.status = 'expired';
      log(c, 'warn', `${pname(c.s, cl.owner)} не потребовал аренду ${fmt(cl.amount)} за ${cellName(c.s, cl.cell)} до броска следующего игрока — ${pname(c.s, cl.payer)} вправе не платить.`);
    }
  }
}

// ====================================================================== карточки
function drawPrompt(c: Ctx, pid: PlayerId, deck: DeckId) {
  const d = c.s.data.cards.decks[deck];
  ask(c, { to: pid, title: `Карточка «${d.name}»`, text: 'Инспектор предлагает вытянуть одну из пяти карточек.', options: [{ id: 'pick', label: 'Вытянуть' }], form: { kind: 'pickCard', deck, cards: d.cards.length }, ctx: { type: 'draw', deck } });
}
function runCard(c: Ctx, pid: PlayerId, deck: DeckId, card: Card) {
  c.ev.push({ t: 'card', deck, card: card.id, player: pid });
  log(c, 'card', `${pname(c.s, pid)} — «${c.s.data.cards.decks[deck].name}»: ${card.text}`, pid);
  applyCard(c, pid, card.effect, card);
}
function applyCard(c: Ctx, pid: PlayerId, e: CardEffect, card: Card) {
  const s = c.s;
  const p = P(s, pid);
  const others = active(s).filter((x) => x.id !== pid);
  switch (e.kind) {
    case 'none': return;
    case 'manual':
      ask(c, { to: 'host', title: 'Решение ведущего по карточке', text: `«${card.text}»\nЗначение не указано на карточке (требует оцифровки). Укажите сумму для ${p.name} (0 — ничего; минус — платёж в банк).`, options: [{ id: 'ok', label: 'Применить', tone: 'primary' }], form: { kind: 'amount', step: 1000 }, ctx: { type: 'manualCard', player: pid, card: card.id } });
      return;
    case 'choice':
      ask(c, { to: pid, title: 'Выбор по карточке', text: card.text, options: e.options.map((o, i) => ({ id: String(i), label: o.label })), ctx: { type: 'cardChoice', card: card.id, options: e.options } });
      return;
    case 'extraTurn':
      s.turn.extra = true; s.turn.extraOneDie = !!e.oneDie;
      log(c, 'info', `${p.name} получает дополнительный ход${e.oneDie ? ' (одним кубиком)' : ''}.`, pid);
      return;
    case 'oneDieNext': {
      const t = opposite(s, pid);
      if (!t) return void ask(c, { to: pid, title: 'Кто «игрок напротив»?', text: 'При нечётном числе игроков «напротив» неоднозначно — выберите игрока.', options: [{ id: 'ok', label: 'Выбрать', tone: 'primary' }], form: { kind: 'pickPlayer', players: others.map((x) => x.id) }, ctx: { type: 'oneDieTarget' } });
      P(s, t).oneDieNext = true;
      log(c, 'info', `${pname(s, t)} следующий бросок совершает одним кубиком.`, t);
      return;
    }
    case 'distribute':
      if (!others.length) return;
      ask(c, { to: pid, title: `Распределите ${fmt(e.amount)} между игроками`, text: 'Банк выдаёт сумму, вы распределяете её по своему усмотрению (шаг $1 000).', options: [{ id: 'ok', label: 'Раздать', tone: 'primary' }], form: { kind: 'distribute', total: e.amount, step: 1000, players: others.map((x) => x.id) }, ctx: { type: 'distribute', total: e.amount } });
      return;
    case 'collectFromEach':
      for (const o of others) charge(c, o.id, pid, e.amount, 'подарок по карточке «Подарок»');
      return;
    case 'rentWaiver': {
      const t = opposite(s, pid);
      if (!t) return void ask(c, { to: pid, title: 'Кто «игрок напротив»?', text: 'Выберите игрока, который не возьмёт с вас аренду один раз.', options: [{ id: 'ok', label: 'Выбрать', tone: 'primary' }], form: { kind: 'pickPlayer', players: others.map((x) => x.id) }, ctx: { type: 'waiverTarget' } });
      p.rentWaivers.push(t);
      log(c, 'info', `${p.name} получает освобождение от аренды у игрока ${pname(s, t)} (один раз).`, pid);
      return;
    }
    case 'takeStock': {
      const cand = others.filter((x) => x.stocks[e.color] >= e.count);
      if (!cand.length) { log(c, 'info', `Ни у кого нет ${COLOR_RU[e.color]} акции — карточка без последствий.`); return; }
      ask(c, { to: pid, title: 'Выберите игрока', text: `Кто подарит вам ${e.count} ${COLOR_RU[e.color]} акцию?`, options: [{ id: 'ok', label: 'Выбрать', tone: 'primary' }], form: { kind: 'pickPlayer', players: cand.map((x) => x.id) }, ctx: { type: 'takeStock', color: e.color, count: e.count } });
      return;
    }
    case 'money':
      if (e.amount > 0) transfer(c, 'bank', pid, e.amount, `карточка: ${card.text.slice(0, 40)}…`);
      else charge(c, pid, 'bank', -e.amount, 'штраф по карточке');
      return;
    case 'skipTurn': {
      const t = e.target === 'self' ? pid : neighbor(c, pid, 'next');
      if (!t) return;
      P(s, t).skip++;
      log(c, 'info', `${pname(s, t)} пропускает следующий ход.`, t);
      return;
    }
    case 'sellBranchToLady': {
      const ladies = others.filter((x) => x.lady);
      const branches = propsOf(s, pid).filter((x) => x.level === 'branch' && !x.pledged);
      if (!ladies.length) { log(c, 'info', 'Среди игроков нет дам — карточка без последствий.'); return; }
      if (!branches.length) { log(c, 'info', `У ${p.name} нет филиалов — карточка без последствий.`); return; }
      ask(c, { to: pid, title: 'Уступите филиал даме за полцены', text: 'Выберите филиал (цена — половина стоимости филиала).', options: [{ id: 'ok', label: 'Выбрать', tone: 'primary' }], form: { kind: 'pickCell', cells: branches.map((b) => b.cell), players: ladies.map((l) => l.id) }, ctx: { type: 'ladyBranch' } });
      return;
    }
    case 'giveStock': {
      const t = rightNeighbor(c, pid);
      const own = COLORS.filter((col) => p.stocks[col] > 0);
      if (!t || !own.length) { log(c, 'info', 'Нечего дарить — карточка без последствий.'); return; }
      ask(c, { to: pid, title: `Подарите акцию игроку ${pname(s, t)}`, text: 'Выберите цвет акции.', options: own.map((col) => ({ id: col, label: `${COLOR_RU[col]} (у вас ${p.stocks[col]})` })), ctx: { type: 'giveStock', to: t } });
      return;
    }
    case 'swapStock': {
      const own = COLORS.filter((col) => p.stocks[col] > 0);
      if (!own.length) return;
      ask(c, { to: pid, title: 'Обмен акции', text: 'Какую акцию отдать банку?', options: [...own.map((col) => ({ id: col, label: `${COLOR_RU[col]} (у вас ${p.stocks[col]})` })), { id: 'none', label: 'Не менять', tone: 'muted' as const }], ctx: { type: 'swapFrom' } });
      return;
    }
    case 'payTo': {
      const t = rightNeighbor(c, pid);
      if (t) charge(c, pid, t, e.amount, 'карточка «Штраф»: соседу справа');
    }
  }
}

// ====================================================================== биржа
function startExchange(c: Ctx, pid: PlayerId, from66: boolean) {
  const p = P(c.s, pid);
  c.s.exchange = { player: pid, lane: null, n: 0, mode: null, origin: p.pos, from66, done: false, stops: [] };
  p.pos = { z: 'x', lane: null, n: 0 };
  c.ev.push({ t: 'teleport', player: pid, to: p.pos });
  log(c, 'info', `${p.name} выходит на биржу${from66 ? ' (6:6)' : ''}.`, pid);
  ask(c, { to: pid, title: 'Биржа: дорожка', text: 'Выберите цвет дорожки — его номинал будет расти.', options: COLORS.map((col) => ({ id: col, label: `${COLOR_RU_PL[col]} акции (ваша котировка ${fmt(p.quotes[col])})` })), ctx: { type: 'exLane' } });
  ask(c, { to: pid, title: 'Биржа: режим', text: 'Простой — без биржевых карточек. Рискованный — после каждого хода карточка, действующая на акции ВСЕХ игроков.', options: [{ id: 'simple', label: 'Простой вариант' }, { id: 'risk', label: 'Рискованный вариант', tone: 'danger' }], ctx: { type: 'exMode' } });
}

function exchangeRoll(c: Ctx, pid: PlayerId, sum: number) {
  const s = c.s;
  const ex = s.exchange!;
  const p = P(s, pid);
  let target = ex.n + sum;
  const len = s.data.board.exchange.length;
  if (target > len) {
    if (ruling(c, 'exOvershoot') === 'end') {
      log(c, 'market', `${p.name}: бросок ${sum} уводит дальше клетки ${len} — игра на бирже окончена.`, pid);
      ex.done = true;
      return exchangeExit(c, pid);
    }
    target = len;
  }
  const path: Pos[] = [];
  for (let k = ex.n; k <= target; k++) path.push({ z: 'x', lane: ex.lane, n: k });
  ex.n = target;
  ex.stops.push(target);
  p.pos = { z: 'x', lane: ex.lane, n: target };
  c.ev.push({ t: 'move', player: pid, path });
  const lane = ex.lane!;
  const changes: { player: PlayerId; color: Color; from: number; to: number }[] = [];
  setQuote(c, pid, lane, p.quotes[lane] + target * 1000, `биржа: остановка на ${target} (${COLOR_RU[lane]} дорожка)`, changes);
  let msg = `${p.name}: ${COLOR_RU_PL[lane]} акции +${target} п.`;
  if (s.data.board.exchange.specialCells.includes(target)) {
    for (const col of COLORS) if (col !== lane) setQuote(c, pid, col, p.quotes[col] + target * 1000, `биржа: особая клетка ${target}`, changes);
    msg += `, остальные цвета +${target} п. (особая клетка)`;
  }
  c.ev.push({ t: 'quotes', changes });
  log(c, 'market', msg, pid);
  toast(c, msg, 'good');
  if (ex.mode === 'risk') {
    const d = s.data.cards.decks.exchange;
    ask(c, { to: pid, title: 'Биржевая карточка', text: 'Брокер предлагает взять одну из закрытых биржевых карточек. Её действие распространяется на акции ВСЕХ игроков!', options: [{ id: 'pick', label: 'Взять' }], form: { kind: 'pickCard', deck: 'exchange', cards: d.cards.length }, ctx: { type: 'exCard' } });
  }
  if (target >= len) { ex.done = true; if (ex.mode !== 'risk') exchangeExit(c, pid); }
}

function applyExCard(c: Ctx, pid: PlayerId, card: ExCard, payload?: any) {
  const s = c.s;
  const e = card.effect;
  const list = active(s);
  const changes: { player: PlayerId; color: Color; from: number; to: number }[] = [];
  const apply = (col: Color, fn: (v: number) => number, why: string) => { for (const pl of list) setQuote(c, pl.id, col, fn(pl.quotes[col]), why, changes); };
  const halve = (v: number) => { return ruling(c, 'halve') === 'floor' ? Math.floor(v / 2 / 1000) * 1000 : Math.floor(v / 2); };
  const why = `биржевая карточка «${card.text}»`;
  switch (e.op) {
    case 'div': apply((e.color ?? payload?.color) as Color, halve, why); break;
    case 'mul': apply((e.color ?? payload?.color) as Color, (v) => v * e.value, why); break;
    case 'add': apply(e.color, (v) => v + e.value * 1000, why); break;
    case 'addOthers':
      apply(e.color, (v) => v + e.value * 1000, why);
      for (const col of COLORS) if (col !== e.color) apply(col, (v) => v + e.others * 1000, why);
      break;
    case 'assign': {
      const cols: Color[] = payload?.colors ?? [];
      e.values.forEach((val, i) => cols[i] && apply(cols[i], (v) => v + val * 1000, why));
      break;
    }
  }
  c.ev.push({ t: 'quotes', changes });
  log(c, 'market', `Карточка действует на всех: ${summarize(changes, s)}`, pid);
}
function summarize(ch: { player: PlayerId; color: Color; from: number; to: number }[], s: GameState) {
  const by = new Map<Color, string[]>();
  for (const x of ch) { const a = by.get(x.color) ?? []; a.push(`${pname(s, x.player)} ${fmt(x.from)}→${fmt(x.to)}`); by.set(x.color, a); }
  return [...by].map(([col, a]) => `${COLOR_RU_PL[col]}: ${a.join(', ')}`).join('; ') || 'без изменений';
}

function exchangeExit(c: Ctx, pid: PlayerId) {
  const s = c.s;
  const ex = s.exchange!;
  const opts = s.data.board.exchange.exits.map((id) => ({ id: String(id), label: `Выйти на ${cellName(s, id)}` }));
  if (ex.from66) opts.unshift({ id: 'origin', label: `Вернуться на исходную клетку (${posLabel(s, ex.origin)})` });
  ask(c, { to: pid, title: 'Выход с биржи', text: `Остановки: ${ex.stops.join(', ') || '—'}. Выберите клетку выхода.`, options: opts, ctx: { type: 'exExit' } });
}

// ====================================================================== рулетка
function startRoulette(c: Ctx, pid: PlayerId, maxRolls: number | null, returnTo: number | null) {
  const s = c.s;
  const rl = s.data.board.roulette;
  s.roulette = { player: pid, slot: rl.startSlot, traveled: 0, rolls: 0, maxRolls, returnTo };
  const p = P(s, pid);
  p.pos = { z: 'r', slot: rl.startSlot };
  c.ev.push({ t: 'teleport', player: pid, to: p.pos });
  log(c, 'info', `${p.name} садится за рулетку${maxRolls ? ` (${maxRolls} броска, затем возврат в отель)` : ''}. Старт — сектор «−25 000», обход против часовой стрелки.`, pid);
}
function rouletteRoll(c: Ctx, pid: PlayerId, sum: number) {
  const s = c.s;
  const r = s.roulette!;
  const rl = s.data.board.roulette;
  const order = rl.order;
  let idx = order.indexOf(r.slot);
  const path: Pos[] = [{ z: 'r', slot: r.slot }];
  for (let k = 0; k < sum; k++) { idx = (idx + 1) % order.length; path.push({ z: 'r', slot: order[idx] }); }
  r.slot = order[idx];
  r.traveled += sum;
  r.rolls++;
  const p = P(s, pid);
  p.pos = { z: 'r', slot: r.slot };
  c.ev.push({ t: 'move', player: pid, path });
  const sec = rl.sectors.find((x) => x.slot === r.slot)!;
  const laps = Math.floor(r.traveled / order.length);
  log(c, 'info', `Рулетка: ${p.name} — сектор «${sec.label}» (пройдено кругов: ${laps}).`, pid);
  if (sec.type === 'to_bank') {
    if (ruling(c, 'rouletteBank') === 'exit') return rouletteLeave(c, pid, 52, 'сектор «В БАНК»');
    ask(c, { to: 'host', title: 'Рулетка: сектор «В БАНК»', text: `${p.name} остановился на секторе «В БАНК». Укажите сумму (минус — платёж в банк). Затем игрок выйдет в Банк (52).`, options: [{ id: 'ok', label: 'Применить', tone: 'primary' }], form: { kind: 'amount', step: 1000 }, ctx: { type: 'rlBankHost', player: pid } });
    return;
  }
  if (sec.value) {
    if (sec.value > 0) transfer(c, 'bank', pid, sec.value, 'выигрыш на рулетке');
    else charge(c, pid, 'bank', -sec.value, 'проигрыш на рулетке');
    toast(c, `Рулетка: ${sec.label}`, sec.value > 0 ? 'good' : 'bad');
  }
  if (r.maxRolls && r.rolls >= r.maxRolls) {
    const back = r.returnTo!;
    s.roulette = null;
    p.pos = C(back);
    c.ev.push({ t: 'teleport', player: pid, to: p.pos });
    log(c, 'info', `${p.name} возвращается в ${cellName(s, back)}.`, pid);
    return;
  }
  const canLeave = !!sec.exit || laps >= rl.lapsToLeave;
  if (canLeave) {
    ask(c, { to: pid, title: 'Рулетка', text: sec.exit ? 'Зелёный сектор «ВЫХОД» — можно покинуть рулетку.' : `Пройдено ${laps} полных круга — можно покинуть рулетку.`, options: [{ id: 'more', label: 'Крутить ещё' }, ...rl.exitTo.map((id) => ({ id: String(id), label: `Выйти → ${cellName(s, id)}`, tone: 'primary' as const }))], ctx: { type: 'rlLeave' } });
  }
}
function rouletteLeave(c: Ctx, pid: PlayerId, to: number, why: string) {
  const s = c.s;
  s.roulette = null;
  const p = P(s, pid);
  p.pos = C(to);
  c.ev.push({ t: 'teleport', player: pid, to: p.pos });
  log(c, 'info', `${p.name} покидает рулетку (${why}) → ${cellName(s, to)}.`, pid);
  if (ruling(c, 'rouletteExitBonus') === 'yes') land(c, pid, p.pos);
}

// ====================================================================== кредиты
function perimeterOf(s: GameState, pid: PlayerId): 'outer' | 'inner' {
  const pos = P(s, pid).pos;
  return pos.z === 'c' && pos.id >= 40 ? 'inner' : 'outer';
}
function checkLoans(c: Ctx, pid: PlayerId) {
  for (const l of c.s.loans) {
    if (l.player !== pid || l.status !== 'active' || l.remaining > 0) continue;
    if (c.s.prompts.some((q) => q.ctx.type === 'loanDue' && q.ctx.loan === l.id)) continue;
    const owe = loanOwed(c.s, l);
    ask(c, { to: pid, title: 'Срок кредита истёк', text: `Кредит под залог ${cellName(c.s, l.cell)}: ${owe.text}. При невозврате имущество переходит банку.`, options: [{ id: 'repay', label: `Вернуть (${owe.text})`, tone: 'primary', disabled: !owe.can(P(c.s, pid)) }, { id: 'default', label: 'Не возвращать', tone: 'danger' }], ctx: { type: 'loanDue', loan: l.id } });
  }
}
function loanOwed(s: GameState, l: Loan) {
  if (l.kind === 'stocks' && RULES.stockLoanRepay === ('stocks' as string) && l.stocks) {
    const st = l.stocks;
    return { text: `${st.count} ${COLOR_RU[st.color]} акц.`, can: (p: { stocks: Record<Color, number> }) => p.stocks[st.color] >= st.count };
  }
  return { text: fmt(l.amount), can: (p: { money: number }) => p.money >= l.amount };
}
function repay(c: Ctx, l: Loan) {
  const s = c.s;
  const p = P(s, l.player);
  if (l.kind === 'stocks' && RULES.stockLoanRepay === ('stocks' as string) && l.stocks) {
    p.stocks[l.stocks.color] -= l.stocks.count;
    log(c, 'money', `${p.name} возвращает банку ${l.stocks.count} ${COLOR_RU[l.stocks.color]} акц. по кредиту.`, p.id);
  } else transfer(c, l.player, 'bank', l.amount, `возврат кредита под залог ${cellName(s, l.cell)}`);
  l.status = 'repaid';
  const pr = s.props[l.cell];
  if (pr) pr.pledged = null;
  toast(c, `${p.name}: кредит погашен`, 'good');
}
function defaultLoan(c: Ctx, l: Loan) {
  const s = c.s;
  l.status = 'defaulted';
  const pr = s.props[l.cell];
  if (pr && pr.owner === l.player) { pr.owner = 'bank'; pr.pledged = null; c.ev.push({ t: 'prop', cell: l.cell, owner: null, level: null }); }
  log(c, 'warn', `Кредит не возвращён: карточка ${cellName(s, l.cell)} остаётся в банке, метка возвращается председателю. Имущество можно выкупить с открытых торгов.`, l.player);
  toast(c, `${pname(s, l.player)}: залог ${cellOf(s, l.cell).name} изъят банком`, 'bad');
}

// ====================================================================== банкротство
function bankrupt(c: Ctx, pid: PlayerId, why: string) {
  const s = c.s;
  const p = P(s, pid);
  log(c, 'warn', `Председатель комитета по имуществу объявляет ${p.name} банкротом (${why}). Всё имущество переходит банку.`, pid);
  if (p.money > 0) transfer(c, pid, 'bank', p.money, 'имущество банкрота');
  for (const col of COLORS) p.stocks[col] = 0;
  for (const pr of propsOf(s, pid)) { pr.owner = 'bank'; pr.pledged = null; c.ev.push({ t: 'prop', cell: pr.cell, owner: null, level: null }); }
  for (const l of s.loans) if (l.player === pid && l.status === 'active') l.status = 'defaulted';
  for (const d of s.debts.filter((x) => x.debtor === pid)) {
    if (d.creditor !== 'bank') transfer(c, 'bank', d.creditor, d.amount, `банк гасит долг банкрота ${p.name}: ${d.reason}`);
  }
  s.debts = s.debts.filter((x) => x.debtor !== pid);
  for (const cl of s.claims) if (cl.status === 'open' && (cl.payer === pid || cl.owner === pid)) cl.status = 'expired';
  s.prompts = s.prompts.filter((q) => resolveTarget(s, q.to) !== pid);
  if (s.exchange?.player === pid) s.exchange = null;
  if (s.roulette?.player === pid) s.roulette = null;
  p.bankrupt = true;
  p.money = 0;
  c.ev.push({ t: 'bankrupt', player: pid });
  toast(c, `${p.name} — банкрот и выбывает из игры`, 'bad');
  const left = active(s);
  if (left.length === 1) { s.winner = left[0].id; s.turn.stage = 'over'; log(c, 'turn', `Игра окончена. Победитель — ${left[0].name}.`); return; }
  if (s.turn.player === pid) advanceTurn(c);
}

// ====================================================================== очередь хода
function advanceTurn(c: Ctx) {
  const s = c.s;
  const cur = s.turn.player;
  if (s.turn.extra && !P(s, cur).bankrupt) {
    const oneDie = s.turn.extraOneDie;
    s.turn = { n: s.turn.n + 1, player: cur, stage: 'pre', dice: null, extra: false, extraOneDie: false, oneDie, rolled: false };
    log(c, 'turn', `Ход ${s.turn.n} — ${pname(s, cur)} (дополнительный${oneDie ? ', одним кубиком' : ''})`);
    return;
  }
  let i = s.order.indexOf(cur);
  for (let guard = 0; guard < s.order.length * 4; guard++) {
    i = (i + 1) % s.order.length;
    const p = P(s, s.order[i]);
    if (p.bankrupt) continue;
    if (p.skip > 0) { p.skip--; log(c, 'turn', `${p.name} пропускает ход.`, p.id); continue; }
    s.turn = { n: s.turn.n + 1, player: p.id, stage: 'pre', dice: null, extra: false, extraOneDie: false, oneDie: false, rolled: false };
    log(c, 'turn', `Ход ${s.turn.n} — ${p.name}`);
    return;
  }
}

/** Ход завершён, если не осталось вопросов и активных подсценариев. */
function settle(c: Ctx) {
  const s = c.s;
  if (s.turn.stage === 'over') return;
  if (s.prompts.length) return;
  if (s.exchange || s.roulette) return;
  if (s.turn.rolled) s.turn.stage = 'post';
}

export function awaitingRoll(s: GameState): 'main' | 'exchange' | 'roulette' | null {
  if (s.turn.stage === 'over' || s.prompts.length) return null;
  if (s.debts.some((d) => d.debtor === s.turn.player)) return null;
  if (s.exchange && s.exchange.lane && s.exchange.mode && !s.exchange.done) return 'exchange';
  if (s.roulette) return 'roulette';
  if (!s.exchange && s.turn.stage === 'pre' && !s.turn.rolled) return 'main';
  return null;
}

// ====================================================================== разрешение подсказок
function onAnswer(c: Ctx, q: Prompt, option: string, payload: any): string | void {
  const s = c.s;
  const pid = s.turn.player;
  const x = q.ctx;
  switch (x.type) {
    case 'route': return executePath(c, pid, x.paths[Number(option)]);
    case 'six':
      if (option === 'exchange') return startExchange(c, pid, true);
      return moveBy(c, pid, x.steps);
    case 'buyPlot':
      if (option !== 'buy') return void log(c, 'info', `${pname(s, pid)} отказывается от покупки ${cellName(s, x.cell)}.`, pid);
      transfer(c, pid, 'bank', x.cost, `участок ${cellName(s, x.cell)}`);
      setProp(c, x.cell, pid, 'plot', x.cost);
      log(c, 'prop', `Реестр: ${pname(s, pid)} — ${cellName(s, x.cell)} (участок, карточка с логотипом).`, pid);
      return;
    case 'buyBranch':
      if (option !== 'buy') return;
      transfer(c, pid, 'bank', x.cost, `филиал ${cellName(s, x.cell)}`);
      setProp(c, x.cell, pid, 'branch', x.cost);
      log(c, 'prop', `Реестр: ${pname(s, pid)} — ${cellName(s, x.cell)} (филиал, метка на клетке).`, pid);
      return;
    case 'buyEnterprise': {
      if (option !== 'buy') return;
      if (ruling(c, 'enterpriseCost') === 'receive') { transfer(c, 'bank', pid, x.cost, `предприятие ${cellName(s, x.cell)}`); setProp(c, x.cell, pid, 'enterprise', 0); }
      else { transfer(c, pid, 'bank', x.cost, `предприятие ${cellName(s, x.cell)}`); setProp(c, x.cell, pid, 'enterprise', x.cost); }
      log(c, 'prop', `Реестр: ${pname(s, pid)} — ${cellName(s, x.cell)} (предприятие, карточка предприятия).`, pid);
      toast(c, `${pname(s, pid)} открывает предприятие ${cellOf(s, x.cell).name}!`, 'good');
      return;
    }
    case 'buyRu':
      if (option !== 'buy') return;
      if (cellOf(s, x.cell).type === 'ru_company')      transfer(c, pid, 'bank', x.cost, `покупка ${cellName(s, x.cell)}`);
      setProp(c, x.cell, pid, 'firm', x.cost);
      log(c, 'prop', `Реестр: ${pname(s, pid)} — ${cellName(s, x.cell)} (фирма).`, pid);
      return;
    case 'exGate': if (option === 'play') startExchange(c, pid, false); return;
    case 'brokerGate':
      if (option !== 'play') return;
      transfer(c, pid, 'bank', cellOf(s, 20).exchangeFee ?? 5000, 'взнос за выход на биржу с клетки 20');
      return startExchange(c, pid, false);
    case 'rlGate': if (option === 'play') startRoulette(c, pid, null, x.returnTo); return;
    case 'bankSwitch':
      if (option !== 'switch') return;
      transfer(c, pid, 'bank', x.fee, `пошлина за переход ${x.from}→${x.to}`);
      P(s, pid).pos = C(x.to);
      c.ev.push({ t: 'teleport', player: pid, to: C(x.to) });
      log(c, 'info', `${pname(s, pid)} переходит ${x.from}→${x.to}.`, pid);
      return;
    case 'hotel':
      if (option === 'highway') { P(s, pid).pos = { z: 'h', n: 1 }; c.ev.push({ t: 'teleport', player: pid, to: { z: 'h', n: 1 } }); return landHighway(c, pid, 1); }
      if (option === 'roulette') return startRoulette(c, pid, 2, 30);
      if (option === 'buyRu') {
        const free = s.data.board.cells.filter((cl) => cl.type === 'ru_company' && !s.props[cl.id]);
        ask(c, { to: pid, title: 'Фирма в России за ½ цены', text: 'Выберите свободную клетку внутреннего периметра. Дальше движение по внутреннему периметру.', options: [...free.map((cl) => ({ id: String(cl.id), label: `${cellName(s, cl.id)} — ${fmt(Math.round((cl.price ?? 0) / 2))}`, disabled: P(s, pid).money < Math.round((cl.price ?? 0) / 2) })), { id: 'none', label: 'Передумал', tone: 'muted' as const }], ctx: { type: 'hotelBuy' } });
      }
      return;
    case 'hotelBuy': {
      if (option === 'none') return;
      const id = Number(option);
      const cost = Math.round((cellOf(s, id).price ?? 0) / 2);
      transfer(c, pid, 'bank', cost, `фирма в России из отеля: ${cellName(s, id)}`);
      setProp(c, id, pid, 'firm', cost);
      P(s, pid).pos = C(id);
      c.ev.push({ t: 'teleport', player: pid, to: C(id) });
      log(c, 'prop', `Реестр: ${pname(s, pid)} — ${cellName(s, id)} (фирма). Фишка переходит на внутренний периметр.`, pid);
      return;
    }
    case 'freeStocks': {
      const counts = payload?.counts as Record<Color, number>;
      const total = COLORS.reduce((a, col) => a + (counts?.[col] ?? 0), 0);
      if (total !== x.count) return `Нужно выбрать ровно ${x.count} акций`;
      const p = P(s, q.to as PlayerId);
      for (const col of COLORS) p.stocks[col] += counts[col] ?? 0;
      log(c, 'money', `${p.name} получает акции: ${COLORS.filter((col) => counts[col]).map((col) => `${COLOR_RU_PL[col]} ×${counts[col]}`).join(', ')}.`, p.id);
      toast(c, `${p.name}: +${x.count} акций`, 'good');
      return;
    }
    case 'chooseCard': {
      const card = s.data.cards.decks[x.deck as DeckId].cards[Number(option)];
      return runCard(c, q.to as PlayerId, x.deck, card);
    }
    case 'draw': {
      const deck = s.data.cards.decks[x.deck as DeckId];
      const order = shuffle(s, deck.cards);
      const idx = Math.max(0, Math.min(order.length - 1, Number(payload?.index ?? 0)));
      return runCard(c, q.to as PlayerId, x.deck, order[idx]);
    }
    case 'cardChoice': {
      const opt = x.options[Number(option)];
      log(c, 'card', `${pname(s, q.to as PlayerId)} выбирает: ${opt.label}`, q.to as PlayerId);
      const card = Object.values(s.data.cards.decks).flatMap((d: any) => d.cards).find((cd: any) => cd.id === x.card) as Card;
      return applyCard(c, q.to as PlayerId, opt.effect, card);
    }
    case 'manualCard': {
      const amt = Math.round(Number(payload?.amount ?? 0));
      log(c, 'ruling', `Ведущий: по карточке ${amt ? fmtSigned(amt) : 'без последствий'} для ${pname(s, x.player)}.`);
      if (amt > 0) transfer(c, 'bank', x.player, amt, 'карточка (решение ведущего)');
      if (amt < 0) charge(c, x.player, 'bank', -amt, 'карточка (решение ведущего)');
      return;
    }
    case 'oneDieTarget': { const t = payload?.player; if (!t) return 'Выберите игрока'; P(s, t).oneDieNext = true; log(c, 'info', `${pname(s, t)} следующий бросок совершает одним кубиком.`, t); return; }
    case 'waiverTarget': { const t = payload?.player; if (!t) return 'Выберите игрока'; P(s, q.to as PlayerId).rentWaivers.push(t); log(c, 'info', `${pname(s, q.to as PlayerId)} получает освобождение от аренды у ${pname(s, t)}.`); return; }
    case 'distribute': {
      const amounts = (payload?.amounts ?? {}) as Record<PlayerId, number>;
      const sum = Object.values(amounts).reduce((a, b) => a + (Number(b) || 0), 0);
      if (sum !== x.total) return `Распределите ровно ${fmt(x.total)} (сейчас ${fmt(sum)})`;
      for (const [id, v] of Object.entries(amounts)) if (v > 0) transfer(c, 'bank', id, v, `распределение по карточке «Извещение» от ${pname(s, q.to as PlayerId)}`);
      return;
    }
    case 'takeStock': {
      const from = payload?.player as PlayerId;
      if (!from) return 'Выберите игрока';
      const fp = P(s, from), tp = P(s, q.to as PlayerId);
      fp.stocks[x.color as Color] -= x.count; tp.stocks[x.color as Color] += x.count;
      log(c, 'money', `${fp.name} дарит ${tp.name} ${x.count} ${COLOR_RU[x.color as Color]} акцию.`, tp.id);
      return;
    }
    case 'waiver': {
      const cl = s.claims.find((k) => k.id === x.claim)!;
      if (option === 'use') {
        cl.status = 'waived';
        const p = P(s, cl.payer);
        p.rentWaivers.splice(p.rentWaivers.indexOf(cl.owner), 1);
        log(c, 'info', `${p.name} использует подарок: ${pname(s, cl.owner)} не берёт аренду за ${cellName(s, cl.cell)}.`, p.id);
      } else if (!s.settings.rentNeedsClaim) payClaim(c, cl.id, 'автоматически');
      return;
    }
    case 'ladyBranch': {
      const cell = Number(payload?.cell), lady = payload?.player as PlayerId;
      if (!cell || !lady) return 'Выберите филиал и даму';
      const pr = s.props[cell];
      const price = Math.round(propValue(s, pr) / 2);
      const seller = q.to as PlayerId;
      if (P(s, lady).money < price) return `У ${pname(s, lady)} нет ${fmt(price)}`;
      transfer(c, lady, seller, price, `филиал ${cellName(s, cell)} за полцены (карточка «Сюрприз»)`);
      pr.owner = lady;
      c.ev.push({ t: 'prop', cell, owner: lady, level: pr.level });
      log(c, 'prop', `Реестр: ${cellName(s, cell)} переходит к ${pname(s, lady)}.`);
      return;
    }
    case 'giveStock': {
      const col = option as Color;
      const fp = P(s, q.to as PlayerId), tp = P(s, x.to);
      fp.stocks[col]--; tp.stocks[col]++;
      log(c, 'money', `${fp.name} дарит ${tp.name} ${COLOR_RU[col]} акцию.`, fp.id);
      return;
    }
    case 'swapFrom':
      if (option === 'none') return;
      ask(c, { to: q.to, title: 'Обмен акции', text: `Отдаёте ${COLOR_RU[option as Color]} акцию. Какую получить?`, options: COLORS.filter((col) => col !== option).map((col) => ({ id: col, label: COLOR_RU[col] })), ctx: { type: 'swapTo', from: option } });
      return;
    case 'swapTo': {
      const p = P(s, q.to as PlayerId);
      p.stocks[x.from as Color]--; p.stocks[option as Color]++;
      log(c, 'money', `${p.name} меняет ${COLOR_RU[x.from as Color]} акцию на ${COLOR_RU[option as Color]} (сюрприз от банка).`, p.id);
      return;
    }
    case 'exLane':
      s.exchange!.lane = option as Color;
      P(s, pid).pos = { z: 'x', lane: option as Color, n: 0 };
      c.ev.push({ t: 'teleport', player: pid, to: P(s, pid).pos });
      log(c, 'market', `${pname(s, pid)} выбирает ${COLOR_RU[option as Color]} дорожку биржи.`, pid);
      return;
    case 'exMode':
      s.exchange!.mode = option as 'simple' | 'risk';
      log(c, 'market', `Режим биржи: ${option === 'risk' ? 'рискованный (с биржевыми карточками)' : 'простой'}.`, pid);
      return;
    case 'exCard': {
      const d = s.data.cards.decks.exchange;
      const order = shuffle(s, d.cards);
      const card = order[Math.max(0, Math.min(order.length - 1, Number(payload?.index ?? 0)))];
      c.ev.push({ t: 'card', deck: 'exchange', card: card.id, player: pid });
      log(c, 'card', `${pname(s, pid)} берёт биржевую карточку: ${card.text}`, pid);
      const e = card.effect;
      if ((e.op === 'div' || e.op === 'mul') && e.choose) {
        ask(c, { to: pid, title: `Карточка «${card.text}»`, text: 'Выберите цвет — изменение коснётся всех игроков.', options: COLORS.map((col) => ({ id: col, label: COLOR_RU_PL[col] })), ctx: { type: 'exCardColor', card: card.id } });
      } else if (e.op === 'assign') {
        ask(c, { to: pid, title: `Карточка «${card.text}»`, text: 'Распределите изменения по разным цветам (действует на всех игроков).', options: [{ id: 'ok', label: 'Применить', tone: 'primary' }], form: { kind: 'assignColors', values: e.values }, ctx: { type: 'exCardAssign', card: card.id } });
      } else applyExCard(c, pid, card);
      if (s.exchange?.done) exchangeExit(c, pid);
      return;
    }
    case 'exCardColor': {
      const card = s.data.cards.decks.exchange.cards.find((k) => k.id === x.card)!;
      return applyExCard(c, pid, card, { color: option });
    }
    case 'exCardAssign': {
      const card = s.data.cards.decks.exchange.cards.find((k) => k.id === x.card)!;
      const cols = payload?.colors as Color[];
      if (!cols || cols.length !== (card.effect as any).values.length || new Set(cols).size !== cols.length) return 'Каждое изменение — на свой цвет';
      return applyExCard(c, pid, card, { colors: cols });
    }
    case 'exExit': {
      const ex = s.exchange!;
      s.exchange = null;
      const to = option === 'origin' ? ex.origin : C(Number(option));
      P(s, pid).pos = to;
      c.ev.push({ t: 'teleport', player: pid, to });
      log(c, 'info', `${pname(s, pid)} покидает биржу → ${posLabel(s, to)}.`, pid);
      if (option !== 'origin') { if (ruling(c, 'exitEffect') === 'yes') land(c, pid, to); }
      return;
    }
    case 'rlLeave':
      if (option === 'more') return;
      return rouletteLeave(c, pid, Number(option), 'выход');
    case 'rlBankHost': {
      const amt = Math.round(Number(payload?.amount ?? 0));
      log(c, 'ruling', `Ведущий: сектор «В БАНК» — ${amt ? fmtSigned(amt) : 'без суммы'}.`);
      if (amt > 0) transfer(c, 'bank', x.player, amt, 'рулетка, сектор «В БАНК»');
      if (amt < 0) charge(c, x.player, 'bank', -amt, 'рулетка, сектор «В БАНК»');
      return rouletteLeave(c, x.player, 52, 'сектор «В БАНК»');
    }
    case 'loanDue': {
      const l = s.loans.find((k) => k.id === x.loan)!;
      if (option === 'repay') return repay(c, l);
      return defaultLoan(c, l);
    }
    case 'loanApprove': {
      if (option !== 'ok') { log(c, 'info', `Банкир отказал в кредите ${pname(s, x.player)}.`); toast(c, 'Кредит отклонён', 'bad'); return; }
      return issueLoan(c, x.req);
    }
    case 'bankruptConfirm': {
      if (option !== 'ok') { log(c, 'info', `Председатель не подтвердил банкротство ${pname(s, x.player)}.`); return; }
      return bankrupt(c, x.player, x.why);
    }
  }
}

// ====================================================================== операции до броска
function canOperate(s: GameState, pid: PlayerId) {
  const own = s.turn.player === pid && s.turn.stage === 'pre' && !s.turn.rolled && !s.exchange && !s.roulette;
  return own || s.debts.some((d) => d.debtor === pid);
}

function issueLoan(c: Ctx, req: Extract<Action, { type: 'requestLoan' }>) {
  const s = c.s;
  const pr = s.props[req.cell];
  if (!pr || pr.owner !== req.by || pr.pledged) return void log(c, 'warn', 'Кредит не выдан: залог недоступен.');
  const value = propValue(s, pr);
  const per = perimeterOf(s, req.by);
  const len = per === 'inner' ? s.data.board.edges.innerLoop.length : 40;
  const l: Loan = { id: uid(s, 'l'), player: req.by, cell: req.cell, kind: req.kind, amount: 0, remaining: len, perimeter: per, status: 'active', issuedTurn: s.turn.n };
  if (req.kind === 'money') {
    l.amount = Math.min(req.amount ?? 0, value);
    transfer(c, 'bank', req.by, l.amount, `кредит под залог ${cellName(s, req.cell)}`);
  } else {
    const q = maxQuote(s, req.color!);
    l.stocks = { color: req.color!, count: req.count!, quote: q };
    l.amount = q * req.count!;
    if (l.amount > value) return void log(c, 'warn', 'Кредит не выдан: сумма превышает стоимость залога.');
    P(s, req.by).stocks[req.color!] += req.count!;
    log(c, 'money', `Банк выдаёт ${pname(s, req.by)} в кредит ${req.count} ${COLOR_RU[req.color!]} акц. по наибольшей котировке ${fmt(q)} (=${fmt(l.amount)}).`, req.by);
  }
  pr.pledged = l.id;
  s.loans.push(l);
  log(c, 'money', `Кредит ${fmt(l.amount)} под залог ${cellName(s, req.cell)} (оценка ${fmt(value)}); срок — полный проход ${per === 'inner' ? 'малого' : 'большого'} периметра (${len} клеток). Карточка в банке, метка на поле.`, req.by);
  toast(c, `${pname(s, req.by)}: кредит ${fmt(l.amount)}`, 'info');
}

function bundleOk(s: GameState, pid: PlayerId, b: Bundle) {
  const p = P(s, pid);
  if (b.money < 0 || p.money < b.money) return false;
  for (const [col, n] of Object.entries(b.stocks)) if ((n ?? 0) < 0 || p.stocks[col as Color] < (n ?? 0)) return false;
  return b.cells.every((id) => s.props[id]?.owner === pid && !s.props[id].pledged);
}
function moveBundle(c: Ctx, from: PlayerId, to: PlayerId, b: Bundle, why: string) {
  const s = c.s;
  if (b.money) transfer(c, from, to, b.money, why);
  for (const [col, n] of Object.entries(b.stocks)) if (n) { P(s, from).stocks[col as Color] -= n; P(s, to).stocks[col as Color] += n; log(c, 'money', `${pname(s, from)} → ${pname(s, to)}: ${COLOR_RU_PL[col as Color]} акции ×${n} (${why})`); }
  for (const id of b.cells) { s.props[id].owner = to; c.ev.push({ t: 'prop', cell: id, owner: to, level: s.props[id].level }); log(c, 'prop', `Реестр: ${cellName(s, id)} → ${pname(s, to)} (${why})`); }
}
const bundleText = (s: GameState, b: Bundle) => [b.money ? fmt(b.money) : '', ...Object.entries(b.stocks).filter(([, n]) => n).map(([col, n]) => `${COLOR_RU_PL[col as Color]} акции ×${n}`), ...b.cells.map((id) => cellName(s, id))].filter(Boolean).join(', ') || 'ничего';

// ====================================================================== точка входа
export function applyAction(state: GameState, a: Action): ApplyResult {
  const s = structuredClone(state);
  const c: Ctx = { s, ev: [] };
  const err = (e: string): ApplyResult => ({ state, events: [], error: e });
  try {
    const r = dispatch(c, a);
    if (typeof r === 'string') return err(r);
  } catch (e: any) {
    return err(e?.message ?? String(e));
  }
  settle(c);
  s.updatedAt = Date.now();
  return { state: s, events: c.ev };
}

function canAnswer(s: GameState, q: Prompt, by: PlayerId | 'host') {
  const t = resolveTarget(s, q.to);
  if (t === by) return true;
  const isRole = q.to === 'banker' || q.to === 'broker' || q.to === 'chairman' || q.to === 'inspector';
  return by === 'host' && (t === 'host' || isRole);
}

function dispatch(c: Ctx, a: Action): string | void {
  const s = c.s;
  if (s.turn.stage === 'over' && !['editData', 'hostNote', 'setRuling'].includes(a.type)) return 'Партия окончена';
  switch (a.type) {
    case 'roll': {
      const mode = awaitingRoll(s);
      if (a.by !== s.turn.player) return 'Сейчас ходит другой игрок';
      if (!mode) return s.prompts.length ? 'Сначала ответьте на вопрос' : s.debts.some((d) => d.debtor === a.by) ? 'Сначала погасите долг' : 'Бросок сейчас недоступен';
      const p = P(s, a.by);
      const one = mode === 'main' && (s.turn.oneDie || p.oneDieNext);
      const forced = s.settings.allowForcedDice && a.force?.length ? a.force : null;
      const values = forced ? forced.slice(0, one ? 1 : 2) : one ? [die(s)] : [die(s), die(s)];
      const sum = values.reduce((x, y) => x + y, 0);
      if (mode === 'main') { expireClaims(c, a.by); s.rollIndex++; s.turn.rolled = true; s.turn.dice = values; if (p.oneDieNext) p.oneDieNext = false; }
      c.ev.push({ t: 'dice', player: a.by, values });
      log(c, 'info', `${p.name} бросает ${one ? 'один кубик' : 'кубики'}: ${values.join(' + ')}${values.length > 1 ? ` = ${sum}` : ''}`, a.by);
      if (mode === 'exchange') return exchangeRoll(c, a.by, sum);
      if (mode === 'roulette') return rouletteRoll(c, a.by, sum);
      if (values.length === 2 && values[0] === 6 && values[1] === 6) {
        ask(c, { to: a.by, title: '6 : 6!', text: 'Можно сыграть на бирже (после игры — вернуться на исходную клетку или выйти по правилам биржи) либо сходить на 12.', options: [{ id: 'exchange', label: 'Сыграть на бирже', tone: 'primary' }, { id: 'move', label: 'Ходить на 12' }], ctx: { type: 'six', steps: 12 } });
        return;
      }
      return moveBy(c, a.by, sum);
    }
    case 'answer': {
      const q = s.prompts.find((x) => x.id === a.prompt);
      if (!q) return 'Вопрос уже закрыт';
      if (!canAnswer(s, q, a.by)) return 'Этот выбор делает другой участник';
      if (q.form?.kind !== 'pickCard' && !q.form && !q.options.some((o) => o.id === a.option && !o.disabled)) return 'Недопустимый вариант';
      if (q.options.find((o) => o.id === a.option)?.disabled) return 'Вариант недоступен';
      s.prompts = s.prompts.filter((x) => x.id !== q.id);
      const r = onAnswer(c, q, a.option, a.payload);
      if (typeof r === 'string') return r;
      return;
    }
    case 'endTurn': {
      if (a.by !== s.turn.player) return 'Сейчас ходит другой игрок';
      if (s.prompts.length) return 'Есть незакрытые вопросы';
      if (s.debts.some((d) => d.debtor === a.by)) return 'Сначала погасите долг';
      if (s.exchange || s.roulette) return 'Сначала закончите игру на бирже/рулетке';
      if (s.turn.stage !== 'post' && !(P(s, a.by).skip)) return 'Сначала бросьте кубики';
      log(c, 'turn', `${pname(s, a.by)} завершает ход.`, a.by);
      advanceTurn(c);
      return;
    }
    case 'claimRent': {
      const cl = s.claims.find((x) => x.id === a.claim);
      if (!cl || cl.status !== 'open') return 'Требование уже неактуально';
      if (a.by !== cl.owner && a.by !== 'host') return 'Потребовать может только владелец';
      log(c, 'info', `${pname(s, cl.owner)} требует аренду с ${pname(s, cl.payer)}.`, cl.owner);
      payClaim(c, cl.id, 'по требованию владельца');
      return;
    }
    case 'buyStock': {
      if (!canOperate(s, a.by)) return 'Покупка акций — до броска в свой ход';
      if (a.count < 1) return 'Неверное количество';
      const price = maxQuote(s, a.color) * a.count;
      if (P(s, a.by).money < price) return 'Недостаточно денег';
      transfer(c, a.by, 'bank', price, `покупка ${a.count} ${COLOR_RU[a.color]} акц. у банка по максимальной котировке ${fmt(maxQuote(s, a.color))}`);
      P(s, a.by).stocks[a.color] += a.count;
      return;
    }
    case 'sellStock': {
      if (!canOperate(s, a.by)) return 'Продажа акций — до броска в свой ход';
      const p = P(s, a.by);
      if (a.count < 1 || p.stocks[a.color] < a.count) return 'Нет столько акций';
      p.stocks[a.color] -= a.count;
      transfer(c, 'bank', a.by, Math.max(0, p.quotes[a.color]) * a.count, `продажа ${a.count} ${COLOR_RU[a.color]} акц. банку по своей котировке ${fmt(p.quotes[a.color])}`);
      return;
    }
    case 'payDebt': {
      const d = s.debts.find((x) => x.id === a.debt);
      if (!d || d.debtor !== a.by) return 'Долг не найден';
      if (P(s, a.by).money < d.amount) return 'Недостаточно денег';
      s.debts = s.debts.filter((x) => x.id !== d.id);
      transfer(c, a.by, d.creditor, d.amount, d.reason + ' (погашение долга)');
      return;
    }
    case 'requestLoan': {
      if (!canOperate(s, a.by)) return 'Кредит оформляется до броска в свой ход';
      const pr = s.props[a.cell];
      if (!pr || pr.owner !== a.by) return 'Залогом может быть только ваша собственность';
      if (pr.pledged) return 'Имущество уже в залоге';
      const value = propValue(s, pr);
      const amt = a.kind === 'money' ? a.amount ?? 0 : maxQuote(s, a.color!) * (a.count ?? 0);
      if (amt <= 0) return 'Укажите сумму';
      if (amt > value) return `Кредит не может превышать стоимость залога (${fmt(value)})`;
      ask(c, { to: 'banker', title: 'Заявка на кредит', text: `${pname(s, a.by)} просит ${a.kind === 'money' ? fmt(amt) : `${a.count} ${COLOR_RU[a.color!]} акц. (по ${fmt(maxQuote(s, a.color!))} = ${fmt(amt)})`} под залог ${cellName(s, a.cell)} (оценка ${fmt(value)}).`, options: [{ id: 'ok', label: 'Выдать кредит', tone: 'primary' }, { id: 'no', label: 'Отказать', tone: 'danger' }], ctx: { type: 'loanApprove', player: a.by, req: a } });
      log(c, 'info', `${pname(s, a.by)} обращается в банк за кредитом под залог ${cellName(s, a.cell)}.`, a.by);
      return;
    }
    case 'repayLoan': {
      const l = s.loans.find((x) => x.id === a.loan);
      if (!l || l.player !== a.by || l.status !== 'active') return 'Кредит не найден';
      if (!loanOwed(s, l).can(P(s, a.by))) return 'Недостаточно средств';
      s.prompts = s.prompts.filter((q) => !(q.ctx.type === 'loanDue' && q.ctx.loan === l.id));
      return repay(c, l);
    }
    case 'auctionStart': {
      if (s.auction) return 'Уже идут торги';
      if (!canOperate(s, a.by)) return 'Торги объявляются до броска в свой ход';
      const lot = a.lot;
      let seller: PlayerId | 'bank';
      let bankCollateral = false;
      if (lot.type === 'prop') {
        const pr = s.props[lot.cell];
        if (!pr) return 'Клетка свободна';
        if (pr.owner === 'bank') { seller = 'bank'; bankCollateral = true; }
        else if (pr.owner === a.by) { if (pr.pledged) return 'Имущество в залоге'; seller = a.by; }
        else return 'Выставить можно своё имущество или банковский залог';
      } else {
        if (P(s, a.by).stocks[lot.color] < lot.count || lot.count < 1) return 'Нет столько акций';
        seller = a.by;
      }
      s.auction = { id: uid(s, 'a'), lot, seller, initiator: a.by, bids: {}, conductor: lot.type === 'prop' ? 'chairman' : 'broker', bankCollateral };
      log(c, 'info', `Открытые торги: ${lotText(s, lot)}; продавец — ${pname(s, seller)}. Ведёт: ${ROLE_RU[s.auction.conductor]}.`, a.by);
      return;
    }
    case 'auctionBid': {
      const au = s.auction;
      if (!au) return 'Торгов нет';
      if (a.by === au.seller) return 'Продавец не делает ставок';
      const p = P(s, a.by);
      if (p.bankrupt) return 'Игрок выбыл';
      const top = Math.max(0, ...Object.values(au.bids));
      if (a.amount <= top) return `Ставка должна быть больше ${fmt(top)}`;
      if (a.amount > p.money) return 'Недостаточно денег';
      au.bids[a.by] = Math.round(a.amount);
      log(c, 'info', `Торги: ${p.name} — ${fmt(a.amount)}`, a.by);
      return;
    }
    case 'auctionClose': {
      const au = s.auction;
      if (!au) return 'Торгов нет';
      const holder = s.roles[au.conductor];
      if (a.by !== holder && a.by !== 'host') return `Торги закрывает ${ROLE_RU[au.conductor]}`;
      s.auction = null;
      const best = Object.entries(au.bids).sort((x, y) => y[1] - x[1])[0];
      if (!best) { log(c, 'info', 'Торги закрыты без ставок.'); return; }
      const [winner, price] = best;
      if (P(s, winner).money < price) return void log(c, 'warn', `${pname(s, winner)} не может оплатить ставку — торги аннулированы.`);
      transfer(c, winner, au.seller, price, `торги: ${lotText(s, au.lot)}`);
      if (au.lot.type === 'prop') {
        const pr = s.props[au.lot.cell];
        pr.owner = winner; pr.pledged = null; pr.paid = price;
        c.ev.push({ t: 'prop', cell: au.lot.cell, owner: winner, level: pr.level });
        log(c, 'prop', `Реестр: ${cellName(s, au.lot.cell)} (${LEVEL_RU[pr.level]}) → ${pname(s, winner)} по итогам торгов.`);
      } else {
        P(s, au.seller as PlayerId).stocks[au.lot.color] -= au.lot.count;
        P(s, winner).stocks[au.lot.color] += au.lot.count;
      }
      toast(c, `Торги: победил ${pname(s, winner)} (${fmt(price)})`, 'good');
      if (au.bankCollateral && au.initiator === s.turn.player && !s.turn.rolled) {
        s.turn.rolled = true; s.turn.stage = 'post';
        log(c, 'turn', `Торги по банковскому залогу засчитываются как очередной ход ${pname(s, au.initiator)}.`);
      }
      return;
    }
    case 'auctionCancel': {
      if (!s.auction) return 'Торгов нет';
      if (a.by !== 'host' && a.by !== s.auction.initiator && a.by !== s.roles[s.auction.conductor]) return 'Нет прав';
      s.auction = null;
      log(c, 'info', 'Торги отменены.');
      return;
    }
    case 'tradePropose': {
      if (!canOperate(s, a.by)) return 'Сделку предлагают до броска в свой ход';
      if (a.to === a.by) return 'Нельзя торговать с собой';
      if (!bundleOk(s, a.by, a.give)) return 'У вас нет предлагаемого';
      if (!bundleOk(s, a.to, a.take)) return 'У партнёра нет запрошенного';
      const t = { id: uid(s, 't'), from: a.by, to: a.to, give: a.give, take: a.take, status: 'proposed' as const };
      s.trades.push(t);
      log(c, 'info', `${pname(s, a.by)} предлагает ${pname(s, a.to)} сделку: отдаёт ${bundleText(s, a.give)} — получает ${bundleText(s, a.take)}.`, a.by);
      return;
    }
    case 'tradeRespond': {
      const t = s.trades.find((x) => x.id === a.trade);
      if (!t || t.status !== 'proposed') return 'Сделка неактуальна';
      if (a.by !== t.to) return 'Отвечает получатель предложения';
      t.status = a.accept ? 'accepted' : 'declined';
      log(c, 'info', `${pname(s, t.to)} ${a.accept ? 'принимает' : 'отклоняет'} сделку. ${a.accept ? 'Нужно подтверждение ведущего.' : ''}`, t.to);
      return;
    }
    case 'tradeConfirm': {
      const t = s.trades.find((x) => x.id === a.trade);
      if (!t || t.status !== 'accepted') return 'Сделка не готова к подтверждению';
      const role: RoleId = t.give.cells.length || t.take.cells.length ? 'chairman' : 'broker';
      if (a.by !== 'host' && a.by !== s.roles[role]) return `Подтверждает ${ROLE_RU[role]}`;
      if (!a.ok) { t.status = 'cancelled'; log(c, 'info', 'Ведущий отклонил сделку.'); return; }
      if (!bundleOk(s, t.from, t.give) || !bundleOk(s, t.to, t.take)) { t.status = 'cancelled'; return void log(c, 'warn', 'Сделка сорвалась: у сторон больше нет нужного имущества.'); }
      moveBundle(c, t.from, t.to, t.give, 'сделка');
      moveBundle(c, t.to, t.from, t.take, 'сделка');
      t.status = 'done';
      toast(c, 'Сделка проведена', 'good');
      return;
    }
    case 'declareBankrupt': {
      const d = s.debts.filter((x) => x.debtor === a.player).reduce((x, y) => x + y.amount, 0);
      const p = P(s, a.player);
      if (a.by !== 'host') {
        if (!d) return 'Нет непогашенного платежа';
        if (p.money >= d) return 'Денег достаточно — погасите долг';
        if (assetsValue(s, a.player) >= d) return 'Имущество дороже долга — продайте акции/имущество или возьмите кредит';
        ask(c, { to: 'chairman', title: 'Банкротство', text: `${p.name}: долг ${fmt(d)}, деньги ${fmt(p.money)}, имущество ${fmt(assetsValue(s, a.player))}. Объявить банкротом?`, options: [{ id: 'ok', label: 'Объявить банкротом', tone: 'danger' }, { id: 'no', label: 'Нет' }], ctx: { type: 'bankruptConfirm', player: a.player, why: `платёж ${fmt(d)} больше денег и стоимости имущества` } });
        return;
      }
      return bankrupt(c, a.player, 'решение ведущего');
    }
    case 'hostAdjust': {
      const p = P(s, a.player);
      if (a.money) { if (a.money > 0) transfer(c, 'bank', p.id, a.money, `корректировка ведущего: ${a.reason}`); else transfer(c, p.id, 'bank', -a.money, `корректировка ведущего: ${a.reason}`); }
      if (a.color && a.stocks) { p.stocks[a.color] = Math.max(0, p.stocks[a.color] + a.stocks); log(c, 'ruling', `Ведущий: ${p.name} ${a.stocks > 0 ? '+' : ''}${a.stocks} ${COLOR_RU[a.color]} акц. (${a.reason})`); }
      if (a.color && a.quote !== undefined) setQuote(c, p.id, a.color, a.quote, `ведущий: ${a.reason}`);
      return;
    }
    case 'hostSetOwner':
      setProp(c, a.cell, a.owner, a.owner ? a.level ?? 'plot' : null);
      log(c, 'ruling', `Ведущий: ${cellName(s, a.cell)} → ${a.owner ? pname(s, a.owner) : 'свободна'} (${a.reason})`);
      return;
    case 'roleFine': {
      const h = s.roles[a.role];
      if (h === 'host') return 'Роль у ведущего';
      log(c, 'ruling', `Штраф за нарушение обязанностей (${ROLE_RU[a.role]}): ${a.reason}`);
      charge(c, h, 'bank', 10000, `штраф ведущему: ${ROLE_RU[a.role]}`);
      return;
    }
    case 'setRuling':
      return 'Правила зафиксированы и не меняются в партии';
      return;
    case 'editData': {
      let o: any = s.data;
      for (const k of a.path.slice(0, -1)) o = o[k];
      const last = a.path.at(-1)!;
      const before = JSON.stringify(o[last]);
      o[last] = a.value;
      log(c, 'ruling', `Ведущий правит справочник: ${a.path.join('.')} ${before} → ${JSON.stringify(a.value)}`);
      return;
    }
    case 'hostNote': log(c, 'ruling', `Ведущий: ${a.text}`); return;
    case 'hostMove': {
      const p = P(s, a.player);
      p.pos = a.to;
      c.ev.push({ t: 'teleport', player: a.player, to: a.to });
      log(c, 'ruling', `Ведущий переставляет фишку ${p.name} → ${posLabel(s, a.to)} (${a.reason})`);
      return;
    }
    case 'endGame': {
      const rank = active(s).map((p) => ({ p, w: netWorth(s, p.id) })).sort((x, y) => y.w - x.w);
      s.winner = rank[0]?.p.id ?? null;
      s.turn.stage = 'over';
      log(c, 'turn', `Игроки завершили партию. Итог: ${rank.map((r, i) => `${i + 1}. ${r.p.name} — ${fmt(r.w)}`).join('; ')}.`);
      return;
    }
  }
}
const lotText = (s: GameState, lot: Lot) => (lot.type === 'prop' ? `${cellName(s, lot.cell)} (${LEVEL_RU[s.props[lot.cell]?.level ?? 'plot']})` : `${COLOR_RU_PL[lot.color]} акции ×${lot.count}`);

export { netWorth, assetsValue, propValue, maxQuote, posLabel, enumerate as _enumerate };
