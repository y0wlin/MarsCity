// Game-grade pedestrians (fix round 2, QQ-08 / QS-12). OWNER: props agent.
// Procedural anatomical bodies built from lofted cross-sections (no capsules): proportioned torsos
// (male / female / heavy / slim / child), sculpted heads with nose, ears, brow, jaw and a painted face
// (eyes, brows, lips), hair shells in several styles, hands with fingers, shoes with soles, outfits
// (technical jackets with stand collars, long coats, sweaters, cardigans, hoodies, skirts, hi-vis vests,
// scarves, bags) with geometric folds (sleeve / knee / ankle stacking) and fabric textures.
// Every vertex carries aSkin = (bone0, bone1, weight0, slot); the people material (materials.js
// humanMaterial) evaluates a procedural skeleton in the vertex shader (walk cycle + idle poses), the
// slot picks the per-instance outfit colour from a palette texture and the atlas detail.
// Models: metres, feet at y = 0, facing +z, the person's LEFT is +x. Reference frame = 1.75 m adult;
// buildHuman() scales to the type's stature (heights 1.55–1.90 m, child 1.28 m).
import * as THREE from 'three';

export const HB = { PELVIS: 0, SPINE: 1, HEAD: 2, LTHIGH: 3, LSHIN: 4, LFOOT: 5, RTHIGH: 6, RSHIN: 7, RFOOT: 8, LUARM: 9, LFARM: 10, LHAND: 11, RUARM: 12, RFARM: 13, RHAND: 14 };
export const SLOT = { SKIN: 0, HAIR: 1, TOP: 2, BOTTOM: 3, SHOES: 4, OUTER: 5, ACCENT: 6, DETAIL: 7, FACE: 8, PHONE: 9 };
const S = SLOT;

// ---------------------------------------------------------------------------------------------
// person types (stature, build, outfit topology, hair, face cell) and outfit palettes
// ---------------------------------------------------------------------------------------------
// face cells (atlas): 0 man, 1 man bearded, 2 woman, 3 woman (darker brows / lips), 4 older, 5 child
// hair styles: crop, short, side, bob, long, bun, pony, grey (short, thin)
export const HUMAN_TYPES = [
  { id: 'manJacket', sex: 'm', H: 1.77, build: 1.0, top: 'jacket', bottom: 'trousers', hair: 'short', face: [0, 1], collar: true, bag: 'messenger', outfits: [0, 1, 2, 3] },
  { id: 'manCoat', sex: 'm', H: 1.85, build: 0.93, top: 'coat', bottom: 'trousers', hair: 'side', face: [0, 1], outfits: [4, 5, 6] },
  { id: 'manHeavy', sex: 'm', H: 1.73, build: 1.2, belly: 1, top: 'sweater', bottom: 'trousers', hair: 'crop', face: [1, 0], outfits: [7, 8, 9] },
  { id: 'womanJacket', sex: 'f', H: 1.66, build: 0.97, top: 'jacket', bottom: 'wide', hair: 'bob', face: [2, 3], collar: true, outfits: [10, 11, 12] },
  { id: 'womanSkirt', sex: 'f', H: 1.62, build: 0.9, top: 'cardigan', bottom: 'skirt', hair: 'long', face: [3, 2], bag: 'messenger', outfits: [13, 14, 15] },
  { id: 'womanCoat', sex: 'f', H: 1.71, build: 0.95, top: 'coat', bottom: 'trousers', hair: 'bun', face: [2, 3], scarf: true, outfits: [16, 17, 18] },
  { id: 'elder', sex: 'm', H: 1.67, build: 1.06, top: 'cardigan', bottom: 'trousers', hair: 'grey', face: [4, 4], stoop: 1, outfits: [19, 20] },
  { id: 'worker', sex: 'm', H: 1.79, build: 1.06, top: 'vest', bottom: 'trousers', hair: 'crop', face: [1, 0], outfits: [21, 22] },
  { id: 'youth', sex: 'm', H: 1.82, build: 0.9, top: 'hoodie', bottom: 'trousers', hair: 'side', face: [0, 0], bag: 'backpack', outfits: [23, 24, 25] },
  { id: 'child', sex: 'f', H: 1.28, build: 0.92, child: 1, top: 'hoodie', bottom: 'trousers', hair: 'pony', face: [5, 5], outfits: [26, 27] },
];

// outfit rows: [top, bottom, shoes, outer, accent, detail] colours (sRGB hex) + fabric cells + detail flags.
// fabric cells: 8 knit, 9 twill, 10 technical shell, 11 wool, 12 leather. detail flags: 1 zipper, 2 belt,
// 4 coat buttons + front opening, 8 hi-vis stripes, 16 white soles, 32 jacket pocket welts, 64 hood seam
const O = (top, bottom, shoes, outer, accent, detail, fab, flags) => ({ top, bottom, shoes, outer, accent, detail, fab, flags });
export const OUTFITS = [
  // 0-3 manJacket: technical jacket, trousers, sneakers, bag
  O(0x5d6f7e, 0x2b2f36, 0xe8e6e0, 0x5d6f7e, 0x3a3530, 0x23262a, [10, 9, 12, 10, 9], 1 | 16 | 32),
  O(0xd9d4c8, 0x3b4048, 0x2c2c2e, 0xd9d4c8, 0x7a4a2e, 0x8a8f96, [10, 9, 12, 10, 12], 1 | 2 | 32),
  O(0x8a3b2a, 0x4a4f44, 0xdedad2, 0x8a3b2a, 0x2a2c30, 0x202224, [10, 9, 12, 10, 9], 1 | 16 | 32),
  O(0x2f4a46, 0x6b6253, 0x3a2e26, 0x2f4a46, 0xb9a27a, 0x9aa0a6, [10, 9, 12, 10, 9], 1 | 2 | 32),
  // 4-6 manCoat: long coat over a sweater, trousers, leather shoes / boots
  O(0x8f8a80, 0x24272c, 0x231d19, 0x3c4250, 0x1c1e22, 0x2a2b2e, [8, 9, 12, 11, 12], 4 | 2),
  O(0x2b3036, 0x5b5a55, 0x3a2a20, 0xb9ad96, 0x6e2c22, 0x3c3a36, [8, 9, 12, 11, 12], 4),
  O(0xc9c4b8, 0x30343a, 0x1d1c1c, 0x24282c, 0x5f7f86, 0x2a2b2e, [8, 9, 12, 11, 11], 4 | 2),
  // 7-9 manHeavy: sweater / knit polo, chinos
  O(0x3f5b73, 0x857a62, 0x4a3a2c, 0x3f5b73, 0x2a2c30, 0x3a3a3a, [8, 9, 12, 8, 9], 2),
  O(0x7d6e5b, 0x31363e, 0xe0ddd5, 0x7d6e5b, 0x2a2c30, 0x3a3a3a, [8, 9, 12, 8, 9], 2 | 16),
  O(0x6b2e2e, 0x3c3f45, 0x2c2420, 0x6b2e2e, 0x2a2c30, 0x3a3a3a, [8, 9, 12, 8, 9], 2),
  // 10-12 womanJacket: cropped technical jacket, wide trousers
  O(0xe4e0d6, 0x4d5560, 0xe9e7e2, 0xe4e0d6, 0x2f6f73, 0x9aa0a6, [10, 9, 12, 10, 9], 1 | 16 | 32),
  O(0x9a5a3e, 0x2c2f35, 0x2a2624, 0x9a5a3e, 0xd8cbb0, 0x23262a, [10, 9, 12, 10, 9], 1 | 32),
  O(0x41556b, 0xc8bfae, 0xd9d5cc, 0x41556b, 0x7a3b3b, 0x23262a, [10, 9, 12, 10, 9], 1 | 16 | 32),
  // 13-15 womanSkirt: cardigan over a blouse, skirt, tights
  O(0xb7a58c, 0x2e3440, 0x25211e, 0xb7a58c, 0x3a3436, 0x5a5048, [8, 11, 12, 8, 9], 4),
  O(0x5b6e5a, 0x6f2f35, 0x2c2622, 0x5b6e5a, 0x2d2a2b, 0x5a5048, [8, 11, 12, 8, 9], 4),
  O(0xd7cfc2, 0x39465a, 0xe0dcd4, 0xd7cfc2, 0x2a2a2e, 0x5a5048, [8, 9, 12, 8, 9], 4 | 16),
  // 16-18 womanCoat: long wool coat, scarf, trousers
  O(0x2a2d33, 0x2a2d33, 0x1f1b18, 0xa58d70, 0x9c3b34, 0x2a2b2e, [8, 9, 12, 11, 8], 4),
  O(0xe3ddd1, 0x3a3f47, 0x2b2420, 0x3f4f5f, 0xd9c7a2, 0x2a2b2e, [8, 9, 12, 11, 8], 4),
  O(0x45403a, 0x24272c, 0x2a2622, 0xc9c2b4, 0x386b6e, 0x2a2b2e, [8, 9, 12, 11, 8], 4),
  // 19-20 elder: cardigan, trousers
  O(0x7f7462, 0x4a4c50, 0x3a2e26, 0x7f7462, 0x2a2c30, 0x4a3e34, [8, 9, 12, 8, 9], 4 | 2),
  O(0x55626a, 0x6d665a, 0x2c2622, 0x55626a, 0x2a2c30, 0x4a3e34, [8, 9, 12, 8, 9], 4 | 2),
  // 21-22 worker: hi-vis vest over a work jacket, work trousers, boots
  O(0x3d4650, 0x2f3540, 0x3a2f25, 0x3d4650, 0xf07a1c, 0xd8dde2, [10, 9, 12, 10, 10], 8 | 1),
  O(0x2f3d36, 0x3e4148, 0x2e2822, 0x2f3d36, 0xd8e23a, 0xd8dde2, [10, 9, 12, 10, 10], 8 | 1),
  // 23-25 youth: hoodie, trousers, sneakers, backpack
  O(0x2b2e33, 0x41474f, 0xeeeeea, 0x2b2e33, 0x2f6f73, 0xc8ccd0, [8, 9, 12, 8, 10], 16 | 64),
  O(0x9fa7a0, 0x24282e, 0xe6e4de, 0x9fa7a0, 0x8a3b2a, 0xc8ccd0, [8, 9, 12, 8, 10], 16 | 64),
  O(0x6a4a78, 0x2f3540, 0xd8d5cd, 0x6a4a78, 0x2a2c30, 0xc8ccd0, [8, 9, 12, 8, 10], 16 | 64),
  // 26-27 child: hoodie, trousers
  O(0xd4703a, 0x33415a, 0xeeeeea, 0xd4703a, 0x2a2c30, 0xc8ccd0, [8, 9, 12, 8, 9], 16 | 64),
  O(0x4f8a8b, 0x5a4e6a, 0xe6e4de, 0x4f8a8b, 0x2a2c30, 0xc8ccd0, [8, 9, 12, 8, 9], 16 | 64),
];
// skin tones and hair colours (linear albedo)
export const SKIN_TONES = [[0.63, 0.44, 0.34], [0.56, 0.38, 0.28], [0.48, 0.31, 0.22], [0.41, 0.26, 0.18], [0.33, 0.21, 0.14], [0.26, 0.16, 0.105], [0.19, 0.115, 0.075], [0.135, 0.085, 0.058]];
export const HAIR_TONES = [[0.018, 0.015, 0.014], [0.045, 0.031, 0.022], [0.10, 0.062, 0.036], [0.19, 0.075, 0.032], [0.42, 0.30, 0.16], [0.30, 0.29, 0.28], [0.55, 0.54, 0.52], [0.035, 0.12, 0.13]];

const srgbToLin = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return [f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255)]; };

/** palette texture: 8 slot columns × 32 outfit rows, RGBA float (rgb linear colour, a = fabric cell / flags) */
export function makeOutfitPalette() {
  const W = 8, Hh = 32, d = new Float32Array(W * Hh * 4);
  OUTFITS.forEach((o, r) => {
    const put = (slot, hex, a) => { const c = srgbToLin(hex); const k = (r * W + slot) * 4; d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = a; };
    put(S.TOP, o.top, o.fab[0]); put(S.BOTTOM, o.bottom, o.fab[1]); put(S.SHOES, o.shoes, o.fab[2]);
    put(S.OUTER, o.outer, o.fab[3]); put(S.ACCENT, o.accent, o.fab[4]); put(S.DETAIL, o.detail, o.flags);
    put(S.SKIN, 0xffffff, 0); put(S.HAIR, 0xffffff, 6);
  });
  const t = new THREE.DataTexture(d, W, Hh, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------------------------
// atlas: 4×4 cells of 512² (faces, hair, fabrics, leather). DataTexture from canvas pixels: canvas
// row 0 = v 0, so cell (col,row) spans u [col/4,(col+1)/4], v [row/4,(row+1)/4] with canvas-down = v-up;
// the shader samples local (u, 1 − v). Face cells: rgb = multiplier on the skin tone (1 = plain skin),
// alpha 255 = multiply, alpha ~128 = absolute colour (eye whites, irises).
// ---------------------------------------------------------------------------------------------
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function mkCanvas(w, h) { if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h); const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
// face box in head-local metres (x ±FACE_HW, y ±FACE_HH around the head centre), projected along +z
export const FACE_HW = 0.085, FACE_HH = 0.13;

function drawFace(ctx, eyes, ox, oy, kind, R) {
  const C = 512;
  const X = (x) => ox + (x / (2 * FACE_HW) + 0.5) * C, Y = (y) => oy + (0.5 - y / (2 * FACE_HH)) * C;
  const sx = C / (2 * FACE_HW), sy = C / (2 * FACE_HH);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(ox, oy, C, C);
  const female = kind === 2 || kind === 3, old = kind === 4, child = kind === 5, beard = kind === 1;
  const blob = (x, y, rx, ry, col, a) => { const g = ctx.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), Math.max(rx * sx, ry * sy)); g.addColorStop(0, col.replace('A', a)); g.addColorStop(1, col.replace('A', 0)); ctx.save(); ctx.translate(X(x), Y(y)); ctx.scale(rx * sx / Math.max(rx * sx, ry * sy), ry * sy / Math.max(rx * sx, ry * sy)); ctx.translate(-X(x), -Y(y)); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X(x), Y(y), Math.max(rx * sx, ry * sy), 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
  // soft modelling: eye sockets, under-nose, cheek warmth, jaw shadow
  for (const s of [-1, 1]) {
    blob(s * 0.032, 0.006, 0.026, 0.016, 'rgba(120,80,70,A)', 0.30);              // socket shading
    blob(s * 0.045, -0.03, 0.03, 0.022, 'rgba(255,150,140,A)', female ? 0.28 : 0.16); // cheek warmth
    blob(s * 0.062, -0.075, 0.026, 0.036, 'rgba(110,80,70,A)', 0.1);                // jaw shadow
  }
  blob(0, -0.044, 0.014, 0.006, 'rgba(90,55,45,A)', 0.45);                         // under the nose
  blob(0, 0.0, 0.006, 0.03, 'rgba(255,240,230,A)', 0.25);                          // nose ridge highlight
  for (const s of [-1, 1]) blob(s * 0.009, -0.041, 0.0045, 0.003, 'rgba(60,30,25,A)', 0.7); // nostrils
  if (old) {
    ctx.strokeStyle = 'rgba(120,85,75,0.45)'; ctx.lineWidth = 2.2;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(X(s * 0.018), Y(-0.045)); ctx.quadraticCurveTo(X(s * 0.03), Y(-0.06), X(s * 0.028), Y(-0.078)); ctx.stroke(); }
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(X(-0.03), Y(0.05 + k * 0.009)); ctx.quadraticCurveTo(X(0), Y(0.054 + k * 0.009), X(0.03), Y(0.05 + k * 0.009)); ctx.stroke(); }
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.moveTo(X(s * 0.05), Y(0.004 - k * 0.005)); ctx.lineTo(X(s * 0.06), Y(0.0 - k * 0.007)); ctx.stroke(); }
  }
  if (beard) {
    // short beard / stubble: speckled darker area around the mouth and jaw
    for (let k = 0; k < 2600; k++) {
      const a = R() * Math.PI, rr = 0.045 + R() * 0.04;
      const x = Math.cos(a) * rr * 0.95, y = -0.06 - Math.sin(a) * rr * 0.75 + 0.03;
      if (y > -0.04 && Math.abs(x) < 0.03) continue;
      ctx.fillStyle = `rgba(40,28,22,${0.18 + R() * 0.25})`; ctx.fillRect(X(x), Y(y), 2.5, 2.5);
    }
    for (let k = 0; k < 900; k++) { const x = (R() - 0.5) * 0.05, y = -0.05 + (R() - 0.5) * 0.012; ctx.fillStyle = `rgba(35,25,20,${0.3 + R() * 0.3})`; ctx.fillRect(X(x), Y(y), 2.5, 2.5); }
  } else if (kind === 0 && !child) {
    for (let k = 0; k < 900; k++) { const a = R() * Math.PI, rr = 0.05 + R() * 0.035; const x = Math.cos(a) * rr, y = -0.035 - Math.sin(a) * rr * 0.8; if (y > -0.045 && Math.abs(x) < 0.025) continue; ctx.fillStyle = `rgba(80,60,55,${0.04 + R() * 0.06})`; ctx.fillRect(X(x), Y(y), 2, 2); }
  }
  // lips
  const mw = child ? 0.017 : female ? 0.023 : 0.024, my = -0.061;
  const lipCol = female ? (kind === 3 ? 'rgba(150,45,50,0.95)' : 'rgba(185,95,90,0.9)') : 'rgba(170,105,95,0.75)';
  ctx.fillStyle = lipCol;
  ctx.beginPath(); ctx.moveTo(X(-mw), Y(my));
  ctx.quadraticCurveTo(X(-mw * 0.5), Y(my + 0.0075), X(0), Y(my + 0.0045)); ctx.quadraticCurveTo(X(mw * 0.5), Y(my + 0.0075), X(mw), Y(my));
  ctx.quadraticCurveTo(X(0), Y(my - 0.0105), X(-mw), Y(my)); ctx.fill();
  ctx.strokeStyle = 'rgba(80,35,35,0.8)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(X(-mw), Y(my)); ctx.quadraticCurveTo(X(0), Y(my - 0.0012), X(mw), Y(my)); ctx.stroke();
  // brows
  const browCol = old ? 'rgba(150,140,130,0.9)' : female ? (kind === 3 ? 'rgba(35,25,20,0.95)' : 'rgba(70,50,40,0.85)') : 'rgba(45,32,26,0.95)';
  ctx.strokeStyle = browCol; ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    ctx.lineWidth = female ? 5 : 8;
    ctx.beginPath(); ctx.moveTo(X(s * 0.014), Y(0.021)); ctx.quadraticCurveTo(X(s * 0.032), Y(female ? 0.031 : 0.028), X(s * 0.05), Y(0.019)); ctx.stroke();
  }
  // eyes (absolute colour layer): sclera, iris, pupil, highlight; lids / lashes on the multiply layer
  const ew = child ? 0.0135 : 0.0145, eh = child ? 0.0068 : 0.0058, ey = 0.004;
  const irisCols = ['#3b2a1e', '#4a3322', '#2e4a5c', '#3d5a3a', '#5a4630', '#1e1612'];
  const iris = irisCols[Math.floor(R() * irisCols.length)];
  for (const s of [-1, 1]) {
    const cx = s * 0.032;
    eyes.save();
    eyes.beginPath(); eyes.moveTo(X(cx - ew), Y(ey)); eyes.quadraticCurveTo(X(cx), Y(ey + eh * 1.9), X(cx + ew), Y(ey)); eyes.quadraticCurveTo(X(cx), Y(ey - eh * 1.5), X(cx - ew), Y(ey)); eyes.closePath();
    eyes.fillStyle = '#d8d2cc'; eyes.fill(); eyes.clip();
    eyes.fillStyle = iris; eyes.beginPath(); eyes.arc(X(cx + s * 0.0008), Y(ey + 0.0004), 0.0062 * sx, 0, Math.PI * 2); eyes.fill();
    eyes.fillStyle = '#0a0808'; eyes.beginPath(); eyes.arc(X(cx + s * 0.0008), Y(ey + 0.0004), 0.0026 * sx, 0, Math.PI * 2); eyes.fill();
    eyes.fillStyle = 'rgba(255,255,255,0.9)'; eyes.beginPath(); eyes.arc(X(cx + s * 0.0008 + 0.0018), Y(ey + 0.0022), 0.0011 * sx, 0, Math.PI * 2); eyes.fill();
    // upper-lid shadow inside the eye
    const g = eyes.createLinearGradient(0, Y(ey + eh * 1.6), 0, Y(ey));
    g.addColorStop(0, 'rgba(40,25,20,0.75)'); g.addColorStop(1, 'rgba(40,25,20,0)');
    eyes.fillStyle = g; eyes.fillRect(X(cx - ew), Y(ey + eh * 2), 2 * ew * sx, eh * 2 * sy);
    eyes.restore();
    // lid line + lashes (multiply layer)
    ctx.strokeStyle = female ? 'rgba(20,12,10,0.95)' : 'rgba(45,30,25,0.85)'; ctx.lineWidth = female ? 4.5 : 3;
    ctx.beginPath(); ctx.moveTo(X(cx - ew * 1.08), Y(ey - 0.0005)); ctx.quadraticCurveTo(X(cx), Y(ey + eh * 2.0), X(cx + ew * 1.1), Y(ey + 0.0004)); ctx.stroke();
    ctx.strokeStyle = 'rgba(110,70,60,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(X(cx - ew * 0.9), Y(ey - eh * 0.9)); ctx.quadraticCurveTo(X(cx), Y(ey - eh * 1.9), X(cx + ew * 0.95), Y(ey - eh * 0.8)); ctx.stroke();
    // lid crease
    ctx.strokeStyle = 'rgba(120,80,70,0.35)'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(X(cx - ew), Y(ey + eh * 1.6)); ctx.quadraticCurveTo(X(cx), Y(ey + eh * 3.0), X(cx + ew), Y(ey + eh * 1.7)); ctx.stroke();
  }
}

function fabricCell(ctx, ox, oy, kind, R) {
  const C = 512;
  ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, C, C); ctx.clip();
  const base = kind === 'leather' ? 222 : 228;
  ctx.fillStyle = `rgb(${base},${base},${base})`; ctx.fillRect(ox, oy, C, C);
  const wrap = (fn) => { for (const dx of [-C, 0, C]) for (const dy of [-C, 0, C]) fn(ox + dx, oy + dy); };
  if (kind === 'knit') {
    // rib knit: vertical ribs (8 px) of small chevron stitches + heather speckle
    for (let x = 0; x < C; x += 8) for (let y = 0; y < C; y += 6) {
      const v = 200 + R() * 40 | 0;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.beginPath(); ctx.moveTo(ox + x, oy + y); ctx.lineTo(ox + x + 4, oy + y + 5); ctx.lineTo(ox + x + 8, oy + y); ctx.lineTo(ox + x + 8, oy + y + 2); ctx.lineTo(ox + x + 4, oy + y + 7); ctx.lineTo(ox + x, oy + y + 2); ctx.fill();
    }
    for (let x = 0; x < C; x += 8) { ctx.fillStyle = 'rgba(120,120,120,0.35)'; ctx.fillRect(ox + x, oy, 1.2, C); }
  } else if (kind === 'twill') {
    for (let k = -C; k < 2 * C; k += 5) { ctx.strokeStyle = `rgba(${150 + R() * 40 | 0},${150 + R() * 40 | 0},${150 + R() * 40 | 0},0.5)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ox + k, oy); ctx.lineTo(ox + k + C, oy + C); ctx.stroke(); }
    for (let i = 0; i < 260; i++) { const x = R() * C, y = R() * C, l = 10 + R() * 40; ctx.fillStyle = `rgba(255,255,255,${0.08 + R() * 0.12})`; wrap((a, b) => ctx.fillRect(a + x, b + y, 2, l)); }
  } else if (kind === 'shell') {
    // technical shell: fine ripstop grid + soft sheen mottling
    for (let i = 0; i < 40; i++) { const x = R() * C, y = R() * C, r = 30 + R() * 80; const g = ctx.createRadialGradient(ox + x, oy + y, 0, ox + x, oy + y, r); g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; wrap((a, b) => ctx.fillRect(a + x - r, b + y - r, 2 * r, 2 * r)); }
    ctx.fillStyle = 'rgba(150,150,150,0.45)';
    for (let x = 0; x < C; x += 16) ctx.fillRect(ox + x, oy, 1.5, C);
    for (let y = 0; y < C; y += 16) ctx.fillRect(ox, oy + y, C, 1.5);
  } else if (kind === 'wool') {
    for (let i = 0; i < 9000; i++) { const x = R() * C, y = R() * C, v = 170 + R() * 80 | 0; ctx.fillStyle = `rgba(${v},${v},${v},0.55)`; ctx.fillRect(ox + x, oy + y, 1 + R() * 3, 1 + R() * 2); }
    for (let i = 0; i < 30; i++) { const x = R() * C, y = R() * C, r = 40 + R() * 90; const g = ctx.createRadialGradient(ox + x, oy + y, 0, ox + x, oy + y, r); g.addColorStop(0, 'rgba(120,120,120,0.12)'); g.addColorStop(1, 'rgba(120,120,120,0)'); ctx.fillStyle = g; wrap((a, b) => ctx.fillRect(a + x - r, b + y - r, 2 * r, 2 * r)); }
  } else if (kind === 'leather') {
    for (let i = 0; i < 5000; i++) { const x = R() * C, y = R() * C, v = 150 + R() * 100 | 0; ctx.fillStyle = `rgba(${v},${v},${v},0.35)`; ctx.beginPath(); ctx.arc(ox + x, oy + y, 1 + R() * 2.5, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 26; i++) { const x = R() * C, y = R() * C; ctx.strokeStyle = 'rgba(120,120,120,0.25)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(ox + x, oy + y); ctx.quadraticCurveTo(ox + x + 30 * R(), oy + y + 20, ox + x + 60 * R(), oy + y + 5); ctx.stroke(); }
  } else if (kind === 'hair' || kind === 'curly') {
    ctx.fillStyle = 'rgb(150,150,150)'; ctx.fillRect(ox, oy, C, C);
    const n = kind === 'hair' ? 2600 : 1800;
    for (let i = 0; i < n; i++) {
      const x = R() * C, y = R() * C, l = kind === 'hair' ? 40 + R() * 160 : 18 + R() * 30, v = 90 + R() * 165 | 0;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.35 + R() * 0.4})`; ctx.lineWidth = 1 + R() * 1.6;
      wrap((a, b) => { ctx.beginPath(); ctx.moveTo(a + x, b + y); if (kind === 'hair') ctx.quadraticCurveTo(a + x + (R() - 0.5) * 10, b + y + l / 2, a + x + (R() - 0.5) * 14, b + y + l); else ctx.arc(a + x, b + y, l / 3, R() * 6, R() * 6 + 4); ctx.stroke(); });
    }
  }
  ctx.restore();
}

let _atlas = null;
/**
 * {faces, fabric}: faces = 2048×1024 DataTexture (4×2 cells of 512: face cells 0–5, rgb multiplier on the
 * skin tone, alpha 255 multiply / ~128 absolute colour), fabric = DataArrayTexture 512²×7 with repeat
 * wrapping (0 knit, 1 twill, 2 technical shell, 3 wool, 4 leather, 5 straight hair, 6 curly hair).
 */
export function makeHumanAtlas() {
  if (_atlas) return _atlas;
  const NW = 2048, NH = 1024, C = 512;
  const cv = mkCanvas(NW, NH), ctx = cv.getContext('2d', { willReadFrequently: true });
  const ev = mkCanvas(NW, NH), ectx = ev.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, NW, NH);
  ectx.clearRect(0, 0, NW, NH);
  const R = prng(55331);
  const cell = (i) => [(i % 4) * C, (i >> 2) * C];
  for (let f = 0; f < 6; f++) { const [ox, oy] = cell(f); ctx.save(); ctx.beginPath(); ctx.rect(ox, oy, C, C); ctx.clip(); ectx.save(); ectx.beginPath(); ectx.rect(ox, oy, C, C); ectx.clip(); drawFace(ctx, ectx, ox, oy, f, R); ctx.restore(); ectx.restore(); }
  const A = ctx.getImageData(0, 0, NW, NH).data, E = ectx.getImageData(0, 0, NW, NH).data;
  const out = new Uint8Array(NW * NH * 4);
  for (let i = 0; i < out.length; i += 4) {
    const ea = E[i + 3] / 255;
    out[i] = A[i] * (1 - ea) + E[i] * ea; out[i + 1] = A[i + 1] * (1 - ea) + E[i + 1] * ea; out[i + 2] = A[i + 2] * (1 - ea) + E[i + 2] * ea;
    out[i + 3] = 255 - Math.round(127 * ea);
  }
  const faces = new THREE.DataTexture(out, NW, NH, THREE.RGBAFormat);
  faces.colorSpace = THREE.SRGBColorSpace; faces.generateMipmaps = true; faces.minFilter = THREE.LinearMipmapLinearFilter; faces.magFilter = THREE.LinearFilter;
  faces.wrapS = faces.wrapT = THREE.ClampToEdgeWrapping; faces.anisotropy = 16; faces.needsUpdate = true;
  // fabric layers (tileable)
  const kinds = ['knit', 'twill', 'shell', 'wool', 'leather', 'hair', 'curly'];
  const L = kinds.length, data = new Uint8Array(C * C * 4 * L);
  const fc = mkCanvas(C, C), fctx = fc.getContext('2d', { willReadFrequently: true });
  kinds.forEach((k, li) => { fabricCell(fctx, 0, 0, k, R); data.set(fctx.getImageData(0, 0, C, C).data, li * C * C * 4); });
  const fabric = new THREE.DataArrayTexture(data, C, C, L);
  fabric.format = THREE.RGBAFormat; fabric.colorSpace = THREE.SRGBColorSpace;
  fabric.wrapS = fabric.wrapT = THREE.RepeatWrapping; fabric.generateMipmaps = true;
  fabric.minFilter = THREE.LinearMipmapLinearFilter; fabric.magFilter = THREE.LinearFilter; fabric.anisotropy = 16; fabric.needsUpdate = true;
  _atlas = { faces, fabric };
  return _atlas;
}

// ---------------------------------------------------------------------------------------------
// geometry builder with skinning attributes
// ---------------------------------------------------------------------------------------------
class HGeo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.s = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  v(p, n, u, v, ao, b0, b1, w, slot) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.uv.push(u, v); this.c.push(ao, ao, ao); this.s.push(b0, b1, w, slot);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  /** scale to the type's stature: x by kx, y by ky, z by kz (normals by the inverse) */
  scale(kx, ky, kz) {
    for (let i = 0; i < this.p.length; i += 3) {
      this.p[i] *= kx; this.p[i + 1] *= ky; this.p[i + 2] *= kz;
      let nx = this.n[i] / kx, ny = this.n[i + 1] / ky, nz = this.n[i + 2] / kz; const l = Math.hypot(nx, ny, nz) || 1;
      this.n[i] = nx / l; this.n[i + 1] = ny / l; this.n[i + 2] = nz / l;
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aSkin', new THREE.Float32BufferAttribute(this.s, 4));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));

/**
 * Grid surface: rings[i] = {pts:[[x,y,z]...] (closed loop), slot, skin(p) -> [b0, b1, w0], ao(p, j)}.
 * Normals by central differences (outward = away from the ring centroid, along the axis at collapsed
 * rings); uv = arc length around / along (metres).
 */
function gridSurface(H, rings) {
  const ni = rings.length, nj = rings[0].pts.length;
  const cen = rings.map((r) => { let x = 0, y = 0, z = 0; for (const q of r.pts) { x += q[0]; y += q[1]; z += q[2]; } return [x / nj, y / nj, z / nj]; });
  const vl = [0]; for (let i = 1; i < ni; i++) vl.push(vl[i - 1] + len(sub(cen[i], cen[i - 1])));
  const ids = [];
  for (let i = 0; i < ni; i++) {
    const R = rings[i], P = R.pts, row = [];
    let ua = 0;
    for (let j = 0; j <= nj; j++) {
      const jj = j % nj, q = P[jj];
      if (j > 0) ua += len(sub(q, P[j - 1]));
      const a = P[(jj + 1) % nj], b = P[(jj - 1 + nj) % nj];
      const ip = Math.min(ni - 1, i + 1), im = Math.max(0, i - 1);
      // neighbouring rings, skipping duplicates (slot boundaries) for a usable along-axis difference
      let c = rings[ip].pts[jj], d = rings[im].pts[jj];
      if (len(sub(c, d)) < 1e-7) { c = rings[Math.min(ni - 1, i + 2)].pts[jj]; d = rings[Math.max(0, i - 2)].pts[jj]; }
      const du = sub(a, b), dv = sub(c, d);
      let n = cross(du, dv);
      const o = sub(q, cen[i]);
      const axis = nrm(sub(cen[Math.min(ni - 1, i + 1)], cen[Math.max(0, i - 1)]));
      if (len(du) < 1e-7 || len(n) < 1e-12) n = i === 0 ? mul(axis, -1) : i === ni - 1 ? axis : o;
      else if (len(o) > 1e-7 && dot(n, o) < 0) n = mul(n, -1);
      else if (len(o) <= 1e-7) n = i === 0 ? mul(axis, -1) : axis;
      n = nrm(n);
      const sk = R.skin(q);
      const ao = R.ao ? R.ao(q, jj) : 1;
      row.push(H.v(q, n, ua, vl[i], ao, sk[0], sk[1], sk[2], R.slot));
    }
    ids.push(row);
  }
  const P3 = (k) => [H.p[k * 3], H.p[k * 3 + 1], H.p[k * 3 + 2]], N3 = (k) => [H.n[k * 3], H.n[k * 3 + 1], H.n[k * 3 + 2]];
  for (let i = 0; i + 1 < ni; i++) for (let j = 0; j < nj; j++) {
    const a = ids[i][j], b = ids[i + 1][j], c = ids[i + 1][j + 1], d = ids[i][j + 1];
    const fnm = cross(sub(P3(b), P3(a)), sub(P3(d), P3(a)));
    const vn = add(add(N3(a), N3(b)), add(N3(c), N3(d)));
    if (dot(fnm, vn) >= 0) { H.tri(a, b, c); H.tri(a, c, d); } else { H.tri(a, c, b); H.tri(a, d, c); }
  }
}

/** ring around a vertical axis: superellipse half-width hw, front depth df (+z), back depth db */
function ellRing(cx, y, cz, hw, df, db, M, e = 2.6, mod = null) {
  const pts = [];
  for (let j = 0; j < M; j++) {
    const t = (j / M) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    let x = hw * spow(c, 2 / e), z = (s >= 0 ? df : db) * spow(s, 2 / e);
    if (mod) { const k = mod(t, y); x *= k; z *= k; }
    pts.push([cx + x, y, cz + z]);
  }
  return pts;
}
/** ring perpendicular to direction T at centre c: lateral radius rx (along L), front radius rz */
function tubeRing(c, T, front, rx, rz, M, mod = null, t0 = 0) {
  T = nrm(T);
  let B = sub(front, mul(T, dot(front, T))); if (len(B) < 1e-6) B = [0, 1, 0]; B = nrm(B);
  const L = cross(B, T);
  const pts = [];
  for (let j = 0; j < M; j++) {
    const t = t0 + (j / M) * Math.PI * 2, cs = Math.cos(t), sn = Math.sin(t);
    const k = mod ? mod(t) : 1;
    pts.push(add(c, add(mul(L, cs * rx * k), mul(B, sn * rz * k))));
  }
  return pts;
}
const fixedSkin = (b) => () => [b, b, 1];

// ---------------------------------------------------------------------------------------------
// the body
// ---------------------------------------------------------------------------------------------
/** reference joints (1.75 m frame) for a sex / child */
function refJoints(T) {
  const f = T.sex === 'f';
  const J = [];
  const hipX = f ? 0.094 : 0.089, shX = f ? 0.168 : 0.187;
  J[HB.PELVIS] = [0, 0.975, 0];
  J[HB.SPINE] = [0, 1.085, -0.012];
  J[HB.HEAD] = [0, 1.505, -0.012];
  J[HB.LTHIGH] = [hipX, 0.93, 0]; J[HB.RTHIGH] = [-hipX, 0.93, 0];
  J[HB.LSHIN] = [hipX + 0.004, 0.505, 0.012]; J[HB.RSHIN] = [-hipX - 0.004, 0.505, 0.012];
  J[HB.LFOOT] = [hipX + 0.01, 0.085, -0.02]; J[HB.RFOOT] = [-hipX - 0.01, 0.085, -0.02];
  J[HB.LUARM] = [shX, 1.418, -0.02]; J[HB.RUARM] = [-shX, 1.418, -0.02];
  J[HB.LFARM] = [shX + 0.026, 1.135, -0.035]; J[HB.RFARM] = [-shX - 0.026, 1.135, -0.035];
  J[HB.LHAND] = [shX + 0.035, 0.875, -0.012]; J[HB.RHAND] = [-shX - 0.035, 0.875, -0.012];
  return J;
}

/** torso section at height y (reference frame) */
function torsoSection(T, y) {
  const f = T.sex === 'f', b = T.build, belly = T.belly || 0;
  // [y, hw, df, db]
  const M = f ? [
    [0.845, 0.085, 0.07, 0.08], [0.89, 0.165, 0.098, 0.12], [0.94, 0.183, 0.102, 0.128], [0.99, 0.172, 0.096, 0.112],
    [1.05, 0.142, 0.09, 0.094], [1.10, 0.134, 0.09, 0.09], [1.16, 0.142, 0.1, 0.094], [1.22, 0.152, 0.128, 0.098],
    [1.27, 0.156, 0.138, 0.102], [1.32, 0.157, 0.118, 0.105], [1.37, 0.154, 0.098, 0.102], [1.405, 0.15, 0.082, 0.09],
    [1.435, 0.135, 0.068, 0.076], [1.465, 0.1, 0.058, 0.064], [1.487, 0.066, 0.05, 0.054], [1.5, 0.05, 0.046, 0.05],
  ] : [
    [0.845, 0.085, 0.07, 0.08], [0.89, 0.158, 0.095, 0.112], [0.94, 0.172, 0.1, 0.12], [0.99, 0.166, 0.098, 0.106],
    [1.05, 0.153, 0.098, 0.096], [1.11, 0.153, 0.102, 0.095], [1.17, 0.162, 0.11, 0.098], [1.23, 0.172, 0.118, 0.103],
    [1.29, 0.176, 0.122, 0.108], [1.34, 0.176, 0.116, 0.112], [1.385, 0.172, 0.1, 0.106], [1.415, 0.168, 0.086, 0.096],
    [1.445, 0.152, 0.072, 0.082], [1.47, 0.115, 0.062, 0.07], [1.49, 0.075, 0.054, 0.058], [1.5, 0.058, 0.05, 0.054],
  ];
  let k = 0; while (k < M.length - 2 && M[k + 1][0] < y) k++;
  const A = M[k], B = M[k + 1], t = clamp((y - A[0]) / (B[0] - A[0]), 0, 1), s = t * t * (3 - 2 * t);
  let hw = A[1] + (B[1] - A[1]) * s, df = A[2] + (B[2] - A[2]) * s, db = A[3] + (B[3] - A[3]) * s;
  const wb = 1 + (b - 1) * 0.9;
  hw *= wb; df *= 1 + (b - 1) * 0.8; db *= 1 + (b - 1) * 0.6;
  if (belly) df += belly * 0.05 * gauss(y - 1.1, 0.12);
  if (T.stoop) db += 0.018 * gauss(y - 1.37, 0.07);
  return { hw, df, db, cz: 0 };
}

/**
 * buildHuman(typeIndex, lod) -> {geometry (BufferGeometry), joints: Float32Array(45) (scaled pivots), H}
 * lod 0: full (fingers, nose, ears, folds, 30+ segment sections), 1: medium, 2: far.
 */
export function buildHuman(ti, lod = 0) {
  const T = HUMAN_TYPES[ti];
  const H = new HGeo();
  const f = T.sex === 'f', child = !!T.child;
  const J = refJoints(T);
  const M = lod === 0 ? 30 : lod === 1 ? 14 : 8;          // torso segments
  const ML = lod === 0 ? 18 : lod === 1 ? 10 : 6;         // limb segments
  const b = T.build;
  const top = T.top, bottom = T.bottom;
  const coat = top === 'coat', vest = top === 'vest';
  const topSlot = coat ? S.OUTER : S.TOP;
  // ---- garment extents (reference y) ----
  const hemY = coat ? 0.94 : top === 'jacket' ? (f ? 0.965 : 0.925) : top === 'hoodie' ? 0.93 : top === 'cardigan' ? 0.93 : top === 'vest' ? 0.93 : 0.975;
  const skirt = bottom === 'skirt';
  // ---- torso ----
  {
    const ys = [];
    const y0 = 0.845, y1 = 1.5;
    const n = lod === 0 ? 34 : lod === 1 ? 16 : 9;
    for (let i = 0; i <= n; i++) ys.push(y0 + (y1 - y0) * (i / n));
    if (!ys.some((y) => Math.abs(y - hemY) < 1e-4)) { ys.push(hemY); ys.sort((a, c) => a - c); }
    const rings = [];
    // closing point at the crotch
    const pt = (y) => { const r = []; for (let j = 0; j < M; j++) r.push([0, y, -0.005]); return r; };
    const skinT = (q) => { const y = q[1]; const w = sstep(1.0, 1.16, y); return [HB.SPINE, HB.PELVIS, w]; };
    const slotAt = (y) => (y >= hemY - 1e-6 ? (vest && y > 1.405 ? S.TOP : vest ? S.ACCENT : topSlot) : (skirt ? S.BOTTOM : S.BOTTOM));
    const aoT = (q) => {
      const y = q[1], ax = Math.abs(q[0]);
      let ao = 1 - 0.18 * sstep(0.95, 0.85, y);                                      // crotch
      ao *= 1 - 0.12 * gauss(y - 1.37, 0.04) * sstep(0.1, 0.17, ax);                  // armpit
      ao *= 1 - 0.1 * gauss(y - 1.49, 0.02);                                          // neck base
      if (f) ao *= 1 - 0.1 * gauss(y - 1.19, 0.025) * (q[2] > 0.05 ? 1 : 0);         // under the bust
      return ao;
    };
    rings.push({ pts: pt(0.835), slot: S.BOTTOM, skin: fixedSkin(HB.PELVIS) });
    let prevSlot = S.BOTTOM;
    for (const y of ys) {
      const sec = torsoSection(T, y);
      let ease = 1;
      if (y >= hemY) ease = coat ? 1.06 : top === 'sweater' || top === 'cardigan' || top === 'hoodie' ? 1.035 : 1.045;
      else ease = 1.015;
      // folds: soft waist wrinkles on jackets / coats, hem band
      const fold = lod === 0 && y > hemY && y < 1.15 ? (t) => 1 + 0.006 * Math.sin(t * 7 + y * 90) * gauss(y - 1.06, 0.05) : null;
      const pts = ellRing(0, y, sec.cz, sec.hw * ease, sec.df * ease, sec.db * ease, M, 2.5, fold);
      const sl = slotAt(y);
      if (sl !== prevSlot && rings.length > 1) {
        // slot boundary: duplicate ring (zero-area strip) so no triangle mixes slots; jacket hem band
        const hemOut = Math.abs(y - hemY) < 1e-4 && (top === 'jacket' || top === 'hoodie' || top === 'vest' || coat) ? 1.012 : 1.0;
        rings.push({ pts: pts.map((q) => [q[0], q[1], q[2]]), slot: prevSlot, skin: skinT, ao: aoT });
        rings.push({ pts: pts.map((q) => [q[0] * hemOut, q[1], q[2] * hemOut]), slot: sl, skin: skinT, ao: aoT });
      } else rings.push({ pts, slot: sl, skin: skinT, ao: aoT });
      prevSlot = sl;
    }
    // neck
    const nr = (f ? 0.043 : 0.051) * (1 + (b - 1) * 0.5);
    const neckY = [1.505, 1.53, 1.56, 1.59];
    const skinN = (q) => [HB.HEAD, HB.SPINE, sstep(1.49, 1.58, q[1])];
    // collar band / scarf: the neck is covered up to 1.545 by a stand collar on jackets
    const collar = T.collar || top === 'hoodie';
    rings.push({ pts: rings[rings.length - 1].pts.map((q) => q.slice()), slot: prevSlot, skin: skinT });
    for (let i = 0; i < neckY.length; i++) {
      const y = neckY[i];
      const r = nr * (1 - 0.06 * i);
      rings.push({ pts: ellRing(0, y, -0.012 + 0.004 * i, r, r * 0.95, r * 1.02, Math.max(8, M - 8)).map((q) => q), slot: S.SKIN, skin: skinN, ao: (q) => 0.86 + 0.14 * sstep(1.5, 1.56, q[1]) });
    }
    rings.push({ pts: pt(1.62), slot: S.SKIN, skin: fixedSkin(HB.HEAD) });
    // resample all rings to the same count (neck rings use fewer segments: rebuild them at M)
    for (const r of rings) if (r.pts.length !== M) {
      const c = r.pts.reduce((a, q) => add(a, q), [0, 0, 0]).map((v) => v / r.pts.length);
      const rad = len(sub(r.pts[0], c));
      r.pts = ellRing(c[0], c[1], c[2], rad, rad * 0.95, rad * 1.02, M);
    }
    gridSurface(H, rings);
    if (collar && lod < 2) {
      // stand collar (technical jacket) / hood rim (hoodie): a short open tube around the neck base
      const cr = nr + (top === 'hoodie' ? 0.03 : 0.016);
      const cy0 = 1.465, cy1 = top === 'hoodie' ? 1.52 : 1.545;
      const Mc = Math.max(10, M - 6);
      const cl = [];
      const sl = top === 'hoodie' ? S.TOP : topSlot;
      const skinC = (q) => [HB.SPINE, HB.HEAD, 0.75];
      for (const [y, r, inset] of [[cy0, cr * 1.15, 0], [cy0 + 0.02, cr * 1.05, 0], [cy1, cr, 0], [cy1 + 0.002, cr * 0.93, 1]]) cl.push({ pts: ellRing(0, y, -0.016 + (top === 'hoodie' ? -0.02 : 0), r, r * (top === 'hoodie' ? 0.9 : 0.98), r * (top === 'hoodie' ? 1.25 : 1.04), Mc), slot: sl, skin: skinC, ao: inset ? () => 0.6 : null });
      gridSurface(H, cl);
    }
    if (T.scarf && lod < 2) {
      const sr = nr + 0.03;
      const sc = [];
      for (const [y, r] of [[1.44, sr * 0.8], [1.46, sr * 1.12], [1.5, sr * 1.18], [1.54, sr * 1.05], [1.555, sr * 0.82]]) sc.push({ pts: ellRing(0, y, -0.012, r, r * 1.05, r, Math.max(10, M - 6), 2.2, (t, yy) => 1 + 0.05 * Math.sin(t * 5 + yy * 60)), slot: S.ACCENT, skin: () => [HB.SPINE, HB.HEAD, 0.8] });
      gridSurface(H, sc);
      // hanging ends at the front
      const ends = [];
      const Mt = lod === 0 ? 8 : 6;
      const path = [[0.035, 1.47, 0.11], [0.04, 1.36, 0.14], [0.045, 1.22, 0.145]];
      for (let i = 0; i < path.length; i++) ends.push({ pts: tubeRing(path[i], i ? sub(path[i], path[i - 1]) : sub(path[1], path[0]), [0, 0, 1], 0.05, 0.012, Mt), slot: S.ACCENT, skin: fixedSkin(HB.SPINE) });
      ends.push({ pts: tubeRing(path[2], [0, -1, 0], [0, 0, 1], 0.001, 0.001, Mt), slot: S.ACCENT, skin: fixedSkin(HB.SPINE) });
      gridSurface(H, ends);
    }
  }
  // ---- coat skirt / skirt ----
  if (coat || skirt) {
    const yTop = coat ? 1.0 : 1.04, yHem = coat ? (f ? 0.45 : 0.42) : 0.6;
    const rings = [];
    const n = lod === 0 ? 14 : lod === 1 ? 7 : 4;
    const slot = coat ? S.OUTER : S.BOTTOM;
    const skinS = (q) => {
      const side = q[0] >= 0 ? HB.LTHIGH : HB.RTHIGH;
      const w = clamp(Math.abs(q[0]) / 0.16, 0, 1) * sstep(0.98, 0.6, q[1]) * 0.75;
      return [HB.PELVIS, side, 1 - w];
    };
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = yTop + (yHem - yTop) * t;
      const sec = torsoSection(T, clamp(y, 0.94, 1.2));
      const flare = 1 + (coat ? 0.12 : 0.22) * t * t + (coat ? 0.07 : 0.03);
      const fold = lod === 0 ? (tt) => 1 + 0.018 * t * Math.sin(tt * (coat ? 9 : 11) + 1.3) : null;
      rings.push({ pts: ellRing(0, y, -0.005, Math.max(sec.hw, 0.17) * flare, Math.max(sec.df, 0.1) * flare, Math.max(sec.db, 0.12) * flare, M, 2.3, fold), slot, skin: skinS, ao: (q) => 0.94 + 0.06 * t });
    }
    // hem: fold the edge inward so the skirt reads as cloth with thickness
    const last = rings[rings.length - 1].pts;
    rings.push({ pts: last.map((q) => [q[0] * 0.965, q[1] + 0.004, q[2] * 0.965]), slot, skin: skinS, ao: () => 0.5 });
    gridSurface(H, rings);
  }
  // ---- legs ----
  for (const side of [1, -1]) {
    const thigh = side > 0 ? HB.LTHIGH : HB.RTHIGH, shin = side > 0 ? HB.LSHIN : HB.RSHIN;
    const hip = J[thigh], knee = J[shin], ank = J[side > 0 ? HB.LFOOT : HB.RFOOT];
    const topP = [hip[0] * 0.98, 0.99, -0.004];
    const path = (y) => (y > hip[1] ? lerp3(hip, topP, (y - hip[1]) / (topP[1] - hip[1])) : y > knee[1] ? lerp3(knee, hip, (y - knee[1]) / (hip[1] - knee[1])) : lerp3(ank, knee, (y - ank[1]) / (knee[1] - ank[1])));
    const radius = (y) => {
      // body radius (reference male) at height y
      const P = [[0.07, 0.04], [0.12, 0.04], [0.18, 0.043], [0.28, 0.051], [0.38, 0.058], [0.45, 0.055], [0.51, 0.054], [0.58, 0.06], [0.68, 0.071], [0.79, 0.08], [0.88, 0.087], [0.99, 0.088]];
      let k = 0; while (k < P.length - 2 && P[k + 1][0] < y) k++;
      const A = P[k], B = P[k + 1], t = clamp((y - A[0]) / (B[0] - A[0]), 0, 1);
      return (A[1] + (B[1] - A[1]) * t) * (f ? (y > 0.6 ? 1.04 : 0.93) : 1) * (1 + (b - 1) * 0.85);
    };
    const longTrousers = !skirt;
    const wide = bottom === 'wide';
    const ys = [];
    const n = lod === 0 ? 30 : lod === 1 ? 12 : 6;
    for (let i = 0; i <= n; i++) ys.push(0.99 - (0.99 - 0.075) * (i / n));
    const rings = [];
    const skinL = (q) => {
      const y = q[1];
      if (y > knee[1] + 0.05) return [thigh, HB.PELVIS, 1 - 0.55 * sstep(0.9, 0.99, y)];
      if (y < knee[1] - 0.05) return [shin, thigh, 1];
      return [shin, thigh, sstep(knee[1] + 0.05, knee[1] - 0.05, y)];
    };
    const trouserHemY = 0.075;
    let prevSlot = -1;
    for (const y of ys) {
      const c = path(y);
      const dir = sub(path(y - 0.01), path(y + 0.01));
      let r = radius(y), rzK = 1.04;
      let slot = S.SKIN;
      if (longTrousers && y >= trouserHemY) {
        slot = S.BOTTOM;
        r = r + 0.009;
        if (y < knee[1]) r = Math.max(r, wide ? 0.072 + (knee[1] - y) * 0.03 : 0.052);
        if (wide && y >= knee[1]) r = Math.max(r, 0.075);
      } else if (skirt) { slot = S.BOTTOM; r *= 0.98; }       // tights (skirt outfits): bottom colour on the legs? no: skin tone
      if (skirt) slot = S.SKIN;
      // folds (LOD0): ankle stacking, back-of-knee wrinkles
      let mod = null;
      if (lod === 0 && slot === S.BOTTOM) {
        const stack = sstep(0.24, 0.1, y), kneeW = gauss(y - knee[1], 0.045);
        if (stack > 0 || kneeW > 0.05) mod = (t) => 1 + 0.06 * stack * Math.sin(y * 210 + t * 2 + side) + 0.05 * kneeW * Math.sin(y * 260) * Math.max(0, -Math.sin(t)) ;
      }
      const pts = tubeRing(c, dir, [0, 0, 1], r, r * rzK, ML, mod);
      if (slot !== prevSlot && prevSlot >= 0) rings.push({ pts: pts.map((q) => q.slice()), slot: prevSlot, skin: skinL });
      rings.push({ pts, slot, skin: skinL, ao: (q) => 1 - 0.15 * gauss(q[1] - knee[1] + 0.03, 0.03) * (q[2] < c[2] ? 1 : 0) - 0.12 * sstep(0.92, 0.99, q[1]) });
      prevSlot = slot;
    }
    rings.push({ pts: tubeRing(path(0.07), [0, -1, 0], [0, 0, 1], 0.001, 0.001, ML), slot: prevSlot, skin: skinL });
    gridSurface(H, rings);
    // ---- shoe ----
    const foot = side > 0 ? HB.LFOOT : HB.RFOOT;
    const boot = T.id === 'worker' || T.id === 'manCoat';
    const fem = f && !child;
    const secs = [[-0.083, 0.012, 0.06], [-0.075, 0.032, 0.088], [-0.06, 0.041, boot ? 0.14 : 0.105], [-0.02, 0.045, boot ? 0.15 : 0.112], [0.03, 0.047, 0.094], [0.08, 0.049, 0.074], [0.13, 0.045, 0.056], [0.165, 0.035, 0.046], [0.185, 0.02, 0.036], [0.193, 0.006, 0.026]];
    const shoeRings = [];
    const Ms = lod === 0 ? 16 : lod === 1 ? 10 : 6;
    const fk = fem ? 0.9 : child ? 0.78 : 1;
    for (const [z, hw, ht] of secs) {
      const pts = [];
      for (let j = 0; j < Ms; j++) {
        const t = (j / Ms) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
        // profile in (x, y): flat sole, rounded upper
        const x = hw * spow(c, 0.7) * fk;
        const y = s >= 0 ? ht * spow(s, 0.8) : 0.004 * s;
        pts.push([ank[0] + x, Math.max(0, y + 0.004), ank[2] + z * fk]);
      }
      shoeRings.push({ pts, slot: S.SHOES, skin: fixedSkin(foot), ao: (q) => 0.85 + 0.15 * sstep(0.0, 0.03, q[1]) });
    }
    gridSurface(H, shoeRings);
  }
  // ---- arms ----
  for (const side of [1, -1]) {
    const ua = side > 0 ? HB.LUARM : HB.RUARM, fa = side > 0 ? HB.LFARM : HB.RFARM, hd = side > 0 ? HB.LHAND : HB.RHAND;
    const sh = J[ua], el = J[fa], wr = J[hd];
    const topP = [sh[0] - side * 0.055, 1.434, -0.02];
    const ys = [];
    const n = lod === 0 ? 26 : lod === 1 ? 11 : 6;
    for (let i = 0; i <= n; i++) ys.push(1.434 - (1.434 - 0.865) * (i / n));
    const path = (y) => (y > sh[1] ? lerp3(sh, topP, (y - sh[1]) / (topP[1] - sh[1])) : y > el[1] ? lerp3(el, sh, (y - el[1]) / (sh[1] - el[1])) : lerp3(wr, el, (y - wr[1]) / (el[1] - wr[1])));
    const radius = (y) => {
      const P = [[0.86, 0.026], [0.88, 0.028], [0.94, 0.033], [1.02, 0.039], [1.08, 0.04], [1.135, 0.037], [1.2, 0.04], [1.3, 0.043], [1.37, 0.046], [1.405, 0.046], [1.422, 0.04], [1.434, 0.024]];
      let k = 0; while (k < P.length - 2 && P[k + 1][0] < y) k++;
      const A = P[k], B = P[k + 1], t = clamp((y - A[0]) / (B[0] - A[0]), 0, 1);
      return (A[1] + (B[1] - A[1]) * t) * (f ? 0.86 : 1) * (1 + (b - 1) * 0.9);
    };
    const skinA = (q) => {
      const y = q[1];
      if (y > sh[1] - 0.01) return [ua, HB.SPINE, 1 - 0.6 * sstep(sh[1] - 0.01, 1.434, y)];
      if (y > el[1] + 0.04) return [ua, fa, 1];
      if (y > el[1] - 0.04) return [fa, ua, sstep(el[1] + 0.04, el[1] - 0.04, y)];
      if (y > wr[1] + 0.02) return [fa, hd, 1];
      return [hd, fa, sstep(wr[1] + 0.02, wr[1] - 0.005, y)];
    };
    const sleeveEnd = 0.885;
    const sleeveSlot = vest ? S.TOP : topSlot;
    const rings = [];
    let prevSlot = -1;
    for (const y of ys.concat([sleeveEnd + 0.0001]).sort((a, c) => c - a)) {
      const c = path(y), dir = sub(path(y - 0.01), path(y + 0.01));
      let r = radius(y), slot = S.SKIN;
      if (y >= sleeveEnd) { slot = sleeveSlot; r += (coat ? 0.011 : 0.007) * (1 - 0.5 * sstep(1.3, 1.42, y)); if (y < 0.92) r += 0.003; }
      let mod = null;
      if (lod === 0 && slot !== S.SKIN) {
        const w = gauss(y - el[1] - 0.01, 0.05);
        if (w > 0.05) mod = (t) => 1 + 0.07 * w * Math.sin(y * 230 + t) * Math.max(0, Math.sin(t) + 0.3);
      }
      const pts = tubeRing(c, dir, [0, 0, 1], r, r * 1.05, ML, mod);
      if (slot !== prevSlot && prevSlot >= 0) {
        rings.push({ pts: pts.map((q) => q.slice()), slot: prevSlot, skin: skinA, ao: () => 0.55 });
        // cuff opening: the skin continues slightly inside the sleeve
        const rIn = radius(y) * 0.98;
        rings.push({ pts: tubeRing(c, dir, [0, 0, 1], rIn, rIn * 1.05, ML), slot, skin: skinA, ao: () => 0.6 });
      }
      rings.push({ pts, slot, skin: skinA, ao: (q) => 1 - 0.12 * gauss(q[1] - 1.38, 0.04) * (Math.abs(q[0]) < Math.abs(sh[0]) ? 1 : 0) });
      prevSlot = slot;
    }
    rings.push({ pts: tubeRing(path(0.862), [0, -1, 0], [0, 0, 1], 0.001, 0.001, ML), slot: S.SKIN, skin: skinA });
    gridSurface(H, rings);
    // ---- hand ----
    buildHand(H, side, wr, hd, lod, f ? 0.9 : child ? 0.8 : 1);
  }
  // ---- head (sculpted, face texture), ears, nose, hair ----
  const hs = (f ? 0.955 : 1) * (child ? 1.22 : 1);
  const hc = [0, 1.627, 0.012];
  buildHead(H, T, hc, hs, lod);
  // ---- accessories ----
  if (T.bag === 'messenger' && lod < 2) buildMessenger(H, T, lod);
  if (T.bag === 'backpack') buildBackpack(H, T, lod);
  if (lod < 2) buildPhone(H, J);
  // ---- scale to stature ----
  const ky = T.H / 1.75;
  const kx = child ? 0.8 : Math.pow(ky, 0.6), kz = kx;
  H.scale(kx, ky, kz);
  const joints = new Float32Array(45);
  for (let i = 0; i < 15; i++) { joints[i * 3] = J[i][0] * kx; joints[i * 3 + 1] = J[i][1] * ky; joints[i * 3 + 2] = J[i][2] * kz; }
  return { geometry: H.build(), joints, H: T.H };
}

/** hand hanging down from the wrist: palm facing the thigh (−x side for the left hand), thumb forward */
function buildHand(H, side, wr, bone, lod, k) {
  const sk = fixedSkin(bone);
  const inward = -side;                       // palm normal (towards the body)
  const Mh = lod === 0 ? 12 : lod === 1 ? 8 : 6;
  // palm: loft along −y, cross-section ellipse (thickness along x, width along z)
  const palm = [];
  const P = [[0.0, 0.016, 0.026], [-0.02, 0.016, 0.036], [-0.05, 0.015, 0.041], [-0.085, 0.013, 0.04], [-0.095, 0.01, 0.034]];
  const lodPalm = lod === 2 ? [[0.0, 0.016, 0.026], [-0.06, 0.016, 0.04], [-0.17, 0.011, 0.03], [-0.18, 0.002, 0.004]] : P;
  for (const [dy, tx, wz] of lodPalm) {
    const c = [wr[0] + inward * -0.002, wr[1] + dy * k, wr[2] + 0.004];
    palm.push({ pts: tubeRing(c, [0, -1, 0], [0, 0, 1], tx * k, wz * k, Mh), slot: S.SKIN, skin: sk, ao: (q) => 0.92 + 0.08 * (q[1] - wr[1] + 0.1) / 0.1 });
  }
  if (lod === 2) { gridSurface(H, palm); return; }
  palm.push({ pts: tubeRing([wr[0], wr[1] - 0.098 * k, wr[2] + 0.004], [0, -1, 0], [0, 0, 1], 0.001, 0.001, Mh), slot: S.SKIN, skin: sk });
  gridSurface(H, palm);
  if (lod === 1) {
    // mitten: the four fingers as one slightly curled block
    const m = [];
    const pts = [[0, -0.085, 0.004], [0.004, -0.13, 0.006], [0.012, -0.165, 0.004], [0.02, -0.18, 0.002]];
    const rad = [[0.011, 0.036], [0.01, 0.034], [0.009, 0.028], [0.001, 0.004]];
    for (let i = 0; i < pts.length; i++) m.push({ pts: tubeRing([wr[0] + inward * pts[i][0] * k, wr[1] + pts[i][1] * k, wr[2] + pts[i][2] * k], [0, -1, 0], [0, 0, 1], rad[i][0] * k, rad[i][1] * k, Mh), slot: S.SKIN, skin: sk });
    gridSurface(H, m);
  } else {
    // four fingers (index at the front, +z) with knuckle curl towards the palm side
    const F = [[0.026, 0.074, 0.0088], [0.009, 0.082, 0.0092], [-0.009, 0.077, 0.0088], [-0.026, 0.062, 0.0078]];
    for (const [z, L, r] of F) {
      const rings = [];
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const curl = 0.55 * t * t;                                      // radians of bend towards the palm
        const y = wr[1] - (0.088 + L * Math.sin(Math.PI / 2 - curl * 0.5) * t) * k;
        const x = wr[0] + inward * (0.004 + L * t * Math.sin(curl) * 0.9) * k;
        const rr = r * (1 - 0.25 * t) * k * (i === n ? 0.15 : 1);
        rings.push({ pts: tubeRing([x, y, wr[2] + (z + 0.004) * k], [inward * Math.sin(curl), -1, 0], [0, 0, 1], rr, rr, 7), slot: S.SKIN, skin: sk, ao: () => 0.95 - 0.1 * t });
      }
      gridSurface(H, rings);
    }
    // thumb: from the palm's front edge, down and forward, slightly towards the palm side
    const th = [];
    const pth = [[0.0, -0.025, 0.03], [0.006, -0.048, 0.044], [0.012, -0.07, 0.05], [0.016, -0.09, 0.05], [0.017, -0.098, 0.049]];
    const rth = [0.013, 0.0115, 0.0098, 0.008, 0.001];
    for (let i = 0; i < pth.length; i++) {
      const d = i ? sub(pth[i], pth[i - 1]) : sub(pth[1], pth[0]);
      th.push({ pts: tubeRing([wr[0] + inward * pth[i][0] * k, wr[1] + pth[i][1] * k, wr[2] + pth[i][2] * k], [inward * d[0], d[1], d[2]], [1, 0, 0], rth[i] * k, rth[i] * k, 7), slot: S.SKIN, skin: sk });
    }
    gridSurface(H, th);
  }
}

/** head surface point for the unit direction (ux, uy, uz) in head-local metres (before the size factor) */
function headPoint(ux, uy, uz, f) {
  let x = ux * 0.074, y = uy * 0.112, z = uz * (uz > 0 ? 0.093 : 0.101);
  // jaw / chin: narrow below the cheekbones, the back of the jaw tucks in under the skull
  const tj = clamp((-0.02 - y) / 0.092, 0, 1);
  x *= 1 - (f ? 0.42 : 0.36) * tj * tj;
  if (z < 0) z *= 1 - 0.62 * tj; else z *= 1 - 0.1 * tj * tj;
  // cheekbones
  x *= 1 + 0.035 * gauss(y + 0.012, 0.03) * (z > 0 ? 1 : 0);
  if (z > 0) {
    const ax = Math.abs(x);
    z -= 0.009 * gauss(ax - 0.031, 0.016) * gauss(y - 0.004, 0.014);       // eye sockets
    z += 0.005 * gauss(y - 0.024, 0.01) * gauss(ax - 0.02, 0.035);         // brow ridge
    z += 0.004 * gauss(y + 0.06, 0.009) * gauss(x, 0.022);                 // lips
    z += 0.004 * gauss(y + 0.1, 0.02) * gauss(x, 0.02);                    // chin
    // flatten the face front a little (faces are flatter than ellipsoids)
    z -= 0.006 * sstep(0.045, 0.07, ax) * sstep(-0.05, 0.03, y);
  }
  // fuller back of the skull above the neck
  if (z < 0) z -= 0.006 * gauss(y - 0.03, 0.05);
  return [x, y, z];
}

function buildHead(H, T, hc, hs, lod) {
  const f = T.sex === 'f';
  const nt = lod === 0 ? 44 : lod === 1 ? 18 : 9;         // around
  const np = lod === 0 ? 32 : lod === 1 ? 12 : 7;         // pole to pole
  const sk = fixedSkin(HB.HEAD);
  const P = (ux, uy, uz) => { const q = headPoint(ux, uy, uz, f); return [hc[0] + q[0] * hs, hc[1] + q[1] * hs, hc[2] + q[2] * hs]; };
  const ids = [];
  for (let i = 0; i <= np; i++) {
    const ph = (i / np) * Math.PI, sy = Math.cos(ph), sr = Math.sin(ph);
    const row = [];
    for (let j = 0; j <= nt; j++) {
      const th = (j / nt) * Math.PI * 2;
      const ux = Math.sin(th) * sr, uz = Math.cos(th) * sr;
      const p = P(ux, sy, uz);
      // normal by finite differences on the parametric surface
      const e = 0.002;
      const ph2 = Math.min(Math.PI - 1e-4, Math.max(1e-4, ph));
      const pa = P(Math.sin(th + e) * Math.sin(ph2), Math.cos(ph2), Math.cos(th + e) * Math.sin(ph2)), pb = P(Math.sin(th - e) * Math.sin(ph2), Math.cos(ph2), Math.cos(th - e) * Math.sin(ph2));
      const pc = P(Math.sin(th) * Math.sin(ph2 + e), Math.cos(ph2 + e), Math.cos(th) * Math.sin(ph2 + e)), pd = P(Math.sin(th) * Math.sin(ph2 - e), Math.cos(ph2 - e), Math.cos(th) * Math.sin(ph2 - e));
      let n = cross(sub(pc, pd), sub(pa, pb));
      const o = sub(p, hc); if (dot(n, o) < 0) n = mul(n, -1);
      if (i === 0) n = [0, 1, 0]; else if (i === np) n = nrm([0, -1, 0.3]);
      n = nrm(n);
      // face projection UV (front half), plain skin at the back
      const lx = (p[0] - hc[0]) / hs, ly = (p[1] - hc[1]) / hs, lz = (p[2] - hc[2]) / hs;
      let u = 0.5 + lx / (2 * FACE_HW), v = 0.5 + ly / (2 * FACE_HH);
      if (lz < 0.01) u = lx >= 0 ? 1 : 0;
      u = clamp(u, 0, 1); v = clamp(v, 0, 1);
      const ao = 1 - 0.18 * sstep(-0.06, -0.11, ly) * (lz < 0.03 ? 1 : 0.3);
      row.push(H.v(p, n, u, v, ao, sk()[0], sk()[1], 1, S.FACE));
    }
    ids.push(row);
  }
  for (let i = 0; i < np; i++) for (let j = 0; j < nt; j++) { const a = ids[i][j], b = ids[i + 1][j], c = ids[i + 1][j + 1], d = ids[i][j + 1]; H.tri(a, b, c); H.tri(a, c, d); }
  if (lod === 0) {
    // nose: lofted wedge from the bridge to the tip, base embedded in the face
    const nose = [];
    const pathN = [[0.014, 0.084, 0.006, 0.006], [0.0, 0.094, 0.0075, 0.009], [-0.016, 0.102, 0.009, 0.011], [-0.03, 0.109, 0.012, 0.012], [-0.037, 0.108, 0.0145, 0.01], [-0.043, 0.099, 0.0135, 0.006], [-0.046, 0.088, 0.006, 0.002]];
    for (const [y, z, w, d] of pathN) {
      const pts = [];
      const Mn = 10;
      for (let j = 0; j < Mn; j++) {
        const t = (j / Mn) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
        // triangular-ish section: ridge at +z, wide base at the back (inside the face)
        const zz = s > 0 ? d * Math.pow(s, 1.4) : 0.012 * s;
        pts.push([hc[0] + w * c * (s > 0 ? 1 - 0.35 * s : 1) * hs, hc[1] + y * hs, hc[2] + (z - 0.012 + zz) * hs]);
      }
      nose.push({ pts, slot: S.FACE, skin: sk, ao: (q) => 1 });
    }
    gridSurface(H, nose);
    // nose UVs: plain skin (the face texture would smear along the ridge)
    // ears
    for (const s of [1, -1]) {
      const ear = [];
      const Me = 10;
      const ex = s * 0.073 * hs + hc[0], ey = hc[1] - 0.004 * hs, ez = hc[2] - 0.008 * hs;
      for (const [dx, sc] of [[-0.004, 0.6], [0.0, 1.0], [0.007, 0.92], [0.011, 0.55], [0.012, 0.05]]) {
        const pts = [];
        for (let j = 0; j < Me; j++) {
          const t = (j / Me) * Math.PI * 2;
          pts.push([ex + s * dx * hs, ey + Math.sin(t) * 0.03 * sc * hs, ez + Math.cos(t) * 0.017 * sc * hs - 0.004 * Math.sin(t) * hs]);
        }
        ear.push({ pts, slot: S.SKIN, skin: sk, ao: () => (dx > 0.008 ? 0.8 : 1) });
      }
      gridSurface(H, ear);
    }
  }
  buildHair(H, T, hc, hs, lod, P);
}

function buildHair(H, T, hc, hs, lod, P) {
  const style = T.hair;
  const nt = lod === 0 ? 56 : lod === 1 ? 18 : 9, np = lod === 0 ? 44 : lod === 1 ? 10 : 6;
  const sk = fixedSkin(HB.HEAD);
  const longSides = style === 'bob' || style === 'long';
  const thick = style === 'crop' || style === 'grey' ? 0.0045 : style === 'short' ? 0.008 : style === 'side' ? 0.011 : style === 'bob' || style === 'long' ? 0.014 : 0.009;
  // hairline height (head-local y) by azimuth th (0 = front)
  const hairline = (th) => {
    const c = Math.cos(th);           // 1 front, -1 back
    const front = style === 'bob' ? 0.05 : 0.068, temple = 0.042, ear = 0.018, back = longSides ? -0.1 : -0.068;
    if (longSides) { const sideY = -0.085; return c > 0 ? front * c * c + sideY * (1 - c * c) : sideY * (1 + c) + back * -c; }
    if (c > 0.5) return temple + (front - temple) * (c - 0.5) / 0.5;
    if (c > 0) return ear + (temple - ear) * c / 0.5;
    return ear + (back - ear) * -c;
  };
  const phMax = longSides ? 2.55 : 2.35;
  const ids = [];
  for (let i = 0; i <= np; i++) {
    const ph = (i / np) * phMax, sy = Math.cos(ph), sr = Math.sin(ph);
    const row = [];
    for (let j = 0; j <= nt; j++) {
      const th = (j / nt) * Math.PI * 2;
      const ux = Math.sin(th) * sr, uz = Math.cos(th) * sr;
      const q = headPoint(ux, sy, uz, T.sex === 'f');
      const hl = hairline(th);
      // offset: full thickness above the hairline, sinks inside the head below it (hidden)
      const above = sstep(hl - 0.006, hl + 0.006, q[1]);
      let off = thick * above - 0.006 * (1 - above);
      if (style === 'side') off += 0.004 * sstep(0.02, 0.07, q[1]) * (ux > 0 ? 1 : 0.4);
      if (longSides) off += 0.014 * sstep(0.0, -0.08, q[1]) * above;     // flare towards the ends
      if (style === 'bun' || style === 'pony') off = Math.max(off, 0.006 * above - 0.006 * (1 - above));
      const nl = Math.hypot(q[0] / 0.074, q[1] / 0.112, q[2] / 0.097) || 1;
      const nx = q[0] / 0.074 / nl, ny = q[1] / 0.112 / nl, nz = q[2] / 0.097 / nl;
      const p = [hc[0] + (q[0] + nx * off) * hs, hc[1] + (q[1] + ny * off) * hs, hc[2] + (q[2] + nz * off) * hs];
      const ao = 0.8 + 0.2 * sstep(-0.05, 0.08, q[1]);
      row.push(H.v(p, nrm([nx, ny, nz]), (j / nt) * 1.6, (ph / Math.PI) * 1.2, ao, sk()[0], sk()[1], 1, S.HAIR));
    }
    ids.push(row);
  }
  for (let i = 0; i < np; i++) for (let j = 0; j < nt; j++) { const a = ids[i][j], b = ids[i + 1][j], c = ids[i + 1][j + 1], d = ids[i][j + 1]; H.tri(a, b, c); H.tri(a, c, d); }
  if (style === 'long' && lod < 2) {
    // hair falling down the back: a thin lofted sheet behind the neck to the shoulder blades
    const rings = [];
    const Mh = lod === 0 ? 14 : 8;
    for (const [y, z, w, d] of [[-0.05, -0.085, 0.07, 0.03], [-0.1, -0.09, 0.075, 0.03], [-0.16, -0.1, 0.085, 0.022], [-0.24, -0.11, 0.09, 0.018], [-0.3, -0.112, 0.085, 0.012], [-0.31, -0.112, 0.06, 0.004]]) {
      rings.push({ pts: ellRing(hc[0], hc[1] + y * hs, hc[2] + z * hs, w * hs, d * hs, d * hs, Mh, 2.2), slot: S.HAIR, skin: (q) => [HB.HEAD, HB.SPINE, sstep(1.43, 1.58, q[1])], ao: () => 0.85 });
    }
    gridSurface(H, rings);
  }
  if (style === 'bun' && lod < 2) {
    const rings = [];
    const Mb = lod === 0 ? 14 : 8;
    const c = [hc[0], hc[1] + 0.06 * hs, hc[2] - 0.1 * hs];
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI; const r = Math.sin(a) * 0.036 * hs + 0.0005; rings.push({ pts: tubeRing(add(c, [0, 0, -Math.cos(a) * 0.03 * hs]), [0, 0.3, -1], [0, 1, 0], r, r * 0.95, Mb), slot: S.HAIR, skin: sk, ao: () => 0.9 }); }
    gridSurface(H, rings);
  }
  if (style === 'pony' && lod < 2) {
    const rings = [];
    const Mb = lod === 0 ? 10 : 6;
    const path = [[0, 0.04, -0.1], [0, 0.0, -0.13], [0, -0.06, -0.14], [0, -0.13, -0.13], [0, -0.17, -0.12]];
    const rr = [0.016, 0.022, 0.02, 0.012, 0.001];
    for (let i = 0; i < path.length; i++) {
      const d = i ? sub(path[i], path[i - 1]) : sub(path[1], path[0]);
      rings.push({ pts: tubeRing(add(hc, mul(path[i], hs)), d, [0, 0, -1], rr[i] * hs, rr[i] * hs, Mb), slot: S.HAIR, skin: (q) => [HB.HEAD, HB.SPINE, 0.85], ao: () => 0.85 });
    }
    gridSurface(H, rings);
  }
}

function buildMessenger(H, T, lod) {
  // bag on the left hip (behind the arm swing) + strap across the chest from the right shoulder
  const f = T.sex === 'f';
  const sk = fixedSkin(HB.PELVIS);
  // side-back of the left hip (clear of the hanging hand; the swinging arm brushes it like a real bag)
  const c = [0.188, 0.975, -0.165], w = 0.036, h = 0.12, d = 0.115;
  const rings = [];
  const Mb = 12;
  for (const [y, k] of [[-h, 0.0], [-h + 0.004, 0.9], [-h + 0.02, 1], [h - 0.02, 1], [h - 0.004, 0.92], [h, 0.0]]) {
    const pts = [];
    for (let j = 0; j < Mb; j++) { const t = (j / Mb) * Math.PI * 2; pts.push([c[0] + w * spow(Math.cos(t), 0.4) * Math.max(0.05, k), c[1] + y, c[2] + d * spow(Math.sin(t), 0.4) * Math.max(0.05, k)]); }
    rings.push({ pts, slot: S.ACCENT, skin: sk, ao: () => 0.9 });
  }
  gridSurface(H, rings);
  // strap: hugging the torso from the right shoulder to the left hip (front and back)
  for (const zs of [1, -1]) {
    const st = [];
    const n = lod === 0 ? 10 : 5;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const y = 1.455 - (1.455 - 1.0) * t, x = -0.13 + (0.3) * t;
      const sec = torsoSection(T, y);
      const ex = Math.min(1, Math.abs(x) / (sec.hw * 1.05));
      const z = zs * (zs > 0 ? sec.df : sec.db) * 1.06 * Math.pow(Math.max(0, 1 - Math.pow(ex, 2.5)), 1 / 2.5) + zs * 0.012;
      const p = [x, y, z];
      st.push({ pts: tubeRing(p, [0.3, -0.45, 0], [0, 0, zs], 0.022, 0.004, 6), slot: S.ACCENT, skin: () => [HB.SPINE, HB.PELVIS, sstep(1.0, 1.2, y)] });
    }
    gridSurface(H, st);
  }
  void f;
}
function buildBackpack(H, T, lod) {
  const sec = torsoSection(T, 1.25);
  const c = [0, 1.22, -sec.db - 0.075];
  const rings = [];
  const Mb = lod === 0 ? 16 : 8;
  for (const [y, k] of [[-0.2, 0.0], [-0.195, 0.85], [-0.17, 1], [0.15, 1], [0.19, 0.85], [0.2, 0.0]]) {
    const pts = [];
    for (let j = 0; j < Mb; j++) { const t = (j / Mb) * Math.PI * 2; pts.push([c[0] + 0.15 * spow(Math.cos(t), 0.45) * Math.max(0.05, k), c[1] + y, c[2] + 0.075 * spow(Math.sin(t), 0.45) * Math.max(0.05, k)]); }
    rings.push({ pts, slot: S.ACCENT, skin: fixedSkin(HB.SPINE), ao: (q) => (q[2] > c[2] + 0.05 ? 0.7 : 0.95) });
  }
  gridSurface(H, rings);
  if (lod === 2) return;
  for (const s of [1, -1]) {
    const st = [];
    const path = [[s * 0.1, 1.38, -0.12], [s * 0.12, 1.47, -0.03], [s * 0.13, 1.44, 0.09], [s * 0.13, 1.3, 0.125], [s * 0.13, 1.16, 0.115]];
    for (let i = 0; i < path.length; i++) { const d = i ? sub(path[i], path[i - 1]) : sub(path[1], path[0]); st.push({ pts: tubeRing(path[i], d, [s, 0, 0], 0.024, 0.006, 6), slot: S.ACCENT, skin: fixedSkin(HB.SPINE), ao: () => 0.85 }); }
    gridSurface(H, st);
  }
}
/** phone in the right hand (slot PHONE: collapsed by the shader unless the idle pose is 'phone') */
function buildPhone(H, J) {
  const w = J[HB.RHAND];
  const c = [w[0] + 0.012, w[1] - 0.085, w[2] + 0.02];
  const pts = (y, k) => { const o = []; for (let j = 0; j < 8; j++) { const t = (j / 8) * Math.PI * 2; o.push([c[0] + 0.0045 * spow(Math.cos(t), 0.3) * k, c[1] + y, c[2] + 0.036 * spow(Math.sin(t), 0.3) * k]); } return o; };
  gridSurface(H, [[-0.075, 0.01], [-0.074, 1], [0.074, 1], [0.075, 0.01]].map(([y, k]) => ({ pts: pts(y, k), slot: S.PHONE, skin: fixedSkin(HB.RHAND), ao: () => 1 })));
}
