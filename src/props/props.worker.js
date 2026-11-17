// Private module worker of the props system: generates city tiles (when the city streamer did not
// deliver them) and computes all prop placements (place.js). OWNER: props agent.
// Messages in:  {type:'init', maps}  |  {type:'tile', id, face, x, y, data?}  |  {type:'g01'}  |  {type:'ferries', req, x, y, z, radius}
// Messages out: {type:'ready'}       |  {id, ok, key, result?, error?}  |  {type:'g01', layout?, error?}  |  {type:'ferries', req, net}
import { installControlMaps } from '../data/controlMaps.js';
import { generateCityTile } from '../world/urban.js';
import { placeTile } from './place.js';
import { buildG01Layout, ferryNetwork } from './harbour.js';
import { clearAllLru } from '../world/urban/lru.js';

// memory bound for long sessions (as in workers/world.worker.js): drop the pure urban memo caches every 60 tiles
let tilesSinceTrim = 0;
function trimCaches() { if (++tilesSinceTrim >= 60) { tilesSinceTrim = 0; try { clearAllLru(); } catch { /* keep going */ } } }

const LOCAL = new Set(['roads', 'rails', 'stations', 'docks', 'areas']);

function slim(data) {
  // the main thread needs rails / stations / docks / roads (vehicles, people, trains); buildings are not needed
  const out = { key: data.key, face: data.face, x: data.x, y: data.y, level: data.level, center: data.center };
  for (const k of LOCAL) out[k] = data[k] || [];
  out.areas = (data.areas || []).filter((a) => a.kind === 'plaza' || a.kind === 'station_plaza' || a.kind === 'park');
  return out;
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { installControlMaps(m.maps); self.postMessage({ type: 'ready' }); return; }
  if (m.type === 'g01') {
    try { self.postMessage({ type: 'g01', layout: buildG01Layout() }); } catch (err) { self.postMessage({ type: 'g01', layout: null, error: String((err && err.stack) || err) }); }
    return;
  }
  if (m.type === 'ferries') {
    try { self.postMessage({ type: 'ferries', req: m.req, net: ferryNetwork(m.x, m.y, m.z, m.radius || 7000) }); } catch (err) { self.postMessage({ type: 'ferries', req: m.req, net: null, error: String((err && err.stack) || err) }); }
    return;
  }
  if (m.type !== 'tile') return;
  try {
    const data = m.data || generateCityTile(m.face, m.x, m.y);
    const place = placeTile(data);
    const transfer = [place.trees.buffer, place.shrubs.buffer, place.lamps.buffer, place.furniture.buffer, place.idle.buffer, place.parks.buffer, place.grid.buffer, place.elights.buffer];
    for (const w of place.walks) transfer.push(w.pts.buffer);
    for (const d of place.drives) transfer.push(d.pts.buffer);
    self.postMessage({ id: m.id, ok: true, key: data.key, result: { place, city: slim(data), generated: !m.data } }, transfer);
    trimCaches();
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err && err.stack) || err) });
  }
};
