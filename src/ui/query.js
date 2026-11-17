// Search query parsing (pure, Node-testable). OWNER: ui agent.
//   parseCoords("22.5, 118.2") / ("22°30'N 118°12'E") / ("北纬22.5 东经118.2, 3km") -> {lat, lon, alt?}
//   parseQuery(text, ctx) -> ranked candidates [{kind, key, title, sub, score, ...}]
// kinds: 'coords' | 'province' | 'mega' | 'bookmark' | 'building'

function normalise(s) {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) // full-width -> ASCII
    .replace(/　/g, ' ')
    .replace(/[，、；]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/北纬/g, ' N ').replace(/南纬/g, ' S ').replace(/东经/g, ' E ').replace(/西经/g, ' W ')
    .replace(/[度º˚]/g, '°').replace(/[分’′]/g, "'").replace(/[秒”″]/g, '"')
    .replace(/[−–—]/g, '-')
    .replace(/公里|千米/g, 'KM').replace(/米/g, 'M')
    .toUpperCase()
    .trim();
}

function tokenize(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === ',' || c === ';' || c === '/') { toks.push({ t: 'sep' }); i++; continue; }
    if (c === 'N' || c === 'S' || c === 'E' || c === 'W') { toks.push({ t: 'hemi', v: c }); i++; continue; }
    const m = /^[+-]?\d+(?:\.\d+)?|^[+-]?\.\d+/.exec(s.slice(i));
    if (m) {
      i += m[0].length;
      const rest = s.slice(i);
      const mk = /^\s*(°|'|"|KM|M(?![A-Z]))/.exec(rest);
      let mark = null;
      if (mk) { mark = mk[1]; i += mk[0].length; }
      toks.push({ t: 'num', v: parseFloat(m[0]), raw: m[0], mark });
      continue;
    }
    return null;
  }
  return toks;
}

/** Parse coordinates; returns {lat, lon, alt?} or null. */
export function parseCoords(text) {
  if (!text) return null;
  const toks = tokenize(normalise(text));
  if (!toks || !toks.length) return null;
  const comps = [];
  let alt = null;
  let cur = null;
  const close = () => { if (cur && cur.nums.length) comps.push(cur); cur = null; };
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t === 'sep') { close(); continue; }
    if (tk.t === 'hemi') {
      if (cur && cur.nums.length && !cur.lead && !cur.trail) { cur.trail = tk.v; close(); }
      else { close(); cur = { lead: tk.v, nums: [], marks: [] }; }
      continue;
    }
    // number
    if (tk.mark === 'KM' || tk.mark === 'M') { close(); alt = tk.v * (tk.mark === 'KM' ? 1000 : 1); continue; }
    if (cur && cur.nums.length) {
      const last = cur.marks[cur.marks.length - 1];
      if ((last === '°' && tk.mark === "'") || (last === "'" && tk.mark === '"') || (last === '°' && tk.mark === '"')) {
        cur.nums.push(tk.v); cur.marks.push(tk.mark); continue;
      }
      close();
    }
    if (!cur) cur = { lead: null, nums: [], marks: [] };
    cur.nums.push(tk.v); cur.marks.push(tk.mark);
  }
  close();
  if (comps.length < 2 || comps.length > 3) return null;
  if (comps.length === 3) {
    const c = comps[2];
    if (c.lead || c.trail || c.nums.length !== 1 || c.marks[0]) return null;
    if (alt != null) return null;
    alt = c.nums[0];
    comps.length = 2;
  }
  const vals = comps.map((c) => {
    let d = c.nums[0], m = 0, s = 0;
    for (let j = 1; j < c.nums.length; j++) { if (c.marks[j] === "'") m = c.nums[j]; else if (c.marks[j] === '"') s = c.nums[j]; }
    const neg = d < 0 || Object.is(d, -0);
    let v = Math.abs(d) + m / 60 + s / 3600;
    if (neg) v = -v;
    const hemi = c.lead || c.trail || null;
    if (hemi === 'S' || hemi === 'W') v = -Math.abs(v);
    if (hemi === 'N' || hemi === 'E') v = Math.abs(v);
    return { v, axis: hemi === 'N' || hemi === 'S' ? 'lat' : hemi === 'E' || hemi === 'W' ? 'lon' : null };
  });
  let lat, lon;
  const [a, b] = vals;
  if (a.axis === 'lon' || b.axis === 'lat') { lat = b.v; lon = a.v; if (a.axis === 'lat' || b.axis === 'lon') return null; }
  else { lat = a.v; lon = b.v; }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90) return null;
  if (lon > 180 && lon <= 360) lon -= 360;
  if (Math.abs(lon) > 180) return null;
  const out = { lat, lon };
  if (alt != null && Number.isFinite(alt)) out.alt = alt;
  return out;
}

/** "ZR1", "zr 1", "OX-5" -> "ZR1" */
export function parseProvinceCode(text) {
  const m = /^\s*(OX|ZR)\s*-?\s*([1-6])\s*$/i.exec(normalise(text || ''));
  return m ? `${m[1].toUpperCase()}${m[2]}` : null;
}

/**
 * Ranked candidates. ctx = { provinces:[{id,code,name,lat,lon,zone}], megas:[{id,name,province,lat,lon}],
 * bookmarks:[{id,name,group}], zones:{O:{name},Z:{name}} }
 */
export function parseQuery(text, ctx = {}) {
  const raw = (text || '').trim();
  if (!raw) return [];
  const q = raw.toLowerCase();
  const out = [];
  const push = (c) => { if (!out.some((o) => o.key === c.key)) out.push(c); };

  const coords = parseCoords(raw);
  if (coords) push({ kind: 'coords', key: `c:${coords.lat},${coords.lon}`, score: 100, ...coords });

  const code = parseProvinceCode(raw);
  for (const p of ctx.provinces || []) {
    if (!p) continue;
    let score = 0;
    if (code && p.code === code) score = 98;
    else if (p.name === raw) score = 95;
    else if (p.name.includes(raw) && raw.length >= 1 && /[一-鿿]/.test(raw)) score = 70 + Math.min(20, raw.length * 4);
    else if (p.code.toLowerCase().startsWith(q) && q.length >= 2) score = 60;
    if (score) push({ kind: 'province', key: `p:${p.code}`, score, province: p });
  }

  for (const m of ctx.megas || []) {
    let score = 0;
    if (m.id.toLowerCase() === q || m.id.toLowerCase() === q.replace(/^g(\d)$/, 'g0$1')) score = 97;
    else if (m.name === raw) score = 94;
    else if (/[一-鿿]/.test(raw) && m.name.includes(raw)) score = 68 + Math.min(20, raw.length * 4);
    if (score) push({ kind: 'mega', key: `m:${m.id}`, score, mega: m });
  }

  for (const b of ctx.bookmarks || []) {
    let score = 0;
    const id = String(b.id).toLowerCase();
    const name = String(b.name || '');
    if (id === q) score = 96;
    else if (/^\d{1,2}$/.test(q) && b.group === 'shot' && id === `s${q.padStart(2, '0')}`) score = 80;
    else if (name && name.toLowerCase().includes(q) && q.length >= 2) score = 55 + Math.min(20, q.length * 2);
    if (score) push({ kind: 'bookmark', key: `b:${b.id}`, score, bookmark: b });
  }

  // building IDs: anything ID-shaped that is not just a province code / coordinates
  const idLike = /^[A-Za-z0-9][A-Za-z0-9_.:\-#/]{3,}$/.test(raw) && /\d/.test(raw) && !coords && !code;
  if (idLike) push({ kind: 'building', key: `i:${raw}`, score: /^(OX|ZR)\d[-_]/i.test(raw) ? 92 : 50, id: raw });

  out.sort((x, y) => y.score - x.score);
  return out;
}
