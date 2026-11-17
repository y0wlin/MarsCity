// Long bridges (fix round 2, decision DB / QS-05, §5 05 细索桥, Z04 canyon arches). Pure, worker-safe.
//
// A water (or gorge) crossing of a corridor rail / road or a district arterial becomes a bridge record:
//   {id, kind:'rail'|'road', type:'cable'|'arch'|'girder', span (m of water / gorge), clearance (m above the water
//    at mid-span), level (water level), mainSpan, pylons:[{s (m from the start of the crossing), h (m above deck),
//    shape:'H'|'A', base:'island'|'pier', baseR (m)}], archRise, length (m, abutment to abutment)}
// Crossings shorter than 300 m keep the old slab girder (no record). The deck profile (deckAt) rises from the
// abutments at the grade of the carrier to the clearance over the navigable channel; city renders the structure
// from these fields and the tile polylines (road / rail pieces flagged bridge:true carry bridgeId, bridgeType,
// bridgeSpan, clearance, pylons [{t 0..1 along that piece}], archRise).
import { hash4 } from '../../core/hash.js';

export const BRIDGE_MIN = 300;     // m of water: shorter crossings stay plain slab bridges
export const BRIDGE_MAX = 3000;    // m of water: longer crossings are not bridged (ferries)

/**
 * Structure of a crossing. span: m of water / gorge; kind 'rail'|'road'; sea: open (navigable) water;
 * gorge: canyon crossing (deck at the rim level); seed: stable hash for variety.
 */
export function bridgeType(span, kind, sea, gorge, seed) {
  if (gorge) {
    if (span < 80 || span > 650) return null;
    return { type: 'arch', mainSpan: span, archRise: Math.round(span * (0.17 + 0.05 * ((seed >>> 4) % 5) / 4)), clearance: 0, pylons: [] };
  }
  if (!(span >= BRIDGE_MIN)) return null;
  if (sea && span >= 600 && span <= BRIDGE_MAX) {
    // cable-stayed main span over the navigable channel, two pylons on pylon islands / caisson piers
    const mainSpan = Math.round(Math.max(320, Math.min(880, span * 0.44)) / 10) * 10;
    const h = Math.round(0.23 * mainSpan + 18);
    const shape = kind === 'rail' ? 'H' : ((seed >>> 8) & 1 ? 'A' : 'H');
    const baseR = Math.round(26 + 0.06 * mainSpan);
    return { type: 'cable', mainSpan, clearance: 42, pylons: [{ off: -mainSpan / 2, h, shape, base: 'island', baseR }, { off: mainSpan / 2, h, shape, base: 'island', baseR }] };
  }
  return { type: 'girder', mainSpan: Math.min(160, Math.round(span / Math.max(1, Math.round(span / 90)))), clearance: sea ? 14 : 9, pylons: [] };
}

/**
 * Deck height (m a.s.l.) at s (m from the start abutment) of a crossing of length len (abutment to abutment):
 * rises from the abutment heights hA / hB at `grade` to level + clearance, never below (ground + 6) is the
 * caller's job (it knows the ground). Arches: straight between the rims.
 */
export function deckAt(rec, s) {
  if (rec.type === 'arch') return rec.hA + (rec.hB - rec.hA) * Math.max(0, Math.min(1, s / rec.length));
  const top = rec.level + rec.clearance;
  const a = rec.hA + rec.grade * s, b = rec.hB + rec.grade * (rec.length - s);
  // high abutments (cliff shores): a straight deck between them, slightly cambered
  const lin = rec.hA + (rec.hB - rec.hA) * (s / rec.length) + Math.min(6, rec.length * 0.002) * Math.sin(Math.PI * Math.max(0, Math.min(1, s / rec.length)));
  return Math.max(Math.min(top, a, b), Math.min(lin, Math.max(rec.hA, rec.hB)));
}

/**
 * Finish a record: abutment heights hA, hB (ground at both ends), water level, length → grade, actual clearance,
 * pylon s positions. `mid` = s of the channel centre (default: centre of the water).
 */
export function finishBridge(rec, hA, hB, level, w0, w1) {
  rec.hA = hA; rec.hB = hB; rec.level = level;
  rec.grade = rec.kind === 'rail' ? 0.03 : 0.05;
  if (rec.type === 'arch') {
    const deck = (hA + hB) / 2;
    rec.clearance = Math.round(deck - level);
    rec.archRise = Math.min(rec.archRise, Math.max(12, Math.round(deck - level - 8)));
  } else {
    const mid = (w0 + w1) / 2;
    rec.clearance = Math.round((deckAt(rec, mid) - level) * 10) / 10;
    for (const p of rec.pylons) p.s = mid + p.off;
  }
  return rec;
}

/** per-piece road / rail fields for the part [sa, sb] (m along the crossing) of bridge rec */
export function pieceFields(rec, sa, sb) {
  const out = { bridgeId: rec.id, bridgeType: rec.type, bridgeSpan: Math.round(rec.span), clearance: rec.clearance };
  if (rec.type === 'arch') out.archRise = rec.archRise;
  const L = sb - sa;
  const py = [];
  if (L > 1e-6) for (const p of rec.pylons) {
    const t = (p.s - sa) / L;
    if (t >= -1e-6 && t <= 1 + 1e-6) py.push({ t: Math.round(Math.max(0, Math.min(1, t)) * 10000) / 10000, h: p.h, shape: p.shape, base: p.base, baseR: p.baseR });
  }
  if (rec.pylons.length) out.pylons = py;
  out.bridgeS = [Math.round(sa * 10) / 10, Math.round(sb * 10) / 10, Math.round(rec.length * 10) / 10];
  return out;
}

export function bridgeSeed(a, b, c) { return hash4(a, b, c, 0xb81d) >>> 0; }
