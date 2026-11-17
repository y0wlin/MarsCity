// Night light pools near the camera (fix round 2, QQ-06). OWNER: props agent.
// The N nearest street / plaza lamp heads and public-entrance canopy downlights (place.js elights) get real
// THREE.SpotLights pointing straight down: app.lighting.patch keeps three's punctual lights, so the pools fall
// on whatever surface is there (plaza paving, steps, kerbs, facades, people, trees) with the right shape on
// steps and slopes. Farther lamps keep the additive decal pools (tiles.js); decals inside the spot radius are
// dimmed (materials.js poolMaterial uSpotR) so near lamps are not counted twice.
// The SpotLights are created once at init and never removed / hidden (a constant light count = no shader
// recompiles of the scene materials); by day their intensity is 0.
// Photometry (app units, lighting.js): sun 8 ≈ 55 klux, night ambient irradiance ≈ 0.02–0.05; a street lamp
// pool peaks at E ≈ 0.16 under the head (≈ 6× the art-directed night ambient: the pools carry the street,
// DS decision), a canopy downlight at ≈ 0.24. I = E · h² (three: irradiance = intensity / d², decay 2).
import * as THREE from 'three';
import { origin } from '../core/origin.js';
import { frameToEcef } from './util.js';

export const N_SPOTS = 20;
const REACH = 140;                  // m: candidate lamps around the camera
const E_LAMP = 0.3, E_POST = 0.28, E_CANOPY = 0.45;
const CANOPY_BONUS = 30;          // m: entrance canopy downlights rank ahead of lamps up to 30 m nearer
const COL_LAMP = new THREE.Color(1.0, 0.88, 0.74);       // ~3800 K neutral-warm LED (tiles.js glow / pools)
const COL_CANOPY = new THREE.Color(1.0, 0.92, 0.82);

export class PropsLights {
  constructor(sys) {
    this.sys = sys; this.app = sys.app;
    this.spots = []; this.sel = []; this.radius = 0; this._key = ''; this.count = 0;
  }

  init() {
    for (let i = 0; i < N_SPOTS; i++) {
      const L = new THREE.SpotLight(COL_LAMP, 0, 30, 1.1, 0.8, 2);
      L.castShadow = false;
      L.name = 'props-spot-' + i;
      L.target.name = 'props-spot-target-' + i;
      this.app.scene.add(L); this.app.scene.add(L.target);
      this.spots.push(L);
    }
  }

  /** choose the nearest lamps (ECEF, float64) when the camera moved or tiles changed */
  _select(cam) {
    const tiles = this.sys.tiles;
    const cand = [];
    const E = {};
    for (const t of tiles.tiles.values()) {
      if (t.state !== 'ready' || !t.place || t.dist > REACH + 60) continue;
      const F = t.F, sy = t.seatC || 0;
      const H = t.heads;
      if (H) for (let i = 0; i < H.length; i += 6) {
        frameToEcef(F, H[i], H[i + 1] + sy, H[i + 2], E);
        const d = Math.hypot(E.x - cam.x, E.y - cam.y, E.z - cam.z);
        if (d > REACH) continue;
        const h = Math.max(2.5, H[i + 1] - H[i + 3]);
        const post = H[i + 5] < 0.8;
        cand.push({ d, x: E.x, y: E.y, z: E.z, up: F.U, h, kind: post ? 1 : 0 });
      }
      const C = t.place.elights;
      if (C) for (let i = 0; i < C.length; i += 6) {
        frameToEcef(F, C[i], C[i + 1] + sy, C[i + 2], E);
        const d = Math.hypot(E.x - cam.x, E.y - cam.y, E.z - cam.z);
        if (d > REACH) continue;
        cand.push({ d, x: E.x, y: E.y, z: E.z, up: F.U, h: 4.6, kind: 2 });
      }
    }
    for (const c of cand) c.rank = c.d - (c.kind === 2 ? CANOPY_BONUS : 0);
    cand.sort((a, b) => a.rank - b.rank);
    this.sel = cand.slice(0, N_SPOTS);
    // radius inside which every lamp has a spot (= the nearest lamp left out): decals inside it are dimmed,
    // spots fade out towards it so a lamp crossing the rim swaps spot <-> decal smoothly
    let r = REACH;
    for (let i = N_SPOTS; i < cand.length; i++) if (cand[i].kind !== 2) r = Math.min(r, cand[i].d);
    this.radius = r;
  }

  update(frame, night) {
    const cam = frame.camEcef;
    const active = night > 0.002 && frame.camAltGround < 600 && this.sys.cfg.lamps !== false;
    const pool = this.sys.mats.pool;
    if (!active) {
      if (this.count) { for (const L of this.spots) L.intensity = 0; this.count = 0; }
      pool.uniforms.uSpotR.value = 0;
      return;
    }
    const key = `${Math.round(cam.x / 2)},${Math.round(cam.y / 2)},${Math.round(cam.z / 2)}|${this.sys.tiles.version}|${this.sys.tiles.seatVersion}`;
    if (key !== this._key) { this._key = key; this._select(cam); }
    const R = Math.max(10, this.radius);
    // the emissive unit follows the night exposure regime (atmosphere round 2: capped ground exposure, emissive
    // gain); the lamp light scales with it so pools keep their relation to the lit windows / lamp heads
    const ES = this.app.lighting?.uniforms?.uLpEmissiveScale?.value;
    const gain = Number.isFinite(ES) && ES > 0 ? ES / 0.05 : 1;
    pool.uniforms.uSpotR.value = this.sel.length ? R : 0;
    let n = 0;
    for (let i = 0; i < N_SPOTS; i++) {
      const L = this.spots[i], c = this.sel[i];
      if (!c) { L.intensity = 0; continue; }
      const d = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z);
      const rim = c.kind === 2 ? 1 : 1 - smoothstep(R * 0.8, R, d);
      const E0 = c.kind === 2 ? E_CANOPY : c.kind === 1 ? E_POST : E_LAMP;
      L.intensity = E0 * c.h * c.h * night * rim * gain;
      L.distance = c.h * (c.kind === 2 ? 3.4 : 5.0);
      L.angle = c.kind === 2 ? 1.18 : 1.12;
      L.penumbra = c.kind === 2 ? 0.65 : 0.8;
      L.color.copy(c.kind === 2 ? COL_CANOPY : COL_LAMP);
      L.position.set(c.x - origin.x, c.y - origin.y, c.z - origin.z);
      L.target.position.set(c.x - c.up[0] * c.h - origin.x, c.y - c.up[1] * c.h - origin.y, c.z - c.up[2] * c.h - origin.z);
      L.target.updateMatrixWorld();
      n++;
    }
    this.count = n;
  }

  stats() { return { spots: this.count, radius: Math.round(this.radius) }; }

  dispose() { for (const L of this.spots) { this.app.scene.remove(L); this.app.scene.remove(L.target); L.dispose?.(); } }
}

function smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
