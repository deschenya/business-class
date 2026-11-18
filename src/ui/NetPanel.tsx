import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { pn } from './helpers';

export function NetPanel({ onClose }: { onClose: () => void }) {
  const { net, hostOnline, leave, view, claim, release } = useStore();
  const [info, setInfo] = useState<{ ips: string[]; port: number } | null>(null);
  useEffect(() => { fetch('api/info').then((r) => r.json()).then(setInfo).catch(() => setInfo(null)); }, []);
  const base = info?.ips?.[0] ? `http://${info.ips[0]}:${location.port || info.port}` : location.origin;
  const link = net.code ? `${net.kind === 'p2p' ? location.origin + location.pathname : base + '/'}?join=${net.code}&via=${net.kind}` : '';
  return (
    <div className="net-panel glass" onClick={(e) => e.stopPropagation()}>
      <div className="row between"><b>Мультиплеер</b><button className="icon-btn" onClick={onClose}>✕</button></div>
      {net.mode === 'local' && (
        <>
          <p className="muted small">Откройте хост — друг подключится и займёт свободную фишку. Партия, правила и сохранения остаются у вас.</p>
          {info && <button className="btn gold" onClick={() => hostOnline('ws')}>Открыть локальный хост (LAN)</button>}
          <button className={`btn ${info ? '' : 'gold'}`} onClick={() => hostOnline('p2p')}>Открыть хост через интернет (P2P)</button>
          {net.status === 'error' && <p className="err">{net.error}</p>}
          {!info && <p className="muted small">Друг откроет эту же страницу по ссылке и подключится напрямую к вашему браузеру.</p>}
        </>
      )}
      {net.mode === 'host' && (
        <>
          <div className="code-box">Код комнаты: <b>{net.code}</b> <span className="muted">({net.kind === 'ws' ? 'локальный сервер' : 'P2P'})</span></div>
          {net.status === 'connecting' && <p className="muted">Открываем комнату…</p>}
          {net.status === 'online' && (
            <>
              <p className="small">Ссылка для друга:</p>
              <div className="copy"><input readOnly value={link} onFocus={(e) => e.target.select()} /><button className="btn sm" onClick={() => navigator.clipboard?.writeText(link)}>Копировать</button></div>
              {net.kind === 'ws' && info && info.ips.length > 1 && <p className="muted small">Другие адреса: {info.ips.slice(1).map((ip) => `http://${ip}:${location.port || info.port}`).join(', ')}</p>}
            </>
          )}
          <p className="small"><b>Места:</b></p>
          {view?.players.map((p) => (
            <div key={p.id} className="seat-row"><span className="dot" style={{ background: p.color }} />{p.name}<span className="muted">— {net.seats[p.id] ? net.peers.find((x) => x.id === net.seats[p.id])?.name ?? 'друг' : 'этот компьютер'}</span></div>
          ))}
          <button className="btn danger sm" onClick={leave}>Закрыть хост</button>
        </>
      )}
      {net.mode === 'client' && view && (
        <>
          <p className="small">Подключено к комнате <b>{net.code}</b>. Выберите свою фишку:</p>
          {view.players.map((p) => {
            const mine = net.seats[p.id] === net.me;
            const taken = !!net.seats[p.id] && !mine;
            return (
              <div key={p.id} className="seat-row">
                <span className="dot" style={{ background: p.color }} />{p.name}
                {mine ? <button className="btn sm" onClick={() => release(p.id)}>Освободить</button> : <button className="btn sm gold" disabled={taken} onClick={() => claim(p.id)}>{taken ? 'занято' : 'Играть за ' + pn(view, p.id)}</button>}
              </div>
            );
          })}
          <button className="btn danger sm" onClick={leave}>Отключиться</button>
        </>
      )}
    </div>
  );
}
