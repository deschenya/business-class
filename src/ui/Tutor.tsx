import { useEffect, useState } from 'react';
import type { GameState } from '../engine/types';
import { awaitingRoll } from '../engine/engine';
import { resolveTarget } from '../engine/util';
import { useStore } from '../store';

// ---------------------------------------------------------------- настройка «обучение» (на устройстве игрока)
const KEY = 'bk.tutor';
const SEEN = 'bk.tutor.seen';
const read = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const listeners = new Set<() => void>();
export const tutor = {
  get on() { return read(KEY, 'off') === 'on'; },
  set(on: boolean) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); if (on) localStorage.removeItem(SEEN); } catch { /* */ } listeners.forEach((f) => f()); },
  seen(): string[] { try { return JSON.parse(read(SEEN, '[]')); } catch { return []; } },
  markSeen(id: string) { try { localStorage.setItem(SEEN, JSON.stringify([...new Set([...tutor.seen(), id])])); } catch { /* */ } listeners.forEach((f) => f()); },
};
export function useTutorOn() {
  const [on, setOn] = useState(tutor.on);
  useEffect(() => { const f = () => setOn(tutor.on); listeners.add(f); return () => void listeners.delete(f); }, []);
  return on;
}
export function TutorToggle({ label = 'Обучение' }: { label?: string }) {
  const on = useTutorOn();
  return (
    <label className="tutor-toggle check" title="Подсказки по правилам во время хода (на этом устройстве)">
      <input type="checkbox" checked={on} onChange={(e) => tutor.set(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------- подсказки
interface Tip { id: string; title: string; text: string; inPrompt: boolean }
const T: Record<string, { title: string; text: string }> = {
  welcome: { title: 'Добро пожаловать за стол!', text: 'Цель — разбогатеть больше других; банкрот выбывает, конец партии игроки выбирают сами. Слева — игроки: деньги и акции (сколько штук и котировка каждого цвета). Справа — журнал, расчёты, котировки и реестр собственности. Наведите на клетку поля — увидите цену и аренду.' },
  order: { title: 'Розыгрыш очерёдности', text: 'Перед партией каждый бросает один кубик: у кого выпадет больше, тот ходит раньше. При равенстве равные перебрасывают. Нажмите «Бросить на очерёдность».' },
  pre: { title: 'Ваш ход', text: 'До броска можно купить или продать акции, взять кредит под залог, выставить имущество на торги или предложить сделку — кнопки рядом с броском. Когда будете готовы — «Бросить кубики». За каждое прохождение «Старта» банк платит $20 000.' },
  route: { title: 'Развилка', text: 'Путей несколько: с внешнего периметра («Бизнес за рубежом») можно въехать в Россию через таможню 31→40 (пошлина $10 000), а с таможни 40/41 — выехать на «Старт» ($15 000 + $5 000 за каждую вашу недвижимость в России). Выберите маршрут.' },
  six: { title: 'Дубль 6 : 6', text: 'Можно сыграть на бирже, а потом вернуться на исходную клетку — или просто пройти 12 клеток.' },
  buyPlot: { title: 'Свободная фирма', text: 'Купите участок за половину цены предприятия. Встанете сюда снова — откроете филиал за вторую половину. Три филиала одного цвета подряд дают право открыть предприятие: его аренда самая высокая.' },
  buyBranch: { title: 'Ваш участок', text: 'Откройте филиал — аренда с этой клетки вырастет.' },
  buyEnterprise: { title: 'Комплект из трёх филиалов', text: 'Все три клетки одного цвета ваши и с филиалами — можно открыть предприятие с максимальной арендой.' },
  buyRu: { title: 'Бизнес в России', text: 'Фирмы здесь дороже, зато и аренда крупная. Помните: выезд за рубеж через таможню стоит дороже, если у вас много российской недвижимости.' },
  draw: { title: 'Карточка', text: 'Вытяните любую из пяти закрытых карт. Она сработает сразу и вернётся в колоду.' },
  exGate: { title: 'Биржа', text: 'Выберите цвет дорожки и бросайте кубики. Номинал ваших акций этого цвета растёт на номер клетки остановки (1 пункт = $1 000); на клетках 5, 10, 15, 20 растут и все остальные ваши цвета. В рискованном режиме после каждого хода — карточка, меняющая курсы у ВСЕХ.' },
  exRoll: { title: 'Вы на бирже', text: 'Бросайте кубики, пока не пройдёте клетку 20, — затем выберете выход: на клетку 11, 21 или 50.' },
  exCard: { title: 'Биржевая карточка', text: 'Её действие распространяется на акции всех игроков, а не только ваши. Курсы обновятся во вкладке «Котировки».' },
  rlGate: { title: 'Рулетка', text: 'Старт — сектор «−25 000», дальше против часовой стрелки на сумму очков. Выигрыш или проигрыш — с банком. Уйти можно на зелёном секторе «ВЫХОД» или после двух полных кругов.' },
  rlRoll: { title: 'Вы за рулеткой', text: 'Крутите (бросайте кубики). Когда остановитесь на зелёном секторе или пройдёте два круга — появится кнопка выхода в Банк.' },
  bankSwitch: { title: 'Клиент банка', text: 'Вы получили премию $50 000. Можно остаться на этом периметре или перейти 24↔52 за пошлину $25 000.' },
  hotel: { title: 'Отель', text: 'Вы заплатили $10 000. Дальше можно поехать по автостраде (на её 10-й клетке — съезд на 46 или 37), сыграть дважды на рулетке или открыть фирму в России за полцены.' },
  freeStocks: { title: 'Новые акции', text: 'Распределите полученные акции по цветам. Их стоимость считается по вашей котировке.' },
  loanDue: { title: 'Срок кредита', text: 'Кредит нужно вернуть. Не вернёте — залог заберёт банк, а выкупить его можно будет только с открытых торгов.' },
  claim: { title: 'Требуйте аренду!', text: 'Кто-то встал на вашу собственность. Нажмите «Потребовать» до броска следующего игрока — иначе по правилам аренда сгорает.' },
  debt: { title: 'Не хватает денег', text: 'Продайте акции (кнопка «Акции»), возьмите кредит под залог или продайте имущество на торгах. Если всё имущество дешевле долга — объявляется банкротство.' },
  post: { title: 'Ход сделан', text: 'Если всё решили — нажмите «Завершить ход», и кубики перейдут следующему игроку.' },
  roles: { title: 'Вы — ведущий', text: 'Эту заявку подтверждает ведущий (банкир, брокер или председатель). Проверьте условия и примите решение.' },
};
const PROMPT_TIP: Record<string, string> = {
  route: 'route', six: 'six', buyPlot: 'buyPlot', buyBranch: 'buyBranch', buyEnterprise: 'buyEnterprise', buyRu: 'buyRu', draw: 'draw', chooseCard: 'draw',
  exGate: 'exGate', brokerGate: 'exGate', exLane: 'exGate', exMode: 'exGate', exCard: 'exCard', rlGate: 'rlGate', bankSwitch: 'bankSwitch', hotel: 'hotel',
  freeStocks: 'freeStocks', loanDue: 'loanDue', loanApprove: 'roles', bankruptConfirm: 'roles',
};

function pickTip(s: GameState, can: (id: string) => boolean, seen: string[], busy: boolean): Tip | null {
  if (busy || s.turn.stage === 'over') return null;
  const want: string[] = ['welcome'];
  let promptTip: string | null = null;
  const mineNow = can(s.turn.player);
  if (s.claims.some((c) => c.status === 'open' && can(c.owner))) want.push('claim');
  if (s.debts.some((d) => can(d.debtor))) want.push('debt');
  const q = s.prompts[0];
  if (q) {
    const target = resolveTarget(s, q.to);
    if (can(target) || (target === 'host' && can('host'))) { const k = PROMPT_TIP[q.ctx.type]; if (k) { want.push(k); promptTip = k; } }
  } else if (mineNow) {
    const r = awaitingRoll(s);
    if (r === 'order') want.push('order');
    if (r === 'main') want.push('pre');
    if (r === 'exchange') want.push('exRoll');
    if (r === 'roulette') want.push('rlRoll');
    if (s.turn.stage === 'post') want.push('post');
  }
  const id = want.find((k) => !seen.includes(k));
  return id ? { id, ...T[id], inPrompt: id === promptTip } : null;
}

function TipBody({ tip }: { tip: Tip }) {
  return (
    <>
      <div className="tutor-head"><b>{tip.title}</b></div>
      <p>{tip.text}</p>
      <div className="row">
        <button className="btn sm gold" onClick={() => tutor.markSeen(tip.id)}>Понятно</button>
        <button className="btn sm ghost" onClick={() => tutor.set(false)}>Выключить обучение</button>
      </div>
    </>
  );
}
function useTip(s: GameState, busy: boolean) {
  const on = useTutorOn();
  const can = useStore((st) => st.can);
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((x) => x + 1); listeners.add(f); return () => void listeners.delete(f); }, []);
  return on ? pickTip(s, can, tutor.seen(), busy) : null;
}
/** Плавающая подсказка — когда нет окна выбора. */
export function TutorCard({ s, busy }: { s: GameState; busy: boolean }) {
  const tip = useTip(s, busy);
  if (!tip || tip.inPrompt || (s.prompts.length && tip.id !== 'claim' && tip.id !== 'debt')) return null;
  return <div className="tutor glass" key={tip.id}><TipBody tip={tip} /></div>;
}
/** Подсказка внутри окна выбора. */
export function TutorInline({ s }: { s: GameState }) {
  const tip = useTip(s, false);
  if (!tip || !tip.inPrompt) return null;
  return <div className="tutor inline" key={tip.id}><TipBody tip={tip} /></div>;
}
