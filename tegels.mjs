// OPL (osmium add-locations-to-ways -f opl) -> z14 tiles in compact format v1.
// Usage: node tegels.mjs roads.opl out/ [--stand <ISO timestamp>]
// Each tile holds every car way that touches it, complete with all its nodes, so any tile is self-contained.
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ZOOM } from './decode.mjs';

export const HIGHWAYS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const WAY_TAGS = new Set(['highway', 'oneway', 'junction', 'lanes', 'lanes:forward', 'lanes:backward', 'maxspeed', 'access',
  'motor_vehicle', 'motorcar', 'vehicle', 'name', 'ref', 'area']);
const NODE_TAGS = new Set(['highway', 'crossing']);

const unesc = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
function parseTags(s, keep) {
  const t = {};
  if (!s) return t;
  for (const kv of s.split(',')) {
    const i = kv.indexOf('=');
    if (i < 0) continue;
    const k = unesc(kv.slice(0, i));
    if (keep.has(k)) t[k] = unesc(kv.slice(i + 1));
  }
  return t;
}

// Reads the OPL into { ways, nodeTags }. Ways carry their node ids and coordinates (1e-6 degrees) inline.
export async function leesOpl(pad) {
  const ways = [], nodeTags = new Map();
  const rl = createInterface({ input: createReadStream(pad, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const c = line[0];
    if (c !== 'n' && c !== 'w') continue;
    const f = line.split(' ');
    const id = Number(f[0].slice(1));
    let T = '', N = '';
    for (const x of f) { if (x[0] === 'T') T = x.slice(1); else if (x[0] === 'N') N = x.slice(1); }
    if (c === 'n') {
      const t = parseTags(T, NODE_TAGS);
      if (t.highway) nodeTags.set(id, t);
      continue;
    }
    const tags = parseTags(T, WAY_TAGS);
    if (!HIGHWAYS.has(tags.highway) || !N) continue;
    const refs = N.split(','), ids = [], la = [], lo = [];
    for (const r of refs) {
      const xi = r.indexOf('x'), yi = r.indexOf('y');
      if (xi < 0 || yi < 0 || yi === xi + 1 || yi === r.length - 1) continue; // node without location
      ids.push(Number(r.slice(1, xi)));
      lo.push(Math.round(Number(r.slice(xi + 1, yi)) * 1e6));
      la.push(Math.round(Number(r.slice(yi + 1)) * 1e6));
    }
    if (ids.length < 2) continue;
    ways.push({ id, tags, ids: Float64Array.from(ids), la: Int32Array.from(la), lo: Int32Array.from(lo) });
  }
  return { ways, nodeTags };
}

// Fractional tile coordinates at ZOOM.
const n2 = 2 ** ZOOM;
const fx = (lon) => (lon + 180) / 360 * n2;
const fy = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n2; };

// All tiles a segment passes through (grid traversal in tile space, exact up to the mercator curvature of a few metres).
function segmentTegels(x0, y0, x1, y1, uit) {
  let tx = Math.floor(x0), ty = Math.floor(y0);
  const ex = Math.floor(x1), ey = Math.floor(y1);
  uit(tx, ty);
  const dx = x1 - x0, dy = y1 - y0, sx = Math.sign(dx), sy = Math.sign(dy);
  const tdx = dx ? Math.abs(1 / dx) : Infinity, tdy = dy ? Math.abs(1 / dy) : Infinity;
  let mx = dx ? (sx > 0 ? tx + 1 - x0 : x0 - tx) * tdx : Infinity;
  let my = dy ? (sy > 0 ? ty + 1 - y0 : y0 - ty) * tdy : Infinity;
  for (let k = 0; k < 10000 && (tx !== ex || ty !== ey); k++) {
    if (mx < my) { tx += sx; mx += tdx; } else { ty += sy; my += tdy; }
    uit(tx, ty);
  }
}

export function verdeel(ways) {
  const tegels = new Map(); // key x*2^ZOOM+y -> way indices
  ways.forEach((w, wi) => {
    const ks = new Set(), add = (x, y) => ks.add(x * n2 + y);
    let px = fx(w.lo[0] / 1e6), py = fy(w.la[0] / 1e6);
    for (let i = 1; i < w.ids.length; i++) {
      const qx = fx(w.lo[i] / 1e6), qy = fy(w.la[i] / 1e6);
      segmentTegels(px, py, qx, qy, add);
      px = qx; py = qy;
    }
    for (const k of ks) { let l = tegels.get(k); if (!l) tegels.set(k, l = []); l.push(wi); }
  });
  return tegels;
}

export function codeer(ws, nodeTags) {
  const coord = new Map();
  for (const w of ws) for (let i = 0; i < w.ids.length; i++) coord.set(w.ids[i], [w.la[i], w.lo[i]]);
  const sorted = [...coord.keys()].sort((a, b) => a - b), idx = new Map(sorted.map((id, i) => [id, i]));
  const n = []; let pi = 0, pa = 0, po = 0;
  for (const id of sorted) { const [la, lo] = coord.get(id); n.push(id - pi, la - pa, lo - po); pi = id; pa = la; po = lo; }
  const t = [], tmap = new Map(), nt = {};
  const ti = (tags) => { const s = JSON.stringify(tags); if (!tmap.has(s)) { tmap.set(s, t.length); t.push(tags); } return tmap.get(s); };
  sorted.forEach((id, i) => { const tg = nodeTags.get(id); if (tg) nt[i] = ti(tg); });
  const w = []; let pw = 0;
  for (const x of [...ws].sort((a, b) => a.id - b.id)) { w.push([x.id - pw, ti(x.tags), ...Array.from(x.ids, (r) => idx.get(r))]); pw = x.id; }
  return JSON.stringify({ v: 1, t, n, nt, w });
}

export async function bouw(opl, uit, stand) {
  const t0 = Date.now();
  const { ways, nodeTags } = await leesOpl(opl);
  console.log(`read ${ways.length} ways, ${nodeTags.size} tagged nodes in ${Date.now() - t0} ms`);
  const tegels = verdeel(ways);
  let bytes = 0;
  for (const [k, wis] of tegels) {
    const x = Math.floor(k / n2), y = k % n2, dir = join(uit, String(ZOOM), String(x));
    mkdirSync(dir, { recursive: true });
    const s = codeer(wis.map((i) => ways[i]), nodeTags);
    writeFileSync(join(dir, y + '.json'), s);
    bytes += Buffer.byteLength(s);
  }
  const meta = { v: 1, zoom: ZOOM, stand: stand || null, gebouwd: new Date().toISOString(), tegels: tegels.size, bytes };
  writeFileSync(join(uit, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(`wrote ${tegels.size} tiles, ${(bytes / 1e6).toFixed(1)} MB in ${Date.now() - t0} ms`);
  return meta;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [opl, uit = 'out'] = process.argv.slice(2).filter((a, i, all) => a !== '--stand' && all[i - 1] !== '--stand');
  const si = process.argv.indexOf('--stand');
  if (!opl) { console.error('usage: node tegels.mjs roads.opl out/ [--stand ISO]'); process.exit(2); }
  await bouw(opl, uit, si > 0 ? process.argv[si + 1] : null);
}
