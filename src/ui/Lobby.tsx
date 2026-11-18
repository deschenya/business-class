import { useStore, type LobbySeat } from '../store';
import { PAWN_PALETTE, PawnIcon, colorName, cls } from './helpers';
import { InviteBox } from './NetPanel';
import { TutorToggle } from './Tutor';
import { Shell } from './Shell';

export function LobbyScreen() {
  const { lobby, net, lobbyEdit, lobbyAddLocal, lobbyRemove, lobbyClaim, lobbySit, lobbyStart, leave, setScreen } = useStore();
  if (!lobby) return null;
  const host = net.mode === 'host';
  const mine = (x: LobbySeat) => (host ? x.owner === 'host' : x.owner === net.me);
  const hasSeat = lobby.seats.some(mine);
  const ownerLabel = (x: LobbySeat) => {
    if (x.owner === 'host') return host ? (x.id === 'host' ? 'вы · хост' : 'на этом устройстве') : 'хост';
    if (!x.owner) return x.token && !lobby.resume ? 'отключился' : 'свободно';
    if (x.owner === net.me) return 'вы';
    return 'друг';
  };
  const free = lobby.seats.filter((x) => !x.owner).length;
  const exit = () => { if (!host || confirm('Закрыть комнату? Все подключившиеся будут отключены.')) { leave(); setScreen('menu'); } };
  return (
    <Shell wide>
      <div className="lobby-box glass enter">
        <div className="lobby-head">
          <img src="art/logo.webp" className="lobby-logo" alt="" />
          <div>
            <h1>{lobby.title}</h1>
            <span className="muted small">{lobby.resume ? 'Продолжение сохранённой партии' : 'Новая партия'} · {host ? 'вы хост — партия сохраняется у вас' : `комната ${net.code}`}</span>
          </div>
        </div>
        {host && <InviteBox />}
        {host && <p className="muted small">Отправьте ссылку друзьям. Каждый, кто откроет её, {lobby.resume ? 'выберет свою фишку из партии' : 'сразу получит свою фишку'}.</p>}

        <div className="lobby-seats">
          {lobby.seats.map((x) => {
            const me = mine(x);
            const takenColors = lobby.seats.filter((y) => y.id !== x.id).map((y) => y.color);
            return (
              <div key={x.id} className={cls('lobby-seat', me && 'me', !x.owner && 'empty')}>
                <PawnIcon color={x.color} size={40} />
                <div className="lobby-seat-main">
                  <div className="row">
                    {me ? <input value={x.name} maxLength={24} onChange={(e) => lobbyEdit(x.id, { name: e.target.value })} /> : <b className="seat-name">{x.name}</b>}
                    <span className="color-name" style={{ color: x.color }}>{colorName(x.color)}</span>
                    {me && !lobby.resume ? (
                      <span className="sex"><button className={!x.lady ? 'on' : ''} onClick={() => lobbyEdit(x.id, { lady: false })}>М</button><button className={x.lady ? 'on' : ''} onClick={() => lobbyEdit(x.id, { lady: true })}>Ж</button></span>
                    ) : <span className="muted small">{x.lady ? 'Ж' : 'М'}</span>}
                    <span className={cls('owner-tag', x.owner ? 'on' : 'off')}>{ownerLabel(x)}</span>
                    {lobby.resume && !x.owner && (host || !hasSeat) && <button className="btn sm gold" onClick={() => lobbyClaim(x.id)}>{host ? 'Буду играть я' : 'Это я'}</button>}
                    {lobby.resume && host && x.owner === 'host' && <button className="btn sm ghost" onClick={() => lobbyClaim(x.id)}>Освободить</button>}
                    {host && !lobby.resume && x.id !== 'host' && <button className="icon-btn" title="Убрать" onClick={() => lobbyRemove(x.id)}>✕</button>}
                  </div>
                  {me && !lobby.resume && (
                    <div className="swatches">
                      {PAWN_PALETTE.map((c) => {
                        const taken = takenColors.includes(c.hex);
                        return <button key={c.hex} title={taken ? `${c.name} — занят` : c.name} disabled={taken} className={`swatch ${x.color === c.hex ? 'on' : ''}`} style={{ ['--sw' as any]: c.hex }} onClick={() => lobbyEdit(x.id, { color: c.hex })} />;
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {!host && !lobby.resume && !hasSeat && <button className="btn gold" onClick={lobbySit}>Сесть за стол</button>}
        </div>

        <TutorToggle label="Обучение на этом устройстве: подсказки по правилам во время хода" />
        <div className="lobby-foot">
          <button className="btn ghost" onClick={exit}>{host ? 'Закрыть комнату' : 'Выйти'}</button>
          <div className="spacer" />
          {host ? (
            <>
              {!lobby.resume && lobby.seats.length < 8 && <button className="btn" onClick={lobbyAddLocal}>+ Игрок на этом устройстве</button>}
              <div className="lobby-start">
                <button className="btn gold big shine" disabled={lobby.seats.length < 2} onClick={lobbyStart}>Начать игру →</button>
                {lobby.seats.length < 2 && <span className="muted small">Нужно минимум 2 игрока</span>}
                {lobby.resume && free > 0 && <span className="muted small">Свободных фишек: {free}. Их можно будет занять и после старта.</span>}
              </div>
            </>
          ) : (
            <span className="muted"><span className="spinner sm" /> Ждём, пока хост начнёт игру…</span>
          )}
        </div>
      </div>
    </Shell>
  );
}
