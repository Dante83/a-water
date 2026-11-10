//Node checks for ARestlessOcean.WaterTileDecoder at the WORLD'S EDGE (2026-11-10).
//A tile's span doubles with every LOD, so the last tile on an axis overhangs the world wherever
//its size is not a whole number of spans. What a-land wrote out there (dry texels, or no tile at
//all) is not an answer, and must not reach the field: it drew a block of known-dry ground out at
//sea, calm inside and with surf on its sides.
//Run: node tests/water-tiles/world-edge-test.mjs   (exit code 1 on any failure)
import fs from 'fs'; import vm from 'vm';
globalThis.ARestlessOcean = {};
vm.runInThisContext(fs.readFileSync(new URL('../../src/js/ocean-system/field/water-tile-decoder.js', import.meta.url), 'utf8'));
let fails = 0;
const check = (name, ok, info) => { console.log((ok?'PASS ':'FAIL ')+name+'  '+(info||'')); if(!ok) fails++; };
//A 6000 m world on 256 m tiles, 5 LODs; every LOD-4 tile indexed dry but (0, 0) (never fetched: null entry).
const director = {mapJson: {bounds: {size: [6000, 6000]},
  sources: {waterLevel: {tileSize: 256, maxLod: 4}},
  simulation: {maxDepth: 60, wetTiles: {4: [[0, 0]]}}}};
const D = new ARestlessOcean.WaterTileDecoder(director, null);
D.getTile = () => null;   //no network in this test
//the decode pass's placement: a tile's footprint, clipped to the cascade, then to the world
const placed = (cx, cz, half) => {
  const lod = D.lodForWidth(2 * half), out = [];
  for(const t of D.tilesIntersecting(cx - half, cz - half, cx + half, cz + half, lod)){
    const c = D.clipToWorld(Math.max(t.originX, cx - half), Math.min(t.originX + t.span, cx + half),
                            Math.max(t.originZ, cz - half), Math.min(t.originZ + t.span, cz + half));
    out.push({t, c});
  }
  return {lod, out};
};
{
  //the far cascade (8192 m wide) with the camera near the +X edge
  const {lod, out} = placed(5600, 3000, 4096);
  check('edge: the far cascade reads LOD 4 (4096 m tiles)', lod === 4 && D.spanForLod(lod) === 4096, 'lod '+lod);
  const over = out.filter(o => o.t.originX + o.t.span > 6000);
  check('edge: (control) its last tiles overhang the world by 2192 m', over.length > 0 && over.every(o => o.t.originX + o.t.span === 8192), over.length+' tiles');
  check('edge: ...and a-land indexes them dry, an authoritative answer inside the world', over.every(o => o.t.dry));
  const drawn = out.filter(o => o.c);
  check('edge: nothing is placed past the world on X', drawn.length > 0 && drawn.every(o => o.c.maxX <= 6000), 'max '+Math.max(...drawn.map(o => o.c.maxX)));
  check('edge: ...nor on Z', drawn.every(o => o.c.maxZ <= 6000), 'max '+Math.max(...drawn.map(o => o.c.maxZ)));
  check('edge: the part inside the world is all still placed', drawn.some(o => o.c.maxX === 6000 && o.c.minX === 4096), drawn.map(o => o.c.minX+'..'+o.c.maxX).join(' '));
}
{
  //a nearer cascade straddling the edge: its LOD-2 tile 5 runs 5120..6144, 144 m past the world
  const {lod, out} = placed(6500, 3000, 1024);
  check('straddling: a nearer cascade reads a finer LOD, whose last tile overhangs too', lod === 2 && out.some(o => o.t.originX + o.t.span === 6144), 'lod '+lod+', '+out.length+' tiles');
  check('straddling: ...and is placed only up to the edge', out.every(o => o.c && o.c.maxX === 6000 && o.c.minX === 5476), out.map(o => o.c ? o.c.minX+'..'+o.c.maxX : 'none').join(' '));
  //wholly past the edge: nothing to place
  check('at sea: a footprint wholly past the edge places nothing', D.clipToWorld(6100, 7000, 1000, 2000) === null);
}
{
  const U = new ARestlessOcean.WaterTileDecoder({mapJson: {sources: {waterLevel: {tileSize: 256, maxLod: 4}}, simulation: {}}}, null);
  const c = U.clipToWorld(100, 9000, 100, 9000);
  check('unknown world size: no clamp on the far side', c && c.maxX === 9000 && c.maxZ === 9000);
  check('negative side: clamped at the origin', U.clipToWorld(-500, 200, -500, 200).minX === 0 && U.clipToWorld(-500, -100, 0, 10) === null);
}
process.exit(fails?1:0);
