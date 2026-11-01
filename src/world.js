// The map: a forest with a clearing. You start owning 2×2 chunks of 4×4 tiles (8×8) in front of the house; every other
// tile is a tree until the chunk holding it is bought. Trees are not stored: a tile is a tree when it isn't cleared.
import { CONFIG } from './config.js';
import { makeRng } from './rng.js';

export const CHUNK = CONFIG.world.chunk;
export const FARM_ORIGIN = { x: 26, y: 22 };                       // tile of chunk (0,0)'s top-left
export const CHUNK_RANGE = { cxMin: -5, cxMax: 6, cyMin: 0, cyMax: 5 };
export const START_CHUNKS = ['0,0', '1,0', '0,1', '1,1'];

// Buildings: footprint = the solid tiles. The house sprite is drawn taller than its footprint (roof rises above it);
// its bottom row (the porch and steps) is walkable, so the door tile is in front of the walls.
export const BUILDINGS = {
  house: { x: 25, y: 14, w: 6, h: 3, door: { x: 28, y: 17 } },
  rackHoe: { x: 26, y: 20, w: 1, h: 1 },    // one tool per rack
  rackCan: { x: 27, y: 20, w: 1, h: 1 },
  seedrack: { x: 30, y: 20, w: 1, h: 1 },   // drying rack: produce → seeds
  chest: { x: 31, y: 17, w: 1, h: 1 },      // storage chest beside the porch
  well: { x: 34, y: 16, w: 1, h: 1 },
  sign: { x: 34, y: 26, w: 1, h: 1 },       // delivery signpost
  crate: { x: 34, y: 27, w: 1, h: 1 },      // delivery crate at the end of the track that leaves the clearing
  roadsign: { x: 39, y: 26, w: 1, h: 1 },   // where the track leaves: the sign to the market
  board: { x: 31, y: 24, w: 1, h: 1 },      // the loading bay's board: what waits for the truck tonight
};
// The loading bay (Build 73): the gravel beside the start of the track. Delivery crates standing in it are what the truck
// takes; a crate anywhere else is just a box. The porch crate counts wherever it is.
export const BAY = { x0: 30, y0: 25, x1: 33, y1: 28 };
export const inBay = (x, y) => x >= BAY.x0 && x <= BAY.x1 && y >= BAY.y0 && y <= BAY.y1;
export const CRATE_STACK = { x: BAY.x0, y: BAY.y0 };   // the corner of the bay where the empty crates are stacked
// Objects you can pick up and put down elsewhere (their live positions are in state.objects).
export const MOVABLE = ['rackHoe', 'rackCan', 'seedrack', 'bench', 'compost'];   // the bench and the compost bin exist only after they are delivered
// The yard: a cleared rectangle holding the house, racks and well (the farm chunks clear their own tiles).
export const YARD = { x0: 24, y0: 14, x1: 35, y1: 21 };   // row 21 joins the yard to the first plots
// The cart track: the dirt road the delivery cart comes up at night, from the crate out into the forest. Two rows: the
// lower row sits under the canopy of the trees below it, so the upper row stays visible. Track tiles are cleared,
// walkable (it is a road) and never tilled. It dead-ends in the trees for now; it is where the outside world arrives.
export const TRACK = [33, 34, 35, 36, 37, 38, 39].flatMap(x => [{ x, y: 27 }, { x, y: 28 }]);
export const isTrack = (x, y) => TRACK.some(t => t.x === x && t.y === y);
export const PLAYER_START = { x: 28.5, y: 19.2 };

export function createWorld() {
  const { w, h } = CONFIG.world;
  const tiles = new Array(w * h);
  const r = makeRng(777);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tiles[y * w + x] = { t: 'grass', tilled: false, wetUntil: 0, crop: null, obj: null, fert: null, v: r.int(0, 2), jx: r.int(-3, 3), jy: r.int(-2, 2) };
  for (const [name, b] of Object.entries(BUILDINGS)) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) tiles[y * w + x].t = name;
  for (const t of TRACK) tiles[t.y * w + t.x].track = true;
  return { w, h, tiles, chunks: [...START_CHUNKS] };
}

export const inBounds = (world, x, y) => x >= 0 && y >= 0 && x < world.w && y < world.h;
export const tileAt = (world, x, y) => inBounds(world, x, y) ? world.tiles[y * world.w + x] : null;
export const chunkKey = (cx, cy) => `${cx},${cy}`;
export const chunkOrigin = (cx, cy) => ({ x: FARM_ORIGIN.x + cx * CHUNK, y: FARM_ORIGIN.y + cy * CHUNK });
export function chunkOfTile(x, y) {
  return { cx: Math.floor((x - FARM_ORIGIN.x) / CHUNK), cy: Math.floor((y - FARM_ORIGIN.y) / CHUNK) };
}
export const ownsChunk = (world, cx, cy) => world.chunks.includes(chunkKey(cx, cy));
export function isOwnedFarmland(world, x, y) {
  const t = tileAt(world, x, y);
  if (!t || t.t !== 'grass') return false;
  const { cx, cy } = chunkOfTile(x, y);
  return ownsChunk(world, cx, cy);
}
// A tile is clear of trees if it is inside an owned chunk, on the track, or in the yard. The trees stand right at the edge
// of what you own, so a plot to claim starts at the tree line and what you see is what you get.
export function isCleared(world, x, y) {
  if (x >= YARD.x0 && x <= YARD.x1 && y >= YARD.y0 && y <= YARD.y1) return true;
  if (isTrack(x, y)) return true;
  const { cx, cy } = chunkOfTile(x, y);
  return ownsChunk(world, cx, cy);
}
export const isTree = (world, x, y) => { const t = tileAt(world, x, y); return !!t && t.t === 'grass' && !isCleared(world, x, y); };
export function chunkInRange(cx, cy) {
  return cx >= CHUNK_RANGE.cxMin && cx <= CHUNK_RANGE.cxMax && cy >= CHUNK_RANGE.cyMin && cy <= CHUNK_RANGE.cyMax;
}
export function buyableChunks(world) {
  const out = [], seen = new Set();
  for (const key of world.chunks) {
    const [cx, cy] = key.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy, k = chunkKey(nx, ny);
      if (seen.has(k) || !chunkInRange(nx, ny) || ownsChunk(world, nx, ny)) continue;
      seen.add(k); out.push({ cx: nx, cy: ny });
    }
  }
  return out;
}
// The house blocks by its drawn walls, not by tiles: from the eave line down to the foundation's bottom edge, the
// width of the walls (sprite px 4–92 of 96). The steps and porch below are open ground.
export const HOUSE_WALLS = (() => { const H = BUILDINGS.house, bottom = H.y + H.h + 1; return { x0: H.x + 4 / 16, x1: H.x + 92 / 16, y0: bottom - 72 / 16, y1: bottom - 16 / 16 }; })();
export const isSolid = (world, x, y) => { const t = tileAt(world, x, y); return !t || (t.t !== 'grass' && t.t !== 'house') || !isCleared(world, x, y); };
// Can a point (world tile units, fractional) be stood on?
export const isBlockedAt = (world, px, py) => isSolid(world, Math.floor(px), Math.floor(py)) || (px >= HOUSE_WALLS.x0 && px < HOUSE_WALLS.x1 && py >= HOUSE_WALLS.y0 && py < HOUSE_WALLS.y1);
export const buildingAt = (world, x, y) => { const t = tileAt(world, x, y); return t && (BUILDINGS[t.t] || MOVABLE.includes(t.t)) ? t.t : null; };
