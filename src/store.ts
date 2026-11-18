import { create } from 'zustand';
import { applyAction, createGame, type Setup } from './engine/engine';
import type { Action, GameData, GameEvent, GameState, PlayerId } from './engine/types';
import { P2PClient, P2PHost, WsClient, WsHost, roomCode, type ClientTransport, type HostTransport, type NetMsg, type Seats } from './net/transport';
import { sfx } from './ui/sound';

export type Screen = 'menu' | 'setup' | 'game' | 'rules' | 'editor' | 'join';
export interface ToastT { id: number; text: string; tone: 'good' | 'bad' | 'info' }
export interface SaveMeta { id: string; title: string; updatedAt: number; players: string[]; turn: number }

interface NetState {
  mode: 'local' | 'host' | 'client';
  kind?: 'ws' | 'p2p';
  code?: string;
  status: 'off' | 'connecting' | 'online' | 'error';
  error?: string;
  me?: string; // id клиента
  seats: Seats;
  peers: { id: string; name: string }[];
}

interface Store {
  screen: Screen;
  data: GameData | null;
  state: GameState | null; // авторитетное
  view: GameState | null; // показанное (после анимаций)
  queue: { state: GameState; events: GameEvent[] }[];
  toasts: ToastT[];
  reveal: { deck: string; card: string; player: PlayerId } | null;
  net: NetState;
  demo: { on: boolean; caption: string; step: number; total: number } | null;
  error: string | null;
  setScreen(s: Screen): void;
  loadData(): Promise<void>;
  newGame(setup: Setup): void;
  loadState(s: GameState): void;
  dispatch(a: Action): string | null;
  can(by: PlayerId | 'host'): boolean;
  shift(): void;
  toast(text: string, tone?: ToastT['tone']): void;
  hostOnline(kind: 'ws' | 'p2p'): Promise<void>;
  join(code: string, kind: 'ws' | 'p2p', server: string | null, name: string): Promise<void>;
  claim(seat: PlayerId): void;
  release(seat: PlayerId): void;
  leave(): void;
  setDemo(d: Store['demo']): void;
}

let hostT: HostTransport | null = null;
let clientT: ClientTransport | null = null;
const peerNames = new Map<string, string>();
let tid = 0;

// ---------------------------------------------------------------- сохранения
const SAVE_INDEX = 'bk.saves';
export const saves = {
  list(): SaveMeta[] { try { return JSON.parse(localStorage.getItem(SAVE_INDEX) || '[]'); } catch { return []; } },
  put(s: GameState) {
    try {
      localStorage.setItem(`bk.save.${s.id}`, JSON.stringify(s));
      const meta: SaveMeta = { id: s.id, title: s.title, updatedAt: s.updatedAt, players: s.players.map((p) => p.name), turn: s.turn.n };
      const l = saves.list().filter((x) => x.id !== s.id);
      l.unshift(meta);
      localStorage.setItem(SAVE_INDEX, JSON.stringify(l.slice(0, 30)));
    } catch (e) { console.warn('save failed', e); }
  },
  get(id: string): GameState | null { try { return JSON.parse(localStorage.getItem(`bk.save.${id}`) || 'null'); } catch { return null; } },
  remove(id: string) { try { localStorage.removeItem(`bk.save.${id}`); localStorage.setItem(SAVE_INDEX, JSON.stringify(saves.list().filter((x) => x.id !== id))); } catch { /* */ } },
};
let saveTimer: any = null;
const autosave = (s: GameState) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saves.put(s), 400); };

// ---------------------------------------------------------------- справочники (с локальными правками ведущего)
const DATA_OVERRIDE = 'bk.data.override';
export const dataStore = {
  override(): Partial<GameData> | null { try { return JSON.parse(localStorage.getItem(DATA_OVERRIDE) || 'null'); } catch { return null; } },
  save(d: GameData) { localStorage.setItem(DATA_OVERRIDE, JSON.stringify(d)); },
  reset() { localStorage.removeItem(DATA_OVERRIDE); },
};

export const useStore = create<Store>((set, get) => {
  const pushResult = (state: GameState, events: GameEvent[]) => {
    set((st) => ({ state, queue: [...st.queue, { state, events }] }));
    for (const e of events) {
      if (e.t === 'toast') get().toast(e.text, e.tone);
    }
  };
  const broadcastState = (state: GameState, events: GameEvent[]) => hostT?.broadcast({ t: 'state', state, events, seats: get().net.seats });
  const setSeats = (seats: Seats) => { set((st) => ({ net: { ...st.net, seats } })); hostT?.broadcast({ t: 'seats', seats }); };

  const hostHandle = (cid: string, m: NetMsg) => {
    const st = get();
    if (m.t === 'hello') {
      peerNames.set(cid, m.name);
      const peers = [...peerNames].map(([id, name]) => ({ id, name }));
      set((s) => ({ net: { ...s.net, peers } }));
      hostT!.send(cid, { t: 'welcome', you: cid, state: st.state, seats: st.net.seats, title: st.state?.title ?? '' });
      hostT!.broadcast({ t: 'peers', peers });
      get().toast(`${m.name} подключился`, 'good');
    } else if (m.t === 'claim') {
      const seats = { ...st.net.seats };
      if (seats[m.seat] && seats[m.seat] !== 'host') return hostT!.send(cid, { t: 'error', text: 'Место уже занято' });
      for (const k of Object.keys(seats)) if (seats[k] === cid) seats[k] = null;
      seats[m.seat] = cid;
      setSeats(seats);
    } else if (m.t === 'release') {
      const seats = { ...st.net.seats };
      if (seats[m.seat] === cid) seats[m.seat] = null;
      setSeats(seats);
    } else if (m.t === 'action') {
      const by = (m.action as any).by;
      if (by === 'host' || st.net.seats[by] !== cid) return hostT!.send(cid, { t: 'error', text: 'Это место управляется другим участником' });
      const err = get().dispatch(m.action);
      if (err) hostT!.send(cid, { t: 'error', text: err });
    } else if (m.t === 'chat') {
      hostT!.broadcast(m); get().toast(`${m.from}: ${m.text}`, 'info');
    }
  };

  return {
    screen: 'menu', data: null, state: null, view: null, queue: [], toasts: [], reveal: null, demo: null, error: null,
    net: { mode: 'local', status: 'off', seats: {}, peers: [] },
    setScreen: (screen) => set({ screen }),
    async loadData() {
      const [board, cards] = await Promise.all([fetch('data/board.json').then((r) => r.json()), fetch('data/cards.json').then((r) => r.json())]);
      const ov = dataStore.override();
      set({ data: { board: ov?.board ?? board, cards: ov?.cards ?? cards } });
    },
    newGame(setup) {
      const r = createGame(get().data!, setup);
      const seats: Seats = Object.fromEntries(r.state.players.map((p) => [p.id, null]));
      set((st) => ({ state: r.state, view: r.state, queue: [], screen: 'game', net: { ...st.net, seats: st.net.mode === 'host' ? seats : seats } }));
      autosave(r.state);
      if (get().net.mode === 'host') broadcastState(r.state, []);
    },
    loadState(s) {
      const seats: Seats = Object.fromEntries(s.players.map((p) => [p.id, null]));
      set((st) => ({ state: s, view: s, queue: [], screen: 'game', net: { ...st.net, seats } }));
      if (get().net.mode === 'host') broadcastState(s, []);
    },
    dispatch(a) {
      const st = get();
      if (st.net.mode === 'client') {
        clientT?.send({ t: 'action', action: a });
        return null;
      }
      if (!st.state) return 'Нет партии';
      const r = applyAction(st.state, a);
      if (r.error) { if (!st.demo) { get().toast(r.error, 'bad'); } return r.error; }
      pushResult(r.state, r.events);
      autosave(r.state);
      broadcastState(r.state, r.events);
      return null;
    },
    can(by) {
      const { net } = get();
      if (net.mode === 'local') return true;
      if (net.mode === 'host') return by === 'host' || !net.seats[by] || net.seats[by] === 'host';
      return by !== 'host' && net.seats[by] === net.me;
    },
    shift() { set((st) => { const [first, ...rest] = st.queue; return first ? { queue: rest, view: first.state } : {}; }); },
    toast(text, tone = 'info') {
      const id = ++tid;
      set((st) => ({ toasts: [...st.toasts.slice(-4), { id, text, tone }] }));
      if (tone === 'bad') sfx.bad();
      setTimeout(() => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })), 4200);
    },
    async hostOnline(kind) {
      const code = roomCode();
      set((st) => ({ net: { ...st.net, mode: 'host', kind, code, status: 'connecting', error: undefined } }));
      try {
        hostT = kind === 'ws' ? new WsHost() : new P2PHost();
        hostT.onMsg = hostHandle;
        hostT.onJoin = () => {};
        hostT.onLeave = (cid) => {
          const name = peerNames.get(cid); peerNames.delete(cid);
          const seats = { ...get().net.seats };
          for (const k of Object.keys(seats)) if (seats[k] === cid) seats[k] = null;
          set((st) => ({ net: { ...st.net, peers: [...peerNames].map(([id, n]) => ({ id, name: n })) } }));
          setSeats(seats);
          if (name) get().toast(`${name} отключился`, 'info');
        };
        await hostT.start(code);
        set((st) => ({ net: { ...st.net, status: 'online' } }));
        const s = get().state;
        if (s) broadcastState(s, []);
      } catch (e: any) {
        hostT = null;
        set((st) => ({ net: { ...st.net, mode: 'local', status: 'error', error: e.message } }));
      }
    },
    async join(code, kind, server, name) {
      set((st) => ({ net: { ...st.net, mode: 'client', kind, code, status: 'connecting', error: undefined } }));
      try {
        clientT = kind === 'ws' ? new WsClient(code.toUpperCase(), server) : new P2PClient(code.toUpperCase());
        clientT.onMsg = (m) => {
          if (m.t === 'welcome') { set((st) => ({ net: { ...st.net, me: m.you, seats: m.seats, status: 'online' }, state: m.state, view: m.state, queue: [], screen: m.state ? 'game' : st.screen })); }
          else if (m.t === 'state') { set((st) => ({ net: { ...st.net, seats: m.seats }, screen: 'game' })); pushResult(m.state, m.events); }
          else if (m.t === 'seats') set((st) => ({ net: { ...st.net, seats: m.seats } }));
          else if (m.t === 'peers') set((st) => ({ net: { ...st.net, peers: m.peers } }));
          else if (m.t === 'error') get().toast(m.text, 'bad');
          else if (m.t === 'chat') get().toast(`${m.from}: ${m.text}`, 'info');
        };
        clientT.onClose = () => { set((st) => ({ net: { ...st.net, status: 'error', error: 'Соединение с хостом потеряно' } })); get().toast('Соединение с хостом потеряно', 'bad'); };
        await clientT.connect();
        clientT.send({ t: 'hello', name });
      } catch (e: any) {
        clientT = null;
        set((st) => ({ net: { ...st.net, mode: 'local', status: 'error', error: e.message } }));
      }
    },
    claim(seat) { clientT?.send({ t: 'claim', seat }); },
    release(seat) { clientT?.send({ t: 'release', seat }); },
    leave() {
      hostT?.close(); clientT?.close(); hostT = null; clientT = null; peerNames.clear();
      set((st) => ({ net: { mode: 'local', status: 'off', seats: Object.fromEntries(Object.keys(st.net.seats).map((k) => [k, null])), peers: [] } }));
    },
    setDemo(demo) { set({ demo }); },
  };
});

/** Есть ли рядом локальный сервер (npm run host). На GitHub Pages его нет — работает только P2P. */
let lanCache: Promise<boolean> | null = null;
export const hasLanServer = () => (lanCache ??= fetch('api/info').then((r) => r.ok && (r.headers.get('content-type') ?? '').includes('json')).catch(() => false));

export const sendChat = (from: string, text: string) => {
  const m: NetMsg = { t: 'chat', from, text };
  if (hostT) { hostT.broadcast(m); useStore.getState().toast(`${from}: ${text}`); }
  else clientT?.send(m);
};
