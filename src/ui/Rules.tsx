import { useEffect, useState } from 'react';
import { useStore } from '../store';

interface Glossary { _описание: string; terms: { term: string; definition: string | null }[]; pages: string[]; rulesPages: string[] }

export function RulesScreen() {
  const { setScreen, view } = useStore();
  const [g, setG] = useState<Glossary | null>(null);
  const [tab, setTab] = useState<'rules' | 'glossary'>('rules');
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  useEffect(() => { fetch('data/glossary.json').then((r) => r.json()).then(setG); }, []);
  if (!g) return null;
  const pages = tab === 'rules' ? g.rulesPages : g.pages;
  return (
    <div className="screen rules">
      <header className="screen-head">
        <button className="btn ghost" onClick={() => setScreen(view ? 'game' : 'menu')}>← {view ? 'К игре' : 'Меню'}</button>
        <h1>{tab === 'rules' ? 'Правила игры' : 'Словарь делового человека'}</h1>
        <div className="seg">
          <button className={tab === 'rules' ? 'on' : ''} onClick={() => { setTab('rules'); setPage(0); }}>Правила (скан)</button>
          <button className={tab === 'glossary' ? 'on' : ''} onClick={() => { setTab('glossary'); setPage(0); }}>Словарь</button>
        </div>
      </header>
      <div className="rules-body">
        {tab === 'glossary' && (
          <aside className="glass card terms">
            <p className="muted small">{g._описание}</p>
            <input placeholder="Поиск термина" value={q} onChange={(e) => setQ(e.target.value)} />
            <ol>{g.terms.filter((t) => t.term.toLowerCase().includes(q.toLowerCase())).map((t) => <li key={t.term}>{t.term}{t.definition && <span className="muted small"> — {t.definition}</span>}</li>)}</ol>
          </aside>
        )}
        <div className="pages">
          <div className="row">
            <button className="btn sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
            <span>Страница {page + 1} из {pages.length}</span>
            <button className="btn sm" disabled={page >= pages.length - 1} onClick={() => setPage(page + 1)}>›</button>
          </div>
          <img className="page-img" src={pages[page]} alt="" />
        </div>
      </div>
    </div>
  );
}
