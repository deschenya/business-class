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
  it('бросок от фишки: с краёв и углов кубики катятся к центру и остаются на поле', () => {
    const spots = [[-8.8, 9], [8.8, -1.7], [-6.8, -8.8], [0, 8.8], [-5, -4], [3, 2]];
    let k = 0;
    for (const [x, z] of spots) for (let t = 0; t < 20; t++) {
      const len = Math.hypot(x, z) || 1;
      const dx = -x / len, dz = -z / len;
      const from = { x: x + dx * 1.3, z: z + dz * 1.3, dx, dz };
      const run = simulateDice([2, 6], area, 0.62, (++k) / 997, from);
      for (let d = 0; d < 2; d++) {
        const end = run.frames[run.frames.length - 1].p[d];
        const start = run.frames[0].p[d];
        expect(Math.abs(end.x)).toBeLessThan(9.6);
        expect(Math.abs(end.z)).toBeLessThan(9.6);
        expect((end.x - start.x) * dx + (end.z - start.z) * dz).toBeGreaterThan(0.5); // ушли вперёд по направлению броска
      }
    }
  });
});
