import type { Ruling } from './types';

// Ситуации, которые буклет не решает однозначно. Ведущий выбирает вариант на экране
// подготовки или в панели ведущего; каждое изменение и каждое применение пишется в журнал.
export const RULINGS: Ruling[] = [
  {
    key: 'enterpriseCost',
    title: 'Открытие предприятия',
    note: 'Скан буклета (стр. 4): «игрок оплачивает в БАНК его стоимость». В текстовой версии — «получает».',
    options: [
      { id: 'pay', label: 'Игрок платит банку стоимость (по скану)' },
      { id: 'receive', label: 'Игрок получает от банка стоимость (по тексту)' },
    ],
  },
  {
    key: 'innerPrice',
    title: 'Покупка фирмы во внутреннем периметре',
    note: 'На клетках «Бизнеса в России» указана одна цена (вверху) и аренда (внизу).',
    options: [
      { id: 'half', label: 'За половину указанной цены' },
      { id: 'full', label: 'За полную указанную цену' },
    ],
  },
  {
    key: 'group21',
    title: 'Комплект 21–22–25 (красные)',
    note: 'Между 22 и 25 стоят «Штраф» и «Банк», которые правило прямо не исключает.',
    options: [
      { id: 'yes', label: 'Считать комплектом' },
      { id: 'no', label: 'Не считать комплектом' },
    ],
  },
  {
    key: 'quoteFloor',
    title: 'Котировка ниже нуля',
    options: [
      { id: 'zero', label: 'Не ниже $0' },
      { id: 'negative', label: 'Разрешить отрицательную' },
    ],
  },
  {
    key: 'halve',
    title: 'Деление котировки «:2»',
    options: [
      { id: 'floor', label: 'Округлять вниз до пункта ($1 000)' },
      { id: 'exact', label: 'Точно, до доллара' },
    ],
  },
  {
    key: 'exOvershoot',
    title: 'Биржа: бросок дальше клетки 20',
    options: [
      { id: 'end', label: 'Игра на бирже заканчивается без изменения' },
      { id: 'stop20', label: 'Фишка останавливается на 20' },
    ],
  },
  {
    key: 'exitEffect',
    title: 'Выход с биржи/рулетки на клетку',
    options: [
      { id: 'yes', label: 'Действует эффект клетки выхода' },
      { id: 'no', label: 'Просто встать на клетку' },
    ],
  },
  {
    key: 'rouletteBank',
    title: 'Рулетка: сектор «В БАНК»',
    note: 'Значение сектора на поле не указано.',
    options: [
      { id: 'exit', label: 'Выход с рулетки в Банк (клетка 52)' },
      { id: 'host', label: 'Решает ведущий каждый раз' },
    ],
  },
  {
    key: 'rouletteExitBonus',
    title: 'Выход с рулетки в Банк',
    options: [
      { id: 'no', label: 'Без премии клиента банка' },
      { id: 'yes', label: 'Премия $50 000 как при остановке' },
    ],
  },
  {
    key: 'rightNeighbor',
    title: '«Сосед справа»',
    note: 'Ход передаётся по часовой стрелке, т.е. игроку слева.',
    options: [
      { id: 'prev', label: 'Предыдущий по очерёдности' },
      { id: 'next', label: 'Следующий по очерёдности' },
    ],
  },
  {
    key: 'startOnLand',
    title: 'Остановка ровно на «Старте»',
    options: [
      { id: 'yes', label: 'Тоже $20 000' },
      { id: 'no', label: 'Только при прохождении' },
    ],
  },
  {
    key: 'pledgedRent',
    title: 'Аренда заложенного имущества',
    note: 'Карточка в банке, метка на поле.',
    options: [
      { id: 'owner', label: 'Аренду получает владелец' },
      { id: 'none', label: 'Аренда не взимается' },
    ],
  },
  {
    key: 'stockLoanRepay',
    title: 'Возврат кредита акциями',
    options: [
      { id: 'money', label: 'Деньгами по котировке выдачи' },
      { id: 'stocks', label: 'Возвратом тех же акций' },
    ],
  },
];

export const DEFAULT_RULINGS: Record<string, string> = Object.fromEntries(RULINGS.map((r) => [r.key, r.options[0].id]));
export const rulingLabel = (key: string, value: string) => {
  const r = RULINGS.find((x) => x.key === key);
  return r ? `${r.title}: ${r.options.find((o) => o.id === value)?.label ?? value}` : `${key}=${value}`;
};
