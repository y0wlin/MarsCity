// Life and furniture of the world: vegetation, street lights & furniture, trains on timetables,
// ferries & boats with wakes, service vehicles, people for scale. OWNER: props agent.
//
// CONTRACT (ARCHITECTURE.md §4/§8 props)
//   new PropsSystem(app); await init(); update(frame); isIdle(); dispose()
//   nextArrival(stationId, solTime?) -> {solTime, inSeconds, direction (+1 / -1 along the corridor segment),
//       heading (compass deg of travel at the platform), line, towards (terminal station id), cars, headway}
//       | null   — deterministic timetable (pure function of sol time; identical on every reload)
//   trainsNear(maxDist?) -> [{id, line, dir, s, ecef, distance, moving}] trains currently placed
//   boatsNear() -> [{id, type ('ferry'|'cargo'|'tug'|'launch'), ecef, distance, moving, route, s, dir}]
//   wakes -> [{id, kind, points: Float64Array ECEF xyz (newest first, stern now), age: Float32Array (s),
//       width: Float32Array (m), speed (m/s), level (m), beam (m)}]   (also pushed to app.systems.water.addWake)
//   stats() -> counters for diagnostics;  cfg = {trees, lamps, trains, boats, people, vehicles, aircraft} toggles
//   aircraftNear() -> [{id, distance, alt, ecef}] eVTOL air taxis currently placed (aircraft.js)
//   treesNear(ecef, r = 30) -> [{ecef (trunk base, ECEF m), height, crownBase, crownR (m), species, distance}] trees of
//       the loaded prop tiles within r m (horizontal), nearest first (fix round 3: controls' eye-view occlusion checks)
// Shot sync (prompt §5): trains.js SHOT_SYNC / harbour.js SYNC_* / S05X pick timetable phases so the bookmark
// times show the brief's moments (S07 train at the platform, S06 arriving train, S05 ferry crossing the
// foreground with its widening wake, S09b inbound ferry ahead in the mouth). Constants only: still a pure
// function of sol time.
// Everything is a pure function of (seed-derived world data, sol time): trees / lamps / furniture from
// CityTileData (city:tile events or the shared 'cityTile' job), trains from the corridor network,
// boats from docks + the G01 navigation mouth, people / vehicles from sidewalks and streets.
// Debug layers: 'lod' (LOD tints), 'objectId' (per-instance hash colours), 'wireframe'. Clean mode
// draws nothing extra (props are scene content only).
import { PropsMaterials, PROPS_UNIFORMS } from './materials.js';
import { PropsLibrary } from './library.js';
import { TileProps, LOD } from './tiles.js';
import { Trains } from './trains.js';
import { Boats } from './boats.js';
import { People } from './people.js';
import { Vehicles } from './vehicles.js';
import { Aircraft } from './aircraft.js';
import { PropsLights } from './lights.js';
import { smooth, clamp } from './util.js';

const G01_UNIT = (() => { const la = 0.47 * Math.PI / 180, lo = 129.94 * Math.PI / 180; return { x: Math.cos(la) * Math.sin(lo), y: Math.sin(la), z: Math.cos(la) * Math.cos(lo) }; })();

export class PropsSystem {
  constructor(app) {
    this.app = app;
    this.ready = false;
    this.season = { autumn: 0, frost: 0 };
    this.seasonKey = '';
    this.debugMode = 0;
    this.debugKey = 'none';
    this.night = 0;
    this.swayTime = 0;
    this._swayRate = 1;
    this.still = false;
    this.cfg = { trees: true, lamps: true, trains: true, boats: true, people: true, vehicles: true, aircraft: true };
  }

  async init() {
    const app = this.app;
    this.mats = new PropsMaterials(app);
    this.lib = new PropsLibrary(app, this.mats);
    this.lib.build();
    // impostors appear where the simplified 3D trees fade out, and fade out far away
    this.mats.setFade('impostor', LOD.L1 - LOD.B1, LOD.L1 + LOD.B1, LOD.IMP_FAR, LOD.IMP_FAR + LOD.IMP_FADE);
    this.tiles = new TileProps(this);
    this.tiles.init();
    this.trains = new Trains(this);
    this.trains.init();
    this.boats = new Boats(this);
    this.boats.init();
    this.people = new People(this);
    // pedestrians load progressively (one body type per task); People draws nothing until they exist
    this.lib.buildHumans(false).then(() => { this.people.init(); this.people.dirty = true; }).catch((e) => console.error('[props] people', e));
    this.vehicles = new Vehicles(this);
    this.vehicles.init();
    this.aircraft = new Aircraft(this);
    this.aircraft.init();
    this.lights = new PropsLights(this);
    this.lights.init();
    app.events.on('settings', ({ key }) => { if (key === 'debugLayer' || key === 'clean') this._applyDebug(); });
    this._applyDebug();
    this.ready = true;
  }

  _applyDebug() {
    const s = this.app.state.settings;
    const layer = s.clean ? 'none' : (s.debugLayer || 'none');
    this.debugKey = layer;
    this.debugMode = layer === 'lod' ? 1 : layer === 'objectId' ? 2 : 0;
    PROPS_UNIFORMS.uPropsDebug.value = this.debugMode;
    this.mats.setWireframe(layer === 'wireframe');
  }

  /** season (deciduous colour / frost) + prevailing wind from the camera latitude */
  _climate(frame) {
    const lat = frame.camLat, sub = this.app.state.subsolarLat ?? 12;
    // local winter when the sub-solar latitude is on the other hemisphere; tropics stay green
    const away = -Math.sign(lat || 1) * sub;
    const autumn = smooth(3, 18, away) * smooth(14, 32, Math.abs(lat));
    const frost = smooth(48, 70, Math.abs(lat)) * (0.4 + 0.6 * smooth(-10, 15, away));
    const key = `${Math.round(autumn * 20)}|${Math.round(frost * 20)}`;
    if (key !== this.seasonKey) { this.seasonKey = key; this.season = { autumn: Math.round(autumn * 20) / 20, frost: Math.round(frost * 20) / 20 }; }
    // wind (local ENU, x east / z south): trade easterlies in the tropics, westerlies at mid latitudes,
    // polar easterlies; slight meander over the sol
    const a = Math.abs(lat);
    const west = a < 28 ? -1 : a < 62 ? 1 : -1;
    const T = frame.solTime / 24 * Math.PI * 2;
    const ang = (west > 0 ? 0 : Math.PI) + 0.35 * Math.sin(T * 3 + lat * 0.1) + (lat > 0 ? 0.25 : -0.25) * west;
    const strength = clamp(0.45 + 0.25 * Math.sin(T * 2.0 + 1.3) + 0.15 * smooth(40, 70, a), 0.15, 1);
    PROPS_UNIFORMS.uPropsWind.value.set(Math.cos(ang), 0, Math.sin(ang), strength);
  }

  update(frame) {
    if (!this.ready) return;
    const app = this.app;
    // local sun elevation at the camera -> street lights / nav lights (onset like the lighting patch:
    // on from +2 deg, full at -4 deg)
    const sinE = frame.sunDir.dot(frame.camUp);
    this.night = smooth(0.035, -0.07, sinE);
    this._climate(frame);
    // wind sway runs while anything moves (camera / sol time); it settles when the view is static so
    // the temporal accumulation converges on crisp foliage
    const live = frame.moving || !!app.state.timeSpeed;
    this._swayRate += ((live ? 1 : 0) - this._swayRate) * Math.min(1, frame.dt * 1.5);
    if (this._swayRate < 0.02 && !live) this._swayRate = 0;
    this.swayTime += frame.dt * this._swayRate;
    if (this._swayRate > 0 && !live) app.pipeline?.resetAccumulation?.(false);
    // still view (camera and clock at rest for a few frames): LOD / distance fades snap to hard edges
    this._stillFrames = live ? 0 : (this._stillFrames || 0) + 1;
    const still = this._stillFrames > 6;
    if (still !== this.still) { this.still = still; this.mats.setStaticFades(still); }
    this.mats.update(frame, this.night, this.swayTime);
    // ~0.47N 129.94E: G01 harbour (boat layout pending -> not idle within 80 km)
    { const g = frame.camEcef, c = G01_UNIT, l = Math.hypot(g.x, g.y, g.z) || 1; this._nearG01 = (g.x * c.x + g.y * c.y + g.z * c.z) / l > Math.cos(80000 / 3389500); }
    const hideAll = frame.camAltGround > 60000;
    if (hideAll) {
      this.tiles.root.visible = false; this.tiles.nearRoot.visible = false;
      this.trains.group.visible = false; this.boats.group.visible = false;
      this.people.group.visible = false; this.vehicles.group.visible = false; this.aircraft.group.visible = false;
      this.boats.clearWakes();
      this.lights.update(frame, 0);
      return;
    }
    this.tiles.root.visible = this.cfg.trees || this.cfg.lamps;
    this.tiles.stream(frame);
    this.tiles.updateTiles(frame, this.night);
    this.tiles.updateNear(frame);
    this.lights.update(frame, this.night);
    if (this.cfg.trains) this.trains.update(frame, this.night); else this.trains.group.visible = false;
    if (this.cfg.boats) this.boats.update(frame, this.night); else { this.boats.group.visible = false; this.boats.clearWakes(); }
    if (this.cfg.people) this.people.update(frame); else this.people.group.visible = false;
    if (this.cfg.vehicles) this.vehicles.update(frame, this.night); else this.vehicles.group.visible = false;
    if (this.cfg.aircraft && this.cfg.trains) this.aircraft.update(frame, this.night); else this.aircraft.group.visible = false;
  }

  /** a tile's placement became available (people / vehicles re-scan) */
  onTileReady() { this.people.dirty = true; this.vehicles.dirty = true; }

  isIdle() {
    if (!this.ready) return false;
    if (!this.lib.humans) return false;               // pedestrians still loading (progressive)
    // the G01 boat layout (props worker) is still pending while the camera is near the harbour
    if (this.boats && !this.boats.g01Ready && this._nearG01) return false;
    return this.tiles.isIdle();
  }

  nextArrival(stationId, solTime) { return this.trains ? this.trains.nextArrival(stationId, solTime) : null; }
  trainsNear(maxDist = 1e9) { return this.trains ? this.trains.visible.filter((t) => t.distance <= maxDist) : []; }
  boatsNear() { return this.boats ? this.boats.boatsNow.slice() : []; }
  aircraftNear() { return this.aircraft ? this.aircraft.visible.slice() : []; }
  /** trees within r m (horizontal) of an ECEF point, nearest first (fix round 3, P5; tiles.js treesNear):
   *  [{ecef (trunk base), height, crownBase, crownR, species, distance}] — loaded prop tiles only (≈ 2 km) */
  treesNear(ecef, r = 30) { return this.tiles && this.cfg.trees ? this.tiles.treesNear(ecef, r) : []; }
  get wakes() { return this.boats ? this.boats.wakes : []; }

  stats() {
    return {
      tiles: this.tiles?.stats(), trains: this.trains?.stats(), boats: this.boats?.stats(),
      people: this.people?.stats(), vehicles: this.vehicles?.stats(), aircraft: this.aircraft?.stats(), lights: this.lights?.stats(), night: Math.round(this.night * 100) / 100,
      season: this.season,
    };
  }

  dispose() {
    this.tiles?.dispose();
    this.lights?.dispose();
    for (const s of [this.trains, this.boats, this.people, this.vehicles, this.aircraft]) if (s && s.group) this.app.scene.remove(s.group);
  }
}

