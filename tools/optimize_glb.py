"""Shrink the generated 3D models for the web hero (no third-party packages).

    python3 tools/optimize_glb.py car  <in.glb> assets/3d/car.glb
    python3 tools/optimize_glb.py crew <in.glb> assets/3d/crew.glb

car:  removes the four wheels (the hero fits its own, so one can go missing and the rest can spin),
      drops unused vertices, quantizes positions, normals and UVs (KHR_mesh_quantization),
      and re-encodes the texture at 2048px.
crew: quantizes normals, UVs and skin weights and re-encodes the texture at 1536px; the skin stays as it is.
Textures are resized with macOS `sips`.
"""
import json, math, os, struct, subprocess, sys, tempfile
from array import array

# wheel volumes in the car model's own space (metres after the node's scale): x is half-track, y/z the hub
WHEELS = [dict(x=0.70, y=-0.22, z=1.02, r=0.285, hw=0.17), dict(x=0.66, y=-0.21, z=-1.25, r=0.285, hw=0.21)]
COMP = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    b = open(path, 'rb').read()
    jlen = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + jlen])
    blen = struct.unpack('<I', b[20 + jlen:24 + jlen])[0]
    return j, b[28 + jlen:28 + jlen + blen]


def read_accessor(j, bin_, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    code, size = COMP[a['componentType']]
    n = NCOMP[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', size * n)
    out = []
    for k in range(a['count']):
        o = start + k * stride
        v = struct.unpack_from('<' + code * n, bin_, o)
        out.append(v if n > 1 else v[0])
    return out


class Writer:
    def __init__(self):
        self.buf = bytearray()
        self.views = []
        self.accessors = []

    def view(self, data, target=None, stride=None):
        while len(self.buf) % 4:
            self.buf.append(0)
        v = {'buffer': 0, 'byteOffset': len(self.buf), 'byteLength': len(data)}
        if target:
            v['target'] = target
        if stride:
            v['byteStride'] = stride
        self.buf += data
        self.views.append(v)
        return len(self.views) - 1

    def accessor(self, view, ctype, typ, count, normalized=False, mn=None, mx=None):
        a = {'bufferView': view, 'componentType': ctype, 'type': typ, 'count': count}
        if normalized:
            a['normalized'] = True
        if mn is not None:
            a['min'], a['max'] = mn, mx
        self.accessors.append(a)
        return len(self.accessors) - 1


def pack_vec(values, code, n, stride_bytes, size):
    out = bytearray()
    pad = stride_bytes - n * size
    for v in values:
        out += struct.pack('<' + code * n, *v)
        out += b'\0' * pad
    return bytes(out)


def shrink_texture(jpeg, px):
    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, 'in.jpg'), os.path.join(d, 'out.jpg')
        open(src, 'wb').write(jpeg)
        subprocess.run(['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', str(px), src, '--out', dst],
                       check=True, capture_output=True)
        return open(dst, 'rb').read()


def q_normals(normals):
    return [tuple(max(-127, min(127, round(c * 127))) for c in nv) for nv in normals]


def q_uvs(uvs):
    return [tuple(max(0, min(65535, round(c * 65535))) for c in uv) for uv in uvs]


def optimize(kind, src, dst):
    j, bin_ = read_glb(src)
    prim = j['meshes'][0]['primitives'][0]
    attrs = prim['attributes']
    pos = read_accessor(j, bin_, attrs['POSITION'])
    nor = read_accessor(j, bin_, attrs['NORMAL'])
    uv = read_accessor(j, bin_, attrs['TEXCOORD_0'])
    idx = read_accessor(j, bin_, prim['indices'])
    uvmin = min(min(u) for u in uv); uvmax = max(max(u) for u in uv)
    assert uvmin >= -1e-4 and uvmax <= 1 + 1e-4, ('UVs outside 0..1', uvmin, uvmax)
    w = Writer()

    if kind == 'car':
        node = next(n for n in j['nodes'] if 'mesh' in n)
        s = node['matrix'][0]
        inside = []
        for p in pos:
            x, y, z = (c * s for c in p)
            inside.append(any(abs(abs(x) - wh['x']) < wh['hw'] and math.hypot(y - wh['y'], z - wh['z']) < wh['r'] for wh in WHEELS))
        tris = [idx[t:t + 3] for t in range(0, len(idx), 3)]
        tris = [t for t in tris if sum(inside[v] for v in t) < 2]
        used = sorted({v for t in tris for v in t})
        remap = {old: new for new, old in enumerate(used)}
        pos = [pos[v] for v in used]; nor = [nor[v] for v in used]; uv = [uv[v] for v in used]
        idx = [remap[v] for t in tris for v in t]
        # positions to int16, with the dequantizing scale and offset folded into the node
        lo = [min(p[k] for p in pos) for k in range(3)]
        hi = [max(p[k] for p in pos) for k in range(3)]
        c = [(lo[k] + hi[k]) / 2 for k in range(3)]
        h = [max((hi[k] - lo[k]) / 2, 1e-6) for k in range(3)]
        qpos = [tuple(max(-32767, min(32767, round((p[k] - c[k]) / h[k] * 32767))) for k in range(3)) for p in pos]
        node.pop('matrix')
        node['scale'] = [s * h[k] for k in range(3)]
        node['translation'] = [s * c[k] for k in range(3)]
        pv = w.view(pack_vec(qpos, 'h', 3, 8, 2), 34962, 8)
        new_attrs = {'POSITION': w.accessor(pv, 5122, 'VEC3', len(qpos), True,
                                            [min(q[k] for q in qpos) / 32767 for k in range(3)],
                                            [max(q[k] for q in qpos) / 32767 for k in range(3)])}
        tex_px = 2048
    else:
        lo = [min(p[k] for p in pos) for k in range(3)]
        hi = [max(p[k] for p in pos) for k in range(3)]
        pv = w.view(pack_vec(pos, 'f', 3, 12, 4), 34962)
        new_attrs = {'POSITION': w.accessor(pv, 5126, 'VEC3', len(pos), False, lo, hi)}
        joints = read_accessor(j, bin_, attrs['JOINTS_0'])
        weights = read_accessor(j, bin_, attrs['WEIGHTS_0'])
        jcode = 'B' if j['accessors'][attrs['JOINTS_0']]['componentType'] == 5121 else 'H'
        jv = w.view(pack_vec(joints, jcode, 4, 4 if jcode == 'B' else 8, 1 if jcode == 'B' else 2), 34962)
        new_attrs['JOINTS_0'] = w.accessor(jv, 5121 if jcode == 'B' else 5123, 'VEC4', len(joints))
        qw = []
        for wt in weights:  # bytes that still sum to exactly 255
            q = [round(c * 255) for c in wt]
            q[q.index(max(q))] += 255 - sum(q)
            qw.append(tuple(q))
        wv = w.view(pack_vec(qw, 'B', 4, 4, 1), 34962)
        new_attrs['WEIGHTS_0'] = w.accessor(wv, 5121, 'VEC4', len(qw), True)
        tex_px = 1536

    nv = w.view(pack_vec(q_normals(nor), 'b', 3, 4, 1), 34962, 4)
    new_attrs['NORMAL'] = w.accessor(nv, 5120, 'VEC3', len(nor), True)
    uvv = w.view(pack_vec(q_uvs(uv), 'H', 2, 4, 2), 34962)
    new_attrs['TEXCOORD_0'] = w.accessor(uvv, 5123, 'VEC2', len(uv), True)
    big = max(idx) > 65534
    iv = w.view(array('I' if big else 'H', idx).tobytes(), 34963)
    prim['indices'] = w.accessor(iv, 5125 if big else 5123, 'SCALAR', len(idx))
    prim['attributes'] = new_attrs

    # skins keep their inverse bind matrices
    for skin in j.get('skins', []):
        if 'inverseBindMatrices' in skin:
            ibm = read_accessor(j, bin_, skin['inverseBindMatrices'])
            v = w.view(pack_vec(ibm, 'f', 16, 64, 4))
            skin['inverseBindMatrices'] = w.accessor(v, 5126, 'MAT4', len(ibm))

    img = j['images'][0]
    ibv = j['bufferViews'][img['bufferView']]
    jpeg = bin_[ibv.get('byteOffset', 0):ibv.get('byteOffset', 0) + ibv['byteLength']]
    img['bufferView'] = w.view(shrink_texture(jpeg, tex_px))
    img['mimeType'] = 'image/jpeg'
    j['images'] = [img]

    j['bufferViews'] = w.views
    j['accessors'] = w.accessors
    while len(w.buf) % 4:
        w.buf.append(0)
    j['buffers'] = [{'byteLength': len(w.buf)}]
    j.setdefault('extensionsUsed', [])
    j.setdefault('extensionsRequired', [])
    for e in ('extensionsUsed', 'extensionsRequired'):
        if 'KHR_mesh_quantization' not in j[e]:
            j[e].append('KHR_mesh_quantization')
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(w.buf))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(w.buf), 0x004E4942) + bytes(w.buf)
    open(dst, 'wb').write(out)
    print(f'{dst}: {len(out) / 1e6:.2f} MB, {len(pos)} vertices, {len(idx) // 3} triangles')


if __name__ == '__main__':
    optimize(sys.argv[1], sys.argv[2], sys.argv[3])
