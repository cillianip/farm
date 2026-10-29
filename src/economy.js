import { CONFIG } from './config.js';
const E = CONFIG.economy;
export const seedBookBonus = state => Math.max(0, state.discovered.length - Object.values(state.species).filter(s => s.shop).length) * E.seedBookBonusPerSpecies;
export function breedCost(state, a, b) { return Math.round(E.breedCostBase + (a.rarity + b.rarity) * 1.5 + Math.sqrt(state.stats.breeds) * 3); }

export function salePrice(state, item) {
  const sp = state.species[item.species]; if (!sp) return 0;
  const quality = 1 + (item.q || 0) * CONFIG.fertiliser.qualityStarValue;
  return sp.value * quality * (1 + seedBookBonus(state));
}
export function formatMoney(v) {
  const abs = Math.abs(v);
  const units = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
  for (const [n, s] of units) if (abs >= n) return '$' + (v / n).toFixed(abs >= n * 100 ? 0 : abs >= n * 10 ? 1 : 2) + s;
  return '$' + (abs >= 100 ? v.toFixed(0) : v.toFixed(2));
}
export function titleFor(lifetime) {
  let t = CONFIG.titles[0][1];
  for (const [min, name] of CONFIG.titles) if (lifetime >= min) t = name;
  return t;
}
