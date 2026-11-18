// Копирует и оптимизирует ресурсы из ../Resources в public/res (латинские имена файлов, webp).
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
const SRC = path.resolve('../Resources');
const DST = path.resolve('public/res');
const job = async (src, dst, width, opts = {}) => {
  await fs.mkdir(path.dirname(dst), { recursive: true });
  let p = sharp(path.join(SRC, src));
  if (width) p = p.resize({ width, withoutEnlargement: true });
  if (dst.endsWith('.webp')) p = p.webp({ quality: opts.q ?? 86, alphaQuality: 90 });
  if (dst.endsWith('.jpg')) p = p.jpeg({ quality: opts.q ?? 92, mozjpeg: true });
  await p.toFile(dst);
};
const tasks = [];
tasks.push(job('Map2K.jpg', `${DST}/board.jpg`, 2048, { q: 95 }));
const money = ['1_000', '5_000', '10_000', '50_000', '100_000'];
for (const m of money) tasks.push(job(`01_Деньги/Деньги_${m}.png`, `${DST}/money/${m.replace('_', '')}.webp`, 640));
const stocks = { red: 'розовая', yellow: 'оранжевая', green: 'зелёная', blue: 'синяя' };
for (const [k, v] of Object.entries(stocks)) tasks.push(job(`02_Акции/Акция_${v}.png`, `${DST}/stocks/${k}.webp`, 640));
const decks = { '04_Извещение': 'notice', '05_Подарок': 'gift', '06_Сюрприз': 'surprise', '07_Штраф': 'fine' };
for (const [dir, id] of Object.entries(decks)) {
  for (const f of await fs.readdir(path.join(SRC, dir))) {
    if (!f.endsWith('.png')) continue;
    const n = f.slice(0, 2);
    const name = f.includes('Рубашка') ? 'back' : n;
    tasks.push(job(`${dir}/${f}`, `${DST}/cards/${id}/${name}.webp`, 420));
  }
}
const colorMap = { 'красный': 'red', 'жёлтый': 'yellow', 'зелёный': 'green', 'синий': 'blue', 'белая': 'white' };
for (const f of await fs.readdir(path.join(SRC, '03_Биржа'))) {
  if (!f.endsWith('.png')) continue;
  const [c, n] = f.normalize('NFC').split('_');
  tasks.push(job(`03_Биржа/${f}`, `${DST}/exchange/${colorMap[c]}_${n}.webp`, 320));
}
for (const f of await fs.readdir(path.join(SRC, '08_Филиалы'))) {
  if (!f.endsWith('.png')) continue;
  tasks.push(job(`08_Филиалы/${f}`, `${DST}/firms/${parseInt(f)}.webp`, 300));
}
for (const f of await fs.readdir(path.join(SRC, '00_Правила'))) {
  if (!f.endsWith('.png')) continue;
  tasks.push(job(`00_Правила/${f}`, `${DST}/rules/${f.replace('.png', '.webp')}`, 1100, { q: 80 }));
}
// сгенерированный арт
const ART = path.resolve('public/art');
const SRC_ART = path.resolve('art-src');
const artJob = async (f, out, w) => { await sharp(path.join(SRC_ART, f)).resize({ width: w, withoutEnlargement: true }).webp({ quality: 88 }).toFile(path.join(ART, out)); };
tasks.push(artJob('logo.png', 'logo.webp', 1100));
tasks.push(artJob('exchange_back.png', 'exchange_back.webp', 640));
await Promise.all(tasks);
console.log('assets:', tasks.length);
