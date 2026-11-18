// Одноразовый генератор public/data/board.json из оцифровки Map2K.jpg.
// Дальше источником истины является сам board.json (редактируется вручную или в игре).
import fs from 'node:fs';
const D = 1.06; // displayed->orig
const a = 244, c = 173.33, N = 2048;
const outer = (k) => {
  if (k === 0) return [122, 1926];
  if (k < 10) return [122, N - a - (k - 0.5) * c];
  if (k === 10) return [122, 122];
  if (k < 20) return [a + (k - 10.5) * c, 122];
  if (k === 20) return [1926, 122];
  if (k < 30) return [1926, a + (k - 20.5) * c];
  if (k === 30) return [1926, 1926];
  return [N - a - (k - 30.5) * c, 1926];
};
const co = (name, color, quote, rent, price, extra = {}) => ({ type: 'company', name, color, quote, rent: { plot: rent[0], branch: rent[1], enterprise: rent[2] }, price, ...extra });
const outerDefs = {
  0: { type: 'start', name: 'Старт', bonusPass: 20000 },
  1: co('Puma', 'red', 25000, [6000, 12000, 16000], 20000),
  2: { type: 'win', name: 'Выигрыш', amount: 40000 },
  3: co('Nike', 'red', 40000, [6000, 14000, 36000], 50000),
  4: { type: 'card', name: 'Извещение', deck: 'notice' },
  5: co('Adidas', 'red', 35000, [10000, 14000, 22000], 30000),
  6: co('Intel', 'yellow', 30000, [8000, 10000, 18000], 26000),
  7: { type: 'card', name: 'Сюрприз', deck: 'surprise' },
  8: co('Apple', 'yellow', 40000, [8000, 16000, 38000], 50000),
  9: co('IBM', 'yellow', 80000, [6000, 12000, 78000], 90000, { проверить: 'аренда предприятия читается как 78 000 (возможно 28 000)' }),
  10: { type: 'exchange_gate', name: 'Биржа' },
  11: co('Дэу', 'blue', 25000, [6000, 12000, 28000], 30000),
  12: { type: 'card', name: 'Подарок', deck: 'gift' },
  13: co('Samsung', 'blue', 40000, [8000, 18000, 22000], 36000, { проверить: 'аренда филиала читается как 18 000 (возможно 16 000)' }),
  14: { type: 'card', name: 'Сюрприз', deck: 'surprise' },
  15: co('Кодак', 'blue', 35000, [8000, 10000, 16000], 20000),
  16: co('Тойота', 'green', 80000, [10000, 20000, 40000], 60000),
  17: { type: 'card', name: 'Извещение', deck: 'notice' },
  18: co('Хонда', 'green', 70000, [10000, 16000, 36000], 60000),
  19: co('Мазда', 'green', 50000, [8000, 12000, 28000], 50000),
  20: { type: 'broker', name: 'Маклер', exchangeFee: 5000 },
  21: co('Lancôme', 'red', 50000, [6000, 8000, 18000], 20000),
  22: co('Schwarzkopf & Henkel', 'red', 25000, [4000, 8000, 10000], 12000),
  23: { type: 'card', name: 'Штраф', deck: 'fine' },
  24: { type: 'bank', name: 'Банк', premium: 50000, transferFee: 25000, twin: 52 },
  25: co('Орифлейм', 'red', 25000, [8000, 18000, 38000], 40000),
  26: co('Форд', 'yellow', 80000, [30000, 60000, 100000], 150000),
  27: { type: 'card', name: 'Извещение', deck: 'notice' },
  28: co('Ягуар', 'yellow', 80000, [20000, 36000, 72000], 100000),
  29: co('Опель', 'yellow', 90000, [4000, 16000, 48000], 80000),
  30: { type: 'hotel', name: 'Отель', fee: 10000, ownable: true, price: null, требует_оцифровки: 'цена покупки отеля на поле не указана' },
  31: { type: 'customs_post', name: 'Таможенный пост' },
  32: co('Nestlé', 'blue', 25000, [4000, 10000, 14000], 16000),
  33: { type: 'win', name: 'Прибыль', amount: 50000 },
  34: co('Макдональдс', 'blue', 35000, [6000, 16000, 26000], 30000),
  35: co('Баскин Роббинс', 'blue', 40000, [8000, 20000, 22000], 38000),
  36: { type: 'card', name: 'Сюрприз', deck: 'surprise' },
  37: co('Фольксваген', 'green', 80000, [10000, 18000, 76000], 84000),
  38: co('Мерседес', 'green', 300000, [24000, 38000, 68000], 84000),
  39: co('BMW', 'green', 100000, [14000, 34000, 42000], 84000),
};
const ru = (name, color, price, rent, kind) => ({ type: 'ru_company', name, kind, color, price, rentSingle: rent });
const innerDefs = {
  40: { type: 'customs', name: 'Таможня', entryFee: 10000, exitDuty: 15000, exitPerRuProperty: 5000, xy: [1728, 1696] },
  41: { type: 'customs', name: 'Таможня', entryFee: 10000, exitDuty: 15000, exitPerRuProperty: 5000, xy: [1569, 1696] },
  42: { ...ru('АЗЛК', 'red', 100000, 80000, 'Автомобильный завод'), xy: [1370, 1690] },
  43: { ...ru('СОТЕЛ', 'yellow', 120000, 100000, 'Федеральная сотовая сеть'), xy: [1196, 1690] },
  44: { ...ru('Балтика', 'blue', 150000, 130000, 'Пивоваренная компания'), xy: [1021, 1690] },
  45: { ...ru('Россия', 'red', 180000, 150000, 'Шоколадная фабрика'), xy: [848, 1690] },
  46: { ...ru('Грин Мама', 'green', 200000, 100000, 'Российская косметика'), xy: [498, 1690] },
  47: { type: 'supermarket', name: 'Супермаркет', fee: 15000, price: 60000, ownerTax: 5000, xy: [339, 1654] },
  48: { ...ru('38 Канал', 'yellow', 250000, 50000, 'Компания'), xy: [352, 1370] },
  49: { type: 'exchange_gate', name: 'Биржа', xy: [305, 516] },
  50: { type: 'win50', name: 'Выигрыш', amount: 20000, stocks: 5, xy: [1320, 880] },
  51: { type: 'roulette_gate', name: 'Рулетка (вход)', xy: [1327, 530] },
  52: { type: 'bank', name: 'Банк', premium: 50000, transferFee: 25000, twin: 24, xy: [1640, 848] },
  53: { ...ru('ЗИЛ', 'red', 350000, 105000, 'Автозавод'), xy: [1672, 1028] },
  54: { ...ru('Сбербанк', 'green', 500000, 350000, 'Банк'), xy: [1672, 1205] },
  55: { ...ru('Аэрофлот', 'blue', 750000, 500000, 'Компания'), xy: [1672, 1380] },
};
const cells = [];
for (let k = 0; k < 40; k++) { const [x, y] = outer(k); cells.push({ id: k, zone: 'outer', ...outerDefs[k], xy: [Math.round(x), Math.round(y)] }); }
for (let k = 40; k <= 55; k++) { const d = innerDefs[k]; cells.push({ id: k, zone: 'inner', ...d, xy: d.xy.map(Math.round) }); }
const hw = [
  ['Получите в банке 50 000', { kind: 'money', amount: 50000 }, [1425, 1440]],
  ['Оплатите штраф', { kind: 'draw', deck: 'fine' }, [1338, 1352]],
  ['Выигрыш 5 акций', { kind: 'stocks', count: 5 }, [1254, 1260]],
  ['Вас ждёт подарок', { kind: 'draw', deck: 'gift' }, [1162, 1155]],
  ['Пропуск хода', { kind: 'skip' }, [1023, 1045]],
  ['Пропуск хода', { kind: 'skip' }, [863, 1045]],
  ['Получите 3 акции любого цвета', { kind: 'stocks', count: 3 }, [702, 1155]],
  ['Оплатите в банк 25 000', { kind: 'money', amount: -25000 }, [658, 1374]],
  ['Получите извещение', { kind: 'draw', deck: 'notice' }, [658, 1550]],
  ['Выберите себе подарок', { kind: 'chooseCard', deck: 'gift' }, [658, 1711]],
];
const highway = hw.map(([name, effect, xy], i) => ({ id: `h${i + 1}`, n: i + 1, name, effect, xy }));
const lanes = [['blue', 330], ['green', 435], ['yellow', 540], ['red', 645]];
const exchange = {
  lanes: lanes.map(([color, yd]) => ({ color, cells: Array.from({ length: 20 }, (_, i) => [Math.round(351 + i * 41.95), Math.round(yd * D)]) })),
  start: [305, 516], specialCells: [5, 10, 15, 20], length: 20, exits: [11, 21, 50],
};
const cx = 1455 * D, cy = 385 * D, R = 120 * D;
const sectorDefs = [
  { slot: 0, label: 'В БАНК', type: 'to_bank', value: null, требует_оцифровки: 'значение сектора «В БАНК» на поле не указано' },
  { slot: 1, label: '−30 000', value: -30000 },
  { slot: 2, label: '+65 000', value: 65000 },
  { slot: 3, label: '−25 000', value: -25000, start: true },
  { slot: 4, label: '+15 000', value: 15000 },
  { slot: 5, label: '−5 000', value: -5000 },
  { slot: 6, label: '−30 000', value: -30000, exit: true },
  { slot: 7, label: '+30 000', value: 30000, exit: true },
  { slot: 8, label: '−1 000', value: -1000, exit: true },
  { slot: 9, label: '+20 000', value: 20000, exit: true },
  { slot: 10, label: '−20 000', value: -20000 },
  { slot: 11, label: 'В БАНК', type: 'to_bank', value: null, требует_оцифровки: 'значение сектора «В БАНК» на поле не указано' },
];
const roulette = {
  center: [Math.round(cx), Math.round(cy)], startSlot: 3, direction: 'ccw', lapsToLeave: 2, exitTo: [52, 24],
  // ccw-порядок обхода (по полю): от «−25 000» против часовой стрелки
  order: [3, 2, 1, 0, 11, 10, 9, 8, 7, 6, 5, 4],
  sectors: sectorDefs.map((s) => { const ang = ((30 * s.slot - 195 + 180) * Math.PI) / 180; return { ...s, xy: [Math.round(cx + R * Math.sin(ang)), Math.round(cy - R * Math.cos(ang))] }; }),
};
const board = {
  _описание: 'Справочник поля «Бизнес-класс!!!», оцифрован по Map2K.jpg (2048×2048). Координаты xy — пиксели изображения поля. Поля «проверить» и «требует_оцифровки» показывают сомнительные/неизвестные значения.',
  image: 'res/board.jpg', size: 2048,
  cells,
  groups: [
    { color: 'red', cells: [1, 3, 5] }, { color: 'yellow', cells: [6, 8, 9] }, { color: 'blue', cells: [11, 13, 15] }, { color: 'green', cells: [16, 18, 19] },
    { color: 'red', cells: [21, 22, 25], примечание: 'между 22 и 25 стоят клетки «Штраф» и «Банк» — правило перечисляет только Сюрприз/Извещение/Выигрыш; ведущий может исключить группу' },
    { color: 'yellow', cells: [26, 28, 29] }, { color: 'blue', cells: [32, 34, 35] }, { color: 'green', cells: [37, 38, 39] },
  ],
  // Рёбра движения. Основной путь — next; развилки — branches (fee: платёж банку при переходе).
  edges: {
    outerNext: 'k -> k+1, 39 -> 0',
    innerLoop: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55],
    branches: [
      { from: 31, to: 40, label: 'Въезд в Россию через таможню (31→40)', fee: 10000, feeKey: 'customsEntry' },
      { from: 40, to: 0, label: 'Выезд за рубеж через таможенный пост (40→Старт)', feeKey: 'customsExit' },
      { from: 41, to: 0, label: 'Выезд за рубеж через таможенный пост (41→Старт)', feeKey: 'customsExit' },
    ],
    bankTransfer: { a: 24, b: 52, fee: 25000 },
    highway: { from: 30, exits: [46, 37] },
  },
  highway, exchange, roulette,
};
fs.writeFileSync('public/data/board.json', JSON.stringify(board, null, 1));
console.log('cells', cells.length);
