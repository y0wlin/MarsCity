// Dev-bench worker for the building kit: same message protocol as workers/world.worker.js but
// only the building handlers (no control maps needed), so the bench keeps working while other
// subsystems are mid-edit. Reports generation time measured inside the worker.
import handlers from '../workers/handlers/building.js';

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  const h = handlers[type];
  if (!h) { self.postMessage({ id, ok: false, error: 'no handler ' + type }); return; }
  try {
    const t0 = performance.now();
    const out = await h(payload);
    const ms = performance.now() - t0;
    self.postMessage({ id, ok: true, result: out.result, ms }, out.transfer || []);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
};
