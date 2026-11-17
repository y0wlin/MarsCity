// 2D geometry helpers for the planning plane (flat arrays [x0,y0,x1,y1,...], CCW polygons).

/** clip convex/any polygon (flat array) by half-plane a*x + b*y + c >= 0 */
export function clipHalfPlane(poly, a, b, c) {
  const n = poly.length >> 1;
  if (n === 0) return poly;
  const out = [];
  let px = poly[2 * n - 2], py = poly[2 * n - 1];
  let pd = a * px + b * py + c;
  for (let i = 0; i < n; i++) {
    const x = poly[2 * i], y = poly[2 * i + 1];
    const d = a * x + b * y + c;
    if (d >= 0) {
      if (pd < 0) { const t = pd / (pd - d); out.push(px + (x - px) * t, py + (y - py) * t); }
      out.push(x, y);
    } else if (pd >= 0) {
      const t = pd / (pd - d); out.push(px + (x - px) * t, py + (y - py) * t);
    }
    px = x; py = y; pd = d;
  }
  return out;
}

/** clip polygon by axis-aligned rect */
export function clipRect(poly, x0, y0, x1, y1) {
  let p = clipHalfPlane(poly, 1, 0, -x0);
  p = clipHalfPlane(p, -1, 0, x1);
  p = clipHalfPlane(p, 0, 1, -y0);
  return clipHalfPlane(p, 0, -1, y1);
}

export function rectPoly(x0, y0, x1, y1) { return [x0, y0, x1, y0, x1, y1, x0, y1]; }

export function polyArea(p) {
  let s = 0; const n = p.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) s += p[2 * j] * p[2 * i + 1] - p[2 * i] * p[2 * j + 1];
  return s * 0.5;
}

export function polyCentroid(p, out = {}) {
  let a = 0, cx = 0, cy = 0; const n = p.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const f = p[2 * j] * p[2 * i + 1] - p[2 * i] * p[2 * j + 1];
    a += f; cx += (p[2 * j] + p[2 * i]) * f; cy += (p[2 * j + 1] + p[2 * i + 1]) * f;
  }
  if (Math.abs(a) < 1e-9) { let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += p[2 * i]; sy += p[2 * i + 1]; } out.x = sx / Math.max(1, n); out.y = sy / Math.max(1, n); return out; }
  out.x = cx / (3 * a); out.y = cy / (3 * a);
  return out;
}

export function polyBounds(p, out = {}) {
  let x0 = 1e30, y0 = 1e30, x1 = -1e30, y1 = -1e30;
  for (let i = 0; i < p.length; i += 2) { const x = p[i], y = p[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  out.x0 = x0; out.y0 = y0; out.x1 = x1; out.y1 = y1; return out;
}

/** point in polygon (even-odd) */
export function pointInPoly(p, x, y) {
  let inside = false; const n = p.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i], yi = p[2 * i + 1], xj = p[2 * j], yj = p[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** clip segment (x0,y0)-(x1,y1) to convex polygon given as half-planes [a,b,c,...] (a x+b y+c>=0). Returns [t0,t1] or null */
export function clipSegHalfPlanes(hp, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (let i = 0; i < hp.length; i += 3) {
    const a = hp[i], b = hp[i + 1], c = hp[i + 2];
    const d0 = a * x0 + b * y0 + c, dd = a * dx + b * dy;
    if (Math.abs(dd) < 1e-12) { if (d0 < 0) return null; continue; }
    const t = -d0 / dd;
    if (dd > 0) { if (t > t0) t0 = t; } else { if (t < t1) t1 = t; }
    if (t0 > t1) return null;
  }
  return [t0, t1];
}

/** convex polygon (flat, CCW) → half-planes [a,b,c,...] with unit normals pointing inside */
export function polyHalfPlanes(p) {
  const n = p.length >> 1, hp = [];
  for (let i = 0; i < n; i++) {
    const x0 = p[2 * i], y0 = p[2 * i + 1], x1 = p[(2 * i + 2) % (2 * n)], y1 = p[(2 * i + 3) % (2 * n)];
    let a = -(y1 - y0), b = x1 - x0; const l = Math.hypot(a, b);
    if (l < 1e-9) continue;
    a /= l; b /= l;
    hp.push(a, b, -(a * x0 + b * y0));
  }
  return hp;
}

/** min signed distance of a point to half-planes (positive inside) */
export function hpDistance(hp, x, y) {
  let m = 1e30;
  for (let i = 0; i < hp.length; i += 3) { const d = hp[i] * x + hp[i + 1] * y + hp[i + 2]; if (d < m) m = d; }
  return m;
}

/** rect fully inside half-planes (with margin) */
export function rectInside(hp, x0, y0, x1, y1, margin = 0) {
  return hpDistance(hp, x0, y0) >= margin && hpDistance(hp, x1, y0) >= margin && hpDistance(hp, x1, y1) >= margin && hpDistance(hp, x0, y1) >= margin;
}

/** distance from point to segment */
export function segDist(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = x0 + t * dx - px, ey = y0 + t * dy - py;
  return Math.sqrt(ex * ex + ey * ey);
}

/** filtered fraction of a periodic stripe pattern: stripes of width w centred at k*P, box filter of width t centred at x */
export function stripeFrac(x, P, w, t) {
  if (w <= 0) return 0;
  if (t <= 1e-6) { const f = x / P - Math.floor(x / P + 0.5); return Math.abs(f * P) <= w / 2 ? 1 : 0; }
  const F = (s) => { // integral of indicator from 0 to s (stripes centred at multiples of P)
    const s2 = s + w / 2; const k = Math.floor(s2 / P); const r = s2 - k * P;
    return k * w + (r < w ? r : w);
  };
  const v = (F(x + t / 2) - F(x - t / 2)) / t;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
