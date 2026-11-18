import type { ReactNode } from 'react';

// Общая оболочка «кабинетных» экранов (меню, вход, лобби): одинаковый фон и центровка,
// поэтому переходы между ними не прыгают. Фон медленно «дышит», в воздухе — монеты, искры и кубики.
const PARTICLES = Array.from({ length: 16 }, (_, i) => {
  const kind = i % 7 === 0 ? 'die' : i % 3 === 0 ? 'coin' : 'spark';
  return { kind, left: (i * 61) % 100, delay: -((i * 1.7) % 14), dur: 12 + ((i * 5) % 9), size: kind === 'spark' ? 3 + (i % 3) : kind === 'coin' ? 14 + (i % 3) * 4 : 18 };
});

export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="shell">
      <div className="shell-bg" style={{ backgroundImage: 'url(art/title_bg.jpg)' }} />
      <div className="shell-shade" />
      <div className="shell-particles" aria-hidden>
        {PARTICLES.map((p, i) => (
          <i key={i} className={`pt ${p.kind}`} style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, width: p.size, height: p.size }} />
        ))}
      </div>
      <div className={`shell-col ${wide ? 'wide' : ''}`}>{children}</div>
    </div>
  );
}

/** Анимированное появление по очереди: каждому ребёнку задержка --i. */
export const stagger = (i: number) => ({ ['--i' as any]: i });
