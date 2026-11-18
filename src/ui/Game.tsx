import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { TableScene, type HoverInfo } from '../three/TableScene';
import { PlayersPanel } from './PlayersPanel';
import { SidePanel } from './SidePanel';
import { ActionBar } from './ActionBar';
import { PromptView } from './PromptView';
import { CardReveal } from './CardReveal';
import { Tooltip } from './Tooltip';
import { TopBar } from './TopBar';
import type { GameEvent, GameState } from '../engine/types';
import { PawnIcon } from './helpers';
import { TutorCard } from './Tutor';
import { sfx } from './sound';

export let sceneRef: TableScene | null = null;
let revealResolve: (() => void) | null = null;
export const closeReveal = () => { useStore.setState({ reveal: null }); revealResolve?.(); revealResolve = null; };

export function GameScreen() {
  const host = useRef<HTMLDivElement>(null);
  const view = useStore((s) => s.view);
  const queue = useStore((s) => s.queue);
  const demo = useStore((s) => s.demo);
  const [scene, setScene] = useState<TableScene | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [pinned, setPinned] = useState<HoverInfo | null>(null);
  const playing = useRef(false);
  const gameId = view?.id;

  useEffect(() => {
    if (!host.current || !view) return;
    const sc = new TableScene(host.current, view.data.board);
    sceneRef = sc;
    (window as any).bkScene = sc; // отладка
    sc.onHover = setHover;
    sc.onCellClick = (h) => setPinned((p) => (p && p.id === h.id && p.kind === h.kind ? null : h));
    sc.onCard = (e: Extract<GameEvent, { t: 'card' }>) => new Promise<void>((res) => {
      revealResolve = res;
      useStore.setState({ reveal: { deck: e.deck, card: e.card, player: e.player } });
      setTimeout(() => { if (revealResolve === res) closeReveal(); }, useStore.getState().demo ? 2600 : 6000);
    });
    sc.ready.then(() => { const v = useStore.getState().view; if (v) { sc.syncPlayers(v); sc.syncProps(v); } });
    setScene(sc);
    return () => { sc.dispose(); sceneRef = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // проигрывание очереди событий
  useEffect(() => {
    if (!scene || playing.current || !queue.length) return;
    playing.current = true;
    const head = queue[0];
    (async () => {
      await scene.ready;
      await scene.play(head.events, head.state, demo ? 1.4 : 1);
      useStore.getState().shift();
      playing.current = false;
    })();
  }, [scene, queue, demo]);

  // состояние без событий (загрузка/подключение)
  useEffect(() => { if (scene && view && !queue.length) { scene.syncPlayers(view); scene.syncProps(view); } }, [scene, view, queue.length]);

  if (!view) return null;
  const busy = queue.length > 0;
  return (
    <div className="game">
      <div className="canvas-host" ref={host} />
      <div className="vignette" />
      <TopBar />
      <PlayersPanel s={view} />
      <SidePanel s={view} />
      <ActionBar s={view} busy={busy} />
      {!busy && <PromptView s={view} />}
      <CardReveal s={view} />
      {(pinned || hover) && <Tooltip s={view} h={(pinned || hover)!} pinned={!!pinned} onClose={() => setPinned(null)} />}
      <SeatPicker s={view} />
      <TutorCard s={view} busy={busy} />
      <TurnBanner s={view} busy={busy} />
      {demo && <div className="demo-caption glass"><b>Демо {demo.step}/{demo.total}</b> {demo.caption}</div>}
    </div>
  );
}

/** Клиент без фишки (вошёл в идущую партию или переподключился) выбирает свободное место. */
function SeatPicker({ s }: { s: GameState }) {
  const net = useStore((st) => st.net);
  const claim = useStore((st) => st.claim);
  if (net.mode !== 'client' || Object.values(net.seats).includes(net.me ?? '#')) return null;
  const free = s.players.filter((p) => !p.bankrupt && !net.seats[p.id]);
  return (
    <div className="seat-pick glass">
      <b>Выберите свою фишку</b>
      {free.length === 0 && <span className="muted small">Свободных фишек нет — вы смотрите партию. Хост может освободить место в меню «Сеть».</span>}
      <div className="row wrap">
        {free.map((p) => <button key={p.id} className="btn" onClick={() => claim(p.id)}><PawnIcon color={p.color} size={20} />{p.name}</button>)}
      </div>
    </div>
  );
}

/** Короткий баннер при смене хода: «Ваш ход!» или «Ходит Борис». */
function TurnBanner({ s, busy }: { s: GameState; busy: boolean }) {
  const can = useStore((st) => st.can);
  const mode = useStore((st) => st.net.mode);
  const [shown, setShown] = useState<{ key: string; text: string; sub: string; color: string } | null>(null);
  const key = `${s.turn.n}:${s.turn.player}`;
  const last = useRef('');
  useEffect(() => {
    if (busy || s.turn.stage === 'over' || last.current === key) return;
    const first = last.current === '';
    last.current = key;
    if (first && s.turn.n > 1) return; // не мешаем при загрузке партии
    const p = s.players.find((x) => x.id === s.turn.player)!;
    const mine = can(p.id);
    const text = mode === 'local' ? `Ход: ${p.name}` : mine ? 'Ваш ход!' : `Ходит ${p.name}`;
    const sub = mode === 'local' ? 'передайте устройство игроку' : mine ? 'бросайте кубики, когда будете готовы' : 'ждём его решения';
    setShown({ key, text, sub, color: p.color });
    if (mine) sfx.good();
    const t = setTimeout(() => setShown((x) => (x?.key === key ? null : x)), 1900);
    return () => clearTimeout(t);
  }, [key, busy]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return (
    <div className="turn-banner" style={{ ['--c' as any]: shown.color }} key={shown.key}>
      <PawnIcon color={shown.color} size={44} />
      <div><b>{shown.text}</b><span>{shown.sub}</span></div>
    </div>
  );
}
