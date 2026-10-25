// node test.mjs — tiles test/sample.opl (Amersfoort centre) and checks the round trip.
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bouw, leesOpl } from './tegels.mjs';
import { tegelsVoor, decodeer, naarOverpass, ZOOM } from './decode.mjs';

const BBOX = [52.150, 5.380, 52.160, 5.395];
const NET = 'E:/werk/androidApps/doorstroom/web/net.js';
let fout = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fout++; };

const uit = mkdtempSync(join(tmpdir(), 'tegels-'));
try {
  const meta = await bouw('test/sample.opl', uit, null);
  ok(meta.tegels > 1, `${meta.tegels} tiles written`);
  const bron = await leesOpl('test/sample.opl');
  const src = new Map(bron.ways.map((w) => [w.id, w]));

  const lees = (x, y) => { const p = join(uit, String(ZOOM), String(x), y + '.json'); return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null; };
  const alle = [];
  for (const x of readdirSync(join(uit, String(ZOOM)))) for (const f of readdirSync(join(uit, String(ZOOM), x))) alle.push(lees(x, f.replace('.json', '')));

  // 1. ids and coordinates round-trip; 2. every way is complete in every tile it is in.
  let wegen = 0, slecht = 0, maxd = 0;
  const per = new Map();
  for (const tg of alle) {
    const d = decodeer(tg), N = new Map(d.nodes.map((k) => [k.id, k]));
    for (const w of d.ways) {
      wegen++;
      per.set(w.id, (per.get(w.id) ?? 0) + 1);
      const s = src.get(w.id);
      if (!s || s.ids.length !== w.nodes.length) { slecht++; continue; }
      w.nodes.forEach((id, i) => {
        const k = N.get(id);
        if (!k || id !== s.ids[i]) { slecht++; return; }
        maxd = Math.max(maxd, Math.abs(k.lat - s.la[i] / 1e6), Math.abs(k.lon - s.lo[i] / 1e6));
      });
    }
  }
  ok(slecht === 0 && maxd <= 1e-6, `${wegen} way copies complete, ids exact, max coord error ${maxd.toExponential(1)}`);
  const multi = [...per.values()].filter((c) => c > 1).length;
  ok(multi > 0, `${multi} ways appear in 2+ tiles, each complete`);
  ok([...src.keys()].every((id) => per.has(id)), 'every source way is in some tile');

  // 3. bbox -> tiles -> Overpass JSON -> doorstroom importOsm
  const osm = naarOverpass(tegelsVoor(BBOX).map(([x, y]) => lees(x, y)).filter(Boolean));
  ok(osm.elements.some((e) => e.type === 'way'), `${osm.elements.length} elements for the bbox`);
  if (existsSync(NET)) {
    const { importOsm } = await import(pathToFileURL(NET).href);
    const a = Object.keys(importOsm(osm, BBOX).edges).length;
    const vol = { elements: [...bron.ways.flatMap((w) => Array.from(w.ids, (id, i) => ({ type: 'node', id, lat: w.la[i] / 1e6, lon: w.lo[i] / 1e6, tags: bron.nodeTags.get(id) }))),
      ...bron.ways.map((w) => ({ type: 'way', id: w.id, nodes: [...w.ids], tags: w.tags }))] };
    const b = Object.keys(importOsm(vol, BBOX).edges).length;
    ok(a > 0 && a === b, `importOsm: ${a} edges from tiles, ${b} from the untiled sample`);
  } else console.log('skip importOsm check (doorstroom not checked out)');
} finally { rmSync(uit, { recursive: true, force: true }); }
if (fout) { console.log(`${fout} failed`); process.exit(1); }
console.log('all ok');
