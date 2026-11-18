import { useEffect, useState } from 'react';
import type { Color, GameState, Prompt } from '../engine/types';
import { COLORS, COLOR_RU, COLOR_RU_PL } from '../engine/types';
import { resolveTarget } from '../engine/util';
import { useStore } from '../store';
import { STOCK_HEX, fmt, pn, cls } from './helpers';
import { sfx } from './sound';
import { TutorInline } from './Tutor';
import { DeedCard } from './DeedCard';
import { sceneRef } from './Game';

// при покупке показываем карточку фирмы; подсвечивается то, что сейчас приобретается
const DEED: Record<string, 'plot' | 'branch' | 'enterprise' | 'buy'> = { buyPlot: 'plot', buyBranch: 'branch', buyEnterprise: 'enterprise', buyRu: 'buy' };

export function PromptView({ s }: { s: GameState }) {
  const can = useStore((st) => st.can);
  const q = s.prompts[0];
  if (!q) return null;
  const target = resolveTarget(s, q.to);
  const isRole = ['banker', 'broker', 'chairman', 'inspector'].includes(q.to);
  const by = can(target) ? target : isRole && can('host') ? 'host' : null;
  if (!by) return <div className="waiting glass">Ждём решения: <b>{pn(s, target)}</b> — {q.title}</div>;
  return <PromptCard key={q.id} s={s} q={q} by={by} />;
}

function PromptCard({ s, q, by }: { s: GameState; q: Prompt; by: string }) {
  useEffect(() => () => sceneRef?.preview(null), []); // вопрос закрыт — вернуть камеру и убрать подсветку
  const dispatch = useStore((st) => st.dispatch);
  const [payload, setPayload] = useState<any>({});
  const [err, setErr] = useState<string | null>(null);
  const answer = (option: string, pl?: any) => { sfx.click(); const e = dispatch({ type: 'answer', by: by as any, prompt: q.id, option, payload: pl ?? payload }); setErr(e); };
  const f = q.form;
  const who = resolveTarget(s, q.to);
  const color = s.players.find((p) => p.id === who)?.color ?? '#d6b25e';
  if (f?.kind === 'pickCard') return <CardFan s={s} q={q} onPick={(i) => (f.faceUp ? answer(String(i)) : answer('pick', { index: i }))} color={color} />;
  return (
    <div className="prompt-wrap">
      <div className="prompt glass" style={{ ['--c' as any]: color }}>
        <div className="prompt-who">{pn(s, who)}{['banker', 'broker', 'chairman', 'inspector'].includes(q.to) ? ` · ${q.to === 'banker' ? 'банкир' : q.to === 'broker' ? 'брокер' : q.to === 'chairman' ? 'председатель' : 'инспектор'}` : ''}</div>
        <h3>{q.title}</h3>
        {q.text && <p className="prompt-text">{q.text}</p>}
        {DEED[q.ctx.type] && typeof q.ctx.cell === 'number' && <DeedCard s={s} cell={q.ctx.cell} highlight={DEED[q.ctx.type]} />}
        <TutorInline s={s} />
        {f && <FormView s={s} q={q} value={payload} set={setPayload} />}
        {err && <p className="err">{err}</p>}
        <div className="prompt-options">
          {q.options.map((o) => (
            <button key={o.id} className={cls('btn', o.tone === 'primary' && 'gold', o.tone === 'danger' && 'danger', o.tone === 'muted' && 'ghost', o.target && 'has-target')} disabled={o.disabled} onClick={() => answer(o.id)}
              onMouseEnter={() => o.target && sceneRef?.preview(o.target)} onMouseLeave={() => o.target && sceneRef?.preview(null)}
              onFocus={() => o.target && sceneRef?.preview(o.target)} onBlur={() => o.target && sceneRef?.preview(null)}>
              {o.label}{o.hint && <small>{o.hint}</small>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stepper({ v, set, step = 1, min = 0, max = 99 }: { v: number; set: (n: number) => void; step?: number; min?: number; max?: number }) {
  return <span className="stepper"><button onClick={() => set(Math.max(min, v - step))}>−</button><b>{step >= 1000 ? fmt(v) : v}</b><button onClick={() => set(Math.min(max, v + step))}>+</button></span>;
}

function FormView({ s, q, value, set }: { s: GameState; q: Prompt; value: any; set: (v: any) => void }) {
  const f = q.form!;
  useEffect(() => {
    if (f.kind === 'stockCounts') set({ counts: { red: 0, yellow: 0, green: 0, blue: 0 } });
    if (f.kind === 'distribute') set({ amounts: Object.fromEntries((f.players ?? []).map((p) => [p, 0])) });
    if (f.kind === 'assignColors') set({ colors: (f.values ?? []).map((_, i) => COLORS[i]) });
    if (f.kind === 'amount') set({ amount: 0 });
    if (f.kind === 'pickPlayer') set({ player: f.players?.[0] });
    if (f.kind === 'pickCell') set({ cell: f.cells?.[0], player: f.players?.[0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.id]);
  switch (f.kind) {
    case 'stockCounts': {
      const c = value.counts ?? {};
      const total = COLORS.reduce((a, k) => a + (c[k] ?? 0), 0);
      return (
        <div className="form">
          {COLORS.map((k) => <div key={k} className="form-row"><span className="dot" style={{ background: STOCK_HEX[k] }} />{COLOR_RU_PL[k]}<Stepper v={c[k] ?? 0} set={(n) => set({ counts: { ...c, [k]: n } })} max={f.total} /></div>)}
          <div className={total === f.total ? 'ok small' : 'muted small'}>Выбрано {total} из {f.total}</div>
        </div>
      );
    }
    case 'distribute': {
      const a = value.amounts ?? {};
      const sum = Object.values(a).reduce((x: number, y: any) => x + Number(y), 0) as number;
      return (
        <div className="form">
          {(f.players ?? []).map((p) => <div key={p} className="form-row"><span className="dot" style={{ background: s.players.find((x) => x.id === p)?.color }} />{pn(s, p)}<Stepper v={a[p] ?? 0} step={f.step ?? 1000} max={f.total} set={(n) => set({ amounts: { ...a, [p]: n } })} /></div>)}
          <div className={sum === f.total ? 'ok small' : 'muted small'}>Распределено {fmt(sum)} из {fmt(f.total!)}</div>
        </div>
      );
    }
    case 'assignColors': {
      const cols: Color[] = value.colors ?? [];
      return (
        <div className="form">
          {(f.values ?? []).map((v, i) => (
            <div key={i} className="form-row"><b className={v > 0 ? 'ok' : 'bad'}>{v > 0 ? '+' : ''}{v} п.</b>
              <div className="seg sm">{COLORS.map((c) => <button key={c} className={cols[i] === c ? 'on' : ''} style={{ borderColor: STOCK_HEX[c] }} onClick={() => { const n = [...cols]; n[i] = c; set({ colors: n }); }}>{COLOR_RU[c]}</button>)}</div>
            </div>
          ))}
          {new Set(cols).size !== cols.length && <div className="bad small">Каждое изменение — на свой цвет</div>}
        </div>
      );
    }
    case 'amount':
      return <div className="form"><input type="number" step={f.step ?? 1000} value={value.amount ?? 0} onChange={(e) => set({ amount: Number(e.target.value) })} /> <span className="muted">{fmt(value.amount ?? 0)}</span></div>;
    case 'pickPlayer':
      return <div className="form row wrap">{(f.players ?? []).map((p) => <button key={p} className={cls('btn sm', value.player === p && 'gold')} onClick={() => set({ player: p })}>{pn(s, p)}</button>)}</div>;
    case 'pickCell':
      return (
        <div className="form">
          <div className="row wrap">{(f.cells ?? []).map((c) => <button key={c} className={cls('btn sm', value.cell === c && 'gold')} onClick={() => set({ ...value, cell: c })}>№{c} {s.data.board.cells.find((x) => x.id === c)?.name}</button>)}</div>
          {f.players && <div className="row wrap">Кому: {f.players.map((p) => <button key={p} className={cls('btn sm', value.player === p && 'gold')} onClick={() => set({ ...value, player: p })}>{pn(s, p)}</button>)}</div>}
        </div>
      );
    default: return null;
  }
}

function CardFan({ s, q, onPick, color }: { s: GameState; q: Prompt; onPick: (i: number) => void; color: string }) {
  const f = q.form!;
  const deck = f.deck === 'exchange' ? s.data.cards.decks.exchange : s.data.cards.decks[f.deck as 'notice'];
  const n = f.faceUp ? f.faceUp.length : f.deck === 'exchange' ? Math.min(f.cards ?? 5, 28) : Math.min(5, f.cards ?? 5);
  const [picked, setPicked] = useState<number | null>(null);
  const isEx = f.deck === 'exchange';
  return (
    <div className="fan-wrap">
      <div className="fan-title glass" style={{ ['--c' as any]: color }}>
        <div className="prompt-who">{pn(s, resolveTarget(s, q.to))}</div>
        <h3>{q.title}</h3>
        <p className="muted">{q.text}</p>
        <TutorInline s={s} />
      </div>
      <div className={cls('fan', isEx && 'ex', f.faceUp && 'up')}>
        {Array.from({ length: n }, (_, i) => {
          const mid = (n - 1) / 2;
          const rot = isEx ? 0 : (i - mid) * 7;
          const img = f.faceUp ? deck.cards[i].image : deck.back;
          return (
            <button key={i} className={cls('fan-card', picked === i && 'picked')} style={{ ['--r' as any]: `${rot}deg`, ['--i' as any]: i, ['--y' as any]: `${Math.abs(i - mid) * (isEx ? 0 : 10)}px` }}
              onClick={() => { if (picked !== null) return; setPicked(i); sfx.card(); setTimeout(() => onPick(i), 380); }}>
              <img src={img} alt="" draggable={false} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
