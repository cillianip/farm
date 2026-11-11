// Breeding lab (lab.html): a standalone page that runs the real cross() and crop renderer so the breeding visuals
// and the gene maths can be judged without playing. Nothing here touches the game state or saves.
import { CONFIG } from './config.js';
import { GENES, RARE_TRAITS, TRAIT_WEIGHT, WILD_BASES, WILD_NAMES, SURFACES, SKINNED, shownSurface, normaliseGenome, makeSpecies, cross, rarityScore, tierOf, growRealMinutes, ratePerMinute, variantWord, baseName } from './genetics.js';
import { cropSprite, produceSprite } from './render/crops.js';
import { traitList } from './ui.js';
import { formatMoney } from './economy.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const r2 = v => Math.round(v * 100) / 100;

// ---------- species pool: the 15 wild bases, plus every child bred on this page ----------
const pool = [];
for (const [k, g] of Object.entries(WILD_BASES)) pool.push(makeSpecies(g, { name: WILD_NAMES[k], starter: true }));
const names = () => new Set(pool.map(s => s.name));

function fillSelects() {
  for (const id of ['selA', 'selB']) {
    const sel = $(id), cur = sel.value;
    sel.innerHTML = '';
    pool.forEach((sp, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `${sp.name} (${sp.tier}, r${sp.rarity})`; sel.appendChild(o); });
    sel.value = cur !== '' && cur < pool.length ? cur : (id === 'selA' ? 0 : 3);
  }
  $('poolNote').textContent = `${pool.length} species in the pool`;
  renderPickers();
}
// Thumbnail pickers: one row per parent, click to choose. The hidden selects hold the choice.
function renderPickers() {
  for (const [grid, sel] of [['pickA', 'selA'], ['pickB', 'selB']]) {
    const g = $(grid); g.innerHTML = '';
    pool.forEach((sp, i) => {
      const b = document.createElement('div'); b.className = 'pb' + (+$(sel).value === i ? ' on' : ''); b.title = `${sp.name} · ${sp.tier} · rarity ${sp.rarity}`;
      b.appendChild(spriteCanvas(produceSprite(sp), 32));
      const l = document.createElement('div'); l.className = `tier-${sp.tier}`; l.textContent = sp.name.replace(/^Wild /, ''); b.appendChild(l);
      b.onclick = () => { $(sel).value = i; $(sel).dispatchEvent(new Event('change')); renderPickers(); };
      g.appendChild(b);
    });
  }
}

// ---------- drawing ----------
function spriteCanvas(src, size) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(src, 0, 0, size, size);
  return c;
}
function strip(sp, size = 64) {
  const wrap = document.createElement('div'); wrap.className = 'strip';
  const labels = ['seed', 'sprout', 'growing', 'ripe', 'produce'];
  // (innerHTML += would re-serialize and blank the canvases, so labels are built as nodes)
  const cell = (canvas, label) => { const d = document.createElement('div'); d.appendChild(canvas); const l = document.createElement('div'); l.className = 'lbl'; l.textContent = label; d.appendChild(l); return d; };
  [0, 1, 2, 3].forEach((st, i) => wrap.appendChild(cell(spriteCanvas(cropSprite(sp, st), size), labels[i])));
  wrap.appendChild(cell(spriteCanvas(produceSprite(sp), size), 'produce'));
  return wrap;
}
function kv(k, v) { return `<div class="kv"><span class="muted">${k}</span><span>${v}</span></div>`; }
function card(el, title, sp, extra = '', sel = null) {
  const g = sp.genome;
  el.innerHTML = `<h2>${title}</h2><div class="name tier-${sp.tier}">${esc(sp.name)}${sp.sterile ? ' (sterile)' : ''}</div>`;
  el.appendChild(strip(sp));
  if (sel) el.appendChild(skinRow(sp, sel));
  const info = document.createElement('div');   // appended as a node: innerHTML += on `el` would blank the canvases
  info.innerHTML = kv('Tier · rarity', `${sp.tier} · ${sp.rarity}`) + kv('Generation', g.gen || 0) + kv('Grows in', `${growRealMinutes(g).toFixed(1)} real min`)
    + kv('Harvest', `${g.count} × ${formatMoney(sp.value)} = ${formatMoney(sp.value * g.count)}`) + kv('Coins / min', formatMoney(ratePerMinute(sp.rarity)))
    + `<div class="muted" style="margin-top:6px">${esc(traitList(sp).join(' · '))}</div>` + extra;
  el.appendChild(info);
}

// Skin buttons under a parent: the same parent with another skin goes into the pool and is picked, so any body × skin can
// be tried without waiting for a mutation. Bodies that do not show a skin (grain heads, flowers, cobs, stars) say so.
function skinRow(sp, sel) {
  const row = document.createElement('div'); row.className = 'controls'; row.style.margin = '4px 0';
  const l = document.createElement('span'); l.className = 'muted'; l.textContent = 'Skin:'; row.appendChild(l);
  if (!SKINNED.has(sp.genome.archetype)) { l.textContent = `Skin: none shows on a ${sp.genome.archetype}`; return row; }
  for (const sf of SURFACES) {
    const b = document.createElement('button'); b.textContent = sf; if (shownSurface(sp.genome) === sf) b.className = 'primary';
    b.onclick = () => {
      if (shownSurface(sp.genome) === sf) return;
      const g = normaliseGenome({ ...sp.genome, surface: sf }), id = makeSpecies(g).id;
      let i = pool.findIndex(p => p.id === id);
      if (i < 0) { pool.push(makeSpecies(g, { name: `${sf[0].toUpperCase() + sf.slice(1)} ${sp.name.replace(/^(Smooth|Bumpy|Ribbed|Spiky) /, '')}` })); i = pool.length - 1; fillSelects(); }
      $(sel).value = i; $(sel).dispatchEvent(new Event('change')); renderPickers();
    };
    row.appendChild(b);
  }
  return row;
}

// ---------- gene table ----------
const fmt = (spec, v) => {
  if (v == null) return '';
  if (spec.type === 'bool') return v ? 'yes' : 'no';
  if (spec.type === 'cat' || spec.type === 'int') return String(v);
  const n = typeof v === 'number' ? (spec.max > 1 ? Math.round(v) : v.toFixed(2)) : v;
  if (spec.k.startsWith('hue') || spec.k === 'leafHue') return `<span class="sw" style="background:hsl(${Math.round(v)},70%,50%)"></span>${n}`;
  return n;
};
const HOW = { A: 'from A', B: 'from B', blend: 'blend' };
function geneTable(res, A, B) {
  let html = `<tr><th>Gene</th><th>A</th><th>B</th><th>Child</th><th>Decision</th><th>Rarity +</th></tr>`;
  for (const l of res.log) {
    const spec = GENES.find(s => s.k === l.k);
    const w = spec.w ? spec.w(l.after, normaliseGenome(res.child)) || 0 : 0;
    const wa = spec.w ? spec.w(l.a, A.genome) || 0 : 0, wb = spec.w ? spec.w(l.b, B.genome) || 0 : 0;
    html += `<tr class="${l.mutated ? 'mut' : ''}"><td>${l.k}</td><td>${fmt(spec, l.a)}${wa ? `<span class="tag">+${wa}</span>` : ''}</td><td>${fmt(spec, l.b)}${wb ? `<span class="tag">+${wb}</span>` : ''}</td><td><b>${fmt(spec, l.after)}</b></td>`
      + `<td><span class="tag ${l.from}">${HOW[l.from]}</span>${l.mutated ? `<span class="tag mut">MUTATED</span> <span class="muted">was ${fmt(spec, spec.type === 'int' ? Math.round(l.before) : l.before)}</span>` : ''}</td><td class="num">${w ? '+' + w : ''}</td></tr>`;
  }
  return html;
}
function traitTable(res) {
  let html = `<tr><th>Trait</th><th>In A</th><th>In B</th><th>Chance</th><th>Result</th></tr>`;
  for (const t of res.traitLog) html += `<tr class="${t.got ? 'trait-got' : ''}"><td>${t.t}</td><td>${t.inA ? 'yes' : '–'}</td><td>${t.inB ? 'yes' : '–'}</td><td class="num">${(t.p * 100).toFixed(1)}%</td><td>${t.got ? (t.inA || t.inB ? 'inherited' : 'GAINED ★') : 'no'} <span class="tag">+${TRAIT_WEIGHT[t.t]} rarity</span></td></tr>`;
  return html;
}
function instabilityBox(res) {
  const p = res.instabilityParts, G = CONFIG.genetics;
  const total = res.instability;
  const seg = (v, col) => `<div style="left:${Math.min(100, v * 100)}%; width:0"></div>`;
  let html = kv('Different families', res.crossFamily ? `+${p.family} (penalty)` : '0 (same family)')
    + kv('Mutation mass × ' + G.mutationInstability, `${res.mutationMass} → +${r2(p.mutation)}`)
    + kv('Parents\' rarity × ' + G.rarityInstability, `+${r2(p.rarity)}`)
    + kv('Instability (clamped ' + G.minInstability + '–' + G.maxInstability + ')', `<b>${total}</b>`)
    + kv('Roll', `${res.roll} ${res.roll < total ? '< instability → FAIL' : '≥ instability → success'}`);
  html += `<div class="bar"><div style="width:${total * 100}%; background:#d9453d"></div><div style="left:${total * 100}%; right:0; background:#7fb04a"></div><div class="mark" style="left:${res.roll * 100}%"></div></div>`;
  html += `<div class="muted">Red = failure zone, green = success. The mark is the roll. Failures split sterile ${G.failureSplit.sterile * 100}% / wither ${G.failureSplit.wither * 100}% / revert ${G.failureSplit.revert * 100}%.</div>`;
  return html;
}
function rarityBox(sp) {
  const g = sp.genome;
  const parts = [];
  for (const spec of GENES) if (spec.w) { const w = spec.w(g[spec.k], g) || 0; if (w) parts.push(`${spec.k} +${w}`); }
  for (const t of RARE_TRAITS) if (g.traits[t]) parts.push(`★${t} +${TRAIT_WEIGHT[t]}`);
  const gen = (g.gen || 0) * CONFIG.genetics.generationRarity;
  if (gen) parts.push(`generation ${g.gen} × ${CONFIG.genetics.generationRarity} = +${gen}`);
  const T = CONFIG.tiers.thresholds;
  return `<div>${parts.length ? parts.join(' · ') : 'no rarity-bearing genes'}</div>`
    + kv('Rarity score', `<b>${sp.rarity}</b> → ${sp.tier}`)
    + kv('Tier thresholds', `uncommon ${T.uncommon} · rare ${T.rare} · epic ${T.epic} · legendary ${T.legendary}`)
    + kv('Coins per real minute', `${CONFIG.tiers.rateBase} × ${CONFIG.tiers.rateGrowth}^${sp.rarity} = ${formatMoney(ratePerMinute(sp.rarity))}`)
    + kv('× grow minutes × size factor', `${growRealMinutes(g).toFixed(1)} × ${(0.7 + 0.6 * g.size).toFixed(2)}${g.traits.golden ? ' × 3 golden' : ''}${g.regrow ? ' × 0.8 regrow' : ''}`)
    + kv('One produce', `<b>${formatMoney(sp.value)}</b> · harvest of ${g.count} = ${formatMoney(sp.value * g.count)}`);
}

// ---------- breed ----------
function childSpecies(res, A, B) {
  if (res.outcome === 'wither') return null;
  if (res.outcome === 'revert') return A;
  let sp = makeSpecies(res.child, { sterile: res.outcome === 'sterile', parents: [A.id, B.id] });
  if (names().has(sp.name) && !pool.some(p => p.id === sp.id)) sp = { ...sp, name: `${variantWord(sp.genome)} ${sp.name}` };
  if (sp.sterile) sp = { ...sp, id: sp.id + '_s' };
  return sp;
}
const OUTCOME_TEXT = {
  success: 'SUCCESS: a viable new species. In the game you would get 2–4 seeds.',
  sterile: 'STERILE: the plant grows and sells but its seeds are dead. You would get 1 seed.',
  wither: 'WITHER: the cross failed, nothing grows.',
  revert: 'REVERT: the child is just parent A again (2 seeds).',
};
function breed() {
  const A = pool[+$('selA').value], B = pool[+$('selB').value], seed = +$('seed').value || 0;
  const res = cross(A.genome, B.genome, seed);
  const C = childSpecies(res, A, B);
  card($('cardA'), 'Parent A', A, '', 'selA'); card($('cardB'), 'Parent B', B, '', 'selB');
  if (C) {
    const isNew = !pool.some(p => p.id === C.id);
    card($('cardC'), 'Child', C, isNew && res.outcome !== 'revert' ? `<div style="margin-top:8px"><button id="keep">Add to pool</button> <span class="muted">so it can be bred again</span></div>` : '');
    const keep = $('keep'); if (keep) keep.onclick = () => { pool.push(C); fillSelects(); card($('cardC'), 'Child', C, '<div class="muted" style="margin-top:8px">In the pool.</div>'); };
  } else $('cardC').innerHTML = `<h2>Child</h2><div class="banner wither">Withered. Nothing to show.</div>`;
  $('result').style.display = '';
  $('banner').className = `banner ${res.outcome}`;
  $('banner').textContent = `${OUTCOME_TEXT[res.outcome]}  Mutations: ${res.mutations.length ? res.mutations.join(', ') : 'none'}.`;
  $('instab').innerHTML = instabilityBox(res);
  $('traits').innerHTML = traitTable(res);
  $('genes').innerHTML = geneTable(res, A, B);
  $('rarity').innerHTML = C && res.outcome !== 'revert' ? rarityBox(C) : `<div class="muted">No new species this time. The child genome would have scored ${rarityScore(res.child)} (${tierOf(rarityScore(res.child))}).</div>`;
}

// ---------- gallery & stats ----------
function gallery() {
  const A = pool[+$('selA').value], B = pool[+$('selB').value];
  const grid = $('galleryGrid'); grid.innerHTML = '';
  for (let seed = 1; seed <= 48; seed++) {
    const res = cross(A.genome, B.genome, seed);
    const g = document.createElement('div'); g.className = 'g';
    const sp = makeSpecies(res.child);
    const c = spriteCanvas(cropSprite(sp, 3), 64), pc = spriteCanvas(produceSprite(sp), 64);   // the produce beside the plant: skins are too small to judge on the plant
    pc.className = 'prod';
    for (const k of [c, pc]) { if (res.outcome === 'sterile') k.style.borderColor = '#d9453d'; else if (res.outcome !== 'success') { k.style.borderColor = '#777'; k.style.opacity = 0.35; } }
    g.appendChild(c); g.appendChild(pc);
    const l = document.createElement('div'); l.className = `tier-${sp.tier}`; l.innerHTML = `${esc(sp.name)}<br>${res.outcome === 'success' ? sp.tier + ' r' + sp.rarity : res.outcome}`; g.appendChild(l);
    g.title = `seed ${seed}: ${res.outcome}, ${sp.name}, rarity ${sp.rarity}, mutations: ${res.mutations.join(', ') || 'none'}`;
    g.onclick = () => { $('seed').value = seed; breed(); window.scrollTo(0, 0); };
    grid.appendChild(g);
  }
  $('galleryPanel').style.display = '';
}
function stats() {
  const A = pool[+$('selA').value], B = pool[+$('selB').value];
  const N = 500, out = { success: 0, sterile: 0, wither: 0, revert: 0 }, tiers = {}, mutCount = {};
  let rar = 0, muts = 0, traitsGained = 0, newFamilies = 0, value = 0;
  for (let seed = 1; seed <= N; seed++) {
    const res = cross(A.genome, B.genome, seed); out[res.outcome]++;
    if (res.outcome === 'success') { const sp = makeSpecies(res.child); tiers[sp.tier] = (tiers[sp.tier] || 0) + 1; rar += sp.rarity; value += sp.value * sp.genome.count; if (res.child.family !== A.genome.family && res.child.family !== B.genome.family) newFamilies++; }
    muts += res.mutations.length; for (const m of res.mutations) { mutCount[m] = (mutCount[m] || 0) + 1; if (m.startsWith('trait:')) traitsGained++; }
  }
  const ok = out.success || 1;
  $('statsBody').innerHTML = kv('Outcomes', `success ${out.success} · sterile ${out.sterile} · wither ${out.wither} · revert ${out.revert}`)
    + kv('Tiers among successes', CONFIG.tiers.order.map(t => `${t} ${tiers[t] || 0}`).join(' · '))
    + kv('Average rarity of a success', (rar / ok).toFixed(2) + ` (parents ${A.rarity} and ${B.rarity})`)
    + kv('Average harvest value of a success', formatMoney(value / ok) + ` (parents ${formatMoney(A.value * A.genome.count)} / ${formatMoney(B.value * B.genome.count)})`)
    + kv('Mutations per cross', (muts / N).toFixed(2) + ` (${GENES.length} genes × ${CONFIG.genetics.mutationChance})`)
    + kv('Rare traits gained from nothing', `${traitsGained} in ${N}`)
    + kv('Children in a family neither parent has', `${newFamilies}`)
    + `<div class="muted" style="margin-top:6px">Most mutated genes: ${Object.entries(mutCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'}</div>`;
  $('statsPanel').style.display = '';
}

function sheet() {
  const rows = [...pool].sort((a, b) => a.value * a.genome.count - b.value * b.genome.count);
  const t = $('sheetTable'); t.innerHTML = '';
  const head = document.createElement('tr'); head.innerHTML = '<th>Species</th><th>Stages → produce</th><th>Tier · rarity</th><th>Grow</th><th>Harvest</th><th>$/min</th><th>Notes</th>'; t.appendChild(head);
  for (const sp of rows) {
    const g = sp.genome, tr = document.createElement('tr');
    const name = document.createElement('td'); name.innerHTML = `<b class="tier-${sp.tier}">${esc(sp.name)}</b><br><span class="muted">${g.family} · ${shownSurface(g) !== 'smooth' ? shownSurface(g) + ' ' : ''}${g.archetype}</span>`; tr.appendChild(name);
    const pics = document.createElement('td'); for (const st of [0, 1, 2, 3]) pics.appendChild(spriteCanvas(cropSprite(sp, st), 96)); pics.appendChild(spriteCanvas(produceSprite(sp), 96)); tr.appendChild(pics);
    const rest = document.createElement('td'); rest.innerHTML = `${sp.tier} · ${sp.rarity}`; tr.appendChild(rest);
    const grow = document.createElement('td'); grow.innerHTML = `${growRealMinutes(g).toFixed(1)} min`; tr.appendChild(grow);
    const harv = document.createElement('td'); harv.innerHTML = `${g.count} × ${formatMoney(sp.value)}<br><b>${formatMoney(sp.value * g.count)}</b>`; tr.appendChild(harv);
    const rate = document.createElement('td'); rate.innerHTML = formatMoney(sp.value * g.count / growRealMinutes(g)); tr.appendChild(rate);
    const notes = document.createElement('td'); notes.className = 'muted'; notes.textContent = traitList(sp).join(' · '); tr.appendChild(notes);
    t.appendChild(tr);
  }
  $('sheetPanel').style.display = '';
}

// ---------- wire up ----------
document.fonts?.ready.then(() => {});
fillSelects();
card($('cardA'), 'Parent A', pool[0], '', 'selA'); card($('cardB'), 'Parent B', pool[3], '', 'selB');
$('selA').onchange = () => card($('cardA'), 'Parent A', pool[+$('selA').value], '', 'selA');
$('selB').onchange = () => card($('cardB'), 'Parent B', pool[+$('selB').value], '', 'selB');
$('breed').onclick = breed;
$('reroll').onclick = () => { $('seed').value = Math.floor(Math.random() * 1e6); breed(); };
$('gallery').onclick = gallery;
$('stats').onclick = stats;
$('sheet').onclick = sheet;
window.lab = { pool, breed, gallery, stats, sheet, cross, makeSpecies, baseName };
