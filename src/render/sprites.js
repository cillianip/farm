// Code-drawn tiles, trees, the house, objects and the player. Everything is cached as a canvas at 1 pixel = 1 unit.
import { PAL, pixelDrawer, makeCanvas } from './palette.js';
import { makeRng } from '../rng.js';
import { drawText } from './font.js';

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
export function crateSprite(level = 0) {
  return sprite(`crate${level}`, 20, 18, P => {
    P.rect(2, 7, 16, 10, PAL.wood);
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
export function chestSprite(open = false) {
  return sprite(`chest${open ? 'o' : 'c'}`, 18, 16, P => {
    P.rect(1, 7, 16, 8, PAL.wood); P.rect(1, 14, 16, 1, PAL.woodDark); P.rect(1, 7, 1, 8, PAL.woodDark); P.rect(16, 7, 1, 8, PAL.woodDark);   // body
    P.rect(2, 11, 14, 1, PAL.woodDark); P.rect(2, 8, 14, 1, PAL.woodLight);                                                               // boards
    P.rect(4, 7, 1, 8, PAL.metalDark); P.rect(13, 7, 1, 8, PAL.metalDark); P.px(4, 9, PAL.metal); P.px(13, 13, PAL.metal);             // iron bands
    if (!open) {
      P.rect(1, 3, 16, 4, PAL.woodLight); P.rect(2, 2, 14, 1, PAL.woodLight); P.rect(3, 2, 12, 1, '#c99a66'); P.rect(1, 6, 16, 1, PAL.woodDark);   // domed lid
      P.px(1, 3, PAL.wood); P.px(16, 3, PAL.wood); P.rect(4, 2, 1, 5, PAL.metalDark); P.rect(13, 2, 1, 5, PAL.metalDark);
      P.rect(8, 5, 2, 3, PAL.gold); P.px(8, 7, '#b57a1f'); P.px(9, 5, '#fff1b8');   // brass clasp
    } else {
      P.rect(2, 5, 14, 3, '#2a1a0c'); P.rect(2, 5, 14, 1, '#1d1208'); P.rect(1, 5, 1, 3, PAL.woodDark); P.rect(16, 5, 1, 3, PAL.woodDark);   // the dark inside, walls up to the hinge
      P.rect(1, 1, 16, 4, PAL.woodLight); P.rect(2, 1, 14, 1, '#c99a66'); P.rect(1, 4, 16, 1, PAL.woodDark); P.rect(4, 1, 1, 4, PAL.metalDark); P.rect(13, 1, 1, 4, PAL.metalDark);   // lid tipped back, sitting on the hinge
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
export function fertOverlay() {
  return sprite('fertOverlay', 16, 16, P => {
    P.rect(0, 0, 16, 16, 'rgba(236,216,160,0.2)');
    P.rect(1, 1, 14, 2, 'rgba(236,216,160,0.14)');
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
export const stationIcon = kind => kind === 'generator' ? fitIcon('generator', generatorSprite(0)) : kind === 'picker' ? fitIcon('picker', pickerSprite(0)) : kind === 'hopper' ? fitIcon('hopper', hopperSprite(false)) : lineSprite(10, false);
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
// The generator (16×20): a boxed motor in red iron on skids, a coil window, a stack; frames puff.
export function generatorSprite(frame = 0) {
  return sprite(`generator${frame}`, 16, 20, P => {
    P.rect(2, 18, 13, 2, 'rgba(30,20,10,0.28)');
    P.rect(2, 9, 12, 9, PAL.roofDark); P.rect(3, 10, 10, 7, PAL.roof); P.rect(3, 10, 10, 1, '#d9736a');   // the block
    P.rect(4, 12, 4, 4, PAL.metalDark); P.rect(5, 13, 2, 2, frame ? PAL.gold : PAL.metal);          // the coil window
    P.rect(9, 12, 3, 1, PAL.metalDark); P.rect(9, 14, 3, 1, PAL.metalDark);                           // vents
    P.rect(12, 3, 2, 7, PAL.metalDark); P.px(12, 3, PAL.metal); P.rect(11, 2, 4, 1, PAL.metalDark);   // the stack
    P.rect(1, 15, 1, 3, PAL.woodDark); P.rect(14, 15, 1, 3, PAL.woodDark);                           // the skids
    if (frame) { const y = frame === 1 ? 0 : 1; P.px(13, y, 'rgba(120,120,130,0.8)'); P.px(14, y, 'rgba(120,120,130,0.5)'); }   // a puff
  });
}
// The picker (16×20): a post with a jointed arm and a basket at its foot; frames swing the arm; `full` shows crops.
export function pickerSprite(frame = 0, full = false) {
  return sprite(`picker${frame}${full ? 'f' : ''}`, 16, 20, P => {
    P.rect(4, 18, 9, 2, 'rgba(30,20,10,0.28)');
    P.rect(7, 6, 2, 12, PAL.metalDark); P.rect(7, 6, 1, 12, PAL.metal);                               // the post
    P.rect(6, 5, 4, 2, PAL.metalDark); P.px(6, 5, PAL.metalLight);                                     // the joint
    if (frame === 1) { P.line(8, 6, 13, 2, PAL.metal); P.line(13, 2, 15, 4, PAL.metalDark); P.px(15, 5, PAL.outline); }   // arm up and out
    else { P.line(8, 6, 2, 9, PAL.metal); P.line(2, 9, 1, 13, PAL.metalDark); P.px(1, 14, PAL.outline); }             // arm down to a bed
    P.rect(9, 13, 6, 5, PAL.woodDark); P.rect(10, 14, 4, 3, PAL.wood);                                // the basket
    if (full) { P.px(10, 13, '#e86a6a'); P.px(12, 13, '#f6c453'); P.px(13, 13, '#8fd36a'); }
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
export function playerSprite(dir, frame, pose = 'idle') {
  return sprite(`player${dir}${frame}${pose}`, 16, PLAYER_H, P => {
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
    // straw hat
    rect(2, 3 + bob, 12, 1, C.hat); rect(3, 4 + bob, 10, 1, C.hatDark);
    rect(5, 1 + bob, 6, 2, C.hat); rect(4, 2 + bob, 8, 1, C.band); rect(6, 0 + bob, 4, 1, C.hat); px(6, 1 + bob, '#ecc57a');
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
export function fertIcon() {
  return sprite('fert', 16, 16, P => { P.rect(3, 5, 10, 9, '#5a4a2a'); P.rect(3, 4, 10, 1, '#7a6a3a'); P.px(5, 7, '#8bc34a'); P.px(9, 9, '#8bc34a'); P.px(7, 11, '#c9b07c'); });
}
