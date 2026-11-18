import { create } from 'zustand';
import { applyAction, createGame, type Setup } from './engine/engine';
import type { Action, GameData, GameEvent, GameState, PlayerId } from './engine/types';
import { P2PClient, P2PHost, WsClient, WsHost, roomCode, type ClientTransport, type HostTransport, type Lobby, type LobbySeat, type NetMsg, type Seats } from './net/transport';
import { sfx } from './ui/sound';
import { PAWN_PALETTE } from './ui/helpers';

export type Screen = 'menu' | 'setup' | 'game' | 'rules' | 'editor' | 'join' | 'lobby';
export interface ToastT { id: number; text: string; tone: 'good' | 'bad' | 'info' }
export interface SaveMeta { id: string; title: string; updatedAt: number; players: string[]; turn: number }
export type { Lobby, LobbySeat };

interface NetState {
  mode: 'local' | 'host' | 'client';
  kind?: 'ws' | 'p2p';
  code?: string;
  status: 'off' | 'connecting' | 'online' | 'error';
  error?: string;
  me?: string; // id клиента
  seats: Seats; // фишка → кто ею ходит: 'host' | id клиента | null (никто, ждёт переподключения)
  peers: { id: string; name: string }[];
}

/** Настройки партии без игроков — игроки собираются в лобби. */
export type LobbySetup = Omit<Setup, 'players'>;

interface Store {
  screen: Screen;
  data: GameData | null;
  state: GameState | null; // авторитетное
  view: GameState | null; // показанное (после анимаций)
  queue: { state: GameState; events: GameEvent[] }[];
  toasts: ToastT[];
  reveal: { deck: string; card: string; player: PlayerId } | null;
  net: NetState;
  lobby: Lobby | null;
  demo: { on: boolean; caption: string; step: number; total: number } | null;
  error: string | null;
  setScreen(s: Screen): void;
  loadData(): Promise<void>;
  newGame(setup: Setup, seats?: Seats): void;
  loadState(s: GameState, seats?: Seats): void;
  dispatch(a: Action): string | null;
  can(by: PlayerId | 'host'): boolean;
  shift(): void;
  toast(text: string, tone?: ToastT['tone']): void;
  // сеть
  openLobby(kind: 'ws' | 'p2p', setup: LobbySetup | null, resume: GameState | null, hostName?: string): Promise<boolean>;
  lobbyEdit(seat: string, patch: Partial<Pick<LobbySeat, 'name' | 'color' | 'lady'>>): void;
  lobbyAddLocal(): void;
  lobbyRemove(seat: string): void;
  lobbyClaim(seat: string): void;
  lobbySit(): void;
  lobbyStart(): void;
  join(code: string, kind: 'ws' | 'p2p', server: string | null, name: string): Promise<void>;
  claim(seat: PlayerId): void;
  release(seat: PlayerId): void;
  hostSetSeat(seat: PlayerId, owner: 'host' | null): void;
  leave(): void;
  setDemo(d: Store['demo']): void;
}

let hostT: HostTransport | null = null;
let clientT: ClientTransport | null = null;
const peerNames = new Map<string, string>();
let lobbySetup: LobbySetup | null = null;
let heartbeat: any = null; // хост → клиенты: «я жив»
let watchdog: any = null; // клиент: нет вестей от хоста — разрыв
let lastHeard = 0;
let lobbyResume: GameState | null = null;
let tid = 0;

// ---------------------------------------------------------------- сохранения (только у хоста / локальной игры)
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
const autosave = (s: GameState) => {
  if (useStore.getState().net.mode === 'client') return; // у клиента партия не сохраняется
  clearTimeout(saveTimer); saveTimer = setTimeout(() => saves.put(s), 400);
};

// ---------------------------------------------------------------- справочники (с локальными правками ведущего)
const DATA_OVERRIDE = 'bk.data.override';
export const dataStore = {
  override(): Partial<GameData> | null { try { return JSON.parse(localStorage.getItem(DATA_OVERRIDE) || 'null'); } catch { return null; } },
  save(d: GameData) { localStorage.setItem(DATA_OVERRIDE, JSON.stringify(d)); },
  reset() { localStorage.removeItem(DATA_OVERRIDE); },
};

export const myName = () => { try { return localStorage.getItem('bk.name') || ''; } catch { return ''; } };
const freeColor = (seats: LobbySeat[]) => PAWN_PALETTE.find((c) => !seats.some((x) => x.color === c.hex))?.hex ?? '#888888';

export const useStore = create<Store>((set, get) => {
  const pushResult = (state: GameState, events: GameEvent[]) => {
    set((st) => ({ state, queue: [...st.queue, { state, events }] }));
    for (const e of events) if (e.t === 'toast') get().toast(e.text, e.tone);
  };
  const broadcastState = (state: GameState, events: GameEvent[]) => hostT?.broadcast({ t: 'state', state, events, seats: get().net.seats });
  const setSeats = (seats: Seats) => { set((st) => ({ net: { ...st.net, seats } })); hostT?.broadcast({ t: 'seats', seats }); };
  const setLobby = (lobby: Lobby | null) => { set({ lobby }); hostT?.broadcast({ t: 'lobby', lobby }); };
  const peersList = () => [...peerNames].map(([id, name]) => ({ id, name }));

  const hostHandle = (cid: string, m: NetMsg) => {
    const st = get();
    if (m.t === 'hello') {
      peerNames.set(cid, m.name);
      set((s) => ({ net: { ...s.net, peers: peersList() } }));
      // в новой партии каждый вошедший сразу получает свою фишку
      const lobby = st.lobby;
      if (lobby && !lobby.resume && lobby.seats.length < 8) {
        setLobby({ ...lobby, seats: [...lobby.seats, { id: `s${Date.now().toString(36)}${cid.slice(-3)}`, name: m.name || 'Гость', color: freeColor(lobby.seats), lady: false, owner: cid }] });
      }
      hostT!.send(cid, { t: 'welcome', you: cid, state: get().lobby ? null : st.state, seats: st.net.seats, title: st.state?.title ?? lobby?.title ?? '', lobby: get().lobby });
      hostT!.broadcast({ t: 'peers', peers: peersList() });
      get().toast(`${m.name || 'Гость'} подключился`, 'good');
    } else if (m.t === 'seatEdit') {
      const lobby = st.lobby;
      const seat = lobby?.seats.find((x) => x.id === m.seat);
      if (!lobby || !seat || seat.owner !== cid) return;
      if (m.color && lobby.seats.some((x) => x.id !== seat.id && x.color === m.color)) return hostT!.send(cid, { t: 'error', text: 'Этот цвет уже занят' });
      setLobby({ ...lobby, seats: lobby.seats.map((x) => (x.id === seat.id ? { ...x, ...(m.name !== undefined && { name: m.name.slice(0, 24) }), ...(m.color && !lobby.resume && { color: m.color }), ...(m.lady !== undefined && !lobby.resume && { lady: m.lady }) } : x)) });
    } else if (m.t === 'sit') {
      const lobby = st.lobby;
      if (!lobby || lobby.resume || lobby.seats.some((x) => x.owner === cid) || lobby.seats.length >= 8) return;
      setLobby({ ...lobby, seats: [...lobby.seats, { id: `s${Date.now().toString(36)}`, name: peerNames.get(cid) || 'Гость', color: freeColor(lobby.seats), lady: false, owner: cid }] });
    } else if (m.t === 'claim') {
      if (st.lobby) {
        const lobby = st.lobby;
        const seat = lobby.seats.find((x) => x.id === m.seat);
        if (!seat || seat.owner) return hostT!.send(cid, { t: 'error', text: 'Место уже занято' });
        setLobby({ ...lobby, seats: lobby.seats.map((x) => (x.owner === cid ? { ...x, owner: null } : x.id === m.seat ? { ...x, owner: cid } : x)) });
        return;
      }
      const seats = { ...st.net.seats };
      if (seats[m.seat]) return hostT!.send(cid, { t: 'error', text: 'Место уже занято' });
      seats[m.seat] = cid;
      setSeats(seats);
    } else if (m.t === 'release') {
      if (st.lobby) { setLobby({ ...st.lobby, seats: st.lobby.seats.map((x) => (x.id === m.seat && x.owner === cid ? { ...x, owner: null } : x)) }); return; }
      const seats = { ...st.net.seats };
      if (seats[m.seat] === cid) seats[m.seat] = null;
      setSeats(seats);
    } else if (m.t === 'action') {
      const by = (m.action as any).by;
      if (by === 'host' || st.net.seats[by] !== cid) return hostT!.send(cid, { t: 'error', text: 'Это не ваша фишка' });
      const err = get().dispatch(m.action);
      if (err) hostT!.send(cid, { t: 'error', text: err });
    } else if (m.t === 'chat') {
      hostT!.broadcast(m); get().toast(`${m.from}: ${m.text}`, 'info');
    }
  };

  const hostLeave = (cid: string) => {
    const name = peerNames.get(cid);
    peerNames.delete(cid);
    set((st) => ({ net: { ...st.net, peers: peersList() } }));
    const lobby = get().lobby;
    if (lobby) {
      setLobby({ ...lobby, seats: lobby.resume ? lobby.seats.map((x) => (x.owner === cid ? { ...x, owner: null } : x)) : lobby.seats.filter((x) => x.owner !== cid) });
    } else {
      const seats = { ...get().net.seats };
      let had = false;
      for (const k of Object.keys(seats)) if (seats[k] === cid) { seats[k] = null; had = true; }
      setSeats(seats);
      if (had) get().toast(`${name ?? 'Игрок'} отключился — его фишка ждёт переподключения`, 'bad');
      return;
    }
    if (name) get().toast(`${name} вышел`, 'info');
  };

  return {
    screen: 'menu', data: null, state: null, view: null, queue: [], toasts: [], reveal: null, demo: null, error: null, lobby: null,
    net: { mode: 'local', status: 'off', seats: {}, peers: [] },
    setScreen: (screen) => set({ screen }),
    async loadData() {
      const [board, cards] = await Promise.all([fetch('data/board.json').then((r) => r.json()), fetch('data/cards.json').then((r) => r.json())]);
      const ov = dataStore.override();
      set({ data: { board: ov?.board ?? board, cards: ov?.cards ?? cards } });
    },
    newGame(setup, seats) {
      const r = createGame(get().data!, setup);
      const sm: Seats = seats ?? Object.fromEntries(r.state.players.map((p) => [p.id, null]));
      set((st) => ({ state: r.state, view: r.state, queue: [], screen: 'game', net: { ...st.net, seats: sm } }));
      autosave(r.state);
      if (get().net.mode === 'host') broadcastState(r.state, []);
    },
    loadState(s, seats) {
      const sm: Seats = seats ?? Object.fromEntries(s.players.map((p) => [p.id, null]));
      set((st) => ({ state: s, view: s, queue: [], screen: 'game', net: { ...st.net, seats: sm } }));
      if (get().net.mode === 'host') broadcastState(s, []);
    },
    dispatch(a) {
      const st = get();
      if (st.net.mode === 'client') { clientT?.send({ t: 'action', action: a }); return null; }
      if (!st.state) return 'Нет партии';
      const r = applyAction(st.state, a);
      if (r.error) { if (!st.demo) get().toast(r.error, 'bad'); return r.error; }
      pushResult(r.state, r.events);
      autosave(r.state);
      broadcastState(r.state, r.events);
      return null;
    },
    can(by) {
      const { net } = get();
      if (net.mode === 'local') return true;
      if (net.mode === 'host') return by === 'host' || net.seats[by] === 'host';
      return by !== 'host' && !!net.me && net.seats[by] === net.me;
    },
    shift() { set((st) => { const [first, ...rest] = st.queue; return first ? { queue: rest, view: first.state } : {}; }); },
    toast(text, tone = 'info') {
      const id = ++tid;
      set((st) => ({ toasts: [...st.toasts.slice(-4), { id, text, tone }] }));
      if (tone === 'bad') sfx.bad();
      setTimeout(() => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })), 4200);
    },

    // ------------------------------------------------------------ лобби хоста
    async openLobby(kind, setup, resume, hostName) {
      get().leave();
      const code = roomCode();
      set((st) => ({ net: { ...st.net, mode: 'host', kind, code, status: 'connecting', error: undefined, seats: {}, peers: [] }, state: null, view: null, queue: [] }));
      try {
        const attempt = async () => {
          hostT = kind === 'ws' ? new WsHost() : new P2PHost();
          hostT.onMsg = hostHandle;
          hostT.onJoin = () => {};
          hostT.onLeave = hostLeave;
          await hostT.start(code);
        };
        // публичный сигнальный сервер P2P иногда отвечает ошибкой — одна повторная попытка
        try { await attempt(); } catch (e) { if (kind !== 'p2p') throw e; hostT?.close(); await new Promise((r) => setTimeout(r, 1200)); await attempt(); }
        heartbeat = setInterval(() => hostT?.broadcast({ t: 'ping' }), 3000);
      } catch (e: any) {
        hostT = null;
        set((st) => ({ net: { ...st.net, mode: 'local', status: 'error', error: e.message } }));
        get().toast(e.message, 'bad');
        return false;
      }
      lobbySetup = setup;
      lobbyResume = resume;
      const seats: LobbySeat[] = resume
        ? resume.players.filter((p) => !p.bankrupt).map((p) => ({ id: p.id, name: p.name, color: p.color, lady: p.lady, owner: null }))
        : [{ id: 'host', name: hostName || myName() || 'Хост', color: PAWN_PALETTE[0].hex, lady: false, owner: 'host' }];
      set((st) => ({ net: { ...st.net, status: 'online' }, screen: 'lobby' }));
      setLobby({ title: resume?.title ?? setup?.title ?? 'Партия', seats, resume: !!resume });
      return true;
    },
    lobbyEdit(seat, patch) {
      const { lobby, net } = get();
      if (net.mode === 'client') { clientT?.send({ t: 'seatEdit', seat, ...patch }); return; }
      if (!lobby) return;
      const s = lobby.seats.find((x) => x.id === seat);
      if (!s || (s.owner !== 'host')) return;
      if (patch.color && lobby.seats.some((x) => x.id !== seat && x.color === patch.color)) return;
      if (lobby.resume) { patch = { name: patch.name }; if (patch.name === undefined) return; }
      setLobby({ ...lobby, seats: lobby.seats.map((x) => (x.id === seat ? { ...x, ...patch } : x)) });
    },
    lobbyAddLocal() {
      const { lobby } = get();
      if (!lobby || lobby.resume || lobby.seats.length >= 8) return;
      setLobby({ ...lobby, seats: [...lobby.seats, { id: `l${Date.now().toString(36)}`, name: `Игрок ${lobby.seats.length + 1}`, color: freeColor(lobby.seats), lady: false, owner: 'host' }] });
    },
    lobbyRemove(seat) {
      const { lobby } = get();
      if (!lobby || lobby.resume || seat === 'host') return;
      setLobby({ ...lobby, seats: lobby.seats.filter((x) => x.id !== seat) });
    },
    lobbyClaim(seat) {
      const { lobby, net } = get();
      if (net.mode === 'client') { clientT?.send({ t: 'claim', seat }); return; }
      if (!lobby) return;
      setLobby({ ...lobby, seats: lobby.seats.map((x) => (x.id === seat ? { ...x, owner: x.owner === 'host' ? null : x.owner ?? 'host' } : x)) });
    },
    lobbySit() { clientT?.send({ t: 'sit' }); },
    lobbyStart() {
      const { lobby } = get();
      if (!lobby || lobby.seats.length < 2) return;
      // свободные места ведёт хост, пока друг не займёт их снова
      if (lobby.resume && lobbyResume) {
        const sm: Seats = Object.fromEntries(lobbyResume.players.map((p) => [p.id, lobby.seats.find((x) => x.id === p.id)?.owner ?? null]));
        const s = structuredClone(lobbyResume);
        for (const seat of lobby.seats) { const p = s.players.find((x) => x.id === seat.id); if (p) p.name = seat.name; }
        setLobby(null);
        get().loadState(s, sm);
        return;
      }
      const setup = lobbySetup!;
      const players = lobby.seats.map((x) => ({ name: x.name, color: x.color, avatar: '', lady: x.lady }));
      const sm: Seats = Object.fromEntries(lobby.seats.map((x, i) => [`p${i + 1}`, x.owner]));
      setLobby(null);
      get().newGame({ ...setup, title: lobby.title, players }, sm);
    },

    // ------------------------------------------------------------ клиент
    async join(code, kind, server, name) {
      get().leave();
      set((st) => ({ net: { ...st.net, mode: 'client', kind, code, status: 'connecting', error: undefined } }));
      try {
        clientT = kind === 'ws' ? new WsClient(code.toUpperCase(), server) : new P2PClient(code.toUpperCase());
        const me = clientT;
        const drop = (why: string) => {
          if (clientT !== me) return; // уже вышли сами
          get().leave();
          set({ state: null, view: null, queue: [], lobby: null, reveal: null, screen: 'menu' });
          get().toast(why, 'bad');
        };
        lastHeard = Date.now();
        watchdog = setInterval(() => { if (get().net.status === 'online' && Date.now() - lastHeard > 10000) drop('Связь с хостом потеряна'); }, 2000);
        clientT.onMsg = (m) => {
          lastHeard = Date.now();
          if (m.t === 'ping') return;
          if (m.t === 'bye') return drop('Хост завершил игру');
          if (m.t === 'welcome') set((st) => ({ net: { ...st.net, me: m.you, seats: m.seats, status: 'online' }, lobby: m.lobby, state: m.state, view: m.state, queue: [], screen: m.lobby ? 'lobby' : m.state ? 'game' : st.screen }));
          else if (m.t === 'lobby') set((st) => ({ lobby: m.lobby, screen: m.lobby ? 'lobby' : st.screen }));
          else if (m.t === 'state') { set((st) => ({ net: { ...st.net, seats: m.seats }, screen: 'game' })); pushResult(m.state, m.events); }
          else if (m.t === 'seats') set((st) => ({ net: { ...st.net, seats: m.seats } }));
          else if (m.t === 'peers') set((st) => ({ net: { ...st.net, peers: m.peers } }));
          else if (m.t === 'error') get().toast(m.text, 'bad');
          else if (m.t === 'chat') get().toast(`${m.from}: ${m.text}`, 'info');
        };
        clientT.onClose = () => drop('Соединение с хостом потеряно');
        await clientT.connect();
        clientT.send({ t: 'hello', name });
      } catch (e: any) {
        clearInterval(watchdog); watchdog = null;
        clientT = null;
        set((st) => ({ net: { ...st.net, mode: 'local', status: 'error', error: e.message } }));
      }
    },
    claim(seat) { clientT?.send({ t: 'claim', seat }); },
    release(seat) { clientT?.send({ t: 'release', seat }); },
    hostSetSeat(seat, owner) {
      const seats = { ...get().net.seats };
      if (owner === 'host' && seats[seat] && seats[seat] !== 'host') return;
      seats[seat] = owner;
      setSeats(seats);
    },
    leave() {
      try { hostT?.broadcast({ t: 'bye' }); } catch { /* */ }
      clearInterval(heartbeat); clearInterval(watchdog); heartbeat = watchdog = null;
      const h = hostT, c = clientT;
      hostT = null; clientT = null; peerNames.clear();
      setTimeout(() => { h?.close(); c?.close(); }, 150); // даём «bye» уйти
      lobbySetup = null; lobbyResume = null;
      set((st) => ({ lobby: null, net: { mode: 'local', status: 'off', seats: Object.fromEntries(Object.keys(st.net.seats).map((k) => [k, null])), peers: [] } }));
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
