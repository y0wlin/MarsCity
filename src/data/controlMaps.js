// Control map access (prompt §4 图层接入). Worker-safe.
//
// Maps are equirectangular, top row = 90°N, left column = 180°W, x wraps.
// Pixel (x,y) centre is at lon = -180 + (x+0.5)*360/W, lat = 90 - (y+0.5)*180/H.
//  - zone      4096×2048  255 = 富氧改造区 (O), 0 = 祝融市宜居城建区 (Z)   → nearest
//  - province  2048×1024  value 1..12 = OX1..OX6, ZR1..ZR6               → nearest
//  - water     2048×1024  255 = inner sea                                  → smooth
//  - density   2048×1024  built density tendency                            → smooth
//  - emission  2048×1024  night emission tendency                           → smooth
//
// The administrative lookups (zone / province) are exact per-pixel (§2: 边界可逐像素查询).
// Visual transitions must NOT use the raw nearest lookups; use the smooth samplers or the
// warped fields in world/fields.js.

let MAPS = null;

const NAMES = ['zone', 'province', 'water', 'density', 'emission'];
// optional precomputed grids (scripts/prep-data.mjs; terrain-fn): loaded when listed in the manifest,
// world/terrain/maps.js validates them and computes them itself otherwise
const OPTIONAL = ['coast', 'canalNodes'];

/** Main thread: fetch the raw .bin layers. Returns the transferable payload + installs it. */
export async function loadControlMaps(base = '/') {
  const manifest = await (await fetch(`${base}data/manifest.json`)).json();
  const payload = {};
  await Promise.all([...NAMES, ...OPTIONAL.filter((k) => manifest[k])].map(async (k) => {
    const m = manifest[k];
    try {
      const buf = await (await fetch(`${base}data/${m.file}`)).arrayBuffer();
      payload[k] = { width: m.width, height: m.height, data: new Uint8Array(buf) };
    } catch (e) { if (!OPTIONAL.includes(k)) throw e; }   // optional grids are recomputed when missing
  }));
  installControlMaps(payload);
  return payload;
}

/** Install maps from a payload ({name: {width,height,data:Uint8Array}}), e.g. inside a worker. */
export function installControlMaps(payload) {
  MAPS = payload;
  return MAPS;
}

export function getControlMaps() {
  if (!MAPS) throw new Error('control maps not loaded');
  return MAPS;
}

export function controlMapsReady() { return !!MAPS; }

// ---------------------------------------------------------------------------
// Samplers
// ---------------------------------------------------------------------------
function nearest(m, lat, lon) {
  const W = m.width, H = m.height;
  let x = Math.floor(((lon + 180) / 360) * W); x = ((x % W) + W) % W;
  let y = Math.floor(((90 - lat) / 180) * H); if (y < 0) y = 0; else if (y >= H) y = H - 1;
  return m.data[y * W + x];
}

function texel(m, x, y) {
  const W = m.width, H = m.height;
  x = ((x % W) + W) % W; if (y < 0) y = 0; else if (y >= H) y = H - 1;
  return m.data[y * W + x];
}

/** bilinear, returns 0..1 */
function bilinear(m, lat, lon) {
  const fx = ((lon + 180) / 360) * m.width - 0.5;
  const fy = ((90 - lat) / 180) * m.height - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const a = texel(m, x0, y0), b = texel(m, x0 + 1, y0), c = texel(m, x0, y0 + 1), d = texel(m, x0 + 1, y0 + 1);
  return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty) / 255;
}

// cubic B-spline weights (C2 continuous, slightly blurring — ideal for 10 km/px control data)
function bspline(t, w) {
  const it = 1 - t, t2 = t * t, t3 = t2 * t;
  w[0] = (it * it * it) / 6;
  w[1] = (3 * t3 - 6 * t2 + 4) / 6;
  w[2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  w[3] = t3 / 6;
}
const WX = [0, 0, 0, 0], WY = [0, 0, 0, 0];
/** smooth (bicubic B-spline), returns 0..1 */
function smooth(m, lat, lon) {
  const fx = ((lon + 180) / 360) * m.width - 0.5;
  const fy = ((90 - lat) / 180) * m.height - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  bspline(fx - x0, WX); bspline(fy - y0, WY);
  let s = 0;
  for (let j = 0; j < 4; j++) {
    let row = 0;
    for (let i = 0; i < 4; i++) row += WX[i] * texel(m, x0 - 1 + i, y0 - 1 + j);
    s += WY[j] * row;
  }
  return s / 255;
}

// --- public lat/lon API --------------------------------------------------------
/** province id 1..12 (exact pixel lookup) */
export function provinceAt(lat, lon) { return nearest(getControlMaps().province, lat, lon); }
/** true if 富氧改造区 (exact pixel lookup on the 4096 mask) */
export function isOxygenZone(lat, lon) { return nearest(getControlMaps().zone, lat, lon) > 127; }
/** 'O' | 'Z' */
export function zoneAt(lat, lon) { return isOxygenZone(lat, lon) ? 'O' : 'Z'; }

export function waterAt(lat, lon) { return smooth(getControlMaps().water, lat, lon); }
export function densityAt(lat, lon) { return smooth(getControlMaps().density, lat, lon); }
export function emissionAt(lat, lon) { return smooth(getControlMaps().emission, lat, lon); }

export function waterBilinear(lat, lon) { return bilinear(getControlMaps().water, lat, lon); }
export function densityBilinear(lat, lon) { return bilinear(getControlMaps().density, lat, lon); }
export function emissionBilinear(lat, lon) { return bilinear(getControlMaps().emission, lat, lon); }
/** smooth sample of the zone mask (0 = Z, 1 = O) for soft visual transitions only */
export function zoneSmooth(lat, lon) { return smooth(getControlMaps().zone, lat, lon); }

export const sample = { nearest, bilinear, smooth };
