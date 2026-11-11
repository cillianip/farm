// Genomes, crossing, mutation, instability, rarity, pricing and naming. Pure functions, no DOM.
import { CONFIG } from './config.js';
import { makeRng, hashString } from './rng.js';

export const FAMILIES = ['root', 'bush', 'vine', 'grain', 'flower', 'gourd'];
export const ARCHETYPES = ['taper', 'lumpy', 'bulb', 'crown', 'cluster', 'pod', 'elongated', 'ribbed', 'ear', 'head', 'spiky', 'star', 'berry'];
export const PATTERNS = ['none', 'stripes', 'spots', 'gradient'];
export const LEAF_SHAPES = ['round', 'pointed', 'frond', 'blade'];
export const TOPS = ['crown', 'stem', 'none'];
// The skin laid over any body shape (Build 101): crossing mixes body and skin freely, so a carrot × pumpkin can give a
// ribbed carrot. Older genomes had the skin baked into the shape; they get it from SURFACE_OF and keep their ids.
export const SURFACES = ['smooth', 'bumpy', 'ribbed', 'spiky'];
export const SURFACE_OF = { lumpy: 'bumpy', ribbed: 'ribbed', spiky: 'spiky' };
export const defaultSurface = arch => SURFACE_OF[arch] || 'smooth';
// the bodies a skin shows on; spikes of grain, flower heads, cobs and stars keep their own look and carry the skin hidden
export const SKINNED = new Set(['taper', 'berry', 'lumpy', 'bulb', 'crown', 'elongated', 'ribbed', 'spiky', 'pod']);
export const shownSurface = g => SKINNED.has(g.archetype) ? g.surface : defaultSurface(g.archetype);
// Blended bodies (Build 103): a child of two solid shapes carries both, the lead one (archetype) and a second one (shape2)
// at shapeMix (0 = pure, up to 0.5 = halfway), and is drawn in between. Crossing mixes the parents' shape weights, so a
// line keeps its history: a carrot × tomato child crossed back to a carrot drifts back toward the carrot.
export const shapeWeights = g => { const n = normaliseGenome(g); return n.shapeMix > 0 ? { [n.archetype]: 1 - n.shapeMix, [n.shape2]: n.shapeMix } : { [n.archetype]: 1 }; };
const blendable = w => Object.keys(w).every(a => SKINNED.has(a));
export const RARE_TRAITS = ['golden', 'glowing', 'multiHarvest', 'frostHardy'];   // needing less water is the thirst gene, not a trait

// Gene table. type: cat (categorical) | num (0..1 unless min/max) | int | bool. w = rarity weight function.
export const GENES = [
  { k: 'family', type: 'cat', values: FAMILIES, w: v => ({ root: 0, bush: 0.5, gourd: 1, vine: 1, grain: 1, flower: 2 })[v] },
  { k: 'archetype', type: 'cat', values: ARCHETYPES, w: v => ({ taper: 0, lumpy: 0, bulb: 0, crown: 1, cluster: 1, pod: 1, elongated: 1, ribbed: 1.5, ear: 1.5, head: 1.5, spiky: 5, star: 7 })[v] },
  { k: 'surface', type: 'cat', values: SURFACES, w: (v, g) => g && (v === defaultSurface(g.archetype) || shownSurface(g) !== v) ? 0 : ({ smooth: 0, bumpy: 0.5, ribbed: 1, spiky: 2 })[v] },
  { k: 'elongation', type: 'num' }, { k: 'width', type: 'num' }, { k: 'bumpiness', type: 'num' },
  { k: 'ribs', type: 'num' }, { k: 'tip', type: 'num' }, { k: 'curve', type: 'num' },
  { k: 'top', type: 'cat', values: TOPS },
  { k: 'count', type: 'int', min: 1, max: 8, w: v => v >= 7 ? 3 : v >= 5 ? 1.5 : 0 },
  { k: 'size', type: 'num', w: v => v > 0.85 ? 2.5 : v > 0.7 ? 1 : v < 0.15 ? 1.5 : 0 },
  { k: 'hue1', type: 'num', min: 0, max: 360, wrap: true, w: hueRarity },
  { k: 'sat1', type: 'num' }, { k: 'light1', type: 'num' },
  { k: 'hue2', type: 'num', min: 0, max: 360, wrap: true }, { k: 'sat2', type: 'num' }, { k: 'light2', type: 'num' },
  { k: 'pattern', type: 'cat', values: PATTERNS, w: v => ({ none: 0, stripes: 2, spots: 2, gradient: 1.5 })[v] },
  { k: 'leafShape', type: 'cat', values: LEAF_SHAPES }, { k: 'leafDensity', type: 'num' }, { k: 'height', type: 'num' },
  { k: 'leafHue', type: 'num', min: 60, max: 180, w: v => (v < 80 || v > 150) ? 1 : 0 },
  { k: 'growHours', type: 'num', min: 2, max: 60, w: v => v > 30 ? 1 : 0 },
  { k: 'thirst', type: 'num' },        // care genes carry no rarity: they pay in your time, not at the cart
  { k: 'hardiness', type: 'num' },
  { k: 'ripeHours', type: 'num', min: 6, max: 72 },
  { k: 'sugar', type: 'num', noId: true },   // what the dryer makes of it: sweet dries dear, bland is not worth drying (Build 67; not in the id, so older species keep theirs)
  { k: 'skin', type: 'num', noId: true },    // thick skin dries slowly
  { k: 'regrow', type: 'bool', w: v => v ? 1 : 0 },
  { k: 'vigor', type: 'num' },        // hybrid vigour: set by cross(), not blended; pays at the cart (see produceValue)
];
export const TRAIT_WEIGHT = { golden: 8, glowing: 7, multiHarvest: 5, frostHardy: 4 };

function hueRarity(h) {
  if (h >= 200 && h <= 260) return 3;   // blue
  if (h > 160 && h < 200) return 2;     // cyan
  if (h > 260 && h <= 340) return 1.5;  // purple / magenta
  return 0;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = v => Math.round(v * 100) / 100;

export function normaliseGenome(g) {
  const out = { ...g, traits: { ...(g.traits || {}) } };
  if (!SURFACES.includes(out.surface)) out.surface = defaultSurface(ARCHETYPES.includes(out.archetype) ? out.archetype : ARCHETYPES[0]);
  if (!ARCHETYPES.includes(out.shape2) || !(out.shapeMix > 0)) { out.shape2 = ARCHETYPES.includes(out.archetype) ? out.archetype : ARCHETYPES[0]; out.shapeMix = 0; }
  else out.shapeMix = r2(Math.min(0.5, out.shapeMix));
  for (const spec of GENES) {
    let v = out[spec.k];
    if (spec.type === 'cat') { if (!spec.values.includes(v)) v = spec.values[0]; }
    else if (spec.type === 'bool') v = !!v;
    else {
      const lo = spec.min ?? 0, hi = spec.max ?? 1;
      if (typeof v !== 'number' || Number.isNaN(v)) v = (lo + hi) / 2;
      if (spec.wrap) v = ((v % (hi - lo)) + (hi - lo)) % (hi - lo) + lo; else v = clamp(v, lo, hi);
      v = spec.type === 'int' ? Math.round(v) : r2(v);
    }
    out[spec.k] = v;
  }
  for (const t of RARE_TRAITS) out.traits[t] = !!out.traits[t];
  out.gen = out.gen || 0;
  return out;
}

export function canonical(g) {
  const n = normaliseGenome(g);
  const parts = GENES.filter(s => !s.noId && !(s.k === 'surface' && n.surface === defaultSurface(n.archetype))).map(s => `${s.k}=${n[s.k]}`);   // the skin a shape always had is left out, so old ids hold
  if (n.shapeMix > 0) parts.push(`shape2=${n.shape2}`, `shapeMix=${n.shapeMix}`);   // a pure shape adds nothing, so old ids hold
  parts.push('traits=' + RARE_TRAITS.filter(t => n.traits[t]).join('+'));
  return parts.join(';');
}
export const genomeId = g => 'sp_' + hashString(canonical(g)).toString(36);

// ---------- rarity, tier, price ----------
export function rarityScore(g) {
  let s = 0;
  for (const spec of GENES) if (spec.w) s += spec.w(g[spec.k], g) || 0;
  for (const t of RARE_TRAITS) if (g.traits?.[t]) s += TRAIT_WEIGHT[t];
  s += Math.min(CONFIG.genetics.maxGenerationRarity, (g.gen || 0) * CONFIG.genetics.generationRarity);
  return r2(s);
}
export function tierOf(score) {
  const t = CONFIG.tiers.thresholds;
  if (score >= t.legendary) return 'legendary';
  if (score >= t.epic) return 'epic';
  if (score >= t.rare) return 'rare';
  if (score >= t.uncommon) return 'uncommon';
  return 'common';
}
export const growRealMinutes = g => g.growHours * (CONFIG.time.dayRealSeconds / 24) / 60;

// value of one produce item; a harvest yields `count` of them
export const ratePerMinute = rarity => CONFIG.tiers.rateBase * Math.pow(CONFIG.tiers.rateGrowth, rarity);
export function produceValue(g, rarity) {
  const rate = ratePerMinute(rarity);
  let harvest = rate * growRealMinutes(g) * (0.7 + 0.6 * g.size);
  if (g.traits.golden) harvest *= 3;
  if (g.regrow) harvest *= 0.8;
  harvest *= 1 + CONFIG.genetics.vigorValue * (g.vigor || 0);   // hybrid vigour
  return Math.max(0.1, r2(harvest / g.count));
}

// ---------- naming ----------
const COLOUR_WORDS = [
  [15, 'Crimson'], [40, 'Amber'], [65, 'Sunny'], [95, 'Lime'], [150, 'Emerald'], [175, 'Jade'], [200, 'Frost'],
  [245, 'Azure'], [270, 'Midnight'], [300, 'Violet'], [335, 'Rose'], [361, 'Crimson'],
];
export function colourWord(g) {
  if (g.traits?.golden) return 'Golden';
  if (g.sat1 < 0.25) return g.light1 > 0.6 ? 'Pale' : 'Ash';
  if (g.hue1 >= 15 && g.hue1 < 45 && g.light1 < 0.4) return 'Earthy';
  for (const [max, word] of COLOUR_WORDS) if (g.hue1 < max) return word;
  return 'Crimson';
}
const PATTERN_WORD = { none: '', stripes: 'Striped', spots: 'Spotted', gradient: 'Dusky' };
const SURFACE_WORD = { smooth: 'Smooth', bumpy: 'Knobbly', ribbed: 'Ribbed', spiky: 'Spiny' };
const TRAIT_WORD = { glowing: 'Moon', multiHarvest: 'Bounty', frostHardy: 'Winter' };
const NOUNS = {
  root:   { taper: 'Carrot', lumpy: 'Potato', bulb: 'Turnip', crown: 'Beet', cluster: 'Groundnut', pod: 'Peanut', elongated: 'Parsnip', ribbed: 'Yam', ear: 'Ginger', head: 'Radish', spiky: 'Thornroot', star: 'Starroot' },
  bush:   { taper: 'Chilli', lumpy: 'Fig', bulb: 'Plum', crown: 'Tomato', cluster: 'Berry', pod: 'Bean', elongated: 'Pepper', ribbed: 'Gooseberry', ear: 'Hazel', head: 'Artichoke', spiky: 'Bramble', star: 'Starfruit' },
  vine:   { taper: 'Hopvine', lumpy: 'Kiwi', bulb: 'Grape', crown: 'Passionfruit', cluster: 'Grape', pod: 'Pea', elongated: 'Cucumber', ribbed: 'Melon', ear: 'Loofah', head: 'Hopflower', spiky: 'Thornvine', star: 'Starvine' },
  grain:  { taper: 'Rye', lumpy: 'Buckwheat', bulb: 'Millet', crown: 'Amaranth', cluster: 'Oat', pod: 'Lentil', elongated: 'Barley', ribbed: 'Sorghum', ear: 'Corn', head: 'Wheat', spiky: 'Spikegrass', star: 'Stargrain' },
  flower: { taper: 'Lily', lumpy: 'Poppy', bulb: 'Tulip', crown: 'Rose', cluster: 'Lavender', pod: 'Lupin', elongated: 'Iris', ribbed: 'Dahlia', ear: 'Foxglove', head: 'Sunflower', spiky: 'Thistle', star: 'Starbloom' },
  gourd:  { taper: 'Zucchini', lumpy: 'Squash', bulb: 'Melon', crown: 'Marrow', cluster: 'Gourdlet', pod: 'Luffa', elongated: 'Marrow', ribbed: 'Pumpkin', ear: 'Calabash', head: 'Cabbage', spiky: 'Spikegourd', star: 'Stargourd' },
};
const SYLL = ['va', 'lo', 'ri', 'ne', 'ka', 'mu', 'so', 'ti', 'el', 'ar', 'is', 'on', 'ue', 'ya', 'fen', 'dor', 'mir', 'tal', 'quo', 'zel'];
export function variantWord(g) {
  const h = hashString(canonical(g));
  const a = SYLL[h % SYLL.length], b = SYLL[(h >>> 7) % SYLL.length];
  return (a + b).replace(/^./, c => c.toUpperCase());
}
// A bred child is named after its parents, the way people name crosses: the head of one word and the tail of the other.
// Lettuce × Potato → Lettato, Turnip × Tomato → Turnato. Prefix words (Wild, Crimson) and "(sterile)" are dropped first.
const V = 'aeiou';
const core = n => String(n).replace(/\s*\(sterile\)$/, '').trim().split(' ').pop();
export function blendName(a, b) {
  const A = core(a), B = core(b), n = blendOnce(A, B);
  if (n !== A && n !== B) return n;
  const m = blendOnce(B, A); return m !== A && m !== B ? m : n;   // a blend that lands on a parent's own name tries the other way round
}
function blendOnce(A, B) {
  const m = /^([^aeiou]*[aeiou]+[^aeiou]*)/i.exec(A);
  let head = m ? m[1] : A.slice(0, 3);
  const cap = /^[^aeiou]{2}/i.test(A) ? 5 : 4; if (head.length > cap) head = head.slice(0, cap);
  const vowels = []; for (let i = 0; i < B.length; i++) if (V.includes(B[i].toLowerCase()) && (i === 0 || !V.includes(B[i - 1].toLowerCase()))) vowels.push(i);
  let tail = vowels.length >= 2 ? B.slice(vowels[vowels.length - 2]) : vowels.length ? B.slice(vowels[0]) : B.slice(-3);
  if (tail.length > 4) { const last = vowels[vowels.length - 1]; tail = B.slice(last > 0 && !V.includes(B[last - 1].toLowerCase()) ? last - 1 : last); }   // too long: one consonant and the last vowel group
  if (head.slice(-1).toLowerCase() === tail[0].toLowerCase()) tail = tail.slice(1);
  else while (tail.length > 1 && V.includes(head.slice(-1).toLowerCase()) && V.includes(tail[0].toLowerCase())) tail = tail.slice(1);   // no vowel pile-up at the join
  const out = (head + tail).toLowerCase();
  return out[0].toUpperCase() + out.slice(1);
}
export function baseName(g) {
  const words = [];
  if (g.size > 0.85) words.push('Giant'); else if (g.size < 0.15) words.push('Dwarf');
  if (PATTERN_WORD[g.pattern]) words.push(PATTERN_WORD[g.pattern]);
  for (const t of ['glowing', 'multiHarvest', 'frostHardy']) if (g.traits?.[t]) { words.push(TRAIT_WORD[t]); break; }
  words.push(colourWord(g));
  { const sf = shownSurface(g); if (sf !== defaultSurface(g.archetype)) words.push(SURFACE_WORD[sf]); }
  words.push(NOUNS[g.family][g.archetype]);
  return words.join(' ');
}

// ---------- species ----------
// A species is a genome plus everything derived from it. `name` can be overridden (starters keep plain names).
export function makeSpecies(genome, opts = {}) {
  const g = normaliseGenome(genome);
  const rarity = rarityScore(g);
  const tier = tierOf(rarity);
  const value = produceValue(g, rarity);
  return {
    id: genomeId(g), genome: g, rarity, tier, value,
    seedPrice: r2(Math.max(0.2, value * g.count * CONFIG.economy.seedPriceFraction)),   // what the catalogue charges per seed
    name: opts.name || baseName(g),
    sterile: !!opts.sterile,
    starter: !!opts.starter,
    shop: !!opts.shop,
    discoveredDay: opts.discoveredDay ?? null,
    parents: opts.parents || null,
    wild: !!opts.wild, base: opts.base || null,
  };
}

// ---------- starters ----------
const BASE = {
  elongation: 0.5, width: 0.5, bumpiness: 0.1, ribs: 0, tip: 0.5, curve: 0.1, top: 'crown', count: 1, size: 0.4,
  hue1: 30, sat1: 0.8, light1: 0.55, hue2: 100, sat2: 0.6, light2: 0.45, pattern: 'none',
  leafShape: 'pointed', leafDensity: 0.5, height: 0.4, leafHue: 110,
  growHours: 6, thirst: 0.5, hardiness: 0.5, ripeHours: 30, regrow: false, vigor: 0, sugar: 0.4, skin: 0.5, traits: {}, gen: 0,
};
export const STARTER_GENOMES = {
  carrot: { ...BASE, family: 'root', archetype: 'taper', elongation: 0.85, width: 0.3, tip: 0.9, hue1: 28, sat1: 0.95, light1: 0.55, leafShape: 'frond', leafHue: 115, growHours: 6, size: 0.4, sugar: 0.55, skin: 0.35 },
  turnip: { ...BASE, family: 'root', archetype: 'bulb', elongation: 0.45, width: 0.6, hue1: 60, sat1: 0.15, light1: 0.85, hue2: 290, sat2: 0.5, light2: 0.5, pattern: 'gradient', leafShape: 'round', growHours: 4, size: 0.45, thirst: 0.4, sugar: 0.3, skin: 0.4 },
  potato: { ...BASE, family: 'root', archetype: 'lumpy', elongation: 0.5, width: 0.6, bumpiness: 0.6, hue1: 35, sat1: 0.45, light1: 0.52, leafShape: 'round', leafDensity: 0.7, count: 3, growHours: 12, size: 0.35, hardiness: 0.7, thirst: 0.3, sugar: 0.15, skin: 0.5 },
  tomato: { ...BASE, family: 'bush', archetype: 'crown', elongation: 0.45, width: 0.6, hue1: 5, sat1: 0.9, light1: 0.5, leafHue: 120, count: 3, growHours: 16, size: 0.35, regrow: true, ripeHours: 20, thirst: 0.7, height: 0.6, sugar: 0.5, skin: 0.25 },
  pumpkin: { ...BASE, family: 'gourd', archetype: 'ribbed', elongation: 0.4, width: 0.8, ribs: 0.7, hue1: 25, sat1: 0.95, light1: 0.5, top: 'stem', leafShape: 'round', leafDensity: 0.8, count: 1, growHours: 30, size: 0.9, hardiness: 0.6, sugar: 0.6, skin: 0.8 },
  corn: { ...BASE, family: 'grain', archetype: 'ear', elongation: 0.8, width: 0.4, hue1: 50, sat1: 0.9, light1: 0.6, top: 'stem', leafShape: 'blade', height: 0.9, count: 2, growHours: 22, size: 0.5, thirst: 0.6, sugar: 0.7, skin: 0.45 },
  lavender: { ...BASE, family: 'flower', archetype: 'cluster', elongation: 0.6, width: 0.3, hue1: 270, sat1: 0.6, light1: 0.6, top: 'none', leafShape: 'blade', height: 0.6, count: 4, growHours: 14, size: 0.3, thirst: 0.2, hardiness: 0.8, sugar: 0.2, skin: 0.3 },
};
export const STARTER_NAMES = { carrot: 'Carrot', turnip: 'Turnip', potato: 'Potato', tomato: 'Tomato', pumpkin: 'Pumpkin', corn: 'Sweetcorn', lavender: 'Lavender' };
export const STARTER_KEYS = ['carrot', 'turnip', 'potato'];           // in the shop from the start

// The 14 basic species a bird can drop. Plain genomes, no rare traits; each drop is jittered a little (see wildSpecies).
export const WILD_BASES = {
  carrot: STARTER_GENOMES.carrot, turnip: STARTER_GENOMES.turnip, potato: STARTER_GENOMES.potato, tomato: STARTER_GENOMES.tomato,
  pumpkin: STARTER_GENOMES.pumpkin, corn: STARTER_GENOMES.corn, lavender: STARTER_GENOMES.lavender,
  radish: { ...BASE, family: 'root', archetype: 'bulb', elongation: 0.5, width: 0.5, hue1: 350, sat1: 0.8, light1: 0.5, hue2: 0, sat2: 0, light2: 0.95, leafShape: 'round', growHours: 3, size: 0.25, thirst: 0.6, sugar: 0.25, skin: 0.3 },
  beetroot: { ...BASE, family: 'root', archetype: 'crown', elongation: 0.5, width: 0.6, hue1: 335, sat1: 0.7, light1: 0.3, leafShape: 'pointed', leafHue: 100, growHours: 8, size: 0.4, hardiness: 0.6, sugar: 0.65, skin: 0.5 },
  onion: { ...BASE, family: 'root', archetype: 'bulb', elongation: 0.5, width: 0.6, hue1: 40, sat1: 0.5, light1: 0.75, top: 'stem', leafShape: 'blade', height: 0.6, growHours: 10, size: 0.4, thirst: 0.3, hardiness: 0.7, sugar: 0.35, skin: 0.6 },
  parsnip: { ...BASE, family: 'root', archetype: 'elongated', elongation: 0.9, width: 0.35, tip: 0.8, hue1: 50, sat1: 0.3, light1: 0.85, leafShape: 'frond', growHours: 9, size: 0.45, hardiness: 0.6, sugar: 0.5, skin: 0.45 },
  lettuce: { ...BASE, family: 'gourd', archetype: 'head', elongation: 0.5, width: 0.6, hue1: 95, sat1: 0.6, light1: 0.5, hue2: 75, sat2: 0.6, light2: 0.78, top: 'none', leafShape: 'round', leafDensity: 0.3, growHours: 5, size: 0.5, thirst: 0.8, hardiness: 0.3, sugar: 0.1, skin: 0.15 },
  pea: { ...BASE, family: 'vine', archetype: 'pod', elongation: 0.7, width: 0.3, curve: 0.4, hue1: 100, sat1: 0.6, light1: 0.45, top: 'stem', leafShape: 'round', height: 0.7, count: 4, growHours: 10, size: 0.2, regrow: true, ripeHours: 18, sugar: 0.55, skin: 0.3 },
  strawberry: { ...BASE, family: 'bush', archetype: 'berry', elongation: 0.55, width: 0.7, tip: 0.4, hue1: 355, sat1: 0.9, light1: 0.48, pattern: 'none', hue2: 50, sat2: 0.8, light2: 0.75, leafShape: 'round', height: 0.25, count: 4, growHours: 12, size: 0.2, regrow: true, ripeHours: 16, thirst: 0.6, sugar: 0.8, skin: 0.15 },
  wheat: { ...BASE, family: 'grain', archetype: 'head', elongation: 0.8, width: 0.4, hue1: 45, sat1: 0.7, light1: 0.65, hue2: 40, sat2: 0.6, light2: 0.5, top: 'none', leafShape: 'blade', height: 0.8, count: 3, growHours: 14, size: 0.3, thirst: 0.3, hardiness: 0.8, sugar: 0.3, skin: 0.7 },
};
export const WILD_NAMES = { ...STARTER_NAMES, radish: 'Radish', beetroot: 'Beetroot', onion: 'Onion', parsnip: 'Parsnip', lettuce: 'Lettuce', pea: 'Pea', strawberry: 'Strawberry', wheat: 'Wheat' };

// A bird seed: a wild base with small random variation in its numeric genes (never rare traits).
export function wildSpecies(rng, baseKey = rng.pick(Object.keys(WILD_BASES))) {
  const base = WILD_BASES[baseKey], J = CONFIG.wild;
  const g = { ...base, traits: {} };
  for (const spec of GENES) {
    if (spec.type !== 'num') continue;
    const lo = spec.min ?? 0, hi = spec.max ?? 1, range = hi - lo;
    const jit = spec.k === 'growHours' ? J.growJitter * base.growHours : J.numericJitter * (spec.wrap ? 30 : range);
    g[spec.k] = base[spec.k] + rng.gauss() * jit * 0.5;
  }
  g.count = Math.max(1, Math.min(8, base.count + (rng.chance(0.15) ? rng.pick([-1, 1]) : 0)));
  return makeSpecies(g, { name: 'Wild ' + WILD_NAMES[baseKey], discoveredDay: null, wild: true, base: baseKey });
}

export function starterSpecies() {
  const out = {};
  for (const key of Object.keys(STARTER_GENOMES)) {
    const sp = makeSpecies(STARTER_GENOMES[key], { name: STARTER_NAMES[key], starter: STARTER_KEYS.includes(key), shop: true, discoveredDay: 1 });
    out[sp.id] = sp;
  }
  return out;
}

// ---------- crossing ----------
// Returns { outcome: 'success'|'sterile'|'wither'|'revert', child, instability, mutations: [gene names], seed }.
// Deterministic for the same (a, b, seed). opts.mutationBonus multiplies the mutation chance (fertiliser, neighbours).
export function cross(a, b, seed, opts = {}) {
  const G = CONFIG.genetics;
  const r = makeRng(seed);
  const A = normaliseGenome(a), B = normaliseGenome(b);
  const child = { traits: {} };
  const mutations = [];
  const log = [];          // per-gene decisions, for the breeding lab: {k, a, b, from, mutated, before, after}
  let mutationMass = 0;
  const mutChance = Math.min(0.6, G.mutationChance * (opts.mutationBonus || 1));

  for (const spec of GENES) {
    const va = A[spec.k], vb = B[spec.k];
    let v, from, before = null;
    if (spec.type === 'cat') {
      from = r() < 0.5 ? 'A' : 'B'; v = from === 'A' ? va : vb;
      // the family is a branch, not a gene that flips: a child belongs to one parent's family, always
      if (spec.k !== 'family' && r.chance(mutChance)) { before = v; const others = spec.values.filter(x => x !== v); v = r.pick(others); mutations.push(spec.k); mutationMass += 1; }
    } else if (spec.type === 'bool') {
      from = r() < 0.5 ? 'A' : 'B'; v = from === 'A' ? va : vb;
      if (r.chance(mutChance)) { before = v; v = !v; mutations.push(spec.k); mutationMass += 1; }
    } else {
      const lo = spec.min ?? 0, hi = spec.max ?? 1, range = hi - lo;
      if (spec.wrap) {
        // blend hues along the short arc
        let d = vb - va; if (d > 180) d -= 360; if (d < -180) d += 360;
        if (r() < 0.5) { from = r() < 0.5 ? 'A' : 'B'; v = from === 'A' ? va : vb; }
        else { from = 'blend'; v = va + d * r.range(0.3, 0.7) + r.gauss() * G.numericNoise * 60; }
      } else {
        if (r() < 0.5) { from = r() < 0.5 ? 'A' : 'B'; v = from === 'A' ? va : vb; }
        // anywhere from a bit short of one parent to a bit past the other (Build 101): a child can outgrow both, so the
        // extremes are bred toward rather than averaged away
        else { from = 'blend'; v = va + (vb - va) * r.range(-G.overshoot, 1 + G.overshoot) + r.gauss() * G.numericNoise * range; }
      }
      if (r.chance(mutChance)) { before = v; const jump = (r() < 0.5 ? -1 : 1) * r.range(0.15, G.mutationSize) * range; v += jump; mutations.push(spec.k); mutationMass += Math.abs(jump) / range * 2; }
      if (spec.type === 'int') v = Math.round(v);
    }
    child[spec.k] = v;
    log.push({ k: spec.k, type: spec.type, a: va, b: vb, from, mutated: before !== null, before, after: v });
  }

  const crossFamily = A.family !== B.family;
  { const va = A.vigor || 0, vb = B.vigor || 0;   // hybrid vigour: a step up across families, a fade within one
    child.vigor = crossFamily ? clamp(Math.max(va, vb) + G.vigorStep + r() * G.vigorJitter, 0, 1) : r2((va + vb) / 2 * G.vigorFade);
    const l = log.find(l => l.k === 'vigor'); if (l) { l.from = 'blend'; l.mutated = false; l.before = null; } }
  const traitLog = [];
  for (const t of RARE_TRAITS) {
    const n = (A.traits[t] ? 1 : 0) + (B.traits[t] ? 1 : 0);
    let p = n === 2 ? G.rareInheritBoth : n === 1 ? G.rareInheritOne : crossFamily ? G.rareGainChance * G.rareGainCrossFamilyBonus * (opts.mutationBonus || 1) : 0;   // from nothing: cross-family only
    child.traits[t] = r.chance(p);
    if (child.traits[t] && n === 0) { mutations.push('trait:' + t); mutationMass += 1.5; }
    traitLog.push({ t, inA: !!A.traits[t], inB: !!B.traits[t], p, got: child.traits[t] });
  }
  if (child.traits.multiHarvest) child.regrow = true;
  child.gen = Math.max(A.gen || 0, B.gen || 0) + 1;
  { // the body: unless it just mutated into something new, it lands somewhere between the parents' shapes (own dice,
    // so the rest of the cross rolls as before)
    const al = log.find(l => l.k === 'archetype'), wA = shapeWeights(A), wB = shapeWeights(B);
    child.shape2 = child.archetype; child.shapeMix = 0;
    if (!al.mutated && blendable(wA) && blendable(wB)) {
      const t = makeRng(seed ^ 0x5bd1e995).range(0.1, 0.9), w = {};
      for (const [a, v] of Object.entries(wA)) w[a] = (w[a] || 0) + v * (1 - t);
      for (const [a, v] of Object.entries(wB)) w[a] = (w[a] || 0) + v * t;
      const [[a1, v1], [a2, v2] = [a1, 0]] = Object.entries(w).sort((x, y) => y[1] - x[1]);
      const mix = r2(v2 / (v1 + v2));
      child.archetype = a1;
      if (mix >= 0.12) { child.shape2 = a2; child.shapeMix = mix; }
      al.after = child.archetype; al.from = 'blend'; al.shape2 = child.shapeMix ? child.shape2 : null; al.shapeMix = child.shapeMix;
    }
  }

  const norm = normaliseGenome(child);
  for (const l of log) l.after = norm[l.k];   // report the clamped/rounded value the child really gets
  const parts = { family: crossFamily ? G.familyDistancePenalty : 0, mutation: mutationMass * G.mutationInstability, rarity: (rarityScore(A) + rarityScore(B)) * G.rarityInstability };
  let instability = parts.family + parts.mutation + parts.rarity;
  instability = clamp(instability, G.minInstability, G.maxInstability);

  let outcome = 'success';
  const roll = r();
  if (roll < instability) {
    const f = G.failureSplit, x = r();
    outcome = x < f.sterile ? 'sterile' : x < f.sterile + f.wither ? 'wither' : 'revert';
  }
  return { outcome, child: norm, instability: r2(instability), mutations, seed, crossFamily, log, traitLog, instabilityParts: parts, roll: r2(roll), mutationMass: r2(mutationMass) };
}

