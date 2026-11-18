import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { PawnIcon } from './helpers';

type Info = { ips: string[]; port: number } | null;
export function useServerInfo() {
  const [info, setInfo] = useState<Info>(null);
  useEffect(() => { fetch('api/info').then((r) => r.json()).then(setInfo).catch(() => setInfo(null)); }, []);
  return info;
}
/** Ссылка-приглашение: P2P — тот же адрес страницы, LAN — адрес компьютера в локальной сети. */
export function inviteLink(net: { code?: string; kind?: 'ws' | 'p2p' }, info: Info) {
  if (!net.code) return '';
  const lanBase = info?.ips?.[0] ? `http://${info.ips[0]}:${location.port || info.port}/` : location.origin + '/';
  return `${net.kind === 'ws' ? lanBase : location.origin + location.pathname}?join=${net.code}&via=${net.kind}`;
}
export function InviteBox() {
  const net = useStore((s) => s.net);
  const info = useServerInfo();
  const [copied, setCopied] = useState(false);
  const link = inviteLink(net, info);
  return (
    <div className="invite">
      <div className="code-box">Код комнаты: <b>{net.code}</b></div>
      <div className="copy">
        <input readOnly value={link} onFocus={(e) => e.target.select()} />
        <button className="btn sm gold" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Скопировано ✓' : 'Копировать ссылку'}</button>
      </div>
    </div>
  );
}

export function NetPanel({ onClose }: { onClose: () => void }) {
  const { net, leave, view, claim, hostSetSeat, setScreen } = useStore();
  if (!view) return null;
  const owner = (pid: string) => {
    const o = net.seats[pid];
    if (o === 'host') return net.mode === 'host' ? 'этот компьютер' : 'хост';
    if (!o) return 'ждёт игрока';
    if (o === net.me) return 'вы';
    return net.peers.find((x) => x.id === o)?.name ?? 'друг';
  };
  const exit = () => { leave(); setScreen('menu'); };
  return (
    <div className="net-panel glass" onClick={(e) => e.stopPropagation()}>
      <div className="row between"><b>Сетевая игра</b><button className="icon-btn" onClick={onClose}>✕</button></div>
      {net.mode === 'host' && <InviteBox />}
      {net.mode === 'client' && <p className="small">Комната <b>{net.code}</b> · партия хранится у хоста.</p>}
      <p className="small"><b>Фишки</b></p>
      {view.players.filter((p) => !p.bankrupt).map((p) => {
        const o = net.seats[p.id];
        return (
          <div key={p.id} className="seat-row">
            <PawnIcon color={p.color} size={20} />{p.name}<span className="muted">— {owner(p.id)}</span>
            {net.mode === 'host' && !o && <button className="btn sm" onClick={() => hostSetSeat(p.id, 'host')}>Вести отсюда</button>}
            {net.mode === 'host' && o === 'host' && <button className="btn sm ghost" title="Освободить место — друг сможет занять фишку" onClick={() => hostSetSeat(p.id, null)}>Освободить</button>}
            {net.mode === 'client' && !o && <button className="btn sm gold" onClick={() => claim(p.id)}>Это я</button>}
          </div>
        );
      })}
      <button className="btn danger sm" onClick={() => { if (net.mode !== 'host' || confirm('Закрыть комнату? Все игроки будут отключены, партия сохранится у вас.')) exit(); }}>{net.mode === 'host' ? 'Закрыть комнату' : 'Отключиться'}</button>
    </div>
  );
}
