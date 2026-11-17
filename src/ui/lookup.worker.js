// UI lookup worker: regenerates a BuildingSpec from its stable ID off the main thread. A cold lookup
// warms the urban caches (seconds), which must never freeze the page. It is the fallback of
// nav.js SpecLookup when the app's worker pool cannot answer (benches, old pools). OWNER: ui agent.
//   {id, type:'init', payload:{maps}}  -> installs the control maps
//   {id, type:'spec', payload:{id}}    -> BuildingSpec | null
// Ids resolve exactly like the pool job 'buildingSpec' (workers/handlers/lookup.js, owner core): the same
// handler runs here, so every id family the pool knows is known here too — urban ids (urban.buildingSpecById)
// and the G02 work-town ids OX5-G02-T<k>-<i> that render/city/towns.js synthesises (fix round 3, UI1). When
// that handler cannot be loaded the worker falls back to towns.townSpecById, then urban.buildingSpecById.
import { installControlMaps } from '../data/controlMaps.js';

let resolver = null;   // Promise<(id) => Promise<BuildingSpec|null>>

/** the pool's own 'buildingSpec' job, else towns.townSpecById → urban.buildingSpecById */
function getResolver() {
  if (resolver) return resolver;
  resolver = (async () => {
    try {
      const mod = await import('../workers/handlers/lookup.js');
      const job = mod && mod.default && mod.default.buildingSpec;
      if (typeof job === 'function') return async (id) => { const r = await job({ id }); return (r && r.result) || null; };
    } catch (e) { console.warn('[ui lookup] pool lookup handler unavailable, using towns / urban directly', e); }
    const [towns, urban] = await Promise.all([
      import('../render/city/towns.js').catch(() => null),
      import('../world/urban.js'),
    ]);
    return async (id) => (towns && typeof towns.townSpecById === 'function' ? towns.townSpecById(id) : null)
      || (typeof urban.buildingSpecById === 'function' ? urban.buildingSpecById(id) : null) || null;
  })();
  // a failed import must not poison later requests
  resolver.catch(() => { resolver = null; });
  return resolver;
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data || {};
  try {
    if (type === 'init') {
      installControlMaps(payload.maps);
      self.postMessage({ id, ok: true, result: true });
      return;
    }
    if (type === 'spec') {
      const resolve = await getResolver();
      const spec = await resolve(String(payload.id));
      self.postMessage({ id, ok: true, result: spec || null });
      return;
    }
    self.postMessage({ id, ok: false, error: `unknown request ${type}` });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
