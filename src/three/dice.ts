import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// Раскладка граней модели Die из Blender (glTF, Y вверх): +Y=1, -Y=6, +X=2, -X=5, +Z=3, -Z=4
const FACE_AXES: Record<number, THREE.Vector3> = {
  1: new THREE.Vector3(0, 1, 0), 6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(1, 0, 0), 5: new THREE.Vector3(-1, 0, 0),
  3: new THREE.Vector3(0, 0, 1), 4: new THREE.Vector3(0, 0, -1),
};

export interface DiceFrame { p: THREE.Vector3[]; q: THREE.Quaternion[] }
export interface DiceRun { frames: DiceFrame[]; fix: THREE.Quaternion[]; hits: number[] }

/**
 * Физика просчитывается заранее (cannon-es), затем проигрывается покадрово.
 * Чтобы выпало значение, определённое ядром игры, модель кубика внутри тела
 * доворачивается так, что нужная грань оказывается на месте выпавшей.
 */
export function simulateDice(values: number[], area: { cx: number; cz: number; w: number; d: number; floorY: number }, size: number, seed = Math.random()): DiceRun {
  let r = Math.floor(seed * 2147483646) + 1;
  const rnd = () => { r = (r * 16807) % 2147483647; return (r - 1) / 2147483646; };
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82 * 3, 0) });
  world.allowSleep = true;
  const matDie = new CANNON.Material('die');
  const matFloor = new CANNON.Material('floor');
  // реальный бросок: заметное трение и невысокая упругость — кубики катятся вперёд и гаснут, а не прыгают как мячики
  world.addContactMaterial(new CANNON.ContactMaterial(matDie, matFloor, { friction: 0.45, restitution: 0.28 }));
  world.addContactMaterial(new CANNON.ContactMaterial(matDie, matDie, { friction: 0.25, restitution: 0.3 }));
  const floor = new CANNON.Body({ mass: 0, material: matFloor, shape: new CANNON.Plane() });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floor.position.set(0, area.floorY, 0);
  world.addBody(floor);
  // невидимые бортики только по краю поля — далеко от зоны броска, чтобы кубики не отскакивали назад
  const EDGE = 9.6;
  const wall = (x: number, z: number, ry: number) => {
    const b = new CANNON.Body({ mass: 0, material: matFloor, shape: new CANNON.Plane() });
    b.quaternion.setFromEuler(0, ry, 0);
    b.position.set(x, area.floorY, z);
    world.addBody(b);
  };
  wall(-EDGE, 0, Math.PI / 2);
  wall(EDGE, 0, -Math.PI / 2);
  wall(0, -EDGE, 0);
  wall(0, EDGE, Math.PI);

  const h = size / 2;
  // бросок из-за правого края зоны к её центру; направление чуть «веером»
  const dirZ = (rnd() - 0.5) * 0.35;
  const bodies = values.map((_, i) => {
    const b = new CANNON.Body({ mass: 1, material: matDie, shape: new CANNON.Box(new CANNON.Vec3(h, h, h)), sleepSpeedLimit: 0.08, sleepTimeLimit: 0.3 });
    const spread = (i - (values.length - 1) / 2) * 0.85;
    b.position.set(area.cx + area.w * 0.62 + rnd() * 0.3, area.floorY + 1.1 + rnd() * 0.35 + i * 0.12, area.cz + spread + (rnd() - 0.5) * 0.3);
    b.quaternion.setFromEuler(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28);
    const speed = 5.2 + rnd() * 1.6;
    b.velocity.set(-speed, 0.6 + rnd() * 0.8, speed * (dirZ + (rnd() - 0.5) * 0.12));
    // вращение в основном «вперёд по ходу» (вокруг оси, перпендикулярной движению) + немного случайного
    const spin = 9 + rnd() * 6;
    b.angularVelocity.set((rnd() - 0.5) * 6, (rnd() - 0.5) * 6, spin);
    b.linearDamping = 0.1; b.angularDamping = 0.18;
    world.addBody(b);
    return b;
  });
  const hits: number[] = [];
  let frameIdx = 0;
  bodies.forEach((b) => b.addEventListener('collide', (e: any) => {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
    if (v > 1.5 && (hits.length === 0 || frameIdx - hits[hits.length - 1] > 3)) hits.push(frameIdx);
  }));
  const frames: DiceFrame[] = [];
  const dt = 1 / 120;
  for (let step = 0; step < 120 * 7; step++) {
    world.step(dt);
    if (step % 2 === 0) {
      frameIdx = frames.length;
      frames.push({ p: bodies.map((b) => new THREE.Vector3(b.position.x, b.position.y, b.position.z)), q: bodies.map((b) => new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)) });
    }
    if (step > 60 && bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) break;
  }
  // какая грань наверху у каждого кубика
  const last = frames[frames.length - 1];
  const up = new THREE.Vector3(0, 1, 0);
  const fix = values.map((v, i) => {
    const inv = last.q[i].clone().invert();
    const localUp = up.clone().applyQuaternion(inv);
    let best = 1, bestDot = -2;
    for (const [face, ax] of Object.entries(FACE_AXES)) { const d = ax.dot(localUp); if (d > bestDot) { bestDot = d; best = Number(face); } }
    // поворот модели: ось нужного значения -> ось выпавшей грани
    return new THREE.Quaternion().setFromUnitVectors(FACE_AXES[v], FACE_AXES[best]);
  });
  return { frames, fix, hits };
}
