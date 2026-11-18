// Небольшой синтезатор звуков на WebAudio — без внешних файлов.
let ctx: AudioContext | null = null;
let enabled = (() => { try { return localStorage.getItem('bk.sound') !== 'off'; } catch { return true; } })();
const ac = () => {
  if (!enabled) return null;
  if (!ctx) { try { ctx = new AudioContext(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};
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
  clack() { noise(0.06, 2400 + Math.random() * 900, 3, 0.55); tone(900 + Math.random() * 300, 0.04, 0.05, 'square'); },
  shake() { for (let i = 0; i < 5; i++) setTimeout(() => noise(0.04, 3000, 4, 0.18), i * 45); },
  tap() { noise(0.035, 1400, 2, 0.22, 'lowpass'); },
  whoosh() { noise(0.45, 700, 0.7, 0.18); },
  coin() { tone(1568, 0.12, 0.07, 'triangle'); tone(2093, 0.22, 0.06, 'triangle', 0.07); },
  build() { tone(392, 0.12, 0.08, 'triangle'); tone(523, 0.12, 0.08, 'triangle', 0.08); tone(784, 0.25, 0.07, 'triangle', 0.16); },
  card() { noise(0.12, 5000, 0.8, 0.12, 'highpass'); },
  bad() { tone(220, 0.3, 0.08, 'sawtooth', 0, 140); },
  good() { tone(660, 0.12, 0.07, 'sine'); tone(880, 0.2, 0.07, 'sine', 0.1); },
  click() { tone(1200, 0.03, 0.03, 'square'); },
};
