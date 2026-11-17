// Private module worker of the city streamer (same {id, type, payload} protocol as
// workers/world.worker.js). Runs the city jobs so city streaming is never starved by the terrain
// jobs of the shared pool (dense-city terrain tiles take tens of seconds each). OWNER: city agent.
//   'cityTile' / 'cityStreets'   workers/handlers/cityTile.js
//   'building' / 'buildingTextures'  workers/handlers/building.js (building kit)
//   'buildingSpec'               workers/handlers/lookup.js (buildingSpecById)
import { installControlMaps } from '../../data/controlMaps.js';
import cityTile from '../../workers/handlers/cityTile.js';
import building from '../../workers/handlers/building.js';
import lookup from '../../workers/handlers/lookup.js';
import { clearAllLru } from '../../world/urban/lru.js';

// Memory bound for long sessions (final-capture review: a 35+ min convergence of the S06 canyon city ran the tab out of
// memory even with 4 workers): the urban world-function caches are bounded LRUs, but filled to their caps they hold
// several hundred MB per worker. They are pure memo caches, so dropping them every TRIM_JOBS jobs changes no result.
const TRIM_JOBS = 120;
let jobsSinceTrim = 0;
function trimCaches() { if (++jobsSinceTrim >= TRIM_JOBS) { jobsSinceTrim = 0; try { clearAllLru(); } catch { /* keep going */ } } }

const HANDLERS = { ...cityTile, ...building, ...lookup };

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  if (type === '__init') {
    installControlMaps(payload.maps);
    self.postMessage({ type: '__ready' });
    return;
  }
  const handler = HANDLERS[type];
  if (!handler) { self.postMessage({ id, ok: false, error: `no handler for ${type}` }); return; }
  try {
    const t0 = performance.now();
    const out = await handler(payload);
    const result = out && out.result !== undefined ? out.result : out;
    const transfer = (out && out.transfer) || [];
    const t1 = performance.now();
    self.postMessage({ id, ok: true, result, ms: t1 - t0, done: performance.timeOrigin + t1 }, transfer);
    trimCaches();
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
};
