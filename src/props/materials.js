// Prop materials and procedural textures. OWNER: props agent.
// Every material is a MeshStandard/Physical material patched with app.lighting.patch (planet sun,
// sky, cloud shadows, CSM, night gating); prop-specific vertex work (wind sway, impostor
// billboards, walking figures, dithered LOD fades, debug tints) is added through onBeforeCompile
// BEFORE patch() and is controlled only by material.defines (part of the program cache key).
import * as THREE from 'three';

export const PROPS_UNIFORMS = {
  uPropsTime: { value: 0 },
  uPropsWind: { value: new THREE.Vector4(0.8, 0, 0.6, 0.5) },   // xyz wind dir (local ENU, y unused), w strength 0..1
  uPropsFrame: { value: 0 },
  uPropsDebug: { value: 0 },                                     // 0 none, 1 lod tint, 2 object id
};

// ---------------------------------------------------------------------------------------------
// procedural textures (deterministic: own small PRNG, never Math.random)
// ---------------------------------------------------------------------------------------------
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function canvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/** RGBA from a 2D canvas, transparent texels get the mean opaque colour (no dark mip fringes) */
function bleedTexture(ctx, w, h, srgb = true, repeat = false) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  if (n) { r /= n; g /= n; b /= n; }
  // getImageData is NOT premultiplied: partially covered texels keep their colour (pulled slightly
  // towards the mean), empty ones get the mean opaque colour so mips never fringe dark or white
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    if (a > 0) { const k = 0.15 * (1 - a / 255); d[i] = d[i] * (1 - k) + r * k; d[i + 1] = d[i + 1] * (1 - k) + g * k; d[i + 2] = d[i + 2] * (1 - k) + b * k; }
    else { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
  }
  const tex = new THREE.DataTexture(new Uint8Array(d.buffer.slice(0)), w, h, THREE.RGBAFormat);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 2x2 leaf atlas (2048², 1024 px cells): 0 broadleaf spray, 1 small-leaved spray, 2 blossom spray,
 * 3 conifer branchlet. Cell (i%2, i>>1). A card spans ~1.2–2 m in the tree models, so leaves are drawn
 * small (8–16 cm) along twigs, with per-leaf tone variation, a shaded fold half and a midrib, in
 * natural olive / sap greens (the species tint in the vertex colours shifts them).
 */
export function makeLeafAtlas() {
  const S = 2048, H = S / 2;
  const c = canvas(S, S), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, S, S);
  const R = prng(9127);
  const leaf = (x, y, len, wid, ang, hue, sat, lig) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    const blade = () => { ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(wid, len * 0.22, wid * 0.85, len * 0.7, 0, len); ctx.bezierCurveTo(-wid * 0.85, len * 0.7, -wid, len * 0.22, 0, 0); };
    blade(); ctx.fillStyle = `hsl(${hue},${sat}%,${lig}%)`; ctx.fill();
    // fold: one half a little darker
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-wid, len * 0.22, -wid * 0.85, len * 0.7, 0, len); ctx.closePath();
    ctx.fillStyle = `hsla(${hue + 4},${sat}%,${Math.max(4, lig - 7)}%,0.55)`; ctx.fill();
    ctx.strokeStyle = `hsla(${hue - 10},${sat * 0.6}%,${lig + 14}%,0.5)`; ctx.lineWidth = Math.max(1, wid * 0.07);
    ctx.beginPath(); ctx.moveTo(0, len * 0.04); ctx.lineTo(0, len * 0.9); ctx.stroke();
    ctx.restore();
  };
  const twig = (x0, y0, x1, y1, w, col) => {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2 + (R() - 0.5) * 30, (y0 + y1) / 2 + (R() - 0.5) * 30, x1, y1); ctx.stroke();
  };
  const cell = (i) => [(i % 2) * H, (i >> 1) * H];
  /** branching spray filling the cell: stem from the bottom centre, side twigs, leaves along them */
  const spray = (ox, oy, o) => {
    const cx = ox + H / 2, base = oy + H * 0.97, top = oy + H * 0.11;
    const twigs = [[cx, base, cx + (R() - 0.5) * 60, top]];
    for (let k = 0; k < o.side; k++) {
      const t = 0.18 + 0.75 * (k / Math.max(1, o.side - 1)) + (R() - 0.5) * 0.06;
      const sx = cx + (R() - 0.5) * 20, sy = base + (top - base) * t;
      const side = k % 2 ? 1 : -1;
      const ang = -Math.PI / 2 + side * (0.55 + R() * 0.5);
      const L = H * 0.86 * (0.26 + 0.2 * (1 - Math.abs(t - 0.45)) + R() * 0.08);
      const ex = Math.min(ox + H - 105, Math.max(ox + 105, sx + Math.cos(ang) * L)), ey = Math.max(oy + 105, sy + Math.sin(ang) * L);
      twigs.push([sx, sy, ex, ey]);
    }
    for (const [x0, y0, x1, y1] of twigs) twig(x0, y0, x1, y1, o.twigW, o.twigCol);
    for (const [x0, y0, x1, y1] of twigs) {
      const tl = Math.hypot(x1 - x0, y1 - y0), ta = Math.atan2(y1 - y0, x1 - x0);
      const n = Math.floor(tl / o.step);
      for (let k = 1; k <= n; k++) {
        const f = k / n, px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
        for (const sd of [-1, 1]) {
          if (R() < o.skip) continue;
          const la = ta - Math.PI / 2 + sd * (0.7 + R() * 0.7) + (R() - 0.5) * 0.3;
          const len = o.len[0] + R() * (o.len[1] - o.len[0]), wid = len * (o.wid + R() * 0.08);
          const sun = R() < 0.18 ? 9 : 0;
          leaf(px, py, len, wid, la, o.hue[0] + R() * (o.hue[1] - o.hue[0]), o.sat[0] + R() * (o.sat[1] - o.sat[0]), o.lig[0] + R() * (o.lig[1] - o.lig[0]) + sun);
        }
      }
      // tip leaves
      for (let k = 0; k < 3; k++) leaf(x1, y1, o.len[1] * (0.8 + R() * 0.3), o.len[1] * o.wid, ta - Math.PI / 2 + (k - 1) * 0.5, o.hue[0] + R() * 10, o.sat[1], o.lig[1]);
    }
  };
  /**
   * leaf cluster (fix round 2): 5–8 twigs radiating from a point below the centre, alternate leaves on
   * petioles along each twig and tip leaves, overlapping, so a card reads as a leafy branchlet seen from any
   * side (no fern-frond stem down the middle, no card outline)
   */
  const cluster = (ox, oy, o) => {
    const cx = ox + H / 2, cy = oy + H * 0.6;
    const nt = o.twigs;
    const tw = [];
    for (let k = 0; k < nt; k++) {
      const a = -Math.PI / 2 + (k / (nt - 1) - 0.5) * 2 * (1.25 + R() * 0.25) + (R() - 0.5) * 0.3;
      const L = H * (o.reach[0] + R() * (o.reach[1] - o.reach[0]));
      const x0 = cx + (R() - 0.5) * 30, y0 = cy + 20 + R() * 30;
      const x1 = Math.min(ox + H - 70, Math.max(ox + 70, x0 + Math.cos(a) * L)), y1 = Math.min(oy + H - 70, Math.max(oy + 70, y0 + Math.sin(a) * L));
      tw.push([x0, y0, x1, y1]);
    }
    // the stalk the twigs grow from
    twig(cx, oy + H * 0.97, cx + (R() - 0.5) * 20, cy + 40, o.twigW * 1.3, o.twigCol);
    for (const [x0, y0, x1, y1] of tw) twig(x0, y0, x1, y1, o.twigW, o.twigCol);
    const leaves = [];
    for (const [x0, y0, x1, y1] of tw) {
      const tl = Math.hypot(x1 - x0, y1 - y0), ta = Math.atan2(y1 - y0, x1 - x0);
      const n = Math.max(2, Math.floor(tl / o.step));
      for (let k = 1; k <= n; k++) {
        const f = k / (n + 0.6), px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
        const sd = k % 2 ? 1 : -1;
        if (R() < o.skip) continue;
        const la = ta + sd * (0.55 + R() * 0.6) - Math.PI / 2 + (R() - 0.5) * 0.35;
        const len = o.len[0] + R() * (o.len[1] - o.len[0]), wid = len * (o.wid + R() * 0.08);
        leaves.push([px, py, len, wid, la]);
      }
      for (let k = 0; k < 2; k++) leaves.push([x1, y1, o.len[1] * (0.85 + R() * 0.3), o.len[1] * o.wid, ta - Math.PI / 2 + (k - 0.5) * 0.6]);
    }
    // back-to-front: lower leaves first, sun-lit tips last
    leaves.sort((a, b) => b[1] - a[1]);
    for (const [px, py, len, wid, la] of leaves) {
      const sun = R() < 0.2 ? 8 : 0;
      leaf(px, py, len, wid, la, o.hue[0] + R() * (o.hue[1] - o.hue[0]), o.sat[0] + R() * (o.sat[1] - o.sat[0]), o.lig[0] + R() * (o.lig[1] - o.lig[0]) + sun);
    }
  };
  // every cell is clipped (nothing bleeds into the neighbour cells)
  const clipCell = (i, round) => {
    const [ox, oy] = cell(i);
    ctx.save(); ctx.beginPath();
    if (round) ctx.arc(ox + H / 2, oy + H / 2, H * 0.47, 0, Math.PI * 2); else ctx.rect(ox + 6, oy + 6, H - 12, H - 12);
    ctx.clip();
    return [ox, oy];
  };
  // 0: broadleaf cluster (street / park trees)
  { const [ox, oy] = clipCell(0, false); cluster(ox, oy, { twigs: 7, reach: [0.3, 0.44], twigW: 6, twigCol: '#5a4636', step: 40, skip: 0.1, len: [92, 150], wid: 0.44, hue: [72, 100], sat: [30, 52], lig: [32, 56] }); ctx.restore(); }
  // 1: small-leaved cluster (ornamental trees, shrubs)
  { const [ox, oy] = clipCell(1, false); cluster(ox, oy, { twigs: 8, reach: [0.3, 0.45], twigW: 4.5, twigCol: '#4e3e30', step: 26, skip: 0.08, len: [56, 92], wid: 0.46, hue: [76, 106], sat: [32, 54], lig: [34, 58] }); ctx.restore(); }
  // 2: blossom branchlet (fix round 3, QQ2-03: was a solid disc of 420 flowers that read as flat round cards / coins):
  // twigs radiating from a stalk with side spurs, umbels of 2–5 five-petal flowers (notched petals, pink base fading
  // to pale tips, dark eye + stamens) on short pedicels at the spurs and twig tips, buds and a few bronze young
  // leaves; open gaps between the twigs and a ragged outline that follows the sprays
  {
    const [ox, oy] = clipCell(2, false);
    const cx = ox + H / 2, cy = oy + H * 0.6;
    const twigCol = '#4b3b31';
    const cl = (v, a, b) => Math.min(b, Math.max(a, v));
    twig(cx, oy + H * 0.97, cx + (R() - 0.5) * 20, cy + 40, 7.5, twigCol);
    const tw = [];
    const nt = 8;
    for (let k = 0; k < nt; k++) {
      const a = -Math.PI / 2 + (k / (nt - 1) - 0.5) * 2 * (1.18 + R() * 0.22) + (R() - 0.5) * 0.28;
      const L = H * (0.27 + R() * 0.16);
      const x0 = cx + (R() - 0.5) * 30, y0 = cy + 22 + R() * 26;
      tw.push([x0, y0, cl(x0 + Math.cos(a) * L, ox + 90, ox + H - 90), cl(y0 + Math.sin(a) * L, oy + 90, oy + H - 90), a]);
    }
    const nodes = [];                                     // [x, y, size, pedicel origin x, y]
    for (const [x0, y0, x1, y1, a] of tw) {
      twig(x0, y0, x1, y1, 5, twigCol);
      const tl = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.floor(tl / 75));
      for (let k = 1; k <= n; k++) {
        const f = k / (n + 0.45), px = x0 + (x1 - x0) * f, py = y0 + (y1 - y0) * f;
        const sa = a + (k % 2 ? 1 : -1) * (0.55 + R() * 0.55), sl = 38 + R() * 58;
        const sx = cl(px + Math.cos(sa) * sl, ox + 70, ox + H - 70), sy = cl(py + Math.sin(sa) * sl, oy + 70, oy + H - 70);
        twig(px, py, sx, sy, 3, twigCol);
        nodes.push([sx, sy, 0.85 + R() * 0.3, px, py]);
        if (R() < 0.45) nodes.push([px + (R() - 0.5) * 16, py + (R() - 0.5) * 16, 0.7 + R() * 0.2, px, py]);
      }
      nodes.push([x1, y1, 1.05 + R() * 0.2, x0 + (x1 - x0) * 0.9, y0 + (y1 - y0) * 0.9]);
    }
    // young leaves (bronze green) tucked behind the umbels
    for (const [x, y] of nodes) {
      if (R() > 0.5) continue;
      leaf(x + (R() - 0.5) * 26, y + (R() - 0.5) * 26, 46 + R() * 26, (46 + R() * 26) * 0.42, R() * Math.PI * 2, 62 + R() * 30, 30 + R() * 16, 30 + R() * 12);
    }
    const petal = (x, y, ang, l, w, inner, outer, edge) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(w, -l * 0.25, w * 0.95, -l * 0.92, w * 0.2, -l);
      ctx.lineTo(0, -l * 0.9);
      ctx.lineTo(-w * 0.2, -l);
      ctx.bezierCurveTo(-w * 0.95, -l * 0.92, -w, -l * 0.25, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, -l);
      g.addColorStop(0, inner); g.addColorStop(0.55, outer); g.addColorStop(1, outer);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = edge; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    };
    const flowers = [];
    for (const [x, y, s, px, py] of nodes) {
      const nf = 2 + Math.floor(R() * 4);
      for (let i = 0; i < nf; i++) {
        const a = R() * Math.PI * 2, r = (12 + R() * 24) * s;
        const fx = x + Math.cos(a) * r, fy = y + Math.sin(a) * r * 0.85 - 4;
        // pedicel from the spur to the flower
        ctx.strokeStyle = 'rgba(92,70,58,0.9)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(fx, fy); ctx.stroke();
        flowers.push([fx, fy, (17 + R() * 9) * s, R(), R()]);
      }
      if (R() < 0.55) flowers.push([x + (R() - 0.5) * 30, y + (R() - 0.5) * 30, 0, R(), R()]);   // bud
      void px; void py;
    }
    // lower / shaded flowers first, sunlit outer flowers last
    flowers.sort((a, b) => b[1] - a[1]);
    for (const [x, y, pr, v, w2] of flowers) {
      if (pr === 0) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(v * 6.28);
        ctx.beginPath(); ctx.ellipse(0, 0, 6 + w2 * 3, 9 + w2 * 4, 0, 0, Math.PI * 2); ctx.fillStyle = `hsl(${338 + w2 * 10},${55 + v * 15}%,${58 + v * 10}%)`; ctx.fill();
        ctx.restore();
        continue;
      }
      const white = w2 < 0.14;                               // a few near-white flowers among the pink
      const shade = v < 0.3 ? -10 : v > 0.82 ? 5 : 0;         // flowers inside the umbel are a little darker
      const hue = 336 + w2 * 14;
      // saturated enough that sky-lit (blue ambient) petals stay pink instead of turning lilac
      const inner = white ? `hsl(${hue},${36}%,${80 + shade}%)` : `hsl(${hue},${72}%,${68 + shade}%)`;
      const outer = white ? `hsl(30,${18}%,${93 + shade * 0.5}%)` : `hsl(${hue + 4},${62}%,${84 + shade * 0.7}%)`;
      const edge = `hsla(${hue},40%,${62 + shade}%,0.35)`;
      const rot = v * 6.283;
      for (let q = 0; q < 5; q++) petal(x, y, rot + q * 1.2566 + (R() - 0.5) * 0.18, pr, pr * 0.58, inner, outer, edge);
      ctx.beginPath(); ctx.arc(x, y, pr * 0.2, 0, Math.PI * 2); ctx.fillStyle = `hsl(${hue - 4},50%,${42 + shade}%)`; ctx.fill();
      ctx.fillStyle = '#e9cf6a';
      for (let q = 0; q < 7; q++) { const a = q * 0.8976 + v; ctx.beginPath(); ctx.arc(x + Math.cos(a) * pr * 0.28, y + Math.sin(a) * pr * 0.28, 1.8, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }
  // 3: conifer branchlet (needles along twigs)
  {
    const [ox, oy] = clipCell(3, false);
    for (let tw = 0; tw < 11; tw++) {
      const x0 = ox + H * 0.5, y0 = oy + H - 20;
      const ang = -Math.PI / 2 + (tw - 5) * 0.17 + (R() - 0.5) * 0.08;
      const L = H * (0.55 + R() * 0.38);
      twig(x0, y0, x0 + Math.cos(ang) * L, y0 + Math.sin(ang) * L, 7, '#3d3022');
      for (let k = 0; k < 170; k++) {
        const t = 0.08 + R() * 0.92; const px = x0 + Math.cos(ang) * L * t, py = y0 + Math.sin(ang) * L * t;
        const na = ang + (R() < 0.5 ? -1 : 1) * (0.5 + R() * 0.7);
        const nl = 44 + R() * 34;
        ctx.strokeStyle = `hsl(${112 + R() * 30},${24 + R() * 18}%,${19 + R() * 15}%)`; ctx.lineWidth = 4.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(na) * nl, py + Math.sin(na) * nl); ctx.stroke();
      }
    }
    ctx.restore();
  }
  return bleedTexture(ctx, S, S, true, false);
}

/**
 * Bark (fix round 2, QQ-09): 1024×2048 colour + normal map of fissured bark plates (tile 0.42 m around ×
 * 0.84 m along, models.js barkTube arc-length UVs -> ~2400 texels/m), linear mips + max anisotropy.
 * Returns the colour texture; the normal map is attached as tex.userData.normal.
 */
export function makeBarkTexture() {
  const W = 1024, Hh = 2048;
  const c = canvas(W, Hh), ctx = c.getContext('2d', { willReadFrequently: true });
  const hc = canvas(W, Hh), hx = hc.getContext('2d', { willReadFrequently: true });           // height field (white = proud plates)
  const R = prng(4411);
  ctx.fillStyle = '#7a6a5c'; ctx.fillRect(0, 0, W, Hh);
  hx.fillStyle = '#9a9a9a'; hx.fillRect(0, 0, W, Hh);
  const wrapX = (fn) => { for (const dx of [-W, 0, W]) for (const dy of [-Hh, 0, Hh]) fn(dx, dy); };
  // plates: irregular vertical strips between fissures
  const cols = 14;
  const xs = []; for (let i = 0; i < cols; i++) xs.push((i + 0.5) / cols * W + (R() - 0.5) * W / cols * 0.5);
  for (let i = 0; i < cols; i++) {
    let y = -40;
    while (y < Hh + 40) {
      const ph = 90 + R() * 260, w = W / cols * (0.75 + R() * 0.35), x = xs[i] + (R() - 0.5) * 18;
      const tone = 100 + R() * 45, warm = R() * 14;
      wrapX((dx, dy) => {
        ctx.fillStyle = `rgb(${tone + warm | 0},${tone * 0.9 | 0},${tone * 0.78 | 0})`;
        ctx.beginPath(); ctx.ellipse(x + dx, y + ph / 2 + dy, w / 2, ph / 2, (R() - 0.5) * 0.08, 0, Math.PI * 2); ctx.fill();
        const g = hx.createRadialGradient(x + dx, y + ph / 2 + dy, 0, x + dx, y + ph / 2 + dy, Math.max(w, ph) / 2);
        g.addColorStop(0, 'rgba(235,235,235,1)'); g.addColorStop(0.75, 'rgba(190,190,190,1)'); g.addColorStop(1, 'rgba(150,150,150,0)');
        hx.save(); hx.translate(x + dx, y + ph / 2 + dy); hx.scale(w / Math.max(w, ph), ph / Math.max(w, ph)); hx.translate(-(x + dx), -(y + ph / 2 + dy));
        hx.fillStyle = g; hx.beginPath(); hx.arc(x + dx, y + ph / 2 + dy, Math.max(w, ph) / 2, 0, Math.PI * 2); hx.fill(); hx.restore();
      });
      y += ph * (0.8 + R() * 0.3);
    }
  }
  // fissures: dark wavy vertical lines between the plate columns, with forks
  for (let i = 0; i < cols; i++) {
    const x0 = (xs[i] + xs[(i + 1) % cols] + (i === cols - 1 ? W : 0)) / 2;
    for (let pass = 0; pass < 2; pass++) {
      let x = x0 + (R() - 0.5) * 20, y = 0;
      ctx.lineCap = 'round'; hx.lineCap = 'round';
      while (y < Hh) {
        const ny = y + 20 + R() * 40, nx = x + (R() - 0.5) * 16, lw = (pass ? 3 : 7) + R() * (pass ? 3 : 7);
        wrapX((dx, dy) => {
          ctx.strokeStyle = `rgba(${28 + R() * 16 | 0},${22 + R() * 12 | 0},${18 + R() * 10 | 0},0.92)`; ctx.lineWidth = lw;
          ctx.beginPath(); ctx.moveTo(x + dx, y + dy); ctx.lineTo(nx + dx, ny + dy); ctx.stroke();
          hx.strokeStyle = 'rgba(20,20,20,0.95)'; hx.lineWidth = lw * 1.3; hx.beginPath(); hx.moveTo(x + dx, y + dy); hx.lineTo(nx + dx, ny + dy); hx.stroke();
        });
        if (R() < 0.08) {           // fork / horizontal crack across a plate
          const fx = nx + (R() < 0.5 ? -1 : 1) * (20 + R() * 40), fy = ny + 10 + R() * 30;
          wrapX((dx, dy) => { ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(nx + dx, ny + dy); ctx.lineTo(fx + dx, fy + dy); ctx.stroke(); hx.lineWidth = 4; hx.beginPath(); hx.moveTo(nx + dx, ny + dy); hx.lineTo(fx + dx, fy + dy); hx.stroke(); });
        }
        x = nx; y = ny;
      }
    }
  }
  // fine grain + lichen
  for (let i = 0; i < 26000; i++) {
    const x = R() * W, y = R() * Hh, v = R();
    ctx.fillStyle = v < 0.5 ? `rgba(40,32,26,${0.12 + R() * 0.2})` : `rgba(190,175,155,${0.08 + R() * 0.14})`;
    ctx.fillRect(x, y, 1 + R() * 2.5, 2 + R() * 7);
  }
  for (let i = 0; i < 60; i++) {
    const x = R() * W, y = R() * Hh, r = 6 + R() * 22;
    ctx.fillStyle = `rgba(${120 + R() * 30 | 0},${132 + R() * 30 | 0},${96 + R() * 20 | 0},${0.25 + R() * 0.3})`;
    for (let k = 0; k < 9; k++) { ctx.beginPath(); ctx.arc(x + (R() - 0.5) * r * 1.6, y + (R() - 0.5) * r * 1.6, r * (0.3 + R() * 0.4), 0, Math.PI * 2); ctx.fill(); }
  }
  const tex = bleedTexture(ctx, W, Hh, true, true);
  tex.anisotropy = 16;
  // normal map from the height field (Sobel, wrapped)
  const hd = hx.getImageData(0, 0, W, Hh).data;
  const hg = new Float32Array(W * Hh);
  for (let i = 0; i < hg.length; i++) hg[i] = hd[i * 4] / 255;
  const nd = new Uint8Array(W * Hh * 4);
  for (let y = 0; y < Hh; y++) {
    const ym = ((y - 1 + Hh) % Hh) * W, y0 = y * W, yp = ((y + 1) % Hh) * W;
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const dx = (hg[ym + xp] + 2 * hg[y0 + xp] + hg[yp + xp]) - (hg[ym + xm] + 2 * hg[y0 + xm] + hg[yp + xm]);
      const dy = (hg[yp + xm] + 2 * hg[yp + x] + hg[yp + xp]) - (hg[ym + xm] + 2 * hg[ym + x] + hg[ym + xp]);
      const nx = -dx * 2.2, ny = dy * 2.2, l = Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y0 + x) * 4;
      nd[o] = (nx / l * 0.5 + 0.5) * 255; nd[o + 1] = (ny / l * 0.5 + 0.5) * 255; nd[o + 2] = (0.5 / l + 0.5) * 255; nd[o + 3] = 255;
    }
  }
  const nt = new THREE.DataTexture(nd, W, Hh, THREE.RGBAFormat);
  nt.colorSpace = THREE.NoColorSpace; nt.generateMipmaps = true; nt.minFilter = THREE.LinearMipmapLinearFilter; nt.magFilter = THREE.LinearFilter;
  nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.anisotropy = 16; nt.needsUpdate = true;
  tex.userData.normal = nt;
  return tex;
}

/** foam for wakes: cellular streaks (alpha), tiles in u (along) and clamps in v (across) */
export function makeFoamTexture() {
  const W = 256, Hh = 128;
  const c = canvas(W, Hh), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, W, Hh);
  const R = prng(771);
  for (let i = 0; i < 1600; i++) {
    const x = R() * W, y = R() * Hh;
    const edge = Math.abs(y / Hh - 0.5) * 2;       // more foam at the strip edges and centre (V arms)
    const p = 0.25 + 0.75 * Math.max(Math.pow(edge, 2.5), Math.exp(-((y / Hh - 0.5) ** 2) / 0.004) * 0.8);
    if (R() > p) continue;
    const r = 1 + R() * 4;
    ctx.fillStyle = `rgba(255,255,255,${0.35 + R() * 0.6})`;
    ctx.beginPath(); ctx.ellipse(x, y, r * (1.5 + R() * 2), r, 0, 0, Math.PI * 2); ctx.fill();
    if (x < 12) { ctx.beginPath(); ctx.ellipse(x + W, y, r * 2, r, 0, 0, Math.PI * 2); ctx.fill(); }
    if (x > W - 12) { ctx.beginPath(); ctx.ellipse(x - W, y, r * 2, r, 0, 0, Math.PI * 2); ctx.fill(); }
  }
  const t = bleedTexture(ctx, W, Hh, true, true);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** train / ferry window band: emissive mask in .a is not needed (separate glass material) */
export function makePanelTexture() {
  const W = 256, Hh = 256;
  const c = canvas(W, Hh), ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, Hh);
  ctx.strokeStyle = 'rgba(120,128,138,0.55)'; ctx.lineWidth = 2;
  for (let x = 0; x <= W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, Hh); ctx.stroke(); }
  for (let y = 0; y <= Hh; y += 128) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  return bleedTexture(ctx, W, Hh, true, true);
}

// ---------------------------------------------------------------------------------------------
// shader injection
// ---------------------------------------------------------------------------------------------
// People (humans.js): procedural skeleton evaluated per vertex. aSkin = (bone0, bone1, weight0, slot);
// joint pivots uJ[15] per body type (material uniform); pose from the instance attributes:
// aWalk = (gait phase rad, amplitude 0 idle / 1 walk), aPose = (idle type, variation, head yaw, stride),
// aLook = (outfit row, skin tone, hair colour, face cell). Joint angles A[j] = (pitch x, yaw y, roll z),
// R = Ry * Rz * Rx, chain applied from the bone up to the pelvis, then the root bob / sway offset.
const HUMAN_VS = /* glsl */`
attribute vec4 aSkin;
attribute vec2 aWalk;
attribute vec4 aPose;
attribute vec4 aLook;
uniform vec3 uJ[15];
uniform sampler2D uPal;
uniform vec3 uSkinTone[8];
uniform vec3 uHairTone[8];
uniform float uKy;
varying vec3 vBind;
varying vec2 vHUv;
flat varying vec4 vHSlot;
flat varying vec3 vHInner;
mat3 hR[15];
vec3 hSkP; vec3 hSkN; vec3 hRoot;
const int HPAR[15] = int[15](-1, 0, 1, 0, 3, 4, 0, 6, 7, 1, 9, 10, 1, 12, 13);
mat3 hRot(vec3 a) {
  float cx = cos(a.x), sx = sin(a.x), cy = cos(a.y), sy = sin(a.y), cz = cos(a.z), sz = sin(a.z);
  mat3 Rx = mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
  mat3 Ry = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 Rz = mat3(cz, sz, 0.0, -sz, cz, 0.0, 0.0, 0.0, 1.0);
  return Ry * Rz * Rx;
}
void hPose() {
  vec3 A[15];
  for (int i = 0; i < 15; i++) A[i] = vec3(0.0);
  hRoot = vec3(0.0);
  float ph = aWalk.x, amp = aWalk.y, va = aPose.y;
  if (amp > 0.01) {
    float s = sin(ph), c = cos(ph);
    float k = aPose.w > 0.0 ? aPose.w : 1.0;
    float hipA = 0.36 * k;
    float hl = hipA * s, hr = -hipA * s;
    float kl = 0.07 + 0.92 * pow(max(0.0, cos(ph - 0.15)), 2.4);
    float kr = 0.07 + 0.92 * pow(max(0.0, -cos(ph - 0.15)), 2.4);
    float tl = 0.45 * pow(max(0.0, -sin(ph + 0.35)), 3.0), tr = 0.45 * pow(max(0.0, sin(ph + 0.35)), 3.0);
    float sl = -0.18 * pow(max(0.0, sin(ph - 0.2)), 4.0), sr = -0.18 * pow(max(0.0, -sin(ph - 0.2)), 4.0);
    A[3].x = -hl; A[4].x = kl; A[5].x = hl - kl + tl + sl;
    A[6].x = -hr; A[7].x = kr; A[8].x = hr - kr + tr + sr;
    float arm = 0.3 * (0.75 + 0.5 * va);
    A[9].x = arm * s; A[12].x = -arm * s;
    A[10].x = -(0.24 + 0.32 * max(0.0, -s)); A[13].x = -(0.24 + 0.32 * max(0.0, s));
    A[9].z = 0.07; A[12].z = -0.07;
    A[0].y = -0.08 * s; A[1].y = 0.13 * s; A[0].z = 0.025 * c;
    A[1].x = 0.05; A[2].x = -0.035;
    hRoot.y = (-0.035 + 0.03 * cos(2.0 * ph)) * k;
    hRoot.x = -0.014 * c;
  } else {
    int t = int(aPose.x + 0.5);
    float br = 0.008 * sin(uPropsTime * 1.7 + va * 40.0);
    A[1].x = 0.02 + br; A[2].x = -0.01;
    A[9].z = 0.08; A[12].z = -0.08; A[10].x = -0.14; A[13].x = -0.14; A[4].x = 0.03; A[7].x = 0.03;
    if (t == 1 || (t >= 2 && va > 0.55)) {
      // weight on the right leg (contrapposto): left hip drops, left knee relaxed
      A[0].z = -0.045; A[1].z = 0.05; A[2].z = -0.02; A[3].x = -0.07; A[4].x = 0.24; A[5].x = -0.1; hRoot.x = -0.025;
    }
    if (t == 2) { A[12].x = -0.32; A[12].z = 0.1; A[12].y = 0.25; A[13].x = -1.55; A[14].x = 0.15; A[2].x = 0.38; A[1].x += 0.05; }
    else if (t == 3) { A[9].x = 0.14; A[12].x = 0.14; A[9].z = 0.17; A[12].z = -0.17; A[10].x = -0.55; A[13].x = -0.55; A[11].x = -0.2; A[14].x = -0.2; }
    else if (t == 4) { A[9] = vec3(-0.22, -1.2, 0.04); A[12] = vec3(-0.24, 1.2, -0.04); A[10].x = -1.95; A[13].x = -1.82; }
    else if (t == 5) { A[9].x = -0.18; A[10].x = -1.35; A[10].y = -0.3; A[2].y = 0.2; }
  }
  A[2].y += aPose.z;
  for (int i = 0; i < 15; i++) hR[i] = hRot(A[i]);
}
vec3 hChainP(int b, vec3 p) {
  for (int k = 0; k < 6; k++) { if (b < 0) break; p = hR[b] * (p - uJ[b]) + uJ[b]; b = HPAR[b]; }
  return p;
}
vec3 hChainN(int b, vec3 n) {
  for (int k = 0; k < 6; k++) { if (b < 0) break; n = hR[b] * n; b = HPAR[b]; }
  return n;
}
void hSkin() {
  hPose();
  int b0 = int(aSkin.x + 0.5), b1 = int(aSkin.y + 0.5);
  float w = aSkin.z;
  vec3 p = position;
  int slot = int(aSkin.w + 0.5);
  if (slot == 9 && !(aWalk.y < 0.01 && int(aPose.x + 0.5) == 2)) p = uJ[14];
  hSkP = w * hChainP(b0, p) + (1.0 - w) * hChainP(b1, p) + hRoot;
  hSkN = normalize(w * hChainN(b0, normal) + (1.0 - w) * hChainN(b1, normal));
}
`;
const COMMON_VS = /* glsl */`
uniform float uPropsTime;
uniform vec4 uPropsWind;
uniform vec4 uFadeDist;
varying float vPropFade;
varying vec3 vPropId;
#ifdef PROPS_FADE_ATTR
attribute float aFade;
#endif
#ifdef PROPS_IMPOSTOR
attribute vec4 aImp;
uniform vec2 uImpCell;
#endif
#ifdef PROPS_PEOPLE
attribute float aPart;
attribute vec2 aWalk;
attribute vec3 aShirt;
attribute vec3 aPants;
#endif
#ifdef PROPS_HUMAN
${HUMAN_VS}
#endif
#ifdef PROPS_LEAFFACE
attribute vec3 aCardN;
varying float vCardFacing;
#endif
vec3 propHash3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
vec3 propSway(vec3 p, vec3 base) {
#ifdef PROPS_SWAY
  float h = max(p.y - base.y, 0.0);
  float ph = dot(base.xz, vec2(0.071, 0.053));
  float t = uPropsTime;
  float gust = 0.55 + 0.45 * sin(t * 0.37 + ph * 0.3) * sin(t * 0.23 + ph * 0.7);
  float k = h * h * PROPS_SWAY * uPropsWind.w;
  float s = 0.65 * sin(t * 1.25 + ph) + 0.35 * sin(t * 2.05 + ph * 1.7);
  vec2 off = uPropsWind.xz * k * gust * (0.55 + 0.45 * s);
  float fl = sin(t * 5.3 + dot(p, vec3(1.7, 2.3, 1.9))) * 0.012 * min(h, 8.0) * uPropsWind.w;
  return vec3(off.x + fl, fl * 0.6, off.y - fl * 0.8);
#else
  return vec3(0.0);
#endif
}
`;

const COMMON_FS = /* glsl */`
uniform float uPropsFrame;
uniform float uPropsDebug;
uniform vec3 uLodColor;
varying float vPropFade;
varying vec3 vPropId;
float propsDither() { return fract(52.9829189 * fract(dot(gl_FragCoord.xy + uPropsFrame * vec2(7.13, 3.71), vec2(0.06711056, 0.00583715)))); }
#ifdef PROPS_HUMAN
uniform sampler2D uHumanAtlas;
uniform highp sampler2DArray uHumanFabric;
uniform float uKy;
varying vec3 vBind;
varying vec2 vHUv;
flat varying vec4 vHSlot;
flat varying vec3 vHInner;
vec4 hFace(float cellI, vec2 luv) {
  vec2 cell = vec2(mod(cellI, 4.0), floor(cellI / 4.0 + 0.001));
  vec2 l = clamp(vec2(luv.x, 1.0 - luv.y), 0.002, 0.998);
  return texture(uHumanAtlas, vec2((cell.x + l.x) * 0.25, (cell.y + l.y) * 0.5));
}
#endif
#ifdef PROPS_LEAFFACE
varying float vCardFacing;
#endif
`;

function onBeforeCompileProps(shader, material) {
  Object.assign(shader.uniforms, PROPS_UNIFORMS);
  if (material.userData.humanUniforms) Object.assign(shader.uniforms, material.userData.humanUniforms);
  shader.uniforms.uFadeDist = material.userData.uFadeDist || (material.userData.uFadeDist = { value: new THREE.Vector4(-2, -1, 1e9, 2e9) });
  shader.uniforms.uLodColor = material.userData.uLodColor || (material.userData.uLodColor = { value: new THREE.Color(1, 1, 1) });
  shader.uniforms.uImpCell = material.userData.uImpCell || (material.userData.uImpCell = { value: new THREE.Vector2(0.25, 0.5) });
  let vs = shader.vertexShader, fs = shader.fragmentShader;
  vs = vs.replace('#include <common>', '#include <common>\n' + COMMON_VS);
  fs = fs.replace('#include <common>', '#include <common>\n' + COMMON_FS);
  // ---- vertex: humans (skinned procedural skeleton) -----------------------------------------
  vs = vs.replace('#include <beginnormal_vertex>', /* glsl */`
#include <beginnormal_vertex>
#ifdef PROPS_HUMAN
  hSkin();
  objectNormal = hSkN;
#endif
`);
  // ---- vertex: people limbs + colours -------------------------------------------------------
  vs = vs.replace('#include <begin_vertex>', /* glsl */`
#include <begin_vertex>
#ifdef PROPS_HUMAN
  transformed = hSkP;
#endif
#ifdef PROPS_PEOPLE
  {
    float part = aPart;
    if (part > 0.5) {
      float isLeg = part < 2.5 ? 1.0 : 0.0;
      float sideS = (part < 1.5 || (part > 2.5 && part < 3.5)) ? 1.0 : -1.0;
      float pivot = isLeg > 0.5 ? 0.92 : 1.40;
      float amp = isLeg > 0.5 ? 0.42 : 0.32;
      float a = sin(aWalk.x) * amp * aWalk.y * sideS * (isLeg > 0.5 ? 1.0 : -1.0);
      float y = transformed.y - pivot, z = transformed.z;
      float ca = cos(a), sa = sin(a);
      transformed.y = pivot + y * ca - z * sa;
      transformed.z = y * sa + z * ca;
    }
  }
#endif
`);
  vs = vs.replace('#include <color_vertex>', /* glsl */`
#include <color_vertex>
#ifdef PROPS_PEOPLE
  #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
  if (vColor.r > 0.99 && vColor.g < 0.01) vColor.rgb = aShirt;          // marker red = shirt
  else if (vColor.g > 0.99 && vColor.r < 0.01) vColor.rgb = aPants;     // marker green = trousers
  #endif
#endif
#ifdef PROPS_HUMAN
  {
    int hs = int(aSkin.w + 0.5);
    int row = int(aLook.x + 0.5);
    vec3 col = vec3(0.5); float cellI = 13.0;
    float flags = texelFetch(uPal, ivec2(7, row), 0).a;
    if (hs == 0 || hs == 8) { col = uSkinTone[int(aLook.y + 0.5)]; cellI = hs == 8 ? aLook.w : 13.0; }
    else if (hs == 1) { col = uHairTone[int(aLook.z + 0.5)]; cellI = 6.0 + (aLook.z > 6.5 ? 0.0 : 0.0); }
    else if (hs == 9) { col = vec3(0.025, 0.027, 0.03); cellI = 13.0; }
    else { vec4 pc = texelFetch(uPal, ivec2(hs, row), 0); col = pc.rgb; cellI = pc.a; }
    #if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)
    vColor.rgb = color.rgb * col;
    #endif
    vHSlot = vec4(float(hs), cellI, flags, aLook.w);
    vHInner = texelFetch(uPal, ivec2(2, row), 0).rgb;
    vBind = position;
    vHUv = uv;
  }
#endif
#ifdef PROPS_LEAFFACE
  {
    // card facing: |cos| between the card plane normal and the view ray (edge-on cards fade out)
    vec3 cn = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * aCardN);
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vCardFacing = abs(dot(cn, normalize(cameraPosition - wp.xyz)));
  }
#endif
`);
  // ---- vertex: impostor billboard (world space, faces the camera around the local up) --------
  vs = vs.replace('#include <defaultnormal_vertex>', /* glsl */`
#include <defaultnormal_vertex>
#ifdef PROPS_IMPOSTOR
  vec4 impC = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 impUp = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
  vec3 impTo = cameraPosition - impC.xyz;
  vec3 impR = cross(impUp, impTo); float impRl = length(impR); impR = impRl > 1e-5 ? impR / impRl : vec3(1.0, 0.0, 0.0);
  float impSx = length(instanceMatrix[0].xyz), impSy = length(instanceMatrix[1].xyz);
  vec3 impWorld = impC.xyz + impR * position.x * impSx + impUp * position.y * impSy;
  vec3 impN = normalize(normalize(impTo) * 0.55 + impUp * (0.35 + 0.5 * (position.y - 0.5)) + impR * position.x * 1.1);
  transformedNormal = normalize((viewMatrix * vec4(impN, 0.0)).xyz);
#endif
`);
  vs = vs.replace('#include <project_vertex>', /* glsl */`
#ifdef PROPS_IMPOSTOR
  vec4 mvPosition = viewMatrix * vec4(impWorld, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vec3 propBase = impC.xyz;
  float propDist = length(impC.xyz - cameraPosition);
#else
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    vec3 propBase = instanceMatrix[3].xyz;
  #else
    vec3 propBase = vec3(0.0);
  #endif
  mvPosition.xyz += propSway(mvPosition.xyz, propBase);
  float propDist = length((modelMatrix * vec4(propBase, 1.0)).xyz - cameraPosition);
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
#endif
  vPropId = propHash3(floor(propBase * 4.0 + 0.5) * 0.25 + 17.0);
#if defined(PROPS_FADE_ATTR)
  vPropFade = aFade;
#elif defined(PROPS_FADE_DIST)
  vPropFade = smoothstep(uFadeDist.x, uFadeDist.y, propDist) * (1.0 - smoothstep(uFadeDist.z, uFadeDist.w, propDist));
  #ifdef PROPS_FADE_INVERT
  vPropFade = -max(vPropFade, 1e-4);
  #endif
#else
  vPropFade = 1.0;
#endif
`);
  vs = vs.replace('#include <worldpos_vertex>', /* glsl */`
#ifdef PROPS_IMPOSTOR
  vec4 worldPosition = vec4(impWorld, 1.0);
#else
#include <worldpos_vertex>
#endif
`);
  vs = vs.replace('#include <uv_vertex>', /* glsl */`
#include <uv_vertex>
#if defined(PROPS_IMPOSTOR) && defined(USE_MAP)
  vMapUv = aImp.xy + uv * uImpCell;
#endif
`);
  // ---- fragment: dithered fade + debug tints -------------------------------------------------
  fs = fs.replace('#include <clipping_planes_fragment>', /* glsl */`
#include <clipping_planes_fragment>
  {
    float pf = vPropFade;
    if (pf < 0.999) {
      float dth = propsDither();
      if (pf >= 0.0) { if (dth >= pf) discard; }
      else { if (dth < 1.0 + pf) discard; }
    }
  }
`);
  fs = fs.replace('#include <color_fragment>', /* glsl */`
#include <color_fragment>
  float hRough = -1.0;
#ifdef PROPS_HUMAN
  {
    int sl = int(vHSlot.x + 0.5);
    float cellI = vHSlot.y, flags = vHSlot.z;
    vec3 bp = vec3(vBind.x, vBind.y / max(uKy, 0.1), vBind.z);    // reference-frame bind position
    hRough = 0.82;
    if (sl == 8) {
      vec4 tx = hFace(cellI, vHUv);
      float m = clamp((1.0 - tx.a) * 2.0, 0.0, 1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb * tx.rgb, tx.rgb * 0.8, m);
      hRough = mix(0.52, 0.3, m);
    } else if (sl == 0) {
      hRough = 0.55;
    } else if (sl == 1) {
      vec4 tx = texture(uHumanFabric, vec3(vHUv * vec2(2.2, 2.6), 5.0));
      diffuseColor.rgb *= 0.45 + 0.9 * tx.r;
      hRough = 0.42;
    } else if (sl == 9) {
      hRough = 0.12;
    } else {
      float tile = cellI < 8.5 ? 0.11 : cellI < 9.5 ? 0.075 : cellI < 10.5 ? 0.13 : cellI < 11.5 ? 0.16 : 0.12;
      vec4 tx = texture(uHumanFabric, vec3(vHUv / tile, clamp(cellI - 8.0, 0.0, 4.0)));
      diffuseColor.rgb *= clamp(tx.r / 0.77, 0.6, 1.35);
      hRough = cellI < 8.5 ? 0.9 : cellI < 9.5 ? 0.82 : cellI < 10.5 ? 0.56 : cellI < 11.5 ? 0.93 : 0.48;
      int fl = int(flags + 0.5);
      bool front = bp.z > 0.04;
      // zipper (technical jackets, hi-vis work jackets): front centre line
      if ((fl & 1) != 0 && (sl == 2 || sl == 5 || sl == 6) && front && abs(bp.x) < 0.0045 && bp.y > 0.9 && bp.y < 1.55) { diffuseColor.rgb = vec3(0.05); hRough = 0.3; }
      // jacket pocket welts
      if ((fl & 32) != 0 && sl == 2 && front && abs(bp.y - 1.02) < 0.0035 && abs(abs(bp.x) - 0.095) < 0.035) diffuseColor.rgb *= 0.45;
      // coats / cardigans: front opening + buttons, V opening showing the layer underneath
      if ((fl & 4) != 0 && (sl == 5 || sl == 2) && front && abs(bp.x) < 0.16) {
        float vw = (bp.y - 1.27) * 0.26;
        if (bp.y > 1.27 && abs(bp.x) < vw && sl == 5) diffuseColor.rgb = vHInner * clamp(tx.r / 0.77, 0.7, 1.2);
        else if (abs(bp.x - 0.012) < 0.0025 && bp.y < 1.25) diffuseColor.rgb *= 0.35;
        vec2 bq = vec2(bp.x - 0.035, mod(bp.y, 0.105) - 0.0525);
        if (bp.y > 0.62 && bp.y < 1.2 && length(bq) < 0.0085) { diffuseColor.rgb = vec3(0.06, 0.055, 0.05); hRough = 0.3; }
      }
      // hi-vis vest: two retro-reflective bands
      if ((fl & 8) != 0 && sl == 6 && (abs(bp.y - 1.115) < 0.017 || abs(bp.y - 1.27) < 0.017)) { diffuseColor.rgb = vec3(0.62, 0.64, 0.66); hRough = 0.25; }
      // hoodie kangaroo pocket seam
      if ((fl & 64) != 0 && sl == 2 && front && abs(bp.x) < 0.11 && bp.y > 0.96 && bp.y < 1.12 && (abs(bp.y - 1.12) < 0.003 || abs(abs(bp.x) - 0.11 + (1.12 - bp.y) * 0.0) < 0.003)) diffuseColor.rgb *= 0.55;
      // shoes: soles (white or black) and a welt line
      if (sl == 4) {
        if (bp.y < 0.026) { diffuseColor.rgb = (fl & 16) != 0 ? vec3(0.78, 0.77, 0.74) : vec3(0.035); hRough = 0.7; }
        else if (bp.y < 0.031) diffuseColor.rgb *= 0.55;
      }
    }
  }
#endif
#ifdef PROPS_LEAFFACE
  // edge-on leaf cards thin out instead of streaking (alpha-tested: shrink the cut-out)
  diffuseColor.a *= smoothstep(0.06, 0.42, vCardFacing);
#endif
  if (uPropsDebug > 0.5) diffuseColor.rgb = uPropsDebug < 1.5 ? uLodColor : vPropId;
`);
  fs = fs.replace('#include <roughnessmap_fragment>', /* glsl */`
#include <roughnessmap_fragment>
  if (hRough >= 0.0) roughnessFactor = hRough;
`);
  shader.vertexShader = vs; shader.fragmentShader = fs;
}

/** prepare a material for props: defines + onBeforeCompile, then the planet lighting patch */
export function propsMaterial(app, material, defines = {}, lightOpts = {}) {
  material.defines = Object.assign(material.defines || {}, { PROPS: 1 }, defines);
  material.onBeforeCompile = function (shader) { onBeforeCompileProps(shader, this); };
  material.userData.uFadeDist = { value: new THREE.Vector4(-2, -1, 1e9, 2e9) };
  material.userData.uLodColor = { value: new THREE.Color(1, 1, 1) };
  material.userData.uImpCell = { value: new THREE.Vector2(0.25, 0.5) };
  if (app && app.lighting && app.lighting.patch) app.lighting.patch(material, lightOpts);
  return material;
}

/**
 * People (humans.js): one material per body type (same program, per-type joint pivots uJ and stature
 * ratio uKy) + the matching shadow depth material (same skeleton, so shadows walk too).
 * shared = {pal: outfit palette DataTexture, atlas: face / hair / fabric atlas, skin: Vector3[8], hair: Vector3[8]}
 */
export function humanMaterial(app, joints, ky, shared) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0, name: 'props-human' });
  m.userData.humanUniforms = {
    uJ: { value: joints }, uKy: { value: ky }, uPal: { value: shared.pal }, uHumanAtlas: { value: shared.atlas.faces }, uHumanFabric: { value: shared.atlas.fabric },
    uSkinTone: { value: shared.skin }, uHairTone: { value: shared.hair },
  };
  return propsMaterial(app, m, { PROPS_HUMAN: 1, PROPS_FADE_DIST: 1 });
}
export function humanDepthMaterial(joints, ky, shared) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.defines = { PROPS: 1, PROPS_HUMAN: 1 };
  const U = { uJ: { value: joints }, uKy: { value: ky }, uPal: { value: shared.pal }, uSkinTone: { value: shared.skin }, uHairTone: { value: shared.hair } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, PROPS_UNIFORMS, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uPropsTime;\n' + HUMAN_VS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  hSkin();\n  transformed = hSkP;');
  };
  return m;
}

/** depth material for wind-swayed alpha-tested foliage (CSM cut-out shadows that sway too) */
export function propsDepthMaterial(map, defines) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.45 });
  m.defines = Object.assign({ PROPS: 1 }, defines);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, PROPS_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + COMMON_VS.replace(/varying [^;]+;/g, ''))
      .replace('#include <project_vertex>', /* glsl */`
  vec4 mvPosition = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
    vec3 propBase = instanceMatrix[3].xyz;
  #else
    vec3 propBase = vec3(0.0);
  #endif
  mvPosition.xyz += propSway(mvPosition.xyz, propBase);
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
`);
  };
  return m;
}

// ---------------------------------------------------------------------------------------------
// glow sprites (lamp heads / nav lights seen from afar) and ground light pools: additive custom
// shaders (log depth), night factor computed on the CPU from the local sun elevation
// ---------------------------------------------------------------------------------------------
export function glowMaterial(EMISSIVE_SCALE = 0.05) {
  return new THREE.ShaderMaterial({
    uniforms: { uNight: { value: 0 }, uScale: { value: EMISSIVE_SCALE }, uMinPx: { value: 2.2 }, uViewH: { value: 900 }, uTanHalf: { value: 0.3 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec4 aGlow;       // rgb colour * intensity, w = radius (m)
      uniform float uMinPx; uniform float uViewH; uniform float uTanHalf;
      varying vec3 vCol; varying vec2 vQ;
      void main() {
        vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float d = max(-c.z, 0.1);
        float pxPerM = uViewH / (2.0 * uTanHalf * d);
        float r = max(aGlow.w, uMinPx / pxPerM);
        float boost = aGlow.w / r;                        // keep the energy when the sprite is enlarged
        vCol = aGlow.rgb * boost * boost;
        vQ = position.xy;
        c.xy += position.xy * r;
        gl_Position = projectionMatrix * c;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uNight; uniform float uScale;
      varying vec3 vCol; varying vec2 vQ;
      void main() {
        #include <logdepthbuf_fragment>
        float r2 = dot(vQ, vQ);
        if (r2 > 1.0) discard;
        float f = exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.5);
        gl_FragColor = vec4(vCol * f * uNight * uScale, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
}

export function poolMaterial(EMISSIVE_SCALE = 0.05) {
  // additive ground pools under lamps / light bollards; inside uSpotR (lights.js: the nearest lamps carry
  // real SpotLights) the decals are dimmed to uSpotDecal so the near field is not lit twice
  return new THREE.ShaderMaterial({
    uniforms: { uNight: { value: 0 }, uScale: { value: EMISSIVE_SCALE }, uSpotR: { value: 0 }, uSpotDecal: { value: 0.35 } },
    vertexShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec4 aGlow;
      uniform float uSpotR; uniform float uSpotDecal;
      varying vec3 vCol; varying vec2 vQ;
      void main() {
        vec4 wc = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float d = length(wc.xyz - cameraPosition);
        float near = uSpotR > 0.0 ? mix(uSpotDecal, 1.0, smoothstep(uSpotR * 0.8, uSpotR, d)) : 1.0;
        vCol = aGlow.rgb * near; vQ = position.xz;
        vec4 p = vec4(position.x * aGlow.w, position.y, position.z * aGlow.w, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * p;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uNight; uniform float uScale;
      varying vec3 vCol; varying vec2 vQ;
      void main() {
        #include <logdepthbuf_fragment>
        float r2 = dot(vQ, vQ);
        if (r2 > 1.0) discard;
        float f = pow(1.0 - r2, 2.2);
        gl_FragColor = vec4(vCol * f * uNight * uScale, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}

/** road-vehicle materials; `defines` adds e.g. PROPS_FADE_ATTR for the moving variants */
function vehicleMaterials(L, defines) {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const phys = (o) => new THREE.MeshPhysicalMaterial(o);
  return {
    carBody: L(phys({ color: 0xffffff, vertexColors: true, roughness: 0.25, metalness: 0.35, clearcoat: 1.0, clearcoatRoughness: 0.08, side: THREE.DoubleSide, name: 'props-car' }), { ...defines }),
    carGlass: L(phys({ color: 0x141a20, roughness: 0.04, metalness: 0.4, side: THREE.DoubleSide, name: 'props-car-glass' }), { ...defines }),
    tyre: L(std({ color: 0x1a1a1c, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, name: 'props-tyre' }), { ...defines }),
    headlight: L(std({ color: 0xffffff, emissive: new THREE.Color(1, 0.97, 0.92), emissiveIntensity: 6, roughness: 0.2, side: THREE.DoubleSide, name: 'props-car-head' }), { ...defines }),
    taillight: L(std({ color: 0x501010, emissive: new THREE.Color(1, 0.08, 0.05), emissiveIntensity: 4, roughness: 0.3, side: THREE.DoubleSide, name: 'props-car-tail' }), { ...defines }),
    dark: L(std({ color: 0x2a2c30, roughness: 0.62, metalness: 0.4, side: THREE.DoubleSide, name: 'props-car-dark' }), { ...defines }),
  };
}

// ---------------------------------------------------------------------------------------------
// library
// ---------------------------------------------------------------------------------------------
export class PropsMaterials {
  constructor(app) {
    this.app = app;
    this.tex = { leaf: makeLeafAtlas(), bark: makeBarkTexture(), foam: makeFoamTexture(), panel: makePanelTexture() };
    const L = (m, defines, lo) => propsMaterial(app, m, defines, lo);
    const T = this.tex;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    const phys = (o) => new THREE.MeshPhysicalMaterial(o);
    this.m = {
      // vegetation (near, CPU-bucketed: per-instance fade attribute)
      // foliage: physical material with a low specular intensity (F0 and F90 scaled) -- cards seen edge-on
      // would otherwise flash a white Fresnel sheen
      leaf: L(phys({ map: T.leaf, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.82, metalness: 0, specularIntensity: 0.22, name: 'props-leaf' }), { PROPS_SWAY: '0.0011', PROPS_FADE_ATTR: 1, PROPS_LEAFFACE: 1 }),
      bark: L(std({ map: T.bark, normalMap: T.bark.userData.normal, normalScale: new THREE.Vector2(1.4, 1.4), vertexColors: true, roughness: 0.93, metalness: 0, side: THREE.DoubleSide, name: 'props-bark' }), { PROPS_SWAY: '0.0011', PROPS_FADE_ATTR: 1 }),
      core: L(phys({ vertexColors: true, roughness: 0.92, metalness: 0, specularIntensity: 0.2, side: THREE.DoubleSide, name: 'props-leafcore' }), { PROPS_SWAY: '0.0011', PROPS_FADE_ATTR: 1 }),
      impostor: L(phys({ alphaTest: 0.5, vertexColors: false, roughness: 0.88, metalness: 0, specularIntensity: 0.22, name: 'props-impostor' }), { PROPS_IMPOSTOR: 1, PROPS_FADE_DIST: 1, PROPS_FADE_INVERT: 1 }),
      // per-tile static meshes (distance fade)
      shrubLeaf: L(phys({ map: T.leaf, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.84, metalness: 0, specularIntensity: 0.22, name: 'props-shrub' }), { PROPS_SWAY: '0.004', PROPS_FADE_DIST: 1, PROPS_LEAFFACE: 1 }),
      shrubCore: L(std({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, name: 'props-shrubcore' }), { PROPS_SWAY: '0.004', PROPS_FADE_DIST: 1 }),
      metal: L(std({ color: 0x9aa0a6, vertexColors: true, roughness: 0.42, metalness: 0.65, side: THREE.DoubleSide, name: 'props-metal' }), { PROPS_FADE_DIST: 1 }),
      paint: L(std({ color: 0xffffff, vertexColors: true, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide, name: 'props-paint' }), { PROPS_FADE_DIST: 1 }),
      wood: L(std({ color: 0xa27a55, vertexColors: true, roughness: 0.72, metalness: 0, side: THREE.DoubleSide, name: 'props-wood' }), { PROPS_FADE_DIST: 1 }),
      ceramic: L(phys({ color: 0xf1eee8, vertexColors: true, roughness: 0.35, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.3, side: THREE.DoubleSide, name: 'props-ceramic' }), { PROPS_FADE_DIST: 1 }),
      glassFurn: L(phys({ color: 0x9fb4c4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, name: 'props-glass' }), { PROPS_FADE_DIST: 1 }),
      lampHead: L(std({ color: 0xdedcd6, emissive: new THREE.Color(1.0, 0.9, 0.76), emissiveIntensity: 2.4, roughness: 0.4, metalness: 0.2, side: THREE.DoubleSide, name: 'props-lamphead' }), { PROPS_FADE_DIST: 1 }, { nightEmissive: true }),
      // people
      people: L(std({ vertexColors: true, roughness: 0.82, metalness: 0, name: 'props-people' }), { PROPS_PEOPLE: 1, PROPS_FADE_DIST: 1 }),
      // trains
      trainBody: L(phys({ color: 0xf4f5f6, map: T.panel, vertexColors: true, roughness: 0.26, metalness: 0.08, clearcoat: 0.9, clearcoatRoughness: 0.12, side: THREE.DoubleSide, name: 'props-train' }), {}),
      trainGlass: L(phys({ color: 0x18222c, roughness: 0.05, metalness: 0.3, emissive: new THREE.Color(1.0, 0.92, 0.8), emissiveIntensity: 1.5, side: THREE.DoubleSide, name: 'props-train-glass' }), {}, { nightEmissive: true }),
      dark: L(std({ color: 0x2a2c30, roughness: 0.62, metalness: 0.4, side: THREE.DoubleSide, name: 'props-dark' }), {}),
      headlight: L(std({ color: 0xffffff, emissive: new THREE.Color(1, 0.97, 0.92), emissiveIntensity: 9, roughness: 0.2, side: THREE.DoubleSide, name: 'props-headlight' }), {}),
      taillight: L(std({ color: 0x501010, emissive: new THREE.Color(1, 0.08, 0.05), emissiveIntensity: 5, roughness: 0.3, side: THREE.DoubleSide, name: 'props-taillight' }), {}),
      // boats
      hull: L(phys({ color: 0xf6f6f4, vertexColors: true, roughness: 0.3, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.2, side: THREE.DoubleSide, name: 'props-hull' }), {}),
      deck: L(std({ color: 0x8c8f92, vertexColors: true, roughness: 0.75, metalness: 0.1, side: THREE.DoubleSide, name: 'props-deck' }), {}),
      boatGlass: L(phys({ color: 0x1b2733, roughness: 0.05, metalness: 0.35, emissive: new THREE.Color(1.0, 0.9, 0.75), emissiveIntensity: 1.4, side: THREE.DoubleSide, name: 'props-boat-glass' }), {}, { nightEmissive: true }),
      navRed: L(std({ color: 0x401010, emissive: new THREE.Color(1, 0.05, 0.03), emissiveIntensity: 7, name: 'props-nav-red' }), {}, { nightEmissive: true }),
      navGreen: L(std({ color: 0x104010, emissive: new THREE.Color(0.05, 1, 0.25), emissiveIntensity: 7, name: 'props-nav-green' }), {}, { nightEmissive: true }),
      navWhite: L(std({ color: 0x505050, emissive: new THREE.Color(1, 1, 0.95), emissiveIntensity: 7, name: 'props-nav-white' }), {}, { nightEmissive: true }),
      cargo: L(std({ color: 0xffffff, vertexColors: true, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide, name: 'props-cargo' }), {}),
      wake: L(std({ color: 0xffffff, map: T.foam, vertexColors: true, transparent: true, depthWrite: false, roughness: 0.55, metalness: 0, name: 'props-wake' }), {}, { receiveCloudShadow: true }),
      // vehicles (parked, per tile)
      ...vehicleMaterials(L, {}),
    };
    this._dyn = vehicleMaterials(L, { PROPS_FADE_ATTR: 1 });
    this.depth = {
      leaf: propsDepthMaterial(T.leaf, { PROPS_SWAY: '0.0011' }),
      shrub: propsDepthMaterial(T.leaf, { PROPS_SWAY: '0.004' }),
    };
    this.glow = glowMaterial(app?.lighting?.uniforms?.uLpEmissiveScale?.value ?? 0.05);
    this.pool = poolMaterial(app?.lighting?.uniforms?.uLpEmissiveScale?.value ?? 0.05);
    this.bpool = poolMaterial(app?.lighting?.uniforms?.uLpEmissiveScale?.value ?? 0.05);   // light bollards (never dimmed)
    // bind the shared emissive unit (atmosphere raises it at night with the capped ground exposure, round 2):
    // glows and pools follow the night regime exactly like every patched emissive
    const ES = app?.lighting?.uniforms?.uLpEmissiveScale;
    if (ES) for (const m of [this.glow, this.pool, this.bpool]) m.uniforms.uScale = ES;
    // static per-tile fade ranges (metres): furniture / shrubs / lamps
    this.setFade('shrubLeaf', -2, -1, 260, 340);
    this.setFade('shrubCore', -2, -1, 260, 340);
    for (const k of ['metal', 'paint', 'wood', 'ceramic', 'glassFurn']) this.setFade(k, -2, -1, 330, 420);
    this.setFade('lampHead', -2, -1, 900, 1100);
    this.setFade('people', -2, -1, 270, 320);
    this.wire = false;
  }
  get(k) { return this.m[k]; }
  /** moving-vehicle variant (per-instance dithered fade attribute aFade) */
  dyn(k) { return this._dyn[k] || this.m[k]; }
  setFade(k, a, b, c, d) {
    const u = this.m[k].userData.uFadeDist; u.value.set(a, b, c, d);
    (this._fades || (this._fades = {}))[k] = [a, b, c, d];
    if (this._static) this._snap(k);
  }
  /** collapse every distance-fade band to its midpoint (no dither) while the view is still */
  setStaticFades(on) {
    this._static = !!on;
    for (const k of Object.keys(this._fades || {})) { if (on) this._snap(k); else this.m[k].userData.uFadeDist.value.set(...this._fades[k]); }
  }
  _snap(k) {
    const [a, b, c, d] = this._fades[k];
    const m0 = (a + b) / 2, m1 = (c + d) / 2;
    this.m[k].userData.uFadeDist.value.set(m0, m0 + 1e-3, m1, m1 + 1e-3);
  }
  setWireframe(on) {
    if (this.wire === on) return;
    this.wire = on;
    for (const m of Object.values(this.m)) { m.wireframe = on; }
    for (const m of Object.values(this._dyn)) { m.wireframe = on; }
  }
  update(frame, night, swayTime = frame.time) {
    PROPS_UNIFORMS.uPropsTime.value = swayTime;
    PROPS_UNIFORMS.uPropsFrame.value = (frame.frameNo % 64);
    this.glow.uniforms.uNight.value = night;
    this.pool.uniforms.uNight.value = night;
    this.bpool.uniforms.uNight.value = night;
    this.glow.uniforms.uViewH.value = frame.viewport.height * frame.viewport.pixelRatio;
    this.glow.uniforms.uTanHalf.value = Math.tan((frame.camera.fov * Math.PI / 180) / 2);
  }
}
