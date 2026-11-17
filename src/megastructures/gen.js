// Megastructure generation entry (worker-safe). OWNER: megastructure agent.
//   computeLayout(heightFn) -> {G01, G02}   chunk lists + terrain-keyed layout (serialisable)
//   setLayout(layout)                        install a layout computed elsewhere
//   buildChunk(siteId, chunkId, lod)          -> ChunkMesh (see below), positions bent onto the sphere
//   transferList(result)                      unique ArrayBuffers to transfer
// ChunkMesh = { site, chunk, lod, anchor:{x,y,z} (ECEF, sea level under the chunk centre),
//   parts:[{material, position, normal, uv, color, index, aMega?}] (site axes, relative to anchor),
//   colliders:{position, index, part:Uint16Array per vertex}|null, partTable:[{id,name}],
//   bounds:{min,max}, stats, lights }
import { SITES } from '../world/sites.js';
import { Ctx } from './parts.js';
import { layoutG01, genG01Chunk } from './g01.js';
import { layoutG02, genG02Chunk } from './g02.js';
import { chunkAnchor, bendPositions } from './frame.js';

let LAYOUT = null;
const CHUNK_INDEX = new Map();

export function computeLayout(heightFn) {
  const t0 = Date.now();
  const L = { G01: layoutG01(), G02: layoutG02(heightFn) };
  L.ms = Date.now() - t0;
  setLayout(L);
  return L;
}
export function setLayout(L) {
  LAYOUT = L; CHUNK_INDEX.clear();
  for (const s of ['G01', 'G02']) for (const c of L[s].chunks) CHUNK_INDEX.set(`${s}:${c.id}`, c);
}
export const siteOf = (id) => (id === 'G01' ? SITES.tidalBarrier : SITES.waterStairs);

export function buildChunk(siteId, chunkId, lod) {
  if (!LAYOUT) throw new Error('mega layout not set');
  const chunk = CHUNK_INDEX.get(`${siteId}:${chunkId}`);
  if (!chunk) throw new Error(`unknown chunk ${siteId}:${chunkId}`);
  const site = siteOf(siteId);
  const t0 = Date.now();
  const c = new Ctx(site, chunk, lod);
  c.layout = LAYOUT[siteId];
  try { if (siteId === 'G01') genG01Chunk(c); else genG02Chunk(c); } catch (e) { c.b.dispose(); throw e; }
  const data = c.b.finish();
  const anchor = chunkAnchor(site, chunk.cx, chunk.cz);
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const parts = [];
  for (const p of data.parts) {
    const out = { material: p.material, position: p.position, normal: p.normal, uv: p.uv, color: p.color, index: p.index };
    const a = p.attributes && p.attributes.aMega;
    if (a) {
      const arr = a.array, pos = p.position;
      for (let i = 0, n = pos.length / 3; i < n; i++) arr[i * 4] = pos[i * 3 + 1] - arr[i * 4];
      out.aMega = arr;
    }
    const bb = bendPositions(site, chunk.cx, chunk.cz, anchor, p.position);
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], bb.min[k]); max[k] = Math.max(max[k], bb.max[k]); }
    parts.push(out);
  }
  let colliders = null;
  if (data.colliders && data.colliders.index.length) {
    const pos = data.colliders.position;
    bendPositions(site, chunk.cx, chunk.cz, anchor, pos);
    const nV = pos.length / 3, part = new Uint16Array(nV);
    const mk = c.marks;
    for (let m = 0; m < mk.length; m += 2) {
      const v0 = mk[m], pi = mk[m + 1], v1 = m + 2 < mk.length ? mk[m + 2] : nV;
      for (let v = v0; v < v1 && v < nV; v++) part[v] = pi;
    }
    colliders = { position: pos, index: data.colliders.index, part };
  }
  if (!isFinite(min[0])) { min = [0, 0, 0]; max = [0, 0, 0]; }
  return {
    site: siteId, chunk: chunkId, lod, anchor, parts, colliders, partTable: c.parts,
    bounds: { min, max }, lights: c.lights,
    stats: { triangles: data.stats.triangles, vertices: data.stats.vertices, ms: Date.now() - t0 },
  };
}

export function transferList(r) {
  const set = new Set();
  for (const p of r.parts) for (const k of ['position', 'normal', 'uv', 'color', 'index', 'aMega']) if (p[k]) set.add(p[k].buffer);
  if (r.colliders) { set.add(r.colliders.position.buffer); set.add(r.colliders.index.buffer); set.add(r.colliders.part.buffer); }
  return [...set];
}
