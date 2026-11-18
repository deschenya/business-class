"""Blender 4.2+: моделирует игровые компоненты и экспортирует public/models/pieces.glb.

Объекты (имена узлов в GLB):
  Die        — кубик со скруглёнными гранями и углублёнными точками.
               Раскладка граней (в координатах glTF/three.js, Y вверх):
               +Y=1, -Y=6, +X=2, -X=5, +Z=3, -Z=4 (противоположные грани дают 7).
  Pawn       — фишка игрока (материал PawnBody перекрашивается в цвет игрока).
  PlotFlag   — метка участка (флажок).
  Branch     — метка филиала (домик).
  Enterprise — метка предприятия (башня).
  Coin       — монета для эффектов.
Запуск: npm run models
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'models')
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name, color, rough=0.4, metal=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if 'Coat Weight' in b.inputs:
        b.inputs['Coat Weight'].default_value = coat
    return m


M_IVORY = mat('DieBody', (0.93, 0.89, 0.80), 0.25, 0.0, 0.6)
M_PIP = mat('Pip', (0.02, 0.02, 0.025), 0.5)
M_PAWN = mat('PawnBody', (0.9, 0.9, 0.9), 0.18, 0.0, 1.0)
M_MARK = mat('Marker', (0.9, 0.9, 0.9), 0.3, 0.0, 0.5)
M_ROOF = mat('Roof', (0.55, 0.12, 0.08), 0.5)
M_GLASS = mat('Glass', (0.12, 0.2, 0.3), 0.05, 0.6)
M_GOLD = mat('Gold', (1.0, 0.76, 0.33), 0.25, 1.0)
M_WOOD = mat('PoleWood', (0.35, 0.22, 0.12), 0.6)


def select_only(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def apply_all(o):
    select_only(o)
    for m in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def shade_smooth(o, angle=40):
    select_only(o)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        bpy.ops.object.shade_smooth()


# ---------------------------------------------------------------- Die
def make_die():
    bpy.ops.mesh.primitive_cube_add(size=1.0)
    d = bpy.context.object
    d.name = 'Die'
    d.data.materials.append(M_IVORY)
    d.data.materials.append(M_PIP)
    bev = d.modifiers.new('bev', 'BEVEL')
    bev.width = 0.12
    bev.segments = 6
    bev.limit_method = 'NONE'
    apply_all(d)

    r = 0.085
    off = 0.25
    h = 0.5
    # Blender coords (Z up). Mapping to glTF: X->X, Z->Y, -Y->Z
    faces = {
        1: (Vector((0, 0, 1)), [(0, 0)]),
        6: (Vector((0, 0, -1)), [(-off, -off), (-off, 0), (-off, off), (off, -off), (off, 0), (off, off)]),
        2: (Vector((1, 0, 0)), [(-off, -off), (off, off)]),
        5: (Vector((-1, 0, 0)), [(-off, -off), (-off, off), (0, 0), (off, -off), (off, off)]),
        3: (Vector((0, -1, 0)), [(-off, -off), (0, 0), (off, off)]),
        4: (Vector((0, 1, 0)), [(-off, -off), (-off, off), (off, -off), (off, off)]),
    }
    cutters = []
    for val, (n, pts) in faces.items():
        # два касательных вектора грани
        t1 = Vector((1, 0, 0)) if abs(n.x) < 0.5 else Vector((0, 1, 0))
        t2 = n.cross(t1)
        for (a, b) in pts:
            p = n * (h + r * 0.45) + t1 * a + t2 * b
            bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=p, segments=20, ring_count=10)
            c = bpy.context.object
            c.data.materials.append(M_PIP)
            cutters.append(c)
    # объединяем все «пробойники» в один объект и вычитаем одним булеаном
    select_only(cutters[0])
    for c in cutters[1:]:
        c.select_set(True)
    bpy.ops.object.join()
    cut = bpy.context.object
    boo = d.modifiers.new('pips', 'BOOLEAN')
    boo.operation = 'DIFFERENCE'
    boo.solver = 'EXACT'
    boo.object = cut
    try:
        boo.material_mode = 'TRANSFER'
    except Exception:
        pass
    apply_all(d)
    bpy.data.objects.remove(cut, do_unlink=True)
    shade_smooth(d, 35)
    return d


# ---------------------------------------------------------------- Pawn (lathe)
def lathe(name, profile, segs=48):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        ring = [bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for (r, z) in profile]
        rings.append(ring)
    for i in range(segs):
        r0, r1 = rings[i], rings[(i + 1) % segs]
        for j in range(len(profile) - 1):
            bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
    # крышки
    bottom = bm.verts.new((0, 0, profile[0][1]))
    top = bm.verts.new((0, 0, profile[-1][1]))
    for i in range(segs):
        r0, r1 = rings[i], rings[(i + 1) % segs]
        bm.faces.new((r1[0], r0[0], bottom))
        if profile[-1][0] > 1e-4:
            bm.faces.new((r0[-1], r1[-1], top))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o


def make_pawn():
    prof = [
        (0.0, 0.0), (0.30, 0.0), (0.33, 0.015), (0.34, 0.045), (0.33, 0.075), (0.29, 0.095),
        (0.24, 0.11), (0.20, 0.14), (0.165, 0.20), (0.14, 0.28), (0.12, 0.38), (0.11, 0.46),
        (0.17, 0.49), (0.19, 0.51), (0.17, 0.535), (0.11, 0.55), (0.10, 0.58),
        (0.15, 0.62), (0.185, 0.67), (0.20, 0.73), (0.19, 0.79), (0.16, 0.84),
        (0.11, 0.88), (0.05, 0.905), (0.0, 0.91),
    ]
    p = lathe('Pawn', prof)
    p.data.materials.append(M_PAWN)
    shade_smooth(p, 50)
    return p


def make_coin():
    prof = [(0.0, 0.0), (0.46, 0.0), (0.5, 0.02), (0.5, 0.06), (0.46, 0.08), (0.40, 0.075), (0.38, 0.085), (0.0, 0.085)]
    c = lathe('Coin', prof, 40)
    c.data.materials.append(M_GOLD)
    shade_smooth(c, 30)
    return c


# ---------------------------------------------------------------- Markers
def join(objs, name):
    select_only(objs[0])
    for o in objs[1:]:
        o.select_set(True)
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    return o


def make_flag():
    bpy.ops.mesh.primitive_cylinder_add(radius=0.025, depth=0.9, location=(0, 0, 0.45), vertices=12)
    pole = bpy.context.object
    pole.data.materials.append(M_GOLD)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.16, depth=0.06, location=(0, 0, 0.03), vertices=32)
    base = bpy.context.object
    base.data.materials.append(M_MARK)
    # флаг — немного изогнутая пластина
    me = bpy.data.meshes.new('flag')
    bm = bmesh.new()
    W, H, N = 0.42, 0.28, 8
    vs = []
    for i in range(N + 1):
        x = W * i / N
        y = 0.04 * math.sin(i / N * math.pi * 1.5)
        vs.append((bm.verts.new((x + 0.02, y, 0.86)), bm.verts.new((x + 0.02, y, 0.86 - H))))
    for i in range(N):
        bm.faces.new((vs[i][0], vs[i + 1][0], vs[i + 1][1], vs[i][1]))
    bm.to_mesh(me)
    bm.free()
    fl = bpy.data.objects.new('flagobj', me)
    scene.collection.objects.link(fl)
    sol = fl.modifiers.new('s', 'SOLIDIFY')
    sol.thickness = 0.02
    apply_all(fl)
    fl.data.materials.append(M_MARK)
    o = join([base, pole, fl], 'PlotFlag')
    shade_smooth(o, 30)
    return o


def make_house():
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.25))
    body = bpy.context.object
    body.scale = (0.5, 0.42, 0.5)
    body.data.materials.append(M_MARK)
    bev = body.modifiers.new('b', 'BEVEL'); bev.width = 0.02; bev.segments = 2
    apply_all(body)
    select_only(body); bpy.ops.object.transform_apply(scale=True)
    # крыша — призма
    me = bpy.data.meshes.new('roof')
    bm = bmesh.new()
    w, d, z0, z1, ov = 0.30, 0.25, 0.5, 0.78, 0.05
    v = [bm.verts.new(p) for p in [(-w, -d, z0), (w, -d, z0), (w, d, z0), (-w, d, z0), (-w, 0, z1), (w, 0, z1)]]
    bm.faces.new((v[0], v[1], v[5], v[4]))
    bm.faces.new((v[2], v[3], v[4], v[5]))
    bm.faces.new((v[0], v[4], v[3]))
    bm.faces.new((v[1], v[2], v[5]))
    bm.faces.new((v[0], v[3], v[2], v[1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    roof = bpy.data.objects.new('roofobj', me); scene.collection.objects.link(roof)
    roof.data.materials.append(M_ROOF)
    # дверь и окна
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.212, 0.13)); door = bpy.context.object
    door.scale = (0.1, 0.01, 0.2); door.data.materials.append(M_WOOD)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-0.14, -0.212, 0.32)); w1 = bpy.context.object
    w1.scale = (0.09, 0.01, 0.09); w1.data.materials.append(M_GLASS)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.14, -0.212, 0.32)); w2 = bpy.context.object
    w2.scale = (0.09, 0.01, 0.09); w2.data.materials.append(M_GLASS)
    for o in (door, w1, w2):
        select_only(o); bpy.ops.object.transform_apply(scale=True)
    o = join([body, roof, door, w1, w2], 'Branch')
    return o


def make_tower():
    parts = []
    levels = [(0.56, 0.0, 0.22), (0.46, 0.22, 0.42), (0.36, 0.64, 0.38), (0.22, 1.02, 0.18)]
    for i, (s, z, h) in enumerate(levels):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, z + h / 2))
        c = bpy.context.object
        c.scale = (s, s, h)
        select_only(c); bpy.ops.object.transform_apply(scale=True)
        bev = c.modifiers.new('b', 'BEVEL'); bev.width = 0.015; bev.segments = 2
        apply_all(c)
        c.data.materials.append(M_MARK)
        parts.append(c)
        # полосы окон
        if i < 3:
            for k in range(2 if i else 1):
                zz = z + h * (0.35 + 0.35 * k) if i else z + h * 0.55
                bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, zz))
                g = bpy.context.object
                g.scale = (s + 0.012, s + 0.012, 0.055)
                select_only(g); bpy.ops.object.transform_apply(scale=True)
                g.data.materials.append(M_GLASS)
                parts.append(g)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=0.3, location=(0, 0, 1.35), vertices=8)
    sp = bpy.context.object; sp.data.materials.append(M_GOLD); parts.append(sp)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, location=(0, 0, 1.5), segments=12, ring_count=6)
    ball = bpy.context.object; ball.data.materials.append(M_GOLD); parts.append(ball)
    return join(parts, 'Enterprise')


objs = [make_die(), make_pawn(), make_flag(), make_house(), make_tower(), make_coin()]
for i, o in enumerate(objs):
    o.location = (i * 1.6, 0, 0)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'pieces.glb'),
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_yup=True,
)

# превью для проверки
if '--preview' in sys.argv:
    bpy.ops.object.camera_add(location=(4, -7, 4.5))
    cam = bpy.context.object
    cam.rotation_euler = (math.radians(62), 0, math.radians(18))
    scene.camera = cam
    bpy.ops.object.light_add(type='AREA', location=(3, -3, 6)); bpy.context.object.data.energy = 900
    bpy.context.object.data.size = 5
    world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.15, 0.13, 0.12, 1)
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if bpy.app.version >= (4, 2, 0) else 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1400, 700
    scene.render.filepath = os.path.join(OUT, '..', '..', 'tools', 'pieces_preview.png')
    bpy.ops.render.render(write_still=True)
print('EXPORTED', os.path.join(OUT, 'pieces.glb'))
