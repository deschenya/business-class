import { describe, it, expect } from 'vitest';
import { simulateDice } from './dice';

// Бросок должен выглядеть естественно: кубики летят вперёд и останавливаются на поле, без отскока назад.
describe('бросок кубиков', () => {
  const area = { cx: 0.6, cz: 2.1, w: 6.5, d: 5, floorY: 0.16 };
  it('кубики не отлетают назад и остаются на поле', () => {
    let worstBack = 0;
    for (let k = 0; k < 120; k++) {
      const run = simulateDice([3, 5], area, 0.62, (k + 1) / 131);
      const f = run.frames;
      for (let d = 0; d < 2; d++) {
        const start = f[0].p[d].x;
        let minX = start;
        for (const fr of f) { minX = Math.min(minX, fr.p[d].x); worstBack = Math.max(worstBack, fr.p[d].x - minX); }
        const end = f[f.length - 1].p[d];
        expect(end.x).toBeLessThan(start); // в итоге продвинулись вперёд
        expect(Math.abs(end.x)).toBeLessThan(9.6);
        expect(Math.abs(end.z)).toBeLessThan(9.6);
      }
    }
    expect(worstBack).toBeLessThan(0.6); // максимум откат на долю кубика (перекат через ребро)
  });
});
