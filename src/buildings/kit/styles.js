// Style presets: the shared architectural language per province / zone / year (§2, §3).
// Every type generator should call resolveStyle(spec) so a clinic in ZR6 shares shell, entry
// and roof logic with the houses next to it ("外壳、入口和公共交通保持同系").
//
// A style is plain data (materials by role + feature switches + ranges). Instance variation
// is drawn from spec.hash in styleInstance(), never from Math.random.

import { subRng, hexLin, mixRgb } from './math.js';

/** Far-facade style ids (mass LOD attribute `facade.z`, documented in kit/README.md). */
export const STYLE_ID = { zr_ceramic: 0, zr_terrace: 1, zr_island: 2, zr_cold: 3, o_utility: 4, zr_glass: 5, zr_highland: 6 };

const BASE = {
  wall: 'ceramic_white',      // main shell cladding
  wallAccent: 'ceramic_grey', // plinth / accents
  band: 'ceramic_band',       // slab edge bands / balcony fronts
  soffit: 'render_white',     // undersides
  frame: 'aluminium',         // window frames
  frameDark: 'aluminium_dark',
  glass: 'glass_window',
  railing: 'glass',           // 'glass' | 'bars' | 'mesh'
  railKey: 'aluminium',
  coping: 'aluminium',
  roofSurface: 'roof_membrane',
  deck: 'wood_deck',
  plinth: 'stone_plinth',
  paving: 'paving',
  wallT: 0.32,                // exterior wall thickness incl. cladding
  reveal: 0.2,                // outer reveal depth to frame
  bands: true,                // continuous slab bands
  bandShape: 'curved',        // 'curved' (ZR bullnose) | 'flat' | 'none'
  balconyDepth: [1.5, 2.1],   // living side
  ledgeDepth: [0.55, 0.85],   // service side
  bandCornerR: [1.6, 3.2],
  roofGarden: 0.8,            // probability
  fins: 0.35,                 // sweeping ribbon fins
  terrace: 0,                 // stepped setbacks per floor (probability)
  coveredEntry: false,        // vestibule / covered walkway at entries
  pitchedRoof: 0,             // probability of pitched metal roof
  windowTall: 0.75,           // share of floor-to-ceiling windows on living facades
  glazing: 0.82,              // glazed fraction of a room's facade span behind balconies
  blinds: 0.25,
  louvres: 0,
  shutters: 0,
  planters: 0.55,
  ceramicWarm: [0.0, 1.0],    // ceramic colour temperature range (0 cool … 1 warm)
  accent: 0x6fb7c8,           // cyan guide-light accent
  groundFloor: 'glazed',      // 'glazed' | 'solid' | 'shops'
  storeyH: 3.1,
  groundH: 4.2,
};

export const STYLES = {
  // R2 / Z03 / Z02: warm-white ceramic shells, continuous curved balcony bands, blue-grey glass,
  // glass railings, roof gardens. ZR1 / ZR5 default, ZR3 cores.
  zr_ceramic: { ...BASE, id: 'zr_ceramic' },
  // Z04 canyon / ZR2: stepped terraces following contours, every roof a garden for the street above.
  zr_terrace: { ...BASE, id: 'zr_terrace', terrace: 1, balconyDepth: [1.2, 1.8], roofGarden: 1, fins: 0.15, planters: 0.85, bandCornerR: [1.0, 2.0], plinth: 'basalt' },
  // ZR4 islands: low-rise, deep shading, louvres/shutters, pergolas, lighter ceramic with pale accents.
  zr_island: { ...BASE, id: 'zr_island', balconyDepth: [1.8, 2.6], ledgeDepth: [0.9, 1.2], louvres: 0.5, shutters: 0.35, fins: 0.1, roofGarden: 0.9, bandCornerR: [2.2, 3.6], ceramicWarm: [0.4, 1.0], accent: 0x7cc4b8 },
  // ZR6 cold valley: compact, thick walls, deep reveals, smaller windows, covered vestibules,
  // leeward equipment, snow-shedding copings, some pitched metal roofs.
  zr_cold: { ...BASE, id: 'zr_cold', wall: 'panel_insulated', band: 'ceramic_band', wallT: 0.48, reveal: 0.3, bandShape: 'flat', balconyDepth: [0.9, 1.3], ledgeDepth: [0.25, 0.4], fins: 0, roofGarden: 0.15, coveredEntry: true, pitchedRoof: 0.45, windowTall: 0.25, glazing: 0.4, blinds: 0.1, planters: 0.15, ceramicWarm: [0.2, 0.8], railing: 'bars' },
  // O zone utility (O02): white panel shells, grey trims, yellow safety rails, small windows,
  // external stairs, roof plant. Used by dorms / maintenance / pump houses.
  o_utility: { ...BASE, id: 'o_utility', wall: 'panel_white', wallAccent: 'concrete', band: 'panel_grey', frame: 'aluminium_dark', railing: 'bars', railKey: 'steel_yellow', coping: 'steel', bandShape: 'flat', bands: true, balconyDepth: [0, 0], ledgeDepth: [0.12, 0.2], roofGarden: 0, fins: 0, windowTall: 0, glazing: 0.3, blinds: 0, planters: 0, plinth: 'concrete', groundFloor: 'solid', groundH: 3.4, roofSurface: 'roof_gravel' },
  // glassier commercial / research variant of the ZR language
  zr_glass: { ...BASE, id: 'zr_glass', glass: 'glass_curtain', windowTall: 1, balconyDepth: [0.6, 1.0], fins: 0.5, roofGarden: 0.6 },
  // ZR3 highland towns: ceramic but with stone plinths and sheltered entries, fewer balconies
  zr_highland: { ...BASE, id: 'zr_highland', balconyDepth: [1.2, 1.7], fins: 0.2, coveredEntry: true, roofGarden: 0.6, ceramicWarm: [0.3, 1.0], plinth: 'basalt' },
};

const PROVINCE_STYLE = { ZR1: 'zr_ceramic', ZR2: 'zr_terrace', ZR3: 'zr_highland', ZR4: 'zr_island', ZR5: 'zr_ceramic', ZR6: 'zr_cold' };

/** Resolve the style preset for a spec (spec.style keyword > province > zone). */
export function resolveStyle(spec) {
  const s = String(spec.style || '').toLowerCase();
  if (STYLES[s]) return STYLES[s];
  if (/utility|o-|^o_|oxy|work/.test(s)) return STYLES.o_utility;
  if (/terrace|step|canyon/.test(s)) return STYLES.zr_terrace;
  if (/island|isle/.test(s)) return STYLES.zr_island;
  if (/cold|snow|polar|frost/.test(s)) return STYLES.zr_cold;
  if (/glass|research|office/.test(s)) return STYLES.zr_glass;
  if (/highland|plateau/.test(s)) return STYLES.zr_highland;
  if (spec.zone === 'O') return STYLES.o_utility;
  const code = spec.provinceCode || (typeof spec.province === 'string' ? spec.province : null) || ['', 'OX1', 'OX2', 'OX3', 'OX4', 'OX5', 'OX6', 'ZR1', 'ZR2', 'ZR3', 'ZR4', 'ZR5', 'ZR6'][spec.province | 0];
  if (code && PROVINCE_STYLE[code]) return STYLES[PROVINCE_STYLE[code]];
  if (/ceramic|z-|^zr/.test(s)) return STYLES.zr_ceramic;
  return STYLES.zr_ceramic;
}

/**
 * Per-instance variation drawn from spec.hash (stable): ceramic colour temperature, balcony
 * rhythm, planter density, window family, frame colour, railing type...
 */
export function styleInstance(spec, style) {
  const r = subRng(spec.hash >>> 0, 101);
  const warm = style.ceramicWarm[0] + (style.ceramicWarm[1] - style.ceramicWarm[0]) * r.next();
  // ceramic tints: cool white ↔ warm ivory (linear multipliers, subtle)
  const cool = [0.95, 0.975, 1.0], warmC = [1.0, 0.975, 0.935];
  const shell = mixRgb(cool, warmC, warm);
  const year = spec.yearBuilt || 0;
  const age = year ? Math.max(0, Math.min(1, (2400 - year) / 300)) : r.next() * 0.5; // older → slightly darker / warmer
  const dim = 1 - age * 0.06;
  return {
    warm,
    shellTint: [shell[0] * dim, shell[1] * dim, shell[2] * dim],
    bandTint: mixRgb(shell, [1, 1, 1], 0.5),
    accentTint: hexLin(style.accent),
    frameDark: r.next() < (style.id === 'o_utility' ? 1 : 0.3),
    railing: style.railing === 'glass' && r.next() < 0.18 ? 'bars' : style.railing,
    balconyRhythm: r.int(0, 3),     // which bays get the deep balconies
    bandWave: r.next() < 0.6 ? r.float(0.25, 0.7) : 0, // undulation amplitude (m)
    planterDensity: style.planters * r.float(0.6, 1.2),
    windowFamily: r.int(0, 2),      // 0 plain, 1 transom, 2 blind boxes
    blinds: r.next() < style.blinds,
    fins: r.next() < style.fins,
    roofGarden: r.next() < style.roofGarden,
    pitched: r.next() < style.pitchedRoof,
    louvres: r.next() < style.louvres,
    shutters: r.next() < style.shutters,
    age,
    seed: spec.hash >>> 0,
  };
}

/**
 * Roof decision shared by every type so near roofs agree with the far city colour (urban.js
 * spec.roof = roof type, spec.meta.roofKind = roof material class of the surface look).
 * @returns {{kind:'flat'|'garden'|'pitched'|'other', type:string, surface:string, pitchKey:string,
 *            solar:boolean, skylights:boolean, tint:number[]|null, roofKind:string}}
 *   kind 'other' = a type-specific roof (vault, sawtooth, canopy, gable, spire) the type must build.
 */
export function roofSpec(spec, style, inst) {
  const rk = String((spec.meta && spec.meta.roofKind) || '');
  const rt = String(spec.roof || '');
  let kind;
  if (rt === 'pitched') kind = 'pitched';
  else if (rt === 'garden' || rt === 'terrace') kind = 'garden';
  else if (rt === 'vault' || rt === 'sawtooth' || rt === 'canopy' || rt === 'gable' || rt === 'spire') kind = 'other';
  else if (rt === 'flat') kind = rk === 'garden' || rk === 'terrace' ? 'garden' : 'flat';
  else kind = rk === 'garden' || rk === 'terrace' ? 'garden' : rk === 'metal' ? 'pitched' : (inst && inst.pitched && style.pitchedRoof ? 'pitched' : inst && inst.roofGarden ? 'garden' : 'flat');
  const surface = rk === 'ceramic' || rk === 'warm' ? 'roof_tiles' : rk === 'dark' || rk === 'insulated' ? 'roof_gravel' : rk === 'metal' ? 'roof_metal' : rk === 'membrane' ? 'roof_membrane' : (style.roofSurface || 'roof_membrane');
  const pitchKey = rk === 'metal' || rk === 'dark' || rk === 'insulated' || style.id === 'zr_cold' || style.id === 'o_utility' ? 'roof_metal' : 'roof_shingle';
  const tint = rk === 'warm' ? [1.0, 0.9, 0.78] : rk === 'dark' ? [0.55, 0.55, 0.56] : null;
  return { kind, type: rt, surface, pitchKey, solar: rk === 'solar', skylights: rk === 'glass', tint, roofKind: rk };
}

/** Linear RGB roof colour of a roofSpec for far models (mass LOD), matching the near materials. */
export function roofFarColor(r) {
  if (r.kind === 'garden') return [0.36, 0.46, 0.3];
  if (r.solar) return [0.2, 0.24, 0.32];
  if (r.kind === 'pitched') return r.pitchKey === 'roof_metal' ? [0.6, 0.63, 0.66] : (r.tint ? [0.85 * r.tint[0], 0.82 * r.tint[1], 0.78 * r.tint[2]] : [0.86, 0.84, 0.8]);
  switch (r.surface) {
    case 'roof_tiles': return r.tint ? [0.8 * r.tint[0], 0.78 * r.tint[1], 0.74 * r.tint[2]] : [0.82, 0.8, 0.76];
    case 'roof_gravel': return [0.5, 0.48, 0.45];
    case 'roof_metal': return [0.62, 0.65, 0.68];
    default: return [0.66, 0.66, 0.64];
  }
}
