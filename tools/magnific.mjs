// Генерация арта для прототипа через Magnific API (GPT Image 2.5).
// Ключ берётся из переменной окружения MAGNIFIC_API_KEY.
// Запуск: npm run art            — сгенерировать недостающие
//         npm run art -- --force — перегенерировать всё
//         npm run art -- table_wood logo — только указанные
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.magnific.com/v1/ai/text-to-image/gpt-image-2-5';
const KEY = process.env.MAGNIFIC_API_KEY;
if (!KEY) { console.error('MAGNIFIC_API_KEY не задан'); process.exit(1); }
const OUT = path.resolve('public/art');

const JOBS = {
  table_wood: {
    prompt: 'Seamless tileable texture, top-down orthographic view of a polished dark walnut wood tabletop, rich warm brown with subtle straight grain, soft satin varnish, no objects, no seams, no lighting gradient, uniform even illumination, photorealistic material scan',
    aspect_ratio: 'square_1_1', resolution: '2k', quality: 'high', output_format: 'jpeg', output_compression: 90,
  },
  title_bg: {
    prompt: 'Cinematic still life on a dark mahogany executive desk in a 1990s Moscow business office at night: stacks of US dollar banknotes held with paper bands, ornate vintage stock certificates in green, orange, pink and blue, two ivory dice with black pips, a gold fountain pen, a brass banker lamp casting warm light, a leather-bound ledger, shallow depth of field, rich warm golden tones, dramatic chiaroscuro, empty dark space on the left third for a title, no text, no letters, no logos',
    aspect_ratio: 'widescreen_16_9', resolution: '2k', quality: 'high', output_format: 'jpeg', output_compression: 88,
  },
  logo: {
    prompt: 'Game logo lettering that reads exactly "БИЗНЕС-класс!!!" in Russian Cyrillic: the word "БИЗНЕС" in huge bold chunky 3D letters with a rainbow gradient from red through orange, yellow, green to blue, glossy, with a thin dark outline; below and overlapping it the word "класс!!!" in elegant dark olive-green brush script; playful 1990s board game box style, centered, isolated on a transparent background, no other text',
    aspect_ratio: 'standard_3_2', resolution: '1k', quality: 'high', output_format: 'png', background: 'transparent',
  },
  exchange_back: {
    prompt: 'Back side of a playing card for a stock exchange board game, landscape format, ornate engraved guilloche security pattern like a vintage banknote, deep emerald green and antique gold, a central oval medallion with a stylized rising stock chart arrow, the word "БИРЖА" in classic serif Cyrillic capitals in the medallion, rounded corners, flat front view filling the whole frame, no background visible',
    aspect_ratio: 'horizontal_2_1', resolution: '1k', quality: 'high', output_format: 'png',
  },
  avatars: {
    prompt: 'Square portrait avatar for a 1990s Russian business board game: a confident entrepreneur character, waist-up, slightly caricatured warm painterly illustration style, rich lighting, dark warm vignette background, each image a different person (varied gender, age, hairstyle and 90s business attire such as double-breasted suit, crimson blazer, turtleneck, power suit), friendly cunning smile, no text',
    aspect_ratio: 'square_1_1', resolution: '1k', quality: 'medium', output_format: 'jpeg', output_compression: 88, num_images: 8,
  },
  ivory: {
    prompt: 'Seamless tileable texture of polished warm ivory material with very subtle fine grain and faint marbling, flat even lighting, top-down, no objects',
    aspect_ratio: 'square_1_1', resolution: '1k', quality: 'low', output_format: 'jpeg', output_compression: 90,
  },
  leather: {
    prompt: 'Seamless tileable texture of deep green tooled leather desk blotter surface, fine pebbled grain, subtle wear, flat even lighting, top-down, no border, no objects',
    aspect_ratio: 'square_1_1', resolution: '1k', quality: 'medium', output_format: 'jpeg', output_compression: 90,
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'x-magnific-api-key': KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 400)}`);
  return json;
}

async function run(name, job) {
  const body = { ...job };
  const created = await api(API, { method: 'POST', body: JSON.stringify(body) });
  const id = created.data?.task_id;
  console.log(`[${name}] task ${id}`);
  for (let i = 0; i < 180; i++) {
    await sleep(4000);
    const st = await api(`${API}/${id}`);
    const s = st.data?.status;
    if (s === 'COMPLETED') {
      const urls = st.data.generated || [];
      const ext = job.output_format === 'jpeg' ? 'jpg' : job.output_format || 'png';
      let k = 0;
      for (const u of urls) {
        const buf = Buffer.from(await (await fetch(u)).arrayBuffer());
        const file = urls.length > 1 ? `${name}_${++k}.${ext}` : `${name}.${ext}`;
        // PNG-исходники (лого, рубашка) не публикуются — из них tools/prepare-assets.mjs делает webp
        await fs.writeFile(path.join(ext === 'png' ? path.resolve('art-src') : OUT, file), buf);
        console.log(`[${name}] saved ${file} (${(buf.length / 1024) | 0} KB)`);
      }
      return;
    }
    if (s === 'FAILED') throw new Error(`[${name}] FAILED ${JSON.stringify(st).slice(0, 300)}`);
  }
  throw new Error(`[${name}] timeout`);
}

await fs.mkdir(OUT, { recursive: true });
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
const existing = new Set(await fs.readdir(OUT));
const todo = Object.entries(JOBS).filter(([n]) => {
  if (only.length) return only.includes(n);
  if (force) return true;
  return ![...existing].some((f) => f.startsWith(n + '.') || f.startsWith(n + '_'));
});
const results = await Promise.allSettled(todo.map(([n, j]) => run(n, j)));
results.forEach((r, i) => r.status === 'rejected' && console.error(`ERR ${todo[i][0]}:`, r.reason.message));
console.log('done');
