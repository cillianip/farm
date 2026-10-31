// The rules of the game: time, growth, actions, the crate and the cart, sleep, breeding, compost. Pure JS, testable in Node.
import { CONFIG } from './config.js';
import { makeRng, randomSeed, hashString } from './rng.js';
import { createWorld, tileAt, isOwnedFarmland, chunkKey, chunkOrigin, buyableChunks, chunkInRange, ownsChunk, PLAYER_START, BUILDINGS, MOVABLE, isCleared } from './world.js';
import { makeInventory, addItem, removeFromSlot, removeByKey, itemKey, growInventory, countItem, hasRoom, itemName } from './items.js';
import { starterSpecies, makeSpecies, cross, STARTER_KEYS, variantWord, baseName, wildSpecies, blendName, growRealMinutes, WILD_BASES } from './genetics.js';
import { salePrice, breedCost, seedBookBonus, formatMoney } from './economy.js';
import { makeCompost } from './fertiliser.js';
import { deliverOrders, collectParcels } from './catalog.js';
export { collectParcels };

export const MIN_PER_DAY = 1440;
export const gameMinutesPerRealSecond = () => MIN_PER_DAY / CONFIG.time.dayRealSeconds;

export function createState(seed = randomSeed()) {
  const species = starterSpecies();
  const state = {
    version: 1, seed, savedAt: Date.now(),
    minutes: CONFIG.time.wakeHour * 60,      // game minutes since day 1 00:00
    money: CONFIG.economy.startMoney, lifetime: 0,
    energy: CONFIG.energy.max, energyMax: CONFIG.energy.max, hunger: 100, thirst: 100, layout: CONFIG.layout,
    player: { x: PLAYER_START.x, y: PLAYER_START.y, dir: 'down' },
    world: createWorld(),
    inventory: makeInventory(CONFIG.inventory.slots),
    chest: makeInventory(CONFIG.chest.slots),
    species, discovered: Object.keys(species),
    upgrades: { can: 0 },                         // the can's reach (0: one bed, 1: three in a row, 2: a 3×3); everything else is a catalogue item
    breeder: { a: null, b: null, running: null, lastResult: null, result: null },   // result: seeds waiting on the bench
    compost: { inputs: [], running: null, ready: null, readyCount: 0 },   // inputs: {species|null (withered), q, qty}; the lid shuts at bedtime
    fertBook: [],
    stats: { harvests: 0, sold: 0, breeds: 0, discoveries: 0, days: 1, earned: 0, birds: 0 },
    morning: null, rainToday: false, humidity: 45,
    water: { pours: 0 },                          // sprinkler pours since the last bill
    can: { water: 0, capacity: CONFIG.can.capacity, level: 0 },
    rack: { hoe: true, can: true },                 // tools still hanging on the rack
    bird: { nextAt: null, pending: null, today: 0, count: 0 },
    crate: { items: [], capacity: CONFIG.crate.capacity, lastSale: null, pickups: 0, pendingPickup: null },   // items: {species, q, qty}; pickups 1 = the cart also comes at noon
    seedRack: { trays: [{ item: null, readyAt: null, startedAt: null }] },   // trays: item {species, q, seeds}, readyAt in game minutes
    orders: [], deeds: 0,                         // catalogue orders on tonight's cart; land deeds waiting to be claimed
    objects: Object.fromEntries(MOVABLE.map(k => [k, BUILDINGS[k] ? { x: BUILDINGS[k].x, y: BUILDINGS[k].y } : null])),   // movable objects' positions (bench: null until placed)
    parcels: [], hasBench: false,
    hoe: { level: 0 }, hands: { level: 0 },       // hoe and quick-hands upgrades from the catalogue
    ledger: { today: freshDay(), yesterday: null, history: [] },   // what each day produced and where it got stuck
    carrying: null,                               // key of the object held above the head, or null
  };
  return state;
}

// ---------- the day ledger ----------
// One record per day: the sale, and the facts the catalogue uses to say which bottleneck you hit yesterday.
export const freshDay = () => ({ sale: 0, sold: 0, fills: 0, hoed: 0, planted: 0, harvested: 0, crateFullAt: null, crateRefused: 0, trayBusy: 0, emptyBeds: 0, tilled: 0, owned: 0 });
export function ledger(state) { if (!state.ledger) state.ledger = { today: freshDay(), yesterday: null, history: [] }; if (!state.ledger.today) state.ledger.today = freshDay(); return state.ledger; }
export const today = state => ledger(state).today;
export const yesterday = state => ledger(state).yesterday;
// What everything planted right now will sell for when it is harvested once: value × fruits per live crop.
export function fieldValue(state) {
  let total = 0;
  for (const t of state.world.tiles) {
    const c = t.crop; if (!c || c.dead) continue;
    const sp = state.species[c.speciesId]; if (!sp) continue;
    total += sp.value * sp.genome.count;
  }
  return total;
}
// Plants grow at nightGrowth speed from 20:00 to wakeHour, so a day is worth fewer than 24 growing hours.
export const effectiveHoursPerDay = () => 24 - (24 - 20 + CONFIG.time.wakeHour) * (1 - CONFIG.crop.nightGrowth);
export const humidityOf = state => state.humidity ?? 45;
export const evaporationFactor = state => Math.max(0.1, CONFIG.weather.evapBase - humidityOf(state) / 100 * CONFIG.weather.evapSpan);
export const humidityWord = h => h >= 85 ? 'rainy' : h >= 65 ? 'humid' : h >= 40 ? 'mild' : 'dry';
export const hoeLevel = state => state.hoe?.level || 0;
export const hoeSeconds = state => CONFIG.hoe.seconds[Math.min(hoeLevel(state), CONFIG.hoe.seconds.length - 1)];
export const dropSeconds = state => CONFIG.hands.dropSeconds[Math.min(state.hands?.level || 0, CONFIG.hands.dropSeconds.length - 1)];
export const hoeEnergy = state => CONFIG.hoe.energy[Math.min(hoeLevel(state), CONFIG.hoe.energy.length - 1)];
// Low energy drags: you walk slower and every action takes longer. Full pockets drag too.
export const isTired = state => state.energy < CONFIG.needs.tiredBelow;
export const carriedCount = state => state.inventory.slots.reduce((n, it) => n + (it && it.kind !== 'tool' ? it.qty : 0), 0);
export const isHeavy = state => carriedCount(state) >= CONFIG.player.heavyAt;
export const walkFactor = state => { const N = CONFIG.needs; const weak = (state.hunger ?? 100) < N.weakBelow || (state.thirst ?? 100) < N.weakBelow; return (weak ? N.weakSpeed : 1) * (isTired(state) ? N.tiredSpeed : 1) * (isHeavy(state) ? CONFIG.player.heavySpeed : 1); };
export const actionFactor = state => isTired(state) ? CONFIG.needs.tiredActionSlow : 1;
// Older saves: the chest tile, and five pockets instead of a hidden 27-slot bag (the overflow goes into the chest).
export function migrate(state) {
  const ct = tileAt(state.world, BUILDINGS.chest.x, BUILDINGS.chest.y);
  if (ct && ct.t === 'grass') { ct.t = 'chest'; ct.tilled = false; ct.crop = null; }
  const n = CONFIG.inventory.slots;
  if (state.inventory.slots.length > n) { const extra = state.inventory.slots.splice(n); for (const it of extra) if (it) addItem(state.chest, it); }
  renameBred(state);
  if (!state.compost) state.compost = { inputs: [], running: null, ready: null, readyCount: 0 };
  if (!state.water) state.water = { pours: 0 };
  if (!state.pipesGifted && sprinklerTiles(state).length) { addItem(state.chest, { kind: 'pipe', qty: 2 * CONFIG.pipe.packSize }); state.pipesGifted = true; }   // sprinklers set before pipes existed: the plumber left two packs in the chest
  for (const sp of Object.values(state.species)) if (sp.genome && sp.genome.vigor === undefined) sp.genome.vigor = 0;   // the vigour gene arrived in Build 37
  for (const t of state.world.tiles) if (burnsFuel(t.obj) && t.obj.fuel === undefined) t.obj.fuel = 3;   // fuel became a thing you pour in Build 43
  for (const sp of Object.values(state.species)) { const base = sp.wild && sp.base && WILD_BASES[sp.base]; if (!base) continue; for (const k of ['archetype', 'pattern', 'top', 'leafShape']) if (base[k] !== undefined) sp.genome[k] = base[k]; }
  for (const key of MOVABLE) {   // a station left on the old one-tile walkway now stands in the trees: move it to the nearest clear tile
    const pos = objectPos(state, key), t = pos && tileAt(state.world, pos.x, pos.y);
    if (!t || t.t !== key || isCleared(state.world, pos.x, pos.y)) continue;
    const free = (x, y) => { const u = tileAt(state.world, x, y); return u && u.t === 'grass' && !u.tilled && !u.crop && !u.obj && !u.track && isCleared(state.world, x, y); };
    let to = null;
    for (let r = 1; r <= 12 && !to; r++) for (let dy = -r; dy <= r && !to; dy++) for (let dx = -r; dx <= r && !to; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r && free(pos.x + dx, pos.y + dy)) to = { x: pos.x + dx, y: pos.y + dy };
    if (!to) continue;
    t.t = 'grass'; tileAt(state.world, to.x, to.y).t = key; state.objects = state.objects || {}; state.objects[key] = to;
  }
  return state;
}
// Species bred before the parent-blend names (Crimson Radish and friends) take their new name, parents before children.
export function renameBred(state) {
  const bred = Object.values(state.species).filter(sp => sp.parents && !sp.blended).sort((a, b) => (a.genome.gen || 0) - (b.genome.gen || 0) || (a.discoveredDay || 0) - (b.discoveredDay || 0));
  for (const sp of bred) {
    const [A, B] = sp.parents.map(id => state.species[id]); if (!A || !B) { sp.blended = true; continue; }
    let name = blendName(A.name, B.name); if (sp.sterile) name += ' (sterile)';
    const taken = new Set(Object.values(state.species).filter(o => o !== sp).map(o => o.name));
    if (taken.has(name)) name = `${variantWord(sp.genome)} ${name}`;
    sp.name = name; sp.blended = true;
  }
  return bred.length;
}

// ---------- time ----------
export const dayOf = s => Math.floor(s.minutes / MIN_PER_DAY) + 1;
export const hourOf = s => (s.minutes % MIN_PER_DAY) / 60;
export function clockText(s) {
  const h = Math.floor(hourOf(s)), m = Math.floor(s.minutes % 60);
  return `Day ${dayOf(s)} · ${String(h).padStart(2, '0')}:${String(Math.floor(m / 10) * 10).padStart(2, '0')}`;
}
// minutes since the day started counting from 00:00; pass-out is at passOutHour of the *current waking day*
function passOutMinute(s) {
  const dayStart = (dayOf(s) - 1) * MIN_PER_DAY;
  // if it's before wakeHour we are in the small hours of the night that began the previous day
  const h = hourOf(s);
  const base = h < CONFIG.time.wakeHour ? dayStart - MIN_PER_DAY : dayStart;
  return base + CONFIG.time.passOutHour * 60;
}

// Advance the simulation by real seconds. Returns a list of events (e.g. {type:'sleep'}).
export function advance(state, realSeconds) {
  const events = [];
  let left = realSeconds * gameMinutesPerRealSecond();
  while (left > 0) {
    const step = Math.min(left, 10);                   // tick in ≤10 game-minute slices
    const limit = passOutMinute(state) - state.minutes;
    const dt = Math.min(step, Math.max(0, limit));
    if (dt > 0) { state.minutes += dt; tick(state, dt); left -= dt; }
    if (limit - dt <= 0.0001) { events.push({ type: 'sleep', forced: true, report: sleep(state, { forced: true }) }); left = 0; }
  }
  return events;
}

// ---------- growth ----------
export function speciesOfCrop(state, crop) { return state.species[crop.speciesId]; }
export function cropStage(crop) {
  if (!crop) return null;
  if (crop.dead) return 'dead';
  if (crop.growth >= 100) return 3;
  if (crop.growth >= 50) return 2;
  if (crop.growth >= 15) return 1;
  return 0;
}
export const moistureOf = tile => tile.moisture || 0;
export const isWet = tile => moistureOf(tile) >= CONFIG.soil.growMin;
// 'dry' | 'moist' | 'wet' | 'soggy'
export function moistureState(tile) { const m = moistureOf(tile), S = CONFIG.soil; return m < S.growMin ? 'dry' : m < S.idealMin ? 'moist' : m <= S.soggyAbove ? 'wet' : 'soggy'; }
// growth speed multiplier from moisture: 0 below growMin, ramps to 1 in the ideal band, falls off when soggy
// How wet the soil feels to this plant: low-thirst plants cope with drier beds, thirsty ones need wetter.
export const feltMoisture = (tile, g) => Math.max(0, Math.min(100, moistureOf(tile) + (0.5 - (g?.thirst ?? 0.5)) * CONFIG.soil.thirstShift));
export function moistureGrowthFactor(m) {
  const S = CONFIG.soil;
  if (m < S.growMin) return 0;
  if (m < S.idealMin) return 0.4 + 0.6 * (m - S.growMin) / (S.idealMin - S.growMin);
  if (m <= S.idealMax) return 1;
  return Math.max(0.3, 1 - 0.7 * (m - S.idealMax) / (100 - S.idealMax));
}

function neighbourSpeciesBonus(state, x, y, speciesId) {
  const seen = new Set();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const t = tileAt(state.world, x + dx, y + dy);
    if (t?.crop && !t.crop.dead && t.crop.speciesId !== speciesId) seen.add(t.crop.speciesId);
  }
  return 1 + seen.size * CONFIG.crop.neighbourBonus;
}

// rot factor 1 → fresh, 0 → about to die. Only meaningful when ripe.
export function rotFactor(state, crop) {
  if (!crop || crop.growth < 100 || crop.ripeAt == null) return 1;
  const sp = speciesOfCrop(state, crop);
  const over = state.minutes - crop.ripeAt - sp.genome.ripeHours * 60;
  if (over <= 0) return 1;
  return Math.max(0, 1 - over / (CONFIG.crop.rotHours * 60));
}

export function tick(state, dtMinutes, opts = {}) {
  const C = CONFIG.crop, w = state.world, now = state.minutes, dtH = dtMinutes / 60;
  // needs
  const N = CONFIG.needs;
  const drain = opts.asleep ? N.sleepDrain : 1;
  state.hunger = Math.max(0, (state.hunger ?? 100) - dtH * drain * 100 / N.hungerHours);
  state.thirst = Math.max(0, (state.thirst ?? 100) - dtH * drain * 100 / N.thirstHours);
  if (state.hunger <= 0 || state.thirst <= 0) state.energy = Math.max(0, state.energy - N.starvingEnergyPerHour * dtH);
  // the midday cart: when the clock crosses the pickup hour it empties the crate and pays on the spot
  if (state.crate.pickups) { const m = CONFIG.crate.middayHour * 60, before = (now - dtMinutes) % MIN_PER_DAY, after = now % MIN_PER_DAY;
    if (before < m && after >= m) { const sale = collectCrate(state); if (sale) { const D = today(state); D.sale += sale.total; D.sold += sale.count; D.pickups = (D.pickups || 0) + 1; state.crate.pendingPickup = sale; } } }
  for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) {
    const t = w.tiles[y * w.w + x];
    const c = t.crop; if (!c || c.dead) continue;
    const sp = state.species[c.speciesId]; if (!sp) { t.crop = null; continue; }
    const g = sp.genome, f = t.fert?.stats || {};
    const m = feltMoisture(t, g);
    const mf = moistureGrowthFactor(m);
    if (mf > 0 && c.growth < 100 && c.growth > 0) t.moisture = Math.max(0, moistureOf(t) - CONFIG.soil.uptakePerHour * g.thirst * (0.3 + 0.7 * c.growth / 100) * dtH);   // the plant drinks
    if (mf > 0 && c.growth < 100) {
      const hrNow = hourOf(state), night = hrNow >= 20 || hrNow < CONFIG.time.wakeHour;
      const speed = mf * (night ? C.nightGrowth : 1) * (1 + (f.speed || 0)) * neighbourSpeciesBonus(state, x, y, c.speciesId);
      c.growth = Math.min(100, c.growth + (dtH / g.growHours) * 100 * speed);
      if (c.growth >= 99.999) { c.growth = 100; c.ripeAt = now; }
    }
    if (m < CONFIG.soil.droughtBelow) {            // drought stress
      const loss = C.dryHealthLossPerHour * (0.5 + g.thirst) * (1 - 0.6 * Math.min(1, g.hardiness + (f.hardiness || 0)));
      c.health -= loss * dtH;
    } else if (m > CONFIG.soil.soggyAbove) {       // waterlogged: roots can't breathe
      c.health -= C.soggyHealthLossPerHour * (1 - 0.5 * Math.min(1, g.hardiness + (f.hardiness || 0))) * dtH;
    } else c.health = Math.min(100, c.health + C.wetHealthGainPerHour * dtH);
    if (c.unknown && c.growth >= 100) c.unknown = false;
    if (c.growth >= 100 && rotFactor(state, c) <= 0) c.health = 0;
    if (c.health <= 0) { c.dead = true; c.health = 0; }
  }
  // sprinklers: while you are awake, a pour for any bed in reach the moment it dries below the band
  if (!opts.asleep) {
    sprinklerPass(state, dtMinutes); const hr0 = hourOf(state);
    if (Math.floor((now - dtMinutes) / 60) !== Math.floor(now / 60) && hr0 >= CONFIG.time.wakeHour && hr0 < 20) machinePass(state);   // pickers work once an hour
    state.beltClock = (state.beltClock || 0) + dtMinutes; const step = CONFIG.power.belt.stepMinutes;   // the belts move a tile every few minutes
    if (state.beltClock >= step) { const n = Math.min(8, Math.floor(state.beltClock / step)); state.beltClock -= n * step; for (let i = 0; i < n; i++) beltStep(state); }
  }
  // evaporation (sun only: not at night)
  const hr = hourOf(state);
  if (hr >= 6 && hr < 20) { const ev = CONFIG.soil.evaporationPerHour * evaporationFactor(state) * dtH; for (const t of w.tiles) if (t.moisture > 0) t.moisture = Math.max(0, t.moisture - ev * (t.fert?.stats?.waterKeep ? 1 - t.fert.stats.waterKeep : 1)); }
  // birds: once there is bare tilled soil, a bird will come by now and then and drop a seed
  const B = state.bird;
  if (!opts.asleep && !B.pending && B.count < CONFIG.bird.maxTotal) {
    const targets = bareTilledTiles(state);
    if (!targets.length) B.nextAt = null;
    else if (B.nextAt == null) { const r = makeRng(state.seed ^ hashString('bird' + B.count)); const [lo, hi] = CONFIG.bird.firstDelayMinutes; B.nextAt = now + r.range(lo, hi); }
    else if (now >= B.nextAt) { const r = makeRng(state.seed ^ hashString('birdpick' + B.count)); const [x, y] = r.pick(targets); B.pending = { x, y, at: now }; B.nextAt = null; B.today++; B.count++; }
  }
  if (B.pending && now - B.pending.at > 30) birdDrop(state);   // nobody watched the animation (offline): plant it anyway
  // compost
  const cp = state.compost;
  if (cp.running && now >= cp.running.readyAt) { cp.ready = cp.running.fert; cp.readyCount = cp.running.count; cp.running = null; }
}

export function bareTilledTiles(state) {
  const out = [], w = state.world;
  for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) { const t = w.tiles[y * w.w + x]; if (t.t === 'grass' && t.tilled && !t.crop && !t.obj) out.push([x, y]); }
  return out;
}
// The bird's seed lands: a wild species (slightly varied basic crop) is planted on the pending tile, unknown until ripe.
export function birdDrop(state) {
  const B = state.bird; if (!B.pending) return null;
  const { x, y } = B.pending; B.pending = null;
  const t = tileAt(state.world, x, y);
  if (!t || !t.tilled || t.crop) return null;
  const r = makeRng(state.seed ^ hashString(`seed${x},${y},${state.stats.birds}`));
  const sp = wildSpecies(r);
  sp.discoveredDay = dayOf(state);
  state.species[sp.id] = sp;
  t.crop = { speciesId: sp.id, growth: 0, health: 100, ripeAt: null, dead: false, plantedAt: state.minutes, harvests: 0, unknown: true, fromBird: true };
  state.stats.birds++;
  return { x, y, species: sp.id };
}
export function fillCan(state) { if (state.can.water < state.can.capacity) today(state).fills++; state.can.water = state.can.capacity; return { ok: true, msg: '' }; }
export function takeTool(state, tool) {
  if (!state.rack[tool]) return fail('The rack is empty');
  if (addItem(state.inventory, { kind: 'tool', tool, qty: 1 })) return fail('Bag is full');
  state.rack[tool] = false;
  return { ok: true, msg: tool === 'hoe' ? 'Took the hoe' : 'Took the watering can' };
}
// Hang a tool back on its rack. Tool state (the can's water) lives in state, so nothing is lost.
export function returnTool(state, tool, slotIndex) {
  const it = state.inventory.slots[slotIndex];
  if (!it || it.kind !== 'tool' || it.tool !== tool) return fail('');
  if (state.rack[tool]) return fail('The rack already holds one');
  removeFromSlot(state.inventory, slotIndex, 1);
  state.rack[tool] = true;
  return { ok: true, msg: tool === 'hoe' ? 'Hung up the hoe' : 'Hung up the watering can' };
}
// Drink from the well (empty hands) and eat produce: the only ways hunger and thirst come back.
// A drink fills thirst. The little energy it gives scales with how thirsty you were, so sipping at a full bar gives nothing.
export function drink(state) {
  const was = state.thirst ?? 100; if (was >= 95) return { ok: true, msg: '', float: 'Not thirsty' };
  const energy = Math.round(CONFIG.needs.drinkEnergy * (100 - was) / 100);
  state.thirst = 100; state.energy = Math.min(state.energyMax, state.energy + energy);
  return { ok: true, msg: '', float: energy > 0 ? `Refreshing  +${energy} energy` : 'Refreshing' };
}
export function eat(state, slotIndex) {
  const it = state.inventory.slots[slotIndex];
  if (!it || it.kind !== 'crop') return fail('Only produce can be eaten');
  const sp = state.species[it.species];
  const gain = CONFIG.needs.eatBase + CONFIG.needs.eatPerSize * (sp?.genome.size ?? 0.4);
  removeFromSlot(state.inventory, slotIndex, 1);
  state.hunger = Math.min(100, state.hunger + gain);
  const energy = Math.round(gain * CONFIG.needs.eatEnergyPerHunger);
  state.energy = Math.min(state.energyMax, state.energy + energy);
  return { ok: true, msg: '', float: `Ate a ${sp?.name || 'crop'}  +${energy} energy`, gain, energy };
}
export function takeTools(state) {
  let n = 0;
  if (state.rack.hoe) { if (!addItem(state.inventory, { kind: 'tool', tool: 'hoe', qty: 1 })) { state.rack.hoe = false; n++; } }
  if (state.rack.can) { if (!addItem(state.inventory, { kind: 'tool', tool: 'can', qty: 1 })) { state.rack.can = false; n++; } }
  return { ok: n > 0, msg: n ? 'Took the hoe and the watering can' : 'The rack is empty' };
}

// ---------- actions ----------
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
// ---------- delivery crate ----------
export const crateCount = state => state.crate.items.reduce((n, it) => n + it.qty, 0);
// The buyer's price for the nth crop of one kind in a pickup: the first `full` at full price, then the steps.
export function demandFactor(n) { const D = CONFIG.demand; if (n <= D.full) return 1; return D.steps[Math.min(D.steps.length - 1, Math.floor((n - D.full - 1) / D.full))]; }
// What a pickup pays for these items: one line per species (the starred ones go to the buyer first).
export function priceCrate(state, items) {
  const bySp = new Map();
  for (const it of items) { const k = it.kind && it.kind !== 'crop' ? crateKey(it) : it.species; if (!bySp.has(k)) bySp.set(k, []); bySp.get(k).push(it); }
  const lines = [];
  for (const [id, its] of bySp) {
    if (its[0].kind && its[0].kind !== 'crop') {   // second-hand: a flat price each, no buyer's limit
      const n = its.reduce((a, b) => a + b.qty, 0), each = secondHand(its[0]);
      lines.push({ name: `${itemName(its[0], state.species)} (second-hand)`, kind: its[0].kind, level: its[0].level || 0, qty: n, each, total: Math.round(each * n * 100) / 100, full: n, cut: 0 });
      continue;
    }
    let n = 0, total = 0, full = 0, cut = 0;
    for (const it of its.slice().sort((a, b) => (b.q || 0) - (a.q || 0))) { const each = salePrice(state, it); for (let i = 0; i < it.qty; i++) { n++; const f = demandFactor(n); total += each * f; if (f === 1) full++; else cut++; } }
    total = Math.round(total * 100) / 100;
    lines.push({ name: state.species[id]?.name || '?', species: id, qty: n, each: n ? total / n : 0, total, full, cut });
  }
  return { lines, total: Math.round(lines.reduce((v, l) => v + l.total, 0) * 100) / 100, count: lines.reduce((n, l) => n + l.qty, 0) };
}
export const crateValue = state => priceCrate(state, state.crate.items).total;
// Second-hand: the cart buys machines, pipe, line and belt back at a share of the list price. Each takes a crate place.
export const SELLABLE = ['sprinkler', 'pump', 'generator', 'picker', 'hopper', 'pipe', 'line', 'belt', 'chest'];
export function listPrice(it) {
  const C = CONFIG;
  switch (it.kind) {
    case 'sprinkler': return C.sprinkler.tiers[it.level || 0].price;
    case 'pump': return C.pump.tiers[it.level || 0].price;
    case 'generator': return C.power.generator.price;
    case 'picker': return C.power.picker.price;
    case 'hopper': return C.power.hopper.price;
    case 'chest': return C.chest.field.price;
    case 'pipe': return C.pipe.packPrice / C.pipe.packSize;
    case 'line': return C.power.line.packPrice / C.power.line.packSize;
    case 'belt': return C.power.belt.packPrice / C.power.belt.packSize;
  }
  return 0;
}
export const secondHand = it => Math.round(listPrice(it) * CONFIG.crate.secondHand * 100) / 100;
const crateKey = it => it.kind && it.kind !== 'crop' ? `${it.kind}:${it.level || 0}` : `${it.species}:${it.q || 0}`;
// Move crops, or machines for the second-hand price, from a bag slot into the crate (as many as fit).
export function putInCrate(state, slotIndex, n = Infinity) {
  const it = state.inventory.slots[slotIndex];
  if (!it || (it.kind !== 'crop' && !SELLABLE.includes(it.kind))) return fail('Crops go in the crate, and machines to sell second-hand');
  const room = state.crate.capacity - crateCount(state);
  if (room <= 0) { today(state).crateRefused++; return fail('The crate is full. The cart comes tonight.'); }
  const take = Math.min(n, it.qty, room);
  removeFromSlot(state.inventory, slotIndex, take);
  const key = crateKey(it), have = state.crate.items.find(c => crateKey(c) === key);
  if (have) have.qty += take; else state.crate.items.push(it.kind === 'crop' ? { species: it.species, q: it.q || 0, qty: take } : { kind: it.kind, level: it.level || 0, qty: take });
  const name = it.kind === 'crop' ? state.species[it.species]?.name || 'crop' : itemName(it, state.species);
  const full = crateCount(state) >= state.crate.capacity;
  if (full && today(state).crateFullAt == null) today(state).crateFullAt = hourOf(state);
  return { ok: true, msg: '', float: `+${take} ${name}`, count: take, full };
}
// The overnight pickup: everything in the crate is sold at today's prices.
export function collectCrate(state) {
  drainHoppers(state);   // the hoppers tip into the crate first, as much as fits
  if (!state.crate.items.length) return null;
  const { lines, total, count } = priceCrate(state, state.crate.items);
  state.money += total; state.lifetime += total; state.stats.sold += count; state.stats.earned += total;
  state.crate.items = [];
  const sale = { count, total, lines };
  state.crate.lastSale = sale;
  return sale;
}

export function inReach(state, x, y) { return dist(state.player.x, state.player.y, x + 0.5, y + 0.5) <= CONFIG.player.reach; }
function spend(state, e) { if (state.energy < e) return false; state.energy = Math.max(0, state.energy - e); return true; }
const fail = msg => ({ ok: false, msg });

export function canTiles(state, x, y) {
  const lvl = state.upgrades.can;
  if (lvl === 0) return [[x, y]];
  const out = [];
  if (lvl === 1) { const d = state.player.dir; const horiz = d === 'left' || d === 'right'; for (let i = -1; i <= 1; i++) out.push(horiz ? [x, y + i] : [x + i, y]); return out; }
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push([x + dx, y + dy]);
  return out;
}

// Use the selected hotbar item on tile (x,y). Returns {ok, msg, float?}
export function useItem(state, slotIndex, x, y) {
  const item = state.inventory.slots[slotIndex];
  const t = tileAt(state.world, x, y);
  if (!t) return fail('');
  if (!inReach(state, x, y)) return fail('Too far');
  if (!item) return harvestOrInspect(state, t, x, y);
  const E = CONFIG.energy;
  if (item.kind === 'tool' && item.tool === 'hoe') {
    if (t.crop) {
      if (!t.crop.dead && t.crop.growth >= 100) return harvest(state, t, x, y);
      const c = t.crop, wasDead = c.dead;
      const got = wasDead ? { kind: 'withered', qty: 1 } : cropStage(c) === 0 && !c.unknown ? { kind: 'seed', species: c.speciesId, qty: 1 } : { kind: 'pulled', species: c.speciesId, qty: 1, ...(c.unknown ? { unknown: true } : {}) };
      if (!hasRoom(state.inventory, got)) return fail(wasDead ? 'No pocket free for the withered plant' : 'No pocket free');   // the plant comes with you, withered or not
      if (!spend(state, E.clear)) return fail('Too tired');
      t.crop = null; t.fert = null;
      addItem(state.inventory, got);
      return { ok: true, msg: wasDead ? 'Cleared withered plant' : '', float: wasDead ? '' : got.kind === 'seed' ? 'Seed back' : 'Pulled up' };
    }
    if (t.obj) { if (t.obj.kind === 'chest') return fail('Hold on it to pick it up'); if (t.obj.held?.length) return fail('Empty it first'); if (!spend(state, E.clear)) return fail('Too tired'); const it = { kind: t.obj.kind, qty: 1 }; if (t.obj.level != null) it.level = t.obj.level; if (addItem(state.inventory, it)) return fail('No pocket free'); const spilt = fuelOf(t.obj) ? addItem(state.inventory, { kind: 'fuel', qty: t.obj.fuel }) : 0; t.obj = null; state.pipeRev = (state.pipeRev || 0) + 1; state.lineRev = (state.lineRev || 0) + 1; return { ok: true, msg: spilt ? `${spilt} ${spilt === 1 ? 'can' : 'cans'} of fuel spilt: no pocket for it` : '', float: 'Picked up' }; }
    // the belt sits over pipe and line, so the hoe lifts it first
    if (t.belt) { if (t.load?.length) return fail('Empty it first'); if (!hasRoom(state.inventory, { kind: 'belt', qty: 1 })) return fail('No pocket free'); if (!spend(state, E.clear)) return fail('Too tired'); addItem(state.inventory, { kind: 'belt', qty: 1 }); t.belt = false; t.load = null; state.beltRev = (state.beltRev || 0) + 1; return { ok: true, msg: '', float: 'Belt up' }; }
    // under a bed they stay put: flatten the bed first, then the hoe lifts them
    if (t.pipe && !t.tilled) { if (!hasRoom(state.inventory, { kind: 'pipe', qty: 1 })) return fail('No pocket free'); if (!spend(state, E.clear)) return fail('Too tired'); addItem(state.inventory, { kind: 'pipe', qty: 1 }); t.pipe = false; state.pipeRev = (state.pipeRev || 0) + 1; return { ok: true, msg: '', float: 'Pipe up' }; }
    if (t.line && !t.tilled) { if (!hasRoom(state.inventory, { kind: 'line', qty: 1 })) return fail('No pocket free'); if (!spend(state, E.clear)) return fail('Too tired'); addItem(state.inventory, { kind: 'line', qty: 1 }); t.line = false; state.lineRev = (state.lineRev || 0) + 1; return { ok: true, msg: '', float: 'Line up' }; }
    if (t.track) return fail('The track stays a track');
    if (!isOwnedFarmland(state.world, x, y)) return fail(t.t === 'grass' ? 'Not your land' : '');
    if (t.tilled) { if (!spend(state, E.clear)) return fail('Too tired'); const fert = !!t.fert; t.tilled = false; t.fert = null; t.spray = false; return { ok: true, msg: fert ? 'Soil flattened: the fertiliser is lost' : t.pipe || t.line ? 'Flattened: the hoe lifts what ran under it next' : '', float: 'Flattened' }; }
    if (!spend(state, hoeEnergy(state))) return fail('Too tired');
    t.tilled = true; t.moisture = t.moisture || 0; today(state).hoed++; return { ok: true, msg: '' };
  }
  if (item.kind === 'tool' && item.tool === 'can') {
    if (state.can.water <= 0) return fail('The can is empty. Fill it at the well.');
    const beds = canTiles(state, x, y).map(([tx, ty]) => tileAt(state.world, tx, ty)).filter(tt => tt && tt.tilled);
    if (!beds.length) return fail(t.tilled ? '' : 'Only tilled soil takes water');
    if (!spend(state, E.water)) return fail('Too tired');   // energy first: no pour, no wet bed, no water lost
    for (const tt of beds) tt.moisture = Math.min(100, (tt.moisture || 0) + CONFIG.soil.waterPerPour);   // a second pour can waterlog: the hoe turns it
    state.can.water--;
    return { ok: true, msg: '' };
  }
  if (item.kind === 'seed') {
    if (t.crop && !t.crop.dead && t.crop.growth >= 100) return harvest(state, t, x, y);
    if (!t.tilled || t.crop) return fail(t.crop ? '' : 'Till the soil first');
    if (!spend(state, E.plant)) return fail('Too tired');
    removeFromSlot(state.inventory, slotIndex, 1);
    t.crop = { speciesId: item.species, growth: 0, health: 100, ripeAt: null, dead: false, plantedAt: state.minutes, harvests: 0, v: (x * 7 + y * 13 + Math.floor(state.minutes)) % 4 };   // v: where the seed landed in the bed
    today(state).planted++;
    return { ok: true, msg: '' };
  }
  if (item.kind === 'fert') {
    if (!t.tilled) return fail('Fertiliser goes on tilled soil');
    if (t.fert) return fail('Already fertilised');
    if (t.crop?.dead) return fail('Clear the withered plant first');
    removeFromSlot(state.inventory, slotIndex, 1);
    t.fert = item.fert;
    return { ok: true, msg: '', float: item.fert.name };
  }
  if (item.kind === 'sprinkler') {
    if (!isOwnedFarmland(state.world, x, y) || t.track || t.crop || t.obj) return fail(t?.crop ? 'A plant grows there' : 'Set it on your own land');
    if (!spend(state, E.place)) return fail('Too tired');
    removeFromSlot(state.inventory, slotIndex, 1);
    t.tilled = false; t.fert = null; t.obj = { kind: 'sprinkler', level: item.level || 0 }; state.pipeRev = (state.pipeRev || 0) + 1;
    return { ok: true, msg: !pipeLinked(state, x, y) ? 'Dry: it needs pipe under it that reaches the well' : sprinklerFed(state, x, y) ? '' : `No pressure: ${headAt(state, x, y)} ${headAt(state, x, y) === 1 ? 'tile' : 'tiles'} of flow ${headAt(state, x, y) === 1 ? 'reaches' : 'reach'} here, it drinks ${sprinklerTier(t.obj).draw}. A pump nearer the well adds more`, float: 'Set' };
  }
  if (item.kind === 'pump') {
    if (!t.pipe || t.obj) return fail(t.obj ? 'Something stands there' : 'A pump sits on a pipe');
    if (!spend(state, E.place)) return fail('Too tired');
    removeFromSlot(state.inventory, slotIndex, 1);
    t.obj = { kind: 'pump', level: item.level || 0 }; if (pumpTier(t.obj).hand) t.obj.workedDay = dayOf(state); state.pipeRev = (state.pipeRev || 0) + 1;   // setting a hand pump primes it for the day
    return { ok: true, msg: !pipeLinked(state, x, y) ? 'Dry: this pipe has no line back to the well' : !pipeFed(state, x, y) ? 'Dry: the flow runs out before here. Stand it nearer the well' : '', float: 'Set' };
  }
  if (item.kind === 'generator') {
    if (!isOwnedFarmland(state.world, x, y) || t.track || t.crop || t.obj) return fail(t?.crop ? 'A plant grows there' : t?.obj ? 'Something stands there' : 'Set it on your own land');
    if (!spend(state, E.place)) return fail('Too tired');
    removeFromSlot(state.inventory, slotIndex, 1);
    t.tilled = false; t.fert = null; t.obj = { kind: 'generator' }; state.lineRev = (state.lineRev || 0) + 1;
    return { ok: true, msg: generatorLive(state, x, y) ? '' : 'Lay line from it: pickers and hoppers stand on the line', float: 'Set' };
  }
  if (item.kind === 'chest') {   // a field chest still in a pocket (older deliveries): set it on open grass anywhere that is yours, yard or farm
    if (!isCleared(state.world, x, y) || t.t !== 'grass' || t.track || t.tilled || t.crop || t.obj) return fail(t?.crop ? 'A plant grows there' : t?.obj ? 'Something stands there' : t?.tilled ? 'Flatten the bed first' : 'Set it on open grass');
    if (!spend(state, E.place)) return fail('Too tired');
    removeFromSlot(state.inventory, slotIndex, 1);
    t.obj = { kind: 'chest', slots: new Array(CONFIG.chest.field.slots).fill(null) };
    return { ok: true, msg: '', float: 'Set' };
  }
  if (item.kind === 'line') {   // on open ground, or under a bed
    if (!isCleared(state.world, x, y) || t.t !== 'grass' || t.track) return fail('Line goes on clear ground');
    if (t.line) return fail('Line is already laid here');
    if (!spend(state, E.place)) return fail('Too tired');
    removeFromSlot(state.inventory, slotIndex, 1);
    t.line = true; state.lineRev = (state.lineRev || 0) + 1;
    return { ok: true, msg: '', float: (linePowered(state, x, y) ? 'Laid' : 'Laid (dead)') + (t.tilled ? ' under the bed' : '') };
  }
  if (item.kind === 'fuel') {
    if (!burnsFuel(t.obj)) return fail(t.obj?.kind === 'pump' ? 'It burns nothing' : 'Fuel goes into a generator or an engine');
    const room = CONFIG.fuel.tank - fuelOf(t.obj); if (room <= 0) return fail('The tank is full');
    const n = Math.min(room, item.qty); removeFromSlot(state.inventory, slotIndex, n);
    t.obj.fuel = fuelOf(t.obj) + n; state.pipeRev = (state.pipeRev || 0) + 1; state.lineRev = (state.lineRev || 0) + 1;
    return { ok: true, msg: '', float: `+${n} fuel`, fuel: t.obj.fuel };
  }
  if (item.kind === 'belt') {
    if (!isCleared(state.world, x, y) || t.t !== 'grass' || t.track) return fail('Belt goes on clear ground');
    if (t.tilled || t.crop) return fail(t.crop ? 'A plant grows there' : 'Not through a bed: flatten it first');
    if (t.obj) return fail('Something stands there');
    if (t.belt) return fail('Belt is already laid here');
    if (!spend(state, E.place)) return fail('Too tired');
    removeFromSlot(state.inventory, slotIndex, 1);
    t.belt = true; t.load = []; state.beltRev = (state.beltRev || 0) + 1;
    return { ok: true, msg: '', float: beltRunning(state, x, y) ? 'Laid' : 'Laid (still)' };
  }
  if (item.kind === 'picker' || item.kind === 'hopper') {
    if (!t.line || t.obj) return fail(t.obj ? 'Something stands there' : `A ${item.kind} stands on the power line`);
    if (t.belt) return fail('Not on the belt: beside it');
    if (!spend(state, E.place)) return fail('Too tired');
    removeFromSlot(state.inventory, slotIndex, 1);
    t.obj = { kind: item.kind, held: [] }; state.lineRev = (state.lineRev || 0) + 1;
    const beltBy = N4.some(([dx, dy]) => tileAt(state.world, x + dx, y + dy)?.belt);
    return { ok: true, msg: machinePowered(state, x, y) ? beltBy ? '' : item.kind === 'picker' ? 'Lay belt beside it to a hopper, or empty it by hand' : 'Run belt to it from the pickers' : linePowered(state, x, y) ? 'No power: the generator runs all it can' : 'Dead: no generator on this line', float: 'Set' };
  }
  if (item.kind === 'pipe') {   // on open ground, or under a bed: the bed stays a bed
    if (!isCleared(state.world, x, y) || t.t !== 'grass' || t.track) return fail('Pipe goes on clear ground');
    if (t.pipe) return fail('Pipe is already laid here');
    if (!spend(state, E.place)) return fail('Too tired');
    removeFromSlot(state.inventory, slotIndex, 1);
    t.pipe = true; state.pipeRev = (state.pipeRev || 0) + 1;
    return { ok: true, msg: '', float: (pipeFed(state, x, y) ? `Laid (${headAt(state, x, y)})` : 'Laid (dry)') + (t.tilled ? ' under the bed' : '') };
  }
  return harvestOrInspect(state, t, x, y);
}
function harvestOrInspect(state, t, x, y) {
  if (t.crop && !t.crop.dead && t.crop.growth >= 100) return harvest(state, t, x, y);
  return fail('');
}

// Turn a waterlogged bed with the hoe: lets the water out, nothing else changes.
export function drainSoil(state, x, y) {
  const t = tileAt(state.world, x, y);
  if (!t?.tilled) return fail('Only a bed can be turned');
  if (moistureOf(t) <= CONFIG.soil.soggyAbove) return fail('Not waterlogged');
  if (!spend(state, hoeEnergy(state))) return fail('Too tired');
  t.moisture = Math.max(0, moistureOf(t) - CONFIG.weather.drainPerTurn);
  return { ok: true, msg: '', float: 'Drained' };
}
// What a ripe plant gives: fruits by the count gene, fertiliser yield and stars, less when it has started to rot.
export function harvestYield(state, t, x, y) {
  const c = t.crop, sp = state.species[c.speciesId];
  const r = makeRng(state.seed ^ hashString(`${x},${y},${state.minutes},${state.stats.harvests}`));
  const f = t.fert?.stats || {};
  const g = sp.genome;
  let count = g.count;
  if (f.yield) { count += Math.floor(f.yield * 3); if (r.chance((f.yield * 3) % 1)) count++; }
  const q = f.quality ? Math.min(3, Math.floor(f.quality * 4) + (r.chance((f.quality * 4) % 1) ? 1 : 0)) : 0;
  const rot = rotFactor(state, c);
  if (rot < 0.5) count = Math.max(1, Math.round(count * rot * 2));
  return { kind: 'crop', species: sp.id, q, qty: count };
}
// After the fruit is taken: a regrowing plant drops back, anything else is gone. The harvest spends the fertiliser
// either way: one bag, one harvest, so a regrowing bed wants a fresh bag each time.
function clearReaped(t, g) { if (g.regrow) { t.crop.growth = CONFIG.crop.regrowResetTo; t.crop.ripeAt = null; } else t.crop = null; t.fert = null; }
export function harvest(state, t, x, y) {
  const c = t.crop, sp = state.species[c.speciesId];
  if (!spend(state, CONFIG.energy.harvest)) return fail('Too tired');
  today(state).harvested++;
  const produce = harvestYield(state, t, x, y), count = produce.qty;
  const leftP = addItem(state.inventory, produce);
  if (leftP === count && count) { state.energy += CONFIG.energy.harvest; return fail('Bag is full'); }
  state.stats.harvests++;
  c.harvests++;
  clearReaped(t, sp.genome);
  const got = count - leftP;
  return { ok: true, msg: '', float: `+${got} ${sp.name}`, species: sp.id, count: got };
}

// ---------- carrying objects ----------
export const objectPos = (state, key) => state.objects?.[key] || BUILDINGS[key] || null;
export function pickUp(state, key) {
  if (state.carrying) return fail('Hands full');
  if (!MOVABLE.includes(key)) return fail('');
  if (key === 'seedrack' && state.seedRack.trays.some(t => t.item)) return fail('Take what is on the trays first');
  if (key === 'bench' && (state.breeder.running || state.breeder.a || state.breeder.b)) return fail('Empty the bench first');
  if (key === 'compost' && (state.compost.inputs.length || state.compost.running || state.compost.ready)) return fail('Empty the bin first');
  const pos = objectPos(state, key), t = pos && tileAt(state.world, pos.x, pos.y);
  if (t) t.t = 'grass';
  state.carrying = key;
  return { ok: true, msg: '' };
}
// A field chest is lifted with what is in it and carried like the bench; it goes back down with placeObject.
export function pickUpChest(state, x, y) {
  if (state.carrying) return fail('Hands full');
  const t = tileAt(state.world, x, y); if (!isChest(t)) return fail('');
  if (!inReach(state, x, y)) return fail('Too far');
  state.carriedChest = t.obj; t.obj = null; state.carrying = 'chest';
  return { ok: true, msg: '' };
}
export function canPlaceAt(state, x, y) {
  const t = tileAt(state.world, x, y);
  if (!t || t.t !== 'grass' || t.tilled || t.crop || t.obj || t.track || !isCleared(state.world, x, y)) return false;
  const p = state.player; if (Math.floor(p.x) === x && Math.floor(p.y) === y) return false;
  return inReach(state, x, y);
}
export function placeObject(state, x, y) {
  const key = state.carrying; if (!key) return fail('Nothing to place');
  if (!canPlaceAt(state, x, y)) return fail('Not here');
  if (key === 'chest') { tileAt(state.world, x, y).obj = state.carriedChest || { kind: 'chest', slots: new Array(CONFIG.chest.field.slots).fill(null) }; state.carriedChest = null; state.carrying = null; return { ok: true, msg: '' }; }
  if (key === 'chest') { tileAt(state.world, x, y).obj = state.carriedChest || { kind: 'chest', slots: new Array(CONFIG.chest.field.slots).fill(null) }; state.carriedChest = null; state.carrying = null; return { ok: true, msg: '' }; }
  tileAt(state.world, x, y).t = key;
  state.objects[key] = { x, y };
  state.carrying = null;
  return { ok: true, msg: '' };
}

// ---------- seed rack ----------
// Seeds come from produce left to dry on the rack (seed saving), never from harvesting directly.
// The time cost of a species, for the cards. What one bed earns per game day if it is replanted as soon as it ripens:
// harvests a day = the day's growing time (full speed by day, nightGrowth at night) over the ripening time, where a
// regrowing plant drops back to regrowResetTo after each pick so its later cycles are shorter. Water: pours a day to
// keep a bed in the growing range on an average day, from daytime evaporation, the night's drying and what the plant drinks.
export function bedRatePerDay(state, sp) {
  const g = sp.genome, cycle = growRealMinutes(g) * (g.regrow ? 1 - CONFIG.crop.regrowResetTo / 100 : 1);
  const dayMinutes = CONFIG.time.dayRealSeconds / 60, nightHours = 24 - (20 - CONFIG.time.wakeHour);
  const growingDay = dayMinutes * ((24 - nightHours) + nightHours * CONFIG.crop.nightGrowth) / 24;
  return salePrice(state, { species: sp.id }) * g.count * growingDay / Math.max(0.1, cycle);
}
export function poursPerDay(g) {
  const S0 = CONFIG.soil, W = CONFIG.weather, dayHours = 20 - CONFIG.time.wakeHour;
  const evap = S0.evaporationPerHour * (W.evapBase - 0.45 * W.evapSpan) * dayHours;   // a middling day's humidity
  const drink = S0.uptakePerHour * g.thirst * 0.65 * 24;
  const shift = S0.thirstShift * (0.5 - g.thirst);                                 // low-thirst plants read the bed wetter: one less pour's worth over the day
  return Math.max(0.5, Math.round((evap + S0.nightDry + drink - shift) / S0.waterPerPour * 2) / 2);
}
export const seedsFromProduce = sp => sp.sterile ? 0 : Math.max(CONFIG.seedRack.minSeeds, Math.round(sp.genome.count * CONFIG.seedRack.seedsPerFruit));
// The range a produce can dry into (shown before the seeds are counted), and how long it takes.
export function seedRange(sp) {
  if (sp.sterile) return [0, 0];
  const R = CONFIG.seedRack, mid = sp.genome.count * R.seedsPerFruit;
  return [Math.max(R.minSeeds, Math.round(mid * (1 - R.seedVariance))), Math.max(R.minSeeds, Math.round(mid * (1 + R.seedVariance)))];
}
export const dryHoursFor = sp => CONFIG.seedRack.dryHours * (0.7 + sp.genome.size * 0.6) * (0.8 + sp.genome.thirst * 0.4);
export const trayReady = (state, t) => !!t.item && state.minutes >= t.readyAt;
export const seedRackReady = state => state.seedRack.trays.some(t => trayReady(state, t));
export const activeTray = state => state.seedRack.trays.find(t => t.item) || null;     // the one drawn on the rack
export const trayProgress = (state, t) => { const total = Math.max(1, t.readyAt - (t.startedAt ?? t.readyAt - CONFIG.seedRack.dryHours * 60)); return Math.max(0, Math.min(1, 1 - Math.max(0, t.readyAt - state.minutes) / total)); };
export function putOnSeedRack(state, slotIndex, trayIndex = -1) {
  const trays = state.seedRack.trays, it = state.inventory.slots[slotIndex];
  const ti = trayIndex >= 0 ? trayIndex : trays.findIndex(t => !t.item);
  if (ti < 0 || !trays[ti]) { if (!seedRackReady(state)) today(state).trayBusy++; return fail(seedRackReady(state) ? 'Take the seeds first' : 'Every tray is busy'); }
  const R = trays[ti];
  if (R.item) return fail(trayReady(state, R) ? 'Take the seeds first' : 'That tray is busy');
  if (!it || it.kind !== 'crop') return fail('Only produce dries into seeds');
  const sp = state.species[it.species];
  if (sp.sterile) return fail(`${sp.name} is sterile: its seeds are dead`);
  removeFromSlot(state.inventory, slotIndex, 1);
  const [lo, hi] = seedRange(sp), r = makeRng(state.seed ^ hashString(`dry${state.minutes}:${sp.id}:${ti}`));
  R.item = { species: it.species, q: it.q || 0, seeds: r.int(lo, hi) };   // rolled now, revealed when dry
  R.readyAt = state.minutes + dryHoursFor(sp) * 60; R.startedAt = state.minutes;
  return { ok: true, msg: '', float: `${sp.name} drying`, species: sp.id };
}
// Take the seeds from every finished tray.
export function takeSeeds(state) {
  const ready = state.seedRack.trays.filter(t => trayReady(state, t));
  if (!ready.length) return fail(state.seedRack.trays.some(t => t.item) ? 'Still drying' : 'Nothing on the rack');
  let got = 0, names = new Set();
  for (const R of ready) {
    const sp = state.species[R.item.species], n = R.item.seeds ?? seedsFromProduce(sp);
    const left = addItem(state.inventory, { kind: 'seed', species: sp.id, qty: n });
    if (left === n) return got ? { ok: true, msg: 'Bag is full', float: `+${got} seeds`, seeds: got } : fail('Bag is full');
    got += n - left; names.add(sp.name);
    if (left) { R.item.seeds = left; return { ok: true, msg: 'Bag is full', float: `+${got} seeds`, seeds: got }; }
    R.item = null; R.readyAt = null; R.startedAt = null;
  }
  return { ok: true, msg: '', float: `+${got} ${names.size === 1 ? [...names][0] + ' ' : ''}seeds`, seeds: got };
}

// ---------- sprinklers ----------
export const isSprinkler = t => t?.obj?.kind === 'sprinkler';
export const sprinklerTier = obj => CONFIG.sprinkler.tiers[obj?.level || 0];
export const isPipe = t => !!t?.pipe;
// The pipe network: which pipe tiles have an unbroken line back to the well, and how far down the line each one is.
// Walked from the well's four neighbours, cached until a section, sprinkler or pump is laid or picked up (state.pipeRev).
const FED = new WeakMap();
export function pipeNet(state) {
  const w = state.world, rev = state.pipeRev || 0, hit = FED.get(state);
  if (hit && hit.rev === rev && hit.w === w) return hit;
  const set = new Set(), dist = new Map(), idx = (x, y) => y * w.w + x, queue = [];
  const W = BUILDINGS.well;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const t = tileAt(w, W.x + dx, W.y + dy); if (t?.pipe) { const i = idx(W.x + dx, W.y + dy); set.add(i); dist.set(i, 1); queue.push([W.x + dx, W.y + dy]); } }
  while (queue.length) { const [x, y] = queue.shift(), d = dist.get(idx(x, y)); for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { const nx = x + dx, ny = y + dy, t = tileAt(w, nx, ny); if (t?.pipe && !set.has(idx(nx, ny))) { set.add(idx(nx, ny)); dist.set(idx(nx, ny), d + 1); queue.push([nx, ny]); } } }
  const net = { rev, w, set, dist, pressure: null, pressureH: null }; FED.set(state, net);
  return net;
}
// linked: an unbroken pipe back to the well. fed: the flow actually reaches it (head above 0).
export const pipeLinked = (state, x, y) => !!tileAt(state.world, x, y)?.pipe && pipeNet(state).set.has(y * state.world.w + x);
export const fedPipes = state => pressure(state).wet;
export const pipeFed = (state, x, y) => !!tileAt(state.world, x, y)?.pipe && pressure(state).wet.has(y * state.world.w + x);
export const headAt = (state, x, y) => pressure(state).head.get(y * state.world.w + x) || 0;
// Pumps: pressure for the line. The well pushes water to `wellFeeds` sprinklers on its own; each running pump on fed
// pipe adds its tier's `feeds`. The windmill stands still in calm air; the engine always runs (and burns fuel at night).
export const isPump = t => t?.obj?.kind === 'pump';
export const pumpTier = obj => CONFIG.pump.tiers[obj?.level || 0];
// turning: fuelled and in wind; whether it is in the flow is pressure()'s business
export function pumpRunning(state, t) { if (!isPump(t)) return false; const tier = pumpTier(t.obj); if (tier.fuelPerDay && !fuelOf(t.obj)) return false; return pumpWorked(state, t.obj); }
// A hand pump needs a hand: worked once a day (workPump) it runs till the night; the other pumps need no one.
export const pumpWorked = (state, obj) => !pumpTier(obj).hand || (obj.workedDay || 0) >= dayOf(state);
export function workPump(state, x, y) {
  const t = tileAt(state.world, x, y); if (!isPump(t) || !pumpTier(t.obj).hand) return fail('');
  if (pumpWorked(state, t.obj)) return fail('Worked today: it pumps till you sleep');
  if (!inReach(state, x, y)) return fail('Too far');
  if (!spend(state, CONFIG.energy.pump)) return fail('Too tired');
  t.obj.workedDay = dayOf(state); state.pipeRev = (state.pipeRev || 0) + 1;
  return { ok: true, msg: pipeFed(state, x, y) ? '' : 'Worked, but the flow does not reach it: it adds nothing here', float: 'Pumping' };
}
// A windmill in calm air (humidity under its stillBelow) turns slowly: calmHead instead of head.
export const pumpCalm = (state, obj) => { const tier = pumpTier(obj); return tier.stillBelow != null && humidityOf(state) < tier.stillBelow; };
export const pumpHead = (state, obj) => pumpCalm(state, obj) ? pumpTier(obj).calmHead : pumpTier(obj).head;
// Fuel: generators and engines hold cans of it and burn one a night while they run; empty, they stop.
export const burnsFuel = obj => obj?.kind === 'generator' || (obj?.kind === 'pump' && !!pumpTier(obj).fuelPerDay);
export const fuelOf = obj => obj?.fuel || 0;
export function pumpTiles(state) { const w = state.world, out = []; for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) { const t = w.tiles[y * w.w + x]; if (isPump(t)) out.push({ x, y, t }); } return out; }
// What the line can run and which sprinklers get it: the nearest to the well first, by pipe distance. Cached with the
// network; recomputed when the day's humidity changes (the windmill).
// The flow: walked from the well outward in order of pipe distance. Each tile gets its head (the tiles of flow
// arriving), a sprinkler on it runs if the head covers its draw and drinks that much, a turning pump standing in the
// flow adds its tier's head, and what is left goes on: one tile costs 1, and a split shares it equally (floor).
// Two runs that rejoin add their shares. Cached with the pipe network; redone when the air changes (windmills).
export function pressure(state) {
  const net = pipeNet(state), h = humidityOf(state);
  if (net.pressure && net.pressureH === h) return net.pressure;
  const w = state.world, idx = (x, y) => y * w.w + x, head = new Map(), on = new Set(), wet = new Set(), pumpsOn = new Set();
  let pumps = 0, running = 0, fed = 0;
  const order = [...net.set].sort((a, b) => net.dist.get(a) - net.dist.get(b));
  const next = i => { const x = i % w.w, y = (i - x) / w.w, d = net.dist.get(i), out = []; for (const [dx, dy] of N4) { const k = idx(x + dx, y + dy); if (net.dist.get(k) === d + 1) out.push(k); } return out; };
  // What has to arrive at a tile for everything beyond it to run: its sprinkler's draw, a tile for the step on, and the
  // needs of every branch it feeds; a pump there pays for part of that, but something must still reach it to turn it.
  const need = new Map();
  const needOf = i => { if (need.has(i)) return need.get(i); const t = w.tiles[i], out = next(i); let n = isSprinkler(t) ? sprinklerTier(t.obj).draw : 0; if (out.length) n += 1 + out.reduce((a, k) => a + needOf(k), 0); if (isPump(t) && pumpRunning(state, t)) n = Math.max(1, n - pumpHead(state, t.obj)); need.set(i, n); return n; };
  const give = (k, v) => { if (v > 0) head.set(k, (head.get(k) || 0) + v); };
  const exits = order.filter(i => net.dist.get(i) === 1);
  for (const i of exits) head.set(i, Math.floor(CONFIG.pump.wellHead / exits.length));
  for (const i of order) {
    const t = w.tiles[i], hIn = head.get(i) || 0; let r = hIn;
    if (hIn > 0) wet.add(i);
    if (isSprinkler(t)) { fed++; const d = sprinklerTier(t.obj).draw; if (hIn >= d) { on.add(i); r -= d; } }
    if (isPump(t)) { pumps++; if (hIn > 0 && pumpRunning(state, t)) { running++; pumpsOn.add(i); r += pumpHead(state, t.obj); } }
    const out = next(i); if (!out.length || r <= 1) continue;
    if (out.length === 1) { give(out[0], r - 1); continue; }
    // a split: each branch gets what it asks for, the smallest asker first so a stub never starves a long run; what no
    // branch asked for is shared evenly, the odd tile going to the branch that asked for most
    const kids = out.map(k => [k, needOf(k)]).sort((a, b) => a[1] - b[1]); let left = r - 1;
    const got = kids.map(([, n], j) => { const v = Math.min(n, Math.floor(left / (kids.length - j))); left -= v; return v; });
    const each = Math.floor(left / kids.length); left -= each * kids.length;
    kids.forEach(([k], j) => give(k, got[j] + each + (j === kids.length - 1 ? left : 0)));
  }
  net.pressure = { head, on, wet, fed, pumps, running, pumpsOn }; net.pressureH = h;
  return net.pressure;
}
// a pump that adds to the flow: turning, and standing where the flow reaches
export const pumpInFlow = (state, x, y) => pressure(state).pumpsOn.has(y * state.world.w + x);
// a sprinkler that runs: on fed pipe, and within the line's pressure
export const sprinklerFed = (state, x, y) => isSprinkler(tileAt(state.world, x, y)) && pressure(state).on.has(y * state.world.w + x);
export function sprinklerTiles(state) { const w = state.world, out = []; for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) if (isSprinkler(w.tiles[y * w.w + x])) out.push({ x, y }); return out; }
// true when a RUNNING sprinkler (on fed pipe) reaches this tile
export function sprinklerCovers(state, x, y) { for (const { x: sx, y: sy } of sprinklerTiles(state)) { const R = sprinklerTier(tileAt(state.world, sx, sy).obj).radius; if (Math.abs(sx - x) <= R && Math.abs(sy - y) <= R && sprinklerFed(state, sx, sy)) return true; } return false; }
// placed, in pockets, in the chest: what you own (the catalogue prices the next one from it)
export function sprinklerCount(state) { const held = inv => inv.slots.reduce((n, it) => n + (it?.kind === 'sprinkler' ? it.qty : 0), 0); return sprinklerTiles(state).length + held(state.inventory) + held(state.chest); }
export const waterBill = pours => Math.round(pours * CONFIG.sprinkler.pricePerPour * 100) / 100;
// One pass: a bed in reach that dries below the band is sprayed from then on, a pour's worth of water spread over
// sprayMinutes, until it is a pour above the band (a bed with a withered plant is left alone). Called every tick with
// the tick's minutes, so the soil darkens gradually and the meter counts the water, not the pours.
export function sprinklerPass(state, dtMinutes = CONFIG.sprinkler.sprayMinutes) {
  const h = hourOf(state); if (h < CONFIG.time.wakeHour || h >= 20) return 0;
  const w = state.world, S0 = CONFIG.soil, rate = S0.waterPerPour / CONFIG.sprinkler.sprayMinutes * dtMinutes, topTo = Math.min(S0.idealMax, S0.idealMin + S0.waterPerPour);
  let water = 0;
  for (const { x, y } of sprinklerTiles(state)) {
    if (!sprinklerFed(state, x, y)) continue;   // dry (no line to the well) or the flow runs out before it
    const R = sprinklerTier(tileAt(w, x, y).obj).radius;
    let sprayed = false;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const t = tileAt(w, x + dx, y + dy);
      if (!t?.tilled || t.crop?.dead) continue;
      const m = moistureOf(t);
      if (!t.spray && m < S0.idealMin) t.spray = true;   // dropped out of the band: the sprinkler turns to it
      if (!t.spray) continue;
      const add = Math.min(rate, topTo - m);
      if (add > 0) { t.moisture = m + add; water += add; sprayed = true; }
      if (moistureOf(t) >= topTo - 1e-9) t.spray = false;
    }
    if (sprayed) tileAt(w, x, y).obj.sprayUntil = state.minutes + Math.max(3, dtMinutes * 2);
  }
  const pours = water / S0.waterPerPour;
  state.water = state.water || { pours: 0 }; state.water.pours += pours;
  return pours;
}

// ---------- power ----------
const N4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
export const isGenerator = t => t?.obj?.kind === 'generator';
export const isChest = t => t?.obj?.kind === 'chest';
export function chestTiles(state) { const w = state.world, out = []; for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) { const t = w.tiles[y * w.w + x]; if (isChest(t)) out.push({ x, y, t }); } return out; }
export const isMachine = t => t?.obj?.kind === 'picker' || t?.obj?.kind === 'hopper';
export const heldCount = held => (held || []).reduce((n, it) => n + it.qty, 0);
function addHeld(held, it) { const key = `${it.species}:${it.q || 0}`; const have = held.find(h => `${h.species}:${h.q || 0}` === key); if (have) have.qty += it.qty; else held.push({ species: it.species, q: it.q || 0, qty: it.qty }); }
export function generatorTiles(state) { const w = state.world, out = []; for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) { const t = w.tiles[y * w.w + x]; if (isGenerator(t)) out.push({ x, y, t }); } return out; }
export function machineTiles(state, kind = null) { const w = state.world, out = []; for (let y = 0; y < w.h; y++) for (let x = 0; x < w.w; x++) { const t = w.tiles[y * w.w + x]; if (isMachine(t) && (!kind || t.obj.kind === kind)) out.push({ x, y, t }); } return out; }
// The line network: connected runs of power line, each powered by the generators standing on or beside it (their
// `power` adds up, off ones give nothing), machines on it nearest the generators first by line distance. Cached until a section, a generator
// or a machine is laid or picked up (state.lineRev).
const POW = new WeakMap();
export function lineNet(state) {
  const w = state.world, rev = state.lineRev || 0, hit = POW.get(state);
  if (hit && hit.rev === rev && hit.w === w) return hit;
  const idx = (x, y) => y * w.w + x, comp = new Map(); let nComp = 0;
  for (let i = 0; i < w.tiles.length; i++) {
    if (!w.tiles[i].line || comp.has(i)) continue;
    const c = nComp++; comp.set(i, c); const q = [i];
    while (q.length) { const j = q.pop(), x = j % w.w, y = (j - x) / w.w; for (const [dx, dy] of N4) { const t = tileAt(w, x + dx, y + dy); if (t?.line && !comp.has(idx(x + dx, y + dy))) { comp.set(idx(x + dx, y + dy), c); q.push(idx(x + dx, y + dy)); } } }
  }
  const cap = new Array(nComp).fill(0), dist = new Map(), queue = [];
  for (const { x, y, t } of generatorTiles(state)) {
    if (t.obj.off || !fuelOf(t.obj)) continue;   // switched off or out of fuel: no power
    const seen = new Set();
    for (const [dx, dy] of [[0, 0], ...N4]) { const t = tileAt(w, x + dx, y + dy), k = idx(x + dx, y + dy); if (!t?.line) continue; const c = comp.get(k); if (!seen.has(c)) { seen.add(c); cap[c] += CONFIG.power.generator.power; } if (!dist.has(k)) { dist.set(k, 1); queue.push(k); } }
  }
  while (queue.length) { const j = queue.shift(), x = j % w.w, y = (j - x) / w.w, d = dist.get(j); for (const [dx, dy] of N4) { const t = tileAt(w, x + dx, y + dy), k = idx(x + dx, y + dy); if (t?.line && !dist.has(k)) { dist.set(k, d + 1); queue.push(k); } } }
  const used = new Array(nComp).fill(0), on = new Set();
  const machines = machineTiles(state).filter(({ x, y, t }) => t.line && dist.has(idx(x, y))).sort((a, b) => dist.get(idx(a.x, a.y)) - dist.get(idx(b.x, b.y)));
  for (const { x, y, t } of machines) { const c = comp.get(idx(x, y)), d = CONFIG.power[t.obj.kind].power; if (used[c] + d <= cap[c]) { used[c] += d; on.add(idx(x, y)); } }
  const net = { rev, w, comp, dist, cap, used, on }; POW.set(state, net);
  return net;
}
export const linePowered = (state, x, y) => !!tileAt(state.world, x, y)?.line && lineNet(state).dist.has(y * state.world.w + x);
export const machinePowered = (state, x, y) => lineNet(state).on.has(y * state.world.w + x);
export const generatorLive = (state, x, y) => { const o = tileAt(state.world, x, y)?.obj; return !!o && !o.off && fuelOf(o) > 0 && [[0, 0], ...N4].some(([dx, dy]) => tileAt(state.world, x + dx, y + dy)?.line); };
// The switch on a generator: off, it makes no power and burns no fuel.
export function toggleGenerator(state, x, y) {
  const t = tileAt(state.world, x, y); if (!isGenerator(t)) return fail('');
  t.obj.off = !t.obj.off; state.lineRev = (state.lineRev || 0) + 1;
  return { ok: true, msg: '', float: t.obj.off ? 'Off' : 'On', off: t.obj.off };
}
// A hopper beside the crate (any of the eight tiles around it) tips into it when the cart comes.
export const hopperByCrate = (x, y) => Math.abs(x - BUILDINGS.crate.x) <= 1 && Math.abs(y - BUILDINGS.crate.y) <= 1;
const ripeBedNear = (state, x, y, R) => { let best = null; for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const t = tileAt(state.world, x + dx, y + dy); if (t?.crop && !t.crop.dead && t.crop.growth >= 100 && (!best || (t.crop.ripeAt ?? 0) < (best.t.crop.ripeAt ?? 0))) best = { t, x: x + dx, y: y + dy }; } return best; };
// Move crops from one pile to another, as much as fits under `cap`. Returns how many moved.
function pour(from, to, cap) { let n = 0; while (from.length && heldCount(to) < cap) { const it = from[0], take = Math.min(cap - heldCount(to), it.qty); addHeld(to, { ...it, qty: take }); it.qty -= take; n += take; if (!it.qty) from.shift(); } return n; }
// The belt network: every belt tile that runs, with its distance along the belt to the nearest powered hopper (a
// hopper's motor drives the belt that reaches it, so belt with no live hopper at its end stands still). Cached until
// belt is laid or picked up (state.beltRev) or the power changes (state.lineRev).
const BELTS = new WeakMap();
export function beltNet(state) {
  const w = state.world, rev = `${state.beltRev || 0}:${state.lineRev || 0}`, hit = BELTS.get(state);
  if (hit && hit.rev === rev && hit.w === w) return hit;
  const idx = (x, y) => y * w.w + x, net = lineNet(state), dist = new Map(), queue = [];
  for (const { x, y } of machineTiles(state, 'hopper')) { if (!net.on.has(idx(x, y))) continue; for (const [dx, dy] of N4) { const t = tileAt(w, x + dx, y + dy), k = idx(x + dx, y + dy); if (t?.belt && !dist.has(k)) { dist.set(k, 1); queue.push(k); } } }
  while (queue.length) { const j = queue.shift(), x = j % w.w, y = (j - x) / w.w, d = dist.get(j); for (const [dx, dy] of N4) { const t = tileAt(w, x + dx, y + dy), k = idx(x + dx, y + dy); if (t?.belt && !dist.has(k)) { dist.set(k, d + 1); queue.push(k); } } }
  const out = { rev, w, dist }; BELTS.set(state, out);
  return out;
}
export const beltRunning = (state, x, y) => !!tileAt(state.world, x, y)?.belt && beltNet(state).dist.has(y * state.world.w + x);
// Which way a running belt tile carries: the neighbour one step nearer the hopper (0 up, 1 right, 2 down, 3 left), or
// the powered hopper itself at the end of the run; -1 when it stands still.
export function beltDir(state, x, y) {
  const w = state.world, net = beltNet(state), d = net.dist.get(y * w.w + x); if (d == null) return -1;
  for (let i = 0; i < 4; i++) { const [dx, dy] = N4[i], t = tileAt(w, x + dx, y + dy), k = (y + dy) * w.w + x + dx; if (d === 1 ? (t?.obj?.kind === 'hopper' && lineNet(state).on.has(k)) : net.dist.get(k) === d - 1) return i; }
  return -1;
}
// One step of every belt: crops on the last tile tip into the hopper, every other tile hands its crops one tile on
// toward it (as much as the next tile holds, so a full hopper backs the belt up), then each powered picker drops its
// basket on the running belt beside it. Nearest the hopper moves first, so a crop moves one tile a step.
export function beltStep(state) {
  const w = state.world, B = CONFIG.power.belt, net = beltNet(state), pw = lineNet(state), idx = (x, y) => y * w.w + x;
  const tiles = [...net.dist.entries()].sort((a, b) => a[1] - b[1]);
  for (const [k, d] of tiles) {
    const x = k % w.w, y = (k - x) / w.w, t = w.tiles[k]; if (!t.load?.length) continue;
    for (const [dx, dy] of N4) {
      const n = tileAt(w, x + dx, y + dy), nk = idx(x + dx, y + dy); if (!n) continue;
      if (d === 1 && n.obj?.kind === 'hopper' && pw.on.has(nk)) pour(t.load, n.obj.held = n.obj.held || [], CONFIG.power.hopper.holds);
      else if (n.belt && net.dist.get(nk) === d - 1) pour(t.load, n.load = n.load || [], B.holds);
      if (!t.load.length) break;
    }
  }
  for (const { x, y, t } of machineTiles(state, 'picker')) {
    if (!pw.on.has(idx(x, y)) || !t.obj.held?.length) continue;
    const by = N4.map(([dx, dy]) => ({ t: tileAt(w, x + dx, y + dy), k: idx(x + dx, y + dy) })).filter(o => o.t?.belt && net.dist.has(o.k)).sort((a, b) => net.dist.get(a.k) - net.dist.get(b.k));
    for (const o of by) { pour(t.obj.held, o.t.load = o.t.load || [], B.holds); if (!t.obj.held.length) break; }
  }
}
// Once a game hour while you are awake: each powered picker takes a ripe crop (the one waiting longest) from the beds
// in its reach into its basket and drops the basket on the belt beside it. Returns crops picked.
export function machinePass(state) {
  const P = CONFIG.power.picker, net = lineNet(state), idx = (x, y) => y * state.world.w + x; let picked = 0;
  for (const { x, y, t } of machineTiles(state, 'picker')) {
    if (!net.on.has(idx(x, y))) continue;
    const held = t.obj.held = t.obj.held || [];
    for (let n = 0; n < P.perHour && heldCount(held) < P.holds; n++) {
      const bed = ripeBedNear(state, x, y, P.radius); if (!bed) break;
      const g = state.species[bed.t.crop.speciesId]?.genome; if (!g) { bed.t.crop = null; continue; }
      const produce = harvestYield(state, bed.t, bed.x, bed.y);
      addHeld(held, produce); state.stats.harvests++; bed.t.crop.harvests++; clearReaped(bed.t, g); picked += produce.qty;
    }
  }
  if (picked) { const D = today(state); D.picked = (D.picked || 0) + picked; }
  beltStep(state);   // the baskets go straight onto the belt
  return picked;
}
// The hoppers tip into the crate, as much as fits; the rest waits for the next cart.
export function drainHoppers(state) {
  let moved = 0;
  for (const { x, y, t } of machineTiles(state, 'hopper')) {
    if (!hopperByCrate(x, y)) continue;   // a hopper elsewhere is a store you empty by hand
    const held = t.obj.held || [];
    while (held.length) {
      const room = state.crate.capacity - crateCount(state); if (room <= 0) return moved;
      const it = held[0], take = Math.min(room, it.qty), key = `${it.species}:${it.q || 0}`;
      const have = state.crate.items.find(c => `${c.species}:${c.q || 0}` === key);
      if (have) have.qty += take; else state.crate.items.push({ species: it.species, q: it.q || 0, qty: take });
      it.qty -= take; moved += take; if (!it.qty) held.shift();
    }
  }
  return moved;
}
// Empty hands on a picker, a hopper or a belt tile: what it holds into your pockets, as much as fits.
export const heldOn = t => isMachine(t) ? t.obj.held : t?.belt ? t.load : null;
export function takeHeld(state, x, y) {
  const t = tileAt(state.world, x, y), held = heldOn(t); if (!held?.length) return fail('Nothing in it');
  let taken = 0;
  while (held.length) { const it = held[0], left = addItem(state.inventory, { kind: 'crop', species: it.species, q: it.q || 0, qty: it.qty }); taken += it.qty - left; if (left) { it.qty = left; break; } held.shift(); }
  if (!taken) return fail('Your pockets are full');
  return { ok: true, msg: '', float: `+${taken} ${taken === 1 ? 'crop' : 'crops'}`, taken };
}

// ---------- sleep ----------
export function sleep(state, opts = {}) {
  const report = { day: dayOf(state) + 1, forced: !!opts.forced, rain: false, breeder: null, compost: null, lines: [] };
  const r = makeRng(state.seed ^ hashString('night' + dayOf(state)));
  // jump to wakeHour of the next day (or of today if it's already past midnight)
  const fedAtBed = Math.min(state.hunger ?? 100, state.thirst ?? 100) / 100;
  const h = hourOf(state);
  const dayStart = (dayOf(state) - 1) * MIN_PER_DAY;
  const wakeAt = (h < CONFIG.time.wakeHour ? dayStart : dayStart + MIN_PER_DAY) + CONFIG.time.wakeHour * 60;
  // the compost bin: the lid shuts at bedtime and a heap of enough plants has rotted down by morning
  const cp = state.compost, heap = compostCount(state); let composting = false;
  if (!cp.running && !cp.ready && heap >= CONFIG.fertiliser.compostMinInputs) { startCompost(state, wakeAt); composting = true; }
  for (let left = wakeAt - state.minutes; left > 0;) { const step = Math.min(30, left); state.minutes += step; tick(state, step, { asleep: true }); left -= step; }
  state.minutes = wakeAt;
  report.day = dayOf(state);
  // how well you slept: fed and watered → full energy; starving or parched → down to wakeFloor of it
  const fed = fedAtBed, F = CONFIG.needs.wakeFloor;
  const rested = Math.round(state.energyMax * (F + (1 - F) * fed));
  state.energy = opts.forced ? Math.round(rested * 0.6) : rested;
  const pct = Math.round(state.energy / state.energyMax * 100), need = (state.hunger ?? 100) <= (state.thirst ?? 100) ? 'hungry' : 'thirsty';
  report.night = opts.forced && fed < 0.5 ? `You passed out at 2am, ${need}, and woke groggy with ${pct}% energy. Eat and drink before bed.`
    : opts.forced ? `You passed out at 2am and woke groggy with ${pct}% energy.`
    : fed < 0.5 ? `You slept ${need} and woke with ${pct}% energy. Eat and drink before bed.` : `You slept well. ${pct}% energy.`;
  if (opts.forced || fed < 0.5) report.lines.push(report.night);
  const w = state.world;
  report.rain = r.chance(CONFIG.economy.rainChance);
  state.rainToday = report.rain;
  { const [lo, hi] = report.rain ? CONFIG.weather.humidityRain : CONFIG.weather.humidityRange; state.humidity = Math.round(r.range(lo, hi)); report.humidity = state.humidity; }
  for (const t of w.tiles) if (t.tilled) t.moisture = report.rain ? Math.max(t.moisture || 0, CONFIG.soil.rainMoisture) : Math.max(0, (t.moisture || 0) - CONFIG.soil.nightDry);
  state.bird.today = 0;
  // close the day's ledger: field facts at bedtime, then the sale
  const L = ledger(state), D = L.today;
  D.tilled = w.tiles.filter(t => t.tilled).length; D.emptyBeds = w.tiles.filter(t => t.tilled && !t.crop).length; D.owned = w.chunks.length * CONFIG.world.chunk * CONFIG.world.chunk;
  report.sale = collectCrate(state);
  D.sale += report.sale?.total || 0; D.sold += report.sale?.count || 0; D.day = dayOf(state) - 1;   // the midday pickup already counted its share
  { const pours = state.water?.pours || 0, bill = waterBill(pours);   // the water bill: the sprinklers' metered water in pours, taken out of the night's money
    if (bill) { state.money = Math.max(0, Math.round((state.money - bill) * 100) / 100); report.water = { pours: Math.max(1, Math.round(pours)), bill }; D.waterBill = bill; }
    state.water = { pours: 0 }; }
  { let cans = 0, dry = 0;   // engines on fed pipe and generators that are switched on burn a can each; one that runs out stops
    const burn = (obj, n) => { if (!fuelOf(obj)) { dry++; return; } obj.fuel = Math.max(0, obj.fuel - n); cans += n; if (!obj.fuel) dry++; };
    for (const { x, y, t } of pumpTiles(state)) if (pumpTier(t.obj).fuelPerDay && pipeFed(state, x, y)) burn(t.obj, pumpTier(t.obj).fuelPerDay);
    for (const { t } of generatorTiles(state)) if (!t.obj.off) burn(t.obj, CONFIG.power.generator.fuelPerDay);
    if (cans || dry) { report.fuel = { cans, dry }; D.fuelCans = cans; state.pipeRev = (state.pipeRev || 0) + 1; state.lineRev = (state.lineRev || 0) + 1; } }
  if (state.loan) {   // the bank adds the night's interest to what you owe; it takes nothing
    const Lo = state.loan, add = Math.round(Lo.owed * CONFIG.loan.nightly * 100) / 100;
    Lo.owed = Math.round((Lo.owed + add) * 100) / 100; D.loanInterest = add;
    report.loan = { interest: add, owed: Lo.owed };
  }
  report.yesterday = D; report.dayBefore = L.yesterday; report.picked = D.picked || 0;
  L.history.push(D); if (L.history.length > 7) L.history.shift();
  L.yesterday = D; L.today = freshDay();
  report.delivery = deliverOrders(state);
  for (const l of report.delivery.lines) report.lines.push(l);
  if (report.sale) report.lines.push(`The cart took ${report.sale.count} ${report.sale.count === 1 ? 'crop' : 'crops'} from the crate: +${formatMoney(report.sale.total)}.`);
  if (report.rain) report.lines.push('It rained overnight: every field is watered.');
  if (report.water) report.lines.push(`Water bill: ${report.water.pours} sprinkler pours, −${formatMoney(report.water.bill)}.`);
  if (report.fuel?.cans) report.lines.push(`Fuel: ${report.fuel.cans} ${report.fuel.cans === 1 ? 'can' : 'cans'} burned.`);
  if (report.fuel?.dry) report.lines.push(`${report.fuel.dry === 1 ? 'A machine is' : report.fuel.dry + ' machines are'} out of fuel: pour a can in.`);
  if (report.picked) report.lines.push(`The pickers took ${report.picked} crops.`);
  if (report.loan) report.lines.push(`The bank added ${formatMoney(report.loan.interest)} interest: ${formatMoney(report.loan.owed)} owed. Pay back at the delivery sign.`);
  // breeder
  if (state.breeder.running) { report.breeder = resolveBreed(state); }
  if (composting && cp.ready) report.compost = `${cp.ready.name} ×${cp.readyCount || 1}`;
  else if (heap && !cp.running && !cp.ready) report.lines.push(`The compost bin holds ${heap}; it needs ${CONFIG.fertiliser.compostMinInputs} to start.`);
  { const n = pumpTiles(state).filter(p => pumpTier(p.t.obj).hand).length; if (n) report.handPumps = n; }   // they stop at midnight: the morning says so
  state.stats.days++;
  state.morning = report;
  return report;
}

// ---------- land ----------
function pay(state, cost) { if (cost == null || state.money < cost) return false; state.money -= cost; return true; }
// Claim a plot with a deed the cart delivered (paid for when ordered).
export function claimLand(state, cx, cy) {
  if (!(state.deeds > 0)) return fail('No deed to claim with');
  if (!chunkInRange(cx, cy) || ownsChunk(state.world, cx, cy)) return fail('Cannot claim that');
  if (!buyableChunks(state.world).some(c => c.cx === cx && c.cy === cy)) return fail('Must touch land you own');
  state.deeds--; state.world.chunks.push(chunkKey(cx, cy));
  return { ok: true, msg: 'Plot claimed: the trees come down' };
}

// ---------- chest ----------
export function moveSlot(state, from, fi, to, ti) {
  const a = from.slots[fi], b = to.slots[ti];
  if (!a) return;
  if (b && itemKey(a) === itemKey(b) && a.kind !== 'tool') { const take = Math.min(CONFIG.inventory.stack - b.qty, a.qty); b.qty += take; a.qty -= take; if (!a.qty) from.slots[fi] = null; return; }
  from.slots[fi] = b; to.slots[ti] = a;
}
export function quickMove(state, from, fi, to) { const it = from.slots[fi]; if (!it || it.kind === 'tool') return; const left = addItem(to, it); from.slots[fi] = left ? { ...it, qty: left } : null; }
// Move n of a stack (default one) from one inventory to the other; tools stay where they are.
export function moveSome(state, from, fi, to, n = 1) {
  const it = from.slots[fi]; if (!it) return fail('');
  if (it.kind === 'tool') return fail('Tools hang on the rack');
  const take = Math.min(n, it.qty), left = addItem(to, { ...it, qty: take });
  const moved = take - left; if (!moved) return fail(to === state.inventory ? 'Your pockets are full' : 'The chest is full');
  removeFromSlot(from, fi, moved);
  return { ok: true, msg: '', moved };
}
// Click a chest holding something: the whole stack goes in (the chest by the porch unless another is given).
export function stash(state, slotIndex, to = state.chest) {
  const it = state.inventory.slots[slotIndex]; if (!it) return fail('');
  const name = it.kind === 'seed' ? `${state.species[it.species]?.name || '?'} seeds` : it.kind === 'crop' ? state.species[it.species]?.name || 'crop' : it.kind;
  const r = moveSome(state, state.inventory, slotIndex, to, Infinity);
  if (!r.ok) return r;
  return { ok: true, msg: '', float: `${r.moved} ${name} stored`, moved: r.moved };
}

// ---------- breeder ----------
// Pick a parent from an inventory slot holding a crop or seed; consumes one.
export function setBreederParent(state, which, slotIndex) {
  const it = state.inventory.slots[slotIndex];
  if (!it || (it.kind !== 'crop' && it.kind !== 'seed')) return fail('Needs a crop or a seed');
  if (state.breeder.running) return fail('Breeder is busy');
  const cur = state.breeder[which];
  if (cur) addItem(state.inventory, cur);
  state.breeder[which] = { kind: it.kind, species: it.species, q: it.q || 0, qty: 1 };
  removeFromSlot(state.inventory, slotIndex, 1);
  return { ok: true };
}
export function clearBreederParent(state, which) { const cur = state.breeder[which]; if (cur) { addItem(state.inventory, cur); state.breeder[which] = null; } }
// What the bench says before you commit: the instability of this pairing (the roll itself stays hidden).
export function breedPreview(state) {
  const b = state.breeder; if (!b.a || !b.b) return null;
  const A = state.species[b.a.species], B = state.species[b.b.species];
  const seed = hashString(`${A.id}|${B.id}|${state.seed}|${state.stats.breeds}|${dayOf(state)}`);
  const res = cross(A.genome, B.genome, seed);
  return { instability: res.instability, crossFamily: res.crossFamily, cost: breedCost(state, A, B), sterile: A.sterile || B.sterile };
}
export function startBreed(state, mutationBonus = 1) {
  const b = state.breeder;
  if (b.running) return fail('Already breeding');
  if (!b.a || !b.b) return fail('Needs two parents');
  const A = state.species[b.a.species], B = state.species[b.b.species];
  if (A.sterile || B.sterile) return fail('Sterile plants cannot breed');
  const cost = breedCost(state, A, B);
  if (!pay(state, cost)) return fail(`Needs $${cost}`);
  const seed = hashString(`${A.id}|${B.id}|${state.seed}|${state.stats.breeds}|${dayOf(state)}`);
  b.running = { a: A.id, b: B.id, seed, mutationBonus, startedDay: dayOf(state) };
  b.a = null; b.b = null;
  state.stats.breeds++;
  return { ok: true, msg: 'Breeding… results in the morning' };
}
export function resolveBreed(state) {
  const run = state.breeder.running; if (!run) return null;
  const A = state.species[run.a], B = state.species[run.b];
  const res = cross(A.genome, B.genome, run.seed, { mutationBonus: run.mutationBonus });
  const out = { outcome: res.outcome, instability: res.instability, mutations: res.mutations, parents: [A.name, B.name], species: null, seeds: 0, isNew: false };
  const r = makeRng(run.seed ^ 0x9e3779b9);
  if (res.outcome === 'success' || res.outcome === 'sterile') {
    const sterile = res.outcome === 'sterile';
    let sp = makeSpecies(res.child, { sterile, parents: [A.id, B.id], discoveredDay: dayOf(state), name: blendName(A.name, B.name) }); sp.blended = true;
    if (sterile) sp = { ...sp, id: sp.id + '_s', name: sp.name + ' (sterile)' };
    if (!state.species[sp.id]) {
      // unique names: add a variant word when the plain name is taken
      const names = new Set(Object.values(state.species).map(s => s.name));
      if (names.has(sp.name)) sp.name = `${variantWord(sp.genome)} ${sp.name}`;
      state.species[sp.id] = sp;
      if (!sterile) { state.discovered.push(sp.id); state.stats.discoveries++; out.isNew = true; }
    }
    const [lo, hi] = CONFIG.genetics.breederSeedsOnSuccess;
    out.seeds = sterile ? 1 : r.int(lo, hi);
    out.species = sp.id;
  } else if (res.outcome === 'revert') {
    out.species = A.id; out.seeds = 2;
  }
  state.breeder.running = null;
  state.breeder.lastResult = out;
  // the seeds wait on the bench until you go and take them
  state.breeder.result = out.seeds ? { species: out.species, seeds: out.seeds, outcome: out.outcome } : null;
  return out;
}
export function takeBreedResult(state) {
  const r = state.breeder.result; if (!r) return fail('Nothing on the bench');
  const left = addItem(state.inventory, { kind: 'seed', species: r.species, qty: r.seeds });
  if (left === r.seeds) return fail('Your pockets are full');
  const got = r.seeds - left; if (left) r.seeds = left; else state.breeder.result = null;
  return { ok: true, msg: '', float: `+${got} ${state.species[r.species]?.name || ''} seeds`, seeds: got };
}

// ---------- compost ----------
// The bin is filled by hand, one plant at a time (crops or the withered plants the hoe clears). The lid shuts when you
// sleep; by morning the heap is fertiliser, one bag per three plants, its stats drawn from what went in.
export const COMPOSTABLE = ['crop', 'withered', 'pulled'];
export const compostCount = state => state.compost.inputs.reduce((s, i) => s + i.qty, 0);
export const compostBags = n => Math.max(1, Math.round(n / 3));
export const compostLevel = state => state.compost.ready ? 2 : state.compost.running || state.compost.inputs.length ? 1 : 0;   // for the sprite
export const compostPreview = state => state.compost.inputs.length ? makeCompost(state.compost.inputs, state.species) : null;
export function canCompost(state) {
  const cp = state.compost;
  if (cp.ready) return fail('Take the compost out first');
  if (cp.running) return fail('The lid is shut until morning');
  if (compostCount(state) >= CONFIG.fertiliser.compostMax) return fail('The bin is full');
  return { ok: true };
}
export function addToCompost(state, slotIndex, n = 1) {
  const it = state.inventory.slots[slotIndex];
  if (!it || !COMPOSTABLE.includes(it.kind)) return fail('Only crops and pulled or withered plants rot down');
  const chk = canCompost(state); if (!chk.ok) return chk;
  const room = CONFIG.fertiliser.compostMax - compostCount(state);
  const take = removeFromSlot(state.inventory, slotIndex, Math.min(n, room));
  const species = it.kind === 'crop' ? it.species : null, q = it.q || 0;
  const have = state.compost.inputs.find(i => i.species === species && (i.q || 0) === q);
  if (have) have.qty += take.qty; else state.compost.inputs.push({ species, q, qty: take.qty });
  const name = species ? state.species[species]?.name || 'crop' : it.kind === 'pulled' ? 'plant' : 'withered plant';
  return { ok: true, msg: '', float: `+${take.qty} ${name}`, added: take.qty, full: compostCount(state) >= CONFIG.fertiliser.compostMax };
}
// Take one plant back out of the heap (before the lid shuts).
export function takeFromCompost(state, index) {
  const cp = state.compost, inp = cp.inputs[index]; if (!inp) return fail('');
  if (cp.running || cp.ready) return fail('The lid is shut');
  const item = inp.species ? { kind: 'crop', species: inp.species, q: inp.q || 0, qty: 1 } : { kind: 'withered', qty: 1 };
  if (addItem(state.inventory, item)) return fail('Your pockets are full');
  inp.qty--; if (inp.qty <= 0) cp.inputs.splice(index, 1);
  return { ok: true, msg: '' };
}
export function startCompost(state, readyAt = null) {
  const cp = state.compost, n = compostCount(state);
  if (cp.running || cp.ready) return fail('The bin is busy');
  if (n < CONFIG.fertiliser.compostMinInputs) return fail(`Needs at least ${CONFIG.fertiliser.compostMinInputs} plants`);
  const fert = makeCompost(cp.inputs, state.species);
  cp.running = { readyAt: readyAt ?? state.minutes + CONFIG.fertiliser.compostHours * 60, fert, count: compostBags(n) };
  cp.inputs = [];
  if (!state.fertBook.some(f => f.id === fert.id)) state.fertBook.push({ ...fert, firstDay: dayOf(state) });
  return { ok: true, msg: `Composting ${n} plants` };
}
export function takeCompost(state) {
  const cp = state.compost; if (!cp.ready) return fail('Nothing ready');
  const n = Math.max(1, cp.readyCount || 1), left = addItem(state.inventory, { kind: 'fert', fert: cp.ready, qty: n });
  if (left === n) return fail('Your pockets are full');
  const got = n - left; if (left) cp.readyCount = left; else { cp.ready = null; cp.readyCount = 0; }
  return { ok: true, msg: '', float: `+${got} ${cp.ready ? cp.ready.name : ''}`.trim(), taken: got };
}
export { salePrice, breedCost, seedBookBonus, countItem, removeByKey, addItem, buyableChunks, chunkOrigin };
