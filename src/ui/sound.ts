// Звуки игры на WebAudio: сэмплы из public/sfx (сгенерированы через Magnific).
// Пока сэмплы не загрузились (или файла нет), играет запасной синтез.
let ctx: AudioContext | null = null;
let enabled = (() => { try { return localStorage.getItem('bk.sound') !== 'off'; } catch { return true; } })();
const ac = () => {
  if (!enabled) return null;
  if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } decodeAll(ctx); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

// ---------------------------------------------------------------- сэмплы
/** Сколько вариантов каждого звука лежит в public/sfx (<имя>_1.mp3 … <имя>_N.mp3). */
/** Громкость файлов сведена между группами при генерации (опора — pawn_step), поэтому коэффициенты почти равны. */
const SAMPLES = {
  dice_shake: 3, dice_hit: 6, pawn_step: 5, pawn_land: 2, pawn_whoosh: 2,
  money_in: 3, money_out: 2, build: 3, card: 3, turn: 2, bad: 2, click: 3,
} as const;
type SampleName = keyof typeof SAMPLES;
const raw = new Map<string, Promise<ArrayBuffer | null>>();
const decoded = new Map<SampleName, AudioBuffer[]>();
const lastPick = new Map<SampleName, number>();
// файлы скачиваются сразу (AudioContext для этого не нужен), декодируются при первом звуке
for (const [name, n] of Object.entries(SAMPLES)) {
  for (let i = 1; i <= n; i++) {
    const url = `sfx/${name}_${i}.mp3`;
    raw.set(url, fetch(url).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
  }
}
function decodeAll(a: AudioContext) {
  for (const [name, n] of Object.entries(SAMPLES) as [SampleName, number][]) {
    for (let i = 1; i <= n; i++) {
      raw.get(`sfx/${name}_${i}.mp3`)!.then((buf) => buf && a.decodeAudioData(buf.slice(0))).then((ab) => {
        if (ab) decoded.set(name, [...(decoded.get(name) ?? []), ab]);
      }).catch(() => { /* битый файл — останется синтез */ });
    }
  }
}
/** Играет случайный вариант (не тот же, что в прошлый раз) с лёгким разбросом высоты и громкости. false — сэмплов ещё нет. */
function sample(name: SampleName, gain = 1, pitch = 0.05): boolean {
  const a = ac(); if (!a) return true;
  const list = decoded.get(name);
  if (!list?.length) return false;
  let k = Math.floor(Math.random() * list.length);
  if (list.length > 1 && k === lastPick.get(name)) k = (k + 1) % list.length;
  lastPick.set(name, k);
  const src = a.createBufferSource(); src.buffer = list[k];
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * pitch;
  const g = a.createGain(); g.gain.value = gain * (0.85 + Math.random() * 0.15);
  src.connect(g).connect(a.destination);
  src.start();
  return true;
}
let lastHit = 0;
let lastMoney = 0;
/** Несколько денежных переводов подряд звучат одним звуком. */
const moneyGate = () => { const now = performance.now(); if (now - lastMoney < 150) return false; lastMoney = now; return true; };
function noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  const a = ac(); if (!a) return;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}
function tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', when = 0, slide?: number) {
  const a = ac(); if (!a) return;
  const o = a.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = a.createGain();
  const t0 = a.currentTime + when;
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
export const sfx = {
  get on() { return enabled; },
  toggle() { enabled = !enabled; try { localStorage.setItem('bk.sound', enabled ? 'on' : 'off'); } catch { /* */ } return enabled; },
  /** Удар кубика о стол или о другой кубик. Удары чаще 30 мс сливаются — лишние пропускаем. */
  clack() {
    const now = performance.now();
    if (now - lastHit < 30) return;
    lastHit = now;
    if (!sample('dice_hit', 0.9, 0.08)) { noise(0.06, 2400 + Math.random() * 900, 3, 0.55); tone(900 + Math.random() * 300, 0.04, 0.05, 'square'); }
  },
  /** Кубики встряхивают в ладони перед броском. */
  shake() { if (!sample('dice_shake', 0.8, 0.04)) for (let i = 0; i < 5; i++) setTimeout(() => noise(0.04, 3000, 4, 0.18), i * 45); },
  /** Фишка приземляется на промежуточную клетку. */
  tap() { if (!sample('pawn_step', 0.5, 0.07)) noise(0.035, 1400, 2, 0.22, 'lowpass'); },
  /** Фишка встаёт на последнюю клетку хода. */
  land() { if (!sample('pawn_land', 0.8, 0.04)) noise(0.05, 1100, 2, 0.3, 'lowpass'); },
  whoosh() { if (!sample('pawn_whoosh', 0.6, 0.05)) noise(0.45, 700, 0.7, 0.18); },
  /** Игрок получает деньги. */
  coin() { if (moneyGate() && !sample('money_in', 0.55, 0.03)) { tone(1568, 0.12, 0.07, 'triangle'); tone(2093, 0.22, 0.06, 'triangle', 0.07); } },
  /** Игрок платит. */
  pay() { if (moneyGate() && !sample('money_out', 0.55, 0.03)) noise(0.18, 3500, 0.9, 0.1, 'highpass'); },
  /** На клетку ставят метку собственности. */
  build() { if (!sample('build', 0.55, 0.03)) { tone(392, 0.12, 0.08, 'triangle'); tone(523, 0.12, 0.08, 'triangle', 0.08); tone(784, 0.25, 0.07, 'triangle', 0.16); } },
  /** Карточку тянут и переворачивают. */
  card() { if (!sample('card', 0.55, 0.04)) noise(0.12, 5000, 0.8, 0.12, 'highpass'); },
  /** Негативное событие: штраф, нехватка денег. */
  bad() { if (!sample('bad', 0.55, 0.02)) tone(220, 0.3, 0.08, 'sawtooth', 0, 140); },
  /** Ваш ход. */
  good() { if (!sample('turn', 0.55, 0)) { tone(660, 0.12, 0.07, 'sine'); tone(880, 0.2, 0.07, 'sine', 0.1); } },
  /** Нажатие кнопки. */
  click() { if (!sample('click', 0.55, 0.05)) tone(1200, 0.03, 0.03, 'square'); },
};
