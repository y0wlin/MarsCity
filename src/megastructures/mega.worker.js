// Private module worker of the megastructure system (no registration in workers/handlers needed).
// OWNER: megastructure agent. Messages {id, type, payload}:
//   'init'      {maps?, compute?, layout?}  install the control maps (only needed to compute the
//               layout: terrain heightAt); compute:true -> compute the terrain-keyed layout and
//               return it; layout -> install a layout computed by another worker
//   'layout'    {layout}          install a layout computed elsewhere
//   'chunk'     {site, chunk, lod} -> ChunkMesh (gen.js), buffers transferred
//   'texture'   {name, size?}     -> procedural PBR texture (buildings/kit/texgen) for mega surfaces;
//               name 'mega_screens' -> harbour-office display atlas (screens.js)
// Only one worker computes the layout: the terrain's first heightAt calls build its coast rasters
// (~12 s per thread); chunk generation itself never samples the terrain.
import { installControlMaps } from '../data/controlMaps.js';
import { heightAt } from '../world/terrain.js';
import { generateTexture } from '../buildings/kit/texgen.js';
import { computeLayout, setLayout, buildChunk, transferList } from './gen.js';
import { generateScreenAtlas } from './screens.js';

self.onmessage = (e) => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'init') {
      if (payload.maps) installControlMaps(payload.maps);
      if (payload.layout) { setLayout(payload.layout); self.postMessage({ id, ok: true, result: { installed: true } }); return; }
      if (payload.compute) {
        const L = computeLayout((x, y, z) => heightAt(x, y, z, 1.0));
        self.postMessage({ id, ok: true, result: L });
        return;
      }
      self.postMessage({ id, ok: true, result: { ready: true } });
    } else if (type === 'layout') {
      setLayout(payload.layout);
      self.postMessage({ id, ok: true, result: { installed: true } });
    } else if (type === 'chunk') {
      const r = buildChunk(payload.site, payload.chunk, payload.lod);
      self.postMessage({ id, ok: true, result: r }, transferList(r));
    } else if (type === 'texture' && payload.name === 'mega_screens') {
      const t = generateScreenAtlas();
      self.postMessage({ id, ok: true, result: t }, [t.color.buffer]);
    } else if (type === 'texture') {
      const t = generateTexture(payload.name, payload.size);
      self.postMessage({ id, ok: true, result: t }, [t.color.buffer, t.normal.buffer, t.orm.buffer]);
    } else self.postMessage({ id, ok: false, error: `unknown message ${type}` });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
};
