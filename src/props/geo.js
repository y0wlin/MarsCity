// Tiny geometry builder for procedural props (main thread). OWNER: props agent.
// Accumulates position / normal / uv / color (+ optional float attributes) with a transform stack,
// emits an indexed THREE.BufferGeometry. Faces are CCW from the front.
import * as THREE from 'three';

export class Geo {
  constructor(extra = []) {
    this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = [];
    this.extra = {}; for (const e of extra) this.extra[e] = [];
    this.cur = {}; for (const e of extra) this.cur[e] = 0;
    this.col = [1, 1, 1];
    this.m = new THREE.Matrix4(); this.stack = [];
    this.nm = new THREE.Matrix3();
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
  }
  get count() { return this.p.length / 3; }
  push() { this.stack.push(this.m.clone()); return this; }
  pop() { this.m.copy(this.stack.pop()); return this; }
  translate(x, y, z) { this.m.multiply(new THREE.Matrix4().makeTranslation(x, y, z)); return this; }
  rotY(a) { this.m.multiply(new THREE.Matrix4().makeRotationY(a)); return this; }
  rotX(a) { this.m.multiply(new THREE.Matrix4().makeRotationX(a)); return this; }
  rotZ(a) { this.m.multiply(new THREE.Matrix4().makeRotationZ(a)); return this; }
  scale(x, y, z) { this.m.multiply(new THREE.Matrix4().makeScale(x, y, z)); return this; }
  color(r, g, b) { this.col = [r, g, b]; return this; }
  set(name, v) { this.cur[name] = v; return this; }

  vert(x, y, z, nx, ny, nz, u = 0, v = 0) {
    const P = this._v.set(x, y, z).applyMatrix4(this.m);
    this.nm.getNormalMatrix(this.m);
    const N = this._w.set(nx, ny, nz).applyMatrix3(this.nm);
    if (N.lengthSq() < 1e-12) N.set(0, 1, 0); else N.normalize();
    this.p.push(P.x, P.y, P.z); this.n.push(N.x, N.y, N.z); this.uv.push(u, v); this.c.push(this.col[0], this.col[1], this.col[2]);
    for (const e in this.extra) this.extra[e].push(this.cur[e]);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quadIdx(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  /** flat quad from 4 corner points (CCW from the front), normal from the corners */
  quad(a, b, c, d, uvs = [0, 0, 1, 0, 1, 1, 0, 1]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, uvs[0], uvs[1]);
    const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, uvs[2], uvs[3]);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, uvs[4], uvs[5]);
    const i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, uvs[6], uvs[7]);
    this.quadIdx(i0, i1, i2, i3);
  }

  /** axis-aligned box (current transform); faces mask: px nx py ny pz nz (all by default) */
  box(x0, y0, z0, x1, y1, z1, mask = 63, uvScale = 1) {
    const s = uvScale;
    if (mask & 1) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [z1 * s, y0 * s, z0 * s, y0 * s, z0 * s, y1 * s, z1 * s, y1 * s]);
    if (mask & 2) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [z0 * s, y0 * s, z1 * s, y0 * s, z1 * s, y1 * s, z0 * s, y1 * s]);
    if (mask & 4) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [x0 * s, z1 * s, x1 * s, z1 * s, x1 * s, z0 * s, x0 * s, z0 * s]);
    if (mask & 8) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0 * s, z0 * s, x1 * s, z0 * s, x1 * s, z1 * s, x0 * s, z1 * s]);
    if (mask & 16) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0 * s, y0 * s, x1 * s, y0 * s, x1 * s, y1 * s, x0 * s, y1 * s]);
    if (mask & 32) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1 * s, y0 * s, x0 * s, y0 * s, x0 * s, y1 * s, x1 * s, y1 * s]);
  }
  /** box with chamfered vertical edges (8-sided prism), good for car bodies / benches */
  cbox(x0, y0, z0, x1, y1, z1, c, top = true, bottom = false) {
    const pts = [[x0 + c, z0], [x1 - c, z0], [x1, z0 + c], [x1, z1 - c], [x1 - c, z1], [x0 + c, z1], [x0, z1 - c], [x0, z0 + c]];
    this.prism(pts, y0, y1, top, bottom);
  }
  /** vertical prism over a CCW (seen from +y... any) polygon [[x,z]] */
  prism(poly, y0, y1, top = true, bottom = false) {
    const n = poly.length;
    // orientation: make CCW when looking down -y (x right, z down => signed area < 0 in x/z)
    let a = 0; for (let i = 0; i < n; i++) { const p = poly[i], q = poly[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
    const P = a > 0 ? poly.slice().reverse() : poly;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const p = P[i], q = P[(i + 1) % n];
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      this.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], [u, y0, u + l, y0, u + l, y1, u, y1]);
      u += l;
    }
    if (top) this.fan(P, y1, 1);
    if (bottom) this.fan(P, y0, -1);
  }
  fan(P, y, dir) {
    const n = P.length; let cx = 0, cz = 0; for (const p of P) { cx += p[0]; cz += p[1]; } cx /= n; cz /= n;
    const c = this.vert(cx, y, cz, 0, dir, 0, cx, cz);
    const ids = P.map((p) => this.vert(p[0], y, p[1], 0, dir, 0, p[0], p[1]));
    for (let i = 0; i < n; i++) { const a = ids[i], b = ids[(i + 1) % n]; if (dir > 0) this.tri(c, a, b); else this.tri(c, b, a); }
  }
  /** lathe around +y: profile [[r, y]], segs */
  lathe(profile, segs, capTop = false, capBottom = false, x = 0, z = 0) {
    const rows = [];
    for (let k = 0; k < profile.length; k++) {
      const [r, y] = profile[k];
      const pr = profile[Math.max(0, k - 1)], nx = profile[Math.min(profile.length - 1, k + 1)];
      const dr = nx[0] - pr[0], dy = nx[1] - pr[1];
      let nr = dy, ny = -dr; const nl = Math.hypot(nr, ny) || 1; nr /= nl; ny /= nl;
      const row = [];
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        row.push(this.vert(x + ca * r, y, z + sa * r, ca * nr, ny, sa * nr, s / segs, y));
      }
      rows.push(row);
    }
    for (let k = 0; k + 1 < rows.length; k++) for (let s = 0; s < segs; s++) this.quadIdx(rows[k][s], rows[k + 1][s], rows[k + 1][s + 1], rows[k][s + 1]);
    if (capTop) { const [r, y] = profile[profile.length - 1]; this.disc(x, y, z, r, segs, 1); }
    if (capBottom) { const [r, y] = profile[0]; this.disc(x, y, z, r, segs, -1); }
  }
  disc(x, y, z, r, segs, dir) {
    const c = this.vert(x, y, z, 0, dir, 0, 0.5, 0.5);
    const ids = [];
    for (let s = 0; s <= segs; s++) { const a = (s / segs) * Math.PI * 2; ids.push(this.vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, dir, 0, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5)); }
    for (let s = 0; s < segs; s++) { if (dir > 0) this.tri(c, ids[s + 1], ids[s]); else this.tri(c, ids[s], ids[s + 1]); }
  }
  /** tube along a 3D path with radii (per point), segs around */
  tube(path, radii, segs = 6, capEnd = true) {
    const rows = [];
    let px = [1, 0, 0];
    for (let k = 0; k < path.length; k++) {
      const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)];
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      // frame: parallel transport-ish
      let ux = px[1] * tz - px[2] * ty, uy = px[2] * tx - px[0] * tz, uz = px[0] * ty - px[1] * tx;
      let ul = Math.hypot(ux, uy, uz);
      if (ul < 1e-4) { px = Math.abs(ty) < 0.9 ? [0, 1, 0] : [1, 0, 0]; ux = px[1] * tz - px[2] * ty; uy = px[2] * tx - px[0] * tz; uz = px[0] * ty - px[1] * tx; ul = Math.hypot(ux, uy, uz); }
      ux /= ul; uy /= ul; uz /= ul;
      const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux;
      px = [vx, vy, vz];
      const r = Array.isArray(radii) ? radii[k] : radii;
      const row = [];
      for (let s = 0; s <= segs; s++) {
        const an = (s / segs) * Math.PI * 2, ca = Math.cos(an), sa = Math.sin(an);
        const nx = ux * ca + vx * sa, ny = uy * ca + vy * sa, nz = uz * ca + vz * sa;
        row.push(this.vert(path[k][0] + nx * r, path[k][1] + ny * r, path[k][2] + nz * r, nx, ny, nz, s / segs, k));
      }
      rows.push(row);
    }
    for (let k = 0; k + 1 < rows.length; k++) for (let s = 0; s < segs; s++) this.quadIdx(rows[k][s], rows[k][s + 1], rows[k + 1][s + 1], rows[k + 1][s]);
    if (capEnd) { const k = path.length - 1; const c = this.vert(path[k][0], path[k][1], path[k][2], 0, 1, 0); for (let s = 0; s < segs; s++) this.tri(c, rows[k][s], rows[k][s + 1]); }
  }
  /** low-poly ellipsoid blob (UV sphere) */
  blob(x, y, z, rx, ry, rz, wseg = 7, hseg = 5, jitter = 0, seed = 1) {
    let h = seed >>> 0;
    const rnd = () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const rows = [];
    for (let j = 0; j <= hseg; j++) {
      const v = j / hseg, th = v * Math.PI, st = Math.sin(th), ct = Math.cos(th);
      const row = [];
      for (let i = 0; i <= wseg; i++) {
        const ph = (i / wseg) * Math.PI * 2;
        const k = (j === 0 || j === hseg) ? 1 : 1 + (rnd() - 0.5) * jitter;
        const nx = st * Math.cos(ph), ny = ct, nz = st * Math.sin(ph);
        row.push(this.vert(x + nx * rx * k, y + ny * ry * k, z + nz * rz * k, nx / rx, ny / ry, nz / rz, i / wseg, v));
      }
      rows.push(row);
    }
    for (let j = 0; j < hseg; j++) for (let i = 0; i < wseg; i++) this.quadIdx(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
  }
  /** merge another Geo (same attribute set) */
  append(o) {
    const base = this.count;
    this.p.push(...o.p); this.n.push(...o.n); this.uv.push(...o.uv); this.c.push(...o.c);
    for (const e in this.extra) this.extra[e].push(...(o.extra[e] || new Array(o.count).fill(0)));
    for (const i of o.idx) this.idx.push(i + base);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    for (const e in this.extra) g.setAttribute(e, new THREE.Float32BufferAttribute(this.extra[e], 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** ring of points (x,z) */
export function ring(cx, cz, r, n, a0 = 0) { const o = []; for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; o.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } return o; }
