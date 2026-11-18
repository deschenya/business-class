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
  status: 'off' | 'connecting' | 'online' | 'error' | 'reconnecting' | 'lost';
  reconnect?: { attempt: number; max: number };
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
  retryReconnect(): void;
  abandon(why?: string): void;
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
// переподключение: у устройства постоянный токен, хост помнит, какая фишка за каким токеном
const cidToken = new Map<string, string>(); // клиент → токен устройства
const reserved = new Map<string, string>(); // токен → фишка в партии
/** Привязка «устройство → фишка» хранится у хоста вместе с партией (для возврата после перезапуска хоста). */
const persistReserved = (gameId?: string) => { if (gameId) try { localStorage.setItem(`bk.seatTokens.${gameId}`, JSON.stringify([...reserved])); } catch { /* */ } };
const loadReserved = (gameId: string): [string, string][] => { try { return JSON.parse(localStorage.getItem(`bk.seatTokens.${gameId}`) || '[]'); } catch { return []; } };
let reconnectTimer: any = null;
let clientOpts: { code: string; kind: 'ws' | 'p2p'; server: string | null; name: string } | null = null;
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* */ } };
export const deviceToken = (() => { let t = lsGet('bk.clientToken'); if (!t) { t = Math.random().toString(36).slice(2) + Date.now().toString(36); lsSet('bk.clientToken', t); } return t; })();
export interface LastRoom { code: string; kind: 'ws' | 'p2p'; server: string | null; name: string; at: number }
export const lastRoom = (): LastRoom | null => { try { const r = JSON.parse(lsGet('bk.lastRoom') || 'null'); return r && Date.now() - r.at < 12 * 3600e3 ? r : null; } catch { return null; } };
/** Код комнаты закреплён за сохранённой партией — друзья вернутся по тому же коду. */
export const roomCodes = {
  get: (id: string): { code: string; kind: 'ws' | 'p2p' } | undefined => { try { const v = JSON.parse(lsGet('bk.roomCodes') || '{}')[id]; return typeof v === 'string' ? { code: v, kind: 'p2p' } : v; } catch { return undefined; } },
  set: (id: string, code: string, kind: 'ws' | 'p2p') => { try { const m = JSON.parse(lsGet('bk.roomCodes') || '{}'); m[id] = { code, kind }; lsSet('bk.roomCodes', JSON.stringify(m)); } catch { /* */ } },
};
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
      if (m.token) cidToken.set(cid, m.token);
      set((s) => ({ net: { ...s.net, peers: peersList() } }));
      const lobby = st.lobby;
      let back = false;
      if (lobby) {
        // вернулся тот же игрок — отдаём его место; иначе в новой партии создаём новое
        const mineSeat = m.token ? lobby.seats.find((x) => x.token === m.token && !x.owner) : undefined;
        if (mineSeat) { back = true; setLobby({ ...lobby, seats: lobby.seats.map((x) => (x.id === mineSeat.id ? { ...x, owner: cid } : x)) }); }
        else if (!lobby.resume && lobby.seats.length < 8) setLobby({ ...lobby, seats: [...lobby.seats, { id: `s${Date.now().toString(36)}${cid.slice(-3)}`, name: m.name || 'Гость', color: freeColor(lobby.seats), lady: false, owner: cid, token: m.token }] });
      } else if (m.token && reserved.has(m.token)) {
        const pid = reserved.get(m.token)!;
        if (!st.net.seats[pid]) { back = true; setSeats({ ...get().net.seats, [pid]: cid }); }
      }
      hostT!.send(cid, { t: 'welcome', you: cid, state: get().lobby ? null : get().state, seats: get().net.seats, title: st.state?.title ?? lobby?.title ?? '', lobby: get().lobby });
      hostT!.broadcast({ t: 'peers', peers: peersList() });
      get().toast(back ? `${m.name || 'Гость'} вернулся за стол` : `${m.name || 'Гость'} подключился`, 'good');
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
        setLobby({ ...lobby, seats: lobby.seats.map((x) => (x.owner === cid ? { ...x, owner: null } : x.id === m.seat ? { ...x, owner: cid, token: cidToken.get(cid) } : x)) });
        return;
      }
      const seats = { ...st.net.seats };
      if (seats[m.seat]) return hostT!.send(cid, { t: 'error', text: 'Место уже занято' });
      seats[m.seat] = cid;
      const tk = cidToken.get(cid);
      if (tk) { reserved.set(tk, m.seat); persistReserved(st.state?.id); }
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
      // место остаётся за игроком — вернётся с того же устройства и займёт его снова (хост может убрать ✕)
      setLobby({ ...lobby, seats: lobby.seats.map((x) => (x.owner === cid ? { ...x, owner: null } : x)) });
    } else {
      const seats = { ...get().net.seats };
      let had = false;
      for (const k of Object.keys(seats)) if (seats[k] === cid) { seats[k] = null; had = true; }
      setSeats(seats);
      if (had) get().toast(`${name ?? 'Игрок'} отключился — его фишка ждёт переподключения`, 'bad');
      return;
    }
    if (name) get().toast(`${name} отключился — место ждёт его`, 'info');
  };

  /** Подключение клиента. Разрешается, когда хост прислал welcome. */
  const connectClient = (reconnecting: boolean) => new Promise<void>((resolve, reject) => {
    const o = clientOpts!;
    const t = o.kind === 'ws' ? new WsClient(o.code, o.server) : new P2PClient(o.code);
    clientT = t;
    let welcomed = false;
    const timeout = setTimeout(() => { if (!welcomed) { cleanup(); reject(new Error('Хост не отвечает')); } }, 20000);
    const cleanup = () => { clearTimeout(timeout); if (clientT === t) clientT = null; try { t.close(); } catch { /* */ } };
    const lost = () => {
      if (clientT !== t) return; // ушли сами
      if (!welcomed) { cleanup(); reject(new Error('Соединение прервалось')); return; }
      clearInterval(watchdog); watchdog = null;
      clientT = null; try { t.close(); } catch { /* */ }
      startReconnect();
    };
    t.onMsg = (m) => {
      lastHeard = Date.now();
      if (m.t === 'ping') return;
      if (m.t === 'bye') { if (clientT === t) get().abandon('Хост завершил игру'); return; }
      if (m.t === 'welcome') {
        welcomed = true; clearTimeout(timeout);
        set((st) => ({ net: { ...st.net, me: m.you, seats: m.seats, status: 'online', reconnect: undefined, error: undefined }, lobby: m.lobby, state: m.state, view: m.state, queue: [], screen: m.lobby ? 'lobby' : m.state ? 'game' : st.screen }));
        if (reconnecting) get().toast('Связь восстановлена', 'good');
        clearInterval(watchdog);
        watchdog = setInterval(() => { if (get().net.status === 'online' && Date.now() - lastHeard > 10000) lost(); }, 2000);
        resolve();
      } else if (m.t === 'lobby') set((st) => ({ lobby: m.lobby, screen: m.lobby ? 'lobby' : st.screen }));
      else if (m.t === 'state') { set((st) => ({ net: { ...st.net, seats: m.seats }, screen: 'game' })); pushResult(m.state, m.events); }
      else if (m.t === 'seats') set((st) => ({ net: { ...st.net, seats: m.seats } }));
      else if (m.t === 'peers') set((st) => ({ net: { ...st.net, peers: m.peers } }));
      else if (m.t === 'error') get().toast(m.text, 'bad');
      else if (m.t === 'chat') get().toast(`${m.from}: ${m.text}`, 'info');
    };
    t.onClose = lost;
    t.connect().then(() => { lastHeard = Date.now(); t.send({ t: 'hello', name: o.name, token: deviceToken }); }, (e) => { cleanup(); reject(e); });
  });

  /** Связь с хостом оборвалась (не по его воле): несколько попыток с паузами, игра остаётся на экране. */
  const DELAYS = [1000, 2000, 3000, 5000, 8000, 10000, 15000, 15000, 20000, 20000, 20000]; // ≈ 2 минуты
  const startReconnect = () => {
    if (!clientOpts) return;
    clearTimeout(reconnectTimer);
    let attempt = 0;
    const tryOnce = async () => {
      if (get().net.mode !== 'client') return;
      attempt++;
      set((st) => ({ net: { ...st.net, status: 'reconnecting', reconnect: { attempt, max: DELAYS.length } } }));
      try { await connectClient(true); }
      catch (e: any) {
        if (get().net.mode !== 'client') return;
        if (attempt >= DELAYS.length) { get().abandon('Хост недоступен. Вернуться можно кнопкой «Вернуться в комнату» в меню'); return; }
        reconnectTimer = setTimeout(tryOnce, DELAYS[attempt]);
      }
    };
    set((st) => ({ net: { ...st.net, status: 'reconnecting', reconnect: { attempt: 0, max: DELAYS.length } } }));
    reconnectTimer = setTimeout(tryOnce, DELAYS[0]);
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
      if (get().net.mode === 'host' && get().net.code) { roomCodes.set(r.state.id, get().net.code!, get().net.kind ?? 'p2p'); persistReserved(r.state.id); }
      if (get().net.mode === 'host') broadcastState(r.state, []);
    },
    loadState(s, seats) {
      const sm: Seats = seats ?? Object.fromEntries(s.players.map((p) => [p.id, null]));
      set((st) => ({ state: s, view: s, queue: [], screen: 'game', net: { ...st.net, seats: sm } }));
      if (get().net.mode === 'host') { broadcastState(s, []); if (get().net.code) roomCodes.set(s.id, get().net.code!, get().net.kind ?? 'p2p'); persistReserved(s.id); }
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
      const prev = resume ? roomCodes.get(resume.id) : undefined;
      let code = (prev && prev.kind === kind && prev.code) || roomCode();
      set((st) => ({ net: { ...st.net, mode: 'host', kind, code, status: 'connecting', error: undefined, seats: {}, peers: [] }, state: null, view: null, queue: [] }));
      cidToken.clear(); reserved.clear();
      try {
        const attempt = async () => {
          hostT = kind === 'ws' ? new WsHost() : new P2PHost();
          hostT.onMsg = hostHandle;
          hostT.onJoin = () => {};
          hostT.onLeave = hostLeave;
          await hostT.start(code);
        };
        // сигнальный сервер P2P иногда отвечает ошибкой; прежний код комнаты может быть ещё занят
        // старым подключением хоста — несколько попыток, затем новый код
        for (let n = 0; ; n++) {
          try { await attempt(); break; } catch (e: any) {
            hostT?.close();
            if (kind !== 'p2p') throw e;
            // код ещё держит прежнее (оборвавшееся) подключение хоста — ждём до ~1 минуты, затем новый код
            if (e?.code === 'unavailable-id') {
              if (n >= 12) { code = roomCode(); set((st) => ({ net: { ...st.net, code } })); get().toast(`Прежний код занят — новый код комнаты: ${code}`, 'info'); }
              else { set((st) => ({ net: { ...st.net, status: 'connecting', error: 'Ждём, пока освободится прежний код комнаты…' } })); await new Promise((r) => setTimeout(r, 5000)); continue; }
            }
            if (n >= 16) throw e;
            await new Promise((r) => setTimeout(r, 1500 * Math.min(n + 1, 4)));
          }
        }
        heartbeat = setInterval(() => hostT?.broadcast({ t: 'ping' }), 3000);
      } catch (e: any) {
        hostT = null;
        set((st) => ({ net: { ...st.net, mode: 'local', status: 'error', error: e.message } }));
        get().toast(e.message, 'bad');
        return false;
      }
      lobbySetup = setup;
      lobbyResume = resume;
      const saved = new Map(resume ? loadReserved(resume.id).map(([tk, pid]) => [pid, tk]) : []);
      const seats: LobbySeat[] = resume
        ? resume.players.filter((p) => !p.bankrupt).map((p) => ({ id: p.id, name: p.name, color: p.color, lady: p.lady, owner: null, token: saved.get(p.id) }))
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
      for (const [i, x] of lobby.seats.entries()) if (x.token) reserved.set(x.token, lobby.resume ? x.id : `p${i + 1}`);
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
      clientOpts = { code: code.toUpperCase(), kind, server, name };
      set((st) => ({ net: { ...st.net, mode: 'client', kind, code: clientOpts!.code, status: 'connecting', error: undefined } }));
      try {
        await connectClient(false);
        lsSet('bk.lastRoom', JSON.stringify({ ...clientOpts, at: Date.now() }));
      } catch (e: any) {
        set((st) => ({ net: { ...st.net, mode: 'local', status: 'error', error: e.message } }));
      }
    },
    retryReconnect() { startReconnect(); },
    abandon(why) {
      clearTimeout(reconnectTimer);
      get().leave();
      set({ state: null, view: null, queue: [], lobby: null, reveal: null, screen: 'menu' });
      if (why) get().toast(why, 'bad');
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
      clearInterval(heartbeat); clearInterval(watchdog); clearTimeout(reconnectTimer); heartbeat = watchdog = null;
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

/** Отладка: имитировать внезапный обрыв связи у клиента (без «bye» от хоста). */
export const __simulateDrop = () => (clientT as any)?.onClose?.();
/** Отладка: состояние P2P-подключения хоста. */
export const __hostPeer = () => { const p = (hostT as any)?.peer; return p ? { id: p.id, open: p.open, disconnected: p.disconnected, destroyed: p.destroyed, conns: (hostT as any).conns?.size } : null; };
