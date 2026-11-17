// bridgesNear(lat, lon, radiusM) — long bridges (decision DB) around a point, for cameras / UI / renderers:
// [{id, kind:'rail'|'road', type:'cable'|'arch'|'girder', lat, lon (mid-span), heading (deg, along the deck),
//   span (m of water), clearance (m above the water at mid-span), length (m), mainSpan, pylons:[{lat, lon, h}]}]
// Sources: the G01 inner-bay harbour bridge, corridor rail / road crossings (corridors.js segment.bridges) and
// district arterial crossings (citytile.js edgePieces records, scanned within ≤ 8 km). Pure, deterministic.
import { R } from '../../core/constants.js';
import { latLonToUnit, unitToLatLon, enuBasisFromUnit } from '../../core/geo.js';
import { chunkAt, nearestDistrict } from './dchunks.js';
import { chunkRails, pointAt } from './corridors.js';
import { district1, district2, fromPlane, planeHeading } from './districts.js';
import { DC } from './rules.js';
import { edgePieces, designatedBridges } from './citytile.js';

const r5 = (x) => Math.round(x * 1e5) / 1e5;
const r1 = (x) => Math.round(x * 10) / 10;
function headingOf(a, b) {
  const E = enuBasisFromUnit(a.x, a.y, a.z, {});
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const e = dx * E.east[0] + dy * E.east[1] + dz * E.east[2], n = dx * E.north[0] + dy * E.north[1] + dz * E.north[2];
  return Math.round(((Math.atan2(e, n) * 180 / Math.PI) + 360) % 360 * 10) / 10;
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * R; }

export function bridgesNear(lat, lon, radiusM = 5000) {
  const P = latLonToUnit(lat, lon, {});
  const rad = Math.max(0, Math.min(60000, +radiusM || 0));
  const out = [], seen = new Set();
  const push = (b, mid) => { if (seen.has(b.id) || dist(P, mid) > rad) return; seen.add(b.id); out.push(b); };
  // designated harbour / channel bridges (BG01 G01 inner bay, BZ5 ZR5 channel)
  for (const rec of designatedBridges()) {
    const sm = (rec.pylons[0].s + rec.pylons[1].s) / 2, mid = rec.at(sm), ll = unitToLatLon(mid.x, mid.y, mid.z, {});
    push({ id: rec.id, kind: 'road', type: 'cable', lat: r5(ll.lat), lon: r5(ll.lon), heading: headingOf(rec.a, rec.b), span: Math.round(rec.span), clearance: rec.clearance,
      length: Math.round(rec.length), mainSpan: rec.mainSpan, deckWidth: rec.width, pylons: rec.pylons.map((p) => ({ lat: r5(p.lat), lon: r5(p.lon), h: p.h, shape: p.shape, base: p.base, baseR: p.baseR })) }, mid);
  }
  // corridor rail / road bridges: the chunks around the point
  const chunks = new Map();
  const step = 9000, n = Math.ceil((rad + 9000) / step);
  const E = enuBasisFromUnit(P.x, P.y, P.z, {});
  const Q = {};
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
    const de = i * step, dn = j * step;
    if (Math.hypot(de, dn) > rad + 13000) continue;
    const k = 1 / R;
    const x = P.x + (E.east[0] * de + E.north[0] * dn) * k, y = P.y + (E.east[1] * de + E.north[1] * dn) * k, z = P.z + (E.east[2] * de + E.north[2] * dn) * k;
    const l = Math.hypot(x, y, z);
    const ch = chunkAt(x / l, y / l, z / l);
    chunks.set(ch.key, ch);
  }
  for (const ch of chunks.values()) {
    for (const sg of chunkRails(ch)) {
      for (const b of sg.bridges || []) {
        if (seen.has(b.id)) continue;
        const sm = b.pylons.length ? (b.pylons[0].s + b.pylons[b.pylons.length - 1].s) / 2 : b.length / 2;
        const mid = pointAt(sg, b.t0 + sm, {}), a = pointAt(sg, b.t0, {}), c = pointAt(sg, b.t1, {});
        const ll = unitToLatLon(mid.x, mid.y, mid.z, {});
        push({ id: b.id, kind: b.kind, type: b.type, lat: r5(ll.lat), lon: r5(ll.lon), heading: headingOf(a, c), span: Math.round(b.span), clearance: b.clearance,
          length: Math.round(b.length), mainSpan: b.mainSpan, archRise: b.archRise, segment: sg.key.toString(36),
          pylons: b.pylons.map((p) => { const q = pointAt(sg, b.t0 + p.s, {}); const pl = unitToLatLon(q.x, q.y, q.z, {}); return { lat: r5(pl.lat), lon: r5(pl.lon), h: p.h, shape: p.shape, base: p.base, baseR: p.baseR }; }) }, mid);
      }
    }
  }
  // district arterial bridges within ≤ 8 km
  const ar = Math.min(rad, 8000), keys = new Set(), ND = {};
  const st = 1200, m = Math.ceil(ar / st);
  for (let i = -m; i <= m; i++) for (let j = -m; j <= m; j++) {
    const de = i * st, dn = j * st;
    if (Math.hypot(de, dn) > ar + st) continue;
    const k = 1 / R;
    const x = P.x + (E.east[0] * de + E.north[0] * dn) * k, y = P.y + (E.east[1] * de + E.north[1] * dn) * k, z = P.z + (E.east[2] * de + E.north[2] * dn) * k;
    const l = Math.hypot(x, y, z);
    nearestDistrict(x / l, y / l, z / l, ND);
    keys.add(ND.key);
  }
  for (const dk of keys) {
    const D1 = district1(dk);
    if (D1.cls === DC.WILD || !(D1.coastal || D1.waterRing > 0)) continue;
    const G = district2(dk);
    for (const e of G.edges) {
      if (e.w <= 0) continue;
      for (const pc of edgePieces(G, e)) {
        const b = pc.rec;
        if (!b || seen.has(b.id)) continue;
        const elen = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
        const fAt = (sm) => b.fa + sm / elen;
        const pt = (f) => fromPlane(G.D, e.x0 + (e.x1 - e.x0) * f, e.y0 + (e.y1 - e.y0) * f, {});
        const sm = b.pylons.length ? (b.pylons[0].s + b.pylons[b.pylons.length - 1].s) / 2 : b.length / 2;
        const mid = pt(fAt(sm)), ll = unitToLatLon(mid.x, mid.y, mid.z, {});
        push({ id: b.id, kind: 'road', type: b.type, lat: r5(ll.lat), lon: r5(ll.lon), heading: r1(planeHeading(G.D, e.x1 - e.x0, e.y1 - e.y0)), span: Math.round(b.span), clearance: b.clearance,
          length: Math.round(b.length), mainSpan: b.mainSpan, deckWidth: e.w,
          pylons: b.pylons.map((p) => { const q = pt(fAt(p.s)); const pl = unitToLatLon(q.x, q.y, q.z, {}); return { lat: r5(pl.lat), lon: r5(pl.lon), h: p.h, shape: p.shape, base: p.base, baseR: p.baseR }; }) }, mid);
      }
    }
  }
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}
