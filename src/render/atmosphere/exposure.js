// Physically motivated exposure prior. OWNER: atmosphere agent.
// The LUT atlas (transmittance + sky-irradiance SH) is read back once so the CPU can evaluate the
// key illuminance of the view every frame:
//   * near the ground / in the air: horizontal illuminance (sun * transmittance * cos + sky) at the
//     camera's location;
//   * from orbit (>= 600 km): ONE locked day-side baseline (the brightness-weighted mean illuminance
//     of a fully lit disc), whatever the framing; the composite's night-side dodge lifts the night
//     hemisphere to nightOrbitExposure, so turntables keep one exposure (§5 02);
//   * 120-600 km: hand-over to the mean illuminance of the sunlit part of the visible disc and the
//     sunlit fraction (day side, terminator, night side framing).
// EV_phys = log2(K / E_key), softly limited by a night exposure. The pipeline's GPU meter only
// nudges this value (+-1.5 EV at half strength; not at all from orbit, lockK), so exposure is stable,
// art-directable and consistent between the day side, the night side and the ground.
import * as THREE from 'three';
import { R } from '../../core/constants.js';
import { LUT, ATMO, SUN_ILLUMINANCE, SUN_COLOR, NIGHT_AMBIENT } from './model.js';

const H_TOP = ATMO.topRadius - ATMO.groundRadius;
const HT = Math.sqrt(ATMO.topRadius * ATMO.topRadius - R * R);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export class ExposurePrior {
  constructor() {
    this.atlas = null;            // Float32Array RGBA, LUT.atlasW x LUT.atlasH
    this.K = 3.3;                 // calibration: noon (E~7.4) -> exposure ~0.45
    this.nightExposure = 8;       // night exposure of high / regional views (>= ~60 km above ground)
    // Fix round 2 (QQ-05, street-level night): near the ground the night exposure is capped at
    // groundNightLift EV over the noon exposure, so ARTIFICIAL light carries the night scene (the night
    // ambient is not lifted into "day for night"). The emissive unit is raised by the same factor
    // (emissiveGain -> uLpEmissiveScale), so windows, lamps and cores keep the brightness they had at
    // the old night exposure while every reflected-light surface (night sky light, twilight) is
    // ~4.5x darker. groundK blends the ground regime (< 4 km above ground) into the round-1
    // regime (>= 60 km); orbit views are unchanged.
    this.groundNightLift = 2.0;
    this.twilightMax = 3;
    this.twilightGain = 1;
    this.skySaturation = 1;
    this.emissiveGain = 1;        // >= 1: factor on the emissive unit for the current view (see above)
    this.groundK = 1;             // 1 near the ground .. 0 from ~60 km above ground
    this.nightK = 0;              // 0 by day .. 1 when the camera's sun is below ~-6 deg
    // effective exposure of the night side from orbit: the composite's night-side dodge lifts the
    // night hemisphere to this whatever the framing (locked baseline, §5 02 turntable)
    this.nightOrbitExposure = 5.0;
    this.minExposure = 0.08;
    this.ev = Math.log2(0.45);
    // 0 near the planet .. 1 from orbit (>= 600 km): weight of the LOCKED orbit baseline. From orbit the
    // exposure does not depend on the framing (lit fraction, clouds, lights): one day-side baseline for
    // every view of the disc, and the night side is lifted geometrically by the composite's dodge, so a
    // turntable keeps one exposure and the same city looks the same in every frame (§5 02).
    this.lockK = 0;
    this.lockedEv = null;
    this.orbitLift = 1.1;
  }

  /**
   * the locked orbit baseline: brightness-weighted mean illuminance of a fully lit disc (0.75 x noon),
   * + orbitLift EV (fix round 2, QQ-14: the disc read dull at -0.76 EV -> +0.8 EV; fix round 3: +1.1 EV
   * together with the output pass's orbit look — midtone contrast above the land level, saturation and a
   * soft shoulder that keeps the brightest cloud tops below white; predicted on the QA S01 pixels: noon
   * city band 179 -> ~194 sRGB, land 139 -> ~150 with more chroma, cloud tops <= ~245).
   * The night side keeps its look: the composite's dodge lifts it to nightOrbitExposure, relative to
   * this exposure (the orbit look leaves the deep shadows / night side at their exposure).
   */
  orbitBaselineEv() {
    if (this.lockedEv === null) this.lockedEv = Math.log2(this.K / Math.max(0.75 * this.illuminance(0, 1), 1e-6)) + this.orbitLift;
    return this.lockedEv;
  }

  setAtlas(data) { this.atlas = data; this.lockedEv = null; this._noonEv = null; }

  /** the largest emissive gain of the ground night regime (what a ground-level night view uses) */
  maxEmissiveGain() {
    const evNight = Math.log2(this.nightExposure), evCap = this.noonEv() + this.groundNightLift;
    const p = 4, evC = -Math.log2(Math.pow(2, -p * evNight) + Math.pow(2, -p * evCap)) / p;
    return Math.pow(2, Math.max(0, evNight - evC));
  }

  _tex(x, y) {
    const W = LUT.atlasW, H = LUT.atlasH;
    x = Math.min(W - 1.0001, Math.max(0, x)); y = Math.min(H - 1.0001, Math.max(0, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const a = this.atlas, o = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const v00 = a[(y0 * W + x0) * 4 + k], v10 = a[(y0 * W + x0 + 1) * 4 + k];
      const v01 = a[((y0 + 1) * W + x0) * 4 + k], v11 = a[((y0 + 1) * W + x0 + 1) * 4 + k];
      o[k] = (v00 * (1 - fx) + v10 * fx) * (1 - fy) + (v01 * (1 - fx) + v11 * fx) * fy;
    }
    return o;
  }

  /** transmittance from altitude h along cos-zenith mu to space (rgb), sun-disc horizon handled */
  sunTransmittance(h, mus) {
    h = Math.max(0, Math.min(H_TOP, h));
    const r = R + h;
    const rho = Math.sqrt(h * (2 * R + h));
    const muh = -rho / r;
    const sinA = Math.sin(0.00305);
    const t = Math.min(1, Math.max(0, (mus - muh + sinA) / (2 * sinA)));
    const vis = t * t * (3 - 2 * t);
    if (vis <= 0) return [0, 0, 0];
    const mu = Math.max(mus, muh + 1e-4);
    const disc = r * r * (mu * mu - 1) + ATMO.topRadius * ATMO.topRadius;
    const d = Math.max(0, -r * mu + Math.sqrt(Math.max(disc, 0)));
    const dmin = H_TOP - h, dmax = rho + HT;
    const xmu = Math.min(1, Math.max(0, (d - dmin) / Math.max(dmax - dmin, 1e-3)));
    const xr = Math.min(1, Math.max(0, rho / HT));
    const v = this._tex(xmu * (LUT.transW - 1), xr * (LUT.transH - 1));
    return [v[0] * vis, v[1] * vis, v[2] * vis];
  }

  /** sky irradiance on a horizontal surface (unit sun, rgb) at altitude h, cos sun zenith mus */
  skyUp(h, mus) {
    const xm = Math.min(1, Math.max(0, 0.5 + 0.5 * Math.sign(mus) * Math.sqrt(Math.abs(mus))));
    const xh = Math.sqrt(Math.min(1, Math.max(0, h / LUT.shMaxAlt)));
    const x = xm * (LUT.shMu - 1), y = LUT.transH + xh * (LUT.shAlt - 1);
    const t0 = this._tex(x, y), t1 = this._tex(x + LUT.shMu, y), t2 = this._tex(x + 2 * LUT.shMu, y);
    const c0 = [t0[0], t0[1], t0[2]], c1 = [t0[3], t1[0], t1[1]], c3 = [t2[1], t2[2], t2[3]];
    return [0, 1, 2].map((k) => Math.max(0, c0[k] * 0.282095 + c1[k] * 0.488603 + c3[k] * 0.630784));
  }

  /** horizontal illuminance (luminance, scene units) at altitude h for cos sun zenith mus */
  illuminance(h, mus) {
    const T = this.sunTransmittance(h, mus), S = this.skyUp(h, mus);
    const c = Math.max(mus, 0);
    const e = [0, 1, 2].map((k) => SUN_ILLUMINANCE * SUN_COLOR[k] * (T[k] * c + S[k]) + NIGHT_AMBIENT[k]);
    return lum(e[0], e[1], e[2]);
  }

  /**
   * frame -> EV (log2 exposure). Uses the camera up vector, altitude, sun direction and view
   * direction (orbit: visible disc sampling).
   */
  /** noon exposure (zenith sun, sea level) in EV: the reference of the ground night cap */
  noonEv() {
    if (this._noonEv === undefined || this._noonEv === null) this._noonEv = Math.log2(this.K / Math.max(this.illuminance(0, 1), 1e-6));
    return this._noonEv;
  }

  update(frame, camera) {
    if (!this.atlas) return this.ev;
    const h = Math.max(0, frame.camAlt);
    const up = frame.camUp, sun = frame.sunDir;
    const evNight = Math.log2(this.nightExposure);
    const smin = (a, b) => -Math.log2(Math.pow(2, -a) + Math.pow(2, -b));   // harmonic blend of exposures
    let ev;
    this.lockK = smooth01(h, 150000, 600000);
    const mus = up.dot(sun);
    this.nightK = 1 - smooth01(mus, -0.10, 0.05);
    const hg = Math.max(0, Number.isFinite(frame.camAltGround) ? frame.camAltGround : h);
    this.groundK = h < 120000 ? 1 - smooth01(hg, 4000, 60000) : 0;
    this.emissiveGain = 1;
    // blue hour (fix round 2, QQ-07): seen from the ground, the twilight sky light (sky, sky irradiance,
    // aerial perspective, clouds, reflections: everything that scales with uLpSunE) is lifted once the
    // sun has set, up to twilightMax x from ~-6 deg, so the S06 blue hour reads as a deep blue-violet
    // sky over an orange horizon with dim blue-lit facades instead of a black sky; the direct sun is
    // already below the horizon then, deep-night twilight is ~0 anyway, and orbit / regional views
    // (groundK 0) are untouched. Art direction like the night ambient and the orbit night dodge.
    this.twilightGain = 1 + (this.twilightMax - 1) * this.groundK * smooth01(-mus, 0.01, 0.10);
    // chroma of the twilight sky seen from the ground (composite, sky pixels only): the multiply
    // scattered / dust-scattered part of the model's twilight is nearly grey; a blue hour reads by its
    // saturated blue-violet over orange, so the sky's saturation rises with the twilight (1 by day)
    this.skySaturation = 1 + 0.75 * this.groundK * smooth01(-mus, 0.0, 0.09);
    if (h < 120000) {
      const E = this.illuminance(Math.min(h, 30000), mus);
      ev = smin(Math.log2(this.K / Math.max(E, 1e-6)), evNight);
      // the cap is a NIGHT cap: it engages once the sun is ~4 deg down and is complete at ~12 deg, so
      // sunset, dusk and the blue hour keep their round-1 exposure (S09 dusk, S06 blue hour)
      const capK = this.groundK * smooth01(-mus, 0.07, 0.21);
      if (capK > 0) {
        // ground night cap: soft minimum (p = 4, leaves the day exposure untouched) with the noon
        // exposure + groundNightLift; the emissive unit is raised by what the cap takes away
        const evCap = this.noonEv() + this.groundNightLift;
        const p = 4;
        const evC = -Math.log2(Math.pow(2, -p * ev) + Math.pow(2, -p * evCap)) / p;
        const evG = ev + (evC - ev) * capK;
        this.emissiveGain = Math.pow(2, Math.max(0, ev - evG));
        ev = evG;
      }
    } else if (this.lockK >= 1) {
      ev = this.orbitBaselineEv();
    } else {
      // sample the visible disc through the camera frustum
      const fwd = _f.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = _r.set(1, 0, 0).applyQuaternion(camera.quaternion);
      const upv = _u.set(0, 1, 0).applyQuaternion(camera.quaternion);
      const D = R + h;
      const c = _c.copy(up).multiplyScalar(-D);           // planet centre relative to the camera
      const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5), tanW = tanH * camera.aspect;
      let lit = 0, all = 0, Esum = 0, E2sum = 0;
      const N = 24;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        const d = _d.copy(fwd).addScaledVector(right, ((i + 0.5) / N * 2 - 1) * tanW).addScaledVector(upv, ((j + 0.5) / N * 2 - 1) * tanH).normalize();
        const b = d.dot(c), cc = c.lengthSq() - R * R, disc = b * b - cc;
        if (disc < 0) continue;
        const t = b - Math.sqrt(disc);
        if (t < 0) continue;
        _p.copy(d).multiplyScalar(t).sub(c);
        const mus = _p.dot(sun) / R;
        all++;
        if (mus > 0.02) { lit++; const e = this.illuminance(0, mus); Esum += e; E2sum += e * e; }
      }
      const evNo = Math.log2(this.nightOrbitExposure);
      if (all === 0) ev = evNo - 0.5;
      else {
        const f = lit / all;
        // brightness-weighted mean illuminance of the sunlit part (expose for the bright day side;
        // the output's local exposure lifts a large night side next to a lit crescent)
        const Ekey = Esum > 0 ? E2sum / Esum : 0;
        const evLit = lit > 0 ? smin(Math.log2(this.K / Math.max(Ekey, 1e-6)), evNo) : evNo;
        const w = Math.min(1, Math.max(0, (f - 0.06) / (0.45 - 0.06)));
        ev = evNo + (evLit - evNo) * (w * w * (3 - 2 * w));
      }
      // descending from orbit: hand over from the locked baseline to the framing-dependent prior
      ev += (this.orbitBaselineEv() - ev) * this.lockK;
    }
    this.ev = Math.max(Math.log2(this.minExposure), ev);
    return this.ev;
  }
}

const smooth01 = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
