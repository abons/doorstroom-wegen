# doorstroom-wegen

The Dutch car road network from OpenStreetMap as static z14 tiles, for
[Doorstroom](https://abons.github.io/doorstroom/). Loading a city-sized bbox takes a handful of small
files from GitHub Pages instead of a 30–60 s Overpass query.

## URLs

- `https://abons.github.io/doorstroom-wegen/14/{x}/{y}.json` — one tile (slippy-map x/y at zoom 14)
- `https://abons.github.io/doorstroom-wegen/meta.json` — `{v, zoom, stand, gebouwd, tegels, bytes}`;
  `stand` is the OSM replication timestamp of the extract, `gebouwd` when the tiles were built

Pages serves them gzipped with `access-control-allow-origin: *`. A tile that does not exist (sea,
outside NL) is a 404: treat it as empty.

## Usage

```js
import { tegelsVoor, tegelUrl, naarOverpass } from './decode.mjs';
const json = await Promise.all(tegelsVoor([s, w, n, e]).map(([x, y]) =>
  fetch(tegelUrl(x, y)).then((r) => (r.ok ? r.json() : null))));
const osm = naarOverpass(json.filter(Boolean)); // { elements: [...nodes, ...ways] }, Overpass-JSON shape
```

`decode.mjs` exports `ZOOM`, `BASIS`, `tegelUrl(x, y, basis?)`, `tegelXY(lat, lon)`,
`tegelsVoor([s, w, n, e])`, `decodeer(tile)` and `naarOverpass(tiles)`.

## Format (v1)

```
{ v: 1,
  t:  [ {tags}, ... ],                 // tag dictionary, shared by nodes and ways
  n:  [ dId, dLat, dLon, ... ],        // nodes sorted by id; id, lat*1e6, lon*1e6 delta-encoded
  nt: { nodeIndex: tagIndex },         // the few nodes with tags (highway, crossing)
  w:  [ [dWayId, tagIndex, nodeIndex, ...], ... ] }   // ways sorted by id, id delta-encoded
```

Every tile is self-contained: it holds every way whose geometry passes through the tile, with all of
that way's nodes, so a way crossing a tile edge is complete in both tiles. Ways are
`highway=motorway|trunk|primary|secondary|tertiary` (and their `_link`s), `unclassified`,
`residential`, `living_street`. Way tags kept: `highway oneway junction lanes lanes:forward
lanes:backward maxspeed access motor_vehicle motorcar vehicle name ref area`.

## Build

`.github/workflows/tegels.yml` downloads the Geofabrik Netherlands extract, filters it with osmium,
runs `node tegels.mjs roads.opl out/` and deploys `out/` to Pages. It refuses to publish fewer than
15,000 tiles. Tiles are never committed. Locally: `node test.mjs` (no dependencies).

Schedule: Mondays 03:17 UTC, on every push to `main`, and by hand (`gh workflow run tegels`).
GitHub disables scheduled workflows after 60 days without repository activity; a push (or
re-enabling the workflow in the Actions tab) brings it back.

## Licence

Data © OpenStreetMap contributors, available under the
[Open Database License 1.0](https://www.openstreetmap.org/copyright). The published tiles are a
derivative database under the same licence.
