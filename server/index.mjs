// Локальный хост «Бизнес-класс!!!»: раздаёт собранную игру (dist/) и ретранслирует
// сообщения между браузером-хостом и браузерами друзей по WebSocket.
// Запуск: npm run host   (сборка + сервер)   |   npm start   (только сервер)
// Порт: PORT=8787 по умолчанию. Для игры через интернет можно открыть порт на роутере
// или пробросить туннелем (например, `cloudflared tunnel --url http://localhost:8787`).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT || 8787);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const lanIps = () => Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify({ port: PORT, ips: lanIps(), rooms: [...rooms.keys()].length }));
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Сначала соберите игру: npm run build'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=3600' });
  fs.createReadStream(file).pipe(res);
});

/** room -> { host: ws, clients: Map<cid, ws> } */
const rooms = new Map();
let seq = 0;
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 * 1024 });
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const room = (q.get('room') || '').toUpperCase();
  const role = q.get('role');
  if (!room) return ws.close();
  if (role === 'host') {
    const prev = rooms.get(room);
    if (prev?.host && prev.host.readyState === 1) { ws.send(JSON.stringify({ t: '_error', text: 'Комната уже занята' })); return ws.close(); }
    const r = prev || { host: null, clients: new Map() };
    r.host = ws;
    rooms.set(room, r);
    for (const cid of r.clients.keys()) ws.send(JSON.stringify({ t: '_join', cid }));
    console.log(`[${room}] хост подключён`);
    ws.on('message', (buf) => {
      const m = JSON.parse(buf.toString());
      if (m.t === '_to') r.clients.get(m.cid)?.send(JSON.stringify(m.msg));
      else if (m.t === '_all') { const s = JSON.stringify(m.msg); for (const c of r.clients.values()) c.send(s); }
    });
    ws.on('close', () => {
      console.log(`[${room}] хост отключился`);
      if (r.host !== ws) return;
      // без «bye»: клиенты попробуют переподключиться — хост мог просто перезагрузить страницу
      for (const c of r.clients.values()) c.close();
      rooms.delete(room);
    });
    return;
  }
  const r = rooms.get(room);
  if (!r?.host) { ws.send(JSON.stringify({ t: '_error', text: 'Комната не найдена — хост ещё не открыл игру' })); return ws.close(); }
  const cid = `c${++seq}`;
  r.clients.set(cid, ws);
  r.host.send(JSON.stringify({ t: '_join', cid }));
  console.log(`[${room}] клиент ${cid} подключён`);
  ws.on('message', (buf) => r.host?.readyState === 1 && r.host.send(JSON.stringify({ t: '_from', cid, msg: JSON.parse(buf.toString()) })));
  ws.on('close', () => { r.clients.delete(cid); r.host?.readyState === 1 && r.host.send(JSON.stringify({ t: '_leave', cid })); });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  «Бизнес-класс!!!» — локальный хост`);
  console.log(`  Этот компьютер:  http://localhost:${PORT}`);
  for (const ip of lanIps()) console.log(`  Для друга в сети: http://${ip}:${PORT}`);
  console.log('');
});
