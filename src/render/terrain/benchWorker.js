// Isolated module worker for the terrain dev bench (dev/terrain.html): only the terrain handler,
// so the bench keeps working while other subsystems' handlers are being rewritten.
// Same protocol as workers/world.worker.js. OWNER: terrain-render agent.
import { installControlMaps } from '../../data/controlMaps.js';
import terrainTile from '../../workers/handlers/terrainTile.js';

const HANDLERS = { ...terrainTile, ping: async () => ({ result: 'pong' }) };

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  if (type === '__init') { installControlMaps(payload.maps); self.postMessage({ type: '__ready' }); return; }
  const handler = HANDLERS[type];
  if (!handler) { self.postMessage({ id, ok: false, error: `no handler for ${type}` }); return; }
  try {
    const out = await handler(payload);
    const result = out && out.result !== undefined ? out.result : out;
    self.postMessage({ id, ok: true, result }, (out && out.transfer) || []);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
};
