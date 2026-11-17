// Pure formatting / solar helpers for the UI (no DOM, no THREE — Node-testable). OWNER: ui agent.
import { DEG, RAD } from '../core/constants.js';
import { localSolarTime, subsolarPoint } from '../app/sun.js';

const MINUS = '−';

// --- vocabulary ------------------------------------------------------------------------
export const USE_NAMES = {
  residential: '住宅', residential_tower: '住宅塔楼', shop_row: '沿街商住', clinic: '诊所', school: '学校',
  market: '市集', station: '站房', ferry_terminal: '渡站', research: '研发楼', office: '办公楼',
  civic_tower: '公共塔', warehouse: '仓库', port_shed: '港务仓棚', community: '社区中心',
  pumphouse: '泵房', sluice_station: '闸务站', greenhouse: '温室', dorm: '工务宿舍', control_tower: '监测塔',
  maintenance: '维护房', cold_storage: '冷藏间', farm_station: '农产集散站', water_treatment: '水处理站',
  service_depot: '工务车场', insulated_station: '保温站', meltwater_pump: '融水泵房',
};

export const MODE_NAMES = { orbit: '轨道', fly: '飞行', walk: '步行', focus: '环看' };
export const MODES = ['orbit', 'fly', 'walk', 'focus'];

// --- building viewpoints (controls.buildingViews / buildingView, kit anchors.cameras) -------------
/** the standard eye-level viewpoints of §5 07, in visiting order (= controls BUILDING_VIEWS) */
export const STANDARD_VIEWS = ['street', 'entrance', 'lobby', 'stair', 'living', 'back', 'roof'];
const VIEW_LABELS = {
  street: '街对面', entrance: '入口', lobby: '门厅', stair: '楼梯', living: '起居室', back: '后院', roof: '屋顶',
  interior: '室内', terrace: '露台', walkway: '检修道', control: '控制室', yard: '场院', hoist: '吊装面',
  gate: '闸门', dock: '装卸月台', canopy: '雨棚', basins: '水池', loading: '卸货口',
};
const VIEW_TIPS = {
  street: '眼高 1.65 m，从街对面看立面、门口与后勤入口',
  entrance: '人行道上看门、台阶与坡道，透过门见门厅',
  lobby: '门厅：信报区与交通核',
  stair: '沿已建楼梯上楼',
  living: '二层窗边回望街道与站台',
  back: '绕到背面：厨房小窗、收运道与检修口',
  roof: '屋面：检修出口、排水坡向与设备',
  interior: '主要室内空间',
  terrace: '退台露台',
  walkway: '检修道：水位与水流方向',
  control: '控制室观察窗',
  yard: '车场与回转场',
  hoist: '设备吊装面与检修门',
  gate: '闸门与闸池',
  dock: '装卸月台',
  canopy: '装车雨棚',
  basins: '处理水池',
  loading: '卸货口与服务道',
};
/** O-zone water works whose upper room view is the control room (§5 07 富氧区版本) */
const CONTROL_ROOM_USES = new Set(['maintenance', 'sluice_station', 'pumphouse', 'meltwater_pump', 'water_treatment', 'control_tower']);
const HOME_USES = new Set(['residential', 'residential_tower', 'shop_row', 'dorm']);

/** Chinese name of a building viewpoint; `living` / `lobby` depend on what the building is */
export function viewLabel(name, use) {
  if (name === 'living') {
    if (CONTROL_ROOM_USES.has(use)) return '控制室';
    if (use === 'greenhouse') return '种植走道';
    if (use && !HOME_USES.has(use)) return '楼上室内';
    return VIEW_LABELS.living;
  }
  if (name === 'lobby' && use === 'greenhouse') return '种植走道';
  return VIEW_LABELS[name] || String(name);
}

export function viewTip(name, use) {
  if (name === 'living' && CONTROL_ROOM_USES.has(use)) return VIEW_TIPS.control;
  if (use === 'greenhouse' && (name === 'living' || name === 'lobby')) return '种植床之间的纵向工作道';
  return VIEW_TIPS[name] || '建筑自带的机位';
}

/**
 * Viewpoint buttons for a building: `names` from controls.buildingViews(id) (null → the standard
 * set, controls falls back living → interior → stair → lobby → entrance on its own). Standard views
 * first in visiting order, then the building's own extras; aliases that read the same (a pump
 * house's 'living' = 'control') are listed once. Returns [{name, label, tip}].
 */
export function viewButtons(names, use) {
  const list = Array.isArray(names) && names.length ? names.map(String) : STANDARD_VIEWS;
  const ordered = [...STANDARD_VIEWS.filter((n) => list.includes(n)), ...list.filter((n) => !STANDARD_VIEWS.includes(n))];
  const seen = new Set(), out = [];
  for (const name of ordered) {
    const label = viewLabel(name, use);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ name, label, tip: viewTip(name, use) });
  }
  return out;
}

export const DEBUG_LAYERS = [
  ['none', '无'], ['province', '省域'], ['zone', '辖区'],
  ['density', '建设密度'], ['emission', '夜光强度'], ['wireframe', '地形线框'],
  ['objectId', '对象 ID'], ['lod', 'LOD 层级'], ['normals', '法线'],
];

/**
 * Debug layers in §6 order (locate problems: object ID / wireframe / LOD, then the channels, then the
 * control maps). Values are settings.debugLayer, except 'view:<name>' = the pipeline's
 * settings.debugView (e.g. 'ao', the GTAO buffer) with debugLayer 'none'.
 */
export const DEBUG_GROUPS = [
  ['正片', [['none', '无（正片）']]],
  ['定位', [['objectId', '对象 ID'], ['wireframe', '地形线框'], ['lod', 'LOD 层级']]],
  ['通道', [['normals', '法线'], ['view:ao', '环境光遮蔽']]],
  ['控制图', [['province', '省域'], ['zone', '辖区'], ['density', '建设密度'], ['emission', '夜光强度']]],
];

export const QUALITY_LEVELS = [['ultra', '极致'], ['high', '高'], ['medium', '标准']];

const TIER_NAMES = {
  lowrise: '低层', low: '低层', midrise: '多层', mid: '多层', highrise: '高层', high: '高层', tower: '高层塔楼',
  landmark: '地标', shed: '大跨棚屋', rural: '乡村', village: '村镇', suburban: '近郊', urban: '城区', core: '核心区',
  industrial: '产业区', remote: '偏远站点', utility: '工务', civic: '公共',
};
const STYLE_NAMES = {
  'Z-ceramic': '陶瓷壳', 'Z-glass': '玻璃塔楼', 'Z-terrace': '退台', 'Z-island': '群岛', 'Z-port': '港务', 'Z-cold': '寒地暖廊',
  'O-utility': '工务白壳', 'O-levee': '堤上工务', 'O-polar': '极地保温', ceramic: '陶瓷壳', utility: '工务白壳', glass: '玻璃幕墙',
};
const RESIDENTIAL_USES = new Set(['residential', 'residential_tower', 'shop_row', 'dorm']);

/** short Chinese descriptor for a building's tier / style; unknown values are left out */
export function buildingClassText(spec) {
  if (!spec) return null;
  const parts = [];
  if (spec.tier && TIER_NAMES[spec.tier]) parts.push(TIER_NAMES[spec.tier]);
  if (spec.style && STYLE_NAMES[spec.style]) parts.push(STYLE_NAMES[spec.style]);
  return parts.length ? parts.join('  ') : null;
}

const ENTRANCE_KINDS = {
  main: '主入口', front: '正门', entrance: '入口', service: '后勤入口', back: '后门', rear: '后门', side: '侧门',
  shop: '商铺入口', retail: '商铺入口', residential: '住户入口', resident: '住户入口', lobby: '门厅入口',
  garage: '车库入口', parking: '停车入口', loading: '卸货口', delivery: '收货口', goods: '货物入口',
  emergency: '疏散出口', fire: '消防出口', escape: '疏散出口', staff: '员工入口', maintenance: '检修门',
  platform: '站台入口', ticket: '售票厅入口', passenger: '旅客入口', freight: '货运口', cargo: '货运口',
  equipment: '设备吊装口', control: '值守入口', duty: '值守入口', garden: '庭院门', courtyard: '庭院门',
  roof: '屋面出口', ramp: '坡道入口', school: '校门', clinic: '门诊入口', ambulance: '急救入口', yard: '院门',
  ferry: '候船入口', dock: '码头入口', pedestrian: '步行入口', vehicle: '车行入口', airlock: '门斗入口',
};
const SIDES = {
  front: '正面', back: '背面', rear: '背面', left: '左侧', right: '右侧',
  north: '北侧', south: '南侧', east: '东侧', west: '西侧', top: '屋面', roof: '屋面', bottom: '地下',
};
const COMPASS8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];

// --- numbers ---------------------------------------------------------------------------
/** integer with thousands separators, typographic minus */
export function fmtInt(n) {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (n < 0 && Math.round(Math.abs(n)) !== 0 ? MINUS : '') + s;
}

export function fmtFixed(n, d) {
  const s = Math.abs(n).toFixed(d);
  return (n < 0 && +s !== 0 ? MINUS : '') + s;
}

/** decimals for lat/lon given camera altitude (≈ display resolution) */
export function latLonDecimals(alt) {
  if (!(alt > 0)) return 5;
  if (alt > 1.5e6) return 2;
  if (alt > 4e4) return 3;
  if (alt > 1500) return 4;
  return 5;
}

export function fmtLat(lat, d = 4) {
  if (!Number.isFinite(lat)) return '—';
  return `${Math.abs(lat).toFixed(d)}°${lat >= 0 ? 'N' : 'S'}`;
}

export function fmtLon(lon, d = 4) {
  if (!Number.isFinite(lon)) return '—';
  const l = ((lon + 540) % 360) - 180;
  return `${Math.abs(l).toFixed(d)}°${l >= 0 ? 'E' : 'W'}`;
}

export function fmtLatLon(lat, lon, d = 4) { return `${fmtLat(lat, d)}  ${fmtLon(lon, d)}`; }

/** Adaptive length: 1.65 m, 312 m, 12.4 km, 9,500 km. */
export function fmtLength(m) {
  if (!Number.isFinite(m)) return '—';
  const a = Math.abs(m);
  const sign = m < 0 ? MINUS : '';
  if (a < 10) return `${sign}${a.toFixed(2)} m`;
  if (a < 1000) return `${sign}${Math.round(a)} m`;
  if (a < 1e4) return `${sign}${(a / 1000).toFixed(2)} km`;
  if (a < 1e5) return `${sign}${(a / 1000).toFixed(1)} km`;
  return `${sign}${fmtInt(a / 1000)} km`;
}

/** hours -> "hh:mm" (wraps, rounds to the minute) */
export function fmtHM(hours) {
  if (!Number.isFinite(hours)) return '--:--';
  let m = Math.round((((hours % 24) + 24) % 24) * 60);
  if (m >= 1440) m -= 1440;
  const hh = Math.floor(m / 60), mm = m % 60;
  return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
}

export function compass8(heading) {
  const h = ((heading % 360) + 360) % 360;
  return COMPASS8[Math.round(h / 45) % 8];
}

/** building orientation: "朝南 180°" */
export function fmtFacing(heading) {
  if (!Number.isFinite(heading)) return '—';
  const h = ((Math.round(heading) % 360) + 360) % 360;
  return `朝${compass8(h)} ${h}°`;
}

// --- sun -------------------------------------------------------------------------------
/** sun elevation (deg) at (lat, lon) */
export function sunElevationDeg(lat, lon, solTime, subsolarLat) {
  const s = subsolarPoint(solTime, subsolarLat);
  const H = (lon - s.lon) * DEG, p = lat * DEG, d = subsolarLat * DEG;
  const se = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H);
  return Math.asin(Math.max(-1, Math.min(1, se))) * RAD;
}

/** elevation (deg) at local solar hour t */
export function elevationAtLocal(lat, subsolarLat, t) {
  const H = 15 * (t - 12) * DEG, p = lat * DEG, d = subsolarLat * DEG;
  const se = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(H);
  return Math.asin(Math.max(-1, Math.min(1, se))) * RAD;
}

export function noonElevation(lat, subsolarLat) { return 90 - Math.abs(lat - subsolarLat); }
export function midnightElevation(lat, subsolarLat) { return Math.abs(lat + subsolarLat) - 90; }

/** hour angle (hours, 0..12) where the sun crosses elevation e; null when it never does */
export function hourAngleFor(lat, subsolarLat, e) {
  const p = lat * DEG, d = subsolarLat * DEG;
  const den = Math.cos(p) * Math.cos(d);
  if (Math.abs(den) < 1e-9) return null;
  const c = (Math.sin(e * DEG) - Math.sin(p) * Math.sin(d)) / den;
  if (c > 1 || c < -1) return null;
  return (Math.acos(c) * RAD) / 15;
}

/** sunrise / sunset local times (sun centre on the horizon) */
export function sunTimes(lat, subsolarLat) {
  const H = hourAngleFor(lat, subsolarLat, 0);
  if (H == null) return { polar: noonElevation(lat, subsolarLat) > 0 ? 'day' : 'night', sunrise: null, sunset: null };
  return { polar: null, sunrise: 12 - H, sunset: 12 + H };
}

/**
 * Local solar time for the four presets at a latitude:
 *  dawn  — sun just risen (≈ +4°, low warm light), night — local midnight,
 *  noon  — 12:00, dusk — sun just set (≈ −3°, blue hour with lights coming on).
 * Falls back gracefully in polar day / polar night.
 */
export function presetLocalTime(kind, lat, subsolarLat) {
  if (kind === 'noon') return 12;
  if (kind === 'night') return 0;
  const maxE = noonElevation(lat, subsolarLat), minE = midnightElevation(lat, subsolarLat);
  if (kind === 'dawn') {
    if (maxE < -6) return 12;               // polar night: the brightest moment is noon twilight
    const e = Math.min(4, maxE - 1.5);
    if (e <= minE) return 6;                // polar day: the sun never gets that low
    const H = hourAngleFor(lat, subsolarLat, e);
    return H == null ? 6 : 12 - H;
  }
  if (kind === 'dusk') {
    if (minE > 1) return 18;                // polar day
    const e = Math.max(-3, minE + 1.5);
    if (e >= maxE) return 13;               // polar night
    const H = hourAngleFor(lat, subsolarLat, e);
    return H == null ? 18 : 12 + H;
  }
  return 12;
}

export const TIME_PRESETS = [['dawn', '黎明'], ['noon', '正午'], ['dusk', '黄昏'], ['night', '深夜']];

/** sky colour ramp by sun elevation (Martian blue hour after sunset, butterscotch day) */
const SKY = [
  [-18, [10, 19, 34]], [-9, [18, 31, 54]], [-5, [30, 53, 87]], [-2, [63, 101, 150]],
  [0, [160, 124, 106]], [3, [208, 143, 92]], [8, [220, 164, 111]], [25, [230, 192, 142]], [60, [239, 211, 166]],
];
export function skyColor(e, out = [0, 0, 0]) {
  if (e <= SKY[0][0]) { out[0] = SKY[0][1][0]; out[1] = SKY[0][1][1]; out[2] = SKY[0][1][2]; return out; }
  for (let i = 1; i < SKY.length; i++) {
    if (e <= SKY[i][0]) {
      const [e0, c0] = SKY[i - 1], [e1, c1] = SKY[i];
      const t = (e - e0) / (e1 - e0);
      out[0] = c0[0] + (c1[0] - c0[0]) * t; out[1] = c0[1] + (c1[1] - c0[1]) * t; out[2] = c0[2] + (c1[2] - c0[2]) * t;
      return out;
    }
  }
  const c = SKY[SKY.length - 1][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
  return out;
}

/** CSS gradient of the local sol (0 h → 24 h) at a latitude: shows day length and twilight. */
export function dayGradientCss(lat, subsolarLat, steps = 48) {
  const c = [0, 0, 0];
  const parts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (24 * i) / steps;
    skyColor(elevationAtLocal(lat, subsolarLat, t), c);
    parts.push(`rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0}) ${((100 * i) / steps).toFixed(2)}%`);
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

/** human phase of the local sky */
export function dayPhase(elev, localHour) {
  const morning = localHour < 12;
  if (elev >= 6) return { key: 'day', name: '白昼' };
  if (elev >= 0) return { key: 'low', name: morning ? '清晨' : '傍晚' };
  if (elev >= -6) return { key: 'twilight', name: morning ? '黎明' : '黄昏' };
  return { key: 'night', name: '夜间' };
}

export function localTime(lon, solTime) { return localSolarTime(lon, solTime); }

// --- buildings -------------------------------------------------------------------------
export function useName(use) { return USE_NAMES[use] || (use ? String(use) : '建筑'); }

export function buildingHeight(spec) {
  if (!spec) return NaN;
  if (Number.isFinite(spec.height)) return spec.height;
  if (Number.isFinite(spec.meta?.height)) return spec.meta.height;
  const fh = Number.isFinite(spec.floorHeight) ? spec.floorHeight : 3.1;
  const floors = Math.max(1, spec.floors | 0 || 1);
  const g = Number.isFinite(spec.groundFloorHeight) ? spec.groundFloorHeight : fh;
  return g + (floors - 1) * fh;
}

export function plotId(spec) { return spec?.plot?.id ?? spec?.parcel?.id ?? (typeof spec?.plot === 'string' ? spec.plot : null); }

export function blockId(spec) {
  const b = spec?.block;
  if (b == null) return null;
  return typeof b === 'object' ? (b.id ?? null) : b;
}

/** entrances grouped by kind + side: "主入口 正面 1.8 m", "商铺入口 正面 ×6" */
export function entranceGroups(list) {
  if (!Array.isArray(list)) return [];
  const groups = new Map();
  for (const e of list) {
    if (!e) continue;
    const key = typeof e === 'string' ? e : `${e.kind}|${e.side}`;
    const g = groups.get(key);
    if (g) g.n++; else groups.set(key, { e, n: 1 });
  }
  return [...groups.values()].map(({ e, n }) => {
    if (n === 1) return entranceText(e);
    const kind = typeof e === 'string' ? (ENTRANCE_KINDS[e] || e) : (ENTRANCE_KINDS[e.kind] || e.kind || '入口');
    const side = typeof e === 'object' && e.side ? (SIDES[e.side] || e.side) : '';
    return [kind, side, `×${n}`].filter(Boolean).join(' ');
  });
}

export function entranceText(e) {
  if (!e) return '';
  if (typeof e === 'string') return ENTRANCE_KINDS[e] || e;
  const kind = ENTRANCE_KINDS[e.kind] || e.kind || '入口';
  const side = e.side ? (SIDES[e.side] || e.side) : '';
  const w = Number.isFinite(e.width) ? `${e.width.toFixed(1)} m` : '';
  return [kind, side, w].filter(Boolean).join(' ');
}

const ROOF_SHAPES = {
  flat: '平屋面', garden: '屋顶花园', gable: '双坡屋面', pitched: '坡屋面', shed: '单坡屋面', mono: '单坡屋面', hip: '四坡屋面',
  vault: '拱形屋面', barrel: '筒拱屋面', sawtooth: '锯齿屋面', terrace: '退台屋面', dome: '穹顶', spire: '尖顶', canopy: '挑棚屋面',
  green: '种植屋面', solar: '光伏屋面', glass: '玻璃屋面',
};
const ROOF_KINDS = {
  ceramic: '陶瓷面层', metal: '金属板', membrane: '膜材', solar: '光伏板', garden: '种植层', glass: '玻璃', warm: '暖色面层',
  dark: '深色面层', terrace: '露台', insulated: '保温层',
};
/** roof shape (+ surface material when it adds information): "平屋面  光伏板" */
export function roofText(roof, kind) {
  if (!roof && !kind) return null;
  const k = typeof roof === 'string' ? roof : (roof?.kind || roof?.type || roof?.shape);
  const shape = k ? (ROOF_SHAPES[k] || String(k)) : null;
  const mat = kind && ROOF_KINDS[kind] && !(k === 'garden' && kind === 'garden') && !(k === 'terrace' && kind === 'terrace') ? ROOF_KINDS[kind] : null;
  return [shape, mat].filter(Boolean).join('  ') || null;
}

/** [label, value] for the selection panel: 入住 92% (homes) / 使用率 85% (others) / 使用 48 户 131 人 */
export function occupancyRow(o, use) {
  if (typeof o === 'number' && Number.isFinite(o) && o <= 1) {
    return [use && !RESIDENTIAL_USES.has(use) ? '使用率' : '入住', `${Math.round(o * 100)}%`];
  }
  return ['使用', occupancyText(o, use)];
}

export function occupancyText(o, use) {
  if (o == null) return null;
  if (typeof o === 'number') {
    if (!Number.isFinite(o)) return null;
    if (o > 1) return `${fmtInt(o)} 人`;
    return `${use && !RESIDENTIAL_USES.has(use) ? '使用率' : '入住'} ${Math.round(o * 100)}%`;
  }
  if (typeof o === 'string') return o;
  if (typeof o === 'object') {
    const parts = [];
    const hh = o.households ?? o.units ?? o.dwellings;
    const ppl = o.residents ?? o.people ?? o.population ?? o.occupants;
    const wk = o.workers ?? o.staff ?? o.employees;
    const rate = o.rate ?? o.occupancy ?? o.ratio;
    const cap = o.capacity;
    if (Number.isFinite(hh)) parts.push(`${fmtInt(hh)} 户`);
    if (Number.isFinite(ppl)) parts.push(`${fmtInt(ppl)} 人`);
    if (Number.isFinite(wk)) parts.push(`工作 ${fmtInt(wk)} 人`);
    if (Number.isFinite(cap)) parts.push(`容量 ${fmtInt(cap)}`);
    if (Number.isFinite(rate)) parts.push(`入住 ${Math.round((rate <= 1 ? rate * 100 : rate))}%`);
    if (parts.length) return parts.join('  ');
    try { return JSON.stringify(o).slice(0, 60); } catch { return null; }
  }
  return null;
}

// --- poses / names ---------------------------------------------------------------------
export function roundPose(p) {
  const out = {
    lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7), alt: +p.alt.toFixed(p.alt < 1000 ? 3 : 1),
    heading: +(((p.heading % 360) + 360) % 360).toFixed(3), pitch: +p.pitch.toFixed(3),
  };
  if (p.roll && Math.abs(p.roll) > 1e-4) out.roll = +p.roll.toFixed(3);
  if (p.lens) out.lens = +(+p.lens).toFixed(2); else if (p.fov) out.fov = +(+p.fov).toFixed(3);
  return out;
}

/** "pose=lat,lon,alt,heading,pitch[,lens]&time=h" (App.applyUrlParams format) */
export function poseQuery(p, solTime, { mode, select } = {}) {
  const alt = p.alt < 1000 ? p.alt.toFixed(2) : p.alt.toFixed(0);
  let q = `pose=${p.lat.toFixed(6)},${p.lon.toFixed(6)},${alt},${(((p.heading % 360) + 360) % 360).toFixed(2)},${p.pitch.toFixed(2)}`;
  if (p.lens) q += `,${+(+p.lens).toFixed(2)}`;
  if (Number.isFinite(solTime)) q += `&time=${solTime.toFixed(3)}`;
  if (mode && mode !== 'orbit') q += `&mode=${encodeURIComponent(mode)}`;
  if (select) q += `&select=${encodeURIComponent(select)}`;
  return q;
}

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

/** ASCII file name: mars_<bookmark|pose>_sol<hhmm>_<yyyymmdd-hhmmss>.png */
export function captureFileName({ bookmarkId, pose, solTime, date = new Date(), scale = 1 }) {
  let tag;
  if (bookmarkId) tag = String(bookmarkId).replace(/[^A-Za-z0-9_-]+/g, '-');
  else if (pose) {
    const lat = `${Math.abs(pose.lat).toFixed(4)}${pose.lat >= 0 ? 'N' : 'S'}`;
    const lon = `${Math.abs(pose.lon).toFixed(4)}${pose.lon >= 0 ? 'E' : 'W'}`;
    const alt = pose.alt >= 1e4 ? `${Math.round(pose.alt / 1000)}km` : `${Math.round(pose.alt)}m`;
    tag = `${lat}_${lon}_alt${alt}_h${Math.round(pose.heading)}_p${Math.round(pose.pitch)}`;
  } else tag = 'view';
  const hm = fmtHM(solTime).replace(':', '');
  const d = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `mars_${tag}_sol${hm}${scale > 1 ? `_x${scale}` : ''}_${d}.png`;
}

/** true when pose a is within `metres` and `degrees` (heading / pitch) of pose b (small distances) */
export function posesNear(a, b, metres = 1.0, degrees = 6) {
  if (!a || !b) return false;
  const R0 = 3389500;
  const dy = (a.lat - b.lat) * DEG * R0;
  const dx = ((((a.lon - b.lon) + 540) % 360) - 180) * DEG * R0 * Math.cos(b.lat * DEG);
  const dz = (a.alt ?? 0) - (b.alt ?? 0);
  if (Math.hypot(dx, dy, dz) > metres) return false;
  const dH = Math.abs((((a.heading ?? 0) - (b.heading ?? 0) + 540) % 360) - 180);
  return dH <= degrees && Math.abs((a.pitch ?? 0) - (b.pitch ?? 0)) <= degrees;
}

/**
 * Shot-card name "07 普通建筑｜定格二 入口与门厅" → {num:'07', title:'普通建筑', sub:'定格二 入口与门厅'}.
 * Names without a leading number keep num ''.
 */
export function splitShotName(name = '') {
  const m = /^(\d{1,2})[a-z]?\s+(.+)$/i.exec(String(name).trim());
  const num = m ? m[1].padStart(2, '0') : '';
  const rest = m ? m[2] : String(name).trim();
  const i = rest.search(/[｜|]/);
  const title = (i >= 0 ? rest.slice(0, i) : rest).trim();
  const sub = (i >= 0 ? rest.slice(i + 1) : '').trim();
  return { num, title: title || rest, sub };
}

/**
 * Shot cards grouped by their number (§5 01–09), in data order: [{num, title, main, frames:[bm…]}].
 * `main` is the S<nn> card when present (else the first), `frames` the other cards of that shot.
 */
export function groupShots(shots) {
  const groups = [], byNum = new Map();
  for (const bm of shots || []) {
    const { num, title } = splitShotName(bm.name);
    const key = num || bm.id;
    let g = byNum.get(key);
    if (!g) { g = { num, title, items: [] }; byNum.set(key, g); groups.push(g); }
    g.items.push(bm);
  }
  for (const g of groups) {
    const i = Math.max(0, g.items.findIndex((b) => /^S\d{2}$/.test(b.id)));
    g.main = g.items[i];
    g.frames = g.items.filter((_, j) => j !== i);
    g.title = splitShotName(g.main.name).title || g.title;
    delete g.items;
  }
  return groups;
}

/** levels of the §6 acceptance viewpoints (app/bookmarks.js CHECKS names: "验收｜<level> <title>") */
const CHECK_LEVELS = ['轨道', '区级', '街级', '建筑四面', '建筑屋顶', '屋顶', '室内', '冷启动'];

/**
 * Acceptance viewpoint name "验收｜区级 ZR1 公共塔与主站 1 km" → {level:'区级', title:'ZR1 公共塔与主站 1 km'};
 * megastructure checks ("验收｜G01 港池与潮堤 300 km") → level '巨构' with the full title; anything else → level ''.
 */
export function splitCheckName(name = '') {
  let rest = String(name).trim();
  const i = rest.search(/[｜|]/);
  if (i >= 0 && /^验收\s*$/.test(rest.slice(0, i))) rest = rest.slice(i + 1).trim();
  for (const lv of CHECK_LEVELS) {
    if (rest.startsWith(lv) && (rest.length === lv.length || /\s/.test(rest[lv.length]))) return { level: lv, title: rest.slice(lv.length).trim() || lv };
  }
  if (/^G0\d\b/.test(rest)) return { level: '巨构', title: rest };
  return { level: '', title: rest };
}

/** acceptance viewpoints grouped by consecutive level, in data order: [{level, items:[{bm, title}]}] */
export function groupChecks(checks) {
  const groups = [];
  for (const bm of checks || []) {
    if (!bm) continue;
    const { level, title } = splitCheckName(bm.name || bm.id);
    let g = groups[groups.length - 1];
    if (!g || g.level !== level) { g = { level, items: [] }; groups.push(g); }
    g.items.push({ bm, title });
  }
  return groups;
}

/** compact facts of a camera bookmark: "55 mm · 当地 15:30" */
export function bookmarkFacts(bm) {
  if (!bm || !bm.pose) return '';
  const p = bm.pose, out = [];
  const lens = bm.viewLens || p.lens;
  if (lens) out.push(`${+(+lens).toFixed(0)} mm`);
  else if (p.fov) out.push(`视场 ${(+p.fov).toFixed(0)}°`);
  if (Number.isFinite(bm.solTime)) out.push(`当地 ${fmtHM(localSolarTime(p.lon, bm.solTime))}`);
  return out.join(' · ');
}

/** true when two poses are visually the same camera */
export function posesClose(a, b) {
  if (!a || !b) return false;
  const dAlt = Math.abs(a.alt - b.alt) / Math.max(10, Math.abs(b.alt));
  const dLat = Math.abs(a.lat - b.lat), dLon = Math.abs((((a.lon - b.lon) + 540) % 360) - 180);
  const dH = Math.abs((((a.heading - (b.heading ?? 0)) + 540) % 360) - 180), dP = Math.abs(a.pitch - (b.pitch ?? -90));
  const tolDeg = Math.max(1e-6, (b.alt / 3.3895e6) * 0.002);
  return dAlt < 0.01 && dLat < tolDeg && dLon < tolDeg / Math.max(0.05, Math.cos(b.lat * DEG)) && (Math.abs(b.pitch ?? -90) > 89.5 || dH < 0.5) && dP < 0.5;
}
