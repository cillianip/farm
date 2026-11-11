// Draws any genome as a 16×16 pixel plant for 4 growth stages (+ withered). Each species × stage is drawn once and cached.
// Families decide the foliage template and where produce sits; the archetype + shape genes decide what the produce looks
// like. Every archetype is drawn to read as its canonical vegetable at 16 px (carrot, potato, onion, pumpkin, corn, wheat,
// lettuce, pea pod, lavender spike, ...), with the numeric genes bending it: width, elongation, tip, curve, ribs, bumps.
import { hsl, pixelDrawer, makeCanvas, PAL } from './palette.js';
import { makeRng, hashString } from '../rng.js';
import { canonical, shownSurface } from '../genetics.js';

const cache = new Map();

export function cropSprite(species, stage, v = 0) {
  const key = species.id + ':' + stage + (stage === 0 ? ':' + v : '');
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(16, 16);
  drawCrop(pixelDrawer(ctx), species.genome, stage, v);
  cache.set(key, c);
  return c;
}
// Produce icon alone. Cached. The inventory uses one fixed size so slots stay readable; sized (Build 87) draws it at the
// size gene instead, a pea small and a giant pumpkin filling the sprite, for produce lying in the world (belts, crates, stalls).
export function produceScale(g) { return 2.5 + g.size * 4.5; }
export function produceSprite(species, sized = false) {
  const key = species.id + (sized ? ':sz' : ':icon');
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(16, 16);
  const P = pixelDrawer(ctx), g = species.genome;
  fitted(P, (Q, k) => drawProduce(Q, g, 8, 8, (sized ? produceScale(g) : 6) - k, colours(g), 0, 16, 6 - k));
  cache.set(key, c);
  return c;
}

// Dried: the same produce smaller, browner and duller, with a crease. Cached.
export function driedSprite(species, sized = false) {
  const key = species.id + (sized ? ':dsz' : ':dried');
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(16, 16);
  const P = pixelDrawer(ctx), g = species.genome;
  const g2 = { ...g, hue1: g.hue1 - 10, sat1: g.sat1 * 0.55, light1: Math.max(0.18, g.light1 * 0.7), hue2: g.hue2 - 10, sat2: g.sat2 * 0.5, light2: Math.max(0.15, g.light2 * 0.7), traits: {} };
  fitted(P, (Q, k) => drawProduce(Q, g2, 8, 9, (sized ? produceScale(g) * 0.75 : 4.5) - k, colours(g2), 0, 16, 6 - k));
  P.px(7, 8, 'rgba(40,20,5,0.35)'); P.px(8, 10, 'rgba(40,20,5,0.35)'); P.px(9, 7, 'rgba(255,230,180,0.25)');
  cache.set(key, c);
  return c;
}
// A lone produce drawn a size smaller until it and its outline fit the 16 px sprite, then slid inside it.
function fitted(P, draw) {
  for (let k = 0; ; k++) {
    const pts = []; draw({ px: (x, y, c) => pts.push([x | 0, y | 0, c]) }, k);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    if ((x1 - x0 < 16 && y1 - y0 < 16) || k >= 3) {
      const dx = x0 < 0 ? -x0 : x1 > 15 ? 15 - x1 : 0, dy = y0 < 0 ? -y0 : y1 > 15 ? 15 - y1 : 0;
      for (const [x, y, c] of pts) P.px(x + dx, y + dy, c);
      return;
    }
  }
}
export function colours(g) {
  const golden = g.traits?.golden;
  const h1 = golden ? 45 : g.hue1, s1 = golden ? 0.95 : g.sat1, l1 = golden ? 0.55 : g.light1;
  return {
    main: hsl(h1, s1, l1), dark: hsl(h1, s1, Math.max(0.1, l1 - 0.18)), shade: hsl(h1, s1, Math.max(0.1, l1 - 0.09)),
    light: hsl(h1, Math.min(1, s1), Math.min(0.95, l1 + 0.17)), outline: hsl(h1, Math.min(1, s1 + 0.1), Math.min(0.26, Math.max(0.06, l1 - 0.32))),
    second: hsl(g.hue2, g.sat2, g.light2),
    leaf: hsl(g.leafHue, 0.55, 0.38), leafDark: hsl(g.leafHue, 0.55, 0.27), leafLight: hsl(g.leafHue, 0.6, 0.5),
    stem: hsl(g.leafHue - 20, 0.4, 0.3), leafLine: hsl(g.leafHue - 10, 0.5, 0.16), glow: hsl(h1, 0.9, 0.8, 0.45), frost: '#dff3ff',
  };
}
const DEAD = { leafLine: '#3a3229', main: PAL.withered, dark: PAL.witheredDark, shade: PAL.witheredDark, light: '#a5957a', outline: '#4a4034', second: PAL.witheredDark, leaf: PAL.withered, leafDark: PAL.witheredDark, leafLight: '#a5957a', stem: PAL.witheredDark, glow: 'transparent', frost: 'transparent' };

// Where the seed landed: four arrangements of the three dots, so a row of beds does not repeat.
const SEED_DOTS = [[[6, 12], [9, 11], [8, 13]], [[4, 7], [7, 8], [5, 10]], [[9, 5], [11, 7], [10, 9]], [[7, 4], [5, 6], [8, 7]]];
export function drawCrop(P, g, stage, v = 0) {
  const C = stage === 'dead' ? DEAD : colours(g);
  const r = makeRng(hashString(canonical(g)));
  if (stage === 0) { const [a, b, c] = SEED_DOTS[v % SEED_DOTS.length]; P.px(a[0], a[1], PAL.soilDark); P.px(b[0], b[1], PAL.soilDark); P.px(c[0], c[1], '#5e4a2a'); return; }
  if (stage === 1) { P.rect(8, 10, 1, 4, C.stem); P.rect(6, 9, 2, 2, C.leaf); P.rect(9, 10, 2, 2, C.leaf); P.px(6, 9, C.leafLight); P.px(10, 10, C.leafLight); return; }
  if (stage === 'dead') { drawFoliage(P, g, 0.7, C, r); for (let i = 0; i < 4; i++) P.px(r.int(3, 12), r.int(4, 12), 'transparent'); return; }
  const full = stage === 3;
  const anchors = drawFoliage(P, g, full ? 1 : 0.7, C, r);
  if (full) drawProduceSet(P, g, C, r, anchors);
}

// Foliage per family. Returns anchor points for the produce when the layout decides them (grain, flower), else null.
function drawFoliage(P, g, scale, C, r) {
  const h = Math.round((4 + g.height * 8) * scale);           // plant height in px
  const dens = g.leafDensity;
  switch (g.family) {
    case 'root': {
      const n = 3 + Math.round(dens * 3);
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i - (n - 1) / 2) * (Math.PI / (n + 1.2));
        const len = h * (0.75 + 0.3 * r());
        const tx = 8 + Math.cos(a) * len, ty = 12 - Math.sin(a) * len * 0.95 - 1;
        leaf(P, g, 8, 12, tx, ty, C);
      }
      return null;
    }
    case 'bush': {
      const rad = Math.max(2, Math.round(h * 0.45));
      const cy = 13 - rad;
      P.disc(8, cy, rad, C.leaf);
      for (let i = 0; i < rad * rad * (0.6 + dens); i++) { const a = r() * Math.PI * 2, d = r() * rad; P.px(8 + Math.cos(a) * d, cy + Math.sin(a) * d, r() < 0.5 ? C.leafLight : C.leafDark); }
      for (let a = 0; a < Math.PI * 2; a += 0.5) if (Math.sin(a) > -0.3) P.px(Math.round(8 + Math.cos(a) * rad), Math.round(cy + Math.sin(a) * rad), C.leafDark);   // darker rim
      P.px(8 - 1, cy - rad + 1, C.leafLight);
      P.rect(7, 13, 2, 1, C.stem);
      return null;
    }
    case 'vine': {
      const top = 13 - h;
      P.rect(8, top, 1, 14 - top, PAL.woodDark);                     // stake
      P.rect(7, top, 3, 1, PAL.wood);
      P.line(7, 13, 8, top + 1, C.stem);
      for (let y = 12; y > top; y -= 2) { const side = ((y / 2) | 0) % 2 ? -1 : 1; if (r() < 0.4 + dens * 0.6) leaf(P, g, 8, y, 8 + side * 3, y - 1, C); }
      return null;
    }
    case 'grain': {
      const n = 3 + Math.round(dens * 2);
      const anchors = [];
      for (let i = 0; i < n; i++) {
        const x = 8 + Math.round((i - (n - 1) / 2) * 3.6);   // a stalk every four pixels, so three-wide heads keep a gap between them
        const top = 14 - Math.round(h * (0.85 + r() * 0.3));
        P.rect(x, top, 1, 15 - top, i % 2 ? C.stem : C.leafDark);
        leaf(P, g, x, 12, x + (i % 2 ? 2 : -2), 9, C);
        anchors.push([x, top]);
      }
      return anchors;
    }
    case 'flower': {
      const n = g.archetype === 'cluster' ? Math.min(3, Math.max(1, Math.round(g.count / 2))) : 1;
      const anchors = [];
      for (let i = 0; i < n; i++) {
        const x = 8 + Math.round((i - (n - 1) / 2) * 4);
        const top = 14 - Math.round(h * (0.9 + (i % 2) * 0.2));
        P.rect(x, top, 1, 15 - top, C.stem);
        leaf(P, g, x, 12, x - 3, 10, C); if (scale === 1 || i === 0) leaf(P, g, x, 10, x + 3, 8, C);
        if (scale < 1) P.disc(x, top, 1, C.leafLight);
        anchors.push([x, top]);
      }
      return anchors;
    }
    case 'gourd': {
      const spots = [[4, 11], [11, 10], [7, 12], [13, 13], [2, 13]];
      const n = 2 + Math.round(dens * 3);
      P.line(3, 13, 13, 12, C.stem); P.line(5, 13, 8, 10, C.stem);
      for (let i = 0; i < n; i++) { const [x, y] = spots[i]; const rad = Math.max(1, Math.round(1 + h * 0.15)); P.disc(x, y - 1, rad, C.leaf); P.px(x - 1, y - 2, C.leafLight); P.px(x, y, C.leafDark); P.px(x + rad, y - 1, C.leafDark); }
      return null;
    }
  }
  return null;
}
function leaf(P, g, x0, y0, x1, y1, C) {
  switch (g.leafShape) {
    case 'round': P.line(x0, y0, x1, y1, C.stem); P.disc(Math.round(x1), Math.round(y1), 1, C.leaf); P.px(Math.round(x1) - 1, Math.round(y1) - 1, C.leafLight); P.px(Math.round(x1) + 1, Math.round(y1) + 1, C.leafDark); break;
    case 'pointed': P.line(x0, y0, x1, y1, C.leaf); P.px(Math.round((x0 + x1) / 2) + 1, Math.round((y0 + y1) / 2), C.leafDark); P.px(Math.round(x1), Math.round(y1), C.leafLight); break;
    case 'frond': P.line(x0, y0, x1, y1, C.leafDark); { const mx = (x0 + x1) / 2, my = (y0 + y1) / 2; P.px(mx + 1, my - 1, C.leaf); P.px(mx - 1, my - 1, C.leaf); P.px(x1 + 1, y1, C.leafLight); P.px(x1 - 1, y1 + 1, C.leaf); P.px(x1, y1 - 1, C.leafLight); } break;
    case 'blade': P.line(x0, y0, x1, y1 - 2, C.leaf); P.line(x0 + (x1 > x0 ? 1 : -1), y0, x1, y1 - 1, C.leafDark); P.px(x1, y1 - 3, C.leafLight); break;
  }
}

// where produce sits for each family, for up to 8 items
export const PLACES = {
  root:   [[8, 12], [4, 12], [12, 12], [2, 13], [14, 13], [6, 13], [10, 13], [8, 14]],
  bush:   [[8, 9], [5, 10], [11, 10], [7, 12], [10, 12], [4, 12], [12, 12], [8, 7]],
  vine:   [[6, 6], [10, 9], [6, 11], [10, 4], [11, 12], [5, 8], [10, 7], [6, 4]],
  gourd:  [[9, 11], [4, 12], [13, 12], [7, 13], [11, 13], [2, 13], [14, 13], [8, 9]],
};
function drawProduceSet(P, g, C, r, anchors) {
  const fam = g.family;
  const count = fam === 'flower' ? 1 : g.count;
  const base = 2.5 + g.size * 4.5;
  const size = Math.max(2, Math.round(base * (count >= 6 ? 0.5 : count >= 4 ? 0.65 : count >= 2 ? 0.8 : 1)));
  if (fam === 'grain' && anchors) {
    // one head per stalk (up to count), on top of the stalk; ears hang on the stalk instead
    const n = Math.min(anchors.length, Math.max(1, count));
    const order = anchors.map((a, i) => i).sort((a, b) => Math.abs(a - (anchors.length - 1) / 2) - Math.abs(b - (anchors.length - 1) / 2));
    for (let k = 0; k < n; k++) { const [x, top] = anchors[order[k]]; if (g.archetype === 'ear') drawProduce(P, g, x + (k % 2 ? 1 : -1), top + 4, Math.max(2, size - 1), C, r()); else drawProduce(P, g, x, Math.max(2, top - 1), Math.max(2, size - 1), C, r()); }
  } else if (fam === 'flower' && anchors) {
    for (const [x, top] of anchors) drawProduce(P, g, x, Math.max(size / 2 | 0, top - 1), size + Math.round(g.count / 3), C, r());
  } else {
    const places = PLACES[fam] || PLACES.bush;
    for (let i = 0; i < Math.min(count, 8); i++) {
      const [x, y] = places[i];
      if (fam === 'root') {
        const sz = size + 1;                                             // roots show only their shoulder, so draw them bigger
        drawProduce(P, g, x, y + Math.round(sz * 0.4), sz, C, r(), 15);
        P.px(x - Math.round(sz * 0.6) - 1, 14, PAL.soilDark); P.px(x + Math.round(sz * 0.6) + 1, 14, PAL.soilDark);   // the little mound
      } else drawProduce(P, g, x, y, size, C, r());
    }
  }
  if (g.traits.glowing) { for (let i = 0; i < 6; i++) P.px(r.int(2, 13), r.int(2, 12), C.glow); }
  if (g.traits.frostHardy) { for (let i = 0; i < 4; i++) P.px(r.int(2, 13), r.int(3, 12), C.frost); }
}

// Draw one produce item of pixel size `s` centred at (cx,cy). clipY: nothing below this row (roots). icon: drawn alone
// in the inventory, so allow a bigger shape and add the decoration that makes it readable on its own.
// Drawn into a buffer first (Build 101), then the skin goes on, then one closed outline round the whole silhouette, crown
// and stem included, so nothing bleeds into the leaves or the ground behind it.
export function drawProduce(P, g, cx, cy, s, C, seed = 0, clipY = 16, icon = false) {
  const cap = icon === true ? 6 : icon || 0;
  const ext = v => v + Math.max(0, v - 0.8) * 1.5;           // past 0.8 a gene shows more, so a bred extreme looks it
  const maxW = icon ? cap : 4 + (g.width > 0.85 ? 1 : 0), maxH = icon ? cap : 5 + (g.elongation > 0.85 ? 1 : 0);
  const w = Math.min(maxW, Math.max(1, Math.round(s * (0.6 + ext(g.width) * 0.6))));
  const h = Math.min(maxH, Math.max(1, Math.round(s * (0.6 + ext(g.elongation) * 0.8))));
  const r = makeRng(hashString(canonical(g)) + Math.floor(seed * 1000));
  const buf = new Map(), K = (x, y) => (y + 64) * 256 + (x + 64);
  const put = (x, y, c) => { buf.set(K(Math.floor(x), Math.floor(y)), c); };
  const disc = (x0, y0, rad, c) => { for (let y = -rad; y <= rad; y++) for (let x = -rad; x <= rad; x++) if (x * x + y * y <= rad * rad + rad * 0.5) put(x0 + x, y0 + y, c); };
  const pattern = (x, y, base) => {
    if (g.traits.golden && ((x + y) % 5 === 0)) return C.light;
    if (g.pattern === 'stripes' && y % 2 === 0) return C.second;
    if (g.pattern === 'spots' && ((((x * 73856093) ^ (y * 19349663) ^ ((seed * 10 | 0) * 83492791)) >>> 0) % 4 === 0)) return C.second;
    if (g.pattern === 'gradient' && y < cy - h / 2 + h * 0.35) return C.second;
    return base;
  };
  // Generic shaded blob: outline on the bottom/right edge, highlight top-left, a shade band bottom-right.
  const fillShape = (test, opts = {}) => {
    for (let y = -h - 2; y <= h + 2; y++) for (let x = -w - 2; x <= w + 2; x++) {
      if (!test(x, y)) continue;
      const edge = !test(x + 1, y) || !test(x, y + 1) || !test(x - 1, y) || !test(x, y - 1);
      let c;
      if (edge) c = (x > 0 || y > 0) ? C.dark : pattern(cx + x, cy + y, C.main);
      else if (x < 0 && y < 0 && (x + 1) * (x + 1) + (y + 1) * (y + 1) <= Math.max(1, (w + h) / 4)) c = C.light;
      else if (!opts.flat && (x > w * 0.45 || y > h * 0.45)) c = pattern(cx + x, cy + y, C.shade);
      else c = pattern(cx + x, cy + y, C.main);
      put(cx + x, cy + y, c);
    }
  };
  const ell = (x, y, rw, rh) => (x * x) / (rw * rw + 0.01) + (y * y) / (rh * rh + 0.01) <= 1.05;
  const curve = (y) => Math.round(g.curve * (y / Math.max(1, h)) * (y / Math.max(1, h)) * w * 0.8);
  const fam = g.family;
  if (g.shapeMix > 0 && PROFILE[g.archetype] && PROFILE[g.shape2]) {
    // a blended body: both shapes' outlines down the body, mixed; the lead shape's crown or stem on top
    const pa = PROFILE[g.archetype], pb = PROFILE[g.shape2], m = g.shapeMix;
    const asp = pa.asp * (1 - m) + pb.asp * m, R = (w + h) / 2;
    const hw = Math.max(1.5, Math.min(icon ? cap : maxW + 1, R / Math.sqrt(asp) * (0.8 + g.width * 0.4)));
    const hh = Math.max(2, Math.min(icon ? cap : maxH + 1, Math.round(R * Math.sqrt(asp) * (0.8 + g.elongation * 0.4))));
    const prof = t => pa.f(t) * (1 - m) + pb.f(t) * m;
    const inside = (x, y) => { const t = (y + hh) / (2 * hh); return t >= 0 && t <= 1 && Math.abs(x - curve(y)) <= hw * prof(t) + 0.35; };
    fillShape(inside);
    if (g.archetype === 'berry' || g.shape2 === 'berry') for (let y = -hh + 1; y < hh; y++) for (let x = -Math.ceil(hw); x <= hw; x++) {   // a strawberry in it keeps its seeds
      if ((y & 1) || ((x + (y >> 1)) & 1)) continue;
      if (N4.every(([dx, dy]) => inside(x + dx, y + dy)) && inside(x, y)) put(cx + x, cy + y, C.second);
    }
    if (fam === 'root' && (g.archetype === 'taper' || g.shape2 === 'taper')) for (let y = -hh + 2; y < hh; y += 2) { const rw = hw * prof((y + hh) / (2 * hh)); if (rw > 1.5) put(cx + curve(y) - Math.round(rw) + 1, cy + y, C.dark); }   // a carrot in it keeps its rings
    let top = -hh; while (top < hh && !buf.has(K(cx + curve(top), cy + top))) top++;
    if (g.archetype === 'pod') { put(cx + curve(top), cy + top - 1, C.stem); put(cx + curve(top) + 1, cy + top - 2, C.leafLight); }
    else topCrown(put, cx + curve(top), cy + top - 1, C, g, fam !== 'root');
  } else switch (g.archetype) {
    case 'taper': {            // carrot / chilli / strawberry: shoulders at the top, point below
      const hh = Math.max(2, h), round = fam !== 'root';
      const rwAt = y => { const t = (y + hh) / (2 * hh); const shoulder = round && t < 0.2 ? 0.75 + t * 1.25 : 1; return Math.max(0.5, w * shoulder * (1 - Math.pow(t, 1.6) * (0.5 + g.tip * 0.4))); };   // the width eases off, so the point is short rather than a long spike
      fillShape((x, y) => y >= -hh && y <= hh && Math.abs(x - curve(y)) <= rwAt(y));
      if (fam === 'root') for (let y = -hh + 2; y < hh; y += 2) { const rw = rwAt(y); put(cx + curve(y) - Math.round(rw) + 1, cy + y, C.dark); if (rw > 2) put(cx + curve(y) + 1, cy + y, C.shade); }   // carrot rings
      topCrown(put, cx, cy - hh - 1, C, g, fam !== 'root');
      break;
    }
    case 'berry': {            // strawberry: round shoulders, a blunt point below, seeds in a loose grid, a leafy calyx
      const hh = Math.max(2, h), ww = Math.max(2, w);
      const rwAt = y => { const t = (y + hh) / (2 * hh); return t < 0.3 ? ww * (0.7 + t) : ww * (1 - (t - 0.3) / 0.7 * (0.6 + g.tip * 0.3)); };   // widest just under the shoulders
      const inside = (x, y) => y >= -hh && y <= hh && Math.abs(x - curve(y) * 0.5) <= rwAt(y) + 0.2;
      fillShape(inside);
      for (let y = -hh + 1; y < hh; y++) for (let x = -ww; x <= ww; x++) {   // seeds: every other pixel on every other row, never on the edge
        if ((y & 1) || ((x + (y >> 1)) & 1)) continue;
        if (inside(x, y) && inside(x + 1, y) && inside(x - 1, y) && inside(x, y + 1) && inside(x, y - 1)) put(cx + x, cy + y, C.second);
      }
      topCrown(put, cx, cy - hh - 1, C, g, true);
      break;
    }
    case 'lumpy': {            // potato: an oval with bumps and a few dark eyes
      const bumps = Array.from({ length: 4 }, () => [r.range(-w, w), r.range(-h * 0.6, h * 0.6), 1 + r() * (1 + g.bumpiness * 2)]);
      fillShape((x, y) => ell(x, y, w, Math.max(1, h * 0.7)) || bumps.some(([bx, by, br]) => (x - bx) ** 2 + (y - by) ** 2 <= br * br));
      break;
    }
    case 'bulb': {             // turnip / onion: round bulb, papery lines, a root tail, stalks or leaves on top
      const rh = Math.max(1, Math.round(h * 0.9));
      fillShape((x, y) => ell(x, y, w, rh) || (Math.abs(x) <= 0 && y === rh + 1));
      put(cx, cy + rh + 1, C.light); put(cx + 1, cy + rh + 2, C.dark);          // root tail
      if (w >= 2) for (let y = -rh + 1; y <= rh - 1; y++) { if (ell(w >> 1, y, w, rh)) put(cx + (w >> 1), cy + y, C.shade); if (y % 2 && ell(-(w >> 1), y, w, rh)) put(cx - (w >> 1), cy + y, C.light); }   // papery lines
      if (g.top !== 'none') { topCrown(put, cx, cy - rh - 1, C, g); if (g.top === 'stem') { put(cx - 1, cy - rh - 2, C.leaf); put(cx + 1, cy - rh - 3, C.leaf); } }
      break;
    }
    case 'crown': {            // tomato / beetroot: a sphere with a leafy crown
      const rr = Math.max(1, Math.round((w + h) / 2.2));
      fillShape((x, y) => x * x + y * y <= rr * rr + rr * 0.5);
      if (fam === 'root') { put(cx, cy + rr + 1, C.dark); put(cx + 1, cy + rr + 2, C.outline); }
      topCrown(put, cx, cy - rr, C, g, true);
      break;
    }
    case 'cluster': {          // lavender spike (flower) or a bunch of berries (everything else)
      if (fam === 'flower') {
        const len = Math.max(3, h + 1);   // a dense two-wide spike, light at the tip, darker at the base
        for (let i = 0; i <= len * 2; i++) { const y = cy - len + i, t = i / (len * 2); const a = t < 0.3 ? C.light : t < 0.7 ? C.main : C.shade, b = t < 0.3 ? C.main : t < 0.7 ? C.shade : C.dark; put(cx, y, i % 2 ? a : b); put(cx + 1, y, i % 2 ? b : a); if (i % 3 === 1) put(cx - 1, y, C.main); if (i % 3 === 2) put(cx + 2, y, C.main); }
        put(cx, cy - len - 1, C.light); put(cx + 1, cy - len - 2, C.light); put(cx, cy + len + 1, C.stem); put(cx + 1, cy + len + 1, C.stem);
      } else {
        const rr = Math.max(1, Math.round(s / 4)), rows = Math.max(2, Math.min(3, Math.round(h / 2) + 1));
        for (let row = 0; row < rows; row++) { const nb = rows + 1 - row; for (let k = 0; k < nb; k++) { const bx = cx + Math.round((k - (nb - 1) / 2) * (rr * 2)), by = cy - Math.round(rows * rr * 0.8) + row * rr * 2; for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) if (x * x + y * y <= rr * rr + 0.5) put(bx + x, by + y, (x === -rr || y === -rr) ? C.light : (x === rr || y === rr) ? C.dark : pattern(bx + x, by + y, C.main)); } }
        put(cx, cy - Math.round(rows * rr * 0.8) - rr - 1, C.stem);
      }
      break;
    }
    case 'pod': {              // pea / bean: a curved pod with the peas showing
      const len = Math.max(2, h + 1), hw = Math.max(1, Math.round(w * 0.45));
      const xo = y => Math.round(g.curve * 2.5 * (y / len) * (y / len)) + Math.round((y / len) * 1.2);
      fillShape((x, y) => Math.abs(y) <= len && Math.abs(x - xo(y)) <= (Math.abs(y) === len ? 0 : hw), { flat: true });
      for (let y = -len + 1; y < len; y += 2) put(cx + xo(y), cy + y, C.light);         // peas
      put(cx + xo(-len) + 1, cy - len - 1, C.stem); put(cx + xo(-len) + 2, cy - len - 2, C.leafLight);
      break;
    }
    case 'elongated': {        // parsnip / cucumber / pepper: long, narrower at the bottom
      const rw = Math.max(1, Math.round(w * 0.6)), rh = h + 1;
      fillShape((x, y) => ell(x - curve(y), y, Math.max(0.8, rw * (1 - 0.45 * Math.max(0, y) / rh)), rh));
      for (let y = -rh + 2; y < 0; y++) put(cx - 1 + curve(y), cy + y, C.light);        // sheen
      if (fam === 'root') topCrown(put, cx, cy - rh - 1, C, g); else { put(cx + curve(-rh), cy - rh - 1, C.stem); put(cx + curve(-rh), cy - rh - 2, C.stem); }
      break;
    }
    case 'ribbed': {           // pumpkin / melon: wide, ribbed, with a stem
      const rw = Math.max(2, w + 1), rh = Math.max(1, Math.round(h * 0.75));
      const inside = (x, y) => ell(x, y, rw, rh);
      for (let y = -rh; y <= rh; y++) for (let x = -rw; x <= rw; x++) {
        if (!inside(x, y)) continue;
        const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
        const c = edge ? ((x > 0 || y > 0) ? C.dark : C.main) : (x < 0 && y < 0 && x * x + y * y < rw) ? C.light : (y > rh * 0.3 || x > rw * 0.55) ? C.shade : pattern(cx + x, cy + y, C.main);
        put(cx + x, cy + y, c);
      }
      put(cx, cy - rh - 1, C.stem); put(cx, cy - rh - 2, C.stem); put(cx + 1, cy - rh - 2, C.leafDark);
      break;
    }
    case 'ear': {              // sweetcorn: a slim cob, kernels showing at the top, the husk wrapped round the lower two thirds
      const rw = Math.max(1, Math.round(w * 0.45)), rh = Math.max(2, h);
      for (let y = -rh; y <= rh; y++) for (let x = -rw; x <= rw; x++) {
        if (Math.abs(y) === rh && Math.abs(x) === rw) continue;
        const leftFlap = (x + rw) <= (y + 1) * 0.7 && y > -rh / 3, rightFlap = (rw - x) <= y * 0.7 && y > -rh / 3 + 1;   // two husk leaves crossing over the cob
        if (leftFlap) put(cx + x, cy + y, (x + y) % 3 === 0 ? C.leafDark : C.leaf);
        else if (rightFlap) put(cx + x, cy + y, (x - y) % 3 === 0 ? C.leafDark : C.leafLight);
        else put(cx + x, cy + y, ((x + y) % 2 === 0) ? C.light : (x === rw ? C.dark : pattern(cx + x, cy + y, C.main)));
      }
      for (let y = -Math.round(rh / 3); y <= rh; y++) { put(cx - rw - 1, cy + y, C.leaf); put(cx + rw + 1, cy + y, C.leafDark); }   // the husk's outer edges
      put(cx - rw - 1, cy - Math.round(rh / 3) - 1, C.leafLight); put(cx + rw + 2, cy - Math.round(rh / 3) + 1, C.leaf);       // tips peeling back
      put(cx, cy - rh - 1, C.second); put(cx + 1, cy - rh - 2, C.second); put(cx - 1, cy - rh - 2, C.light);                   // silk
      break;
    }
    case 'head': {             // family decides: wheat spike / radish bulb / lettuce or cabbage head / sunflower
      if (fam === 'grain') {
        const len = Math.max(3, h);
        // a full ear: a tall spike three wide, the grains stepping down each side (light left, dark right), never fatter
        for (let i = 0; i <= len * 2; i++) { const y = cy - len + i; put(cx, y, i % 2 ? C.main : C.shade); put(cx - 1, y, i % 2 ? C.light : C.main); put(cx + 1, y, i % 2 ? C.main : C.dark); }
        put(cx - 1, cy - len - 1, C.light); put(cx + 1, cy - len - 2, C.light); put(cx, cy - len - 1, C.main);   // awns
      } else if (fam === 'root') {   // a leafy head grown on a root (lettuce × potato): tight leaves above, a short pale taproot below
        const rr = Math.max(2, Math.round((w + h) / 2.6));
        for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
          const d = Math.sqrt(x * x + y * y); if (d > rr + 0.3) continue;
          if (d > rr - 0.7 && ((x + y + rr) % 2 === 0)) continue;
          const vein = (x === 0 && y < 0) || (x === y && x > 0);
          put(cx + x, cy + y - 1, d > rr - 1.2 ? ((x > 0 || y > 0) ? C.dark : C.light) : d > rr - 2.4 ? pattern(cx + x, cy + y, vein ? C.dark : C.main) : C.shade);
        }
        for (let y = rr; y <= rr + 2; y++) { put(cx, cy + y, y === rr + 2 ? C.light : C.second); if (y === rr) { put(cx - 1, cy + y, C.second); put(cx + 1, cy + y, C.dark); } }   // taproot
        put(cx - 1, cy + rr + 1, C.leafDark);
      } else if (fam === 'flower') {
        const rr = Math.max(2, Math.round((w + h) / 2));
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) put(cx + Math.round(Math.cos(a) * rr), cy + Math.round(Math.sin(a) * rr), a < Math.PI ? C.dark : C.light);
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) put(cx + Math.round(Math.cos(a) * (rr - 1)), cy + Math.round(Math.sin(a) * (rr - 1)), C.main);
        disc(cx, cy, Math.max(1, rr - 2), C.second); put(cx - 1, cy - 1, C.light);
      } else {
        // lettuce / cabbage (Build 103): a rosette of round leaves, back row first, each lit top-left and shaded
        // bottom-right, a darker crease where one overlaps the last, and a pale midrib, so it reads as a head of leaves
        const R = Math.max(2.5, (w + h) / 2), lr = Math.max(1.4, R * 0.55);
        const leaves = [[-0.55, -0.15, 1], [0.55, -0.15, 1], [0, -0.45, 1], [-0.38, 0.32, 0.95], [0.38, 0.32, 0.95], [0, 0.05, 0.8]];
        const drawn = new Set();
        for (const [lx, ly, ls] of leaves) {
          const ox = lx * R, oy = ly * R, rad = lr * ls, cells = [];
          for (let y = Math.floor(oy - rad - 1); y <= Math.ceil(oy + rad + 1); y++) for (let x = Math.floor(ox - rad - 1); x <= Math.ceil(ox + rad + 1); x++) {
            const dx = x - ox, dy = (y - oy) * 1.1, d = Math.sqrt(dx * dx + dy * dy);
            if (d <= rad + 0.25) cells.push([x, y, dx, dy, d]);
          }
          for (const [x, y, dx, dy, d] of cells) {
            const rim = d > rad - 0.9, lit = dx + dy < -rad * 0.5, dark = dx + dy > rad * 0.6;
            let c = rim ? (drawn.has(K(cx + x, cy + y)) ? C.dark : dark ? C.shade : C.main) : lit ? C.light : dark ? C.shade : pattern(cx + x, cy + y, C.main);
            if (!rim && Math.abs(dx) < 0.5 && dy > -rad * 0.6 && rad > 2) c = C.light;                  // the midrib
            put(cx + x, cy + y, c);
          }
          for (const [x, y] of cells) drawn.add(K(cx + x, cy + y));
        }
        put(cx, cy + Math.round(R * 0.75), C.light);                                                         // the stalk end
      }
      break;
    }
    case 'spiky': {
      const rr = Math.max(1, Math.round((w + h) / 2.5));
      fillShape((x, y) => x * x + y * y <= rr * rr + 0.5);
      break;
    }
    case 'star': {
      const rr = Math.max(2, Math.round((w + h) / 2));
      for (let i = -rr; i <= rr; i++) { put(cx + i, cy, Math.abs(i) === rr ? C.dark : C.main); put(cx, cy + i, Math.abs(i) === rr ? C.dark : C.main); }
      const d = Math.max(1, rr - 1);
      for (let i = -d; i <= d; i++) { if (Math.abs(i) > d / 2) continue; put(cx + i, cy + i, C.light); put(cx + i, cy - i, C.light); }
      put(cx, cy, C.second);
      break;
    }
  }
  finish(P, buf, g, C, r, clipY, icon);
  if (icon && g.traits.frostHardy) { P.px(cx - w, cy - h, C.frost); P.px(cx + w - 1, cy - h + 1, C.frost); }
  if (icon && g.traits.glowing) { for (let i = 0; i < 4; i++) P.px(cx + r.int(-w - 2, w + 2), cy + r.int(-h - 2, h + 2), C.glow); }
}
const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Skin, outline and copy out. Body pixels are the produce's own colours; leaf and stem colours (crowns, husks, stalks) take
// no skin and get a dark green line instead of the produce's own dark.
function finish(P, buf, g, C, r, clipY, icon) {
  const leafy = new Set([C.leaf, C.leafDark, C.leafLight, C.stem]);
  const xy = k => [(k % 256) - 64, Math.floor(k / 256) - 64], K = (x, y) => (y + 64) * 256 + (x + 64);
  const body = () => [...buf.keys()].filter(k => !leafy.has(buf.get(k)));
  const isBody = (x, y) => buf.has(K(x, y)) && !leafy.has(buf.get(K(x, y)));
  const open = (x, y) => !buf.has(K(x, y));
  const skin = shownSurface(g);
  let spikes = [];
  if (skin === 'ribbed') {
    // ribs run top to bottom at even fractions of each row, so they bow with the outline instead of standing straight
    const rows = new Map();
    for (const k of body()) { const [x, y] = xy(k); const row = rows.get(y) || [x, x]; rows.set(y, [Math.min(row[0], x), Math.max(row[1], x)]); }
    const ys = [...rows.keys()].sort((a, b) => a - b), widest = Math.max(...[...rows.values()].map(([a, b]) => b - a + 1));
    // as many grooves as the width takes (a groove every three pixels or so), one more for a high ribs gene; each groove
    // has its shadow to the right and each segment a lit bulge in its upper half, so they read as segments, not lines
    const n = Math.max(1, Math.min(Math.floor((widest - 1) / 2), Math.round(widest / 3.2) + (g.ribs > 0.5 ? 1 : 0)));
    const y0 = ys[0], span = Math.max(1, ys[ys.length - 1] - y0);
    for (const y of ys.slice(1, -1)) { const [a, b] = rows.get(y), W = b - a + 1; if (W < 4) continue;
      const nn = Math.min(n, Math.floor((W - 1) / 2)), xs = [];
      for (let k = 1; k <= nn; k++) xs.push(a + Math.round(W * k / (nn + 1)));
      const inner = (x) => x > a && x < b && isBody(x, y) && isBody(x, y - 1) && isBody(x, y + 1);
      if ((y - y0) / span < 0.45) for (let k = 0; k <= nn; k++) { const l = k ? xs[k - 1] : a, r = k < nn ? xs[k] : b, mx = Math.round((l + r) / 2 - 0.5); if (r - l >= 3 && inner(mx)) buf.set(K(mx, y), C.light); }
      for (const x of xs) { if (inner(x)) buf.set(K(x, y), C.dark); if (inner(x + 1) && !xs.includes(x + 1)) buf.set(K(x + 1, y), C.shade); }
    }
  } else if (skin === 'bumpy') {
    // knobs pushed out of the edge, and dark eyes set into the flesh
    const edge = body().filter(k => { const [x, y] = xy(k); return N4.some(([dx, dy]) => open(x + dx, y + dy)); });
    const knobs = Math.min(4, Math.max(1, Math.round(edge.length / 6)));
    for (let i = 0; i < knobs; i++) { const [x, y] = xy(edge[r.int(0, edge.length - 1)]); const d = N4.find(([dx, dy]) => open(x + dx, y + dy)); if (d && y + d[1] < clipY) buf.set(K(x + d[0], y + d[1]), d[0] > 0 || d[1] > 0 ? C.shade : C.main); }
    const inner = body().filter(k => { const [x, y] = xy(k); return N4.every(([dx, dy]) => isBody(x + dx, y + dy)); });
    for (let i = 0; i < Math.min(3, Math.floor(inner.length / 5)); i++) buf.set(inner[r.int(0, inner.length - 1)], C.outline);
  }
  // the outline: every empty pixel touching the shape
  const line = new Map();
  for (const k of buf.keys()) { const [x, y] = xy(k); for (const [dx, dy] of N4) { const o = K(x + dx, y + dy); if (!buf.has(o) && !line.has(o)) line.set(o, leafy.has(buf.get(k)) ? C.leafLine : C.outline); } }
  // body pixels win over leaf ones where an outline pixel touches both
  for (const [o] of line) { const [x, y] = xy(o); if (N4.some(([dx, dy]) => isBody(x + dx, y + dy))) line.set(o, C.outline); }
  if (skin === 'spiky') {
    // thorns: every few outline pixels round the body, a dark point one pixel past the outline (which stays whole) and a
    // pale glint on the flesh at its root
    const ring = [...line.keys()].filter(o => { const [x, y] = xy(o); return N4.some(([dx, dy]) => isBody(x + dx, y + dy)); });
    let mx = 0, my = 0; for (const o of ring) { const [x, y] = xy(o); mx += x / ring.length; my += y / ring.length; }
    ring.sort((a, b) => { const [ax, ay] = xy(a), [bx, by] = xy(b); return Math.atan2(ay - my, ax - mx) - Math.atan2(by - my, bx - mx); });
    const step = ring.length > 24 ? 2 : 3;   // close-set short points: a serrated edge, not a few long legs
    for (let i = r.int(0, step - 1); i < ring.length; i += step) {
      const [x, y] = xy(ring[i]), d = N4.find(([dx, dy]) => isBody(x - dx, y - dy));
      if (!d || y + d[1] >= clipY || buf.has(K(x + d[0], y + d[1])) || line.has(K(x + d[0], y + d[1]))) continue;
      spikes.push([x - d[0], y - d[1], x + d[0], y + d[1]]);
    }
  }
  for (const [k, c] of buf) { const [x, y] = xy(k); if (y < clipY) P.px(x, y, c); }
  for (const [k, c] of line) { const [x, y] = xy(k); if (y < clipY) P.px(x, y, c); }
  for (const [x, y, tx, ty] of spikes) { if (x !== null && buf.get(K(x, y)) !== C.dark) P.px(x, y, C.light); P.px(tx, ty, C.outline); }
}
// Width down a solid body (t: 0 top, 1 bottom; 1 = full half-width) and its height over its width, for blending two
// shapes. Each one is the outline its own drawing above makes.
const circ = t => Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
const PROFILE = {
  crown:     { asp: 1.0, f: t => circ(t) },
  spiky:     { asp: 1.0, f: t => circ(t) },
  lumpy:     { asp: 0.75, f: t => circ(t) ** 0.8 },
  ribbed:    { asp: 0.65, f: t => circ(t) ** 0.55 },
  bulb:      { asp: 1.15, f: t => t < 0.85 ? Math.max(0.12, circ(t / 0.85) ** 0.8) : 0.12 },   // round, with the root tail below
  taper:     { asp: 2.0, f: t => t < 0.15 ? 0.75 + t * 1.6 : 0.99 * (1 - (t - 0.15) / 0.85) ** 1.1 + 0.08 },
  berry:     { asp: 1.25, f: t => t < 0.3 ? 0.75 + t * 0.83 : 1 - ((t - 0.3) / 0.7) ** 1.6 * 0.82 },
  elongated: { asp: 2.3, f: t => circ(t) ** 0.7 * (1 - 0.3 * t) },
  pod:       { asp: 2.8, f: t => Math.sin(Math.PI * t) ** 0.6 * 0.55 },
};
function topCrown(put, cx, y, C, g, big = false) {
  if (g.top === 'none') return;
  if (g.top === 'stem') { put(cx, y, C.stem); put(cx, y - 1, C.stem); return; }
  put(cx, y, C.leafLight); put(cx - 1, y, C.leaf); put(cx + 1, y, C.leaf);
  if (big) { put(cx - 2, y + 1, C.leaf); put(cx + 2, y + 1, C.leaf); put(cx, y - 1, C.stem); put(cx - 1, y - 1, C.leafLight); }
}
