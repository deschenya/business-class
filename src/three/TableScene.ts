import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { BoardData, GameEvent, GameState, Pos, PlayerId } from '../engine/types';
import { simulateDice, type DiceRun } from './dice';
import { sfx } from '../ui/sound';
import { pawnSvg } from '../ui/helpers';

const LABEL_H = 1.1; // высота подписи над основанием фишки
const BOARD = 20; // размер поля в мировых единицах
const TOP = 0.16; // высота верхней грани поля
const PX = BOARD / 2048;

type Tween = { t: number; dur: number; fn: (k: number) => void; done?: () => void };
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** кратчайшая разница углов в (-π, π] */
const wrap = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Настройки «кинематографичной» камеры (в духе видеоигр по Монополии).
 * r — дистанция до точки взгляда, phi — угол от вертикали (0 = строго сверху),
 * th — азимут (0 = со стороны +Z, как в обзоре по умолчанию). Время — в секундах.
 */
export const CAM = {
  // бросок кубиков: наезд на лоток, к остановке — почти сверху, чтобы читались грани
  diceR0: 11.5, diceRMin: 8.6, diceRMax: 12.5, dicePhi0: 0.66, dicePhi1: 0.5, diceTh: 0.32, diceHold: 0.3,
  diceSpeed: 1.25, // ускорение проигрывания броска
  // проводка фишки
  moveR: 10.6, moveRSmall: 7.4, movePhi: 0.74, movePhiSmall: 0.6,
  moveSwing: 0.62, // насколько камера обходит поле вслед за фишкой (рад при фишке сбоку)
  moveLook: 1.0, // смещение взгляда к финишу хода (ед.)
  moveLead: 1.1, // упреждение к клетке текущего прыжка (ед.)
  moveHold: 0.75, // пауза крупным планом после приземления
  teleR: 10, teleRMax: 17,
  // общий план после хода: дистанция зажимается в [overRMin, overRMax] от «домашней» (пользовательской)
  overRMin: 13, overRMax: 22, overPull: 0.4, overPhiMax: 1.0,
  // сглаживание (critically damped, время ~ до 63% пути)
  smoothF: 0.2, smoothR: 0.45, smoothPhi: 0.45, smoothTh: 0.65, smoothOver: 0.6,
  shake: 0.07, shakeTele: 0.14,
};
/** Прыжки фишки. */
export const HOP = {
  dur: 0.26, durSmall: 0.16, // длительность прыжка на клетку (на бирже/рулетке — мельче)
  height: 0.55, heightSmall: 0.24,
  jitter: 0.28, // разброс высоты прыжков ±
  accel: 0.3, // разгон: к 5-й клетке прыжки короче на эту долю
  antic: 0.11, // присед перед первым прыжком
  settle: 0.28, // пружинка после финального приземления
  lastDur: 1.3, lastHeight: 1.6, // финальный прыжок длиннее и выше
  squash: 0.12, squashLast: 0.27, stretch: 0.16, lean: 0.12, wobble: 0.1,
  teleDur: 0.95, teleHeight: 3.4, pivot: 0.42,
};

type Shot = {
  kind: 'dice' | 'move' | 'tele' | 'over' | 'goal';
  auto: boolean; // автоматический план (подчиняется флагу follow)
  f: THREE.Vector3; r: number; phi: number; th: number; // цель
  sf: number; sr: number; sth: number; // времена сглаживания
  track?: (s: Shot) => void; // обновление цели каждый кадр
  release?: number; // момент (elapsed), когда уйти на общий план
  landing?: THREE.Vector3;
  until?: number; // страховка: план завершится не позже
};
type HopOpts = {
  dur: number; height: number; antic?: number; settle?: number; squash?: number;
  lean?: number; wobble?: number; yaw?: number; flip?: number; pivot?: number; onLand?: () => void;
};

export interface HoverInfo { kind: 'cell' | 'hw' | 'ex' | 'rl'; id: number | string; x: number; y: number }

export class TableScene {
  renderer: THREE.WebGLRenderer;
  labels: CSS2DRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  board!: BoardData;
  boardMesh!: THREE.Mesh;
  models: Record<string, THREE.Object3D> = {};
  pawns = new Map<PlayerId, { obj: THREE.Group; mat: THREE.MeshPhysicalMaterial; label: CSS2DObject; busy: boolean }>();
  markers = new Map<number, THREE.Object3D>();
  dice: THREE.Group[] = [];
  diceRun: { run: DiceRun; f: number; resolve: () => void } | null = null;
  tweens: Tween[] = [];
  activeRing: THREE.Mesh;
  hoverRing: THREE.Mesh;
  previewRing: THREE.Mesh;
  private previewSaved: { f: THREE.Vector3; pos: THREE.Vector3 } | null = null;
  private last = performance.now();
  private elapsed = 0;
  follow = true;
  // камера-режиссёр
  private shot: Shot | null = null;
  private rig = { f: new THREE.Vector3(), r: 30, phi: 0.9, th: 0 };
  private vel = new Float64Array(6);
  private home = { f: new THREE.Vector3(0, 0, 0.8), r: 30, phi: 0.9, th: 0 };
  private homeDirty = false;
  private userGrab = false; // пользователь перехватил камеру в текущей партии событий
  private ctrlActive = false;
  private shakeAmp = 0;
  private shakeSaved = new THREE.Vector3();
  private sph = new THREE.Spherical();
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private dust: THREE.Mesh[] = [];
  private dustI = 0;
  onHover?: (h: HoverInfo | null) => void;
  onCellClick?: (h: HoverInfo) => void;
  onCard?: (e: Extract<GameEvent, { t: 'card' }>) => Promise<void>;
  ready: Promise<void>;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private disposed = false;
  quality: 'high' | 'low' = 'high';
  private loaded = false; // модели из Blender загружены

  constructor(private host: HTMLElement, board: BoardData) {
    this.board = board;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.88;
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(r.domElement);
    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = 'labels-layer';
    host.appendChild(this.labels.domElement);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.camera.position.set(0, 24, 19);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0, 0.8);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = 1.32;
    this.controls.minDistance = 5;
    this.controls.maxDistance = 48;
    // камеру перехватываем у режиссёра только при реальном движении (клик по клетке — не в счёт)
    this.controls.addEventListener('start', () => { this.ctrlActive = true; });
    this.controls.addEventListener('end', () => { this.ctrlActive = false; });
    r.domElement.addEventListener('wheel', this.userTook, { passive: true });
    this.captureHome();

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    this.scene.background = new THREE.Color(0x0d0907);
    // линейный туман начинается дальше всего поля (макс. дистанция камеры 48 + полполя):
    // глушит только дальний край стола, яркость поля не зависит от зума
    this.scene.fog = new THREE.Fog(0x0d0907, 60, 150);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // высокий порог: светятся только настоящие блики, а не белые клетки поля (иначе ореол зависит от зума)
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.1, 0.4, 1.6));
    this.composer.addPass(new OutputPass());

    this.lights();
    this.activeRing = this.ring(0xffd36a, 0.62, 0.78);
    this.hoverRing = this.ring(0xffffff, 0.5, 0.58);
    this.hoverRing.visible = false;
    this.previewRing = this.ring(0xffd36a, 0.5, 0.74);
    this.previewRing.visible = false;
    this.makeDust();
    this.ready = this.build();
    this.resize();
    window.addEventListener('resize', this.resize);
    r.domElement.addEventListener('pointermove', this.pointerMove);
    r.domElement.addEventListener('click', this.click);
    r.setAnimationLoop(this.loop);
  }

  dispose() {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    this.renderer.domElement.removeEventListener('wheel', this.userTook);
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  resize = () => {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.applyViewShift();
  };
  /** Сдвиг кадра по вертикали (px): точка, на которую смотрит камера, оказывается выше центра экрана —
   *  в видимой области над окном выбора. 0 — обычный кадр. */
  private viewDy = 0;
  private viewDyGoal = 0;
  private baseDy = 0; // сдвиг, пока открыто окно выбора
  /** Открыто окно выбора: точку фокуса камеры показывать на высоте focusY (px от верха); null — обычный кадр. */
  setFocusY(focusY: number | null) {
    this.baseDy = focusY === null ? 0 : Math.max(0, this.host.clientHeight / 2 - focusY);
    if (!this.previewRing.visible) this.viewDyGoal = this.baseDy;
  }
  private applyViewShift() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (Math.abs(this.viewDy) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, 0, this.viewDy, w, h);
    this.camera.updateProjectionMatrix();
  }

  private lights() {
    const hemi = new THREE.HemisphereLight(0xfff1dc, 0x2a1a10, 0.45);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe2b8, 1.55);
    key.position.set(-9, 22, 11);
    key.castShadow = true;
    key.shadow.mapSize.set(4096, 4096);
    key.shadow.camera.left = -15; key.shadow.camera.right = 15; key.shadow.camera.top = 15; key.shadow.camera.bottom = -15;
    key.shadow.camera.near = 5; key.shadow.camera.far = 60;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
    key.shadow.radius = 3;
    this.scene.add(key);
    const lamp = new THREE.SpotLight(0xffb45e, 55, 60, 0.7, 0.7, 1.4);
    lamp.position.set(10, 18, -8);
    lamp.target.position.set(2, 0, 0);
    this.scene.add(lamp, lamp.target);
    const rim = new THREE.DirectionalLight(0x8fb4ff, 0.5);
    rim.position.set(12, 6, -16);
    this.scene.add(rim);
  }

  private ring(color: number, r0: number, r1: number) {
    const g = new THREE.RingGeometry(r0, r1, 64);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 5;
    this.scene.add(mesh);
    return mesh;
  }

  private async build() {
    const tl = new THREE.TextureLoader();
    const load = (u: string) => new Promise<THREE.Texture>((res) => tl.load(u, res, undefined, () => res(new THREE.Texture())));
    const [map, wood, leather, ivory] = await Promise.all([load(this.board.image), load('art/table_wood.jpg'), load('art/leather.jpg'), load('art/ivory.jpg')]);
    ivory.colorSpace = THREE.SRGBColorSpace;
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    wood.colorSpace = THREE.SRGBColorSpace; wood.wrapS = wood.wrapT = THREE.RepeatWrapping; wood.repeat.set(5, 5); wood.anisotropy = 8;
    leather.colorSpace = THREE.SRGBColorSpace; leather.wrapS = leather.wrapT = THREE.RepeatWrapping; leather.repeat.set(3, 3);

    // стол
    const table = new THREE.Mesh(new THREE.CircleGeometry(70, 96), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.42, metalness: 0.0 }));
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);
    // кожаный бювар под полем
    const pad = new THREE.Mesh(new THREE.BoxGeometry(BOARD + 3.2, 0.06, BOARD + 3.2), new THREE.MeshStandardMaterial({ map: leather, roughness: 0.7 }));
    pad.position.y = 0.03; pad.receiveShadow = true; pad.castShadow = true;
    this.scene.add(pad);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(BOARD + 3.3, 0.04, BOARD + 3.3), new THREE.MeshStandardMaterial({ color: 0xc9a14a, metalness: 1, roughness: 0.3 }));
    trim.position.y = 0.02; this.scene.add(trim);
    // поле
    const side = new THREE.MeshStandardMaterial({ color: 0x1c140e, roughness: 0.8 });
    // почти матовая печать: слабый лак и блик, чтобы вблизи поле не «засвечивалось»
    const top = new THREE.MeshPhysicalMaterial({ map, roughness: 0.7, clearcoat: 0.04, clearcoatRoughness: 0.8, specularIntensity: 0.28, envMapIntensity: 0.6 });
    this.boardMesh = new THREE.Mesh(new THREE.BoxGeometry(BOARD, TOP - 0.06, BOARD), [side, side, top, side, side, side]);
    this.boardMesh.position.y = 0.06 + (TOP - 0.06) / 2;
    this.boardMesh.receiveShadow = true; this.boardMesh.castShadow = true;
    this.scene.add(this.boardMesh);

    // модели из Blender
    const gltf = await new GLTFLoader().loadAsync('models/pieces.glb').catch(() => null);
    // верхние узлы GLB: одиночный меш или группа (если у модели несколько материалов)
    if (gltf) for (const o of [...gltf.scene.children]) {
      o.traverse((x) => { x.castShadow = true; x.receiveShadow = true; });
      o.position.set(0, 0, 0);
      this.models[o.name] = o;
    }
    this.models['Die']?.traverse((x) => {
      const mesh = x as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshPhysicalMaterial[]) {
        if (m.name === 'DieBody') { m.map = ivory; m.color.set(0xffffff); m.roughness = 0.3; m.needsUpdate = true; }
      }
    });
    // кубики
    for (let i = 0; i < 2; i++) {
      const g = new THREE.Group();
      const m = this.models['Die']?.clone() ?? new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
      m.castShadow = true;
      g.add(m);
      g.scale.setScalar(0.62);
      g.position.set(3 + i * 0.9, TOP + 0.31, 3.2);
      g.rotation.y = 0.4 + i;
      this.scene.add(g);
      this.dice.push(g);
    }
    this.loaded = true;
  }

  // ------------------------------------------------------------ координаты
  px(x: number, y: number) { return new THREE.Vector3(x * PX - BOARD / 2, TOP, y * PX - BOARD / 2); }
  xyOf(pos: Pos): [number, number] {
    const b = this.board;
    switch (pos.z) {
      case 'c': return b.cells.find((c) => c.id === pos.id)?.xy ?? [1024, 1024];
      case 'h': return b.highway[pos.n - 1]?.xy ?? [1024, 1024];
      case 'x': {
        if (!pos.lane || pos.n === 0) return pos.lane ? [b.exchange.lanes.find((l) => l.color === pos.lane)!.cells[0][0] - 44, b.exchange.lanes.find((l) => l.color === pos.lane)!.cells[0][1]] : b.exchange.start;
        return b.exchange.lanes.find((l) => l.color === pos.lane)!.cells[Math.min(pos.n, 20) - 1];
      }
      case 'r': return b.roulette.sectors.find((s) => s.slot === pos.slot)?.xy ?? b.roulette.center;
    }
  }
  worldOf(pos: Pos, slot = 0, count = 1) {
    const [x, y] = this.xyOf(pos);
    const v = this.px(x, y);
    const tight = pos.z === 'x' || pos.z === 'r';
    if (count > 1) {
      const a = (slot / count) * Math.PI * 2 + 0.6;
      const rr = tight ? 0.16 : 0.36;
      v.x += Math.cos(a) * rr; v.z += Math.sin(a) * rr;
    }
    return v;
  }

  // ------------------------------------------------------------ синхронизация
  private lastTurnKey = '';
  private curPlayer: PlayerId | null = null;
  syncPlayers(s: GameState) {
    const turnKey = `${s.turn.n}:${s.turn.player}`;
    this.curPlayer = s.turn.player;
    if (this.loaded && turnKey !== this.lastTurnKey) {
      const first = this.lastTurnKey === '';
      this.lastTurnKey = turnKey;
      // ход перешёл к другому игроку — камера к его фишке (только «Следить»)
      // в начале партии и при смене хода — камера к фишке того, кто ходит (только «Следить»)
      if (!first || s.turn.n === 1) { this.userGrab = false; queueMicrotask(() => this.focusPawn(s.turn.player)); }
    }
    if (!this.loaded) return; // фишки создаём только после загрузки моделей
    const groups = new Map<string, PlayerId[]>();
    for (const p of s.players) { if (p.bankrupt) continue; const k = JSON.stringify(p.pos); groups.set(k, [...(groups.get(k) ?? []), p.id]); }
    for (const p of s.players) {
      let pw = this.pawns.get(p.id);
      if (!pw) {
        const mat = new THREE.MeshPhysicalMaterial({ color: p.color, roughness: 0.55, clearcoat: 0.15, clearcoatRoughness: 0.6 });
        const base = this.models['Pawn'] ? (this.models['Pawn'] as THREE.Mesh).clone() : new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 24), mat);
        (base as THREE.Mesh).material = mat;
        base.castShadow = true;
        const obj = new THREE.Group();
        obj.add(base);
        obj.scale.setScalar(1.15);
        const el = document.createElement('div');
        el.className = 'pawn-label';
        el.innerHTML = `${pawnSvg(p.color, 18)}<span>${p.name}</span>`;
        el.style.setProperty('--c', p.color);
        const label = new CSS2DObject(el);
        // подпись не дочерняя к фишке: иначе наклоны/сальто прыжка уносят её в сторону; позицию синхронизируем в цикле
        this.scene.add(label);
        this.scene.add(obj);
        pw = { obj, mat, label, busy: false };
        this.pawns.set(p.id, pw);
        obj.position.copy(this.worldOf(p.pos));
      }
      pw.obj.visible = !p.bankrupt;
      (pw.label.element as HTMLElement).classList.toggle('active', s.turn.player === p.id);
      if (!pw.busy && !p.bankrupt) {
        const ids = groups.get(JSON.stringify(p.pos)) ?? [p.id];
        const target = this.worldOf(p.pos, ids.indexOf(p.id), ids.length);
        if (pw.obj.position.distanceTo(target) > 0.01) this.slide(pw.obj, target, 0.35);
      }
    }
    const cur = s.players.find((p) => p.id === s.turn.player);
    if (cur && !cur.bankrupt) {
      this.activeRing.visible = true;
      (this.activeRing.material as THREE.MeshBasicMaterial).color.set(cur.color);
      const target = this.worldOf(cur.pos);
      this.activeRing.position.set(target.x, TOP + 0.012, target.z);
      const sc = cur.pos.z === 'x' || cur.pos.z === 'r' ? 0.45 : 1;
      this.activeRing.scale.setScalar(sc);
    }
  }

  syncProps(s: GameState) {
    if (!this.loaded) return;
    const seen = new Set<number>();
    for (const pr of Object.values(s.props)) {
      if (pr.owner === 'bank') continue;
      seen.add(pr.cell);
      const owner = s.players.find((p) => p.id === pr.owner);
      const key = `${pr.level}|${owner?.color}|${!!pr.pledged}`;
      let m = this.markers.get(pr.cell);
      if (m && m.userData.key === key) continue;
      if (m) { this.scene.remove(m); }
      m = this.makeMarker(pr.level, owner?.color ?? '#999', !!pr.pledged);
      m.userData.key = key;
      const cell = s.data.board.cells.find((c) => c.id === pr.cell)!;
      const p = this.px(cell.xy[0], cell.xy[1]);
      const dir = new THREE.Vector3(-p.x, 0, -p.z).normalize();
      const out = cell.zone === 'outer';
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      p.addScaledVector(out ? dir : side, out ? 0.55 : 0.6);
      if (out) p.addScaledVector(side, 0.5);
      m.position.copy(p);
      m.rotation.y = Math.atan2(dir.x, dir.z);
      this.scene.add(m);
      this.markers.set(pr.cell, m);
      // появление
      m.scale.setScalar(0.001);
      const target = m.userData.scale as number;
      this.tweens.push({ t: 0, dur: 0.5, fn: (k) => { const e = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); m!.scale.setScalar(Math.max(0.001, target * e)); } });
    }
    for (const [cell, m] of this.markers) if (!seen.has(cell)) { this.scene.remove(m); this.markers.delete(cell); }
  }

  private makeMarker(level: string, color: string, pledged: boolean) {
    const name = level === 'plot' ? 'PlotFlag' : level === 'enterprise' ? 'Enterprise' : 'Branch';
    const src = this.models[name];
    const g = new THREE.Group();
    if (src) {
      const m = src.clone();
      m.traverse((x) => {
        const mesh = x as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((mm) => {
          const c = (mm as THREE.MeshStandardMaterial).clone();
          if (c.name === 'Marker') { c.color.set(color); if (pledged) { c.emissive = new THREE.Color(0x550000); c.color.multiplyScalar(0.5); } }
          return c;
        });
        mesh.material = mats.length === 1 ? mats[0] : mats;
        mesh.castShadow = true;
      });
      g.add(m);
    } else g.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color })));
    g.userData.scale = level === 'enterprise' ? 0.55 : level === 'plot' ? 0.6 : 0.55;
    if (level === 'firm') g.userData.scale = 0.6;
    return g;
  }

  // ------------------------------------------------------------ анимация событий
  private slide(obj: THREE.Object3D, to: THREE.Vector3, dur: number) {
    const from = obj.position.clone();
    return new Promise<void>((res) => this.tweens.push({ t: 0, dur, fn: (k) => obj.position.lerpVectors(from, to, ease(k)), done: res }));
  }

  /**
   * Прыжок фишки: присед (antic) → полёт по дуге с растяжением и наклоном по ходу →
   * приземление со сплющиванием; при settle > 0 — пружинка до полного покоя.
   * Без settle фишка остаётся чуть сплющенной: следующий прыжок продолжает из этого состояния.
   */
  /** Чужие фишки на клетке, куда прыгает ходящая, отскакивают в сторону от её пути. */
  private dodge(mover: PlayerId, from: THREE.Vector3, to: THREE.Vector3, small: boolean, dur: number) {
    const out: { obj: THREE.Group; home: THREE.Vector3 }[] = [];
    const dx = to.x - from.x, dz = to.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    const sx = -dz / len, sz = dx / len; // перпендикуляр к пути
    const near = small ? 0.3 : 0.75;
    for (const [id, other] of this.pawns) {
      if (id === mover || !other.obj.visible || other.busy || other.obj.userData.dodging) continue;
      const o = other.obj.position;
      if (Math.hypot(o.x - to.x, o.z - to.z) > near) continue;
      // в ту сторону, где фишка уже стоит относительно центра клетки
      const sign = (o.x - to.x) * sx + (o.z - to.z) * sz >= 0 ? 1 : -1;
      const push = small ? 0.28 : 0.72;
      const home = o.clone();
      const dest = new THREE.Vector3(o.x + sx * sign * push + dx / len * 0.1, o.y, o.z + sz * sign * push + dz / len * 0.1);
      other.obj.userData.dodging = true;
      this.hop(other.obj, dest, { dur: dur * 0.85, height: small ? 0.18 : 0.42, squash: 0.1, lean: 0.14, wobble: 0.12 * sign, yaw: 0.6 * sign });
      out.push({ obj: other.obj, home });
    }
    return out;
  }
  private hop(obj: THREE.Object3D, to: THREE.Vector3, o: HopOpts) {
    const from = obj.position.clone();
    obj.userData.hopTo = to; // для упреждения камеры
    const base = obj.children[0] as THREE.Object3D | undefined;
    const antic = o.antic ?? 0, dur = o.dur, settle = o.settle ?? 0, T = antic + dur + settle;
    const squash = o.squash ?? HOP.squash, lean = o.lean ?? HOP.lean, wob = o.wobble ?? 0, flip = o.flip ?? 0, pivot = o.pivot ?? 0;
    const sy0 = base ? base.scale.y : 1;
    const syA = antic > 0 ? 1 - 0.2 : sy0; // высота в начале полёта
    const yaw0 = (obj.userData.yaw as number | undefined) ?? 0, yaw1 = yaw0 + (o.yaw ?? 0);
    const dir = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();
    const axis = new THREE.Vector3(dir.z, 0, -dir.x); // наклон «вперёд по ходу»
    const qa = new THREE.Quaternion(), qr = new THREE.Quaternion(), qy = new THREE.Quaternion(), pv = new THREE.Vector3();
    let landed = false;
    const land = () => { if (!landed) { landed = true; o.onLand?.(); } };
    const pose = (sy: number, leanA: number, rollA: number, yaw: number, pv0: number) => {
      if (!base) return;
      const sxz = 1 / Math.sqrt(sy);
      base.scale.set(sxz, sy, sxz);
      qa.setFromAxisAngle(axis, leanA);
      qr.setFromAxisAngle(dir, rollA);
      qy.setFromAxisAngle(UP, yaw);
      base.quaternion.multiplyQuaternions(qa, qr).multiply(qy);
      if (pv0) { // вращение вокруг середины фишки, а не основания
        pv.set(0, pv0, 0).applyQuaternion(base.quaternion);
        base.position.set(-pv.x, pv0 - pv.y, -pv.z);
      } else base.position.set(0, 0, 0);
    };
    return new Promise<void>((res) => this.tweens.push({
      t: 0, dur: T,
      fn: (k) => {
        const t = k * T;
        if (t < antic) { // присед с лёгким откидыванием назад
          const a = t / antic, e = 1 - (1 - a) * (1 - a);
          obj.position.copy(from);
          pose(lerp(sy0, syA, e), -lean * 0.6 * e, 0, yaw0, 0);
        } else if (t < antic + dur || settle === 0) {
          const f = Math.min(1, (t - antic) / dur);
          const m = smooth(f) * 0.35 + f * 0.65;
          obj.position.lerpVectors(from, to, m);
          obj.position.y = from.y + (to.y - from.y) * f + Math.sin(Math.PI * f) * o.height;
          let sy = 1 + HOP.stretch * Math.abs(Math.cos(Math.PI * f)); // тянется на взлёте и падении
          sy = lerp(syA, sy, smooth(Math.min(1, f / 0.15)));
          if (settle === 0 && f > 0.85) { const b = (f - 0.85) / 0.15; sy = lerp(sy, 1 - squash, b * b); }
          const fl = flip ? flip * ease(f) : 0;
          pose(sy, lean * Math.sin(Math.PI * 2 * f) + fl - (antic > 0 ? lean * 0.6 * (1 - smooth(Math.min(1, f / 0.2))) : 0),
            wob * Math.sin(Math.PI * f), lerp(yaw0, yaw1, m), flip ? pivot : 0);
          if (f >= 1) land();
        } else { // пружинка после приземления
          land();
          const s = (t - antic - dur) / settle, d = (1 - s) * (1 - s);
          obj.position.copy(to);
          pose(1 - squash * Math.cos(Math.PI * 2.6 * s) * d, -lean * 0.7 * Math.sin(Math.PI * 2 * s) * d, 0, yaw1, 0);
        }
      },
      done: () => {
        land();
        obj.userData.yaw = yaw1;
        if (settle > 0) this.restPose(obj);
        res();
      },
    }));
  }
  private restPose(obj: THREE.Object3D) {
    const base = obj.children[0];
    if (!base) return;
    base.scale.set(1, 1, 1);
    base.position.set(0, 0, 0);
    base.quaternion.setFromAxisAngle(UP, (obj.userData.yaw as number | undefined) ?? 0);
  }

  async play(events: GameEvent[], s: GameState, speed = 1) {
    this.userGrab = false;
    for (const e of events) {
      if (this.disposed) return;
      if (e.t === 'dice') await this.rollDice(e.values, e.player);
      else if (e.t === 'move') {
        const pw = this.pawns.get(e.player);
        if (!pw) continue;
        pw.busy = true;
        const n = e.path.length - 1;
        const final = this.worldOf(e.path[n]);
        const shot = this.cine() ? this.moveShot(pw.obj, final, e.path[n].z === 'x' || e.path[n].z === 'r') : null;
        let dodged: { obj: THREE.Group; home: THREE.Vector3 }[] = [];
        for (let i = 1; i <= n; i++) {
          const pos = e.path[i];
          const small = pos.z === 'x' || pos.z === 'r';
          const first = i === 1, last = i === n;
          const ramp = Math.min(1, (i - 1) / 4); // разгон по ходу движения
          let dur = (small ? HOP.durSmall : HOP.dur) * (1.12 - HOP.accel * ramp);
          let height = (small ? HOP.heightSmall : HOP.height) * (1 + (Math.random() * 2 - 1) * HOP.jitter);
          if (last) { dur *= HOP.lastDur; height = (small ? HOP.heightSmall : HOP.height) * HOP.lastHeight; }
          const to = this.worldOf(pos);
          // фишки на клетке приземления отпрыгивают вбок; те, что остались позади, возвращаются на место
          const back = dodged;
          dodged = this.dodge(e.player, pw.obj.position, to, small, dur / speed);
          for (const b of back) this.hop(b.obj, b.home, { dur: (dur * 1.1) / speed, height: small ? 0.12 : 0.3, squash: 0.08, lean: 0.06, onLand: () => { b.obj.userData.dodging = false; } });
          await this.hop(pw.obj, to, {
            dur: dur / speed, height,
            antic: first ? HOP.antic / speed : 0,
            settle: last ? HOP.settle / speed : 0,
            squash: last ? HOP.squashLast : HOP.squash,
            lean: HOP.lean * (0.7 + Math.random() * 0.6),
            wobble: (Math.random() * 2 - 1) * HOP.wobble,
            yaw: (Math.random() * 2 - 1) * 0.5,
            onLand: () => {
              if (last) sfx.land(); else sfx.tap();
              this.puff(to, (small ? 0.45 : 1) * (last ? 1.35 : 0.75), last ? 0.55 : 0.26);
              if (last) this.kick(small ? CAM.shake * 0.5 : CAM.shake);
            },
          });
        }
        this.restPose(pw.obj);
        for (const d of dodged) d.obj.userData.dodging = false; // на финишной клетке — расставит syncPlayers
        // камера остаётся на фишке после хода (режим «Следить») — без отъезда на общий план
        pw.busy = false;
      } else if (e.t === 'teleport') {
        const pw = this.pawns.get(e.player);
        if (!pw) continue;
        pw.busy = true;
        const to = this.worldOf(e.to);
        const small = e.to.z === 'x' || e.to.z === 'r';
        const dist = pw.obj.position.distanceTo(to);
        const shot = this.cine() ? this.teleShot(pw.obj, to, small) : null;
        sfx.whoosh();
        await this.hop(pw.obj, to, {
          dur: (HOP.teleDur + dist * 0.012) / speed, height: HOP.teleHeight + Math.min(dist, 20) * 0.07,
          antic: 0.2 / speed, settle: 0.34 / speed, squash: 0.32, lean: 0.14,
          flip: Math.PI * 2, pivot: HOP.pivot, yaw: Math.PI * (Math.random() < 0.5 ? -1 : 1),
          onLand: () => { sfx.land(); this.puff(to, small ? 0.7 : 1.8, 0.65); this.kick(CAM.shakeTele); },
        });
        this.restPose(pw.obj);
        // после прыжка камера тоже остаётся на фишке
        pw.busy = false;
      } else if (e.t === 'card') {
        sfx.card();
        await this.onCard?.(e);
      } else if (e.t === 'prop') {
        this.syncProps(s);
        sfx.build();
      } else if (e.t === 'money') {
        const who = e.to !== 'bank' ? e.to : e.from;
        const pw = who !== 'bank' ? this.pawns.get(who) : null;
        if (pw) this.floatText(pw.obj.position, `${e.to === who ? '+' : '−'}$${e.amount.toLocaleString('ru-RU')}`, e.to === who ? '#ffd76a' : '#ff6d5a');
        if (e.to !== 'bank') sfx.coin(); else sfx.pay();
      }
    }
    // бросок без перемещения (например, на рулетке/бирже) — вернуть фокус на фишку ходящего
    if (this.cine() && this.shot?.kind === 'dice') this.focusPawn(s.turn.player, true, true);
    this.syncProps(s);
    this.syncPlayers(s);
  }

  /** Режим «Следить»: склейка на фишку игрока; камера остаётся на ней, пока что-то не произойдёт. */
  focusPawn(pid: PlayerId, force = false, smoothly = false) {
    if (!this.follow || (!force && this.userGrab)) return;
    const pw = this.pawns.get(pid);
    if (!pw || !pw.obj.visible) return;
    const pos = pw.obj.position.clone();
    this.moveShot(pw.obj, pos, Math.abs(pos.x) < 9 && Math.abs(pos.z) < 9 && this.isSmallSpot(pos), !smoothly);
  }
  private isSmallSpot(p: THREE.Vector3) {
    // биржа и рулетка — мелкие клетки, камера ближе
    const b = this.board;
    const near = (xy: [number, number], r: number) => { const w = this.px(xy[0], xy[1]); return Math.hypot(w.x - p.x, w.z - p.z) < r; };
    return b.roulette.sectors.some((x) => near(x.xy, 0.5)) || b.exchange.lanes.some((l) => l.cells.some((c) => near(c, 0.3)));
  }

  floatText(at: THREE.Vector3, text: string, color: string) {
    const el = document.createElement('div');
    el.className = 'float-text';
    el.textContent = text;
    el.style.color = color;
    const o = new CSS2DObject(el);
    o.position.copy(at).add(new THREE.Vector3(0, 1.6, 0));
    this.scene.add(o);
    const y0 = o.position.y;
    this.tweens.push({ t: 0, dur: 1.6, fn: (k) => { o.position.y = y0 + k * 1.2; el.style.opacity = String(1 - Math.max(0, k - 0.6) / 0.4); }, done: () => { this.scene.remove(o); el.remove(); } });
  }

  rollDice(values: number[], player?: PlayerId) {
    const area = { cx: 0.6, cz: 2.1, w: 6.5, d: 5, floorY: TOP };
    // бросок рядом с фишкой игрока: чуть впереди неё, в сторону центра поля (не налетая на фишку и не за край)
    let from: { x: number; z: number; dx: number; dz: number } | undefined;
    const pw = player ? this.pawns.get(player) : undefined;
    if (pw && pw.obj.visible) {
      const p = pw.obj.position;
      let dx = -p.x, dz = -p.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.5) { dx = -1; dz = 0; } else { dx /= len; dz /= len; }
      from = { x: clamp(p.x + dx * 1.3, -8.4, 8.4), z: clamp(p.z + dz * 1.3, -8.4, 8.4), dx, dz };
    }
    const size = 0.62;
    const run = simulateDice(values, area, size, Math.random(), from);
    this.dice.forEach((d, i) => { d.visible = i < values.length; if (i < values.length) (d.children[0] as THREE.Object3D).quaternion.copy(run.fix[i]); });
    if (this.cine()) this.diceShot(run, values.length);
    sfx.shake();
    return new Promise<void>((resolve) => { this.diceRun = { run, f: 0, resolve }; });
  }

  // ------------------------------------------------------------ камера-режиссёр
  private cine() { return this.follow && !this.userGrab; }
  private userTook = () => {
    if (this.shot) this.userGrab = true;
    this.shot = null;
    this.homeDirty = true;
  };
  /** «домашний» ракурс — тот, что выбрал пользователь; к нему (ближе) камера возвращается после хода */
  private captureHome() {
    this.sph.setFromVector3(this.v1.copy(this.camera.position).sub(this.controls.target));
    this.home.f.copy(this.controls.target);
    this.home.r = this.sph.radius; this.home.phi = this.sph.phi; this.home.th = this.sph.theta;
    this.homeDirty = false;
  }
  /** cut = мгновенная склейка (без пролёта): камера сразу встаёт в кадр, дальше — плавное слежение */
  private direct(s: Shot, cut = false) {
    if (cut) {
      if (this.homeDirty) this.captureHome();
      this.rig.f.copy(s.f); this.rig.r = s.r; this.rig.phi = s.phi; this.rig.th = s.th;
      this.vel.fill(0);
      this.camera.position.setFromSpherical(this.sph.set(s.r, s.phi, s.th)).add(s.f);
      this.controls.target.copy(s.f);
      this.shot = s;
      return s;
    }
    if (!this.shot) {
      if (this.homeDirty) this.captureHome();
      this.sph.setFromVector3(this.v1.copy(this.camera.position).sub(this.controls.target));
      this.rig.f.copy(this.controls.target);
      this.rig.r = this.sph.radius; this.rig.phi = this.sph.phi; this.rig.th = this.sph.theta;
      this.vel.fill(0);
    }
    this.shot = s;
    return s;
  }
  /** азимут, слегка обходящий поле вслед за точкой (непрерывен, без скачков на «обратной» стороне) */
  private thFor(p: THREE.Vector3) {
    const d = Math.hypot(p.x, p.z);
    const w = clamp((d - 3) / 5, 0, 1);
    return this.home.th + CAM.moveSwing * w * Math.sin(wrap(Math.atan2(p.x, p.z) - this.home.th));
  }
  private diceShot(run: DiceRun, n: number) {
    const last = run.frames[run.frames.length - 1];
    const end = new THREE.Vector3();
    let spread = 0;
    for (let i = 0; i < n; i++) {
      end.add(last.p[i]);
      for (let j = i + 1; j < n; j++) spread = Math.max(spread, Math.hypot(last.p[i].x - last.p[j].x, last.p[i].z - last.p[j].z));
    }
    end.divideScalar(n); end.y = TOP;
    const rEnd = clamp(CAM.diceRMin + spread * 0.6, CAM.diceRMin, CAM.diceRMax);
    const th = this.home.th + CAM.diceTh;
    this.direct({
      kind: 'dice', auto: true, f: end.clone(), r: CAM.diceR0, phi: CAM.dicePhi0, th,
      sf: 0.3, sr: 0.45, sth: 0.55, landing: end,
      track: (s) => {
        const dr = this.diceRun;
        if (!dr || dr.run !== run) return;
        const k = smooth(clamp(dr.f / run.frames.length, 0, 1));
        const c = this.v2.set(0, 0, 0);
        for (let i = 0; i < n; i++) c.add(this.dice[i].position);
        c.divideScalar(n); c.y = TOP;
        s.f.lerpVectors(c, end, Math.min(1, k * 1.3));
        s.r = lerp(CAM.diceR0, rEnd, k);
        s.phi = lerp(CAM.dicePhi0, CAM.dicePhi1, k);
      },
    }); // плавно: кубики падают рядом с фишкой, камера перетекает к ним
  }
  /** cut — склейка (смена хода); иначе плавный переход (например, от кубиков к фишке). */
  private moveShot(obj: THREE.Object3D, final: THREE.Vector3, small: boolean, cut = false) {
    const f = obj.position.clone(); f.y = TOP;
    return this.direct({
      kind: 'move', auto: true, f, r: small ? CAM.moveRSmall : CAM.moveR, phi: small ? CAM.movePhiSmall : CAM.movePhi, th: this.thFor(f),
      sf: CAM.smoothF, sr: CAM.smoothR, sth: CAM.smoothTh,
      track: (s) => {
        if (s.release !== undefined) return;
        const p = obj.position;
        // упреждение: к цели текущего прыжка (компенсирует отставание сглаживания) и чуть к финишу
        const hopTo = (obj.userData.hopTo as THREE.Vector3 | undefined) ?? final;
        const lead = this.v2.subVectors(hopTo, p); lead.y = 0;
        const ll = lead.length();
        if (ll > 1e-4) lead.multiplyScalar(Math.min(ll, CAM.moveLead) / ll);
        s.f.copy(p).add(lead);
        const look = this.v2.subVectors(final, s.f); look.y = 0;
        const len = look.length();
        if (len > 1e-4) s.f.addScaledVector(look, Math.min(0.2, CAM.moveLook / len));
        s.f.y = TOP;
        s.th = this.thFor(s.f);
      },
    }, cut);
  }
  private teleShot(obj: THREE.Object3D, to: THREE.Vector3, small: boolean) {
    const from = obj.position.clone();
    const dist = Math.max(0.01, from.distanceTo(to));
    const rBig = clamp(CAM.teleR + dist * 0.45, CAM.teleR, CAM.teleRMax);
    const rEnd = small ? CAM.moveRSmall : CAM.moveR;
    const f = from.clone().lerp(to, 0.5); f.y = TOP;
    return this.direct({
      kind: 'tele', auto: true, f, r: rBig, phi: CAM.movePhi, th: this.thFor(to),
      sf: 0.32, sr: 0.5, sth: CAM.smoothTh,
      track: (s) => {
        if (s.release !== undefined) return;
        const p = obj.position;
        const rem = clamp(Math.hypot(p.x - to.x, p.z - to.z) / dist, 0, 1);
        s.f.set((p.x + to.x) / 2, TOP + Math.max(0, p.y - TOP) * 0.35, (p.z + to.z) / 2);
        s.r = lerp(rEnd, rBig, smooth(rem));
      },
    }, true);
  }
  /** общий план после действия: ближе к пользовательскому ракурсу, со сдвигом к месту события */
  private overview(at?: THREE.Vector3) {
    const h = this.home;
    const f = h.f.clone();
    if (at) { f.lerp(at, CAM.overPull); f.y = 0; }
    this.shot = {
      kind: 'over', auto: true, f, r: clamp(h.r, CAM.overRMin, CAM.overRMax), phi: Math.min(h.phi, CAM.overPhiMax), th: h.th,
      sf: CAM.smoothOver, sr: CAM.smoothOver * 1.2, sth: CAM.smoothOver * 1.2, until: this.elapsed + 4,
    };
  }
  /** совместимость: плавный наезд на точку */
  focus(target: THREE.Vector3, close: boolean) {
    const f = target.clone(); f.y = 0;
    this.direct({ kind: 'goal', auto: false, f, r: close ? 12 : clamp(this.rig.r, 18, 30), phi: close ? 0.72 : 0.65, th: this.home.th, sf: 0.5, sr: 0.6, sth: 0.6, until: this.elapsed + 4 });
  }
  private goTo(target: THREE.Vector3, pos: THREE.Vector3) {
    this.sph.setFromVector3(this.v1.copy(pos).sub(target));
    this.direct({ kind: 'goal', auto: false, f: target.clone(), r: this.sph.radius, phi: this.sph.phi, th: this.sph.theta, sf: 0.45, sr: 0.55, sth: 0.55, until: this.elapsed + 4 });
    this.home.f.copy(target); this.home.r = this.sph.radius; this.home.phi = this.sph.phi; this.home.th = this.sph.theta;
    this.homeDirty = false;
  }
  /** Предпросмотр клетки (наведение на вариант выбора): камера к клетке + подсветка; null — вернуться к фишке. */
  private previewKey = '';
  preview(pos: Pos | null, focusY?: number) {
    // клетку показываем в видимой части экрана (над окном выбора), а не под ним
    this.viewDyGoal = pos && focusY !== undefined ? Math.max(0, this.host.clientHeight / 2 - focusY) : this.baseDy;
    if (pos) {
      const key = JSON.stringify(pos);
      if (key === this.previewKey && this.previewRing.visible) return; // уже показываем эту клетку
      this.previewKey = key;
      const w = this.worldOf(pos);
      const small = pos.z === 'x' || pos.z === 'r';
      if (!this.previewSaved) this.previewSaved = { f: this.controls.target.clone(), pos: this.camera.position.clone() };
      this.previewRing.position.set(w.x, TOP + 0.014, w.z);
      this.previewRing.scale.setScalar(small ? 0.42 : 1);
      this.previewRing.visible = true;
      const f = new THREE.Vector3(w.x, TOP, w.z);
      this.direct({ kind: 'goal', auto: false, f, r: small ? CAM.moveRSmall : CAM.moveR, phi: small ? CAM.movePhiSmall : CAM.movePhi, th: this.thFor(f), sf: 0.12, sr: 0.16, sth: 0.18, until: this.elapsed + 3 });
      return;
    }
    this.previewRing.visible = false;
    this.previewKey = '';
    const saved = this.previewSaved;
    this.previewSaved = null;
    if (!saved) return;
    if (this.follow && this.curPlayer) { this.focusPawn(this.curPlayer, true, true); return; }
    this.sph.setFromVector3(this.v1.copy(saved.pos).sub(saved.f));
    this.direct({ kind: 'goal', auto: false, f: saved.f, r: this.sph.radius, phi: this.sph.phi, th: this.sph.theta, sf: 0.12, sr: 0.16, sth: 0.18, until: this.elapsed + 3 });
  }
  resetView() { this.goTo(new THREE.Vector3(0, 0, 0.8), new THREE.Vector3(0, 24, 19)); }
  topView() { this.goTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 30, 0.01)); }

  private damp(i: number, cur: number, goal: number, st: number, dt: number) {
    const w = 2 / st, x = w * dt, e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const ch = cur - goal, tmp = (this.vel[i] + w * ch) * dt;
    this.vel[i] = (this.vel[i] - w * tmp) * e;
    return goal + (ch + tmp) * e;
  }
  private direction(dt: number): void {
    const s = this.shot;
    if (!s) return;
    if (s.auto && !this.follow) { this.shot = null; return; }
    if (s.release !== undefined && this.elapsed >= s.release) { this.overview(s.landing); this.direction(dt); return; }
    s.track?.(s);
    const g = this.rig;
    g.f.x = this.damp(0, g.f.x, s.f.x, s.sf, dt);
    g.f.y = this.damp(1, g.f.y, s.f.y, s.sf, dt);
    g.f.z = this.damp(2, g.f.z, s.f.z, s.sf, dt);
    g.r = clamp(this.damp(3, g.r, s.r, s.sr, dt), this.controls.minDistance + 0.05, this.controls.maxDistance);
    g.phi = clamp(this.damp(4, g.phi, s.phi, s.sr, dt), 0.02, 1.25);
    g.th = this.damp(5, g.th, g.th + wrap(s.th - g.th), s.sth, dt);
    this.camera.position.setFromSpherical(this.sph.set(g.r, g.phi, g.th)).add(g.f);
    this.controls.target.copy(g.f);
    if ((s.kind === 'over' || s.kind === 'goal') && (this.elapsed > (s.until ?? Infinity) || (
      g.f.distanceToSquared(s.f) < 4e-4 && Math.abs(g.r - s.r) < 0.03 && Math.abs(g.phi - s.phi) < 0.003 && Math.abs(wrap(g.th - s.th)) < 0.003))) this.shot = null;
  }
  /** толчок камеры (приземление) */
  private kick(a: number) { if (this.follow) this.shakeAmp = Math.max(this.shakeAmp, a); }

  // ------------------------------------------------------------ пыль при приземлении
  private makeDust() {
    const g = new THREE.RingGeometry(0.22, 0.4, 40);
    g.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xf4e4c4, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      m.visible = false; m.renderOrder = 4;
      this.scene.add(m);
      this.dust.push(m);
    }
  }
  private puff(at: THREE.Vector3, size: number, strength: number) {
    const m = this.dust[this.dustI++ % this.dust.length];
    const mat = m.material as THREE.MeshBasicMaterial;
    m.position.set(at.x, TOP + 0.014, at.z);
    m.visible = true;
    this.tweens.push({
      t: 0, dur: 0.5,
      fn: (k) => { const e = 1 - (1 - k) * (1 - k) * (1 - k); m.scale.setScalar(size * (0.55 + 1.2 * e)); mat.opacity = strength * (1 - k) * (1 - k); },
      done: () => { m.visible = false; },
    });
  }

  // ------------------------------------------------------------ наведение
  private pick(ev: PointerEvent | MouseEvent): HoverInfo | null {
    if (!this.boardMesh) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.boardMesh)[0];
    if (!hit) return null;
    const x = (hit.point.x + BOARD / 2) / PX, y = (hit.point.z + BOARD / 2) / PX;
    let best: { d: number; info: HoverInfo; xy: [number, number] } | null = null;
    const consider = (xy: [number, number], info: Omit<HoverInfo, 'x' | 'y'>, r: number) => {
      const d = Math.hypot(xy[0] - x, xy[1] - y);
      if (d < r && (!best || d < best.d)) best = { d, info: { ...info, x: ev.clientX, y: ev.clientY }, xy };
    };
    for (const c of this.board.cells) consider(c.xy, { kind: 'cell', id: c.id }, c.zone === 'outer' ? 105 : 95);
    for (const h of this.board.highway) consider(h.xy, { kind: 'hw', id: h.n }, 80);
    for (const s of this.board.roulette.sectors) consider(s.xy, { kind: 'rl', id: s.slot }, 40);
    for (const l of this.board.exchange.lanes) l.cells.forEach((xy, i) => consider(xy, { kind: 'ex', id: `${l.color}:${i + 1}` }, 22));
    const b = best as { d: number; info: HoverInfo; xy: [number, number] } | null;
    if (b) {
      const p = this.px(b.xy[0], b.xy[1]);
      this.hoverRing.position.set(p.x, TOP + 0.01, p.z);
      this.hoverRing.scale.setScalar(b.info.kind === 'ex' || b.info.kind === 'rl' ? 0.35 : 1);
      this.hoverRing.visible = true;
      return b.info;
    }
    this.hoverRing.visible = false;
    this.previewRing = this.ring(0xffd36a, 0.5, 0.74);
    this.previewRing.visible = false;
    return null;
  }
  private pointerMove = (ev: PointerEvent) => {
    if (ev.buttons) { if (this.ctrlActive) this.userTook(); return; }
    this.onHover?.(this.pick(ev));
  };
  private click = (ev: MouseEvent) => { const h = this.pick(ev); if (h) this.onCellClick?.(h); };

  // ------------------------------------------------------------ цикл
  private loop = () => {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const t = (this.elapsed += dt);
    for (let i = 0; i < this.tweens.length; i++) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { this.tweens.splice(i--, 1); tw.done?.(); }
    }
    if (this.diceRun) {
      const { run } = this.diceRun;
      const f = Math.min(run.frames.length - 1, Math.floor(this.diceRun.f));
      const fr = run.frames[f];
      for (let i = 0; i < this.dice.length; i++) if (fr.p[i]) { this.dice[i].position.copy(fr.p[i]); this.dice[i].quaternion.copy(fr.q[i]); }
      if (run.hits.includes(f) && Math.floor(this.diceRun.f - dt * 60) < f) { sfx.clack(); if (f === run.hits[0]) this.kick(0.035); }
      this.diceRun.f += dt * 60 * CAM.diceSpeed;
      if (this.diceRun.f >= run.frames.length) {
        const r = this.diceRun.resolve;
        this.diceRun = null;
        // кубики легли: короткая пауза крупным планом; если хода не последует — уйдём на общий план
        // кубики легли: короткая пауза; дальше камера переключится на фишку
        setTimeout(r, CAM.diceHold * 1000);
      }
    }
    const pulse = 0.6 + Math.sin(t * 3.2) * 0.25;
    (this.activeRing.material as THREE.MeshBasicMaterial).opacity = pulse;
    this.activeRing.rotation.y = t * 0.6;
    if (Math.abs(this.viewDy - this.viewDyGoal) > 0.5) {
      this.viewDy += (this.viewDyGoal - this.viewDy) * Math.min(1, dt * 10);
      if (Math.abs(this.viewDy - this.viewDyGoal) <= 0.5) this.viewDy = this.viewDyGoal;
      this.applyViewShift();
    }
    this.direction(dt);
    this.controls.update();
    // толчок камеры поверх итогового положения (после update, чтобы не сбивать OrbitControls)
    const shaking = this.shakeAmp > 0.002;
    if (shaking) {
      const a = this.shakeAmp;
      this.shakeSaved.copy(this.camera.position);
      this.camera.position.x += Math.sin(t * 61) * a;
      this.camera.position.y += Math.sin(t * 47 + 1.3) * a * 1.4;
      this.camera.position.z += Math.sin(t * 53 + 2.1) * a;
      this.shakeAmp *= Math.exp(-dt * 9);
    }
    if (this.quality === 'high') this.composer.render(); else this.renderer.render(this.scene, this.camera);
    // подписи висят строго над фишками (только позиция, без вращения фишки)
    for (const pw of this.pawns.values()) {
      pw.label.visible = pw.obj.visible;
      pw.label.position.set(pw.obj.position.x, pw.obj.position.y + LABEL_H * pw.obj.scale.y, pw.obj.position.z);
    }
    this.labels.render(this.scene, this.camera);
    if (shaking) this.camera.position.copy(this.shakeSaved);
  };
}
