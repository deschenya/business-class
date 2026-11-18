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

const BOARD = 20; // размер поля в мировых единицах
const TOP = 0.16; // высота верхней грани поля
const PX = BOARD / 2048;

type Tween = { t: number; dur: number; fn: (k: number) => void; done?: () => void };
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

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
  private last = performance.now();
  private elapsed = 0;
  follow = true;
  camGoal: { target: THREE.Vector3; pos?: THREE.Vector3 } | null = null;
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
    r.toneMappingExposure = 0.92;
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
    this.controls.addEventListener('start', () => { this.camGoal = null; });

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;
    this.scene.background = new THREE.Color(0x0d0907);
    this.scene.fog = new THREE.FogExp2(0x0d0907, 0.018);

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.16, 0.4, 0.97));
    this.composer.addPass(new OutputPass());

    this.lights();
    this.activeRing = this.ring(0xffd36a, 0.62, 0.78);
    this.hoverRing = this.ring(0xffffff, 0.5, 0.58);
    this.hoverRing.visible = false;
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
    this.camera.updateProjectionMatrix();
  };

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
    const top = new THREE.MeshPhysicalMaterial({ map, roughness: 0.62, clearcoat: 0.18, clearcoatRoughness: 0.5 });
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
  syncPlayers(s: GameState) {
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
        label.position.set(0, 1.25, 0);
        obj.add(label);
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
  private hop(obj: THREE.Object3D, to: THREE.Vector3, dur: number, height: number) {
    const from = obj.position.clone();
    const base = obj.children[0];
    return new Promise<void>((res) => this.tweens.push({
      t: 0, dur,
      fn: (k) => {
        obj.position.lerpVectors(from, to, k);
        obj.position.y = from.y + (to.y - from.y) * k + Math.sin(Math.PI * k) * height;
        const sq = k > 0.85 ? 1 - (1 - (k - 0.85) / 0.15) * 0.18 : 1;
        if (base) base.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
      },
      done: () => { if (base) base.scale.set(1, 1, 1); res(); },
    }));
  }

  async play(events: GameEvent[], s: GameState, speed = 1) {
    for (const e of events) {
      if (this.disposed) return;
      if (e.t === 'dice') await this.rollDice(e.values);
      else if (e.t === 'move') {
        const pw = this.pawns.get(e.player);
        if (!pw) continue;
        pw.busy = true;
        if (this.follow) this.focus(this.worldOf(e.path[e.path.length - 1]), false);
        for (let i = 1; i < e.path.length; i++) {
          const pos = e.path[i];
          await this.hop(pw.obj, this.worldOf(pos), (pos.z === 'r' ? 0.14 : 0.24) / speed, pos.z === 'r' ? 0.25 : 0.55);
          sfx.tap();
        }
        pw.busy = false;
      } else if (e.t === 'teleport') {
        const pw = this.pawns.get(e.player);
        if (!pw) continue;
        pw.busy = true;
        const to = this.worldOf(e.to);
        if (this.follow) this.focus(to, e.to.z === 'x' || e.to.z === 'r');
        sfx.whoosh();
        await this.hop(pw.obj, to, 0.75 / speed, 3);
        sfx.tap();
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
        if (e.to !== 'bank') sfx.coin();
      }
    }
    this.syncProps(s);
    this.syncPlayers(s);
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

  rollDice(values: number[]) {
    const area = { cx: 0.6, cz: 2.1, w: 6.5, d: 5, floorY: TOP };
    const size = 0.62;
    const run = simulateDice(values, area, size);
    this.dice.forEach((d, i) => { d.visible = i < values.length; if (i < values.length) (d.children[0] as THREE.Object3D).quaternion.copy(run.fix[i]); });
    if (this.follow) this.focus(new THREE.Vector3(area.cx, 0, area.cz), false);
    sfx.shake();
    return new Promise<void>((resolve) => { this.diceRun = { run, f: 0, resolve }; });
  }

  focus(target: THREE.Vector3, close: boolean) {
    const t = target.clone(); t.y = 0;
    // сохраняем азимут камеры, но держим комфортный угол и дистанцию
    const off = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.radius = close ? 15 : Math.min(Math.max(sph.radius, 22), 30);
    sph.phi = close ? 0.72 : Math.min(Math.max(sph.phi, 0.5), 0.78);
    const goal = this.controls.target.clone().lerp(t, close ? 0.85 : 0.4);
    this.camGoal = { target: goal, pos: goal.clone().add(new THREE.Vector3().setFromSpherical(sph)) };
  }
  resetView() {
    this.camGoal = { target: new THREE.Vector3(0, 0, 0.8), pos: new THREE.Vector3(0, 24, 19) };
  }
  topView() {
    this.camGoal = { target: new THREE.Vector3(0, 0, 0), pos: new THREE.Vector3(0, 30, 0.01) };
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
    return null;
  }
  private pointerMove = (ev: PointerEvent) => { if (ev.buttons) return; this.onHover?.(this.pick(ev)); };
  private click = (ev: MouseEvent) => { const h = this.pick(ev); if (h) this.onCellClick?.(h); };

  // ------------------------------------------------------------ цикл
  private loop = () => {
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const t = (this.elapsed += dt);
    for (const tw of [...this.tweens]) {
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { this.tweens.splice(this.tweens.indexOf(tw), 1); tw.done?.(); }
    }
    if (this.diceRun) {
      const { run } = this.diceRun;
      const f = Math.min(run.frames.length - 1, Math.floor(this.diceRun.f));
      const fr = run.frames[f];
      this.dice.forEach((d, i) => { if (fr.p[i]) { d.position.copy(fr.p[i]); d.quaternion.copy(fr.q[i]); } });
      if (run.hits.includes(f) && Math.floor(this.diceRun.f - dt * 60) < f) sfx.clack();
      this.diceRun.f += dt * 60;
      if (this.diceRun.f >= run.frames.length) { const r = this.diceRun.resolve; this.diceRun = null; setTimeout(r, 250); }
    }
    const pulse = 0.6 + Math.sin(t * 3.2) * 0.25;
    (this.activeRing.material as THREE.MeshBasicMaterial).opacity = pulse;
    this.activeRing.rotation.y = t * 0.6;
    if (this.camGoal) {
      this.controls.target.lerp(this.camGoal.target, 0.06);
      if (this.camGoal.pos) this.camera.position.lerp(this.camGoal.pos, 0.05);
      if (this.controls.target.distanceTo(this.camGoal.target) < 0.02) this.camGoal = null;
    }
    this.controls.update();
    if (this.quality === 'high') this.composer.render(); else this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  };
}
