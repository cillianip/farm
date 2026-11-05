// Code-drawn tiles, trees, the house, objects and the player. Everything is cached as a canvas at 1 pixel = 1 unit.
import { PAL, pixelDrawer, makeCanvas } from './palette.js';
const PAL0 = PAL;   // the chest tiers recolour a copy
import { makeRng } from '../rng.js';
import { drawText, textWidth } from './font.js';

const cache = new Map();
export const PLAYER_H = 22;
function sprite(key, w, h, draw, outline = null) {
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(w, h);
  draw(pixelDrawer(ctx), ctx);
  if (outline && ctx.getImageData) addOutline(ctx, w, h, outline);
  cache.set(key, c);
  return c;
}
// 1px outline around every opaque region (reads pixels back, browser only)
function addOutline(ctx, w, h, color) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  const edges = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x + 1, y) || solid(x - 1, y) || solid(x, y + 1) || solid(x, y - 1))) edges.push([x, y]);
  ctx.fillStyle = color; for (const [x, y] of edges) ctx.fillRect(x, y, 1, 1);
}

// ---------- ground ----------
export function grassTile(variant) {
  return sprite(`grass${variant}`, 16, 16, P => {
    P.rect(0, 0, 16, 16, PAL.grass);
    const r = makeRng(100 + variant);
    for (let i = 0; i < 14; i++) P.px(r.int(0, 15), r.int(0, 15), r.chance(0.5) ? PAL.grass2 : PAL.grass3);
    const tufts = variant < 5 ? 2 : 1;
    for (let i = 0; i < tufts; i++) { const x = r.int(1, 13), y = r.int(2, 14); P.px(x, y, PAL.grassDark); P.px(x + 1, y, PAL.grassDark); P.px(x, y - 1, PAL.grass2); P.px(x + 2, y - 1, PAL.grass2); }
    if (variant === 6) { const x = r.int(2, 13), y = r.int(2, 13); P.px(x, y, '#f7f1c9'); P.px(x, y + 1, PAL.grassDark); }
    if (variant === 7) { const x = r.int(2, 13), y = r.int(2, 13); P.px(x, y, '#f6c453'); P.px(x, y + 1, PAL.grassDark); }
  });
}
// level: 0 dry, 1 moist, 2 wet, 3 soggy (puddles)
const SOIL = [['#b5834f', '#946538'], ['#9c6b3f', '#7e5430'], ['#7a4f2c', '#5e3b20'], ['#5f3d22', '#452a16']];
export function soilTile(level, variant) {
  return sprite(`soil${level}${variant}`, 16, 16, P => {
    const [base, dark] = SOIL[level];
    const light = ['#c99a66', '#b07d4d', '#8e5f38', '#6f4a2b'][level];
    P.rect(0, 0, 16, 16, base);
    const r = makeRng(200 + variant);
    for (let i = 0; i < 7; i++) { const x = r.int(0, 14), y = r.int(1, 15); P.rect(x, y, 2, 1, dark); if (r.chance(0.5)) P.px(x + 1, y - 1, dark); }   // clods
    for (let i = 0; i < 6; i++) P.px(r.int(0, 15), r.int(0, 15), light);
    for (let i = 0; i < 3; i++) P.px(r.int(0, 15), r.int(0, 15), dark);
    if (level === 3) { for (let i = 0; i < 3; i++) { const x = r.int(2, 11), y = r.int(3, 13); P.rect(x, y, 3, 1, '#4f7fb0'); P.rect(x + 1, y - 1, 2, 1, '#6f9fd0'); } }
  });
}
// A rack holding one tool (hoe or can); `present` false draws it empty.
export function rackSprite(tool, present) {
  return sprite(`rack${tool}${present}`, 16, 24, P => {
    P.rect(3, 5, 2, 19, PAL.woodDark); P.rect(11, 5, 2, 19, PAL.woodDark);
    P.rect(2, 5, 12, 2, PAL.wood); P.rect(2, 5, 12, 1, PAL.woodLight); P.rect(2, 14, 12, 2, PAL.wood); P.rect(2, 14, 12, 1, PAL.woodLight);
    P.px(6, 8, PAL.metalDark); P.px(9, 8, PAL.metalDark);   // hooks
    if (!present) return;
    if (tool === 'hoe') { for (let i = 0; i < 14; i++) P.px(8, 9 + i, i % 5 === 2 ? PAL.woodDark : PAL.wood); P.rect(6, 7, 5, 2, PAL.metal); P.rect(6, 9, 5, 1, PAL.metalDark); P.rect(7, 6, 3, 1, PAL.metalLight); }
    else { P.rect(5, 9, 7, 6, PAL.metal); P.rect(5, 14, 7, 1, PAL.metalDark); P.rect(6, 8, 5, 1, PAL.metalDark); P.px(6, 10, PAL.metalLight); P.px(6, 11, PAL.metalLight); P.line(12, 11, 14, 8, PAL.metalDark); P.px(14, 7, PAL.metal); P.rect(7, 7, 3, 1, PAL.metalDark); P.px(7, 6, PAL.metalDark); P.px(9, 6, PAL.metalDark); }
  }, 'rgba(40,25,15,0.9)');
}
export function wellSprite(frame = 0) {
  return sprite(`well${frame}`, 24, 32, P => {
    const stone = '#8d8a80', stoneDark = '#6c6962', stoneLight = '#a6a39a';
    // roof
    for (let y = 0; y < 7; y++) P.rect(11 - y * 1.5 | 0, 2 + y, 2 + y * 3, 1, y % 3 === 2 ? '#8e3a30' : '#b4503f');
    P.rect(1, 9, 22, 1, '#8e3a30');
    P.rect(4, 10, 2, 12, PAL.woodDark); P.rect(18, 10, 2, 12, PAL.woodDark);
    // crank + rope + bucket
    P.rect(6, 12, 12, 2, PAL.wood); P.rect(20, 11, 2, 4, PAL.woodDark);
    const drop = frame ? 3 : 0; P.rect(11, 14, 1, 4 + drop, '#c9b07c'); P.rect(9, 18 + drop, 5, 3, PAL.metalDark); P.rect(10, 19 + drop, 3, 1, PAL.metal);
    // stone ring
    for (let y = 20; y < 32; y++) P.rect(2, y, 20, 1, y % 3 === 0 ? stoneDark : stone);
    P.rect(2, 20, 20, 1, stoneLight); P.rect(6, 22, 12, 2, '#3f72a8'); P.rect(7, 22, 4, 1, '#6fa3d8');
    for (let x = 3; x < 22; x += 5) { P.px(x, 25, stoneDark); P.px(x + 2, 29, stoneLight); }
  }, 'rgba(40,25,15,0.9)');
}
// Delivery crate: a slatted wooden box by the track. level 0 empty, 1 some produce showing, 2 full (lid propped on top).
// Delivery crate (20×18): an open-topped slatted crate with straw inside. level 0 empty, 1 some produce, 2 heaped.
export function crateSprite(level = 0, delivery = false) {
  return sprite(`crate${level}${delivery ? 'd' : ''}`, 20, 18, P => {
    P.rect(2, 7, 16, 10, PAL.wood);
    if (delivery) { P.rect(2, 12, 16, 2, '#c8553d'); P.px(9, 12, '#f5e6c3'); P.px(10, 13, '#f5e6c3'); }   // a red band and a chalk mark: the truck's
    for (const y of [10, 14]) { P.rect(2, y, 16, 1, PAL.woodDark); P.rect(2, y - 1, 16, 1, PAL.woodLight); }
    P.rect(2, 7, 1, 10, PAL.woodDark); P.rect(17, 7, 1, 10, PAL.woodDark); P.rect(2, 17, 16, 1, PAL.woodDark);
    P.rect(3, 8, 1, 9, PAL.metalDark); P.rect(16, 8, 1, 9, PAL.metalDark); P.px(3, 9, PAL.metal); P.px(16, 15, PAL.metal);
    P.px(9, 12, PAL.woodDark); P.px(10, 12, PAL.woodDark);
    P.rect(1, 4, 18, 3, PAL.woodLight); P.rect(1, 6, 18, 1, PAL.wood); P.rect(1, 4, 18, 1, '#c99a66');     // rim
    P.rect(3, 2, 14, 3, '#3a2412'); P.rect(3, 2, 14, 1, '#2a1a0c');                                        // inside
    for (let x = 4; x < 16; x += 2) P.px(x + (x % 4 === 0 ? 1 : 0), 3 + (x % 3 === 0 ? 1 : 0), '#d9b35a');  // straw
    P.px(17, 7, '#e9e2c9'); P.rect(16, 8, 3, 3, '#f5efd8'); P.px(17, 9, PAL.gold);                          // tag
  }, 'rgba(40,25,15,0.9)');
}
// Signpost by the crate: a wide board that actually reads DELIVERY, on a post.
// flag: a little pennant on the post when the catalogue has something new you can afford.
export function signSprite(flag = false) {
  return sprite('sign' + (flag ? 'F' : ''), 36, 24, (P, ctx) => {
    P.rect(17, 11, 2, 13, PAL.woodDark); P.px(17, 13, PAL.wood);
    P.rect(1, 1, 34, 11, PAL.woodLight); P.rect(1, 1, 34, 1, '#c99a66'); P.rect(1, 11, 34, 1, PAL.woodDark); P.rect(1, 1, 1, 11, PAL.wood); P.rect(34, 1, 1, 11, PAL.woodDark);
    drawText(ctx, 'DELIVERY', 3, 4, '#3b2314', 1);
    P.px(2, 2, PAL.metalDark); P.px(33, 2, PAL.metalDark); P.px(2, 10, PAL.metalDark); P.px(33, 10, PAL.metalDark);
    if (flag) { P.rect(19, 13, 6, 1, '#f6c453'); P.rect(19, 14, 5, 1, '#f6c453'); P.rect(19, 15, 4, 1, '#e9a93a'); P.rect(19, 16, 2, 1, '#e9a93a'); P.px(19, 17, '#b57a1f'); }
  }, 'rgba(40,25,15,0.9)');
}
// Dirt spilling from a tilled bed onto the grass next to it: nobody tills a perfectly straight edge. One strip per
// side, a few variants, drawn over the grass tile that touches the bed. side: 0 top (bed above), 1 right, 2 bottom, 3 left.
export function soilEdge(side, variant, level = 0) {
  return sprite(`edge${side}v${variant}l${level}`, 16, 16, P => {
    const r = makeRng(900 + variant * 4 + side);
    const [base, dark] = SOIL[level];
    const put = (i, d, c) => { if (side === 0) P.px(i, d, c); else if (side === 2) P.px(i, 15 - d, c); else if (side === 3) P.px(d, i, c); else P.px(15 - d, i, c); };
    for (let i = 0; i < 16; i++) {
      const depth = r.chance(0.3) ? 0 : r.chance(0.65) ? 1 : 2;   // a ragged lip, one or two pixels onto the grass
      for (let d = 0; d < depth; d++) put(i, d, d === depth - 1 && r.chance(0.4) ? dark : base);
    }
    put(r.int(1, 14), 2, dark);   // one loose clod a little further out
  });
}
// The storage chest (18×16): a wooden box with iron bands and a clasp. open: the lid lifted.
// The chest by the porch fills its 18-wide sprite; a field chest (`narrow`) is a pixel in on each side, so two side by side stay two.
export function chestSprite(open = false, narrow = false, level = 0) {
  return sprite(`chest${open ? 'o' : 'c'}${narrow ? 'n' : ''}${level || ''}`, 18, 16, P => {
    const L = narrow ? 2 : 1, R = narrow ? 15 : 16, W = R - L + 1, bL = narrow ? 5 : 4, bR = narrow ? 12 : 13;
    const PAL = level === 2 ? { ...PAL0, metalDark: '#b57a1f', metal: PAL0.gold, wood: '#6b4423', woodDark: '#4a2f16', woodLight: '#8c5a2b' } : level === 1 ? { ...PAL0, metalDark: PAL0.metalDark, metal: PAL0.metalLight, wood: '#7a4e25', woodDark: '#5a381a', woodLight: '#9c6a36' } : PAL0;   // bigger chests: darker wood, brighter bands, gold on the biggest
    P.rect(L, 7, W, 8, PAL.wood); P.rect(L, 14, W, 1, PAL.woodDark); P.rect(L, 7, 1, 8, PAL.woodDark); P.rect(R, 7, 1, 8, PAL.woodDark);   // body
    P.rect(L + 1, 11, W - 2, 1, PAL.woodDark); P.rect(L + 1, 8, W - 2, 1, PAL.woodLight);                                                 // boards
    P.rect(bL, 7, 1, 8, PAL.metalDark); P.rect(bR, 7, 1, 8, PAL.metalDark); P.px(bL, 9, PAL.metal); P.px(bR, 13, PAL.metal);          // iron bands
    if (!open) {
      P.rect(L, 3, W, 4, PAL.woodLight); P.rect(L + 1, 2, W - 2, 1, PAL.woodLight); P.rect(L + 2, 2, W - 4, 1, '#c99a66'); P.rect(L, 6, W, 1, PAL.woodDark);   // domed lid
      P.px(L, 3, PAL.wood); P.px(R, 3, PAL.wood); P.rect(bL, 2, 1, 5, PAL.metalDark); P.rect(bR, 2, 1, 5, PAL.metalDark);
      P.rect(8, 5, 2, 3, PAL.gold); P.px(8, 7, '#b57a1f'); P.px(9, 5, '#fff1b8');   // brass clasp
    } else {
      P.rect(L + 1, 5, W - 2, 3, '#2a1a0c'); P.rect(L + 1, 5, W - 2, 1, '#1d1208'); P.rect(L, 5, 1, 3, PAL.woodDark); P.rect(R, 5, 1, 3, PAL.woodDark);   // the dark inside, walls up to the hinge
      P.rect(L, 1, W, 4, PAL.woodLight); P.rect(L + 1, 1, W - 2, 1, '#c99a66'); P.rect(L, 4, W, 1, PAL.woodDark); P.rect(bL, 1, 1, 4, PAL.metalDark); P.rect(bR, 1, 1, 4, PAL.metalDark);   // lid tipped back, sitting on the hinge
      P.rect(8, 9, 2, 2, PAL.gold);
    }
  }, 'rgba(40,25,15,0.95)');
}
// Worn ground under a station: a dirt oval with a darker grass rim, so legs look planted rather than floating.
export function groundPatch(w = 20, h = 10, variant = 0) {
  return sprite(`patch${w}x${h}v${variant}`, w, h, P => {
    const r = makeRng(800 + variant), cx = w / 2 - 0.5, cy = h / 2 - 0.5, rw = w / 2 - 0.5, rh = h / 2 - 0.5;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = ((x - cx) / (rw + 0.5)) ** 2 + ((y - cy) / (rh + 0.5)) ** 2;
      if (d > 1) continue;
      const rim = d > 0.6, upper = y < cy;
      P.px(x, y, rim ? (upper ? PAL.soilDark : '#a88a5a') : (r.chance(0.15) ? PAL.pathStone : PAL.path));   // dark rim above = the dent, dusty lip below
    }
    for (let i = 0; i < 2; i++) P.px(r.int(1, w - 2), r.int(1, h - 2), PAL.pathStone);
  });
}
// Breeding bench (16×28): a potting table with two clay pots for the parents and a glass cloche in the middle.
// state 0 empty, 1 parents set (pots filled), 2 breeding (a glowing sprout under the glass).
export function benchSprite(state = 0, frame = 0) {
  return sprite(`bench${state}${frame}`, 16, 28, P => {
    P.rect(2, 14, 2, 14, PAL.woodDark); P.rect(12, 14, 2, 14, PAL.woodDark);        // legs
    P.rect(0, 12, 16, 3, PAL.wood); P.rect(0, 12, 16, 1, PAL.woodLight);           // table top
    P.rect(1, 20, 14, 2, PAL.wood); P.rect(1, 20, 14, 1, PAL.woodLight);           // shelf
    P.rect(3, 22, 3, 2, '#c9b07c'); P.rect(10, 23, 4, 1, '#8c5a2b');                // bits on the shelf
    // pots
    for (const x of [1, 12]) { P.rect(x, 9, 3, 3, '#b5603a'); P.rect(x, 8, 3, 1, '#d07a4a'); P.px(x + 1, 11, '#8e4a2c'); if (state >= 1) { P.px(x + 1, 7, PAL.grassDark); P.px(x, 6, '#5fa14a'); P.px(x + 2, 6, '#5fa14a'); } }
    // cloche
    P.disc(8, 7, 4, PAL.glass); P.disc(8, 7, 3, '#dff6fb'); P.rect(5, 11, 7, 1, PAL.metalLight); P.px(8, 2, PAL.metalDark); P.px(6, 5, '#ffffff');
    if (state === 2) { P.rect(8, 8, 1, 3, '#2d5a1f'); P.px(7, 8, frame ? '#8fd36a' : '#5fa14a'); P.px(9, 7, frame ? '#f6c453' : '#8fd36a'); P.px(8, 6, frame ? '#fff1b8' : '#f6c453'); }
    else P.rect(7, 10, 3, 1, '#5e4a2a');
  }, 'rgba(40,25,15,0.9)');
}
// The delivery cart (28×20): a wooden wagon with two spoked wheels and a lantern, drawn facing left (it backs out).
export function cartSprite(frame = 0) {
  return sprite(`cart${frame}`, 28, 20, P => {
    P.rect(3, 6, 22, 8, PAL.wood); P.rect(3, 6, 22, 1, PAL.woodLight); P.rect(3, 13, 22, 1, PAL.woodDark); P.rect(3, 6, 1, 8, PAL.woodDark); P.rect(24, 6, 1, 8, PAL.woodDark);   // bed
    P.rect(5, 9, 18, 1, PAL.woodDark); P.rect(9, 6, 1, 8, PAL.woodDark); P.rect(18, 6, 1, 8, PAL.woodDark);   // boards
    P.rect(4, 3, 20, 3, '#c9b07c'); P.rect(4, 3, 20, 1, '#e4d3a0'); P.rect(6, 5, 16, 1, '#a88a5a');           // canvas cover
    P.rect(0, 10, 4, 1, PAL.woodDark); P.px(0, 9, PAL.woodDark);                                                 // handle shaft
    P.rect(25, 4, 2, 4, PAL.metalDark); P.px(25, 5, PAL.gold); P.px(26, 5, '#fff1b8');                           // lantern
    for (const wx of [8, 20]) { const o = frame ? 1 : 0;                                                       // wheels
      P.disc(wx, 15, 4, PAL.woodDark); P.disc(wx, 15, 3, PAL.wood); P.px(wx, 15, PAL.metalDark);
      P.px(wx - 2 + o, 13, PAL.woodDark); P.px(wx + 2 - o, 17, PAL.woodDark); P.px(wx + 2 - o, 13, PAL.woodDark); P.px(wx - 2 + o, 17, PAL.woodDark); P.px(wx, 12, PAL.metalDark); P.px(wx, 18, PAL.metalDark); P.px(wx - 3, 15, PAL.metalDark); P.px(wx + 3, 15, PAL.metalDark); }
  }, 'rgba(40,25,15,0.9)');
}
// The loading bay's gravel (16×16): packed grey-brown with a painted edge on the sides given by mask (1 N, 2 E, 4 S, 8 W).
export function bayTile(mask = 0, variant = 0) {
  return sprite(`bay2:${mask}:${variant}`, 16, 16, P => {
    P.rect(0, 0, 16, 16, '#a39a86'); const r = makeRng(1700 + variant);
    for (let i = 0; i < 18; i++) P.px(r.int(0, 15), r.int(0, 15), r.chance(0.5) ? '#8f8674' : '#b5ac98');
    // Build 87: each tile is a marked crate spot, painted corners worn at the edges, and now and then an oil spot
    const mark = 'rgba(232,210,138,0.55)'; for (const [x, y, dx, dy] of [[2, 2, 1, 1], [13, 2, -1, 1], [2, 13, 1, -1], [13, 13, -1, -1]]) { P.px(x, y, mark); P.px(x + dx, y, mark); P.px(x, y + dy, mark); }
    if (variant % 5 === 3) { P.rect(6, 8, 3, 2, 'rgba(40,36,30,0.35)'); P.px(9, 9, 'rgba(40,36,30,0.25)'); P.px(7, 7, 'rgba(40,36,30,0.2)'); }
    const paint = '#e8d28a'; if (mask & 1) P.rect(0, 0, 16, 1, paint); if (mask & 4) P.rect(0, 15, 16, 1, paint); if (mask & 8) P.rect(0, 0, 1, 16, paint); if (mask & 2) P.rect(15, 0, 1, 16, paint);
  });
}
// The bay's board (36×24): a blank board on a post; the game writes tonight's figures on it.
export function boardSprite() {
  return sprite('bayboard', 36, 24, P => {
    P.rect(17, 12, 2, 12, PAL.woodDark); P.px(17, 14, PAL.wood);
    P.rect(1, 0, 34, 13, PAL.woodDark); P.rect(2, 1, 32, 11, '#2f3a2a'); P.rect(2, 1, 32, 1, '#4a5a44');   // a chalkboard in a frame
    P.px(2, 1, PAL.metalDark); P.px(33, 1, PAL.metalDark); P.px(2, 11, PAL.metalDark); P.px(33, 11, PAL.metalDark);
  }, 'rgba(40,25,15,0.9)');
}
// The truck parked in the bay (32×32, two tiles wide, facing the track): cab on the right, a flatbed with low slatted sides on
// the left; the game sets the loaded crates on the bed.
export function parkedTruckSprite() {
  return sprite('parkedTruck', 48, 32, P => {
    P.rect(1, 9, 32, 14, PAL.woodDark); P.rect(2, 10, 30, 12, PAL.wood); for (let x = 5; x < 32; x += 5) P.rect(x, 10, 1, 12, PAL.woodDark); P.rect(2, 10, 30, 1, PAL.woodLight); P.rect(2, 21, 30, 1, PAL.woodDark);   // the bed: long, low slatted sides
    P.rect(33, 4, 14, 19, '#4f8fcf'); P.rect(33, 4, 14, 1, '#7fb4e6'); P.rect(34, 6, 11, 7, PAL.window); P.rect(34, 6, 11, 1, '#dff3ff'); P.rect(33, 22, 14, 1, '#3f72a8'); P.rect(45, 15, 2, 3, PAL.gold); P.rect(33, 14, 14, 1, '#3f72a8');   // the cab, windscreen, a lamp
    P.rect(0, 23, 48, 3, PAL.metalDark); P.rect(0, 25, 48, 1, '#2a2a2a');                                                                                                           // the chassis
    for (const wx of [8, 20, 40]) { P.disc(wx, 28, 4, '#2a2a2a'); P.disc(wx, 28, 3, '#444'); P.disc(wx, 28, 1, PAL.metalLight); }                                                     // three wheels a side
    P.rect(1, 30, 46, 2, 'rgba(30,20,10,0.25)');
  }, 'rgba(40,25,15,0.9)');
}
// The truck (28×20): a cab, a flatbed with slatted sides, two wheels; frames roll the wheels.
export function truckSprite(frame = 0) {
  return sprite(`truck${frame}`, 28, 20, P => {
    P.rect(2, 7, 18, 7, PAL.wood); P.rect(2, 7, 18, 1, PAL.woodLight); P.rect(2, 13, 18, 1, PAL.woodDark); for (let x = 4; x < 20; x += 4) P.rect(x, 8, 1, 5, PAL.woodDark);   // the flatbed and its slats
    P.rect(20, 4, 7, 10, '#4f8fcf'); P.rect(20, 4, 7, 1, '#7fb4e6'); P.rect(21, 5, 5, 4, PAL.window); P.rect(26, 11, 1, 2, PAL.gold); P.rect(20, 13, 7, 1, '#3f72a8');        // the cab, its window, a lamp
    P.rect(1, 13, 26, 2, PAL.metalDark);                                                                                                                                   // the chassis
    for (const wx of [7, 22]) { const o = frame ? 1 : 0; P.disc(wx, 16, 3, '#2a2a2a'); P.disc(wx, 16, 2, '#444'); P.px(wx + o - 1, 16, PAL.metalLight); P.px(wx, 15 + o, PAL.metalDark); }   // wheels
  }, 'rgba(40,25,15,0.9)');
}
// A parcel left in the crate: brown paper, string, a label.
export function parcelSprite() {
  return sprite('parcel', 12, 10, P => {
    P.rect(1, 2, 10, 8, '#c9a46b'); P.rect(1, 2, 10, 1, '#dfc08a'); P.rect(1, 9, 10, 1, '#9c7a45'); P.rect(10, 2, 1, 8, '#9c7a45');
    P.rect(1, 5, 10, 1, '#8a5a2b'); P.rect(5, 2, 1, 8, '#8a5a2b'); P.rect(6, 3, 3, 2, '#f5efd8'); P.px(7, 4, PAL.gold);
  }, 'rgba(40,25,15,0.9)');
}
// Pixel cursors drawn on the canvas (the OS cursor is hidden over the game): a plain arrow and a pointing hand.
export function cursorSprite(kind) {
  return sprite(`cursor${kind}`, 12, 14, P => {
    const w = '#ffffff', k = '#2a1f14';
    if (kind === 'arrow') {
      for (let y = 0; y < 11; y++) P.rect(0, y, Math.min(y + 1, 8), 1, w);
      P.rect(0, 0, 1, 12, k); for (let y = 0; y < 8; y++) P.px(y + 1, y, k);
      P.rect(1, 11, 2, 1, k); P.rect(3, 8, 1, 3, k); P.rect(4, 10, 2, 3, w); P.rect(3, 13, 2, 1, k); P.rect(6, 10, 1, 3, k); P.rect(4, 8, 4, 1, k); P.rect(8, 7, 1, 1, k);
    } else {   // hand
      P.rect(4, 0, 3, 8, w); P.rect(7, 3, 2, 6, w); P.rect(9, 4, 2, 5, w); P.rect(2, 5, 2, 5, w); P.rect(4, 8, 7, 5, w);
      P.rect(4, 0, 1, 8, k); P.rect(6, 0, 1, 3, k); P.rect(5, 0, 1, 1, k); P.rect(7, 2, 2, 1, k); P.rect(9, 3, 2, 1, k); P.rect(11, 4, 1, 5, k);
      P.rect(2, 5, 1, 5, k); P.rect(3, 4, 1, 1, k); P.rect(3, 10, 1, 2, k); P.rect(4, 12, 7, 1, k); P.rect(10, 9, 1, 3, k); P.rect(4, 13, 7, 1, k);
    }
  });
}
// Seed rack: a waist-high wooden frame holding a mesh drying tray. state 0 empty, 1 drying (produce is drawn on the
// tray by the game), 2 ready (a little pile of seeds).
export function seedRackSprite(state = 0) {
  return sprite(`seedrack${state}`, 16, 28, P => {
    P.rect(2, 12, 2, 16, PAL.woodDark); P.rect(12, 12, 2, 16, PAL.woodDark);   // legs
    P.rect(1, 10, 14, 3, PAL.wood); P.rect(1, 10, 14, 1, PAL.woodLight);        // frame
    P.rect(2, 13, 12, 3, '#c9b07c');                                            // tray
    for (let x = 3; x < 14; x += 2) P.px(x, 14, '#a88a5a');                     // mesh
    P.rect(2, 16, 12, 1, PAL.woodDark);
    P.rect(1, 21, 14, 2, PAL.wood); P.rect(1, 21, 14, 1, PAL.woodLight);        // lower rail
    P.px(3, 24, PAL.woodDark); P.px(12, 24, PAL.woodDark);
    if (state === 2) { P.rect(5, 9, 6, 2, '#8a6a2f'); P.rect(6, 8, 4, 1, '#b8923f'); P.px(5, 9, '#d9b35a'); P.px(9, 8, '#d9b35a'); P.px(7, 6, PAL.gold); P.px(11, 7, PAL.gold); P.px(4, 7, PAL.gold); }
  }, 'rgba(40,25,15,0.9)');
}
// Dirt track tile (variant picks the stone speckles).
export function trackTile(variant = 0) {
  return sprite(`track${variant}`, 16, 16, P => {
    P.rect(0, 0, 16, 16, PAL.path);
    const r = makeRng(900 + variant);
    for (let i = 0; i < 9; i++) P.px(r.int(0, 15), r.int(0, 15), PAL.pathStone);
    for (let i = 0; i < 4; i++) P.px(r.int(0, 15), r.int(0, 15), '#d8c08c');
    P.rect(0, 4, 16, 1, PAL.pathStone); P.rect(0, 11, 16, 1, PAL.pathStone);   // worn wheel ruts
    for (let i = 0; i < 3; i++) P.px(r.int(0, 15), 4, '#a88a5a'); for (let i = 0; i < 3; i++) P.px(r.int(0, 15), 11, '#a88a5a');
    for (let i = 0; i < 3; i++) { P.px(r.int(0, 15), 0, PAL.grass3); P.px(r.int(0, 15), 15, PAL.grass3); }
  });
}
export function birdSprite(frame) {
  return sprite(`bird${frame}`, 12, 10, P => {
    const b = '#3a3a4a', l = '#5a5a6e';
    P.rect(4, 4, 5, 3, b); P.rect(8, 3, 3, 2, b); P.px(11, 4, '#f6c453'); P.px(9, 3, '#fff'); P.rect(1, 5, 3, 1, l);
    if (frame) { P.rect(5, 1, 3, 1, l); P.rect(4, 2, 4, 2, l); } else { P.rect(5, 7, 4, 1, l); P.rect(6, 8, 3, 1, b); }
  });
}
export function splatSprite() {
  return sprite('splat', 8, 8, P => { P.disc(4, 4, 3, '#f1f1f1'); P.px(1, 2, '#f1f1f1'); P.px(7, 5, '#f1f1f1'); P.px(3, 7, '#f1f1f1'); P.px(4, 4, '#cfcfcf'); P.px(5, 3, '#cfcfcf'); P.px(3, 5, '#5e4a2a'); });
}
// Tool held during an action: hoe raised (phase 0) / struck (phase 1); can tipped with falling drops.
export function toolOverlay(tool, dir, phase) {
  return sprite(`overlay${tool}${dir}${phase}`, 16, PLAYER_H, P => {
    const flip = dir === 'left', X = x => flip ? 15 - x : x;
    const px = (x, y, c) => P.px(X(x), y, c);
    if (tool === 'hoe') {
      if (phase === 0) {   // raised over the shoulder
        for (let i = 0; i < 8; i++) { px(11 + Math.round(i * 0.4), 15 - i, PAL.wood); px(12 + Math.round(i * 0.4), 15 - i, PAL.woodDark); }
        for (let i = 0; i < 3; i++) { px(13 + i, 5, PAL.metal); px(13 + i, 6, PAL.metal); } px(14, 7, PAL.metalDark); px(15, 7, PAL.metalDark); px(13, 4, PAL.metalLight);
      } else {             // struck into the ground in front
        for (let i = 0; i < 5; i++) { px(11 + Math.round(i * 0.5), 15 + i, PAL.wood); px(12 + Math.round(i * 0.5), 15 + i, PAL.woodDark); }
        for (let i = 0; i < 3; i++) { px(13 + i, 20, PAL.metal); px(13 + i, 21, PAL.metal); } px(12, 21, PAL.metalDark); px(11, 21, PAL.soilDark);
      }
    } else {
      px(12, 14, PAL.metalDark); P.rect(X(12) - (flip ? 3 : 0), 15, 4, 3, PAL.metal); px(flip ? X(12) - 3 : 15, 16, PAL.metalLight);
      for (let i = 0; i < 2; i++) px(14 + (i % 2), 19 + i * 2 + phase, PAL.waterLight);
    }
  });
}
// The selected tool at rest in the player's hands (drawn over the player when no action is running).
export function heldOverlay(tool, dir) {
  return sprite(`held${tool}${dir}`, 16, PLAYER_H, P => {
    const flip = dir === 'left', X = x => flip ? 15 - x : x;
    const px = (x, y, c) => P.px(X(x), y, c);
    if (dir === 'up') { if (tool === 'hoe') { for (let i = 0; i < 7; i++) px(2, 9 + i, PAL.wood); P.rect(1, 7, 3, 2, PAL.metal); P.rect(1, 9, 3, 1, PAL.metalDark); } else { P.rect(1, 14, 4, 3, PAL.metal); P.rect(1, 16, 4, 1, PAL.metalDark); } return; }
    if (tool === 'hoe') {   // resting on the shoulder, blade up behind the head
      for (let i = 0; i < 8; i++) { px(12 + Math.round(i * 0.25), 15 - i, PAL.wood); px(13 + Math.round(i * 0.25), 15 - i, PAL.woodDark); }
      P.rect(X(13) - (flip ? 3 : 0), 5, 4, 2, PAL.metal); P.rect(X(13) - (flip ? 3 : 0), 7, 4, 1, PAL.metalDark); px(14, 4, PAL.metalLight);
    } else {                // hanging from the hand at the hip
      px(13, 14, PAL.metalDark); P.rect(X(12) - (flip ? 3 : 0), 15, 4, 3, PAL.metal); P.rect(X(12) - (flip ? 3 : 0), 17, 4, 1, PAL.metalDark); px(flip ? 12 : 15, 16, PAL.metalLight); px(15, 14, PAL.metalDark);
    }
  });
}

// ---------- trees (16×32, base at the bottom) ----------
export function treeSprite(variant) {
  return sprite(`tree${variant}`, 20, 32, P => {
    const r = makeRng(500 + variant);
    const leaf = ['#4a9a42', '#52a346', '#45964c'][variant], leafDark = ['#357a32', '#3b7f35', '#327a3b'][variant], leafLight = ['#78c266', '#80c86a', '#72be72'][variant], deep = '#255a26';
    // trunk and roots
    P.rect(8, 21, 4, 11, PAL.wood); P.rect(10, 21, 2, 11, PAL.woodDark); P.rect(6, 29, 2, 3, PAL.wood); P.rect(12, 30, 2, 2, PAL.woodDark); P.px(9, 24, PAL.woodLight);
    // canopy: soft layered blobs, shade below, light above, no hard outline
    const dx = r.int(-1, 1), dy = r.int(-1, 1);
    P.disc(10, 15 + dy, 8, deep);
    P.disc(10, 13 + dy, 8, leafDark); P.disc(5 + dx, 15 + dy, 4, leafDark); P.disc(15 + dx, 15 + dy, 4, leafDark);
    P.disc(10, 12 + dy, 7, leaf); P.disc(5 + dx, 14 + dy, 3, leaf); P.disc(15 + dx, 14 + dy, 3, leaf);
    P.disc(10 + dx, 7 + dy, 4, leaf);
    P.disc(8 + dx, 9 + dy, 4, leafLight); P.disc(11 + dx, 6 + dy, 2, leafLight);
    for (let i = 0; i < 10; i++) { const a = r() * Math.PI * 2, d = 3 + r() * 4; P.px(10 + Math.cos(a) * d, 13 + dy + Math.sin(a) * d * 0.8, r() < 0.5 ? leafDark : leaf); }
    for (let i = 0; i < 5; i++) P.px(r.int(5, 14), r.int(16, 20) + dy, deep);
  });
}
// ---------- the house (96×120: 6 tiles wide; a 6×3 footprint with the roof rising above it) ----------
export function houseSprite() {
  return sprite('house', 96, 120, P => {
    const wall = '#e4cfa4', wallDark = '#c8b088', board = '#d6bf92', wallSide = '#b3996c', wallSideDark = '#9c8458';
    const stone = '#8d8a80', stoneDark = '#6c6962', stoneLight = '#a6a39a';
    const roof = '#b4503f', roofDark = '#8a3a30', roofLight = '#cd6c57', roofSide = '#742f27', trim = '#5a3a1e', trimLight = '#8c5a2b';
    const shutter = '#4f7f3f', shutterDark = '#3a5f2e', glass = '#9bd3ee', glassLight = '#cfeaf7';
    // side wall: a straight shaded strip (the depth cue), with a small window
    P.rect(84, 50, 8, 54, wallSide); P.rect(90, 50, 2, 54, wallSideDark); P.rect(84, 96, 8, 8, stoneDark); P.rect(84, 96, 8, 1, stone);
    P.rect(86, 60, 4, 8, trim); P.rect(87, 61, 2, 6, glass);
    // front wall: vertical boards
    P.rect(4, 48, 80, 56, wall);
    for (let x = 8; x < 84; x += 6) P.rect(x, 48, 1, 56, board);
    P.rect(4, 48, 80, 2, wallDark); P.rect(4, 48, 1, 56, wallDark); P.rect(83, 48, 1, 56, wallDark);
    // foundation
    P.rect(2, 96, 82, 8, stone); for (let x = 2; x < 84; x += 7) P.rect(x, 97, 3, 2, stoneDark); for (let x = 5; x < 84; x += 7) P.rect(x, 100, 3, 2, stoneLight);
    // main roof: front slope (trapezoid) with brick-pattern shingles, lighter near the ridge
    for (let y = 14; y <= 48; y++) {
      const t = (y - 14) / 34, inset = Math.round(18 * (1 - t));
      const row = Math.floor((y - 14) / 4), base = t < 0.3 ? roofLight : roof;
      for (let x = inset; x < 90 - inset; x++) { const shingleEdge = (y - 14) % 4 === 3, gap = ((x + (row % 2) * 3) % 6) === 0 && (y - 14) % 4 !== 3; P.px(x, y, shingleEdge ? roofDark : gap ? roofDark : base); }
    }
    // roof edge over the side wall
    P.rect(84, 44, 10, 4, roofDark);
    P.rect(18, 13, 54, 2, roofDark); P.rect(18, 12, 54, 1, '#d98a74');          // ridge cap
    P.rect(0, 48, 94, 3, trim); P.rect(0, 47, 94, 1, roofDark);                   // eave + shadow
    // chimney with smoke
    P.rect(62, 0, 10, 20, stone); P.rect(61, 0, 12, 3, stoneDark); P.rect(62, 3, 10, 1, stoneLight); P.rect(64, 0, 2, 2, '#2a2a2a'); P.px(68, 1, '#2a2a2a');
    P.rect(66, -1, 1, 1, '#ddd');
    // windows with shutters and flower boxes
    for (const wx of [12, 60]) {
      P.rect(wx - 5, 58, 4, 18, shutter); P.rect(wx + 19, 58, 4, 18, shutter); for (let y = 60; y < 76; y += 4) { P.rect(wx - 4, y, 2, 1, shutterDark); P.rect(wx + 20, y, 2, 1, shutterDark); }
      P.rect(wx - 1, 56, 20, 22, trim); P.rect(wx, 57, 18, 20, glass); P.rect(wx, 57, 8, 9, glassLight); P.rect(wx + 8, 57, 2, 20, trim); P.rect(wx, 66, 18, 2, trim);
      P.rect(wx - 2, 78, 22, 2, trimLight); P.rect(wx - 1, 80, 20, 4, trim); P.px(wx + 2, 77, '#e85a5a'); P.px(wx + 7, 77, '#f6c453'); P.px(wx + 12, 77, '#e85a5a'); P.px(wx + 16, 77, '#f1f1f1'); for (let x = wx - 1; x < wx + 19; x += 3) P.px(x + 1, 76, '#5fa14a');
    }
    // portico over the door: small gable awning on two posts
    for (let y = 0; y < 6; y++) P.rect(37 - y * 2 + 6, 58 + y, 14 + y * 4 - 12, 1, y === 5 ? roofDark : roof);
    P.rect(30, 64, 32, 3, trim); P.rect(30, 67, 32, 1, '#3a2512');
    P.rect(31, 68, 2, 36, trimLight); P.rect(59, 68, 2, 36, trimLight); P.rect(32, 68, 1, 36, trim); P.rect(60, 68, 1, 36, trim);
    // door with a little window, handle and a lantern
    P.rect(38, 70, 16, 34, trim); P.rect(40, 72, 12, 32, PAL.door); P.rect(42, 75, 8, 7, glass); P.rect(42, 75, 4, 3, glassLight); P.rect(45, 75, 1, 7, trim); P.px(50, 90, PAL.gold); P.px(50, 91, PAL.gold);
    P.rect(55, 80, 3, 4, '#2a2a2a'); P.rect(56, 81, 1, 2, PAL.gold); P.px(56, 79, trim);
    // porch floor and steps
    P.rect(28, 104, 36, 4, trimLight); P.rect(28, 108, 36, 1, trim);
    P.rect(34, 109, 24, 4, trimLight); P.rect(34, 113, 24, 1, trim); P.rect(32, 114, 28, 4, trimLight); P.rect(32, 118, 28, 2, trim);
  });
}

// ---------- objects ----------
// The compost bin (16×20): a slatted wooden box between two posts. 0 lid shut and empty; 1 lid propped open on a heap of
// scraps; 2 the heap has rotted dark and a sprout shows: ready.
export function compostSprite(level = 0) {
  return sprite(`compost${level}`, 16, 20, P => {
    P.rect(1, 8, 14, 12, PAL.woodDark);                                   // box
    P.rect(2, 9, 12, 10, PAL.wood);
    for (const y of [11, 14, 17]) P.rect(2, y, 12, 1, PAL.woodDark);     // gaps between slats
    for (const y of [9, 12, 15]) P.rect(3, y, 10, 1, PAL.woodLight);     // slat highlights
    P.rect(1, 7, 2, 13, PAL.woodDark); P.rect(13, 7, 2, 13, PAL.woodDark); P.px(1, 7, PAL.woodLight); P.px(13, 7, PAL.woodLight);   // posts
    P.rect(2, 19, 12, 1, '#4a3220');
    if (level === 0) { P.rect(0, 6, 16, 2, PAL.woodLight); P.rect(0, 8, 16, 1, PAL.woodDark); P.px(7, 5, PAL.woodDark); P.px(8, 5, PAL.woodDark); }   // lid shut, with a handle
    else {
      const heap = level === 2 ? '#3d2e1a' : '#6a5a3a', top = level === 2 ? '#5a4a2a' : '#8a7a4a';
      P.rect(3, 7, 10, 2, heap); P.rect(4, 6, 8, 1, top);                 // the heap showing above the rim
      if (level === 1) { P.px(5, 6, '#8bc34a'); P.px(8, 5, '#e8a23b'); P.px(10, 6, '#c9b07c'); P.px(7, 7, '#8bc34a'); }
      else { P.px(8, 5, '#8fd36a'); P.px(8, 4, '#8fd36a'); P.px(7, 3, '#8fd36a'); P.px(9, 3, '#8fd36a'); P.px(11, 7, '#c9b07c'); }   // sprout
      P.line(13, 6, 15, 0, PAL.woodLight); P.line(14, 6, 15, 1, PAL.woodDark); P.px(15, 0, PAL.woodDark);   // lid propped up on the right post
    }
  });
}
// Fertiliser worked into a bed: a scatter of dark crumbs and a fleck of green, drawn over the soil under the plant.
// A fertilised bed is simply a shade lighter (worked compost), with no spots: a plain wash, a touch lighter at the top.
// Fertilised soil: dark crumbs of compost worked in, and a few bits of straw. No wash over the tile.
// A fertilised bed: dark crumbs worked in, and flecks in the colour of the bag's strongest stat so you can tell the beds apart.
export function fertOverlay(look = null) {
  const stat = look?.stat || null, stars = look?.stars || 0;
  return sprite(`fertOverlay:${stat}:${stars}`, 16, 16, P => {
    const dark = 'rgba(38,22,10,0.55)', fleck = stat ? STAT_COLOUR[stat][0] : 'rgba(240,222,160,0.6)';
    for (const [x, y] of [[2, 3], [9, 2], [13, 5], [5, 7], [11, 9], [1, 11], [7, 12], [14, 13], [4, 14]]) { P.rect(x, y, 2, 1, dark); P.px(x + 1, y + 1, dark); }
    for (const [x, y] of [[6, 2], [12, 7], [3, 9], [9, 14], [14, 1]]) P.px(x, y, fleck);
    for (let k = 0; k < stars; k++) P.px(2 + k * 5, 1, PAL.gold);
  });
}
// Pipe or line under a bed: a backfilled trench along its run (`mask`: 1 up, 2 right, 4 down, 8 left), lit along its
// top-left lip and shadowed on the bottom-right, the pipe showing through where the soil has settled (blue when the
// well feeds it). Where the run meets open ground (`surf` bits) it dives: a stub of pipe at the edge goes into a dark
// mouth with the dug soil heaped either side.
export function buriedSprite(mask = 0, surf = 0, kind = 'pipe', fed = false) {
  return sprite(`buried${mask}.${surf}.${kind}${fed ? 'f' : ''}`, 16, 16, P => {
    const fill = 'rgba(44,26,12,0.5)', lip = 'rgba(200,160,108,0.45)', shade = 'rgba(16,8,3,0.45)', mouth = 'rgba(8,4,2,0.9)', heap = 'rgba(228,192,138,0.85)';
    const line = kind === 'line', stub = line ? '#3b2314' : PAL.metal, stubEdge = line ? '#2a1810' : PAL.metalDark, core = line ? '#3b2314' : fed ? PAL.water : PAL.metal;
    const up = mask & 1, right = mask & 2, down = mask & 4, left = mask & 8;
    // the trench
    P.rect(6, 6, 5, 5, fill);
    if (up) P.rect(6, 0, 5, 6, fill); if (down) P.rect(6, 11, 5, 5, fill); if (left) P.rect(0, 6, 6, 5, fill); if (right) P.rect(11, 6, 5, 5, fill);
    // lips: lit on the left of a vertical run and the top of a horizontal one, shadow opposite; the joint closes the open sides
    if (up) { P.rect(6, 0, 1, 6, lip); P.rect(10, 0, 1, 6, shade); } if (down) { P.rect(6, 11, 1, 5, lip); P.rect(10, 11, 1, 5, shade); }
    if (left) { P.rect(0, 6, 6, 1, lip); P.rect(0, 10, 6, 1, shade); } if (right) { P.rect(11, 6, 5, 1, lip); P.rect(11, 10, 5, 1, shade); }
    if (!up) P.rect(6, 6, 5, 1, lip); if (!left) P.rect(6, 6, 1, 5, lip); if (!down) P.rect(6, 10, 5, 1, shade); if (!right) P.rect(10, 6, 1, 5, shade);
    // the pipe showing through, or the mouth where it dives
    const dive = dir => {   // drawn as if the run came in from the top, then turned to its side
      const R = (x, y, w, h, c) => { if (dir === 1) P.rect(x, y, w, h, c); else if (dir === 4) P.rect(x, 16 - y - h, w, h, c); else if (dir === 8) P.rect(y, x, h, w, c); else P.rect(16 - y - h, x, h, w, c); };
      R(6, 0, 5, 1, stubEdge); R(7, 0, 3, 1, stub); R(6, 1, 5, 1, stubEdge);                  // the last of the pipe and its elbow turning down
      R(3, 2, 2, 3, heap); R(12, 2, 2, 3, heap); R(3, 5, 2, 1, shade); R(12, 5, 2, 1, shade);   // the dug soil heaped either side
      R(5, 2, 7, 3, mouth);                                                                      // the hole
    };
    const glimpse = (x, y, w, h) => { P.rect(x, y, w, h, core); if (w > h) P.rect(x, y + h, w, 1, shade); else P.rect(x + w, y, 1, h, shade); };
    if (up) { if (surf & 1) dive(1); else glimpse(8, 2, 1, 2); }
    if (down) { if (surf & 4) dive(4); else glimpse(8, 12, 1, 2); }
    if (left) { if (surf & 8) dive(8); else glimpse(2, 8, 2, 1); }
    if (right) { if (surf & 2) dive(2); else glimpse(12, 8, 2, 1); }
    if (!mask) glimpse(8, 7, 1, 2);
  });
}
export function breederSprite(frame = 0) {
  return sprite(`breeder${frame}`, 16, 16, P => {
    P.rect(2, 8, 12, 7, PAL.metalDark); P.rect(3, 9, 10, 5, PAL.metal);
    P.disc(8, 6, 5, PAL.glass); P.disc(8, 6, 4, '#dff6fb'); P.rect(2, 8, 12, 1, PAL.metalLight);
    P.px(5, 11, frame ? '#8fd36a' : '#2d5a1f'); P.px(7, 11, frame ? '#f6c453' : '#6b5a2a'); P.px(9, 11, '#e86a6a');
    P.px(6, 4, '#8fd36a'); P.px(9, 5, '#c47fe6'); P.px(8, 3, frame ? '#f6c453' : '#dff6fb');
  });
}
// Pipe: a grey line with arms to the neighbours in `mask` (1 up, 2 right, 4 down, 8 left), lit along the top, with a blue
// core when the well feeds it. A section with no arms is a stub with caps. Rects only, no spots.
export function pipeSprite(mask = 0, fed = false) {
  return sprite(`pipe${mask}${fed ? 'f' : ''}`, 16, 16, P => {
    const body = PAL.metal, edge = PAL.metalDark, lit = PAL.metalLight, core = fed ? PAL.water : null;
    const H = (x0, x1) => { P.rect(x0, 6, x1 - x0, 5, edge); P.rect(x0, 7, x1 - x0, 3, body); P.rect(x0, 7, x1 - x0, 1, lit); if (core) P.rect(x0, 8, x1 - x0, 1, core); };
    const V = (y0, y1) => { P.rect(6, y0, 5, y1 - y0, edge); P.rect(7, y0, 3, y1 - y0, body); P.rect(7, y0, 1, y1 - y0, lit); if (core) P.rect(8, y0, 1, y1 - y0, core); };
    if (mask & 8) H(0, 9); if (mask & 2) H(8, 16); if (mask & 1) V(0, 9); if (mask & 4) V(8, 16);
    P.rect(6, 6, 5, 5, edge); P.rect(7, 7, 3, 3, body); P.px(7, 7, lit); if (core) P.px(8, 8, core);   // the joint
    if (!mask) { P.rect(4, 6, 9, 5, edge); P.rect(5, 7, 7, 3, body); P.rect(5, 7, 7, 1, lit); if (core) P.rect(5, 8, 7, 1, core); P.rect(3, 5, 2, 7, edge); P.rect(12, 5, 2, 7, edge); }   // a loose stub with caps
    P.rect(5, 11, 7, 1, 'rgba(30,20,10,0.22)');   // shadow under the run
  });
}
// Sprinklers, lit from the top left, standing in their own shadow. Frames 1–2 wet the head. Level 0 (I): a short post
// with a round head. Level 1 (II): a taller post with a wide two-nozzle head. Level 2 (III): a tripod under a tall
// post and a big ringed head.
export function sprinklerSprite(level = 0, frame = 0) {
  return sprite(`sprinkler${level}_${frame}`, 16, 16, P => {
    P.rect(5, 12, 7, 2, 'rgba(30,20,10,0.28)'); P.rect(6, 11, 5, 1, 'rgba(30,20,10,0.2)');   // shadow on the ground
    if (level === 0) {
      P.rect(7, 8, 2, 5, PAL.metalDark); P.px(7, 8, PAL.metal); P.px(7, 9, PAL.metal);           // post
      P.rect(6, 5, 4, 3, PAL.metal); P.rect(7, 4, 2, 1, PAL.metal);                              // round head
      P.px(6, 5, PAL.metalLight); P.px(7, 4, PAL.metalLight); P.px(7, 5, PAL.metalLight);        // light from the top left
      P.px(9, 7, PAL.metalDark); P.px(9, 6, PAL.metalDark); P.px(8, 7, PAL.metalDark);           // shade on the right
      P.px(8, 3, PAL.outline);                                                                     // the nozzle
      if (frame) { P.px(7, 3, PAL.waterLight); P.px(9, 3, PAL.waterLight); P.px(8, 2, frame === 1 ? PAL.water : PAL.waterLight); P.px(5, 6, PAL.waterLight); P.px(10, 5, PAL.waterLight); }
    } else if (level === 1) {
      P.rect(7, 6, 2, 7, PAL.metalDark); P.rect(7, 6, 1, 7, PAL.metal);                          // a taller post
      P.rect(5, 3, 6, 3, PAL.metal); P.rect(6, 2, 4, 1, PAL.metal);                              // the wide head
      P.px(5, 3, PAL.metalLight); P.px(6, 2, PAL.metalLight); P.rect(6, 3, 2, 1, PAL.metalLight);
      P.rect(10, 4, 1, 2, PAL.metalDark); P.px(9, 5, PAL.metalDark);
      P.px(5, 1, PAL.outline); P.px(10, 1, PAL.outline);                                        // two nozzles
      if (frame) { P.px(4, 1, PAL.waterLight); P.px(11, 1, PAL.waterLight); P.px(5, 0, frame === 1 ? PAL.water : PAL.waterLight); P.px(10, 0, frame === 2 ? PAL.water : PAL.waterLight); P.px(3, 4, PAL.waterLight); P.px(12, 4, PAL.waterLight); }
    } else {
      P.line(7, 7, 4, 13, PAL.metalDark); P.line(8, 7, 11, 13, PAL.metalDark); P.rect(7, 5, 2, 8, PAL.metalDark); P.px(7, 5, PAL.metal); P.px(7, 6, PAL.metal);   // the tripod and post
      P.rect(4, 2, 8, 3, PAL.metal); P.rect(5, 1, 6, 1, PAL.metal); P.rect(5, 5, 6, 1, PAL.metalDark);   // the big head
      P.px(4, 2, PAL.metalLight); P.rect(5, 1, 3, 1, PAL.metalLight); P.px(5, 2, PAL.metalLight);
      P.rect(11, 3, 1, 2, PAL.metalDark); P.px(10, 4, PAL.metalDark);
      P.rect(4, 0, 8, 1, PAL.metalDark); P.px(4, 0, PAL.outline); P.px(8, 0, PAL.outline); P.px(11, 0, PAL.outline);   // the ring with its nozzles
      if (frame) { P.px(3, 0, PAL.waterLight); P.px(12, 0, PAL.waterLight); P.px(2, 3, PAL.waterLight); P.px(13, 3, PAL.waterLight); P.px(8, 0, frame === 1 ? PAL.water : PAL.waterLight); }
    }
  });
}
// The spray: over the sprinkler's reach (R tiles each way), solid streams reaching every bed around it, no dots. More
// streams for a wider reach. The two frames are the head a half-turn apart, so it reads as turning.
export function spraySprite(R = 1, frame = 0) {
  const S = (2 * R + 1) * 16, n = 8 + (R - 1) * 4, L = R * 16 + 6;
  return sprite(`spray${R}_${frame}`, S, S, P => {
    const cx = S / 2, cy = S / 2 - 3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (frame ? Math.PI / n : 0), len = i % 2 ? L - 3 : L;
      const ex = cx + Math.cos(a) * len, ey = cy + Math.sin(a) * len * 0.8 + 3;
      P.line(cx + Math.cos(a) * 4, cy + Math.sin(a) * 3, ex, ey, PAL.water);                 // the stream
      P.line(cx + Math.cos(a) * 4, cy + Math.sin(a) * 3, cx + Math.cos(a) * (len * 0.55), cy + Math.sin(a) * len * 0.44 + 1, PAL.waterLight);   // lit near the head
      P.line(ex - Math.cos(a) * 2, ey + 1, ex + Math.cos(a) * 1, ey + 2, 'rgba(79,143,207,0.6)');   // the stream lands and spreads
    }
  });
}
// Pumps, standing on a pipe. Level 0 the hand pump (16×16): a post with a lever and a spout, frames rock the lever.
// Level 1 the windmill (16×32): a tapered tower with four sails on a hub, frames turn the sails. Level 2 the engine
// (16×20): a boxed motor with a stack, frames puff. Frame 0 is standing still. Lines and rects only, no dots.
export function pumpSprite(level = 0, frame = 0) {
  return sprite(`pump${level}_${frame}`, 16, level === 1 ? 32 : level === 2 ? 20 : 16, P => {
    if (level === 0) {
      P.rect(5, 13, 7, 2, 'rgba(30,20,10,0.28)');
      P.rect(6, 6, 4, 8, PAL.metalDark); P.rect(7, 6, 1, 8, PAL.metal); P.px(7, 6, PAL.metalLight);   // the body
      P.rect(5, 5, 6, 1, PAL.metalLight);                                                        // its cap
      P.rect(10, 9, 3, 1, PAL.metalDark); P.px(12, 10, PAL.metalDark);                            // the spout
      const up = frame === 1; P.line(5, up ? 4 : 7, 1, up ? 1 : 10, PAL.woodDark); P.px(1, up ? 1 : 10, PAL.woodLight);   // the lever
      if (frame) { P.px(12, 11, PAL.waterLight); P.px(12, 12, PAL.water); }
    } else if (level === 1) {
      P.rect(4, 30, 9, 2, 'rgba(30,20,10,0.28)');
      P.rect(6, 12, 4, 18, PAL.woodDark); P.rect(7, 12, 1, 18, PAL.wood); P.px(7, 12, PAL.woodLight);   // the tower
      P.line(6, 12, 4, 29, PAL.woodDark); P.line(9, 12, 11, 29, PAL.woodDark); P.rect(4, 29, 8, 1, PAL.woodDark);   // its legs splay
      const hx = 8, hy = 9, a0 = frame === 1 ? 0 : frame === 2 ? Math.PI / 4 : Math.PI / 8;
      for (let i = 0; i < 4; i++) { const a = a0 + i * Math.PI / 2; P.line(hx, hy, hx + Math.cos(a) * 7, hy + Math.sin(a) * 7, PAL.wallDark); P.line(hx + Math.cos(a + 0.4) * 2, hy + Math.sin(a + 0.4) * 2, hx + Math.cos(a + 0.2) * 6, hy + Math.sin(a + 0.2) * 6, PAL.wall); }   // the sails
      P.rect(7, 8, 2, 2, PAL.metalDark); P.px(7, 8, PAL.metalLight);                                  // the hub
    } else {
      P.rect(2, 18, 13, 2, 'rgba(30,20,10,0.28)');
      P.rect(2, 9, 12, 9, PAL.metalDark); P.rect(3, 10, 10, 7, PAL.metal); P.rect(3, 10, 10, 1, PAL.metalLight);   // the block
      P.rect(4, 12, 3, 3, PAL.metalDark); P.px(5, 13, frame ? PAL.gold : PAL.metalLight);            // a gauge
      P.rect(9, 12, 3, 3, PAL.metalDark); P.rect(9, 12, 3, 1, PAL.metalLight);                        // the grille
      P.rect(11, 3, 2, 7, PAL.metalDark); P.px(11, 3, PAL.metal); P.rect(10, 2, 4, 1, PAL.metalDark);   // the stack
      P.rect(1, 15, 1, 3, PAL.woodDark); P.rect(14, 15, 1, 3, PAL.woodDark);                         // the skids
      if (frame) { const y = frame === 1 ? 0 : 1; P.px(12, y, 'rgba(120,120,130,0.8)'); P.px(13, y, 'rgba(120,120,130,0.5)'); }   // a puff
    }
  });
}
// A tall sprite as a pocket icon: scaled to fit a 16×16 slot (the windmill is two tiles tall).
export function fitIcon(key, img) {
  return sprite(`icon:${key}`, 16, 16, (P, ctx) => { const sc = 16 / img.height, w = Math.round(img.width * sc); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, Math.round((16 - w) / 2), 0, w, 16); });
}
export const pumpIcon = (level = 0) => fitIcon(`pump${level}`, pumpSprite(level, 0));
export const stationIcon = kind =>   // a digit on a tiered machine (picker2) picks its tier
  kind === 'splitter' ? splitterSprite() : kind === 'filter' ? filterSprite() : kind === 'dcrate' ? fitIcon('dcrate', crateSprite(0, true)) : kind === 'truck' || kind === 'truck1' || kind === 'truck2' ? fitIcon('truck', truckSprite(0)) : /^generator\d?$/.test(kind) ? fitIcon(kind, generatorSprite(0, +kind.slice(9) || 0)) : /^picker\d?$/.test(kind) ? fitIcon(kind, pickerSprite(0, false, +kind.slice(6) || 0)) : /^planter\d?$/.test(kind) ? fitIcon(kind, planterSprite(0, false, +kind.slice(7) || 0)) : kind === 'hopper' ? fitIcon('hopper', hopperSprite(false)) : kind === 'dryer' ? fitIcon('dryer', dryerSprite(0)) : kind === 'belt' ? beltSprite(10, 1, 0) : lineSprite(10, false);
// Belt: a dark rubber band on a frame, 8 wide, running to each neighbour in `mask` (1 up, 2 right, 4 down, 8 left),
// drawn over pipe and line. `dir` is the way it carries (0 up, 1 right, 2 down, 3 left; -1 still): chevrons point
// that way and `frame` (0–3) slides them along. A still belt shows plain treads.
// A splitter (16×16) over a belt: a steel plate with a fork drawn on it, one way in and two out. A filter: the plate
// with a sieve in the middle, a brown dot on the side dried goods leave by and a green one for fresh (swap flips them).
const SIGN = '#eef0e2';
function plate(P) { P.rect(2, 2, 12, 12, PAL.metalDark); P.rect(3, 3, 10, 10, PAL.metal); P.rect(3, 3, 10, 1, PAL.metalLight); P.px(3, 12, PAL.metalDark); P.px(12, 12, PAL.metalDark); }
export function splitterSprite() {
  return sprite('splitter3', 16, 16, P => {
    plate(P);
    P.rect(7, 8, 2, 4, SIGN); P.rect(4, 7, 8, 1, SIGN);                                                  // the stem and the bar
    for (const [x, d] of [[3, 1], [12, -1]]) { P.px(x, 7, SIGN); P.px(x + d, 6, SIGN); P.px(x + d, 8, SIGN); P.px(x + 2 * d, 5, SIGN); P.px(x + 2 * d, 9, SIGN); }   // arrowheads
  });
}
export function filterSprite(swap = false) {
  return sprite(`filter3${swap ? 's' : ''}`, 16, 16, P => {
    plate(P);
    P.rect(5, 5, 6, 6, '#2c2d36');
    for (let i = 5; i <= 10; i += 2) { P.rect(i, 5, 1, 6, PAL.metalLight); P.rect(5, i, 6, 1, PAL.metalLight); }   // the sieve
    P.rect(swap ? 11 : 3, 7, 2, 2, '#8a5a2b'); P.rect(swap ? 3 : 11, 7, 2, 2, '#5fa14a');
  });
}
export function beltSprite(mask = 0, dir = -1, frame = 0) {
  return sprite(`belt${mask}:${dir}:${frame}`, 16, 16, P => {
    const frameC = '#3a3a44', band = '#55566a', tread = '#6c6e84', chev = '#b9bdd0';
    const H = (x0, x1) => { P.rect(x0, 4, x1 - x0, 8, frameC); P.rect(x0, 5, x1 - x0, 6, band); };
    const V = (y0, y1) => { P.rect(4, y0, 8, y1 - y0, frameC); P.rect(5, y0, 6, y1 - y0, band); };
    if (!mask) H(1, 15);
    if (mask & 8) H(0, 8); if (mask & 2) H(8, 16); if (mask & 1) V(0, 8); if (mask & 4) V(8, 16);
    P.rect(4, 4, 8, 8, frameC); P.rect(5, 5, 6, 6, band);
    if (dir < 0) {   // still: faint treads across the band
      if (mask & 10 || !mask) for (let x = 2; x < 16; x += 4) P.rect(x, 6, 1, 4, tread);
      if (mask & 5) for (let y = 2; y < 16; y += 4) P.rect(6, y, 4, 1, tread);
      return;
    }
    // chevrons pointing `dir`, two per tile, sliding with the frame; drawn in the band's own tiles only
    const inBand = (x, y) => x >= 5 && x < 11 && y >= 5 && y < 11 || (mask & 8 && y >= 5 && y < 11 && x < 5) || (mask & 2 && y >= 5 && y < 11 && x >= 11) || (mask & 1 && x >= 5 && x < 11 && y < 5) || (mask & 4 && x >= 5 && x < 11 && y >= 11) || (!mask && y >= 5 && y < 11);
    const rot = (x, y) => dir === 1 ? [x, y] : dir === 3 ? [15 - x, y] : dir === 2 ? [y, x] : [y, 15 - x];   // from "pointing right"
    for (let k = 0; k < 3; k++) {
      const x = ((frame * 2 + k * 6) % 18) - 2;
      for (const [px, py] of [[x, 6], [x + 1, 7], [x + 1, 8], [x, 9]]) { const [rx, ry] = rot(px, py); if (rx >= 0 && rx < 16 && ry >= 0 && ry < 16 && inBand(rx, ry)) P.px(rx, ry, chev); }
    }
  });
}
// Power line: a short post with a wire to each neighbour in `mask` (1 up, 2 right, 4 down, 8 left), low on the tile so
// it can share one with pipe; a spark on the post when powered. A section with no neighbours is a loose coil.
export function lineSprite(mask = 0, powered = false) {
  return sprite(`line${mask}${powered ? 'p' : ''}`, 16, 16, P => {
    const wire = '#3b2314';
    if (mask & 8) P.rect(0, 12, 8, 1, wire); if (mask & 2) P.rect(8, 12, 8, 1, wire);
    if (mask & 1) P.rect(8, 0, 1, 12, wire); if (mask & 4) P.rect(8, 12, 1, 4, wire);
    P.rect(6, 15, 4, 1, 'rgba(30,20,10,0.25)');
    P.rect(7, 10, 2, 5, PAL.woodDark); P.px(7, 10, PAL.woodLight);   // the post
    if (!mask) { P.rect(4, 12, 8, 1, wire); P.rect(4, 11, 1, 3, wire); P.rect(11, 11, 1, 3, wire); }
    if (powered) { P.px(8, 9, PAL.gold); P.px(7, 9, '#fff1b8'); }
  });
}
// The generator (16×20): a boxed motor in red iron on skids, a coil window, a stack; frames puff. Tiers change the
// shape (Build 87): II bolts a flywheel on the side, III is a longer block with a gold rim, two windows and two stacks.
export function generatorSprite(frame = 0, level = 0) {
  return sprite(`generator${frame}:${level}`, 16, 20, P => {
    P.rect(1, 18, 14, 2, 'rgba(30,20,10,0.28)');
    const lit = frame ? PAL.gold : PAL.metal;
    if (level < 2) {
      P.rect(2, 9, 12, 9, PAL.roofDark); P.rect(3, 10, 10, 7, PAL.roof); P.rect(3, 10, 10, 1, '#d9736a');
      P.rect(4, 12, 4, 4, PAL.metalDark); P.rect(5, 13, 2, 2, lit);
      P.rect(9, 12, 3, 1, PAL.metalDark); P.rect(9, 14, 3, 1, PAL.metalDark);
      P.rect(12, 3, 2, 7, PAL.metalDark); P.px(12, 3, PAL.metal); P.rect(11, 2, 4, 1, PAL.metalDark);
    } else {
      P.rect(1, 8, 14, 10, PAL.roofDark); P.rect(2, 9, 12, 8, PAL.roof); P.rect(1, 8, 14, 1, PAL.gold); P.rect(2, 9, 12, 1, '#d9736a');
      for (const x of [3, 9]) { P.rect(x, 11, 4, 4, PAL.metalDark); P.rect(x + 1, 12, 2, 2, lit); }
      for (const x of [4, 11]) { P.rect(x, 2, 2, 6, PAL.metalDark); P.px(x, 2, PAL.metal); P.rect(x - 1, 1, 4, 1, PAL.metalDark); }
    }
    if (level === 1) {   // the flywheel, its spoke turning with the frame
      P.rect(0, 11, 5, 5, PAL.metalDark); P.rect(1, 12, 3, 3, PAL.metal); P.px(2, 13, PAL.outline);
      if (frame === 1) P.px(2, 12, PAL.metalLight); else if (frame === 2) P.px(3, 13, PAL.metalLight); else P.px(2, 14, PAL.metalLight);
    }
    P.rect(1, 16, 1, 2, PAL.woodDark); P.rect(14, 16, 1, 2, PAL.woodDark);
    if (frame) { const y = frame === 1 ? 0 : 1, xs = level === 2 ? [5, 12] : [13]; for (const x of xs) { P.px(x, y, 'rgba(120,120,130,0.8)'); P.px(x + 1, y, 'rgba(120,120,130,0.5)'); } }
  });
}
// The picker (16×20): a post with a jointed arm and a basket at its foot; frames swing the arm; `full` shows crops.
// Tiers change the shape (Build 87): I is a wooden post, one arm and a wicker basket; II a steel post, an arm with a claw
// and a banded crate; III two arms working opposite ways, a steel bin with a gold rim and a lamp on top.
const CROPS3 = ['#e86a6a', '#f6c453', '#8fd36a'];
export function pickerSprite(frame = 0, full = false, level = 0) {
  return sprite(`picker2:${frame}${full ? 'f' : ''}${level}`, 16, 20, P => {
    P.rect(3, 18, 11, 2, 'rgba(30,20,10,0.28)');
    const claw = (x, y) => { P.px(x - 1, y, PAL.outline); P.px(x + 1, y, PAL.outline); P.px(x, y - 1, PAL.metalDark); };
    if (level === 0) {
      P.rect(7, 7, 2, 11, PAL.woodDark); P.rect(7, 7, 1, 11, PAL.wood);
      P.rect(6, 6, 4, 2, PAL.metalDark); P.px(6, 6, PAL.metalLight);
      if (frame < 0) {}   // the boom is out: the game draws it
      else if (frame === 1) { P.line(8, 7, 13, 3, PAL.wood); P.line(13, 3, 15, 5, PAL.woodDark); P.px(15, 6, PAL.outline); }
      else { P.line(8, 7, 2, 10, PAL.wood); P.line(2, 10, 1, 14, PAL.woodDark); P.px(1, 15, PAL.outline); }
      P.rect(9, 14, 6, 4, '#8a6230'); P.rect(10, 15, 4, 2, '#c9a35a'); P.px(11, 15, '#a57f3c'); P.px(13, 16, '#a57f3c');   // wicker
      if (full) CROPS3.forEach((c, i) => P.px(10 + i * 2, 14, c));
      return;
    }
    P.rect(7, 4, 2, 14, PAL.metalDark); P.rect(7, 4, 1, 14, PAL.metal); P.rect(4, 17, 7, 1, PAL.metalDark);   // steel post on a plate
    P.rect(6, 3, 4, 2, PAL.metalDark); P.px(6, 3, PAL.metalLight);
    const down = () => { P.line(8, 4, 3, 7, PAL.metal); P.line(3, 7, 2, 11, PAL.metalDark); claw(2, 12); };
    const up = () => { P.line(8, 4, 13, 1, PAL.metal); P.line(13, 1, 14, 4, PAL.metalDark); claw(14, 5); };
    const upL = () => { P.line(8, 4, 3, 1, PAL.metal); P.line(3, 1, 1, 3, PAL.metalDark); claw(1, 4); };
    const downR = () => { P.line(8, 4, 12, 7, PAL.metal); P.line(12, 7, 12, 10, PAL.metalDark); claw(12, 11); };
    if (frame < 0) {}
    else if (level === 1) { if (frame === 1) up(); else down(); }
    else { if (frame === 1) { upL(); downR(); } else { down(); up(); } }
    if (level === 2) { P.px(7, 1, '#ffe680'); P.px(8, 1, PAL.gold); P.rect(7, 2, 2, 1, PAL.metalDark); }   // the lamp
    if (level === 1) { P.rect(9, 12, 7, 6, PAL.woodDark); P.rect(10, 13, 5, 4, PAL.wood); P.rect(9, 14, 7, 1, PAL.metalDark); }
    else { P.rect(9, 12, 7, 6, PAL.metalDark); P.rect(10, 13, 5, 4, PAL.metal); P.rect(9, 12, 7, 1, PAL.gold); }
    if (full) CROPS3.forEach((c, i) => P.px(10 + i * 2, 12, c));
  });
}
// The planter (16×20): a seed drill. A funnel of seed over a tube down to a coulter disc that cuts the bed; frames drop a
// seed; `full` shows seed at the lip. Tiers (Build 87): I a wooden funnel on two legs; II a wider steel funnel, two tubes,
// two discs on a bar; III twin funnels, three discs, a gold band and a lamp.
export function planterSprite(frame = 0, full = false, level = 0) {
  return sprite(`planter3:${frame}${full ? 'f' : ''}${level}`, 16, 20, P => {
    P.rect(2, 18, 12, 2, 'rgba(30,20,10,0.28)');
    const steel = level > 0, edge = steel ? PAL.metalDark : PAL.woodDark, fill = steel ? PAL.metal : PAL.wood, rim = steel ? PAL.metalLight : PAL.woodLight;
    const funnel = (x0, w, y0, rows) => { for (let r = 0; r < rows; r++) { const ww = Math.max(2, w - r * 2); P.rect(x0 + (w - ww) / 2, y0 + r, ww, 1, edge); if (ww > 2) P.rect(x0 + (w - ww) / 2 + 1, y0 + r, ww - 2, 1, fill); } P.rect(x0, y0, w, 1, rim); };
    const disc = x => { P.rect(x - 1, 15, 3, 3, PAL.metalDark); P.px(x, 16, PAL.metalLight); };
    const seedC = '#d9a84e', soil = '#5e4a2a';
    if (level === 0) {
      P.line(3, 5, 2, 17, PAL.woodDark); P.line(12, 5, 13, 17, PAL.woodDark);   // legs
      funnel(2, 12, 3, 6); P.rect(7, 9, 2, 6, PAL.metalDark); P.px(7, 9, PAL.metal); disc(8);
      if (full) { P.px(5, 4, soil); P.px(8, 4, seedC); P.px(10, 4, soil); }
      if (frame) P.px(8, 14, seedC);
      return;
    }
    P.rect(1, 6, 1, 12, edge); P.rect(14, 6, 1, 12, edge); P.rect(1, 14, 14, 1, edge);   // the frame and its bar
    if (level === 1) { funnel(2, 12, 2, 4); P.rect(3, 6, 10, 2, PAL.metalDark); P.rect(4, 6, 8, 1, PAL.metal); P.rect(4, 8, 1, 6, PAL.metalDark); P.rect(11, 8, 1, 6, PAL.metalDark); disc(4); disc(11); }   // a trough under the funnel, two drop tubes
    else {
      funnel(1, 7, 2, 4); funnel(8, 7, 2, 4); P.rect(1, 2, 14, 1, PAL.gold);
      P.line(4, 6, 3, 13, PAL.metalDark); P.line(11, 6, 12, 13, PAL.metalDark); P.rect(7, 6, 2, 8, PAL.metalDark);
      disc(3); disc(8); disc(12); P.px(7, 0, '#ffe680'); P.px(8, 0, PAL.gold); P.rect(7, 1, 2, 1, PAL.metalDark);
    }
    if (full) { P.px(4, 3, soil); P.px(7, 3, seedC); P.px(11, 3, soil); }
    if (frame) for (const x of level === 1 ? [4, 11] : [3, 8, 12]) P.px(x, 14, seedC);
  });
}
// The hopper (16×20): a funnel on legs with a spout; `full` shows crops at the lip.
export function hopperSprite(full = false) {
  return sprite(`hopper${full ? 'f' : ''}`, 16, 20, P => {
    P.rect(3, 18, 11, 2, 'rgba(30,20,10,0.28)');
    P.rect(2, 3, 12, 1, PAL.metalDark); P.rect(2, 4, 12, 6, PAL.metalDark); P.rect(3, 5, 10, 4, PAL.metal); P.rect(3, 5, 10, 1, PAL.metalLight);   // the mouth
    P.rect(4, 10, 8, 3, PAL.metalDark); P.rect(5, 10, 6, 2, PAL.metal);                               // narrowing
    P.rect(6, 13, 4, 3, PAL.metalDark); P.rect(7, 13, 2, 2, PAL.metal);                                // the spout
    P.rect(2, 10, 1, 8, PAL.metalDark); P.rect(13, 10, 1, 8, PAL.metalDark);                           // legs
    if (full) { P.px(5, 4, '#e86a6a'); P.px(7, 4, '#f6c453'); P.px(9, 4, '#8fd36a'); P.px(11, 4, '#e8a23b'); }
  });
}
// The dryer (16×20): a slatted wooden cabinet on legs with a tin roof and a stack; frames flicker the heat at the stack while
// it runs; `full` shows dried pieces on the tray at its foot.
export function dryerSprite(frame = 0, full = false) {
  return sprite(`dryer${frame}${full ? 'f' : ''}`, 16, 20, P => {
    P.rect(2, 18, 12, 2, 'rgba(30,20,10,0.28)');
    P.rect(2, 6, 12, 10, PAL.woodDark); P.rect(3, 7, 10, 8, PAL.wood);                                // the cabinet
    for (let y = 8; y < 15; y += 2) P.rect(4, y, 8, 1, PAL.woodDark);                                 // slats
    P.rect(1, 5, 14, 1, PAL.metalDark); P.rect(2, 4, 12, 1, PAL.metal); P.px(2, 4, PAL.metalLight);   // the tin roof
    P.rect(11, 1, 2, 3, PAL.metalDark); P.px(11, 1, PAL.metal);                                       // the stack
    P.rect(3, 16, 1, 2, PAL.woodDark); P.rect(12, 16, 1, 2, PAL.woodDark);                            // legs
    P.rect(5, 16, 6, 1, PAL.woodLight);                                                               // the tray
    if (frame) { const y = frame === 1 ? 0 : 1; P.px(12, y, 'rgba(255,200,120,0.55)'); P.px(11, 0, 'rgba(255,170,90,0.35)'); P.px(7, 9, '#e8a23b'); P.px(8, 11, '#d98a2b'); }   // heat at the stack, a glow between the slats
    if (full) { P.px(6, 15, '#8a5a2b'); P.px(8, 15, '#a0642c'); P.px(10, 15, '#7a4a22'); }
  });
}
// The wheelbarrow (18×14): a tray on a frame with one wheel at the front and two handles behind; `full` shows a load.
export function barrowSprite(full = false) {
  return sprite(`barrow${full ? 'f' : ''}`, 18, 14, P => {
    P.rect(2, 12, 14, 2, 'rgba(30,20,10,0.25)');
    P.rect(4, 3, 11, 6, PAL.metalDark); P.rect(5, 4, 9, 4, '#6f7a8a'); P.rect(5, 4, 9, 1, PAL.metalLight);   // the tray
    P.rect(0, 5, 4, 1, PAL.woodDark); P.rect(0, 7, 4, 1, PAL.woodDark); P.px(0, 5, PAL.wood); P.px(0, 7, PAL.wood);   // handles
    P.rect(6, 9, 1, 2, PAL.metalDark); P.rect(12, 9, 1, 2, PAL.metalDark);                                   // legs
    P.disc(15, 10, 2, '#2a2a2a'); P.px(15, 10, PAL.metalLight);                                             // the wheel
    if (full) { P.px(6, 4, '#e86a6a'); P.px(8, 3, '#f6c453'); P.px(10, 4, '#8fd36a'); P.px(12, 3, '#e8a23b'); }
  }, 'rgba(40,25,15,0.9)');
}
// The forklift (16×20): a small yellow lift truck seen from the front-left: a mast, two forks at the foot, a seat and a roll cage.
export function forkliftSprite() {
  return sprite('forklift', 16, 20, P => {
    P.rect(3, 18, 11, 2, 'rgba(30,20,10,0.28)');
    P.rect(3, 9, 9, 7, '#e8c13a'); P.rect(3, 9, 9, 1, '#f6dd6a'); P.rect(3, 15, 9, 1, '#b8921f');       // the body
    P.rect(4, 5, 7, 4, '#3b2314'); P.rect(5, 6, 5, 2, '#5a4a2a');                                       // the seat and its back
    P.rect(3, 3, 1, 12, PAL.metalDark); P.rect(11, 3, 1, 12, PAL.metalDark); P.rect(3, 3, 9, 1, PAL.metalDark);   // the roll cage
    P.rect(12, 2, 2, 15, PAL.metalDark); P.px(12, 2, PAL.metal); P.rect(12, 10, 1, 7, PAL.metal);       // the mast
    P.rect(12, 16, 4, 1, PAL.metalLight); P.rect(12, 17, 4, 1, PAL.metalDark);                           // the forks
    P.disc(5, 17, 2, '#2a2a2a'); P.disc(10, 17, 2, '#2a2a2a'); P.px(5, 17, PAL.metalLight); P.px(10, 17, PAL.metalLight);   // wheels
  }, 'rgba(40,25,15,0.9)');
}
// A basket (16×16): woven, with a handle.
export function basketIcon() {
  return sprite('basket', 16, 16, P => {
    P.rect(2, 7, 12, 7, '#b07a3e'); P.rect(2, 7, 12, 1, '#c99a66'); P.rect(2, 13, 12, 1, '#6a4220'); for (let y = 9; y < 13; y += 2) for (let x = 3; x < 14; x += 2) P.px(x + (y % 4 ? 1 : 0), y, '#8c5a2b');
    P.line(4, 7, 6, 3, '#6a4220'); P.line(6, 3, 10, 3, '#6a4220'); P.line(10, 3, 12, 7, '#6a4220');   // the handle
  });
}
export function witheredSprite() {
  return sprite('withered', 16, 16, P => {
    P.line(8, 13, 7, 8, PAL.witheredDark); P.line(7, 8, 5, 6, PAL.withered); P.line(7, 10, 10, 8, PAL.withered); P.px(4, 6, PAL.withered); P.px(11, 8, PAL.withered);
  });
}

// ---------- the player (16×24, feet at the bottom; 4-frame walk cycle per direction) ----------
const C = { hat: '#d9a84e', hatDark: '#b4863a', band: '#8f5a1f', skin: '#f1c7a1', skinDark: '#d9a784', hair: '#6b4423', shirt: '#c8553d', shirtDark: '#a0412f', bib: '#4a6fa5', bibDark: '#365582', strap: '#5f84bd', boots: '#4a3220', bootsDark: '#2f1f12', eye: '#2a1f14' };
export const playerBob = frame => frame % 2 ? -1 : 0;   // body lifts a pixel mid-step; overlays follow it
// A short, round farmer (22 px). pose: 'idle' (arms swing), 'carry' (both arms up), 'hold' (one arm out holding
// something; facing down the arm points at the camera so only the hand shows), 'drink' (hands to the mouth),
// 'plant' (one arm reaching down to the soil).
export const playerSprite = (dir, frame, pose = 'idle') => figureSprite(C, 'player', dir, frame, pose);
export function figureSprite(C, key, dir, frame, pose = 'idle') {
  return sprite(`${key}${dir}${frame}${pose}`, 16, PLAYER_H, P => {
    const step = frame === 1 ? 1 : frame === 3 ? -1 : 0;      // which leg is forward
    const bob = frame % 2 ? -1 : 0;
    const side = dir === 'left' || dir === 'right';
    const flip = dir === 'left';
    const X = x => flip ? 15 - x : x;
    const px = (x, y, c) => P.px(X(x), y + 2, c), rect = (x, y, w, h, c) => { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) px(x + i, y + j, c); };
    // legs + boots (rows 15–19)
    if (!side) {
      const lL = step === 1 ? 2 : 3, rL = step === -1 ? 2 : 3;
      rect(5, 15 + bob, 2, lL, C.bib); rect(5, 15 + bob + lL, 2, 2, step === 1 ? C.bootsDark : C.boots);
      rect(9, 15 + bob, 2, rL, C.bib); rect(9, 15 + bob + rL, 2, 2, step === -1 ? C.bootsDark : C.boots);
    } else {
      const f = step;
      rect(6 - f, 15 + bob, 2, 3, C.bibDark); rect(6 - f, 18 + bob, 3, 2, C.bootsDark);
      rect(8 + f, 15 + bob, 2, 3, C.bib); rect(8 + f, 18 + bob, 3, 2, C.boots);
    }
    // torso (rows 10–14): shirt + overalls bib
    rect(4, 10 + bob, 8, 5, C.shirt); rect(11, 10 + bob, 1, 5, C.shirtDark);
    rect(6, 11 + bob, 4, 4, C.bib); px(6, 11 + bob, C.strap); px(9, 11 + bob, C.strap); rect(6, 14 + bob, 4, 1, C.bibDark); px(7, 12 + bob, C.bibDark);
    // arms: shoulders at row 10, hands at row 13
    if (pose === 'carry') {
      rect(3, 4 + bob, 1, 6, C.shirt); px(3, 3 + bob, C.skin); px(3, 2 + bob, C.skin);
      rect(12, 4 + bob, 1, 6, C.shirtDark); px(12, 3 + bob, C.skin); px(12, 2 + bob, C.skin);
    } else if (pose === 'drink') {
      rect(3, 8 + bob, 1, 3, C.shirt); px(4, 8 + bob, C.skin); px(5, 8 + bob, C.skin);
      rect(12, 8 + bob, 1, 3, C.shirtDark); px(11, 8 + bob, C.skin); px(10, 8 + bob, C.skin);
    } else if (pose === 'plant') {
      if (!side) { rect(3, 10 + bob, 1, 3, C.shirt); px(3, 13 + bob, C.skin); rect(12, 10 + bob, 1, 5, C.shirtDark); px(12, 15 + bob, C.skin); }
      else { rect(3 + step, 10 + bob, 2, 3, C.shirtDark); px(3 + step, 13 + bob, C.skin); rect(11, 11 + bob, 1, 4, C.shirt); px(12, 15 + bob, C.skin); px(13, 15 + bob, C.skin); }
    } else if (pose === 'hold') {
      if (dir === 'down') { rect(3, 10 + bob, 1, 3, C.shirt); px(3, 13 + bob, C.skin); rect(12, 10 + bob, 1, 3, C.shirtDark); px(12, 13 + bob, C.skin); rect(7, 13 + bob, 2, 1, C.skin); }   // the near hand, arm foreshortened
      else if (dir === 'up') { rect(3, 10 + bob, 1, 3, C.shirt); px(3, 13 + bob, C.skin); rect(12, 10 + bob, 1, 3, C.shirtDark); px(12, 13 + bob, C.skin); }
      else { rect(3 + step, 10 + bob, 2, 3, C.shirtDark); px(3 + step, 13 + bob, C.skin); px(4 + step, 13 + bob, C.skin); px(11, 11 + bob, C.shirt); rect(12, 11 + bob, 3, 1, C.shirt); px(15, 11 + bob, C.skin); }
    } else if (!side) {
      const la = step, ra = -step;
      rect(3, 10 + bob + la, 1, 3, C.shirt); px(3, 13 + bob + la, C.skin);
      rect(12, 10 + bob + ra, 1, 3, C.shirtDark); px(12, 13 + bob + ra, C.skin);
    } else {
      rect(3 + step, 10 + bob, 2, 3, C.shirtDark); px(3 + step, 13 + bob, C.skin); px(4 + step, 13 + bob, C.skin);
      rect(11 - step, 11 + bob, 1, 2, C.shirt); px(11 - step, 13 + bob, C.skin);
    }
    // head (rows 4–9)
    rect(5, 4 + bob, 6, 6, C.skin); px(5, 9 + bob, C.skinDark); px(10, 9 + bob, C.skinDark);
    if (dir === 'up') { rect(5, 4 + bob, 6, 5, C.hair); }
    else {
      rect(5, 4 + bob, 6, 1, C.hair); px(5, 5 + bob, C.hair); px(10, 5 + bob, C.hair);
      if (dir === 'down') { px(6, 7 + bob, C.eye); px(9, 7 + bob, C.eye); px(7, 9 + bob, C.skinDark); px(8, 9 + bob, C.skinDark); }
      else { px(9, 7 + bob, C.eye); px(10, 6 + bob, C.hair); rect(5, 5 + bob, 1, 3, C.hair); }
    }
    // straw hat, or a bare head of hair
    if (C.hat) {
      rect(2, 3 + bob, 12, 1, C.hat); rect(3, 4 + bob, 10, 1, C.hatDark);
      rect(5, 1 + bob, 6, 2, C.hat); rect(4, 2 + bob, 8, 1, C.band); rect(6, 0 + bob, 4, 1, C.hat); px(6, 1 + bob, '#ecc57a');
    } else { rect(5, 3 + bob, 6, 1, C.hair); rect(4, 4 + bob, 8, 1, C.hair); px(4, 5 + bob, C.hair); px(11, 5 + bob, C.hair); }
  }, 'rgba(40,25,15,0.95)');
}

// ---------- icons ----------
export function toolIcon(tool) {
  return sprite(`tool${tool}`, 16, 16, P => {
    if (tool === 'hoe') {
      for (let i = 0; i < 9; i++) { P.px(2 + i, 13 - i, PAL.wood); P.px(3 + i, 13 - i, PAL.woodDark); }
      P.px(2, 14, PAL.woodDark);
      P.rect(9, 2, 6, 3, PAL.metal); P.rect(9, 5, 6, 1, PAL.metalDark); P.rect(10, 1, 4, 1, PAL.metalLight); P.px(9, 2, PAL.metalLight); P.px(11, 6, PAL.metalDark);
    } else {
      P.rect(3, 7, 8, 7, PAL.metal); P.rect(3, 13, 8, 1, PAL.metalDark); P.rect(10, 8, 1, 6, PAL.metalDark); P.rect(4, 8, 1, 4, PAL.metalLight);
      P.rect(4, 6, 6, 1, PAL.metalDark);
      P.px(5, 4, PAL.metalDark); P.rect(6, 3, 3, 1, PAL.metalDark); P.px(9, 4, PAL.metalDark); P.px(5, 5, PAL.metalDark); P.px(9, 5, PAL.metalDark);   // handle
      P.line(11, 9, 14, 5, PAL.metalDark); P.line(11, 8, 14, 4, PAL.metal); P.rect(13, 3, 3, 2, PAL.metal); P.px(13, 3, PAL.metalLight);          // spout + rose
      P.px(15, 6, PAL.waterLight); P.px(14, 8, PAL.water);
    }
  });
}
export function seedIcon(hue, sat, light) {
  return sprite(`seed${hue}${sat}${light}`, 16, 16, P => {
    const S = Math.max(0.45, sat) * 0.85, L = Math.max(0.32, Math.min(0.58, light * 0.85));   // a seed is a small dark version of its fruit, but still its colour
    const c = `hsl(${hue},${Math.round(S * 100)}%,${Math.round(L * 100)}%)`, dark = `hsl(${hue},${Math.round(S * 100)}%,${Math.round(Math.max(0.12, L - 0.2) * 100)}%)`, lite = `hsl(${hue},${Math.round(S * 90)}%,${Math.round(Math.min(0.85, L + 0.25) * 100)}%)`;
    const seedAt = (x, y) => { P.rect(x, y, 2, 3, c); P.px(x + 1, y + 2, dark); P.px(x, y, lite); P.px(x + 1, y + 3, dark); };   // small teardrops
    seedAt(4, 5); seedAt(8, 3); seedAt(11, 7); seedAt(6, 9); seedAt(9, 11); P.px(3, 12, dark); P.px(13, 4, dark);
  });
}
// Quick hands: a pair of gloves.
export function handsIcon() {
  return sprite('hands', 16, 16, P => {
    for (const [ox, c, d] of [[2, '#e9c48a', '#c9a062'], [9, '#e9c48a', '#c9a062']]) { P.rect(ox, 6, 5, 7, c); P.rect(ox, 12, 5, 1, d); P.rect(ox + 4, 6, 1, 7, d); for (let i = 0; i < 4; i++) P.rect(ox + i, 3 + (i === 0 || i === 3 ? 1 : 0), 1, 3, c); P.px(ox + 1, 3, '#f5dcac'); P.rect(ox - 1, 8, 1, 3, c); P.rect(ox, 13, 5, 2, '#8c5a2b'); }
  });
}
// A can of fuel: a red jerry can with a handle and a cap.
export function fuelIcon() {
  return sprite('fuel', 16, 16, P => { P.rect(4, 5, 9, 9, '#8f3730'); P.rect(5, 6, 7, 7, '#b84a3c'); P.rect(5, 6, 7, 1, '#d9736a'); P.rect(6, 3, 5, 2, '#5c6273'); P.rect(7, 2, 3, 1, '#5c6273'); P.rect(11, 3, 2, 2, '#c2c8d6'); P.rect(6, 9, 5, 2, '#f6c453'); P.rect(4, 14, 9, 1, 'rgba(30,20,10,0.25)'); });
}
// A coin, for the bank's rows.
export function coinIcon() {
  return sprite('coin', 16, 16, P => { P.rect(4, 3, 8, 10, '#b4863a'); P.rect(3, 4, 10, 8, '#b4863a'); P.rect(5, 4, 6, 8, PAL.gold); P.rect(4, 5, 8, 6, PAL.gold); P.rect(5, 4, 4, 1, '#fff1b8'); P.rect(4, 5, 1, 3, '#fff1b8'); P.rect(7, 6, 2, 4, '#b4863a'); P.rect(4, 14, 9, 1, 'rgba(30,20,10,0.25)'); });
}
// A bag of fertiliser (16×16): a tied sack in the colour of its strongest stat, one band per grade, a gold star per sure star.
// look: {stat, grade, stars} from fertiliser.fertLook; with nothing it is the plain brown bag.
const STAT_COLOUR = { speed: ['#8fd36a', '#5fa14a'], quality: ['#f6c453', '#b57a1f'], yield: ['#e8a23b', '#b86d1f'], waterKeep: ['#7fb4e6', '#3f72a8'], hardiness: ['#c47a5a', '#8a4a32'], mutation: ['#c47fe6', '#8a5cc0'] };
// The key cap over the station E opens (9×9): a cream face, a darker side below it, an E on it.
export function keyCapSprite() {
  return sprite('keycap2', 9, 9, P => {
    P.rect(1, 0, 7, 9, '#3b2314'); P.rect(0, 1, 9, 7, '#3b2314');                                  // the outline, corners clipped
    P.rect(1, 1, 7, 6, '#f5e6c3'); P.rect(1, 1, 7, 1, '#fffaf0'); P.rect(1, 7, 7, 1, '#c9a878');   // face, its lit edge, the side
    const ink = '#3b2314'; P.rect(3, 2, 1, 5, ink); P.rect(4, 2, 2, 1, ink); P.rect(4, 4, 1, 1, ink); P.rect(4, 6, 2, 1, ink);   // E
  });
}
export function fertIcon(look = null) {
  const stat = look?.stat || null, grade = look?.grade || 1, stars = look?.stars || 0;
  // Build 88: the original open sack again. Plain compost is drawn exactly as it always was; a bag with a strong stat gets
  // flecks in that stat's colour and a stitched label in it, a pip on the label per grade, and gold stars on the rim.
  return sprite(`fert2:${stat}:${grade}:${stars}`, 16, 16, P => {
    P.rect(3, 5, 10, 9, '#5a4a2a'); P.rect(3, 4, 10, 1, '#7a6a3a');                                   // the sack and its rolled rim
    if (!stat) { P.px(5, 7, '#8bc34a'); P.px(9, 9, '#8bc34a'); P.px(7, 11, '#c9b07c'); }
    else {
      const [c, cd] = STAT_COLOUR[stat];
      P.px(5, 6, c); P.px(8, 7, c); P.px(10, 6, c);                                                     // flecks
      P.rect(5, 9, 6, 4, cd); P.rect(6, 10, 4, 2, c);                                                   // the label
      for (let g = 0; g < Math.min(3, grade); g++) P.px(6 + g, 11, '#fff8e0');                          // grade pips
    }
    for (let k = 0; k < stars; k++) P.px(5 + k * 3, 4, PAL.gold);                                       // stars on the rim
  });
}

// ---------- the market ----------
// A market stall (32×28 over a two-tile footprint): two posts, a plank counter along the bottom and a striped awning
// with a scalloped edge. variant 0 is yours (red), 1 the seed merchant (green), 2 the hardware stall (blue).
export function stallSprite(variant = 0) {
  return sprite(`stall${variant}`, 32, 28, P => {
    const stripe = ['#c8553d', '#5fa14a', '#4f8fcf'][variant], stripeDark = ['#a0412f', '#3f7a1f', '#3f72a8'][variant], cloth = '#f5e6c3', clothDark = '#e0cda2';
    P.rect(2, 10, 2, 18, PAL.woodDark); P.rect(28, 10, 2, 18, PAL.woodDark); P.px(2, 10, PAL.woodLight); P.px(28, 10, PAL.woodLight);   // posts
    P.rect(0, 19, 32, 7, PAL.wood); P.rect(0, 19, 32, 1, PAL.woodLight); P.rect(0, 25, 32, 1, PAL.woodDark); P.rect(0, 22, 32, 1, PAL.woodDark);   // the counter
    P.rect(1, 26, 30, 2, PAL.woodDark); P.rect(3, 27, 26, 1, '#2f1f12');                                                                    // its shadow and feet
    for (let x = 0; x < 32; x++) { const s = Math.floor(x / 4) % 2; P.rect(x, 2, 1, 8, s ? cloth : stripe); P.px(x, 2, s ? clothDark : stripeDark); P.px(x, 9, s ? clothDark : stripeDark); }   // the awning
    for (let x = 0; x < 32; x += 4) { P.rect(x + 1, 10, 2, 1, Math.floor(x / 4) % 2 ? cloth : stripe); P.px(x + 1, 11, Math.floor(x / 4) % 2 ? clothDark : stripeDark); P.px(x + 2, 11, Math.floor(x / 4) % 2 ? clothDark : stripeDark); }   // scallops
    P.rect(0, 1, 32, 1, PAL.woodDark); P.rect(0, 0, 32, 1, PAL.wood);                                                                       // the rail the awning hangs from
    P.rect(6, 12, 20, 5, PAL.woodLight); P.rect(6, 12, 20, 1, '#c99a66'); P.rect(6, 16, 20, 1, PAL.woodDark);                                 // the name board under the awning
    if (variant === 0) { P.rect(9, 13, 4, 3, '#e8a23b'); P.rect(14, 13, 4, 3, '#8fd36a'); P.rect(19, 13, 4, 3, '#e86a6a'); }                // yours: three bright squares, produce
    else if (variant === 1) { for (let i = 0; i < 4; i++) { P.px(10 + i * 4, 14, '#5e4a2a'); P.px(11 + i * 4, 13, '#8fd36a'); } }            // seeds: seeds and sprouts
    else { P.rect(10, 13, 2, 3, PAL.metal); P.rect(14, 14, 5, 1, PAL.metalDark); P.rect(21, 13, 2, 3, PAL.gold); }                          // hardware: a bolt, a pipe, a can
  }, 'rgba(40,25,15,0.95)');
}
// The signpost at the end of the track, and the one at the market: a board with a word.
// Cobbles for the square (16×16): rounded stones in a warm grey.
export function cobbleTile(variant = 0) {
  return sprite(`cobble${variant}`, 16, 16, P => {
    P.rect(0, 0, 16, 16, '#8f8470');
    const r = makeRng(1300 + variant);
    for (let y = 0; y < 16; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 16; x += 4) { const c = r.chance(0.3) ? '#c3b89f' : r.chance(0.5) ? '#b4a991' : '#aa9f88'; P.rect(x, y, 3, 3, c); P.px(x, y, '#cfc4ab'); }
  });
}
// The fountain (32×32): a stone basin, a column with a bowl on top, water that moves between two frames.
export function fountainSprite(frame = 0) {
  return sprite(`fountain${frame}`, 32, 32, P => {
    const stone = '#9a968c', dark = '#6e6b63', light = '#bdb9ae', water = PAL.water, wl = PAL.waterLight;
    P.rect(2, 20, 28, 10, dark); P.rect(3, 19, 26, 10, stone); P.rect(4, 19, 24, 1, light); P.rect(0, 23, 32, 6, dark); P.rect(1, 22, 30, 6, stone); P.rect(2, 22, 28, 1, light);   // the basin
    P.rect(5, 23, 22, 4, water); for (let i = 0; i < 6; i++) P.px(6 + i * 4 + (frame ? 2 : 0), 24 + (i % 2), wl);                                                                // water in the basin
    P.rect(14, 8, 4, 15, dark); P.rect(15, 8, 2, 15, stone); P.px(15, 8, light);                                                                                                  // the column
    P.rect(10, 6, 12, 3, dark); P.rect(11, 5, 10, 3, stone); P.rect(12, 5, 8, 1, light); P.rect(13, 6, 6, 1, water);                                                             // the bowl
    P.rect(15, 1, 2, 4, wl); P.px(frame ? 13 : 12, 3, wl); P.px(frame ? 18 : 19, 3, wl); P.px(frame ? 11 : 12, 6 + (frame ? 1 : 0), wl); P.px(frame ? 20 : 19, 6 + (frame ? 0 : 1), wl);   // the spout and its spray
    P.px(9, 20 + (frame ? 1 : 0), wl); P.px(22, 21 - (frame ? 1 : 0), wl);                                                                                                        // drips into the basin
    P.rect(2, 30, 28, 2, 'rgba(30,20,10,0.25)');
  });
}
// Your tent (64 wide): the back half is the striped roof and the back wall, drawn behind you; the front half is the
// counter with the name board, drawn in front. Together they cover three tile rows.
export function tentBackSprite() {
  return sprite('tentBack', 64, 32, P => {
    const red = '#c8553d', redDark = '#a0412f', cloth = '#f5e6c3', clothDark = '#e0cda2';
    for (let y = 0; y < 14; y++) { const x0 = 8 - Math.min(8, y), w = 48 + Math.min(16, y * 2); for (let x = x0; x < x0 + w; x++) { const s = Math.floor((x + 2) / 6) % 2; P.px(x, y + 2, s ? cloth : red); } }   // the roof, peaking
    P.rect(0, 15, 64, 2, redDark); for (let x = 0; x < 64; x += 6) { P.rect(x + 1, 17, 4, 1, Math.floor((x + 2) / 6) % 2 ? clothDark : red); }                                     // the hem and scallops
    P.rect(2, 18, 60, 14, '#e7d7b2'); P.rect(2, 18, 60, 1, clothDark); for (let x = 6; x < 60; x += 10) P.rect(x, 19, 1, 13, 'rgba(120,90,60,0.18)');                              // the back wall
    P.rect(1, 14, 2, 18, PAL.woodDark); P.rect(61, 14, 2, 18, PAL.woodDark); P.px(1, 14, PAL.woodLight); P.px(61, 14, PAL.woodLight);                                              // the poles
    P.px(31, 0, PAL.gold); P.px(32, 0, PAL.gold); P.px(31, 1, '#d9a84e'); P.px(32, 1, '#d9a84e');                                                                                  // the finial
  });
}
export function tentFrontSprite() {
  return sprite('tentFront', 64, 16, (P, ctx) => {
    P.rect(0, 2, 64, 9, PAL.wood); P.rect(0, 2, 64, 1, PAL.woodLight); P.rect(0, 10, 64, 1, PAL.woodDark); P.rect(0, 6, 64, 1, PAL.woodDark);   // the counter
    P.rect(1, 11, 62, 2, PAL.woodDark); P.rect(3, 12, 58, 1, '#2f1f12');                                                                     // its shadow and feet
    P.rect(20, 0, 24, 5, PAL.woodLight); P.rect(20, 0, 24, 1, '#c99a66'); P.rect(20, 4, 24, 1, PAL.woodDark);                                // the name board hanging over the counter
    drawText(ctx, 'FARM', 22, 0, '#3b2314', 1);
  }, 'rgba(40,25,15,0.95)');
}
// A seat (16×12): a plank bench on two legs.
export function seatSprite() {
  return sprite('seat', 16, 12, P => {
    P.rect(1, 4, 14, 3, PAL.wood); P.rect(1, 4, 14, 1, PAL.woodLight); P.rect(1, 6, 14, 1, PAL.woodDark);
    P.rect(2, 7, 2, 4, PAL.woodDark); P.rect(12, 7, 2, 4, PAL.woodDark); P.rect(1, 1, 14, 2, PAL.woodDark); P.rect(1, 1, 14, 1, PAL.wood);
  });
}
export function roadSignSprite(label = 'MARKET') {
  return sprite('roadsign' + label, 36, 24, (P, ctx) => {
    P.rect(17, 11, 2, 13, PAL.woodDark); P.px(17, 13, PAL.wood);
    P.rect(1, 1, 34, 11, PAL.woodLight); P.rect(1, 1, 34, 1, '#c99a66'); P.rect(1, 11, 34, 1, PAL.woodDark); P.rect(1, 1, 1, 11, PAL.wood); P.rect(34, 1, 1, 11, PAL.woodDark);
    drawText(ctx, label, Math.round((36 - textWidth(label, 1)) / 2), 4, '#3b2314', 1);
    P.px(2, 2, PAL.metalDark); P.px(33, 2, PAL.metalDark); P.px(2, 10, PAL.metalDark); P.px(33, 10, PAL.metalDark);
  });
}
// Shoppers: the farmer's build in other clothes. Six looks; two go bare-headed.
const VILLAGERS = [
  { shirt: '#5f84bd', shirtDark: '#3f5f94', bib: '#6b4423', bibDark: '#4a2f16', strap: '#8a6a44', hat: '#8a6a44', hatDark: '#6b4e2e', band: '#3b2314' },
  { shirt: '#8fd36a', shirtDark: '#5fa14a', bib: '#3b2314', bibDark: '#2a1a0c', strap: '#5e4a2a', hat: null, hair: '#2a1f14' },
  { shirt: '#e86a6a', shirtDark: '#b84848', bib: '#4a6fa5', bibDark: '#365582', strap: '#5f84bd', hat: '#f1f1f1', hatDark: '#cfcfcf', band: '#e86a6a', skin: '#c58c5a', skinDark: '#a06e42', hair: '#2a1f14' },
  { shirt: '#f6c453', shirtDark: '#d9a84e', bib: '#4a3220', bibDark: '#2f1f12', strap: '#6b4423', hat: null, hair: '#d9a84e', skin: '#f1c7a1' },
  { shirt: '#c47fe6', shirtDark: '#9a5cc0', bib: '#2a2a2a', bibDark: '#111', strap: '#555', hat: '#4a3220', hatDark: '#2f1f12', band: '#8a6a44', skin: '#8d5a3a', skinDark: '#6e4328', hair: '#1a1008' },
  { shirt: '#bfe9f7', shirtDark: '#8cc6f0', bib: '#8c5a2b', bibDark: '#6b4423', strap: '#b07a3e', hat: '#5fa14a', hatDark: '#3f7a1f', band: '#f6c453', hair: '#6b4423' },
];
export function villagerSprite(variant, dir, frame) { return figureSprite({ ...C, ...VILLAGERS[variant % VILLAGERS.length] }, `villager${variant}`, dir, frame, 'idle'); }
