import { useEffect, useRef, useState } from 'react';

// Экран скачивания: перед первым запуском игра целиком скачивается в кеш браузера
// (Cache Storage), дальше Service Worker отдаёт её из кеша — запуск мгновенный, работает офлайн.
interface Manifest { version: string; files: { url: string; size: number; h: string }[] }
const FIRST = ['art/logo.webp', 'art/title_bg.jpg'];
const mb = (b: number) => (b / 1048576).toFixed(1).replace('.', ',');

async function download(m: Manifest, onProgress: (done: number, total: number, file: string) => void, onAsset: (url: string, objectUrl: string) => void) {
  const name = `bk-${m.version}`;
  const cache = await caches.open(name);
  const old = (await caches.keys()).filter((k) => k.startsWith('bk-') && k !== name && k !== 'bk-fonts');
  const total = m.files.reduce((a, f) => a + f.size, 0);
  let done = 0;
  const files = [...m.files].sort((a, b) => (FIRST.includes(b.url) ? 1 : 0) - (FIRST.includes(a.url) ? 1 : 0));
  const key = (f: Manifest['files'][number]) => `${f.url}${f.url.includes('?') ? '&' : '?'}v=${f.h}`;
  const missing: Manifest['files'] = [];
  for (const f of files) {
    if (await cache.match(key(f))) { done += f.size; continue; }
    // файл не менялся с прошлой версии — переносим из старого кеша без скачивания
    let reused = false;
    for (const o of old) {
      const hit = await (await caches.open(o)).match(key(f));
      if (hit) { await cache.put(key(f), hit); done += f.size; reused = true; break; }
    }
    if (!reused) missing.push(f);
  }
  onProgress(done, total, '');
  const show = async (f: Manifest['files'][number]) => { const hit = await cache.match(key(f)); if (hit && FIRST.includes(f.url)) onAsset(f.url, URL.createObjectURL(await hit.blob())); };
  for (const f of files.filter((x) => FIRST.includes(x.url) && !missing.includes(x))) await show(f);
  const one = async (f: Manifest['files'][number]) => {
      const res = await fetch(f.url, { cache: 'no-cache' });
      if (!res.ok || !res.body) throw new Error(`${f.url}: ${res.status}`);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        chunks.push(value); got += value.length; done += value.length;
        onProgress(Math.min(done, total), total, f.url);
      }
      done += Math.max(0, f.size - got);
      const blob = new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? '' });
      await cache.put(key(f), new Response(blob, { headers: { 'content-type': res.headers.get('content-type') ?? '' } }));
      if (FIRST.includes(f.url)) onAsset(f.url, URL.createObjectURL(blob));
  };
  // логотип и фон — первыми, чтобы экран загрузки сразу выглядел как игра
  const first = missing.filter((x) => FIRST.includes(x.url));
  for (const f of first) await one(f);
  const rest = missing.filter((x) => !FIRST.includes(x.url));
  let i = 0;
  const worker = async () => { while (i < rest.length) await one(rest[i++]); };
  await Promise.all([worker(), worker(), worker(), worker()]);
  for (const o of old) await caches.delete(o);
  onProgress(total, total, '');
}

export function Loader({ onReady }: { onReady: () => void }) {
  const [p, setP] = useState({ done: 0, total: 0, file: '' });
  const [err, setErr] = useState<string | null>(null);
  const [cached, setCached] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [img, setImg] = useState<Record<string, string>>({});
  const finished = useRef(false);
  useEffect(() => {
    if (import.meta.env.DEV || !('caches' in window)) { onReady(); return; }
    let cancelled = false;
    (async () => {
      try {
        navigator.serviceWorker?.register('sw.js').catch(() => {});
        const r = await fetch('precache.json', { cache: 'no-store' }).catch(() => null);
        if (!r?.ok) {
          // офлайн: если игра уже скачана — запускаем из кеша
          if ((await caches.keys()).some((k) => k.startsWith('bk-') && k !== 'bk-fonts')) return onReady();
          throw new Error('Нет соединения с сервером игры');
        }
        const m = (await r.json()) as Manifest;
        let last = 0;
        let pending: { done: number; total: number; file: string } | null = null;
        let raf = 0;
        await download(m, (done, total, file) => {
          if (cancelled) return;
          if (done === total && last === 0) setCached(true);
          last = done;
          pending = { done, total, file };
          if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) setP(pending); });
        }, (url, obj) => { if (!cancelled) setImg((x) => ({ ...x, [url]: obj })); });
        cancelAnimationFrame(raf);
        if (pending) setP(pending);
        if (!cancelled && !finished.current) { finished.current = true; setTimeout(onReady, 350); }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div className="loader">
      {img['art/title_bg.jpg'] && <div className="loader-bg" style={{ backgroundImage: `url(${img['art/title_bg.jpg']})` }} />}
      <div className="loader-box">
        {img['art/logo.webp'] ? <img className="loader-logo" src={img['art/logo.webp']} alt="Бизнес-Класс!!!" /> : <div className="loader-logo placeholder">Бизнес-Класс!!!</div>}
        {err ? (
          <>
            <p className="err">Не удалось скачать игру: {err}</p>
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn gold" onClick={() => { setErr(null); setAttempt((x) => x + 1); }}>Повторить</button>
              <button className="btn ghost" onClick={onReady}>Играть без кеша</button>
            </div>
          </>
        ) : (
          <>
            <div className="loader-bar"><i style={{ width: `${pct}%` }} /></div>
            <div className="loader-text">
              {cached || pct === 100 ? 'Игра готова' : p.total ? `Скачиваем игру… ${mb(p.done)} из ${mb(p.total)} МБ` : 'Проверяем файлы игры…'}
              <b>{pct}%</b>
            </div>
            <p className="muted small">Игра скачивается один раз. Потом она открывается мгновенно и работает даже без интернета, кроме сетевой игры.</p>
          </>
        )}
      </div>
    </div>
  );
}
