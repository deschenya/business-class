// Транспорт мультиплеера. Хост авторитетен: держит состояние и применяет действия,
// клиенты присылают намерения и получают готовое состояние.
// Два варианта: локальный сервер (WebSocket-ретранслятор, LAN или туннель) и P2P (WebRTC через PeerJS).
import type { Action, GameEvent, GameState, PlayerId } from '../engine/types';

export type Seats = Record<PlayerId, string | null>; // контролёр места: 'host' | id клиента | null

/** Место в лобби. owner: 'host' | id клиента | null (свободно). */
export interface LobbySeat { id: string; name: string; color: string; lady: boolean; owner: string | null; token?: string }
export interface Lobby { title: string; seats: LobbySeat[]; resume: boolean }
export type NetMsg =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'welcome'; you: string; state: GameState | null; seats: Seats; title: string; lobby: Lobby | null }
  | { t: 'lobby'; lobby: Lobby | null }
  | { t: 'seatEdit'; seat: string; name?: string; color?: string; lady?: boolean }
  | { t: 'sit' }
  | { t: 'ping' }
  | { t: 'bye' }
  | { t: 'state'; state: GameState; events: GameEvent[]; seats: Seats }
  | { t: 'action'; action: Action }
  | { t: 'claim'; seat: PlayerId }
  | { t: 'release'; seat: PlayerId }
  | { t: 'seats'; seats: Seats }
  | { t: 'error'; text: string }
  | { t: 'chat'; from: string; text: string }
  | { t: 'peers'; peers: { id: string; name: string }[] };

export interface HostTransport {
  kind: 'ws' | 'p2p';
  start(code: string): Promise<void>;
  send(cid: string, m: NetMsg): void;
  broadcast(m: NetMsg): void;
  onJoin: (cid: string) => void;
  onLeave: (cid: string) => void;
  onMsg: (cid: string, m: NetMsg) => void;
  close(): void;
}
export interface ClientTransport {
  connect(): Promise<void>;
  send(m: NetMsg): void;
  onMsg: (m: NetMsg) => void;
  onClose: () => void;
  close(): void;
}

const wsUrl = (base: string | null, q: string) => {
  if (base) { const u = new URL(base.includes('://') ? base : `http://${base}`); return `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}/ws?${q}`; }
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?${q}`;
};

export class WsHost implements HostTransport {
  kind = 'ws' as const;
  ws!: WebSocket;
  onJoin = (_: string) => {};
  onLeave = (_: string) => {};
  onMsg = (_: string, __: NetMsg) => {};
  start(code: string) {
    return new Promise<void>((res, rej) => {
      this.ws = new WebSocket(wsUrl(null, `room=${code}&role=host`));
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('Локальный сервер недоступен. Запустите «npm run host» и откройте игру с адреса сервера.'));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === '_join') this.onJoin(m.cid);
        else if (m.t === '_leave') this.onLeave(m.cid);
        else if (m.t === '_from') this.onMsg(m.cid, m.msg);
      };
    });
  }
  send(cid: string, m: NetMsg) { this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ t: '_to', cid, msg: m })); }
  broadcast(m: NetMsg) { this.ws?.readyState === 1 && this.ws.send(JSON.stringify({ t: '_all', msg: m })); }
  close() { this.ws?.close(); }
}

export class WsClient implements ClientTransport {
  ws!: WebSocket;
  private closed = false;
  onMsg = (_: NetMsg) => {};
  onClose = () => {};
  constructor(private code: string, private server: string | null) {}
  connect() {
    return new Promise<void>((res, rej) => {
      this.ws = new WebSocket(wsUrl(this.server, `room=${this.code}&role=client`));
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('Не удалось подключиться к хосту'));
      this.ws.onclose = () => { if (!this.closed) { this.closed = true; this.onClose(); } };
      this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === '_error') { rej(new Error(m.text)); return; } this.onMsg(m); };
    });
  }
  send(m: NetMsg) { this.ws?.readyState === 1 && this.ws.send(JSON.stringify(m)); }
  close() { this.closed = true; this.ws?.close(); }
}

// ---------------------------------------------------------------- P2P (WebRTC)
const PEER_PREFIX = 'bizclass-3d-';
/** Понятные сообщения вместо кодов ошибок PeerJS. */
export function p2pError(e: any): Error & { code?: string } {
  const t = e?.type ?? '';
  const text: Record<string, string> = {
    'network': 'Нет связи с сервером соединения. Проверьте интернет и попробуйте ещё раз.',
    'server-error': 'Сервер соединения временно недоступен. Попробуйте ещё раз.',
    'socket-error': 'Сервер соединения временно недоступен. Попробуйте ещё раз.',
    'socket-closed': 'Связь с сервером соединения прервалась.',
    'peer-unavailable': 'Комната не найдена: хост ещё не открыл её или уже закрыл.',
    'unavailable-id': 'Этот код комнаты сейчас занят.',
    'browser-incompatible': 'Браузер не поддерживает прямое соединение (WebRTC).',
    'webrtc': 'Не удалось установить прямое соединение между браузерами.',
  };
  const err = new Error(text[t] ?? `Ошибка соединения${t ? ` (${t})` : ''}`) as Error & { code?: string };
  err.code = t;
  return err;
}
/** Держим связь с сигнальным сервером: при обрыве переподключаемся сами. */
function keepAlive(peer: any) {
  let tries = 0;
  peer.on('disconnected', () => {
    if (peer.destroyed || tries > 20) return;
    tries++;
    setTimeout(() => { if (!peer.destroyed && peer.disconnected) try { peer.reconnect(); } catch { /* */ } }, Math.min(1000 * tries, 8000));
  });
  peer.on('open', () => { tries = 0; });
}

export class P2PHost implements HostTransport {
  kind = 'p2p' as const;
  peer: any;
  conns = new Map<string, any>();
  onJoin = (_: string) => {};
  onLeave = (_: string) => {};
  onMsg = (_: string, __: NetMsg) => {};
  async start(code: string) {
    const { Peer } = await import('peerjs');
    return new Promise<void>((res, rej) => {
      let opened = false;
      this.peer = new Peer(PEER_PREFIX + code);
      keepAlive(this.peer);
      this.peer.on('open', () => { if (!opened) { opened = true; res(); } });
      this.peer.on('error', (e: any) => { if (!opened) rej(p2pError(e)); });
      this.peer.on('connection', (conn: any) => {
        const cid = conn.peer as string;
        conn.on('open', () => { this.conns.set(cid, conn); this.onJoin(cid); });
        conn.on('data', (d: any) => this.onMsg(cid, typeof d === 'string' ? JSON.parse(d) : d));
        const gone = () => { if (this.conns.get(cid) === conn) { this.conns.delete(cid); this.onLeave(cid); } };
        conn.on('close', gone);
        conn.on('error', gone);
      });
    });
  }
  send(cid: string, m: NetMsg) { try { this.conns.get(cid)?.send(JSON.stringify(m)); } catch { /* */ } }
  broadcast(m: NetMsg) { const s = JSON.stringify(m); for (const c of this.conns.values()) try { c.send(s); } catch { /* */ } }
  close() { this.peer?.destroy(); }
}
export class P2PClient implements ClientTransport {
  peer: any; conn: any;
  onMsg = (_: NetMsg) => {};
  onClose = () => {};
  private closed = false;
  constructor(private code: string) {}
  async connect() {
    const { Peer } = await import('peerjs');
    return new Promise<void>((res, rej) => {
      let opened = false;
      const fail = (e: Error) => { if (!opened) { opened = true; clearTimeout(timer); this.peer?.destroy(); rej(e); } };
      const timer = setTimeout(() => fail(new Error('Хост не отвечает. Проверьте код комнаты и интернет.')), 15000);
      this.peer = new Peer();
      keepAlive(this.peer);
      this.peer.on('error', (e: any) => { if (!opened) fail(p2pError(e)); else if (e?.type === 'peer-unavailable') this.lost(); });
      this.peer.on('open', () => {
        if (this.conn) return; // переподключение к сигнальному серверу — канал к хосту уже есть
        this.conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true });
        this.conn.on('open', () => { opened = true; clearTimeout(timer); res(); });
        this.conn.on('data', (d: any) => this.onMsg(typeof d === 'string' ? JSON.parse(d) : d));
        this.conn.on('close', () => this.lost());
        this.conn.on('error', () => this.lost());
      });
    });
  }
  private lost() { if (!this.closed) { this.closed = true; this.onClose(); } }
  send(m: NetMsg) { try { this.conn?.send(JSON.stringify(m)); } catch { /* */ } }
  close() { this.closed = true; this.peer?.destroy(); }
}

export const roomCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
