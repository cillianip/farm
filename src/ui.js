// DOM UI: HUD, hotbar, hover card, toasts and the panels (catalogue, chest, crate, seed rack, bench, compost, seed book, morning, settings).
import { CONFIG } from './config.js';
import * as S from './sim.js';
import { itemName, itemKey, isFood } from './items.js';
import { formatMoney, titleFor, salePrice, seedBookBonus, driedFactor, dryHours } from './economy.js';
import { cropSprite, produceSprite, driedSprite } from './render/crops.js';
import { toolIcon, seedIcon, fertIcon, fuelIcon, coinIcon, sprinklerSprite, pipeSprite, witheredSprite, seedRackSprite, crateSprite, treeSprite, benchSprite, cartSprite, handsIcon, compostSprite, pumpIcon, stationIcon, chestSprite, basketIcon, barrowSprite, forkliftSprite } from './render/sprites.js';
import { catalog, placeOrder, cancelOrder, seedRotationIn, roles } from './catalog.js';
import * as M from './market.js';
import { MARKET } from './market.js';
import { fertDescribe, STAT_LABEL, contributions, fertGrade, GRADE_WORD, starsWord, fertLook } from './fertiliser.js';
import { growRealMinutes, RARE_TRAITS } from './genetics.js';

const $ = id => document.getElementById(id);
// money a day for the cards: short, no cents past $10
const perDay = v => (v >= 1000 ? formatMoney(v) : '$' + (v >= 10 ? Math.round(v) : v.toFixed(1))) + ' a day';
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
// Fill a details box without letting the panel shrink back: the box keeps the tallest height it has shown, so the
// slots under the cursor never jump away and back as the card changes (the flicker at a slot's edge).
function setDetails(d, html) { d.innerHTML = html; const h = d.offsetHeight; if (h > (d.minH || 0)) { d.minH = h; d.style.minHeight = h + 'px'; } }
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export function itemIcon(item, species, size = 48) {
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  let src = null;
  if (item.kind === 'tool') src = toolIcon(item.tool);
  else if (item.kind === 'seed') { const g = species[item.species]?.genome; src = g ? seedIcon(Math.round(g.hue1), g.sat1, g.light1) : null; }
  else if (item.kind === 'crop') { const sp = species[item.species]; src = sp ? produceSprite(sp) : null; }
  else if (item.kind === 'product') { const sp = species[item.species]; src = sp ? driedSprite(sp) : null; }
  else if (item.kind === 'fert') src = fertIcon(fertLook(item.fert));
  else if (item.kind === 'fuel') src = fuelIcon();
  else if (item.kind === 'sprinkler') src = sprinklerSprite(item.level || 0, 0);
  else if (item.kind === 'pipe') src = pipeSprite(10);
  else if (item.kind === 'pump') src = pumpIcon(item.level || 0);
  else if (['generator', 'line', 'belt', 'picker', 'hopper', 'dryer', 'splitter', 'filter', 'dcrate', 'planter'].includes(item.kind)) src = stationIcon(item.level && ['generator', 'picker', 'planter'].includes(item.kind) ? item.kind + item.level : item.kind);
  else if (item.kind === 'chest') src = chestSprite(false, false, item.level || 0);
  else if (item.kind === 'withered') src = witheredSprite();
  else if (item.kind === 'pulled') { const sp = species[item.species]; src = sp ? cropSprite(sp, item.unknown ? 1 : 2, 0) : witheredSprite(); }
  if (src) ctx.drawImage(src, 0, 0, size, size);
  return c;
}

export class UI {
  constructor(game) {
    this.game = game;
    this.held = null;   // {inv, index} item picked up in a slot UI
    this.openPanel = null;
    $('panel-close').onclick = () => this.closePanel();
    $('panel').addEventListener('mousedown', e => { if (e.target === $('panel')) this.closePanel(); });
  }
  get state() { return this.game.state; }

  // ---------- HUD ----------
  updateHud() {
    if (!$('money')) return;
    const s = this.state;
    $('money').textContent = formatMoney(s.money);
    $('title').textContent = titleFor(s.lifetime) + (seedBookBonus(s) ? ` · seed book +${Math.round(seedBookBonus(s) * 100)}%` : '');
    $('clock').textContent = S.clockText(s) + (s.rainToday ? ' ☂' : '');
    const pct = Math.max(0, s.energy / s.energyMax * 100);
    $('energy-fill').style.width = pct + '%';
    $('energy-fill').style.background = pct < 20 ? 'var(--red)' : pct < 50 ? 'var(--gold)' : 'var(--green)';
    $('energy-text').textContent = `${Math.round(s.energy)} / ${s.energyMax}`;
  }
  renderHotbar() {
    const bar = $('hotbar'); if (!bar) return; bar.innerHTML = '';
    for (let i = 0; i < CONFIG.inventory.hotbar; i++) {
      const slot = this.slotEl(this.state.inventory, i, i === this.game.selected, String(i + 1));
      slot.onclick = () => { this.game.selected = i; this.renderHotbar(); };
      bar.appendChild(slot);
    }
  }
  slotEl(inv, i, active, key) {
    const it = inv.slots[i];
    const d = el('div', 'slot' + (active ? ' active' : ''));
    if (key) d.appendChild(el('span', 'key', key));
    if (it) {
      d.appendChild(itemIcon(it, this.state.species));
      if (it.kind !== 'tool') d.appendChild(el('span', 'qty', it.qty));
      d.title = itemName(it, this.state.species) + (it.kind === 'fert' ? ` (${GRADE_WORD[fertGrade(it.fert)]}): ` + fertDescribe(it.fert) : '');
    }
    return d;
  }
  toast(msg) { if (!msg) return; const t = el('div', 'toast', esc(msg)); $('toasts').appendChild(t); setTimeout(() => t.remove(), 3000); }

  // ---------- hover card: everything on the tile, layered ----------
  hover(tile, x, y, screenX, screenY) {
    const card = $('hover-card');
    const s = this.state;
    if (!tile || this.game.hit?.kind === 'eat') { card.classList.add('hidden'); return; }
    const info = this.game.tileInfo(x, y);
    let html = `<div class="pc-title">${esc(info.title)}</div>`;
    if (info.sub) html += `<div class="pc-sub">${esc(info.sub)}</div>`;
    if (tile.t === 'grass' && tile.tilled) {
      const m = Math.round(S.moistureOf(tile)), st = S.moistureState(tile);
      const col = { dry: '#c98a3c', moist: '#7fb04a', wet: '#3f8fd6', soggy: '#5a4ea8' }[st];
      const note = { dry: 'Too dry to grow. Water it.', moist: 'Growing slowly. A little more water.', wet: 'Just right.', soggy: 'Waterlogged: roots can\'t breathe.' }[st];
      html += `<div class="pc-sec">Soil</div><div class="pc-row"><span>Moisture</span><span>${m}% · ${st}</span></div>${bar(m, col)}<div class="pc-note">${note}</div>`;
      if (tile.fert) html += `<div class="pc-row"><span>Fertiliser</span><span>${esc(tile.fert.name)}</span></div><div class="pc-note">${esc(fertDescribe(tile.fert))}</div>`;
    }
    if (tile.crop) {
      const c = tile.crop, sp = s.species[c.speciesId], g = sp.genome, stage = S.cropStage(c);
      const m = S.feltMoisture(tile, g), factor = S.moistureGrowthFactor(m);
      let name, hint = '';
      if (c.dead) name = c.unknown ? 'A withered plant' : `Withered ${sp.name}`;
      else if (c.unknown) { name = stage === 0 ? 'A seed' : stage === 1 ? 'An unknown sprout' : `Looks like a ${FAMILY_WORD[g.family]}`; hint = c.fromBird && stage === 0 ? 'Dropped by a bird. Keep the soil moist.' : stage === 1 ? 'Too small to tell yet.' : 'You\'ll know it when it ripens.'; }
      else name = sp.name;
      html += `<div class="pc-sec">${stage === 0 ? 'In the soil' : 'Plant'}</div><div class="pc-name tier-${c.unknown ? 'unknown' : sp.tier}">${esc(name)}</div>`;
      if (hint) html += `<div class="pc-note">${esc(hint)}</div>`;
      if (!c.dead) {
        const rf = S.rotFactor(s, c), stageName = stage === 3 ? (rf < 1 ? 'Overripe' : 'Ripe') : ['Seed', 'Sprout', 'Growing'][stage];
        html += `<div class="pc-row"><span>${stageName}</span><span>${Math.floor(c.growth)}%</span></div>${bar(c.growth, '#5cb85c')}`;
        html += `<div class="pc-row"><span>Health</span><span>${Math.round(c.health)}%</span></div>${bar(c.health, c.health > 50 ? '#5cb85c' : '#d9453d')}`;
        if (stage === 3 && rf >= 1) { const left = S.ripeHoursLeft(s, c); html += `<div class="pc-note">Ripe. Click it to harvest.${left != null ? ` It keeps for ${left < 1 ? 'under an hour' : '~' + Math.ceil(left) + ' h'}, then it starts to rot.` : ''}</div>`; }
        if (stage === 3 && rf < 1) html += `<div class="pc-note warn">Overripe: left standing too long. Worth ${Math.round(rf * 100)}% of its price now, and it withers in ~${Math.ceil(rf * CONFIG.crop.rotHours)} h unless you pick it.</div>`;
        const f = tile.fert?.stats || {}, fmtMin = v => v < 1 ? 'under a minute' : `~${Math.ceil(v)} min`;
        if (stage < 3) { const base = factor > 0 ? ((100 - c.growth) / 100) * growRealMinutes(g) / factor : null, mins = base == null ? null : base / (1 + (f.speed || 0)); html += `<div class="pc-row"><span>Ripe in</span><span>${mins == null ? 'not growing (dry)' : f.speed && fmtMin(base) !== fmtMin(mins) ? `${fmtMin(base)} → ${fmtMin(mins)}` : fmtMin(mins)}</span></div>`; }
        if (!c.unknown) { const n = g.count + (f.yield || 0) * 3, nStr = Number.isInteger(n) ? `${n}` : n.toFixed(1); html += `<div class="pc-row"><span>Harvest</span><span>${f.yield ? `${g.count}× → ${nStr}×` : `${g.count}×`} · ${formatMoney(salePrice(s, { species: sp.id }))} each</span></div>`; }
        if (f.quality) html += `<div class="pc-row"><span>Stars</span><span>${starsWord(f.quality)}</span></div><div class="pc-note">Each star adds ${Math.round(CONFIG.fertiliser.qualityStarValue * 100)}% fresh, half that dried. The bag stays while this plant stands: a regrowing crop keeps it for good.</div>`;
        if (!c.unknown) html += `<div class="pc-row"><span>Bed earns</span><span>${perDay(S.bedRatePerDay(s, sp))}</span></div><div class="pc-row"><span>Water</span><span>~${S.poursPerDay(g)} pours/day</span></div>` + traitRows(sp);
      }
    }
    if (tile.t === 'seedrack' && S.activeTray(s)) {
      s.seedRack.trays.forEach((tr, k) => {
        if (!tr.item) return;
        const sp = s.species[tr.item.species], [lo, hi] = S.seedRange(sp), ready = S.trayReady(s, tr), pct = Math.round(S.trayProgress(s, tr) * 100);
        const realMin = Math.max(0, tr.readyAt - s.minutes) / S.gameMinutesPerRealSecond() / 60;
        html += `<div class="pc-sec">Tray ${k + 1}</div><div class="pc-name tier-${sp.tier}">${esc(sp.name)}</div>`;
        if (ready) html += `<div class="pc-row"><span>Dried</span><span>${tr.item.seeds} seeds</span></div><div class="pc-note">Click to take them.</div>`;
        else html += `<div class="pc-row"><span>Drying</span><span>${pct}%</span></div>${bar(pct, '#e8a23b')}<div class="pc-row"><span>Ready in</span><span>${realMin < 1 ? 'under a minute' : `~${Math.ceil(realMin)} min`}</span></div><div class="pc-row"><span>Will give</span><span>${lo === hi ? lo : `${lo}–${hi}`} seeds</span></div>`;
      });
    }
    if (tile.t === 'crate') {
      const n = S.crateCount(s);
      html += `<div class="pc-sec">Inside</div><div class="pc-row"><span>Filled</span><span>${n} / ${s.crate.capacity}</span></div>${bar(n / s.crate.capacity * 100, '#f6c453')}`;
      const P = S.priceCrate(s, S.allCrateItems(s));
      for (const l of P.lines) { html += `<div class="pc-row"><span>${esc(l.name)} ×${l.qty}</span><span>${formatMoney(l.total)}</span></div>`; if (l.cut) html += `<div class="pc-row muted"><span>&nbsp;&nbsp;${l.full} at the buyer's price, ${l.cut} sold on cheaper</span><span></span></div>`; }
      if (n) { html += `<div class="pc-row"><span>Tonight</span><span>+${formatMoney(P.total)}</span></div>`; if (P.lines.some(l => l.cut)) html += `<div class="pc-note">The buyer takes ${CONFIG.demand.full} of a kind at full price; the rest sell on cheaper.</div>`; }
      else if (s.crate.lastSale) html += `<div class="pc-note">Last pickup: ${s.crate.lastSale.count} crops for ${formatMoney(s.crate.lastSale.total)}.</div>`;
      else html += `<div class="pc-note">Empty. Harvest something and drop it in.</div>`;
    }
    if (tile.tilled && !tile.obj && S.sprinklerCovers(s, x, y)) html += `<div class="pc-note">Under a sprinkler: topped up while you are awake.</div>`;
    if (html !== this.lastCard) { card.innerHTML = html; this.lastCard = html; }
    card.classList.remove('hidden');
    const gw = $('game').clientWidth, gh = $('game').clientHeight;
    card.style.left = Math.min(gw - card.offsetWidth - 8, screenX + 24) + 'px';
    card.style.top = Math.min(gh - card.offsetHeight - 8, Math.max(8, screenY - 12)) + 'px';
  }
  hideHover() { $('hover-card').classList.add('hidden'); this.panelHover = false; }
  // the hotbar card: what the thing in your hand is and the few numbers that matter
  hoverItem(it, screenX, screenY) {
    const card = $('hover-card'), s = this.state, sp = it.species ? s.species[it.species] : null, g = sp?.genome;
    let html = `<div class="pc-title${sp ? ' tier-' + sp.tier : ''}">${esc(itemName(it, s.species))}${it.qty > 1 && it.kind !== 'tool' ? ` <span class="muted">×${it.qty}</span>` : ''}</div>`;
    if (it.kind === 'crop' && sp) {
      const hunger = CONFIG.needs.eatBase + CONFIG.needs.eatPerSize * g.size, energy = Math.round(hunger * CONFIG.needs.eatEnergyPerHunger), [lo, hi] = S.seedRange(sp);
      html += `<div class="pc-sub">${esc(sp.tier)} · ${esc(g.archetype)} ${esc(g.family)}</div>` + traitRows(sp);
      html += `<div class="pc-row"><span>Sells for</span><span>${formatMoney(salePrice(s, it))}${it.qty > 1 ? ` <span class="muted">×${it.qty} = ${formatMoney(salePrice(s, it) * it.qty)}</span>` : ''}</span></div>`;
      html += `<div class="pc-row"><span>Eat</span><span>+${Math.round(hunger)} food · +${energy} energy</span></div>`;
      html += sp.sterile ? `<div class="pc-row"><span>On the rack</span><span>nothing (sterile)</span></div>` : `<div class="pc-row"><span>On the rack</span><span>${lo === hi ? lo : `${lo}–${hi}`} seeds</span></div>`;
      html += `<div class="pc-row"><span>In the dryer</span><span>${formatMoney(salePrice(s, { ...it, kind: 'product', product: 'dried' }))} each · ${dryHours(sp).toFixed(1)} h a batch</span></div>`;
      html += `<div class="pc-row"><span>Bed earns</span><span>${perDay(S.bedRatePerDay(s, sp))}</span></div><div class="pc-row"><span>Water</span><span>~${S.poursPerDay(g)} pours/day</span></div>`;
      html += `<div class="pc-note">Click yourself to eat it. Drop it in the crate to sell.</div>`;
    } else if (it.kind === 'product' && sp) {
      html += `<div class="pc-sub">dried ${esc(g.archetype)} ${esc(g.family)}</div>`;
      html += `<div class="pc-row"><span>Sells for</span><span>${formatMoney(salePrice(s, it))}${it.qty > 1 ? ` <span class="muted">×${it.qty} = ${formatMoney(salePrice(s, it) * it.qty)}</span>` : ''}</span></div>`;
      html += `<div class="pc-row"><span>Fresh it was</span><span>${formatMoney(salePrice(s, { kind: 'crop', species: it.species, q: it.q }))} · dried ×${driedFactor(sp).toFixed(2)}</span></div>`;
      html += `<div class="pc-note">Its own line at the cart's buyer, apart from the fresh crop. Shoppers at the market ask for dried goods by name.${it.q ? ' Stars count for half once it is dried.' : ''}</div>`;
    } else if (it.kind === 'seed' && sp) {
      html += `<div class="pc-sub">${esc(sp.tier)} · ${esc(g.archetype)} ${esc(g.family)}</div>` + traitRows(sp);
      html += `<div class="pc-row"><span>Ripens in</span><span>${growRealMinutes(g).toFixed(1)} min</span></div>`;
      html += `<div class="pc-row"><span>Harvest</span><span>${g.count} × ${formatMoney(salePrice(s, { species: sp.id }))}</span></div>`;
      html += `<div class="pc-row"><span>Bed earns</span><span>${perDay(S.bedRatePerDay(s, sp))}</span></div><div class="pc-row"><span>Water</span><span>~${S.poursPerDay(g)} pours/day</span></div>`;
      html += `<div class="pc-note">Click a tilled bed to plant.</div>`;
    } else if (it.kind === 'fert') {
      const n = fertGrade(it.fert);
      html += `<div class="pc-row"><span>Grade</span><span>${'●'.repeat(n)}${'○'.repeat(3 - n)} ${GRADE_WORD[n]}</span></div><div class="pc-note">${esc(fertDescribe(it.fert))}</div><div class="pc-note">Click a tilled bed to work it in. One bag, one harvest: a regrowing plant wants a fresh bag each time.</div>`;
    } else if (it.kind === 'sprinkler') {
      const tier = CONFIG.sprinkler.tiers[it.level || 0], R = tier.radius, n = (2 * R + 1) ** 2 - 1;
      html += `<div class="pc-row"><span>Waters</span><span>the ${n} beds around it</span></div><div class="pc-row"><span>Flow</span><span>drinks ${tier.draw} ${tier.draw === 1 ? 'tile' : 'tiles'} of it</span></div><div class="pc-row"><span>Water bill</span><span>${formatMoney(CONFIG.sprinkler.pricePerPour)} a pour</span></div><div class="pc-note">Set it on pipe the flow reaches with at least that much left. While you are awake it tops up any bed around it the moment it dries below the band. The hoe picks it up.</div>`;
    } else if (it.kind === 'pump') {
      const tier = CONFIG.pump.tiers[it.level || 0];
      html += `<div class="pc-row"><span>Adds</span><span>${tier.head} tiles of flow</span></div>` + (tier.fuelPerDay ? `<div class="pc-row"><span>Fuel</span><span>${tier.fuelPerDay === 1 ? 'a can' : tier.fuelPerDay + ' cans'} a night, holds ${CONFIG.fuel.tank}</span></div>` : '') + `<div class="pc-note">Set it on pipe the flow still reaches: from there the flow carries ${tier.head} tiles further. The well alone gives ${CONFIG.pump.wellHead}, a tile costs 1, a split gives each branch what it asks for and shares the rest, and a sprinkler drinks its draw.${tier.stillBelow != null ? ` On a calm day it turns slowly and adds ${tier.calmHead}.` : ''}${tier.fuelPerDay ? ' Pour fuel in with cans in hand; empty, it stops.' : ''} The hoe picks it up.</div>`;
    } else if (it.kind === 'generator') {
      const G = CONFIG.power.generator;
      html += `<div class="pc-row"><span>Makes</span><span>${G.power} power</span></div><div class="pc-row"><span>Fuel</span><span>${G.fuelPerDay === 1 ? 'a can' : G.fuelPerDay + ' cans'} a night while on, holds ${CONFIG.fuel.tank}</span></div><div class="pc-note">Set it on your land, pour fuel in with cans in hand, and lay power line from it. Each machine on the line draws its share; when the line asks for more than the generator makes, the nearest run. Click it to switch it off and on: off, it burns nothing. The hoe picks it up.</div>`;
    } else if (it.kind === 'fuel') {
      html += `<div class="pc-row"><span>Runs</span><span>a generator or an engine for a night</span></div><div class="pc-row"><span>Tank</span><span>${CONFIG.fuel.tank} cans</span></div><div class="pc-note">Click a generator or an engine with it in hand to pour cans in, as many as the tank takes. Off, a generator burns nothing. The hoe gives the cans back when it picks the machine up.</div>`;
    } else if (it.kind === 'line') {
      html += `<div class="pc-row"><span>Carries</span><span>power only</span></div><div class="pc-row"><span>Lays</span><span>one tile a section</span></div><div class="pc-note">Wire on posts. Start beside the generator and run it out to where the pickers and the hopper stand, over clear ground or under a bed: laid on a tilled bed it runs beneath, and the bed stays yours to plant. It can share a tile with pipe and belt. Powered line shows a spark. The hoe picks a section up.</div>`;
    } else if (it.kind === 'belt') {
      const B = CONFIG.power.belt;
      html += `<div class="pc-row"><span>Carries</span><span>crops only</span></div><div class="pc-row"><span>Holds</span><span>${B.holds} crops a tile</span></div><div class="pc-row"><span>Lays</span><span>one tile a section</span></div><div class="pc-note">Run it from beside the pickers to beside a hopper, over clear ground, never through a bed; it can share a tile with pipe and line. The hopper's motor drives it, so a run with no powered hopper at its end stands still. Crops move one tile every ${B.stepMinutes} minutes. The hoe picks a section up; empty hands take what lies on it.</div>`;
    } else if (it.kind === 'picker') {
      const P = CONFIG.power.picker, n = (2 * P.radius + 1) ** 2 - 1;
      html += `<div class="pc-row"><span>Works</span><span>the ${n} beds around it</span></div><div class="pc-row"><span>Takes</span><span>${P.perHour} ripe ${P.perHour === 1 ? 'crop' : 'crops'} an hour</span></div><div class="pc-row"><span>Basket</span><span>${P.holds} crops</span></div><div class="pc-row"><span>Draws</span><span>${P.power} power</span></div><div class="pc-note">Stands on powered line. Each hour it drops its basket on a running belt beside it; with no belt the basket fills and waits for your empty hands. The hoe picks it up.</div>`;
    } else if (it.kind === 'hopper') {
      html += `<div class="pc-row"><span>Holds</span><span>${CONFIG.power.hopper.holds} crops</span></div><div class="pc-row"><span>Draws</span><span>${CONFIG.power.hopper.power} power</span></div><div class="pc-note">Stands on powered line where the belt ends: its motor drives the belt, which is why it draws more. Beside the crate it tips into the crate when the cart comes, as much as fits. Anywhere else it is a store you empty with empty hands. The hoe picks it up.</div>`;
    } else if (it.kind === 'pipe') {
      html += `<div class="pc-row"><span>Lays</span><span>one tile a section</span></div><div class="pc-note">Start beside the well and run it out to the field, over clear ground or under a bed: laid on a tilled bed it runs beneath, and the bed stays yours to plant. Fed pipe shows a blue core. The hoe picks a section up from open ground; under a bed, flatten the bed first.</div>`;
    } else if (it.kind === 'tool' && it.tool === 'can') {
      html += `<div class="pc-row"><span>Water</span><span>${s.can.water} / ${s.can.capacity} pours</span></div>${bar(s.can.water / s.can.capacity * 100, '#3f8fd6')}<div class="pc-note">Fill it at the well. One pour per bed. A second pour on a wet bed waterlogs it: turn it with the hoe.</div>`;
    } else if (it.kind === 'tool' && it.tool === 'hoe') {
      html += `<div class="pc-row"><span>Level</span><span>${S.hoeLevel(s) + 1} · ${S.hoeSeconds(s)}s a bed</span></div><div class="pc-row"><span>Energy</span><span>${S.hoeEnergy(s)} a bed</span></div><div class="pc-note">Tills grass, and flattens an empty bed back to grass. Turns a waterlogged bed. Digs up a plant: a seed comes back as a seed, anything bigger is pulled up for the compost. Lifts pipe, line, belt and any machine from open ground; pipe and line under a bed come up once the bed is flattened.</div>`;
    } else if (it.kind === 'withered' || it.kind === 'pulled') {
      html += `<div class="pc-note">${it.kind === 'pulled' ? 'Dug up before it ripened. It won\'t grow again.' : 'Dried out and died in the bed.'} Drop it in the compost bin: it rots down into fertiliser.</div>`;
    }
    if (html !== this.lastCard) { card.innerHTML = html; this.lastCard = html; } card.classList.remove('hidden');
    const gw = $('game').clientWidth, gh = $('game').clientHeight;
    card.style.left = Math.min(gw - card.offsetWidth - 8, Math.max(8, screenX - card.offsetWidth / 2)) + 'px';
    card.style.top = Math.max(8, Math.min(gh - card.offsetHeight - 8, screenY - card.offsetHeight - 28)) + 'px';
  }

  // ---------- panels ----------
  closePanel() { if (this.onClosePanel) { this.onClosePanel(); this.onClosePanel = null; } if (this.openPanel) this.game.sound.play(this.openPanel.key === 'chest' ? 'chestClose' : 'close'); const pn = $('panel'); pn.classList.remove('open'); setTimeout(() => { if (!this.openPanel) pn.classList.add('hidden'); }, 220); this.openPanel = null; this.held = null; this.renderHotbar(); }
  show(title, builder, key = null) {
    if (this.onClosePanel) { this.onClosePanel(); this.onClosePanel = null; }   // a panel's window listeners (the chest's drag) go with it
    $('panel-title').textContent = title; const body = $('panel-body'); body.innerHTML = '';
    if (!this.openPanel) this.game.sound.play(key === 'chest' ? 'chest' : 'ui');
    builder(body); const pn = $('panel'); pn.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => pn.classList.add('open')));
    this.openPanel = { title, builder, key }; this.renderHotbar();
  }
  refresh() { if (this.openPanel) { const b = $('panel-body'); const sc = b.scrollTop; b.innerHTML = ''; this.openPanel.builder(b); b.scrollTop = sc; } this.renderHotbar(); this.updateHud(); }


  // Compost bin: the heap on the left (click a plant to take it back), what it will make on the right, your crops and
  // withered plants below (click to add one, shift-click the stack). The lid shuts at bedtime; the bags wait by morning.
  openCompost() {
    const s = this.state, g = this.game, cp = s.compost, F = CONFIG.fertiliser;
    let details;
    const gradeRow = f => { const n = fertGrade(f); return `<div class="pc-row"><span>Grade</span><span>${'●'.repeat(n)}${'○'.repeat(3 - n)} ${GRADE_WORD[n]}</span></div>`; };
    const binDetails = () => {
      if (cp.ready) return `<div class="pc-name">${esc(cp.ready.name)} ×${cp.readyCount || 1}</div>${gradeRow(cp.ready)}<div class="pc-note">${esc(fertDescribe(cp.ready))}</div><div class="pc-note">Click the bag to take it. Click a tilled bed with it in hand to work it in.</div>`;
      if (cp.running) return `<div class="pc-name">Rotting down</div><div class="pc-row"><span>Will make</span><span>${esc(cp.running.fert.name)} ×${cp.running.count}</span></div>${gradeRow(cp.running.fert)}<div class="pc-note">${esc(fertDescribe(cp.running.fert))}</div><div class="pc-note">Ready by morning.</div>`;
      const n = S.compostCount(s), pv = S.compostPreview(s);
      if (!pv) return `<div class="pc-name">Empty</div><div class="pc-note">Takes spare crops and the plants the hoe pulls up or clears. ${F.compostMinInputs} or more rot down into fertiliser overnight: one bag for every three.</div><div class="pc-note">First win: Speed compost on the bed of your best seller. Rarer crops make Quality, and Quality means stars.</div>`;
      const short = Math.max(0, F.compostMinInputs - n), bags = S.compostBags(n, s);
      return `<div class="pc-name">${esc(pv.name)}</div><div class="pc-row"><span>Will give</span><span>${bags} ${bags === 1 ? 'bag' : 'bags'}</span></div>${gradeRow(pv)}<div class="pc-note">${esc(fertDescribe(pv))}</div>` + (short ? `<div class="pc-note">${short} more and it starts at bedtime.</div>` : `<div class="pc-note">The lid shuts when you sleep. Ready by morning.</div>`);
    };
    const produceDetails = it => { const sp = it.kind === 'crop' ? s.species[it.species] : null, c = contributions(sp); return `<div class="pc-name${sp ? ' tier-' + sp.tier : ''}">${esc(sp ? sp.name : itemName(it, s.species))}</div><div class="pc-row"><span>Adds</span><span>${esc(c.join(', ')) || 'bulk'}</span></div><div class="pc-note">Click to drop one in. Shift-click for the stack.</div>`; };
    this.show('Compost bin', body => {
      const info = el('button', 'info-btn', 'i'); info.title = 'How it works'; body.appendChild(info);
      const row = el('div', 'station-row');
      const left = el('div'); left.appendChild(el('div', 'pc-sec', cp.ready ? 'Ready' : cp.running ? 'Rotting down' : `In the bin · ${S.compostCount(s)} / ${S.compostCap(s)}`));
      const heap = el('div', 'pslots');
      if (cp.ready) { const sl = this.pslot({ kind: 'fert', fert: cp.ready, qty: cp.readyCount || 1 }, s.species, { cls: 'ready' }); sl.onclick = () => { const r = S.takeCompost(s); if (r.msg) this.toast(r.msg); if (r.float) { g.addFloat(r.float, s.player.x, s.player.y - 1.6, '#f6c453'); g.sound.play('harvest'); } this.refresh(); }; heap.appendChild(sl); }
      else if (cp.running) heap.appendChild(this.pslot(null, s.species, { hint: 'lid shut', cls: 'locked' }));
      else if (!cp.inputs.length) heap.appendChild(this.pslot(null, s.species, { hint: 'empty' }));
      else cp.inputs.forEach((inp, k) => {
        const sl = this.pslot(inp.species ? { kind: 'crop', species: inp.species, q: inp.q || 0, qty: inp.qty } : { kind: 'withered', qty: inp.qty }, s.species);
        sl.title = 'Click to take one back'; sl.onclick = () => { const r = S.takeFromCompost(s, k); if (r.msg) this.toast(r.msg); else g.sound.play('move'); this.refresh(); };
        heap.appendChild(sl);
      });
      left.appendChild(heap);
      details = el('div', 'details'); setDetails(details, binDetails());
      row.appendChild(left); row.appendChild(details); body.appendChild(row);
      body.appendChild(el('div', 'pc-sec', 'Your produce'));
      const grid = el('div', 'pslots'); let any = false; const open = S.canCompost(s).ok;
      s.inventory.slots.forEach((it, i) => {
        if (!it || !S.COMPOSTABLE.includes(it.kind)) return; any = true;
        const sl = this.pslot(it, s.species, { cls: open ? '' : 'locked' });
        sl.onmouseenter = () => { setDetails(details, produceDetails(it)); }; sl.onmouseleave = () => { setDetails(details, binDetails()); };
        sl.onclick = e => { const r = S.addToCompost(s, i, e.shiftKey ? it.qty : 1); if (r.msg) this.toast(r.msg); else g.sound.play('move'); this.refresh(); };
        grid.appendChild(sl);
      });
      if (!any) grid.appendChild(el('div', 'muted', 'Nothing in your pockets to rot down. Spare crops, or the plants the hoe pulls up.'));
      body.appendChild(grid);
      const box = el('div', 'info-box hidden', `What goes in sets what comes out. Fast crops give <b>Speed</b> (plants grow faster), many-fruited give <b>Yield</b> (more per harvest), hardy give <b>Hardiness</b>, low-thirst give <b>Water keep</b> (the bed dries slower), rarer crops give <b>Quality</b> (stars on the harvest, each worth +${Math.round(F.qualityStarValue * 100)}% fresh and half that dried: every 25% of Quality is a sure star, the rest a chance of one more, three at most; only crops above common count, and the bin's cap rises with how rare they are: a bin of uncommon stops at 60% (two stars and a chance of a third), rare at 75%, epic at 90% (three stars sure), so a slow, single-fruited rare or epic crop is worth breeding for the bin alone), bred crops give <b>Mutation</b>. Feeding one kind concentrates the power; mixing spreads it thin. The grade (I to III) is how much power the batch holds: more plants and rarer plants make a richer batch. A bag works into one tilled bed and lasts until that plant is pulled.`);
      info.onclick = () => box.classList.toggle('hidden'); body.appendChild(box);
    }, 'compost');
  }


  // A slot showing an item (or a hint when empty).
  pslot(item, species, opts = {}) {
    const sl = el('div', 'pslot' + (item ? '' : ' empty') + (opts.cls ? ' ' + opts.cls : ''));
    if (item) { sl.appendChild(itemIcon(item, species, 44)); if (item.qty > 1) sl.appendChild(el('div', 'qty', `×${item.qty}`)); }
    else if (opts.hint) sl.appendChild(el('div', 'hint', opts.hint));
    if (item && opts.hover) {   // the same card as the hotbar, over the slot
      const at = e => { const r = $('game').getBoundingClientRect(); this.panelHover = true; this.hoverItem(item, e.clientX - r.left, e.clientY - r.top); };
      sl.onmouseenter = at; sl.onmousemove = at; sl.onmouseleave = () => { this.panelHover = false; this.hideHover(); };
    }
    return sl;
  }
  // Seed rack: tray slots on the left, a details box on the right, your produce as slots below. Click a crop to dry it,
  // click a finished tray to take the seeds. The (i) button shows how it works.
  openSeedRack() {
    const s = this.state, g = this.game, trays = s.seedRack.trays;
    let details, bars = [], lastReady = S.seedRackReady(s), focus = -1;
    const trayDetails = k => {
      const R = trays[k];
      if (!R.item) return `<div class="muted">Tray ${k + 1}: empty. Click a crop below to dry it here.</div>`;
      const sp = s.species[R.item.species], [lo, hi] = S.seedRange(sp), ready = S.trayReady(s, R), pct = Math.round(S.trayProgress(s, R) * 100), realMin = Math.max(0, R.readyAt - s.minutes) / S.gameMinutesPerRealSecond() / 60;
      return `<div class="pc-name tier-${sp.tier}">${esc(sp.name)}</div>` + (ready
        ? `<div class="pc-row"><span>Dried</span><span><b>${R.item.seeds} seeds</b></span></div><div class="pc-note">Click the tray to take them.</div>`
        : `<div class="pc-row"><span>Drying</span><span>${pct}%</span></div>${bar(pct, '#e8a23b')}<div class="pc-row"><span>Ready in</span><span>${realMin < 1 ? 'under a minute' : `~${Math.ceil(realMin)} min`}</span></div><div class="pc-row"><span>Will give</span><span>${lo === hi ? lo : `${lo}–${hi}`} seeds</span></div>`);
    };
    const defaultDetails = () => { const k = trays.findIndex(t => t.item); return trayDetails(k < 0 ? 0 : k); };
    const produceDetails = sp => { const [lo, hi] = S.seedRange(sp), secs = Math.round(S.dryHoursFor(sp) * 60 / S.gameMinutesPerRealSecond()); return `<div class="pc-name tier-${sp.tier}">${esc(sp.name)}</div>` + (sp.sterile ? `<div class="pc-note">Sterile: its seeds are dead.</div>` : `<div class="pc-row"><span>Seeds</span><span>${lo === hi ? lo : `${lo}–${hi}`}</span></div><div class="pc-row"><span>Drying time</span><span>${secs} s</span></div><div class="pc-note">Click to lay one on a free tray.</div>`); };
    const freeTray = () => trays.some(t => !t.item);
    this.show('Seed rack', body => {
      const info = el('button', 'info-btn', 'i'); info.title = 'How it works'; body.appendChild(info);
      const row = el('div', 'station-row');
      const left = el('div'); left.appendChild(el('div', 'pc-sec', `Trays · ${trays.length}`));
      const slots = el('div', 'pslots'); bars = [];
      trays.forEach((R, k) => {
        const ready = S.trayReady(s, R);
        const sl = this.pslot(R.item ? { kind: ready ? 'seed' : 'crop', species: R.item.species, qty: ready ? R.item.seeds : 1 } : null, s.species, { hint: `tray ${k + 1}`, cls: ready ? 'ready' : '' });
        if (R.item && !ready) { const b = el('div', 'pslot-bar'); const inner = el('div'); inner.style.width = Math.round(S.trayProgress(s, R) * 100) + '%'; b.appendChild(inner); sl.appendChild(b); bars[k] = inner; }
        sl.onmouseenter = () => { focus = k; setDetails(details, trayDetails(k)); }; sl.onmouseleave = () => { focus = -1; setDetails(details, defaultDetails()); };
        sl.onclick = () => { if (!S.trayReady(s, R)) return; const r = S.takeSeeds(s); this.toast(r.msg); if (r.float) g.addFloat(r.float, s.player.x, s.player.y - 1.6, '#f6c453'); this.refresh(); };
        slots.appendChild(sl);
      });
      if (trays.length < 4) slots.appendChild(this.pslot(null, s.species, { hint: 'order a tray', cls: 'locked' }));
      left.appendChild(slots);
      details = el('div', 'details'); setDetails(details, defaultDetails());
      row.appendChild(left); row.appendChild(details); body.appendChild(row);
      body.appendChild(el('div', 'pc-sec', 'Your produce'));
      const grid = el('div', 'pslots'); let any = false;
      s.inventory.slots.forEach((it, i) => {
        if (!it || it.kind !== 'crop') return; any = true;
        const sp = s.species[it.species], sl = this.pslot(it, s.species, { cls: !freeTray() || sp.sterile ? 'locked' : '' });
        sl.onmouseenter = () => { setDetails(details, produceDetails(sp)); }; sl.onmouseleave = () => { setDetails(details, defaultDetails()); };
        sl.onclick = () => { const r = S.putOnSeedRack(s, i); this.toast(r.msg); this.refresh(); };
        grid.appendChild(sl);
      });
      if (!any) grid.appendChild(el('div', 'muted', 'Nothing to dry. Harvest something first.'));
      body.appendChild(grid);
      const box = el('div', 'info-box hidden', `One crop dries into seeds: about fruits-per-harvest × ${CONFIG.seedRack.seedsPerFruit}, give or take ${Math.round(CONFIG.seedRack.seedVariance * 100)}%, never under ${CONFIG.seedRack.minSeeds}. Big juicy fruit dries slowly, small dry grain fast. Sterile crops give none. More trays come from the cart catalogue.`);
      info.onclick = () => box.classList.toggle('hidden'); body.appendChild(box);
    }, 'seedrack');
    this.openPanel.tick = () => {
      const ready = S.seedRackReady(s); if (ready !== lastReady) { lastReady = ready; this.refresh(); return; }
      trays.forEach((R, k) => { if (bars[k] && R.item) bars[k].style.width = Math.round(S.trayProgress(s, R) * 100) + '%'; });
      if (details && details.innerHTML.includes('Drying')) setDetails(details, focus >= 0 ? trayDetails(focus) : defaultDetails());
    };
  }
  // Breeding bench: two parent slots, a verdict box, your seeds and produce to pick parents from. Breed runs overnight.
  openBench() {
    const s = this.state, g = this.game, b = s.breeder;
    let details;
    const spDetails = sp => `<div class="pc-name tier-${sp.tier}">${esc(sp.name)}</div><div class="pc-note">${sp.tier} · gen ${sp.genome.gen || 0}</div><div class="pc-row"><span>Harvest</span><span>${sp.genome.count} × ${formatMoney(salePrice(s, { species: sp.id }))}</span></div><div class="pc-row"><span>Bed earns</span><span>${perDay(S.bedRatePerDay(s, sp))}</span></div><div class="pc-row"><span>Water</span><span>~${S.poursPerDay(sp.genome)} pours/day</span></div><div class="pc-note">${esc(traitList(sp).join(' · '))}</div>${sp.sterile ? '<div class="pc-note">Sterile: cannot breed.</div>' : ''}` + traitRows(sp);
    const verdict = () => {
      if (b.running && !S.benchHasRoom(s) && !(b.a && b.b)) { const A = s.species[b.running.a], B = s.species[b.running.b], Q = b.queue && [s.species[b.queue.a], s.species[b.queue.b]]; return `<div class="pc-name">${esc(A.name)} × ${esc(B.name)}</div>` + (Q ? `<div class="pc-name">${esc(Q[0].name)} × ${esc(Q[1].name)}</div><div class="pc-note">Two seedlings under two glasses. Sleep to see what they become.</div>` : `<div class="pc-note">A seedling is under the glass. Sleep to see what it becomes.</div>`); }
      if (b.running && !b.a && !b.b) { const A = s.species[b.running.a], B = s.species[b.running.b]; return `<div class="pc-name">${esc(A.name)} × ${esc(B.name)}</div><div class="pc-note">Under the first glass. The second is free: pick two more parents below for tonight.</div>`; }
      if (b.result) { const sp = s.species[b.result.species]; return `<div class="pc-name tier-${sp?.tier}">${esc(sp?.name || '?')}</div><div class="pc-row"><span>On the bench</span><span><b>${b.result.seeds} seeds</b></span></div><div class="pc-note">Click the glowing slot to take them.</div>`; }
      if (!b.a && !b.b) return `<div class="muted">Pick two parents below. Seeds or produce both work: one of each is used up.</div>`;
      if (!b.a || !b.b) return `<div class="muted">One more parent.</div>`;
      const pv = S.breedPreview(s); if (!pv) return '';
      const risk = Math.round(pv.instability * 100);
      return `<div class="pc-name">${esc(s.species[b.a.species].name)} × ${esc(s.species[b.b.species].name)}</div><div class="pc-row"><span>Risk of failure</span><span><b>${risk}%</b></span></div>${bar(risk, risk > 50 ? '#d9453d' : '#e8a23b')}<div class="pc-row"><span>Cost</span><span>${formatMoney(pv.cost)}</span></div><div class="pc-note">${pv.crossFamily ? 'Different families: riskier, and the only way a rare trait appears from nothing.' : 'Same family: safer. Rare traits only pass down, never appear.'}</div>`;
    };
    this.show('Breeding bench', body => {
      const info = el('button', 'info-btn', 'i'); body.appendChild(info);
      const row = el('div', 'station-row');
      const left = el('div'); left.appendChild(el('div', 'pc-sec', 'Parents'));
      const slots = el('div', 'pslots');
      const busy = !!b.running && !S.benchHasRoom(s);
      for (const run of [b.running, b.queue]) if (run) for (const which of ['a', 'b']) { const sl = this.pslot({ kind: 'seed', species: run[which], qty: 1 }, s.species, { hint: which === 'a' ? 'parent A' : 'parent B', cls: 'locked' }); const sp = s.species[run[which]]; sl.onmouseenter = () => { setDetails(details, spDetails(sp)); }; sl.onmouseleave = () => { setDetails(details, verdict()); }; slots.appendChild(sl); }
      if (!busy) for (const which of ['a', 'b']) {
        const it = b[which];
        const sl = this.pslot(it, s.species, { hint: which === 'a' ? (b.running ? 'next A' : 'parent A') : (b.running ? 'next B' : 'parent B') });
        if (it) { const sp = s.species[it.species]; sl.onmouseenter = () => { setDetails(details, spDetails(sp)); }; sl.onmouseleave = () => { setDetails(details, verdict()); }; }
        if (it) sl.onclick = () => { S.clearBreederParent(s, which); this.refresh(); };
        slots.appendChild(sl);
      }
      left.appendChild(slots);
      for (const res of [b.result, b.result2]) if (res) {   // the morning's seeds, waiting to be taken
        const sp = s.species[res.species], rs = this.pslot({ kind: 'seed', species: res.species, qty: res.seeds }, s.species, { cls: 'ready' });
        rs.onclick = () => { const r = S.takeBreedResult(s); if (r.msg) this.toast(r.msg); if (r.float) g.addFloat(r.float, s.player.x, s.player.y - 1.6, '#f6c453'); this.refresh(); };
        rs.onmouseenter = () => { if (sp) setDetails(details, spDetails(sp) + `<div class="pc-note">${res.seeds} seeds. Click to take them.</div>`); }; rs.onmouseleave = () => { setDetails(details, verdict()); };
        slots.appendChild(rs);
      }
      const go = el('button', 'primary', busy ? 'Breeding…' : b.running ? 'Second glass tonight' : 'Breed overnight'); go.disabled = busy || !b.a || !b.b; go.style.marginTop = '6px';
      go.onclick = () => { const r = S.startBreed(s); this.toast(r.msg); this.refresh(); };
      left.appendChild(go);
      const book = el('button', null, 'Seed book'); book.style.margin = '6px 0 0 6px'; book.onclick = () => this.openLineage(); left.appendChild(book);
      details = el('div', 'details'); setDetails(details, verdict());
      row.appendChild(left); row.appendChild(details); body.appendChild(row);
      body.appendChild(el('div', 'pc-sec', 'Your seeds and produce · click to set as a parent'));
      const grid = el('div', 'pslots'); let any = false;
      s.inventory.slots.forEach((it, i) => {
        if (!it || (it.kind !== 'seed' && it.kind !== 'crop')) return; any = true;
        const sp = s.species[it.species], sl = this.pslot(it, s.species, { cls: busy || sp.sterile ? 'locked' : '' });
        sl.onmouseenter = () => { setDetails(details, spDetails(sp)); }; sl.onmouseleave = () => { setDetails(details, verdict()); };
        sl.onclick = () => { if (busy) return; const which = !b.a ? 'a' : 'b'; const r = S.setBreederParent(s, which, i); if (r.msg) this.toast(r.msg); this.refresh(); };
        grid.appendChild(sl);
      });
      if (!any) grid.appendChild(el('div', 'muted', 'Nothing to breed with. Seeds or produce go here.'));
      body.appendChild(grid);
      const box = el('div', 'info-box hidden', `Two parents make one child overnight. Every gene comes from one parent, the other, or a blend, with a small chance to mutate. A rare trait (golden, glowing, regrowing, frost-hardy) passes down from a parent that has it, and appears from nothing only when the parents are from different families. Each generation adds rarity, and rarity sets the price. A cross between families also carries hybrid vigour: a step on the price that passes down and grows with each cross-family generation, and fades in same-family crosses. Cheap parents drag a child down, so cross your two dearest crops from different families. The cart's buyer takes 8 of a kind a night at full price and sells the rest on cheaper, so a new species is worth more than another row of the old one. Needing little water or shrugging off drought does not change the price; it saves your time. Risk comes from mutations, from crossing different families and from the parents' own rarity: a failed cross withers, reverts to parent A, or gives a sterile plant that grows and sells but makes no seeds. The seeds wait on the bench in the morning.`);
      info.onclick = () => box.classList.toggle('hidden'); body.appendChild(box);
    }, 'bench');
  }
  // The cart catalogue at the delivery sign: order now, pay now, it arrives tonight.
  openCatalogue() {
    const s = this.state;
    const icon = item => {
      const c = document.createElement('canvas'); c.width = 48; c.height = 48; const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
      const src = item.id === 'can' ? toolIcon('can') : item.id === 'hoe' ? toolIcon('hoe') : item.id === 'tray' ? seedRackSprite(0) : item.id === 'crate' ? crateSprite(0) : item.id === 'deed' ? treeSprite(0) : item.id === 'pickup' ? cartSprite(0) : item.id === 'hands' ? handsIcon() : item.id === 'bench' ? benchSprite(0) : item.id === 'compost' ? compostSprite(1) : item.id === 'bin' ? compostSprite(2) : item.id === 'glass' ? benchSprite(2) : item.id.startsWith('chest') ? chestSprite(false, false, +item.id.slice(5) || 0) : item.id === 'dcrate' ? crateSprite(0, true) : item.id === 'truck' ? stationIcon('truck') : item.id === 'basket' ? basketIcon() : item.id === 'barrow' ? barrowSprite(false) : item.id === 'forklift' ? forkliftSprite() : item.id.startsWith('sprinkler') ? sprinklerSprite(+item.id.slice(9) || 0, 1) : item.id.startsWith('pump') ? pumpIcon(+item.id.slice(4) || 0) : ['generator', 'line', 'belt', 'picker', 'hopper', 'dryer', 'splitter', 'filter', 'dcrate', 'planter'].includes(item.id) || /^(generator|picker|planter)\d$/.test(item.id) ? stationIcon(item.id) : item.id === 'fuel' ? fuelIcon() : item.id.startsWith('repay:') || item.id.startsWith('loan:') ? coinIcon() : item.id === 'pipe' ? pipeSprite(10, true) : item.species ? seedIcon(Math.round(item.species.genome.hue1), item.species.genome.sat1, item.species.genome.light1) : null;
      if (src) { const sc = Math.min(48 / src.width, 48 / src.height); ctx.drawImage(src, (48 - src.width * sc) / 2, (48 - src.height * sc) / 2, src.width * sc, src.height * sc); }
      return c;
    };
    this.show('Cart catalogue', body => {
      const head = el('div', 'cat-head', `<span>Pay now. The cart brings it overnight.</span><span class="cat-money">${formatMoney(s.money)}</span>`); body.appendChild(head);
      // tonight's cart
      const cart = el('div', 'cart-box');
      if (s.orders.length) {
        cart.appendChild(el('div', 'pc-sec', `Your orders · arrive tomorrow morning · ${formatMoney(s.orders.reduce((v, o) => v + o.price, 0))}`));
        s.orders.forEach((o, i) => { const r = el('div', 'cat-row small' + (this.justOrdered === o.id && i === s.orders.length - 1 ? ' slide-in' : '')); r.appendChild(el('div', 'grow', esc(o.name))); r.appendChild(el('div', 'cat-price', formatMoney(o.price))); const b = el('button', null, 'Cancel'); b.onclick = () => { this.toast(cancelOrder(s, i).msg); this.refresh(); }; r.appendChild(b); cart.appendChild(r); });
      } else cart.appendChild(el('div', 'muted', `No orders yet. Everything below is always available; the seed packets change every ${CONFIG.catalogSeedDays} days.`));
      body.appendChild(cart);
      if (s.deeds > 0) {   // a deed in hand: claim first, shop after
        const r = el('div', 'cat-row afford deed-row'); r.appendChild(icon({ id: 'deed' }));
        r.appendChild(el('div', 'grow', `<b>Land deed ${s.deeds > 1 ? '×' + s.deeds : ''}</b><br><span class="muted">Claim one 4×4 plot next to your land. The trees on it come down.</span>`));
        const b = el('button', 'primary', 'Claim'); b.onclick = () => { this.game.landMode = true; this.closePanel(); this.toast('Click a highlighted plot to claim it (Esc = later)'); }; r.appendChild(b); body.appendChild(r);
      }
      // the catalogue by group
      const items = catalog(s), groups = ['Tools', 'Stations', 'Water', 'Power', 'Land', 'Bank', 'Seeds'];
      const subs = { Seeds: `new packets in ${seedRotationIn(s)} day${seedRotationIn(s) === 1 ? '' : 's'}`, Water: `the well gives ${CONFIG.pump.wellHead} tiles of flow; a pump adds tiles from where it stands; a split gives each branch what it asks for`, Power: 'line carries power, belt carries crops', Bank: `one loan at a time; ${Math.round(CONFIG.loan.nightly * 100)}% a night on what you owe; pay back as you like` };
      for (const gname of groups) {
        const list = items.filter(i => i.group === gname); if (!list.length) continue;
        body.appendChild(el('div', 'pc-sec', subs[gname] ? `${gname} <span class="muted">· ${subs[gname]}</span>` : gname));
        const seen = new Set();
        for (const first of list) {
          // a family (Sprinkler I/II/III, the pumps, the loans) is one row with a chip a tier: the chip picks which one the row shows and orders
          const fam = first.family ? list.filter(i => i.family === first.family) : [first];
          if (first.family) { if (seen.has(first.family)) continue; seen.add(first.family); }
          this.catTier = this.catTier || {};
          const sel = first.family ? Math.min(this.catTier[first.family] ?? 0, fam.length - 1) : 0, item = fam[sel];
          const row = el('div', 'cat-row' + (item.blocked ? ' blocked' : item.afford ? ' afford' : ' cant'));
          row.appendChild(icon(item));
          const grow = el('div', 'grow');
          const head = el('div', 'cat-head-line', `<b>${esc(first.family || item.name)}</b>`);
          if (first.family) fam.forEach((f, i) => { const c = el('button', 'tier' + (i === sel ? ' sel' : '') + (f.blocked ? ' off' : ''), esc(f.tier)); c.title = f.blocked || f.effect; c.onclick = () => { this.catTier[first.family] = i; this.refresh(); }; head.appendChild(c); });
          if (item.level) head.appendChild(el('span', 'muted', esc(item.level)));
          grow.appendChild(head);
          row.appendChild(grow);
          const loan = item.id.startsWith('loan:'), repay = item.id.startsWith('repay:');
          row.appendChild(el('div', 'cat-price', item.blocked ? '' : loan ? `+${formatMoney(+item.id.slice(5))}` : item.afford ? formatMoney(item.price) : `${formatMoney(item.price)}<br><span class="gap">${formatMoney(item.price - s.money)} to go</span>`));
          const b = el('button', item.blocked || s.money < item.price ? null : 'primary', item.blocked ? '—' : loan ? 'Borrow' : repay ? 'Pay' : 'Order'); b.disabled = !!item.blocked || (repay ? s.money <= 0 : s.money < item.price);
          b.onclick = () => {
            const r = placeOrder(s, item.id); if (!r.ok) { this.toast(r.msg); return; }
            // the row lights up, the price floats away, the order slides into the cart box
            row.classList.add('bought'); b.textContent = loan ? 'Borrowed' : repay ? 'Paid' : 'Ordered'; b.disabled = true; if (r.loan) this.toast(r.msg);
            const fl = el('div', 'cat-float', loan ? `+${formatMoney(+item.id.slice(5))}` : `−${formatMoney(item.price)}`); const pr = row.querySelector('.cat-price').getBoundingClientRect(), pb = $('panel-body').getBoundingClientRect();
            fl.style.left = (pr.left - pb.left) + 'px'; fl.style.top = (pr.top - pb.top + $('panel-body').scrollTop) + 'px'; $('panel-body').appendChild(fl);
            this.game.onPurchase(loan || repay ? 'loan' : 'buy'); this.justOrdered = item.id;
            setTimeout(() => { fl.remove(); this.refresh(); }, 520);
          };
          row.appendChild(b);
          row.appendChild(el('div', 'cat-desc', `${first.family ? `<span>${esc(item.name)}</span> · ` : ''}<span class="muted">${esc(item.blocked || item.effect)}</span>${item.why && !item.blocked ? `<br><span class="why">${esc(item.why)}</span>` : ''}`));
          body.appendChild(row);
        }
      }
    }, 'catalogue');
  }
  // The chest by the porch: your five pockets on top, the chest below. Click moves a stack across, right-click moves
  // one, and dragging a stack onto any slot puts it there (onto a like stack it merges, onto another it swaps).
  // The dryer: what waits on top, the batch under way, the tray; your crops to load; the tray to take.
  openDryer(x, y) {
    const s = this.state, g = this.game, D = CONFIG.power.dryer, t = s.world.tiles[y * s.world.w + x], o = t.obj; if (!o || o.kind !== 'dryer') return;
    this.show('Dryer', body => {
      const row = el('div', 'station-row'); const left = el('div');
      const powered = S.machinePowered(s, x, y);
      left.appendChild(el('div', 'pc-sec', `Waiting on top · ${S.heldCount(o.held)} / ${D.holds}`));
      const q = el('div', 'pslots'); if (!o.held?.length) q.appendChild(this.pslot(null, s.species, { hint: 'empty' })); else for (const it of o.held) q.appendChild(this.pslot(S.pileItem(it), s.species)); left.appendChild(q);
      left.appendChild(el('div', 'pc-sec', 'Drying'));
      if (o.doing) { const sp = s.species[o.doing.species], pct = Math.round(S.dryerProgress(s, o) * 100), realMin = Math.max(0, o.doing.done - s.minutes) / S.gameMinutesPerRealSecond() / 60; left.appendChild(el('div', null, `<div class="pc-row"><span>${esc(sp?.name || '?')} ×${o.doing.qty}</span><span>${pct}%</span></div>${bar(pct, '#e8a23b')}<div class="pc-row"><span>Done in</span><span>${!powered ? 'no power' : realMin < 1 ? 'under a minute' : `~${Math.ceil(realMin)} min`}</span></div>`)); }
      else left.appendChild(el('div', 'muted', powered ? 'Nothing in it.' : S.linePowered(s, x, y) ? 'No power: the generator runs all it can.' : 'Dead: no generator on this line.'));
      left.appendChild(el('div', 'pc-sec', `On the tray · ${S.heldCount(o.out)} / ${D.output}`));
      const tray = el('div', 'pslots'); if (!o.out?.length) tray.appendChild(this.pslot(null, s.species, { hint: 'empty' })); else for (const it of o.out) { const sl = this.pslot(S.pileItem(it), s.species, { cls: 'ready' }); sl.title = 'Click to take them'; sl.onclick = () => { const r = S.takeHeld(s, x, y); if (r.msg) this.toast(r.msg); if (r.float) { g.addFloat(r.float, s.player.x, s.player.y - 1.6, '#f6c453'); g.sound.play('scoop'); } this.refresh(); }; tray.appendChild(sl); } left.appendChild(tray);
      const details = el('div', 'details'); setDetails(details, `<div class="pc-name">Dryer</div><div class="pc-row"><span>A batch</span><span>${D.batch} of one kind</span></div><div class="pc-row"><span>Takes</span><span>${D.baseHours}–${D.baseHours + D.skinHours} h by the skin</span></div><div class="pc-row"><span>Price dried</span><span>×${CONFIG.dried.base.toFixed(1)} to ×${(CONFIG.dried.base + CONFIG.dried.sugar).toFixed(1)} by the sugar</span></div><div class="pc-note">Belt run to it feeds it; belt leading away carries the tray. It runs through the night. Dried goods are their own line at the cart and the market.</div>`);
      row.appendChild(left); row.appendChild(details); body.appendChild(row);
      { const sw = el('button', 'small', o.off ? 'Switch on' : 'Switch off'); sw.style.marginBottom = '6px'; sw.onclick = () => { S.toggleMachine(s, x, y); g.sound.play('switch'); this.refresh(); }; body.appendChild(sw); }
      body.appendChild(el('div', 'pc-sec', 'Your crops'));
      const grid = el('div', 'pslots'); let any = false;
      s.inventory.slots.forEach((it, i) => {
        if (it?.kind !== 'crop') return; any = true; const sp = s.species[it.species];
        const sl = this.pslot(it, s.species); sl.title = `Dries to ${formatMoney(salePrice(s, { ...it, kind: 'product', product: 'dried' }))} each in ${dryHours(sp).toFixed(1)} h. Click to load, shift-click for the stack.`;
        sl.onclick = e => { const r = e.shiftKey ? S.loadDryer(s, i, x, y) : S.loadDryer(s, i, x, y, 1); if (r.msg) this.toast(r.msg); else g.sound.play('rackPlace'); this.refresh(); };
        grid.appendChild(sl);
      });
      if (!any) grid.appendChild(el('div', 'muted', 'No crops in your pockets. Sweet, thin-skinned ones dry best.'));
      body.appendChild(grid);
    }, 'dryer');
  }
  // The planter: its seed box and its fertiliser, the switch, and your pockets to load it from.
  openPlanter(x, y) {
    const s = this.state, g = this.game, C = CONFIG.power.planter, t = s.world.tiles[y * s.world.w + x], o = t.obj; if (!o || o.kind !== 'planter') return;
    const P = S.machineTier(o);
    this.show(P.name, body => {
      const row = el('div', 'station-row'); const left = el('div');
      const ns = (o.seeds || []).reduce((a, p) => a + p.qty, 0), nb = (o.bags || []).reduce((a, p) => a + p.qty, 0);
      left.appendChild(el('div', 'pc-sec', `Seed box · ${ns} / ${C.seeds}`)); const sg = el('div', 'pslots'); if (!o.seeds?.length) sg.appendChild(this.pslot(null, s.species, { hint: 'empty' })); else for (const p of o.seeds) sg.appendChild(this.pslot({ kind: 'seed', species: p.species, qty: p.qty }, s.species)); left.appendChild(sg);
      left.appendChild(el('div', 'pc-sec', `Fertiliser · ${nb} / ${C.bags}`)); const bg = el('div', 'pslots'); if (!o.bags?.length) bg.appendChild(this.pslot(null, s.species, { hint: 'none' })); else for (const p of o.bags) bg.appendChild(this.pslot({ kind: 'fert', fert: p.fert, qty: p.qty }, s.species)); left.appendChild(bg);
      const btns = el('div'); btns.style.marginTop = '6px';
      const sw = el('button', 'small', o.off ? 'Switch on' : 'Switch off'); sw.onclick = () => { S.toggleMachine(s, x, y); g.sound.play('switch'); this.refresh(); }; btns.appendChild(sw);
      if (ns + nb) { const back = el('button', 'small', 'Take it all back'); back.style.marginLeft = '6px'; back.onclick = () => { const r = S.unloadPlanter(s, x, y); if (r.msg) this.toast(r.msg); else g.sound.play('scoop'); this.refresh(); }; btns.appendChild(back); }
      left.appendChild(btns);
      const details = el('div', 'details'); setDetails(details, `<div class="pc-name">${esc(P.name)}</div><div class="pc-row"><span>Reach</span><span>the ${(2 * P.radius + 1) ** 2 - 1} beds around it</span></div><div class="pc-row"><span>Plants</span><span>${P.perHour} empty beds an hour</span></div><div class="pc-row"><span>Power</span><span>${P.power}</span></div><div class="pc-note">${o.off ? 'Switched off.' : S.machinePowered(s, x, y) ? 'Running.' : S.linePowered(s, x, y) ? 'No power: the generator runs all it can.' : 'Dead: no generator on this line.'} It plants the seed it holds in any empty bed in reach, working fertiliser in first when it has some. It never touches a bed with a plant in it.</div>`);
      row.appendChild(left); row.appendChild(details); body.appendChild(row);
      body.appendChild(el('div', 'pc-sec', 'Your seeds and fertiliser · click to load, shift-click for the stack'));
      const grid = el('div', 'pslots'); let any = false;
      s.inventory.slots.forEach((it, i) => { if (it?.kind !== 'seed' && it?.kind !== 'fert') return; any = true; const sl = this.pslot(it, s.species); sl.onclick = e => { const r = S.loadPlanter(s, i, x, y, e.shiftKey ? Infinity : 1); if (r.msg) this.toast(r.msg); else g.sound.play('rackPlace'); this.refresh(); }; grid.appendChild(sl); });
      if (!any) grid.appendChild(el('div', 'muted', 'No seeds or fertiliser in your pockets.'));
      body.appendChild(grid);
    }, 'planter');
  }
  openChest(chest = this.state.chest) {
    const s = this.state, invs = { pocket: s.inventory, chest }, field = chest !== s.chest, barrow = chest === s.barrow?.slots; this.chestOpen = chest;
    let drag = null, dragged = false;
    const endDrag = () => { if (!drag) return; drag.ghost.remove(); drag.sl.classList.remove('dragging'); $('panel-body').querySelectorAll('.pslot.over').forEach(e => e.classList.remove('over')); drag = null; };
    const grid = (inv, other, hintWord, key) => {
      const g = el('div', 'pslots');
      inv.slots.forEach((it, i) => {
        const sl = this.pslot(it, s.species, { hint: hintWord ? `${hintWord} ${i + 1}` : '', cls: it?.kind === 'tool' ? 'locked' : '', hover: true });
        sl.dataset.inv = key; sl.dataset.i = i;
        if (it) {
          sl.onclick = () => { if (dragged) { dragged = false; return; } const r = S.moveSome(s, inv, i, other, Infinity); if (r.msg) this.toast(r.msg); else this.game.sound.play('move'); this.refresh(); };
          sl.oncontextmenu = e => { e.preventDefault(); const r = S.moveSome(s, inv, i, other, 1); if (r.msg) this.toast(r.msg); else this.game.sound.play('move'); this.refresh(); };
          if (it.kind !== 'tool') sl.onmousedown = e => { if (e.button !== 0) return; e.preventDefault(); drag = { inv, i, sl, x0: e.clientX, y0: e.clientY, ghost: null, live: false }; };
        }
        g.appendChild(sl);
      });
      return g;
    };
    const onMove = e => {
      if (!drag) return;
      if (!drag.live) { if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return; drag.live = true; dragged = true; this.hideHover(); const gh = drag.sl.cloneNode(true); gh.className = 'pslot drag-ghost'; document.body.appendChild(gh); drag.ghost = gh; drag.sl.classList.add('dragging'); }
      drag.ghost.style.left = (e.clientX - 28) + 'px'; drag.ghost.style.top = (e.clientY - 28) + 'px';
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pslot');
      $('panel-body').querySelectorAll('.pslot.over').forEach(x => x.classList.remove('over'));
      if (over && over !== drag.sl && over.dataset.inv && !over.classList.contains('locked')) over.classList.add('over');
    };
    const onUp = e => {
      if (!drag) return;
      if (!drag.live) { drag = null; return; }
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pslot');
      const { inv, i } = drag; endDrag();
      if (over && over.dataset.inv && !over.classList.contains('locked')) { const to = invs[over.dataset.inv], ti = +over.dataset.i; if (!(to === inv && ti === i)) { S.moveSlot(s, inv, i, to, ti); this.game.sound.play('move'); } }
      this.refresh();
    };
    this.show(barrow ? 'Wheelbarrow' : field ? 'Field chest' : 'Chest', body => {
      body.appendChild(el('div', 'pc-sec', `Pockets · ${S.carriedCount(s)} things${S.isHeavy(s) ? ' · heavy' : ''}`));
      body.appendChild(grid(s.inventory, chest, 'pocket', 'pocket'));
      const used = chest.slots.filter(Boolean).length;
      body.appendChild(el('div', 'pc-sec', `${field ? 'Field chest' : 'Chest'} · ${used} / ${chest.slots.length} slots`));
      body.appendChild(grid(chest, s.inventory, '', 'chest'));
      body.appendChild(el('div', 'pc-note', 'Click a stack to move it across, right-click moves one. Drag a stack onto a slot to put it there. Tools stay on the rack.'));
    }, 'chest');
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    this.onClosePanel = () => { endDrag(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }
  // Delivery crate: what is inside and what it pays tonight, your produce as slots to add.
  openCrate() {
    const s = this.state, g = this.game;
    this.show(s.truck ? S.truckTier(s).name : 'Delivery crate', body => {
      const row = el('div', 'station-row');
      const left = el('div'); left.appendChild(el('div', 'pc-sec', s.truck ? `On the bed · ${s.truck.bed?.length || 0} / ${S.truckSlots(s)} crates` : `Inside · ${S.crateCount(s)} / ${s.crate.capacity}`));
      const inside = el('div', 'pslots');
      const listed = s.truck ? S.allCrateItems(s) : s.crate.items;
      for (const it of listed) inside.appendChild(this.pslot(it.kind ? { kind: it.kind, level: it.level, qty: it.qty } : { kind: it.product ? 'product' : 'crop', product: it.product, species: it.species, q: it.q, qty: it.qty }, s.species));
      if (!listed.length) inside.appendChild(this.pslot(null, s.species, { hint: 'empty' }));
      left.appendChild(inside);
      const details = el('div', 'details');
      const sum = () => { const P = S.priceCrate(s, S.allCrateItems(s)); return `<div class="pc-row"><span>Tonight</span><span><b>+${formatMoney(P.total)}</b></span></div>` + P.lines.map(l => `<div class="pc-row"><span>${esc(l.name)} ×${l.qty}</span><span>${formatMoney(l.total)}</span></div>` + (l.cut ? `<div class="pc-row muted"><span>&nbsp;&nbsp;${l.full} at the buyer's price, ${l.cut} sold on cheaper</span><span></span></div>` : '')).join('') + (P.lines.some(l => l.cut) ? `<div class="pc-note">The buyer takes ${CONFIG.demand.full} of a kind at full price. The cart sells the rest on cheaper: mix your crops.</div>` : '') + (s.crate.lastSale ? `<div class="pc-note">Last pickup: ${s.crate.lastSale.count} crops for ${formatMoney(s.crate.lastSale.total)}.</div>` : ''); };
      setDetails(details, sum());
      row.appendChild(left); row.appendChild(details); body.appendChild(row);
      const amt = this.crateAmount || 1;
      const amtRow = el('div', 'pc-sec amt-row'); amtRow.appendChild(el('span', null, 'Your produce and loose machines · click adds '));
      for (const n of [1, 5, 'all']) { const bb = el('button', n === amt ? 'primary small' : 'small', String(n)); bb.onclick = () => { this.crateAmount = n; this.refresh(); }; amtRow.appendChild(bb); }
      body.appendChild(amtRow);
      const grid = el('div', 'pslots'); let any = false;
      s.inventory.slots.forEach((it, i) => {
        if (!it || (it.kind !== 'crop' && !S.SELLABLE.includes(it.kind))) return; any = true;
        const sp = s.species[it.species], sl = this.pslot(it, s.species);
        const each = it.kind === 'crop' ? salePrice(s, it) : S.secondHand(it);
        sl.onmouseenter = () => { setDetails(details, `<div class="pc-name${sp ? ' tier-' + sp.tier : ''}">${esc(itemName(it, s.species))}</div><div class="pc-row"><span>${it.kind === 'crop' ? 'Each' : 'Second-hand, each'}</span><span>${formatMoney(each)}</span></div><div class="pc-row"><span>Stack</span><span>${formatMoney(each * it.qty)}</span></div>${it.kind === 'crop' ? '' : `<div class="pc-note">The cart buys it back at half the list price of ${formatMoney(S.listPrice(it))}.</div>`}`); };
        sl.onmouseleave = () => { setDetails(details, sum()); };
        sl.onclick = () => { const r = S.putInCrate(s, i, amt === 'all' ? Infinity : amt); this.toast(r.msg); this.refresh(); };
        grid.appendChild(sl);
      });
      if (!any) grid.appendChild(el('div', 'muted', 'Nothing to sell. Harvest something first. A machine in a pocket sells second-hand.'));
      body.appendChild(grid);
    }, 'crate');
  }
  openMorning(report) {
    const s = this.state;
    this.show(`Day ${report.day}`, body => {
      const sec = (icon, title, ...nodes) => { const d = el('div', 'mr-sec'); d.appendChild(el('div', 'mr-head', `<span class="mr-icon">${icon}</span>${esc(title)}`)); for (const n of nodes) if (n) d.appendChild(typeof n === 'string' ? el('div', 'mr-line', esc(n)) : n); body.appendChild(d); return d; };
      // the night
      const nightLines = [report.night || 'You slept well.'];
      if (report.rain) nightLines.push('It rained overnight. Every bed is watered and the air is heavy.');
      else if (report.humidity != null) nightLines.push(`${S.humidityWord(report.humidity)[0].toUpperCase() + S.humidityWord(report.humidity).slice(1)} air today (${report.humidity}% humidity): beds ${report.humidity >= 65 ? 'hold their water' : report.humidity < 40 ? 'dry out fast' : 'dry at the usual pace'}.`);
      sec(report.rain ? '☂' : '☾', 'The night', ...nightLines);
      // the cart
      const cartNodes = [];
      if (report.sale) {
        const box = el('div', 'sale');
        for (const l of report.sale.lines) { box.appendChild(el('div', 'pc-row', `<span>${esc(l.name)} ×${l.qty}</span><span>${formatMoney(l.total)}</span>`)); if (l.cut) box.appendChild(el('div', 'pc-row muted', `<span>&nbsp;&nbsp;${l.full} at the buyer's price, ${l.cut} sold on cheaper</span><span></span>`)); }
        if (seedBookBonus(s)) box.appendChild(el('div', 'pc-row muted', `<span>Seed book: ${s.discovered.length} species known</span><span class="up">+${Math.round(seedBookBonus(s) * 100)}% on every sale</span>`));
        box.appendChild(el('div', 'pc-row total', `<span>Paid</span><span>+${formatMoney(report.sale.total)}</span>`));
        if (report.water) box.appendChild(el('div', 'pc-row', `<span>Water bill · ${report.water.pours} sprinkler pours</span><span class="down">−${formatMoney(report.water.bill)}</span></div>`));
        if (report.fuel?.cans) box.appendChild(el('div', 'pc-row', `<span>Fuel · engines and generators</span><span>${report.fuel.cans} ${report.fuel.cans === 1 ? 'can' : 'cans'} burned</span>`));
        if (report.loan) box.appendChild(el('div', 'pc-row', `<span>Loan · interest added, ${formatMoney(report.loan.owed)} owed</span><span class="down">+${formatMoney(report.loan.interest)}</span>`));
        if (report.dayBefore) { const d = report.sale.total - report.dayBefore.sale; box.appendChild(el('div', 'pc-row muted', `<span>Day before: ${formatMoney(report.dayBefore.sale)}</span><span class="${d >= 0 ? 'up' : 'down'}">${d >= 0 ? '▲' : '▼'} ${formatMoney(Math.abs(d))}</span>`)); }
        cartNodes.push(`The cart took ${report.sale.count} ${report.sale.count === 1 ? 'crop' : 'crops'} from the crate.`, box);
      } else cartNodes.push('The crate was empty, so the cart took nothing.' + (report.water ? ` Water bill: ${report.water.pours} sprinkler pours, −${formatMoney(report.water.bill)}.` : '') + (report.fuel?.cans ? ` Fuel: ${report.fuel.cans} ${report.fuel.cans === 1 ? 'can' : 'cans'} burned.` : ''));
      if (report.loan && !report.sale) cartNodes.push(`The bank added ${formatMoney(report.loan.interest)} interest: ${formatMoney(report.loan.owed)} owed.`);
      if (report.fuel?.dry) cartNodes.push(`${report.fuel.dry === 1 ? 'A machine is' : report.fuel.dry + ' machines are'} out of fuel: pour a can in.`);
      if (report.picked) cartNodes.push(`The pickers took ${report.picked} ${report.picked === 1 ? 'crop' : 'crops'}.`);
      if (report.delivery?.count) { const list = el('ul', 'mr-list'); for (const p of s.parcels || []) list.appendChild(el('li', null, esc(p.name))); cartNodes.push(`It left ${report.delivery.count === 1 ? 'a parcel' : report.delivery.count + ' parcels'} in the crate. Click the crate to open ${report.delivery.count === 1 ? 'it' : 'them'}.`, list); }
      sec('⛟', 'The cart', ...cartNodes);
      for (const r0 of [report.breeder, report.breeder2]) if (r0) {
        const r = r0, sp = r.species ? s.species[r.species] : null;
        const d = sec('✿', 'The breeder');
        if (sp && (r.outcome === 'success' || r.outcome === 'sterile' || r.outcome === 'revert')) {
          const card = el('div', 'mr-breed');
          const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(cropSprite(sp, 3), 0, 0, 64, 64); ctx.drawImage(produceSprite(sp), 36, 0, 28, 28);
          card.appendChild(c);
          const txt = el('div', 'grow');
          const head = r.outcome === 'revert' ? `It reverted to <b class="tier-${sp.tier}">${esc(sp.name)}</b>.` : r.outcome === 'sterile' ? `<b class="tier-${sp.tier}">${esc(sp.name)}</b>, sterile.` : r.isNew ? `New species: <b class="tier-${sp.tier}">${esc(sp.name)}</b>` : `<b class="tier-${sp.tier}">${esc(sp.name)}</b> again.`;
          txt.appendChild(el('div', 'mr-breed-name', head));
          txt.appendChild(el('div', 'mr-line muted', `${esc(r.parents[0])} × ${esc(r.parents[1])}`));
          txt.appendChild(el('div', 'pc-row', `<span>Sells</span><span>${formatMoney(sp.value)} × ${sp.genome.count} a harvest</span>`));
          { const ps = (sp.parents || []).map(id => s.species[id]).filter(Boolean); if (ps.length) { const best = Math.max(...ps.map(p => p.value)), step = sp.value / Math.max(0.01, best);
            txt.appendChild(el('div', 'pc-row', `<span>Parents</span><span>${ps.map(p => `${esc(p.name)} ${formatMoney(p.value)} × ${p.genome.count}`).join(' · ')}</span>`));
            txt.appendChild(el('div', 'pc-row', `<span>Each crop sells</span><span class="${step >= 1 ? 'up' : 'down'}">${step >= 1 ? '▲' : '▼'} ×${step.toFixed(1)} the dearer parent</span></div>`)); } }
          txt.appendChild(el('div', 'pc-row', `<span>Ripens</span><span>${growRealMinutes(sp.genome).toFixed(1)} min</span>`));
          txt.appendChild(el('div', 'pc-row', `<span>Tier</span><span class="tier-${sp.tier}">${esc(sp.tier)} · gen ${sp.genome.gen || 0}</span>`));
          if (r.mutations?.length) { const line = el('div', 'mr-line muted', 'Changed: '); for (const m of r.mutations) line.appendChild(el('span', 'chip', esc(mutationWord(m)))); txt.appendChild(line); }
          txt.appendChild(el('div', 'mr-line', `<b>${r.seeds} seeds</b> wait on the bench.`));
          card.appendChild(txt); d.appendChild(card);
        } else d.appendChild(el('div', 'mr-line', esc(describeBreed(s, r))));
      }
      if (report.compost) sec('♻', 'Compost', `The heap rotted down overnight: ${esc(report.compost)} waits in the bin.`);
      const ok = el('button', 'primary', 'Good morning'); ok.style.marginTop = '12px'; ok.onclick = () => { this.closePanel(); this.game.afterMorning(); }; body.appendChild(ok);
    });
  }

  // The seed book, organised: what you bred (newest first, with its parents and what it does), what the starters and the
  // catalogue gave you, and what the birds brought. Every row carries the species' traits as chips.
  openLineage() {
    const s = this.state, TRAIT = { golden: 'golden (×3 price)', glowing: 'glowing', multiHarvest: 'bounty', frostHardy: 'frost-hardy' };
    this.show('Seed book', body => {
      const known = Object.values(s.species).filter(sp => s.discovered.includes(sp.id) || sp.sterile);
      const bred = known.filter(sp => sp.parents).sort((a, b) => (b.genome.gen || 0) - (a.genome.gen || 0) || (b.discoveredDay || 0) - (a.discoveredDay || 0));
      const byFamily = arr => arr.sort((a, b) => (a.genome.family || '').localeCompare(b.genome.family || '') || b.value - a.value);
      const base = byFamily(known.filter(sp => !sp.parents && !sp.wild)), wild = byFamily(known.filter(sp => !sp.parents && sp.wild));
      body.appendChild(el('div', 'muted', `${known.length} species known · ${bred.length} bred by you`));
      body.appendChild(el('div', 'pc-note', `Every species beyond the starters adds +${Math.round(CONFIG.economy.seedBookBonusPerSpecies * 100)}% to every sale. Right now: <b class="up">+${Math.round(seedBookBonus(s) * 100)}%</b>. Each generation of breeding steps the price up about ×1.5.`));
      const icon = sp => { const c = document.createElement('canvas'); c.width = 40; c.height = 40; const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(cropSprite(sp, 3), 0, 0, 40, 40); return c; };
      const chips = sp => { const g = sp.genome, out = roles(sp).map(r => r.replace(/:.*$/, '')); for (const t of RARE_TRAITS) if (g.traits?.[t]) out.unshift(TRAIT[t]); if (sp.sterile) out.push('sterile'); return out.map(c => `<span class="lin-chip">${esc(c)}</span>`).join(''); };
      const row = sp => {
        const r = el('div', 'lin-row'); r.appendChild(icon(sp)); const g = sp.genome;
        const from = sp.parents ? `from ${sp.parents.map(p => esc(s.species[p]?.name || '?')).join(' × ')} · day ${sp.discoveredDay ?? '?'}` : sp.wild ? 'brought by a bird' : sp.starter ? 'starter' : 'catalogue';
        r.appendChild(el('div', 'grow', `<b class="tier-${sp.tier}">${esc(sp.name)}</b> <span class="muted">${sp.tier} · gen ${g.gen || 0} · ${from}</span><br>${chips(sp)}<br><span class="muted">${formatMoney(sp.value)} × ${g.count} a harvest</span>`));
        return r;
      };
      const section = (title, arr, empty) => { body.appendChild(el('div', 'pc-sec', `${title} · ${arr.length}`)); if (!arr.length && empty) body.appendChild(el('div', 'muted', empty)); for (const sp of arr) body.appendChild(row(sp)); };
      section('Bred by you', bred, 'Nothing bred yet. Two parents on the bench, one child by morning.');
      section('Starters and the catalogue', base, '');
      if (wild.length) section('Brought by birds', wild, '');
    }, 'lineage');
  }

  // Your market stall: the counter on top, your pockets below. Click a pocket stack to put it on the counter, a counter
  // stack to take it back. The day's takings, and the button that walks you home.
  openStall() {
    const s = this.state, g = this.game, m = s.market;
    this.show('Your stall', body => {
      const t = m.today;
      body.appendChild(el('div', 'muted', M.marketOpen(s) ? `Open till ${CONFIG.market.close - 12}pm · ${t.visitors} ${t.visitors === 1 ? 'shopper' : 'shoppers'} so far` : 'Shut for the day: shoppers come between 8 and 6'));
      body.appendChild(el('div', 'pc-sec', `On the counter · ${M.counterCount(s)}`));
      const grid = el('div', 'pslots');
      m.counter.slots.forEach((it, i) => { const sl = this.pslot(it, s.species, { hint: 'empty', hover: true }); if (it) sl.onclick = () => { const r = M.takeBack(s, i); if (r.msg) this.toast(r.msg); else g.sound.play('move'); this.refresh(); }; grid.appendChild(sl); });
      body.appendChild(grid);
      body.appendChild(el('div', 'pc-sec', `Pockets · click a crop to put the stack out`));
      const pk = el('div', 'pslots');
      s.inventory.slots.forEach((it, i) => { const sl = this.pslot(it, s.species, { hint: `pocket ${i + 1}`, cls: it && !isFood(it) ? 'locked' : '', hover: true }); if (isFood(it)) sl.onclick = () => { const r = M.stock(s, i); if (r.msg) this.toast(r.msg); else g.sound.play('move'); this.refresh(); }; pk.appendChild(sl); });
      body.appendChild(pk);
      body.appendChild(el('div', 'pc-sec', 'Today'));
      body.appendChild(el('div', 'pc-row', `<span>Sold</span><span>${t.sold} for <b>${formatMoney(t.money)}</b>${t.tips ? ` <span class="up">(${formatMoney(t.tips)} in tips)</span>` : ''}</span></div>`));
      body.appendChild(el('div', 'pc-note', 'Shoppers pay full price, no daily order, and tip: more for the kind of food they came for and for starred crops. Roots, gourds, vine fruit, grain, berries and flowers each have their fans, so a mixed counter sells to more of them. Nothing sells while you are away.'));
      const home = el('button', 'primary', 'Pack up and walk home'); home.style.marginTop = '10px';
      home.onclick = () => { const r = M.packUp(s); if (r.left) this.toast(`${r.left} stay on the counter for next time: no pocket for them`); g.travelTo('farm'); };
      body.appendChild(home);
    }, 'stall');
  }
  // Another stall: rows with a price and a Buy button; what you buy goes straight into a pocket.
  openMerchant(key) {
    const s = this.state, g = this.game, st = MARKET.stalls[key];
    this.show(st.name, body => {
      body.appendChild(el('div', 'muted', key === 'seeds' ? 'Three kinds a day from other valleys: never what the catalogue has this week. New families to cross.' : 'What the catalogue delivers overnight, in your pocket now, for a bit more.'));
      for (const o of M.merchantOffers(s, key)) {
        const row = el('div', 'cat-row' + (s.money >= o.price ? ' afford' : ' cant'));
        const c = document.createElement('canvas'); c.width = 40; c.height = 40; const cx2 = c.getContext('2d'); cx2.imageSmoothingEnabled = false;
        const src = o.species ? seedIcon(Math.round(o.species.genome.hue1), o.species.genome.sat1, o.species.genome.light1) : o.id === 'fuel' ? fuelIcon() : o.id === 'pipe' ? pipeSprite(10, true) : stationIcon(o.id);
        if (src) cx2.drawImage(src, 0, 0, 40, 40); row.appendChild(c);
        const grow = el('div', 'grow'); grow.appendChild(el('div', 'cat-head-line', `<b>${esc(o.name)}</b>`)); row.appendChild(grow);
        row.appendChild(el('div', 'cat-price', formatMoney(o.price)));
        const b = el('button', s.money >= o.price ? 'primary' : null, 'Buy'); b.disabled = s.money < o.price;
        b.onclick = () => { const r = M.buyFromMerchant(s, key, o.id); if (!r.ok) { this.toast(r.msg); return; } g.sound.play('coins'); g.addFloat(r.float, s.player.x, s.player.y - 1.6, '#f6c453'); this.refresh(); };
        row.appendChild(b);
        row.appendChild(el('div', 'cat-desc', `<span class="muted">${esc(o.effect)}${o.species ? ' · ' + esc(roles(o.species).map(r => r.replace(/:.*$/, '')).join(' · ')) : ''}</span>`));
        body.appendChild(row);
      }
    }, 'merchant');
  }

  openSettings() {
    const g = this.game;
    this.show('Settings', body => {
      // sound: three sliders and a mute, kept in the browser rather than the save
      const snd = g.sound, P = snd.prefs;
      body.appendChild(el('div', 'pc-sec', 'Sound'));
      const slider = (label, key) => {
        const row = el('div', 'set-row'); row.appendChild(el('span', null, label));
        const r = el('input'); r.type = 'range'; r.min = 0; r.max = 100; r.value = Math.round(P[key] * 100);
        const val = el('span', 'set-val', `${r.value}%`);
        r.oninput = () => { snd.set(key, r.value / 100); val.textContent = `${r.value}%`; }; r.onchange = () => { snd.unlock(); if (key !== 'music') snd.play('coin'); };
        row.appendChild(r); row.appendChild(val); body.appendChild(row);
      };
      slider('Master', 'master'); slider('Effects', 'sfx'); slider('Music', 'music');
      const mute = el('label', 'set-row'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!P.muted; cb.onchange = () => snd.set('muted', cb.checked);
      mute.appendChild(cb); mute.appendChild(el('span', null, 'Mute everything')); body.appendChild(mute);
      body.appendChild(el('div', 'pc-sec', 'The model farm'));
      { const demo = el('button', 'primary', g.demo ? 'Back to my farm' : 'Visit the model farm'); demo.onclick = () => { location.search = g.demo ? '' : '?demo'; }; body.appendChild(demo); body.appendChild(el('div', 'pc-note', g.demo ? 'This is the guide farm. Nothing here is saved.' : 'A farm with every machine set up and running, to walk through and hover: the block of beds, the planter, the picker, the belt, the splitter, the dryer, the truck. Your own farm is untouched.')); }
      body.appendChild(el('div', 'pc-note', 'Most of what you hear is a recording (marked ●), pitched a little differently each time; the rest is synthesised until a recording is dropped into assets/sfx (see the README there). The interface stays quiet: only your hands make a sound. The theme loops while you farm.'));
      const aud = el('div', 'set-row'); aud.appendChild(el('span', null, 'Audition')); const grid = el('div', 'aud-grid');
      for (const name of Object.keys(g.sound.FX)) { const b = el('button', 'small', name + (g.sound.samples?.[name] ? ' ●' : '')); b.title = g.sound.samples?.[name] ? 'a recording' : 'synthesised'; b.onclick = () => { g.sound.unlock(); g.sound.play(name); }; grid.appendChild(b); }
      for (const name of g.sound.LOOP_NAMES) { const b = el('button', 'small', name + ' ~'); b.title = 'a loop: plays for a moment'; b.onclick = () => g.sound.previewLoop(name); grid.appendChild(b); }
      aud.appendChild(grid); body.appendChild(aud);
      // view: how big a tile is. Wide suits a half-screen window beside a video.
      body.appendChild(el('div', 'pc-sec', 'View'));
      const vrow = el('div', 'set-row'); vrow.appendChild(el('span', null, 'Zoom'));
      for (const [label, sc] of [['Close', 4], ['Wide', 3]]) { const b = el('button', CONFIG.scale === sc ? 'primary small' : 'small', label); b.onclick = () => { try { localStorage.setItem('farm-scale', String(sc)); } catch {} g.save(); location.reload(); }; vrow.appendChild(b); }
      vrow.appendChild(el('span', 'muted', 'reloads the page'));
      body.appendChild(vrow);
      const rrow = el('div', 'set-row'); rrow.appendChild(el('span', null, 'Drawing'));
      for (const [label, mode] of [['Sharp', 'sharp'], ['Fast', 'fast']]) { const b = el('button', CONFIG.render === mode ? 'primary small' : 'small', label); b.onclick = () => { try { localStorage.setItem('farm-render', mode); } catch {} g.save(); location.reload(); }; rrow.appendChild(b); }
      rrow.appendChild(el('span', 'muted', 'Fast helps an old machine'));
      body.appendChild(rrow);
      body.appendChild(el('div', 'pc-sec', 'Save'));
      body.appendChild(el('div', null, 'The game saves when you sleep and every 30 seconds. The farm stands still while the game is closed or the tab is hidden: nothing grows, dries or withers behind your back.'));
      body.appendChild(el('div', 'pc-sec', 'Keys'));
      body.appendChild(el('div', null, 'WASD or arrows walk · 1–5 pick a pocket · E uses what you stand by · N shows the network view (what is fed, powered and running) · Esc opens this.'));
      const row = el('div'); row.style.margin = '8px 0';
      const save = el('button', null, 'Save now'); save.onclick = () => { g.save(); this.toast('Saved'); };
      const exp = el('button', null, 'Export to text'); exp.onclick = () => { ta.value = g.exportSave(); ta.select(); };
      const imp = el('button', null, 'Import from text'); imp.onclick = () => { try { g.importSave(ta.value); this.toast('Imported'); this.closePanel(); } catch (e) { this.toast('Import failed: ' + e.message); } };
      const reset = el('button', null, 'New farm (wipe save)'); reset.onclick = () => { if (confirm('Start over? This deletes your farm.')) g.newGame(); };
      for (const b of [save, exp, imp, reset]) { row.appendChild(b); row.appendChild(document.createTextNode(' ')); }
      body.appendChild(row);
      const ta = el('textarea'); ta.placeholder = 'Save text appears here / paste a save here'; body.appendChild(ta);
      const st = g.state.stats;
      body.appendChild(el('div', 'muted', `Day ${S.dayOf(g.state)} · harvests ${st.harvests} · sold ${st.sold} · earned ${formatMoney(g.state.lifetime)} · breeds ${st.breeds} · discoveries ${st.discoveries}`));
    });
  }
}

const FAMILY_WORD = { root: 'root vegetable', bush: 'fruit bush', vine: 'climbing vine', grain: 'grain', flower: 'flower', gourd: 'leafy sprawler' };
function bar(pct, color) { return `<div class="pc-bar"><div style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></div></div>`; }
// The genes that matter to the farmer, each with a mark (▲ good, ▼ bad) and what it does. Shown as rows on the cards.
export function traitNotes(sp) {
  const g = sp.genome, out = [];
  if (g.thirst < 0.3) out.push({ word: 'low water', good: 1, why: 'fewer pours a day' });
  else if (g.thirst > 0.7) out.push({ word: 'thirsty', good: -1, why: 'dries the bed fast' });
  if (g.hardiness > 0.7) out.push({ word: 'hardy', good: 1, why: 'rarely withers' });
  else if (g.hardiness < 0.3) out.push({ word: 'fragile', good: -1, why: 'withers when dry or soggy' });
  if (g.size > 0.75) out.push({ word: 'big', good: 1, why: 'sells dearer' }); else if (g.size < 0.25) out.push({ word: 'small', good: -1, why: 'sells cheaper' });
  if (g.regrow) out.push({ word: 'regrows', good: 1, why: 'picks again, no replanting' });
  if ((g.sugar ?? 0.4) >= 0.7) out.push({ word: 'sweet', good: 1, why: `dries to ×${(CONFIG.dried.base + CONFIG.dried.sugar * g.sugar).toFixed(1)}` }); else if ((g.sugar ?? 0.4) <= 0.25) out.push({ word: 'bland', good: -1, why: 'loses by drying: sell it fresh' });
  if ((g.skin ?? 0.5) <= 0.3) out.push({ word: 'thin skin', good: 1, why: 'dries fast' }); else if ((g.skin ?? 0.5) >= 0.7) out.push({ word: 'thick skin', good: -1, why: 'slow in the dryer' });
  if ((g.vigor || 0) >= 0.05) out.push({ word: 'hybrid vigour', good: 1, why: `sells ×${(1 + CONFIG.genetics.vigorValue * g.vigor).toFixed(2)}` });
  const T = { golden: 'sells for 3×', glowing: 'rare: sells dearer', multiHarvest: 'regrows after each pick', frostHardy: 'rare: sells dearer' };
  for (const [k, v] of Object.entries(g.traits)) if (v) out.push({ word: '★ ' + k.replace(/([A-Z])/g, ' $1').toLowerCase(), good: 1, why: T[k] || 'rare' });
  if (sp.sterile) out.push({ word: 'sterile', good: -1, why: 'its seeds are dead' });
  return out;
}
export const traitRows = sp => traitNotes(sp).map(n => `<div class="pc-row trait ${n.good > 0 ? 'good' : 'bad'}"><span>${n.good > 0 ? '▲' : '▼'} ${esc(n.word)}</span><span>${esc(n.why)}</span></div>`).join('');
export function traitList(sp) {
  const g = sp.genome, out = [];
  out.push(`${g.archetype} ${g.family}`);
  if (g.pattern !== 'none') out.push(g.pattern);
  if (g.regrow) out.push('regrows');
  if (g.thirst < 0.3) out.push('needs little water'); else if (g.thirst > 0.7) out.push('thirsty');
  if (g.hardiness > 0.7) out.push('hardy'); else if (g.hardiness < 0.3) out.push('fragile');
  if (g.size > 0.75) out.push('big'); else if (g.size < 0.25) out.push('small');
  for (const [k, v] of Object.entries(g.traits)) if (v) out.push('★ ' + k.replace(/([A-Z])/g, ' $1').toLowerCase());
  if (sp.sterile) out.push('sterile');
  return out;
}
// a gene name as a farmer would say it
const MUT_WORD = { family: 'new family', archetype: 'new shape', pattern: 'new pattern', hue1: 'colour', sat1: 'colour', light1: 'colour', hue2: 'second colour', sat2: 'second colour', light2: 'second colour', leafHue: 'leaf colour', leafShape: 'leaf shape', leafDensity: 'leafiness', size: 'size', count: 'yield', growHours: 'growth speed', thirst: 'thirst', hardiness: 'hardiness', regrow: 'regrowth', elongation: 'shape', width: 'shape', tip: 'shape', curve: 'shape', ribs: 'shape', bumpiness: 'shape', height: 'height', top: 'top', ripeHours: 'ripening' };
export function mutationWord(m) { if (m.startsWith('trait:')) return '★ ' + m.slice(6).replace(/([A-Z])/g, ' $1').toLowerCase(); return MUT_WORD[m] || m; }
export function describeBreed(s, r) {
  const name = r.species ? s.species[r.species]?.name : '';
  switch (r.outcome) {
    case 'success': return `${r.parents.join(' × ')} → ${r.isNew ? 'new species: ' : ''}${name}. ${r.seeds} seeds wait on the bench.${r.mutations.length ? ' Changed: ' + r.mutations.map(mutationWord).join(', ') + '.' : ''}`;
    case 'sterile': return `${r.parents.join(' × ')} → ${name}. It grows, but makes no seeds. 1 seed waits on the bench.`;
    case 'wither': return `${r.parents.join(' × ')} → the seedling withered. Nothing survived.`;
    case 'revert': return `${r.parents.join(' × ')} → it reverted to ${name}. 2 seeds wait on the bench.`;
  }
  return '';
}
