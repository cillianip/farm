// Fertilisers are a bag of effect stats sharing one power budget. Compost derives its stats from the crops put in.
import { CONFIG } from './config.js';
import { hashString } from './rng.js';
export const FERT_STATS = ['speed', 'quality', 'yield', 'waterKeep', 'hardiness', 'mutation'];
export const STAT_LABEL = { speed: 'Speed', quality: 'Quality', yield: 'Yield', waterKeep: 'Water keep', hardiness: 'Hardiness', mutation: 'Mutation' };

// inputs: [{species|null (withered), qty}] → fertiliser {name, stats, budget}
export function makeCompost(inputs, species) {
  const F = CONFIG.fertiliser;
  const pull = Object.fromEntries(FERT_STATS.map(s => [s, 0]));
  let n = 0, qualitySum = 0;
  for (const inp of inputs) {
    const sp = inp.species ? species[inp.species] : null;
    for (let i = 0; i < inp.qty; i++) {
      n++;
      if (!sp) { pull.hardiness += 0.3; continue; }                 // withered plants: a little hardiness
      const g = sp.genome;
      if (g.growHours < 8) pull.speed += 1; else if (g.growHours < 14) pull.speed += 0.4;
      if (g.count >= 3) pull.yield += 1; else if (g.count === 2) pull.yield += 0.4;
      if (g.hardiness > 0.6) pull.hardiness += 1;
      if (g.thirst < 0.35) pull.waterKeep += 1;
      if (sp.tier !== 'common') pull.quality += 1 + (CONFIG.tiers.order.indexOf(sp.tier) - 1) * 0.5;
      if ((g.gen || 0) > 0) pull.mutation += 0.6 + Math.min(2, g.gen * 0.3);
      qualitySum += CONFIG.tiers.order.indexOf(sp.tier);
    }
  }
  const total = FERT_STATS.reduce((s, k) => s + pull[k], 0) || 1;
  const budget = Math.min(F.compostBudgetCap, n * F.compostBudgetPerInput * (1 + qualitySum / Math.max(1, n)));
  const stats = {};
  for (const k of FERT_STATS) { const v = Math.round(budget * (pull[k] / total) * 100) / 100; if (v >= 0.02) stats[k] = Math.min(F.statCap, v); }
  const keys = Object.keys(stats);
  const base = keys.length === 0 ? 'Plain compost' : keys.length === 1 ? `${STAT_LABEL[keys[0]]} compost` : keys.length <= 2 ? `${keys.map(k => STAT_LABEL[k]).join(' & ')} compost` : 'All-purpose compost';
  const grade = gradeOf(budget);
  return { name: `${base} ${GRADE_NUMERAL[grade]}`, grade, stats, budget: Math.round(budget * 100) / 100, id: 'f' + hashString(JSON.stringify(stats)).toString(36) };
}
// Grade: how much power the batch holds, I to III. A few common crops make a thin batch; a full bin, or rarer crops, a rich one.
export const GRADE_NUMERAL = { 1: 'I', 2: 'II', 3: 'III' }, GRADE_WORD = { 1: 'thin', 2: 'good', 3: 'rich' };
export const gradeOf = budget => budget < 0.3 ? 1 : budget < 0.5 ? 2 : 3;
export const fertGrade = f => f.grade || gradeOf(f.budget || 0);
// What one plant pulls the heap toward (labels for the panel). A withered plant adds only a little hardiness.
export function contributions(sp) {
  if (!sp) return ['Hardiness'];
  const g = sp.genome, out = [];
  if (g.growHours < 14) out.push('Speed'); if (g.count >= 2) out.push('Yield'); if (g.hardiness > 0.6) out.push('Hardiness');
  if (g.thirst < 0.35) out.push('Water keep'); if (sp.tier !== 'common') out.push('Quality'); if ((g.gen || 0) > 0) out.push('Mutation');
  return out;
}
export const fertDescribe = f => Object.entries(f.stats).map(([k, v]) => `${STAT_LABEL[k]} +${Math.round(v * 100)}%`).join(', ') || 'no effect';
