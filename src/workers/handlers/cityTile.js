// OWNER: city agent. City tile worker jobs.
//   'cityTile'    payload {face, x, y, mass?:bool, towns?: mega.towns() records (G02 work towns)}
//                 -> CityTileData (world/urban.js generateCityTile, unchanged fields at the top level so
//                    the UI building index can use it as is) + when mass: data.mass = merged far-LOD
//                    geometry of every building of the tile (render/city/massBuild.js); per-building
//                    index ranges + AABBs in data.mass.info replace a triangle BVH for picking
//   'cityStreets' payload {face, x, y, level, center, roads, areas, rails, docks, stations}
//                 -> street / ground geometry of the tile (render/city/streetBuild.js), per material,
//                    + colliderBVH {roots}: serialized three-mesh-bvh of out.colliders (index reordered)
//   'cityBridge'  payload: one long bridge (render/city/bridges.js: stitched deck runs in a bridge frame, pylons,
//                    type, width, water level) -> {id, parts, stats} structure geometry (render/city/bridgeBuild.js)
//   'cityBuilding' payload {spec, lod} -> BuildingMeshData (buildings/index.js generateBuilding) +
//                    colliderBVH {roots} for 'full' colliders (the BVH build costs 0.3–2 s: never on
//                    the main thread) + pickChunks {boxes, meta}: 64-triangle chunk boxes for picking
//                    + bollards: Float32Array [x, y, z, …] (building frame) ground points of the kit's light
//                    bollards for the night light pools (findBollards, fix round 3) or null
import { BufferGeometry, BufferAttribute } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { generateCityTile, parseBuildingId } from '../../world/urban.js';
import { generateBuilding, transferList } from '../../buildings/index.js';
import { buildTileMass, massTransferList } from '../../render/city/massBuild.js';
import { buildStreets, streetsTransferList } from '../../render/city/streetBuild.js';
import { townContentInTile } from '../../render/city/towns.js';
import { buildBridge, bridgeTransferList } from '../../render/city/bridgeBuild.js';
import { heightAt } from '../../world/terrain.js';
import { latLonToUnit, buildingAxes } from '../../core/geo.js';
import { R as R_SEA } from '../../core/constants.js';

/** serialized BVH of a {position, index} collider soup; reorders index in place */
function colliderBVH(c) {
  if (!c || !c.index || !c.index.length) return null;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(c.position, 3));
  g.setIndex(new BufferAttribute(c.index, 1));
  const bvh = new MeshBVH(g, { targetLeafSize: 8 });
  return { roots: MeshBVH.serialize(bvh, { cloneBuffers: false }).roots };
}

/**
 * Pick chunks of a BuildingMeshData (render/city/detail.js makePick): for every drawn part (same
 * filter and order as the main thread) boxes of 64 consecutive triangles in the building frame.
 * -> {boxes: Float32Array(6n) [x0,y0,z0,x1,y1,z1], meta: Uint32Array(3n) [part, firstTri, triCount]}
 */
function pickChunks(data, CH = 64) {
  const parts = (data.parts || []).filter((p) => p.index && p.index.length && p.position && p.position.length >= 9);
  let nc = 0;
  for (const p of parts) nc += Math.ceil(p.index.length / 3 / CH);
  const boxes = new Float32Array(nc * 6), meta = new Uint32Array(nc * 3);
  let c = 0;
  for (let pi = 0; pi < parts.length; pi++) {
    const P = parts[pi].position, I = parts[pi].index, nt = I.length / 3;
    for (let t0 = 0; t0 < nt; t0 += CH) {
      const t1 = Math.min(nt, t0 + CH);
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = t0 * 3; k < t1 * 3; k++) {
        const v = I[k] * 3, x = P[v], y = P[v + 1], z = P[v + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      const b = c * 6;
      boxes[b] = x0; boxes[b + 1] = y0; boxes[b + 2] = z0; boxes[b + 3] = x1; boxes[b + 4] = y1; boxes[b + 5] = z1;
      meta[c * 3] = pi; meta[c * 3 + 1] = t0; meta[c * 3 + 2] = t1 - t0;
      c++;
    }
  }
  return { boxes, meta };
}

/**
 * Kit light bollards (buildings/kit/site.js bollard(): 'aluminium_dark' post r 0.09 m, 0.82 m tall, with a
 * 'light_warm' lens band r 0.0905 m from y + 0.6 to y + 0.7 — station / civic / office / market / ferry / clinic
 * forecourts, via z_common.js bollardLine) → building-frame ground points [x, y, z, …] for the city's night light
 * pools (render/city/detail.js; fix round 3, C2). A lens-band-sized cluster of light_warm vertices counts only when
 * a post foot ring stands 0.6 m below it (no pools under wall lamps). With `spec`, y is the GROUND the pool lies on:
 * bollard rows are level (forecourt height) while the city plaza in front follows the terrain (S07 station: feet
 * 0.9 m above … 0.37 m below the plaza), so a foot within −0.6 … +1.2 m of the terrain puts its pool on the draped
 * street surface (heightAt(…, 1.5) + 0.14 m, ≈ the street areas' lift); feet higher up stand on a built platform.
 */
export function findBollards(data, spec = null) {
  let lens = null, post = null;
  for (const p of data.parts || []) {
    if (!p.position) continue;
    if (p.material === 'light_warm') lens = lens ? lens.concat([p.position]) : [p.position];
    else if (p.material === 'aluminium_dark') post = post ? post.concat([p.position]) : [p.position];
  }
  if (!lens || !post) return null;
  // clusters of lens vertices (0.4 m cells, joined within 0.15 m of a cluster box)
  const C = 0.4, cells = new Map(), cl = [];
  const key = (i, j, k) => i * 73856093 ^ j * 19349663 ^ k * 83492791;
  for (const P of lens) {
    for (let v = 0; v < P.length; v += 3) {
      const x = P[v], y = P[v + 1], z = P[v + 2];
      const i = Math.floor(x / C), j = Math.floor(y / C), k = Math.floor(z / C);
      let hit = -1;
      for (let a = -1; a <= 1 && hit < 0; a++) for (let b = -1; b <= 1 && hit < 0; b++) for (let c = -1; c <= 1 && hit < 0; c++) {
        const list = cells.get(key(i + a, j + b, k + c));
        if (!list) continue;
        for (const ci of list) {
          const q = cl[ci];
          if (x > q[0] - 0.15 && x < q[1] + 0.15 && y > q[2] - 0.15 && y < q[3] + 0.15 && z > q[4] - 0.15 && z < q[5] + 0.15) { hit = ci; break; }
        }
      }
      if (hit < 0) {
        hit = cl.length; cl.push([x, x, y, y, z, z]);
        const kk = key(i, j, k); const list = cells.get(kk); if (list) list.push(hit); else cells.set(kk, [hit]);
      }
      const q = cl[hit];
      if (x < q[0]) q[0] = x; if (x > q[1]) q[1] = x; if (y < q[2]) q[2] = y; if (y > q[3]) q[3] = y; if (z < q[4]) q[4] = z; if (z > q[5]) q[5] = z;
    }
  }
  const cand = cl.filter((q) => { const dx = q[1] - q[0], dy = q[3] - q[2], dz = q[5] - q[4]; return dx > 0.14 && dx < 0.21 && dz > 0.14 && dz < 0.21 && dy > 0.07 && dy < 0.13; });
  if (!cand.length) return null;
  // post foot rings (aluminium_dark vertices) on a 0.5 m grid
  const G = 0.5, foot = new Map();
  const gk = (i, k) => i * 92821 + k;
  for (const q of cand) { const cx = (q[0] + q[1]) / 2, cz = (q[4] + q[5]) / 2; foot.set(gk(Math.floor(cx / G), Math.floor(cz / G)), true); }
  const near = new Map();
  for (const P of post) {
    for (let v = 0; v < P.length; v += 3) {
      const x = P[v], z = P[v + 2];
      const kk = gk(Math.floor(x / G), Math.floor(z / G));
      if (!foot.has(kk)) continue;
      let list = near.get(kk); if (!list) near.set(kk, (list = []));
      list.push(x, P[v + 1], z);
    }
  }
  const out = [];
  for (const q of cand) {
    const cx = (q[0] + q[1]) / 2, cz = (q[4] + q[5]) / 2, yb = q[2] - 0.6;
    const list = near.get(gk(Math.floor(cx / G), Math.floor(cz / G)));
    let ok = false;
    if (list) for (let t = 0; t < list.length; t += 3) if (Math.abs(list[t + 1] - yb) < 0.06 && Math.hypot(list[t] - cx, list[t + 2] - cz) < 0.12) { ok = true; break; }
    if (ok) out.push(cx, yb, cz);
  }
  if (!out.length) return null;
  if (spec && Number.isFinite(spec.lat) && Number.isFinite(spec.lon)) {
    const ent = (spec.ground && Number.isFinite(spec.ground.entrance)) ? spec.ground.entrance : 0;
    const P = latLonToUnit(spec.lat, spec.lon, {}), A = buildingAxes(spec.lat, spec.lon, spec.heading || 0, {});
    const r = R_SEA + ent;
    for (let k = 0; k < out.length; k += 3) {
      const x = out[k], y = out[k + 1], z = out[k + 2];
      const X = P.x * r + A.x[0] * x + A.y[0] * y + A.z[0] * z, Y = P.y * r + A.x[1] * x + A.y[1] * y + A.z[1] * z, Z = P.z * r + A.x[2] * x + A.y[2] * y + A.z[2] * z;
      const l = Math.hypot(X, Y, Z);
      const g = heightAt(X / l, Y / l, Z / l, 1.5) - ent;           // terrain in the building frame (y ≈ local up)
      if (Number.isFinite(g) && y - g < 1.2 && y - g > -0.6) out[k + 1] = g + 0.14;
    }
  }
  return new Float32Array(out);
}

export default {
  cityTile: async ({ face, x, y, mass, towns }) => {
    const t0 = performance.now();
    const data = generateCityTile(face, x, y);
    // G02 work towns (render/city/towns.js): synthetic O-zone towns at the mega.towns() anchors
    if (towns && towns.length) {
      try {
        const tc = townContentInTile(face, data.level || 13, x, y, towns);
        if (tc.buildings.length) data.buildings.push(...tc.buildings);
        if (tc.roads.length) data.roads.push(...tc.roads);
      } catch (e) { data.townError = String(e); }
    }
    const genMs = performance.now() - t0;
    if (!mass) return { result: data };
    const transfer = [];
    try {
      const m = buildTileMass(data, generateBuilding, parseBuildingId);
      m.stats.genMs = Math.round(genMs * 10) / 10;
      data.mass = m;
      transfer.push(...massTransferList(m));
    } catch (e) {
      data.mass = null;
      data.massError = String((e && e.stack) || e);
    }
    return { result: data, transfer };
  },
  cityStreets: async (payload) => {
    const out = buildStreets(payload);
    const transfer = streetsTransferList(out);
    try { out.colliderBVH = colliderBVH(out.colliders); } catch (e) { out.colliderBVH = null; }
    if (out.colliderBVH) for (const r of out.colliderBVH.roots) transfer.push(r);
    return { result: out, transfer };
  },
  cityBridge: async (payload) => {
    const out = buildBridge(payload);
    return { result: out, transfer: bridgeTransferList(out) };
  },
  cityBuilding: async ({ spec, lod }) => {
    const t0 = performance.now();
    const data = generateBuilding(spec, lod);
    const transfer = new Set(transferList(data));
    try { data.pickChunks = pickChunks(data); transfer.add(data.pickChunks.boxes.buffer); transfer.add(data.pickChunks.meta.buffer); } catch (e) { data.pickChunks = null; }
    try { data.bollards = findBollards(data, spec); if (data.bollards) transfer.add(data.bollards.buffer); } catch (e) { data.bollards = null; }
    if (data.colliders) {
      try { data.colliderBVH = colliderBVH(data.colliders); } catch (e) { data.colliderBVH = null; }
      if (data.colliderBVH) for (const r of data.colliderBVH.roots) transfer.add(r);
    }
    data.stats.jobMs = Math.round(performance.now() - t0);
    return { result: data, transfer: [...transfer] };
  },
};
