import type { ReactNode } from 'react';

// Общая оболочка «кабинетных» экранов (меню, вход, лобби): одинаковый фон и центровка,
// поэтому переходы между ними не прыгают. Фон медленно «дышит», в воздухе — золотая пыльца.
// только золотая пыльца: мелкие тёплые искорки, медленно поднимающиеся вверх
const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  left: (i * 47 + 13) % 100, delay: -((i * 1.3) % 16), dur: 14 + ((i * 7) % 10), size: 2 + (i % 3),
}));

export function Shell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="shell">
      <div className="shell-bg" style={{ backgroundImage: 'url(art/title_bg.jpg)' }} />
      <div className="shell-shade" />
      <div className="shell-particles" aria-hidden>
        {PARTICLES.map((p, i) => (
          <i key={i} className="pt spark" style={{ left: `${p.left}%`, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, width: p.size, height: p.size }} />
        ))}
      </div>
      <div className={`shell-col ${wide ? 'wide' : ''}`}>{children}</div>
    </div>
  );
}

/** Анимированное появление по очереди: каждому ребёнку задержка --i. */
export const stagger = (i: number) => ({ ['--i' as any]: i });
