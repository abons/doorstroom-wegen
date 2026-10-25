// Decoder for the doorstroom-wegen tiles. Browser and node, no dependencies.
//   const tegels = tegelsVoor([s, w, n, e]);                       // [[x, y], ...] at ZOOM
//   const json = await Promise.all(tegels.map(([x, y]) => fetch(tegelUrl(x, y)).then((r) => r.json())));
//   const osm = naarOverpass(json);                                // { elements: [...nodes, ...ways] }, Overpass-JSON shape
export const ZOOM = 14;
export const BASIS = 'https://abons.github.io/doorstroom-wegen/';
export const tegelUrl = (x, y, basis = BASIS) => `${basis}${ZOOM}/${x}/${y}.json`;

// Slippy-map tile containing a point.
export function tegelXY(lat, lon, z = ZOOM) {
  const n = 2 ** z, r = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)];
}

// All tiles covering bbox [south, west, north, east].
export function tegelsVoor([s, w, n, e]) {
  const [x0, y0] = tegelXY(n, w), [x1, y1] = tegelXY(s, e), uit = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) uit.push([x, y]);
  return uit;
}

// One tile -> { nodes: [{type,id,lat,lon,tags?}], ways: [{type,id,nodes,tags}] }.
export function decodeer(tegel) {
  if (tegel.v !== 1) throw new Error('unknown tile version ' + tegel.v);
  const { t, n, nt, w } = tegel, ids = [], nodes = [];
  let id = 0, la = 0, lo = 0;
  for (let i = 0; i < n.length; i += 3) {
    id += n[i]; la += n[i + 1]; lo += n[i + 2];
    const k = { type: 'node', id, lat: la / 1e6, lon: lo / 1e6 }, tg = nt[ids.length];
    if (tg !== undefined) k.tags = t[tg];
    ids.push(id); nodes.push(k);
  }
  const ways = []; let wid = 0;
  for (const r of w) { wid += r[0]; ways.push({ type: 'way', id: wid, nodes: r.slice(2).map((i) => ids[i]), tags: t[r[1]] }); }
  return { nodes, ways };
}

// Decoded tile JSONs -> Overpass-JSON ({ elements }), nodes before ways, each id once.
export function naarOverpass(tegels) {
  const nodes = new Map(), ways = new Map();
  for (const tg of tegels) {
    const d = decodeer(tg);
    for (const k of d.nodes) nodes.set(k.id, k);
    for (const x of d.ways) ways.set(x.id, x);
  }
  return { elements: [...nodes.values(), ...ways.values()] };
}
