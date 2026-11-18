// Транспорт мультиплеера. Хост авторитетен: держит состояние и применяет действия,
// клиенты присылают намерения и получают готовое состояние.
// Два варианта: локальный сервер (WebSocket-ретранслятор, LAN или туннель) и P2P (WebRTC через PeerJS).
import type { Action, GameEvent, GameState, PlayerId } from '../engine/types';

export type Seats = Record<PlayerId, string | null>; // контролёр места: 'host' | id клиента | null
export type NetMsg =
  | { t: 'hello'; name: string }
  | { t: 'welcome'; you: string; state: GameState | null; seats: Seats; title: string }
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
  onMsg = (_: NetMsg) => {};
  onClose = () => {};
  constructor(private code: string, private server: string | null) {}
  connect() {
    return new Promise<void>((res, rej) => {
      this.ws = new WebSocket(wsUrl(this.server, `room=${this.code}&role=client`));
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('Не удалось подключиться к хосту'));
      this.ws.onclose = () => this.onClose();
      this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === '_error') { rej(new Error(m.text)); return; } this.onMsg(m); };
    });
  }
  send(m: NetMsg) { this.ws?.readyState === 1 && this.ws.send(JSON.stringify(m)); }
  close() { this.ws?.close(); }
}

// ---------------------------------------------------------------- P2P (WebRTC)
const PEER_PREFIX = 'bizclass-3d-';
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
      this.peer = new Peer(PEER_PREFIX + code);
      this.peer.on('open', () => res());
      this.peer.on('error', (e: any) => rej(new Error('P2P: ' + (e?.type ?? e))));
      this.peer.on('connection', (conn: any) => {
        const cid = conn.peer as string;
        conn.on('open', () => { this.conns.set(cid, conn); this.onJoin(cid); });
        conn.on('data', (d: any) => this.onMsg(cid, typeof d === 'string' ? JSON.parse(d) : d));
        conn.on('close', () => { this.conns.delete(cid); this.onLeave(cid); });
      });
    });
  }
  send(cid: string, m: NetMsg) { this.conns.get(cid)?.send(JSON.stringify(m)); }
  broadcast(m: NetMsg) { const s = JSON.stringify(m); for (const c of this.conns.values()) c.send(s); }
  close() { this.peer?.destroy(); }
}
export class P2PClient implements ClientTransport {
  peer: any; conn: any;
  onMsg = (_: NetMsg) => {};
  onClose = () => {};
  constructor(private code: string) {}
  async connect() {
    const { Peer } = await import('peerjs');
    return new Promise<void>((res, rej) => {
      this.peer = new Peer();
      this.peer.on('error', (e: any) => rej(new Error('P2P: ' + (e?.type === 'peer-unavailable' ? 'комната не найдена' : e?.type ?? e))));
      this.peer.on('open', () => {
        this.conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true });
        this.conn.on('open', () => res());
        this.conn.on('data', (d: any) => this.onMsg(typeof d === 'string' ? JSON.parse(d) : d));
        this.conn.on('close', () => this.onClose());
      });
    });
  }
  send(m: NetMsg) { this.conn?.send(JSON.stringify(m)); }
  close() { this.peer?.destroy(); }
}

export const roomCode = () => Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
