import { useMemo, useState } from 'react';
import { dataStore, useStore } from '../store';
import type { GameData } from '../engine/types';
import { STOCK_HEX } from './helpers';

// Редактор справочников: поле, рулетка, автострада, карточки.
// Вне партии правки сохраняются локально и применяются к новым партиям;
// во время партии ведущий правит данные текущей партии (с записью в журнал).
export function EditorScreen() {
  const { data, view, setScreen, dispatch, can } = useStore();
  const inGame = !!view && can('host');
  const src: GameData = inGame ? view!.data : data!;
  const [draft, setDraft] = useState<GameData>(() => structuredClone(src));
  const [tab, setTab] = useState<'cells' | 'roulette' | 'highway' | 'cards' | 'json'>('cells');
  const [onlyFlags, setOnlyFlags] = useState(false);
  const [json, setJson] = useState('');
  const changed = JSON.stringify(draft) !== JSON.stringify(src);
  const flagged = useMemo(() => draft.board.cells.filter((c) => c.проверить || c.требует_оцифровки).length + draft.board.roulette.sectors.filter((x) => x.требует_оцифровки).length, [draft]);

  const set = (path: (string | number)[], value: any) => {
    setDraft((d) => {
      const n = structuredClone(d);
      let o: any = n;
      for (const k of path.slice(0, -1)) o = o[k];
      o[path.at(-1)!] = value;
      return n;
    });
  };
  const save = () => {
    if (inGame) {
      // отправляем только изменённые листья
      const diff = (a: any, b: any, p: (string | number)[]) => {
        if (JSON.stringify(a) === JSON.stringify(b)) return;
        if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return void dispatch({ type: 'editData', by: 'host', path: p, value: b });
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diff(a[k], b[k], [...p, Array.isArray(b) ? Number(k) : k]);
      };
      diff(src.board, draft.board, ['board']);
      diff(src.cards, draft.cards, ['cards']);
    } else {
      dataStore.save(draft);
      useStore.setState({ data: draft });
    }
    useStore.getState().toast('Справочники сохранены', 'good');
  };
  const num = (v: any, path: (string | number)[]) => <input type="number" step={1000} value={v ?? ''} onChange={(e) => set(path, e.target.value === '' ? null : Number(e.target.value))} />;
  const cells = draft.board.cells.map((c, i) => ({ c, i })).filter(({ c }) => !onlyFlags || c.проверить || c.требует_оцифровки);

  return (
    <div className="screen editor">
      <header className="screen-head">
        <button className="btn ghost" onClick={() => setScreen(view ? 'game' : 'menu')}>← {view ? 'К игре' : 'Меню'}</button>
        <h1>Справочники {inGame ? '(текущая партия)' : '(для новых партий)'}</h1>
        <span className="muted small">Сомнительных значений: {flagged}</span>
        <div className="spacer" />
        {!inGame && <button className="btn sm ghost" onClick={() => { if (confirm('Сбросить справочники к оцифрованным по полю?')) { dataStore.reset(); location.reload(); } }}>Сбросить</button>}
        <button className="btn gold" disabled={!changed} onClick={save}>Сохранить</button>
      </header>
      <div className="seg">
        {(['cells', 'roulette', 'highway', 'cards', 'json'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => { setTab(t); if (t === 'json') setJson(JSON.stringify(draft, null, 1)); }}>{{ cells: 'Клетки поля', roulette: 'Рулетка', highway: 'Автострада', cards: 'Карточки', json: 'JSON' }[t]}</button>)}
      </div>
      <div className="editor-body glass card">
        {tab === 'cells' && (
          <>
            <label className="check"><input type="checkbox" checked={onlyFlags} onChange={(e) => setOnlyFlags(e.target.checked)} /> Только «проверить» / «требует_оцифровки»</label>
            <table className="tbl edit">
              <thead><tr><th>№</th><th>Название</th><th>Тип</th><th>Котировка</th><th>Цена</th><th>Аренда: участок</th><th>филиал</th><th>предприятие</th><th>Аренда (Россия)</th><th>Примечание</th></tr></thead>
              <tbody>
                {cells.map(({ c, i }) => (
                  <tr key={c.id} className={c.проверить || c.требует_оцифровки ? 'flagged' : ''}>
                    <td><span className="dot" style={{ background: c.color ? STOCK_HEX[c.color] : '#777' }} />{c.id}</td>
                    <td><input value={c.name} onChange={(e) => set(['board', 'cells', i, 'name'], e.target.value)} /></td>
                    <td className="small muted">{c.type}</td>
                    <td>{c.type === 'company' && num(c.quote, ['board', 'cells', i, 'quote'])}</td>
                    <td>{'price' in c && num(c.price, ['board', 'cells', i, 'price'])}</td>
                    {c.rent ? <>
                      <td>{num(c.rent.plot, ['board', 'cells', i, 'rent', 'plot'])}</td>
                      <td>{num(c.rent.branch, ['board', 'cells', i, 'rent', 'branch'])}</td>
                      <td>{num(c.rent.enterprise, ['board', 'cells', i, 'rent', 'enterprise'])}</td>
                    </> : <><td /><td /><td /></>}
                    <td>{c.type === 'ru_company' && num(c.rentSingle, ['board', 'cells', i, 'rentSingle'])}{c.amount !== undefined && num(c.amount, ['board', 'cells', i, 'amount'])}{c.fee !== undefined && num(c.fee, ['board', 'cells', i, 'fee'])}</td>
                    <td className="small">
                      {(c.проверить || c.требует_оцифровки) && <span className="warn">{c.проверить || c.требует_оцифровки} </span>}
                      {(c.проверить || c.требует_оцифровки) && <button className="link" onClick={() => { set(['board', 'cells', i, 'проверить'], undefined); set(['board', 'cells', i, 'требует_оцифровки'], undefined); }}>сверено ✓</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {tab === 'roulette' && (
          <table className="tbl edit">
            <thead><tr><th>Слот</th><th>Подпись</th><th>Сумма</th><th>Выход</th><th>Примечание</th></tr></thead>
            <tbody>
              {draft.board.roulette.order.map((slot) => {
                const i = draft.board.roulette.sectors.findIndex((x) => x.slot === slot);
                const x = draft.board.roulette.sectors[i];
                return (
                  <tr key={slot} className={x.требует_оцифровки ? 'flagged' : ''}>
                    <td>{slot}{x.start && ' (старт)'}</td>
                    <td><input value={x.label} onChange={(e) => set(['board', 'roulette', 'sectors', i, 'label'], e.target.value)} /></td>
                    <td>{num(x.value, ['board', 'roulette', 'sectors', i, 'value'])}</td>
                    <td><input type="checkbox" checked={!!x.exit} onChange={(e) => set(['board', 'roulette', 'sectors', i, 'exit'], e.target.checked)} /></td>
                    <td className="small warn">{x.требует_оцифровки}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {tab === 'highway' && (
          <table className="tbl edit">
            <thead><tr><th>Клетка</th><th>Текст на поле</th><th>Действие</th></tr></thead>
            <tbody>{draft.board.highway.map((h, i) => <tr key={h.id}><td>{h.n}</td><td><input value={h.name} onChange={(e) => set(['board', 'highway', i, 'name'], e.target.value)} /></td><td className="small"><code>{JSON.stringify(h.effect)}</code></td></tr>)}</tbody>
          </table>
        )}
        {tab === 'cards' && (
          <div className="cards-edit">
            {(Object.keys(draft.cards.decks) as (keyof GameData['cards']['decks'])[]).map((k) => (
              <div key={k}>
                <h4>{draft.cards.decks[k].name}</h4>
                {draft.cards.decks[k].cards.map((cd: any, i: number) => (
                  <div key={cd.id} className="card-edit">
                    <img src={cd.image} alt="" />
                    <textarea value={cd.text} onChange={(e) => set(['cards', 'decks', k, 'cards', i, 'text'], e.target.value)} />
                    <code className="small">{JSON.stringify(cd.effect)}</code>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {tab === 'json' && (
          <>
            <p className="muted small">Полный справочник. Изменения применяются кнопкой ниже, затем «Сохранить».</p>
            <textarea className="json" value={json} onChange={(e) => setJson(e.target.value)} />
            <button className="btn" onClick={() => { try { setDraft(JSON.parse(json)); useStore.getState().toast('JSON применён', 'good'); } catch (e: any) { useStore.getState().toast('Ошибка JSON: ' + e.message, 'bad'); } }}>Применить JSON</button>
          </>
        )}
      </div>
    </div>
  );
}
