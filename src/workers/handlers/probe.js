// Utility queries evaluated in workers (owner: core).
import { heightAt } from '../../world/terrain.js';
import { latLonToUnit } from '../../core/geo.js';

export default {
  ping: async () => ({ result: 'pong' }),
  /** payload: {points: Float64Array [lat,lon,...], minWavelength} -> Float64Array heights */
  heights: async ({ points, minWavelength = 0 }) => {
    const n = points.length / 2; const out = new Float64Array(n); const u = {};
    for (let i = 0; i < n; i++) { latLonToUnit(points[2 * i], points[2 * i + 1], u); out[i] = heightAt(u.x, u.y, u.z, minWavelength); }
    return { result: out, transfer: [out.buffer] };
  },
};
