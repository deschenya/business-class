import { useEffect, useState } from 'react';
import { hasLanServer, useStore } from '../store';
import { TutorToggle } from './Tutor';
import { Shell } from './Shell';

export function JoinScreen() {
  const { join, net, setScreen } = useStore();
  const q = new URLSearchParams(location.search);
  const [code, setCode] = useState(q.get('join') ?? '');
  const [via, setVia] = useState<'ws' | 'p2p'>((q.get('via') as 'ws' | 'p2p') ?? 'p2p');
  const [server, setServer] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem('bk.name') ?? ''; } catch { return ''; } });
  const [lan, setLan] = useState(false);
  useEffect(() => { hasLanServer().then((ok) => { setLan(ok); if (!ok) setVia('p2p'); }); }, []);
  const go = () => { try { localStorage.setItem('bk.name', name); } catch { /* */ } join(code.trim(), via, via === 'ws' && server ? server : null, name || 'Гость'); };
  return (
    <Shell>
      <img className="shell-logo small" src="art/logo.webp" alt="" />
        <div className="glass card join enter">
          <h2>Присоединиться к партии</h2>
          <label className="field"><span>Ваше имя</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Гость" /></label>
          <label className="field"><span>Код комнаты</span><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCDE" maxLength={5} /></label>
          <div className="seg">
            <button className={via === 'p2p' ? 'on' : ''} onClick={() => setVia('p2p')}>Через интернет (P2P)</button>
            {lan && <button className={via === 'ws' ? 'on' : ''} onClick={() => setVia('ws')}>Локальный хост</button>}
          </div>
          {via === 'ws' && <label className="field"><span>Адрес хоста</span><input value={server} onChange={(e) => setServer(e.target.value)} placeholder={`${location.host} (текущий)`} /></label>}
          {net.status === 'connecting' && <p className="muted">Подключение…</p>}
          {net.status === 'error' && <p className="err">{net.error}</p>}
          <TutorToggle />
          <div className="row join-actions">
            <button className="btn ghost" onClick={() => setScreen('menu')}>← Назад</button>
            <button className="btn gold shine" onClick={go} disabled={code.length < 4}>Подключиться</button>
          </div>
        </div>
    </Shell>
  );
}
