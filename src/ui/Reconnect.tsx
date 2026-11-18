import { useStore } from '../store';

/** Связь с хостом оборвалась: игра остаётся на экране, идут попытки переподключиться. */
export function ReconnectOverlay() {
  const net = useStore((s) => s.net);
  const { retryReconnect, abandon } = useStore();
  if (net.mode !== 'client' || (net.status !== 'reconnecting' && net.status !== 'lost')) return null;
  const lost = net.status === 'lost';
  return (
    <div className="reconnect-back">
      <div className="reconnect glass">
        {lost ? <span className="reconnect-ico">⚠️</span> : <span className="spinner" />}
        <h3>{lost ? 'Не удалось переподключиться' : 'Связь с хостом потеряна'}</h3>
        <p className="muted">
          {lost
            ? `${net.error ? net.error + '. ' : ''}Возможно, у хоста пропал интернет или он закрыл игру. Ваша фишка ждёт вас — можно попробовать ещё раз.`
            : `Переподключаемся к комнате ${net.code}… попытка ${Math.max(1, net.reconnect?.attempt ?? 1)} из ${net.reconnect?.max ?? 11}. Ваша фишка остаётся за вами.`}
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          {lost && <button className="btn gold" onClick={retryReconnect}>Ещё раз</button>}
          <button className="btn ghost" onClick={() => abandon()}>В меню</button>
        </div>
      </div>
    </div>
  );
}
