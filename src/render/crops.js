// Draws any genome as a 16×16 pixel plant for 4 growth stages (+ withered). Each species × stage is drawn once and cached.
// Families decide the foliage template and where produce sits; the archetype + shape genes decide what the produce looks
// like. Every archetype is drawn to read as its canonical vegetable at 16 px (carrot, potato, onion, pumpkin, corn, wheat,
// lettuce, pea pod, lavender spike, ...), with the numeric genes bending it: width, elongation, tip, curve, ribs, bumps.
import { hsl, pixelDrawer, makeCanvas, PAL } from './palette.js';
import { makeRng, hashString } from '../rng.js';
import { canonical } from '../genetics.js';

const cache = new Map();

export function cropSprite(species, stage, v = 0) {
  const key = species.id + ':' + stage + (stage === 0 ? ':' + v : '');
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(16, 16);
  drawCrop(pixelDrawer(ctx), species.genome, stage, v);
  cache.set(key, c);
  return c;
}
// Produce icon alone (for inventory). Cached.
export function produceSprite(species) {
  const key = species.id + ':icon';
  if (cache.has(key)) return cache.get(key);
  const [c, ctx] = makeCanvas(16, 16);
  const P = pixelDrawer(ctx), g = species.genome;
  drawProduce(P, g, 8, 8, 6, colours(g), 0, 16, true);
  cache.set(key, c);
  return c;
}

export function colours(g) {
  const golden = g.traits?.golden;
  const h1 = golden ? 45 : g.hue1, s1 = golden ? 0.95 : g.sat1, l1 = golden ? 0.55 : g.light1;
  return {
    main: hsl(h1, s1, l1), dark: hsl(h1, s1, Math.max(0.1, l1 - 0.18)), shade: hsl(h1, s1, Math.max(0.1, l1 - 0.09)),
    light: hsl(h1, Math.min(1, s1), Math.min(0.95, l1 + 0.17)), outline: hsl(h1, Math.min(1, s1 + 0.1), Math.max(0.06, l1 - 0.32)),
    second: hsl(g.hue2, g.sat2, g.light2),
    leaf: hsl(g.leafHue, 0.55, 0.38), leafDark: hsl(g.leafHue, 0.55, 0.27), leafLight: hsl(g.leafHue, 0.6, 0.5),
    stem: hsl(g.leafHue - 20, 0.4, 0.3), glow: hsl(h1, 0.9, 0.8, 0.45), frost: '#dff3ff',
  };
}
const DEAD = { main: PAL.withered, dark: PAL.witheredDark, shade: PAL.witheredDark, light: '#a5957a', outline: '#4a4034', second: PAL.witheredDark, leaf: PAL.withered, leafDark: PAL.witheredDark, leafLight: '#a5957a', stem: PAL.witheredDark, glow: 'transparent', frost: 'transparent' };

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
        const x = 8 + Math.round((i - (n - 1) / 2) * 2.6);
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
export function drawProduce(P, g, cx, cy, s, C, seed = 0, clipY = 16, icon = false) {
  const maxW = icon ? 6 : 4, maxH = icon ? 6 : 5;
  const w = Math.min(maxW, Math.max(1, Math.round(s * (0.6 + g.width * 0.6))));
  const h = Math.min(maxH, Math.max(1, Math.round(s * (0.6 + g.elongation * 0.8))));
  const r = makeRng(hashString(canonical(g)) + Math.floor(seed * 1000));
  const put = (x, y, c) => { if (y < clipY) P.px(x, y, c); };
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
  switch (g.archetype) {
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
      for (let i = 0; i < 3; i++) put(cx + r.int(-w + 1, w - 1), cy + r.int(-1, 1), C.outline);
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
      const ribs = g.ribs > 0.2 ? Math.max(1, Math.round(g.ribs * 3)) : 0;
      for (let y = -rh; y <= rh; y++) for (let x = -rw; x <= rw; x++) {
        if (!inside(x, y)) continue;
        const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
        let rib = false;
        for (let k = 1; k <= ribs; k++) { const rx = Math.round(rw * k / (ribs + 1) * 2 - rw); if (x === rx + Math.round(Math.abs(y) / rh * 0.6 * Math.sign(x || 1)) && Math.abs(y) < rh) rib = true; }
        const c = edge ? ((x > 0 || y > 0) ? C.dark : C.main) : rib ? C.dark : (x < 0 && y < 0 && x * x + y * y < rw) ? C.light : (y > rh * 0.3 || x > rw * 0.55) ? C.shade : pattern(cx + x, cy + y, C.main);
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
        const len = Math.max(2, h);
        for (let i = 0; i <= len * 2; i++) { const y = cy - len + i; put(cx, y, i % 2 ? C.main : C.shade); put(cx + (i % 2 ? 1 : -1), y, i % 2 ? C.light : C.main); if (w >= 2) put(cx + (i % 2 ? -1 : 1), y, C.dark); }
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
        P.disc(cx, cy, Math.max(1, rr - 2), C.second); put(cx - 1, cy - 1, C.light);
      } else {
        const rr = Math.max(2, Math.round((w + h) / 2));
        for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
          const d = Math.sqrt(x * x + y * y); if (d > rr + 0.3) continue;
          const ruffle = d > rr - 0.7 && ((x + y + rr) % 2 === 0);
          if (ruffle) continue;
          // outer leaves lit, the heart tight and darker; three dark veins run out from the centre so it reads as leaves, not a ball
          const vein = (x === 0 && y < 0) || (y === 1 && x < -1) || (x === y && x > 0);
          const c = d > rr - 1.2 ? ((x > 0 || y > 0) ? C.dark : C.light) : d > rr - 2.4 ? pattern(cx + x, cy + y, vein ? C.dark : C.main) : d > rr - 3.4 ? (vein ? C.outline : C.shade) : C.dark;
          put(cx + x, cy + y, c);
        }
      }
      break;
    }
    case 'spiky': {
      const rr = Math.max(1, Math.round((w + h) / 2.5));
      fillShape((x, y) => x * x + y * y <= rr * rr + 0.5);
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) put(cx + Math.round(Math.cos(a) * (rr + 1)), cy + Math.round(Math.sin(a) * (rr + 1)), C.second);
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
  if (icon && g.traits.frostHardy) { put(cx - w, cy - h, C.frost); put(cx + w - 1, cy - h + 1, C.frost); }
  if (icon && g.traits.glowing) { for (let i = 0; i < 4; i++) put(cx + r.int(-w - 2, w + 2), cy + r.int(-h - 2, h + 2), C.glow); }
}
function topCrown(put, cx, y, C, g, big = false) {
  if (g.top === 'none') return;
  if (g.top === 'stem') { put(cx, y, C.stem); put(cx, y - 1, C.stem); return; }
  put(cx, y, C.leafLight); put(cx - 1, y, C.leaf); put(cx + 1, y, C.leaf);
  if (big) { put(cx - 2, y + 1, C.leaf); put(cx + 2, y + 1, C.leaf); put(cx, y - 1, C.stem); put(cx - 1, y - 1, C.leafLight); }
}
