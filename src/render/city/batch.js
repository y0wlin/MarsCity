// GPU-only batched meshes for the detailed buildings: ONE THREE.BatchedMesh subclass per material key
// (plus attribute signature) holds the parts of every detailed building that use that key. OWNER: city.
//
// * Geometry lives only in WebGL buffers (THREE.GLBufferAttribute): parts are written with
//   bufferSubData into ranges handed out by a first-fit free list; growing a buffer copies the old one
//   on the GPU (copyBufferSubData) — no CPU copy of the drawn geometry is ever kept.
// * One instance per (building, part): instance matrix = building frame relative to the batch anchor
//   (a camera-near ECEF point, rebased by the owner); the batch object itself sits at anchor − origin.
// * Draw lists are built per camera (main, shadow cascades, reflections) with per-instance sphere
//   culling; each camera keeps its own indirect texture + multi-draw arrays, which are only re-uploaded
//   when that camera's list changed (a still view uploads nothing). Opaque lists keep instance order
//   (stable), transparent lists are sorted back to front.
// * Rendering goes through three's own batching path (USE_BATCHING, batchingTexture, multiDraw), so
//   every material that supports THREE.BatchedMesh works unchanged (building-kit materials do, D5).
import * as THREE from 'three';

const GLT = { Float32Array: 0x1406, Uint32Array: 0x1405, Int32Array: 0x1404, Uint16Array: 0x1403, Int16Array: 0x1402, Uint8Array: 0x1401, Int8Array: 0x1400 };
const _frustum = new THREE.Frustum(), _m4 = new THREE.Matrix4(), _cam = new THREE.Vector3(), _fwd = new THREE.Vector3();
const _sph = new THREE.Sphere();

/** first-fit free list over [0, cap) */
class Ranges {
  constructor() { this.free = []; this.cap = 0; }   // free: [start, count, start, count, ...] sorted
  grow(newCap) {
    const add = newCap - this.cap;
    if (add <= 0) return;
    const f = this.free, n = f.length;
    if (n && f[n - 2] + f[n - 1] === this.cap) f[n - 1] += add; else f.push(this.cap, add);
    this.cap = newCap;
  }
  alloc(count) {
    const f = this.free;
    for (let i = 0; i < f.length; i += 2) {
      if (f[i + 1] < count) continue;
      const s = f[i];
      if (f[i + 1] === count) f.splice(i, 2); else { f[i] += count; f[i + 1] -= count; }
      return s;
    }
    return -1;
  }
  release(start, count) {
    if (count <= 0) return;
    const f = this.free;
    let i = 0;
    while (i < f.length && f[i] < start) i += 2;
    f.splice(i, 0, start, count);
    // merge with next
    if (i + 2 < f.length && f[i] + f[i + 1] === f[i + 2]) { f[i + 1] += f[i + 3]; f.splice(i + 2, 2); }
    // merge with previous
    if (i >= 2 && f[i - 2] + f[i - 1] === f[i]) { f[i - 1] += f[i + 1]; f.splice(i, 2); }
  }
  used() { let u = this.cap; for (let i = 1; i < this.free.length; i += 2) u -= this.free[i]; return u; }
}

let _scratchIdx = new Uint32Array(1 << 16);

export class GpuBatch extends THREE.BatchedMesh {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Material} material  shared (kit) material
   * @param {Array<{name, itemSize, normalized, ctor}>} schema vertex attributes (position first)
   */
  constructor(renderer, material, schema, opts = {}) {
    super(Math.max(16, opts.instances || 256), 4, 12, material);
    this.isGpuBatch = true;
    this.renderer = renderer;
    this.gl = renderer.getContext();
    this.schema = schema;
    this.frustumCulled = false;            // per-instance culling below
    this.perObjectFrustumCulled = true;
    this.sortObjects = !!material.transparent;
    this.matrixAutoUpdate = false;
    this.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this.boundingBox = new THREE.Box3(new THREE.Vector3(-1e7, -1e7, -1e7), new THREE.Vector3(1e7, 1e7, 1e7));
    this.vr = new Ranges(); this.ir = new Ranges();
    this.bufs = {};                        // name -> WebGLBuffer
    this.indexBuf = null;
    // instances: parallel arrays (id = slot)
    this.inst = [];                        // slot -> {iStart, iCount, vStart, vCount, sphere:[x,y,z,r] (instance local), w:[x,y,z] world-in-batch centre, visible, tag}
    this.freeSlots = [];
    this.liveCount = 0;
    this.version = 0;                      // bumps on add / remove / visibility / matrix change
    this._cams = new WeakMap();
    this._camList = [];
    this.stats = { draws: 0 };
    this.shadowMaxWidth = Infinity;        // m: widest shadow camera this batch casts into
    this._cap0 = [Math.max(4096, opts.vertices || 65536), Math.max(12288, opts.indices || 196608)];   // trim target (fix round 3)
    this._alloc(this._cap0[0], this._cap0[1]);
  }

  // ------------------------------------------------------------------ GPU buffers
  _newBuffer(target, bytes) {
    const gl = this.gl;
    const b = gl.createBuffer();
    if (target === gl.ELEMENT_ARRAY_BUFFER) {
      // binding an element buffer changes the bound VAO: bind none, then restore three's VAO
      const vao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
      gl.bindVertexArray(vao);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    return b;
  }
  _copy(src, dst, bytes) {
    if (!src || bytes <= 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.COPY_READ_BUFFER, src);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, dst);
    gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, bytes);
    gl.bindBuffer(gl.COPY_READ_BUFFER, null);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
  }
  /** (re)allocate the GPU buffers with the given capacities (vertices, indices), keeping the data */
  _alloc(vCap, iCap) {
    const gl = this.gl, g = this.geometry;
    const oldV = this.vr.cap, oldI = this.ir.cap;
    if (vCap > oldV) {
      for (const a of this.schema) {
        const bpe = a.ctor.BYTES_PER_ELEMENT;
        const nb = this._newBuffer(gl.ARRAY_BUFFER, vCap * a.itemSize * bpe);
        const ob = this.bufs[a.name];
        this._copy(ob, nb, oldV * a.itemSize * bpe);
        if (ob) gl.deleteBuffer(ob);
        this.bufs[a.name] = nb;
        g.setAttribute(a.name, new THREE.GLBufferAttribute(nb, GLT[a.ctor.name], a.itemSize, bpe, vCap, !!a.normalized));
      }
      this.vr.grow(vCap);
    }
    if (iCap > oldI) {
      const nb = this._newBuffer(gl.ELEMENT_ARRAY_BUFFER, iCap * 4);
      this._copy(this.indexBuf, nb, oldI * 4);
      if (this.indexBuf) gl.deleteBuffer(this.indexBuf);
      this.indexBuf = nb;
      g.setIndex(new THREE.GLBufferAttribute(nb, gl.UNSIGNED_INT, 1, 4, iCap));
      this.ir.grow(iCap);
    }
  }
  _upload(buf, byteOffset, arr, srcOffset, count) {
    const gl = this.gl;
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, buf);
    gl.bufferSubData(gl.COPY_WRITE_BUFFER, byteOffset, arr, srcOffset, count);
    gl.bindBuffer(gl.COPY_WRITE_BUFFER, null);
  }
  gpuBytes() {
    let b = this.ir.cap * 4;
    for (const a of this.schema) b += this.vr.cap * a.itemSize * a.ctor.BYTES_PER_ELEMENT;
    return b;
  }
  usedBytes() {
    let b = this.ir.used() * 4;
    for (const a of this.schema) b += this.vr.used() * a.itemSize * a.ctor.BYTES_PER_ELEMENT;
    return b;
  }

  // ------------------------------------------------------------------ instances
  /**
   * Add one part. arrays: {name: TypedArray} for every schema attribute (missing → zeros);
   * index: Uint32Array local to the part; sphere [x,y,z,r] in the instance frame.
   * Returns the instance slot.
   */
  addPart(arrays, index, vCount, sphere, tag) {
    const iCount = index.length;
    let vStart = this.vr.alloc(vCount), iStart = this.ir.alloc(iCount);
    if (vStart < 0 || iStart < 0) {
      const needV = vStart < 0 ? Math.max(Math.ceil(this.vr.cap * 1.3), this.vr.cap + vCount * 2) : this.vr.cap;
      const needI = iStart < 0 ? Math.max(Math.ceil(this.ir.cap * 1.3), this.ir.cap + iCount * 2) : this.ir.cap;
      if (vStart >= 0) { this.vr.release(vStart, vCount); vStart = -1; }
      if (iStart >= 0) { this.ir.release(iStart, iCount); iStart = -1; }
      this._alloc(needV, needI);
      vStart = this.vr.alloc(vCount); iStart = this.ir.alloc(iCount);
      if (vStart < 0 || iStart < 0) throw new Error('GpuBatch: allocation failed');
    }
    for (const a of this.schema) {
      const src = arrays[a.name];
      const n = vCount * a.itemSize, bpe = a.ctor.BYTES_PER_ELEMENT;
      if (src && src.length >= n) this._upload(this.bufs[a.name], vStart * a.itemSize * bpe, src, 0, n);
      else {
        const z = new a.ctor(n);
        if (a.name === 'color') z.fill(1);
        this._upload(this.bufs[a.name], vStart * a.itemSize * bpe, z, 0, n);
      }
    }
    if (_scratchIdx.length < iCount) _scratchIdx = new Uint32Array(Math.max(iCount, _scratchIdx.length * 2));
    const S = _scratchIdx;
    for (let k = 0; k < iCount; k++) S[k] = index[k] + vStart;
    this._upload(this.indexBuf, iStart * 4, S, 0, iCount);
    // instance slot
    let slot;
    if (this.freeSlots.length) slot = this.freeSlots.pop();
    else {
      slot = this.inst.length;
      if (slot >= this.maxInstanceCount) this._growInstances(Math.max(slot + 1, Math.ceil(this.maxInstanceCount * 1.6)));
      this.inst.push(null);
    }
    this.inst[slot] = { iStart, iCount, vStart, vCount, sphere, w: [sphere[0], sphere[1], sphere[2]], visible: true, tag };
    this.liveCount++;
    this.version++;
    return slot;
  }
  _growInstances(n) {
    // base class resizes its multi-draw arrays + matrices / indirect textures (copies the matrices)
    this.setInstanceCount(n);
    for (const st of this._camList) st.tex.dispose();
    this._cams = new WeakMap(); this._camList.length = 0;   // per-camera states are rebuilt at the new size
    if (this._tagTex) {
      const old = this._tagTex;
      this._tagTex = null;
      const t = this.tagTexture();
      t.image.data.set(old.image.data.subarray(0, Math.min(old.image.data.length, t.image.data.length)));
      t.needsUpdate = true;
      old.dispose();
      if (this.material && this.material.uniforms && this.material.uniforms.uTag) { this.material.uniforms.uTag.value = t; this.material.uniforms.uTagW.value = t.image.width; }
    }
  }
  /** per-instance RGBA8 tag texture (debug colours), width = ceil(sqrt(maxInstanceCount)) */
  tagTexture() {
    if (!this._tagTex) {
      const w = Math.ceil(Math.sqrt(this.maxInstanceCount));
      const t = new THREE.DataTexture(new Uint8Array(w * w * 4).fill(180), w, w, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
      this._tagTex = t;
    }
    return this._tagTex;
  }
  setPartTag(slot, r, g, b) {
    const t = this.tagTexture(), d = t.image.data;
    const o = slot * 4;
    if (o + 3 >= d.length) return;
    d[o] = Math.round(Math.min(1, r) * 255); d[o + 1] = Math.round(Math.min(1, g) * 255); d[o + 2] = Math.round(Math.min(1, b) * 255); d[o + 3] = 255;
    t.needsUpdate = true;
  }
  removePart(slot) {
    const I = this.inst[slot];
    if (!I) return;
    this.vr.release(I.vStart, I.vCount);
    this.ir.release(I.iStart, I.iCount);
    this.inst[slot] = null;
    this.freeSlots.push(slot);
    this.liveCount--;
    this.version++;
    if (this.liveCount === 0) this._trim();
  }
  /**
   * Fix round 3 (memory): the GPU buffers only grow (first-fit ranges, ×1.3 GPU copies) and used to keep the peak
   * of the whole session. Once the batch is EMPTY (the camera left the district) they shrink to 1/8 of the initial
   * size (≥ 4096 vertices): ~60 empty kit batches at the initial size alone held ~0.6 GB; they regrow on demand.
   */
  _trim() {
    const c0 = this._cap0 || [65536, 196608];
    const v0 = Math.max(4096, c0[0] >> 3), i0 = Math.max(12288, c0[1] >> 3);
    if (this.vr.cap <= v0 && this.ir.cap <= i0) return;
    const gl = this.gl;
    for (const a of this.schema) { const b = this.bufs[a.name]; if (b) gl.deleteBuffer(b); }
    if (this.indexBuf) gl.deleteBuffer(this.indexBuf);
    this.bufs = {}; this.indexBuf = null;
    this.vr = new Ranges(); this.ir = new Ranges();
    this._alloc(v0, i0);
    this.stats.trims = (this.stats.trims || 0) + 1;
  }
  /** instance matrix (THREE.Matrix4, instance frame -> batch frame) */
  setPartMatrix(slot, m) {
    const I = this.inst[slot];
    if (!I) return;
    m.toArray(this._matricesTexture.image.data, slot * 16);
    this._matricesTexture.needsUpdate = true;
    const e = m.elements, s = I.sphere;
    I.w[0] = e[0] * s[0] + e[4] * s[1] + e[8] * s[2] + e[12];
    I.w[1] = e[1] * s[0] + e[5] * s[1] + e[9] * s[2] + e[13];
    I.w[2] = e[2] * s[0] + e[6] * s[1] + e[10] * s[2] + e[14];
    this.version++;
  }
  setPartVisible(slot, v) {
    const I = this.inst[slot];
    if (!I || I.visible === !!v) return;
    I.visible = !!v; this.version++;
  }

  // ------------------------------------------------------------------ drawing
  _camState(camera) {
    let st = this._cams.get(camera);
    if (!st) {
      if (this._camList.length >= 24) { for (const q of this._camList) q.tex.dispose(); this._camList.length = 0; this._cams = new WeakMap(); }
      const size = Math.ceil(Math.sqrt(this.maxInstanceCount));
      const tex = new THREE.DataTexture(new Uint32Array(size * size), size, size, THREE.RedIntegerFormat, THREE.UnsignedIntType);
      st = { tex, starts: new Int32Array(this.maxInstanceCount), counts: new Int32Array(this.maxInstanceCount), n: 0, ver: -1, key: null, set: null, sortPos: null, sortFwd: null, list: new Int32Array(this.maxInstanceCount), z: new Float32Array(this.maxInstanceCount), order: [] };
      this._cams.set(camera, st);
      this._camList.push(st);
    }
    return st;
  }

  _updateDrawParameters(camera) {
    const st = this._camState(camera);
    const inst = this.inst;
    _m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(this.matrixWorld);
    _frustum.setFromProjectionMatrix(_m4, camera.coordinateSystem, camera.reversedDepth);
    const list = st.list;
    let n = 0;
    _m4.copy(this.matrixWorld).invert();
    _cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_m4);
    _fwd.set(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(_m4);
    for (let i = 0; i < inst.length; i++) {
      const I = inst[i];
      if (!I || !I.visible) continue;
      _sph.center.set(I.w[0], I.w[1], I.w[2]); _sph.radius = I.sphere[3];
      if (!_frustum.intersectsSphere(_sph)) continue;
      list[n++] = i;
    }
    // order: transparent back to front (blending); opaque front to back (early depth rejection of the
    // heavy kit fragments). An opaque order is kept while the visible set is unchanged and the camera
    // moved < 12 m since it was sorted, so a still or slowly moving view re-uploads nothing.
    let changed = st.n !== n || !st.key;
    if (!changed) for (let k = 0; k < n; k++) if (st.set[k] !== list[k]) { changed = true; break; }
    const moved = !st.sortPos || Math.hypot(_cam.x - st.sortPos.x, _cam.y - st.sortPos.y, _cam.z - st.sortPos.z) > 12 || (_fwd.x * st.sortFwd.x + _fwd.y * st.sortFwd.y + _fwd.z * st.sortFwd.z) < 0.96;
    const resort = changed || (this.sortObjects ? true : moved);
    if (resort) {
      if (!st.set || st.set.length < list.length) st.set = new Int32Array(list.length);
      st.set.set(list.subarray(0, n));
      if (n > 1) {
        const z = st.z, o = st.order; o.length = n;
        for (let k = 0; k < n; k++) { const I = inst[list[k]]; z[k] = (I.w[0] - _cam.x) * _fwd.x + (I.w[1] - _cam.y) * _fwd.y + (I.w[2] - _cam.z) * _fwd.z - (this.sortObjects ? 0 : I.sphere[3]); o[k] = k; }
        if (this.sortObjects) o.sort((a, b) => z[b] - z[a]); else o.sort((a, b) => z[a] - z[b]);
        const tmp = o.map((k) => list[k]);
        for (let k = 0; k < n; k++) list[k] = tmp[k];
      }
      st.sortPos = st.sortPos || { x: 0, y: 0, z: 0 }; st.sortFwd = st.sortFwd || { x: 0, y: 0, z: 0 };
      st.sortPos.x = _cam.x; st.sortPos.y = _cam.y; st.sortPos.z = _cam.z; st.sortFwd.x = _fwd.x; st.sortFwd.y = _fwd.y; st.sortFwd.z = _fwd.z;
      let diff = st.n !== n || !st.key;
      if (!diff) for (let k = 0; k < n; k++) if (st.key[k] !== list[k]) { diff = true; break; }
      if (diff) {
        const d = st.tex.image.data;
        for (let k = 0; k < n; k++) d[k] = list[k];
        st.tex.needsUpdate = true;
        if (!st.key || st.key.length < list.length) st.key = new Int32Array(list.length);
        st.key.set(list.subarray(0, n));
        st.n = n;
        st.ver = -1;
      }
    }
    if (st.ver !== this.version) {
      const key = st.key;
      for (let k = 0; k < st.n; k++) { const I = inst[key[k]]; st.starts[k] = I.iStart * 4; st.counts[k] = I.iCount; }
      st.ver = this.version;
    }
    this._indirectTexture = st.tex;
    this._multiDrawStarts = st.starts;
    this._multiDrawCounts = st.counts;
    this._multiDrawCount = st.n;
    this.stats.draws += st.n;
  }
  onBeforeRender(renderer, scene, camera) { this._updateDrawParameters(camera); }
  onBeforeShadow(renderer, object, camera, shadowCamera) {
    // optional: no casting into wide (far) cascades (e.g. interior parts: walls enclose them, their
    // shadows only matter for sun patches through windows near the camera)
    if (shadowCamera.isOrthographicCamera && (shadowCamera.right - shadowCamera.left) > this.shadowMaxWidth) { this._multiDrawCount = 0; return; }
    this._updateDrawParameters(shadowCamera);
  }

  // three's CPU-side paths are not available (no CPU geometry)
  computeBoundingBox() { }
  computeBoundingSphere() { }
  raycast() { }
  optimize() { return this; }

  dispose() {
    const gl = this.gl;
    for (const st of this._camList) st.tex.dispose();
    this._camList.length = 0;
    // geometry.dispose() lets three delete the GL buffers of the current attributes
    this.geometry.dispose();
    this.bufs = {}; this.indexBuf = null;
    this._matricesTexture?.dispose();
    this._tagTex?.dispose();
    void gl;
  }
}

/** attribute schema of a kit part: position, normal, uv, color + extras (sorted) */
export function partSchema(part) {
  const s = [
    { name: 'position', itemSize: 3, normalized: false, ctor: Float32Array },
    { name: 'normal', itemSize: 3, normalized: false, ctor: Float32Array },
    { name: 'uv', itemSize: 2, normalized: false, ctor: Float32Array },
    { name: 'color', itemSize: 3, normalized: false, ctor: Float32Array },
  ];
  if (part.attributes) for (const n of Object.keys(part.attributes).sort()) { const a = part.attributes[n]; s.push({ name: n, itemSize: a.itemSize || 4, normalized: false, ctor: a.array.constructor }); }
  return s;
}
export function schemaKey(material, schema) { return material + '|' + schema.slice(4).map((a) => a.name + a.itemSize + a.ctor.name[0]).join(','); }
