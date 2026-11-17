// Occupancy & window lights (pure, worker-safe). OWNER: urban-fn agent.
//
// One integer hash drives every window decision, implemented twice with bit-identical 32-bit
// integer maths: here in JS (Math.imul / >>>) and in GLSL ES 3.00 (uint arithmetic wraps mod 2^32)
// in OCCUPANCY_GLSL. Near buildings (per-window geometry, JS or GLSL) and far mass models /
// window textures (GLSL) therefore light exactly the same windows at the same minute.
//
// JS API
//   windowLit(buildingHash, floor, bay, localHour, profile = profileOf(use)) -> 0 | 0.55..1.0
//   windowLitMinute(buildingHash, floor, bay, minuteOfDay, profile)         -> same, integer minute
//   windowTemp(buildingHash, floor, bay)                                     -> 0 warm … 1 cool (4 steps)
//   buildingOccupancy(buildingHash, use)                                     -> 0..1 (spec.occupancy)
//   expectedLit(profile, localHour, occupancy)                               -> mean lit fraction (aggregate)
//   profileOf(use)                                                           -> 0..4
//   PROFILE = { RESIDENTIAL:0, OFFICE:1, PUBLIC:2, INDUSTRIAL:3, CARE:4 }
//
// GLSL (paste OCCUPANCY_GLSL into a shader; requires #version 300 es, highp int):
//   uint  occHash(uint a, uint b);
//   uint  occBuildingOcc255(uint buildingHash, int profile);             // 0..255
//   float windowLitMinute(uint buildingHash, int floorIdx, int bay, int minuteOfDay, int profile);
//   float windowLit(uint buildingHash, int floorIdx, int bay, float localHour, int profile);
//   float windowTemp(uint buildingHash, int floorIdx, int bay);
//   uint  occCombine(float hi16, float lo16);   // rebuild a uint32 hash from two exact 16-bit floats
// Exactness: pass the time as an integer minute (floor(localHour*60) on the CPU) when the two sides
// must agree to the minute; windowLit(float) floors in float32 and can differ only at the exact
// minute boundary. buildingHash = spec.hash (uint32). floorIdx 0 = ground floor; bay = window
// column index counted left→right around the facade (any consistent convention, ≥ 0).

export const PROFILE = { RESIDENTIAL: 0, OFFICE: 1, PUBLIC: 2, INDUSTRIAL: 3, CARE: 4 };

const USE_PROFILE = {
  residential: 0, residential_tower: 0, dorm: 0, shop_row: 0,
  office: 1, research: 1,
  station: 2, ferry_terminal: 2, market: 2, community: 2, civic_tower: 2, school: 2,
  clinic: 4,
  warehouse: 3, port_shed: 3, cold_storage: 3, farm_station: 3, service_depot: 3, pumphouse: 3, sluice_station: 3,
  water_treatment: 3, maintenance: 3, meltwater_pump: 3, insulated_station: 3, control_tower: 3, greenhouse: 3,
};
export function profileOf(use) { const p = USE_PROFILE[use]; return p === undefined ? 0 : p; }

/** murmur-style 2→1 integer hash (uint32) */
export function occHash(a, b) {
  let h = Math.imul(a >>> 0, 0x9e3779b1) ^ (b >>> 0);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** building occupancy byte 0..255 (fraction of occupied units / rooms in use) */
export function occBuildingOcc255(bh, profile) {
  const h = occHash(bh >>> 0, 0x0cc0 + profile);
  const base = [196, 150, 170, 120, 205][profile] || 196;
  const spread = [44, 80, 60, 90, 40][profile] || 44;
  return base + (h % (spread + 1));
}
export function buildingOccupancy(bh, use) { return occBuildingOcc255(bh >>> 0, profileOf(use)) / 255; }

/** window decision at an integer minute of the local solar day */
export function windowLitMinute(bh, floor, bay, minute, profile = 0) {
  bh >>>= 0;
  const occ = occBuildingOcc255(bh, profile);
  const wkey = (((floor + 64) & 1023) << 12) | (bay & 4095);
  const wh = occHash(bh, wkey);
  if ((wh & 255) >= occ) return 0;                      // unoccupied unit / unused room
  const m = ((minute % 1440) + 1440) % 1440;
  const r1 = (wh >>> 8) & 63, r2 = (wh >>> 14) & 63, r3 = (wh >>> 20) & 15, sel = (wh >>> 24) & 15;
  let on, off;
  switch (profile) {
    case 1: on = 420 + r1 * 2; off = 1050 + r2 * 4; break;                                  // office 7:00–9:06 → 17:30–21:42
    case 2: if (sel < 5) return 0.55 + 0.03 * r3; on = 990 + r1; off = 1380 + r2 * 3; break; // public: 1/3 all night
    case 3: if (sel < 7) return 0.55 + 0.03 * r3; on = 360 + r1 * 2; off = 1290 + r2 * 2; break; // industrial: shifts
    case 4: if (sel < 8) return 0.55 + 0.03 * r3; on = 1020 + r1; off = 1410 + r2 * 3; break;    // care: half all night
    default: {                                                                               // residential
      if (sel === 0) { on = 330 + r1 * 2; off = 420 + r2 * 2; break; }                       // early risers 5:30–7:00
      on = 1050 + r1 * 3; off = 1320 + r2 * 3; break;                                        // 17:30–20:39 → 22:00–25:09
    }
  }
  // interval [on, off) on a 24 h circle (off may exceed 1440)
  const lit = off <= 1440 ? (m >= on && m < off) : (m >= on || m < off - 1440);
  return lit ? 0.55 + 0.03 * r3 : 0;
}

export function windowLit(bh, floor, bay, localHour, profile = 0) {
  return windowLitMinute(bh, floor, bay, Math.floor(localHour * 60), profile);
}

/** window light colour temperature 0 (warm 2700 K) … 1 (cool 5000 K), 4 levels */
export function windowTemp(bh, floor, bay) {
  const wh = occHash(occHash(bh >>> 0, 0x7e3b), (((floor + 64) & 1023) << 12) | (bay & 4095));
  return ((wh >>> 28) & 3) / 3;
}

/** expected lit fraction for aggregates (mass models, orbit lights) — mean of windowLitMinute>0 */
export function expectedLit(profile, localHour, occupancy) {
  const m = ((Math.floor(localHour * 60) % 1440) + 1440) % 1440;
  const cdf = (x, a, b) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a));
  let f;
  switch (profile) {
    case 1: f = cdf(m, 420, 546) * (1 - cdf(m, 1050, 1302)); break;
    case 2: f = 5 / 16 + 11 / 16 * cdf(m, 990, 1053) * (1 - cdf(m, 1380, 1569)) + 11 / 16 * (m < 1569 - 1440 ? 1 - cdf(m + 1440, 1380, 1569) : 0); break;
    case 3: f = 7 / 16 + 9 / 16 * cdf(m, 360, 486) * (1 - cdf(m, 1290, 1416)); break;
    case 4: f = 8 / 16 + 8 / 16 * cdf(m, 1020, 1083) * (1 - cdf(m, 1410, 1599)) + 8 / 16 * (m < 1599 - 1440 ? 1 - cdf(m + 1440, 1410, 1599) : 0); break;
    default: {
      const eve = cdf(m, 1050, 1239) * (1 - cdf(m, 1320, 1509)) + (m < 1509 - 1440 ? 1 - cdf(m + 1440, 1320, 1509) : 0);
      const morn = cdf(m, 330, 456) * (1 - cdf(m, 420, 546));
      f = 15 / 16 * eve + 1 / 16 * morn;
    }
  }
  return Math.max(0, Math.min(1, f)) * occupancy;
}

export const OCCUPANCY_GLSL = /* glsl */ `
// ---- urban-fn occupancy twin (bit-identical with src/world/occupancy.js) ----
uint occHash(uint a, uint b) {
  uint h = (a * 0x9e3779b1u) ^ b;
  h ^= h >> 16u; h *= 0x85ebca6bu;
  h ^= h >> 13u; h *= 0xc2b2ae35u;
  h ^= h >> 16u;
  return h;
}
uint occBuildingOcc255(uint bh, int profile) {
  uint h = occHash(bh, uint(0x0cc0 + profile));
  uint base = profile == 1 ? 150u : profile == 2 ? 170u : profile == 3 ? 120u : profile == 4 ? 205u : 196u;
  uint spread = profile == 1 ? 80u : profile == 2 ? 60u : profile == 3 ? 90u : profile == 4 ? 40u : 44u;
  return base + (h % (spread + 1u));
}
float windowLitMinute(uint bh, int floorIdx, int bay, int minuteOfDay, int profile) {
  uint occ = occBuildingOcc255(bh, profile);
  uint wkey = (uint((floorIdx + 64) & 1023) << 12u) | uint(bay & 4095);
  uint wh = occHash(bh, wkey);
  if ((wh & 255u) >= occ) return 0.0;
  int m = minuteOfDay - 1440 * int(floor(float(minuteOfDay) / 1440.0));   // safe modulo (GLSL % is undefined for negatives)
  int r1 = int((wh >> 8u) & 63u), r2 = int((wh >> 14u) & 63u), r3 = int((wh >> 20u) & 15u), sel = int((wh >> 24u) & 15u);
  float level = 0.55 + 0.03 * float(r3);
  int on, off;
  if (profile == 1) { on = 420 + r1 * 2; off = 1050 + r2 * 4; }
  else if (profile == 2) { if (sel < 5) return level; on = 990 + r1; off = 1380 + r2 * 3; }
  else if (profile == 3) { if (sel < 7) return level; on = 360 + r1 * 2; off = 1290 + r2 * 2; }
  else if (profile == 4) { if (sel < 8) return level; on = 1020 + r1; off = 1410 + r2 * 3; }
  else {
    if (sel == 0) { on = 330 + r1 * 2; off = 420 + r2 * 2; }
    else { on = 1050 + r1 * 3; off = 1320 + r2 * 3; }
  }
  bool lit = off <= 1440 ? (m >= on && m < off) : (m >= on || m < off - 1440);
  return lit ? level : 0.0;
}
float windowLit(uint bh, int floorIdx, int bay, float localHour, int profile) {
  return windowLitMinute(bh, floorIdx, bay, int(floor(localHour * 60.0)), profile);
}
float windowTemp(uint bh, int floorIdx, int bay) {
  uint wh = occHash(occHash(bh, 0x7e3bu), (uint((floorIdx + 64) & 1023) << 12u) | uint(bay & 4095));
  return float((wh >> 28u) & 3u) / 3.0;
}
uint occCombine(float hi16, float lo16) { return (uint(hi16) << 16u) | uint(lo16); }
`;
