// Building generator entry (worker-safe; may import three only for maths/earcut).
// OWNER: building-kit agent (dispatcher + residential). Type agents add files in ./types/.
//
// CONTRACT (ARCHITECTURE.md §7):
//   generateBuilding(spec: BuildingSpec, lod: 'mass'|'exterior'|'full') -> BuildingMeshData
//   BuildingMeshData = {
//     parts: [{ material: MaterialKey, position: Float32Array, normal: Float32Array, uv: Float32Array,
//               index: Uint32Array, color: Float32Array,                // color = linear RGB tint
//               attributes?: { name: { array: Float32Array, itemSize } } }],  // extra per-vertex data
//     colliders?: { position: Float32Array, index: Uint32Array },  // 'full' only: floors, walls, stair ramps
//     bounds: { min:[x,y,z], max:[x,y,z] },
//     anchors: { entrances:[{kind, pos, dir, width}], floors:[{level, y, height}],
//                roof:{ y, access:[x,y,z] }, rooms?:[{floor, name, kind, center, size}],
//                windows?:[...], cameras?:{ street, entrance, lobby, stair, living, back, roof: {pos, target} } },
//     stats: { triangles, vertices, parts, ms, type, lod }
//   }
//   All coordinates in the building local frame (metres; origin = footprint centre at
//   ground.entrance; +Y up; +Z = front facade normal).
//
// ADDING A BUILDING TYPE (other engineers): create src/buildings/types/<name>.js exporting
//   export default {
//     name: 'clinic',
//     uses: ['clinic'],                       // BuildingSpec.use values handled
//     generate(spec, lod, ctx) { ... },       // emit into ctx.b (MeshBuilder); see kit/README.md
//     massing?(spec, ctx) -> volumes,         // optional, for the 'mass' LOD (else footprint box)
//   };
// Files in ./types are discovered automatically (Vite import.meta.glob) — no edit here needed.
// Never import this file from a type file (cycle); import from '../kit/index.js' and, if you
// want the generic fallback pieces, from './generic.js'.

import { MeshBuilder } from './kit/MeshBuilder.js';
import { resolveStyle, styleInstance } from './kit/styles.js';
import { normalizeSpec } from './kit/spec.js';
import { emitMass, defaultMassing } from './kit/mass.js';
import { Rng } from '../core/hash.js';
import { subRng } from './kit/math.js';
import generic from './types/generic.js';

const REGISTRY = new Map();
const TYPES = [];

/** Register a type module ({name, uses, generate, massing?}). Later registrations win. */
export function registerBuildingType(mod) {
  if (!mod || !mod.uses || typeof mod.generate !== 'function') return false;
  for (const u of mod.uses) REGISTRY.set(u, mod);
  if (!TYPES.includes(mod)) TYPES.push(mod);
  return true;
}

/** Register every module of an import.meta.glob-like record {path: module}. */
export function registerTypeModules(record) {
  for (const m of Object.values(record || {})) { const mod = m && (m.default || m); if (mod && mod.uses) registerBuildingType(mod); }
}

registerBuildingType(generic);
let TYPE_MODULES = {};
try {
  // Vite rewrites this into eager imports of every type file (main thread AND workers).
  // In plain Node it throws (no import.meta.glob) — call registerTypeModules() yourself there.
  TYPE_MODULES = import.meta.glob('./types/*.js', { eager: true });
} catch { TYPE_MODULES = {}; }
registerTypeModules(TYPE_MODULES);

/** The type module that will generate `use` (generic fallback when none registered). */
export function typeForUse(use) { return REGISTRY.get(use) || generic; }
/** List of registered type names and uses (debug / UI). */
export function registeredTypes() { return TYPES.map((t) => ({ name: t.name, uses: t.uses.slice() })); }

/**
 * Build the generation context passed to type generators.
 * @returns {GenContext}
 */
export function makeContext(spec, lod) {
  const s = normalizeSpec(spec);
  const style = resolveStyle(s);
  const inst = styleInstance(s, style);
  const b = new MeshBuilder({ hash: s.hash, colliders: lod === 'full' });
  return {
    spec: s,
    lod,
    full: lod === 'full',
    mass: lod === 'mass',
    b,
    style,
    inst,
    rng: new Rng(s.hash >>> 0),
    sub: (channel, extra = 0) => subRng(s.hash >>> 0, channel, extra),
  };
}

/**
 * Generate a building. Never throws: on a generator error the generic type is used and the
 * error is reported in stats.error (and console.warn once per use).
 */
export function generateBuilding(spec, lod = 'exterior') {
  if (lod !== 'mass' && lod !== 'exterior' && lod !== 'full') lod = 'exterior';
  const mod = typeForUse(spec.use);
  let ctx = makeContext(spec, lod);
  let error = null;
  try {
    if (lod === 'mass') {
      const vols = mod.massing ? mod.massing(ctx.spec, ctx) : defaultMassing(ctx.spec, ctx);
      emitMass(ctx, vols);
    } else {
      mod.generate(ctx.spec, lod, ctx);
    }
  } catch (e) {
    error = String((e && e.stack) || e);
    if (!WARNED.has(mod.name + lod)) { WARNED.add(mod.name + lod); console.warn(`[buildings] ${mod.name} failed for ${spec.id} (${lod}), using generic:`, e); }
    ctx.b.dispose();
    ctx = makeContext(spec, lod);
    try {
      if (lod === 'mass') emitMass(ctx, defaultMassing(ctx.spec, ctx));
      else generic.generate(ctx.spec, lod, ctx);
    } catch (e2) { error += '\n' + String(e2); }
  }
  const data = ctx.b.finish();
  data.stats.type = error ? 'generic' : mod.name;
  data.stats.lod = lod;
  data.stats.id = spec.id;
  if (error) data.stats.error = error;
  return data;
}
const WARNED = new Set();

/**
 * Transfer list for a BuildingMeshData (worker → main). Parts share packed ArrayBuffers (one per
 * attribute kind), so the list is de-duplicated (a duplicate transferable throws DataCloneError).
 */
export function transferList(data) {
  const t = new Set();
  for (const p of data.parts) {
    for (const k of ['position', 'normal', 'uv', 'index', 'color']) if (p[k]) t.add(p[k].buffer);
    if (p.attributes) for (const a of Object.values(p.attributes)) t.add(a.array.buffer);
  }
  if (data.colliders) { t.add(data.colliders.position.buffer); if (data.colliders.index) t.add(data.colliders.index.buffer); }
  return [...t];
}
