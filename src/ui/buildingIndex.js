// Index of BuildingSpecs near the camera, for the searchable building list (§1 可检索的地块与
// 建筑清单, §6 以建筑清单全量核对). Filled from the city system's 'city:tile' events and, for
// tiles it has not streamed, from the shared 'cityTile' worker job. OWNER: ui agent.
import { CITY_TILE_LEVEL, PROVINCE_CODES } from '../core/constants.js';
import { tileAt, tileKey, destination, latLonToUnit, greatCircleDistance, tileSizeMeters } from '../core/geo.js';
import { useName, plotId, blockId, buildingHeight } from './format.js';

const MAX_TILES = 120;   // full BuildingSpec arrays per tile (~2.5 KB each): 600 tiles pinned up to ~0.5 GB of JS heap (memory soak)

export function provinceCodeOf(b) { return b?.provinceCode || PROVINCE_CODES[b?.province] || (b?.province != null ? String(b.province) : ''); }

function tileKeyOf(data, tile) {
  if (data && Number.isFinite(data.face) && Number.isFinite(data.x) && Number.isFinite(data.y)) return tileKey(data.face, data.level ?? CITY_TILE_LEVEL, data.x, data.y);
  if (data?.key) return String(data.key);
  if (tile && Number.isFinite(tile.face)) return tileKey(tile.face, tile.level ?? CITY_TILE_LEVEL, tile.x, tile.y);
  return tile?.key ? String(tile.key) : null;
}

function buildingsOf(res) {
  if (!res) return null;
  if (Array.isArray(res.buildings)) return res.buildings;
  if (Array.isArray(res.data?.buildings)) return res.data.buildings;
  if (Array.isArray(res.tile?.buildings)) return res.tile.buildings;
  return null;
}

export class BuildingIndex {
  constructor(ui) {
    this.ui = ui;
    this.tiles = new Map();   // key -> buildings[]
    this.byId = new Map();
    this.jobs = new Map();    // key -> job
    this.listeners = new Set();
    this.version = 0;
    this.lastError = null;
    ui.app.events.on('city:tile', (e) => {
      const data = e?.data || e?.tile?.data;
      const list = buildingsOf(data);
      const key = tileKeyOf(data, e?.tile);
      if (key && list) this.addTile(key, list);
    });
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { this.version++; for (const fn of this.listeners) { try { fn(); } catch (e) { console.error('[ui index]', e); } } }

  addTile(key, buildings) {
    if (this.tiles.has(key)) {
      for (const b of this.tiles.get(key)) if (b?.id && this.byId.get(b.id) === b) this.byId.delete(b.id);
      this.tiles.delete(key);
    }
    const list = buildings.filter((b) => b && b.id != null && Number.isFinite(b.lat) && Number.isFinite(b.lon));
    this.tiles.set(key, list);
    for (const b of list) this.byId.set(String(b.id), b);
    while (this.tiles.size > MAX_TILES) {
      const [k, old] = this.tiles.entries().next().value;
      this.tiles.delete(k);
      for (const b of old) if (this.byId.get(String(b.id)) === b) this.byId.delete(String(b.id));
    }
    this._emit();
  }

  get(id) { return this.byId.get(String(id)) || null; }

  /** L13 tiles around a point (handles face crossings by sampling the sphere) */
  tilesAround(lat, lon, rings = 1) {
    const step = tileSizeMeters(CITY_TILE_LEVEL) * 0.85;
    const out = new Map();
    const u = {}, t = {};
    for (let j = -rings; j <= rings; j++) {
      for (let i = -rings; i <= rings; i++) {
        let la = lat, lo = lon;
        if (i || j) {
          const dist = Math.hypot(i, j) * step;
          const brg = (Math.atan2(i, j) * 180) / Math.PI;
          const p = destination(lat, lon, brg, dist);
          la = p.lat; lo = p.lon;
        }
        latLonToUnit(la, lo, u);
        tileAt(u.x, u.y, u.z, CITY_TILE_LEVEL, t);
        const key = tileKey(t.face, CITY_TILE_LEVEL, t.x, t.y);
        if (!out.has(key)) out.set(key, { face: t.face, x: t.x, y: t.y, key });
      }
    }
    return [...out.values()];
  }

  /** Make sure tiles around (lat, lon) are indexed; uses worker jobs for missing ones. */
  async ensureAround(lat, lon, rings = 1) {
    const want = this.tilesAround(lat, lon, rings);
    // drop queued jobs for tiles the camera has left
    const wanted = new Set(want.map((w) => w.key));
    for (const [key, job] of this.jobs) if (!wanted.has(key) && !job.started) { try { job.cancel(); } catch { /* ignore */ } this.jobs.delete(key); }
    let missing = want.filter((w) => !this.tiles.has(w.key));
    if (!missing.length) return 0;
    // give the city stream a moment: it may already be producing these tiles
    await new Promise((r) => setTimeout(r, 500));
    missing = missing.filter((w) => !this.tiles.has(w.key) && !this.jobs.has(w.key));
    const workers = this.ui.app.workers;
    if (!missing.length || !workers?.submit) return 0;
    const proms = missing.map((w) => {
      let job;
      // lowest urgency: the list must never delay the tiles the renderer is waiting for
      try { job = workers.submit('cityTile', { face: w.face, x: w.x, y: w.y }, { priority: 1e6 }); } catch (e) { this.lastError = e; return Promise.resolve(); }
      this.jobs.set(w.key, job);
      return job.promise.then((res) => {
        const list = buildingsOf(res);
        if (list) this.addTile(w.key, list);
        else this.addTile(w.key, []);
      }).catch((e) => { if (!e?.cancelled) this.lastError = e; }).finally(() => { this.jobs.delete(w.key); });
    });
    await Promise.all(proms);
    return missing.length;
  }

  get busy() { return this.jobs.size > 0; }

  /** Buildings within maxDist metres, nearest first; text filters id / use / plot / province */
  nearby(lat, lon, { text = '', maxDist = 2500, limit = Infinity, rings = 1 } = {}) {
    const q = text.trim().toLowerCase();
    const res = [];
    for (const w of this.tilesAround(lat, lon, rings)) {
      const list = this.tiles.get(w.key);
      if (!list) continue;
      for (const b of list) {
        const d = greatCircleDistance(lat, lon, b.lat, b.lon);
        if (d > maxDist) continue;
        if (q) {
          const hay = `${b.id} ${b.use || ''} ${useName(b.use)} ${plotId(b) || ''} ${blockId(b) || ''} ${provinceCodeOf(b)}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        res.push({ spec: b, dist: d });
      }
    }
    res.sort((a, b) => a.dist - b.dist);
    return Number.isFinite(limit) ? res.slice(0, limit) : res;
  }

  coverage(lat, lon, rings = 1) {
    const want = this.tilesAround(lat, lon, rings);
    let have = 0;
    for (const w of want) if (this.tiles.has(w.key)) have++;
    return { have, total: want.length };
  }

  static csv(rows) {
    const head = ['id', 'use', 'use_zh', 'province', 'zone', 'plot', 'block', 'district', 'lat', 'lon', 'heading', 'floors', 'height_m', 'ground_m', 'entrances', 'year_built', 'occupancy', 'distance_m'];
    const esc = (v) => {
      if (v == null) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [head.join(',')];
    for (const { spec: b, dist } of rows) {
      const ents = Array.isArray(b.entrances) ? b.entrances.map((e) => (typeof e === 'string' ? e : `${e.kind || ''}@${e.side || ''}`)).join(' ') : '';
      lines.push([
        b.id, b.use, useName(b.use), provinceCodeOf(b), b.zone, plotId(b), blockId(b), b.district,
        b.lat?.toFixed(7), b.lon?.toFixed(7), b.heading, b.floors, Number.isFinite(buildingHeight(b)) ? buildingHeight(b).toFixed(2) : '',
        b.ground?.entrance != null ? (+b.ground.entrance).toFixed(2) : '', ents, b.yearBuilt, b.occupancy, dist != null ? dist.toFixed(1) : '',
      ].map(esc).join(','));
    }
    return lines.join('\n');
  }
}
