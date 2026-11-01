// The cart catalogue: the only shop. You order at the delivery sign and pay now; the cart brings it overnight and the
// morning report lists what arrived. Each item removes one bottleneck and its price rises with each level.
import { CONFIG } from './config.js';
import { makeSpecies, WILD_BASES, WILD_NAMES } from './genetics.js';
import { makeRng, hashString } from './rng.js';
import { addItem } from './items.js';
import { formatMoney } from './economy.js';

const r2 = v => Math.round(v * 100) / 100;
// sprinklers you own: set on the land, in your pockets or in the chest (sim.js has the same count; this file cannot import sim)
const pumpCount = (state, lv) => { const held = inv => inv.slots.reduce((n, it) => n + (it?.kind === 'pump' && (it.level || 0) === lv ? it.qty : 0), 0); return state.world.tiles.filter(t => t.obj?.kind === 'pump' && (t.obj.level || 0) === lv).length + held(state.inventory) + held(state.chest); };
const sprinklerCount = (state, lv) => { const held = inv => inv.slots.reduce((n, it) => n + (it?.kind === 'sprinkler' && (it.level || 0) === lv ? it.qty : 0), 0); return state.world.tiles.filter(t => t.obj?.kind === 'sprinkler' && (t.obj.level || 0) === lv).length + held(state.inventory) + held(state.chest); };
const pendingCount = (state, id) => state.orders.filter(o => o.id === id).length;

export const CAN_LEVELS = [8, 14, 24];                 // pours per fill
export const CAN_PRICES = [40, 120];
export const TRAY_BASE = 25, TRAY_GROWTH = 1.6, TRAY_MAX = 4;
export const CRATE_BASE = 60, CRATE_GROWTH = 1.5, CRATE_MAX = 3, CRATE_STEP = 12;
export const BENCH_PRICE = 35;
export const GLASS_PRICE = 160;   // the bench's second glass: two pairs a night
export const HOE_PRICES = [30, 90];
export const PICKUP_PRICE = 150;
export const HANDS_PRICES = [45, 110];
export const COMPOST_PRICE = CONFIG.economy.compostBinCost;   // the compost bin: withered plants and spare crops → fertiliser              // quick hands: faster into the crate                     // the cart comes at noon as well as at night

// Seed packets: three basics a day, rotating with the date, so variety comes from the cart as well as from breeding.
// days until the seed packets change (1 = tomorrow)
export const seedRotationIn = state => CONFIG.catalogSeedDays - Math.floor(state.minutes / 1440) % CONFIG.catalogSeedDays;
export function seedOffers(state) {
  const keys = Object.keys(WILD_BASES), r = makeRng(state.seed ^ hashString('offers' + Math.floor(state.minutes / (1440 * CONFIG.catalogSeedDays))));
  const picks = []; while (picks.length < 3) { const k = r.pick(keys); if (!picks.includes(k)) picks.push(k); }
  return picks;
}
export function seedSpecies(state, key) {
  const sp = makeSpecies(WILD_BASES[key], { name: WILD_NAMES[key], shop: true, discoveredDay: null });
  if (!state.species[sp.id]) state.species[sp.id] = sp;
  return state.species[sp.id];
}

export function catalog(state) {
  const trays = state.seedRack.trays.length + pendingCount(state, 'tray');
  const canLvl = (state.can.level || 0) + pendingCount(state, 'can');
  const crates = (state.crate.extensions || 0) + pendingCount(state, 'crate');
  const hoeLvl = (state.hoe?.level || 0) + pendingCount(state, 'hoe'), hoeMax = CONFIG.hoe.seconds.length - 1;
  const handsLvl = (state.hands?.level || 0) + pendingCount(state, 'hands'), handsMax = CONFIG.hands.dropSeconds.length - 1;
  const items = [
    { id: 'pipe', group: 'Water', name: `Pipe ×${CONFIG.pipe.packSize}`, effect: `Lay it from the well, one tile a section, over open ground or under a bed; a tile costs 1 of the flow. Sprinklers and pumps stand on it`, level: '', price: CONFIG.pipe.packPrice, blocked: null },
    { id: 'hoe', group: 'Tools', name: 'Sharper hoe', effect: hoeLvl < hoeMax ? `${CONFIG.hoe.seconds[hoeLvl]}s → ${CONFIG.hoe.seconds[hoeLvl + 1]}s a bed, ${CONFIG.hoe.energy[hoeLvl + 1]} energy` : `${CONFIG.hoe.seconds[hoeLvl]}s a bed`, level: `${hoeLvl + 1} / ${hoeMax + 1}`,
      price: HOE_PRICES[hoeLvl] ?? 0, blocked: hoeLvl >= hoeMax ? 'Sharpest hoe' : null },
    { id: 'hands', group: 'Tools', name: 'Quick hands', effect: handsLvl < handsMax ? `${CONFIG.hands.dropSeconds[handsLvl]}s → ${CONFIG.hands.dropSeconds[handsLvl + 1]}s a crop into the crate` : `${CONFIG.hands.dropSeconds[handsLvl]}s a crop`, level: `${handsLvl + 1} / ${handsMax + 1}`,
      price: HANDS_PRICES[handsLvl] ?? 0, blocked: handsLvl >= handsMax ? 'Quickest hands' : null },
    { id: 'tray', group: 'Stations', name: 'Drying tray', effect: `Seed rack dries ${trays + 1} crops at once`, level: `${trays} / ${TRAY_MAX}`,
      price: r2(TRAY_BASE * Math.pow(TRAY_GROWTH, trays - 1)), blocked: trays >= TRAY_MAX ? 'All trays fitted' : null },
    { id: 'can', group: 'Tools', name: 'Bigger watering can', effect: canLvl < CAN_LEVELS.length - 1 ? `${CAN_LEVELS[canLvl]} → ${CAN_LEVELS[canLvl + 1]} pours per fill` : `${CAN_LEVELS[canLvl]} pours per fill`, level: `${canLvl + 1} / ${CAN_LEVELS.length}`,
      price: CAN_PRICES[canLvl] ?? 0, blocked: canLvl >= CAN_LEVELS.length - 1 ? 'Biggest can' : null },
    { id: 'crate', group: 'Stations', name: 'Crate extension', effect: `Crate holds ${state.crate.capacity + crates * CRATE_STEP - (state.crate.extensions || 0) * CRATE_STEP + CRATE_STEP} crops`, level: `${crates} / ${CRATE_MAX}`,
      price: r2(CRATE_BASE * Math.pow(CRATE_GROWTH, crates)), blocked: crates >= CRATE_MAX ? 'Fully extended' : null },
    { id: 'pickup', group: 'Stations', name: 'Midday pickup', effect: `The cart empties the crate at ${CONFIG.crate.middayHour === 12 ? 'noon' : CONFIG.crate.middayHour > 12 ? CONFIG.crate.middayHour - 12 + 'pm' : CONFIG.crate.middayHour + 'am'} as well as at night`, level: state.crate.pickups ? 'owned' : '',
      price: PICKUP_PRICE, blocked: state.crate.pickups || pendingCount(state, 'pickup') ? 'The cart already comes twice' : null },
    { id: 'deed', group: 'Land', name: 'Land deed', effect: 'Claim one 4×4 plot next to your land', level: `${state.world.chunks.length} plots`,
      price: Math.round(CONFIG.economy.landBase * Math.pow(CONFIG.economy.landGrowth, Math.max(0, state.world.chunks.length + (state.deeds || 0) + pendingCount(state, 'deed') - CONFIG.world.startChunks))), blocked: null },
  ];
  for (const [lv, tier] of CONFIG.sprinkler.tiers.entries()) {
    const id = lv ? 'sprinkler' + lv : 'sprinkler', owned = sprinklerCount(state, lv) + pendingCount(state, id), n = (2 * tier.radius + 1) ** 2 - 1;
    items.push({ id, group: 'Water', family: 'Sprinkler', tier: ['I', 'II', 'III'][lv], name: tier.name, effect: `Waters the ${n} beds around it · drinks ${tier.draw} of the flow · ${formatMoney(CONFIG.sprinkler.pricePerPour)} a pour`, level: owned ? `${owned} owned` : '', price: tier.price, blocked: null });
  }
  for (const [lv, tier] of CONFIG.pump.tiers.entries()) {
    const owned = pumpCount(state, lv) + pendingCount(state, 'pump' + lv);
    items.push({ id: 'pump' + lv, group: 'Water', family: 'Pump', tier: tier.name.replace(' pump', ''), name: tier.name, effect: `Adds ${tier.head} tiles of flow from where it stands${tier.stillBelow != null ? ` · only ${tier.calmHead} on a calm day` : tier.fuelPerDay ? ` · burns ${tier.fuelPerDay === 1 ? 'a can' : tier.fuelPerDay + ' cans'} of fuel a night` : ''}`, level: owned ? `${owned} owned` : '', price: tier.price, blocked: null });
  }
  { const PW = CONFIG.power, count = (kind) => { const held = inv => inv.slots.reduce((n, it) => n + (it?.kind === kind ? it.qty : 0), 0); return state.world.tiles.filter(t => t.obj?.kind === kind).length + held(state.inventory) + held(state.chest); };
    const owned = kind => { const n = count(kind) + pendingCount(state, kind); return n ? `${n} owned` : ''; };
    items.push({ id: 'generator', group: 'Power', name: 'Generator', effect: `Makes ${PW.generator.power} power for the line laid from it · burns ${PW.generator.fuelPerDay === 1 ? 'a can' : PW.generator.fuelPerDay + ' cans'} of fuel a night while on`, level: owned('generator'), price: PW.generator.price, blocked: null });
    items.push({ id: 'line', group: 'Power', name: `Power line ×${PW.line.packSize}`, effect: 'Wire on posts: carries power from a generator, one tile a section, over open ground or under a bed. Pickers and hoppers stand on it', level: '', price: PW.line.packPrice, blocked: null });
    items.push({ id: 'fuel', group: 'Power', name: `Fuel ×${CONFIG.fuel.packSize}`, effect: `A can runs a generator or an engine for a night · pour it in by hand, a tank holds ${CONFIG.fuel.tank}`, level: '', price: CONFIG.fuel.price * CONFIG.fuel.packSize, blocked: null });
    items.push({ id: 'belt', group: 'Power', name: `Belt ×${PW.belt.packSize}`, effect: `Carries crops from the pickers to a hopper, one tile a section · ${PW.belt.holds} crops a tile`, level: '', price: PW.belt.packPrice, blocked: null });
    items.push({ id: 'picker', group: 'Power', name: 'Picker', effect: `Takes ${PW.picker.perHour === 1 ? 'a ripe crop' : PW.picker.perHour + ' ripe crops'} an hour from the ${(2 * PW.picker.radius + 1) ** 2 - 1} beds around it, drops it on the belt beside it · ${PW.picker.power} power`, level: owned('picker'), price: PW.picker.price, blocked: null });
    CONFIG.chest.field.tiers.forEach((tier, lv) => items.push({ id: lv ? 'chest' + lv : 'chest', group: 'Stations', name: tier.name, effect: `Holds ${tier.slots} stacks. Carry it to where you want it, yard or farm; click it with something in hand to put the stack away, E opens it · hold on it to lift it, contents and all · belt can end at it`, level: '', price: tier.price, blocked: null }));
    { const T = CONFIG.truck, hasTruck = !!state.truck || pendingCount(state, 'truck') > 0 || state.parcels?.some(p => p.id === 'truck'), full = (state.crate.extensions || 0) >= CRATE_MAX;
      items.push({ id: 'truck', group: 'Stations', name: 'Delivery truck', effect: `A truck takes over from the cart: it empties every delivery crate on the farm along with the one by the porch, with one buyer's order across all of them. Then the catalogue sells delivery crates (${T.crateHolds} crops each) to set where your belts end`, level: hasTruck ? 'owned' : '', price: T.price, blocked: hasTruck ? 'You have it' : !full ? 'Extend the crate fully first' : null });
      items.push({ id: 'dcrate', group: 'Stations', name: 'Delivery crate', effect: `Holds ${T.crateHolds} crops. Set it on open grass: a hopper beside it tips in, belt can end at it, and the truck empties it at night`, level: owned('dcrate'), price: T.cratePrice, blocked: !state.truck ? 'Needs the truck' : null }); }
    items.push({ id: 'splitter', group: 'Power', name: 'Splitter', effect: 'Sits on a belt tile: each crop that arrives goes down a different way in turn, so two lines share one picker line', level: owned('splitter'), price: PW.splitter.price, blocked: null });
    items.push({ id: 'filter', group: 'Power', name: 'Filter', effect: 'Sits on a belt tile: dried goods go one way, everything else the other · click it to swap the sides', level: owned('filter'), price: PW.filter.price, blocked: null });
    items.push({ id: 'hopper', group: 'Power', name: 'Hopper', effect: `Drives the belt that runs to it, holds ${PW.hopper.holds} crops. Beside the crate it tips in when the cart comes · ${PW.hopper.power} power`, level: owned('hopper'), price: PW.hopper.price, blocked: null });
    items.push({ id: 'dryer', group: 'Power', name: 'Dryer', effect: `Dries crops ${PW.dryer.batch} at a time into dried goods: a sweet crop sells for up to ×${(CONFIG.dried.base + CONFIG.dried.sugar).toFixed(1)} dried, a bland one for less than fresh; thick skins take longer. Belt feeds it and carries what it dries away; or load it by hand · ${PW.dryer.power} power`, level: owned('dryer'), price: PW.dryer.price, blocked: null }); }
  for (const key of seedOffers(state)) {
    const sp = seedSpecies(state, key);
    items.push({ id: 'seeds:' + key, group: 'Seeds', name: `${sp.name} seeds ×3`, effect: roles(sp).join(' · '), level: '', price: r2(Math.max(1, sp.seedPrice * 3)), species: sp, blocked: null });
  }
  { const Lo = CONFIG.loan, earned = state.stats?.earned || 0;   // the bank
    if (state.loan) { const owed = state.loan.owed, tonight = r2(owed * Lo.nightly);
      for (const p of [...Lo.payments.filter(p => p < owed), 'all']) items.push({ id: 'repay:' + p, group: 'Bank', family: 'Pay back', tier: p === 'all' ? 'All' : '$' + p, name: p === 'all' ? `Pay off ${formatMoney(owed)}` : `Pay ${formatMoney(p)}`, effect: `${formatMoney(owed)} owed; tonight the bank adds ${formatMoney(tonight)} (${Math.round(Lo.nightly * 100)}% a night)`, level: '', price: p === 'all' ? owed : p, blocked: null }); }
    Lo.sizes.forEach((size, i) => {
      items.push({ id: 'loan:' + size, group: 'Bank', family: 'Borrow', tier: formatMoney(size), name: `Borrow ${formatMoney(size)}`, effect: `The money now; ${Math.round(Lo.nightly * 100)}% a night on what you still owe (${formatMoney(r2(size * Lo.nightly))} the first night). Pay back what you like, when you like`, level: '', price: 0, blocked: state.loan ? 'One loan at a time' : earned < Lo.gates[i] ? `The bank wants to see ${formatMoney(Lo.gates[i])} sold first` : null }); }); }
  const hasBench = !!state.hasBench || pendingCount(state, 'bench') > 0 || state.parcels?.some(p => p.id === 'bench');
  items.push({ id: 'bench', group: 'Stations', name: 'Breeding bench', effect: 'Cross two species into a new one overnight', level: hasBench ? 'owned' : '', price: BENCH_PRICE, blocked: hasBench ? 'You have one' : null });
  const hasCompost = !!state.hasCompost || pendingCount(state, 'compost') > 0 || state.parcels?.some(p => p.id === 'compost');
  items.push({ id: 'compost', group: 'Stations', name: 'Compost bin', effect: 'Rots withered plants and spare crops into fertiliser overnight', level: hasCompost ? 'owned' : '', price: COMPOST_PRICE, blocked: hasCompost ? 'You have one' : null });
  { const F = CONFIG.fertiliser, lvl = (state.compost?.level || 0) + pendingCount(state, 'bin'), max = F.compostTiers.length - 1, t = F.compostTiers[Math.min(max, lvl)], nx = F.compostTiers[Math.min(max, lvl + 1)];
    items.push({ id: 'bin', group: 'Stations', name: 'Bigger bin', effect: lvl < max ? `Holds ${t.max} → ${nx.max} plants, a bag from every ${nx.perBag} instead of ${t.perBag}` : `Holds ${t.max}, a bag from every ${t.perBag}`, level: `${lvl} / ${max}`, price: F.binPrices[lvl] ?? 0, blocked: !state.hasCompost ? 'Needs the compost bin' : lvl >= max ? 'Biggest bin' : null }); }
  { const glass = (state.breeder?.level || 0) + pendingCount(state, 'glass');
    items.push({ id: 'glass', group: 'Stations', name: 'Second glass', effect: 'The bench breeds two pairs a night: set the next pair while one is under the glass', level: glass ? 'owned' : '', price: GLASS_PRICE, blocked: !state.hasBench ? 'Needs the bench' : glass ? 'You have it' : null }); }
  for (const it of items) { it.why = null; it.afford = !it.blocked && state.money >= it.price; }   // no "yesterday:" lines: the player knows what they need
  return items;
}

// What yesterday says about this item: the bottleneck it would lift, measured from the ledger. Null when nothing to say.
const hourWord = h => { const hh = Math.floor(h), ampm = hh >= 12 ? 'pm' : 'am'; return `${((hh + 11) % 12) + 1}${ampm}`; };
export function whyLine(state, id) {
  const y = state.ledger?.yesterday; if (!y) return null;
  switch (id) {
    case 'hoe': return y.hoed ? `yesterday: ${y.hoed} ${y.hoed === 1 ? 'bed' : 'beds'} tilled, ${Math.round(y.hoed * CONFIG.hoe.seconds[state.hoe?.level || 0] * 10) / 10}s with the hoe` : null;
    case 'can': return y.fills ? `yesterday: ${y.fills} ${y.fills === 1 ? 'trip' : 'trips'} to the well` : null;
    case 'pickup': case 'crate': return y.crateFullAt != null ? `yesterday: crate full by ${hourWord(y.crateFullAt)}${y.crateRefused ? `, ${y.crateRefused} turned away` : ''}` : y.sold ? `yesterday: ${y.sold} of ${state.crate.capacity} sold, never full` : null;
    case 'tray': return y.trayBusy ? `yesterday: trays busy ${y.trayBusy} ${y.trayBusy === 1 ? 'time' : 'times'}` : y.emptyBeds ? `yesterday: ${y.emptyBeds} ${y.emptyBeds === 1 ? 'bed' : 'beds'} had no seed at bedtime` : null;
    case 'deed': return y.owned ? `yesterday: ${y.tilled} of ${y.owned} tiles tilled` : null;
    case 'bench': return null;
    default: return null;
  }
}
// The cheapest thing you cannot buy yet, and how far off it is; null when everything open is affordable.
export function nextTarget(state) {
  const open = catalog(state).filter(i => !i.blocked && !i.id.startsWith('seeds:') && !['pipe', 'line', 'belt', 'fuel'].includes(i.id) && !i.id.startsWith('loan:') && !i.id.startsWith('repay:')).sort((a, b) => a.price - b.price);   // consumables (seeds, pipe, line, belt, fuel) and the bank are never the target
  const miss = open.find(i => i.price > state.money);
  return miss ? { item: miss, gap: miss.price - state.money } : null;
}
// Which open items you can afford right now, as a key; the sign flags when this grows past what you last saw.
export const affordableKey = state => catalog(state).filter(i => i.afford && !i.id.startsWith('seeds:') && !i.id.startsWith('loan:') && !i.id.startsWith('repay:') && !['pipe', 'line', 'belt', 'fuel'].includes(i.id)).map(i => i.id).sort().join(',');
export function catalogueFlag(state) { const k = affordableKey(state); return k !== '' && k !== (state.catalogueSeen || ''); }
export function markCatalogueSeen(state) { state.catalogueSeen = affordableKey(state); }

// What a basic is good for, so the choice between packets means something.
export function roles(sp) {
  const g = sp.genome, out = [];
  const mins = g.growHours * CONFIG.time.dayRealSeconds / 24 / 60;
  out.push(mins <= 2 ? `fast (${Math.round(mins * 10) / 10} min)` : mins >= 8 ? `slow (${Math.round(mins)} min)` : `${Math.round(mins * 10) / 10} min`);
  if (g.regrow) out.push('regrows');
  if (g.count >= 4) out.push('seed-rich'); else if (g.count >= 3) out.push(`${g.count} fruits`);
  if (g.thirst <= 0.3) out.push('needs little water'); else if (g.thirst >= 0.7) out.push('thirsty');
  if (g.size >= 0.8) out.push('big fruit');
  if ((g.sugar ?? 0.4) >= 0.7) out.push('sweet: dries dear'); else if ((g.sugar ?? 0.4) <= 0.25) out.push('bland: sell it fresh');
  if ((g.skin ?? 0.5) <= 0.3) out.push('thin skin: dries fast'); else if ((g.skin ?? 0.5) >= 0.7) out.push('thick skin: slow to dry');
  if (sp.rarity >= 4) out.push('breeding stock: rare genes to cross from');
  if (g.family === 'flower') out.push('flower');
  return out;
}

export function placeOrder(state, id) {
  const item = catalog(state).find(i => i.id === id);
  if (!item) return { ok: false, msg: 'Not in the catalogue' };
  if (item.blocked) return { ok: false, msg: item.blocked };
  if (state.money < item.price && !id.startsWith('repay:')) return { ok: false, msg: 'Not enough money' };   // a payment short of the row's sum still pays what you have
  if (id.startsWith('loan:')) {   // the bank: the money at once, no parcel
    const size = +id.slice(5), Lo = CONFIG.loan;
    state.loan = { size, owed: size, day: Math.floor(state.minutes / 1440) }; state.money = r2(state.money + size);
    return { ok: true, msg: `Borrowed ${formatMoney(size)}. The bank adds ${Math.round(Lo.nightly * 100)}% a night to what you owe.`, loan: true };
  }
  if (id.startsWith('repay:')) {   // pay back what you like: the amount asked, the whole debt, or what you have
    const want = id.slice(6) === 'all' ? state.loan.owed : +id.slice(6), pay = r2(Math.min(want, state.loan.owed, state.money));
    if (pay <= 0) return { ok: false, msg: 'Nothing to pay with' };
    state.money = r2(state.money - pay); state.loan.owed = r2(state.loan.owed - pay);
    const done = state.loan.owed <= 0; if (done) state.loan = null;
    return { ok: true, msg: done ? 'The loan is paid off.' : `Paid ${formatMoney(pay)}: ${formatMoney(state.loan.owed)} still owed.`, loan: true, pay };
  }
  state.money -= item.price;
  state.orders.push({ id, name: item.name, price: item.price });
  return { ok: true, msg: `Ordered: ${item.name}. Arrives tonight.` };
}
export function cancelOrder(state, index) {
  const o = state.orders[index]; if (!o) return { ok: false, msg: '' };
  state.orders.splice(index, 1); state.money += o.price;
  return { ok: true, msg: `Cancelled ${o.name}` };
}
// The cart leaves the orders in the crate overnight as parcels. Returns report lines.
export function deliverOrders(state) {
  const n = state.orders.length;
  state.parcels = (state.parcels || []).concat(state.orders.map(o => ({ id: o.id, name: o.name })));
  state.orders = [];
  return { count: n, lines: n ? [`The cart left ${n === 1 ? 'a parcel' : n + ' parcels'} in the crate: ${state.parcels.map(p => p.name).join(', ')}.`] : [] };
}
// Open the parcels. Small upgrades apply on the spot; the bench and the compost bin are handed to you to carry and place.
export function collectParcels(state) {
  const lines = []; let bench = false, compost = false, chest = false;
  const keep = [];
  // a single machine lands in your pockets, else in the chest by the porch (and the line says so), else it waits in the parcel
  const land = (o, it, line) => { if (!addItem(state.inventory, it)) { lines.push(line); return true; } if (!addItem(state.chest, it)) { lines.push(`${o.name}: no pocket free, so it went in the chest by the porch`); return true; } keep.push(o); lines.push(`${o.name}: no room in your pockets or the chest, it waits here`); return false; };
  for (const o of state.parcels || []) {
    if (/^chest\d?$/.test(o.id)) { const lv = +o.id.slice(5) || 0, tier = CONFIG.chest.field.tiers[lv]; if (state.carrying) { keep.push(o); lines.push(`${tier.name}: put down what you carry first`); continue; } state.carrying = 'chest'; state.carriedChest = { kind: 'chest', level: lv, slots: new Array(tier.slots).fill(null) }; chest = true; lines.push(`${tier.name}: carry it and put it down`); }
    else
    if (o.id === 'tray') { state.seedRack.trays.push({ item: null, readyAt: null, startedAt: null }); lines.push(`Drying tray fitted: ${state.seedRack.trays.length} trays`); }
    else if (o.id === 'bin') { state.compost.level = Math.min(CONFIG.fertiliser.compostTiers.length - 1, (state.compost.level || 0) + 1); lines.push(`Bigger bin: holds ${CONFIG.fertiliser.compostTiers[state.compost.level].max}`); }
    else if (o.id === 'glass') { state.breeder.level = 1; lines.push('Second glass fitted: the bench breeds two pairs a night'); }
    else if (o.id === 'hoe') { state.hoe = state.hoe || { level: 0 }; state.hoe.level = Math.min(CONFIG.hoe.seconds.length - 1, state.hoe.level + 1); lines.push(`Sharper hoe: ${CONFIG.hoe.seconds[state.hoe.level]}s a bed`); }
    else if (o.id === 'can') { state.can.level = Math.min(CAN_LEVELS.length - 1, (state.can.level || 0) + 1); state.can.capacity = CAN_LEVELS[state.can.level]; lines.push(`Bigger can: ${state.can.capacity} pours`); }
    else if (o.id === 'crate') { state.crate.extensions = (state.crate.extensions || 0) + 1; state.crate.capacity += CRATE_STEP; lines.push(`Crate holds ${state.crate.capacity}`); }
    else if (o.id === 'hands') { state.hands = state.hands || { level: 0 }; state.hands.level = Math.min(CONFIG.hands.dropSeconds.length - 1, state.hands.level + 1); lines.push(`Quick hands: ${CONFIG.hands.dropSeconds[state.hands.level]}s a crop`); }
    else if (o.id === 'pipe') { const it = { kind: 'pipe', qty: CONFIG.pipe.packSize }; const left = addItem(state.inventory, it); if (left && addItem(state.chest, { ...it, qty: left })) { keep.push(o); lines.push('Pipe: no room in your pockets or the chest'); continue; } lines.push(`Pipe ×${CONFIG.pipe.packSize}: lay it from the well, the hoe picks it up`); }
    else if (o.id.startsWith('sprinkler')) { const it = { kind: 'sprinkler', level: +o.id.slice(9) || 0, qty: 1 }; if (!land(o, it, `${o.name}: set it on fed pipe, the hoe picks it up`)) continue; }
    else if (o.id.startsWith('pump')) { const it = { kind: 'pump', level: +o.id.slice(4) || 0, qty: 1 }; if (!land(o, it, `${o.name}: set it on the pipe, the hoe picks it up`)) continue; }
    else if (o.id === 'fuel') { const it = { kind: 'fuel', qty: CONFIG.fuel.packSize }; const left = addItem(state.inventory, it); if (left && addItem(state.chest, { ...it, qty: left })) { keep.push(o); lines.push('Fuel: no room in your pockets or the chest'); continue; } lines.push(`Fuel ×${CONFIG.fuel.packSize}: pour it into a generator or an engine`); }
    else if (o.id === 'belt') { const it = { kind: 'belt', qty: CONFIG.power.belt.packSize }; const left = addItem(state.inventory, it); if (left && addItem(state.chest, { ...it, qty: left })) { keep.push(o); lines.push('Belt: no room in your pockets or the chest'); continue; } lines.push(`Belt ×${CONFIG.power.belt.packSize}: lay it from the pickers to a hopper, the hoe picks it up`); }
    else if (o.id === 'line') { const it = { kind: 'line', qty: CONFIG.power.line.packSize }; const left = addItem(state.inventory, it); if (left && addItem(state.chest, { ...it, qty: left })) { keep.push(o); lines.push('Power line: no room in your pockets or the chest'); continue; } lines.push(`Power line ×${CONFIG.power.line.packSize}: lay it from the generator, the hoe picks it up`); }
    else if (o.id === 'splitter' || o.id === 'filter') { const it = { kind: o.id, qty: 1 }; if (!land(o, it, o.id === 'splitter' ? 'Splitter: set it on a belt tile with belt leading away on two sides' : 'Filter: set it on a belt tile with belt leading away on two sides; click it to swap')) continue; }
    else if (o.id === 'generator' || o.id === 'picker' || o.id === 'hopper' || o.id === 'dryer') { const it = { kind: o.id, qty: 1 }; if (!land(o, it, o.id === 'generator' ? 'Generator: set it on your land and lay line from it' : o.id === 'picker' ? 'Picker: set it on powered line by the beds it should work, with belt beside it' : o.id === 'dryer' ? 'Dryer: set it on powered line; belt in, belt out, or load it by hand' : 'Hopper: set it on powered line where the belt ends, beside the crate')) continue; }
    else if (o.id === 'pickup') { state.crate.pickups = 1; lines.push('Midday pickup: the cart now comes at noon too'); }
    else if (o.id === 'truck') { state.truck = true; lines.push('The truck: it empties every delivery crate on the farm. The catalogue sells the crates now'); }
    else if (o.id === 'dcrate') { const it = { kind: 'dcrate', qty: 1 }; if (!land(o, it, 'Delivery crate: set it on open grass where a belt or a hopper can reach it')) continue; }
    else if (o.id === 'deed') { state.deeds = (state.deeds || 0) + 1; lines.push('Land deed: claim a plot'); }
    else if (o.id.startsWith('seeds:')) { const sp = seedSpecies(state, o.id.slice(6)); const left = addItem(state.inventory, { kind: 'seed', species: sp.id, qty: 3 }); if (left === 3) { keep.push(o); lines.push(`${sp.name} seeds: hands full, left in the crate`); continue; } lines.push(`${sp.name} seeds ×${3 - left}`); if (!state.discovered.includes(sp.id)) state.discovered.push(sp.id); }
    else if (o.id === 'bench') { if (state.carrying) { keep.push(o); lines.push('Breeding bench: put down what you carry first'); continue; } state.hasBench = true; state.carrying = 'bench'; bench = true; lines.push('Breeding bench: carry it and put it down'); }
    else if (o.id === 'compost') { if (state.carrying) { keep.push(o); lines.push('Compost bin: put down what you carry first'); continue; } state.hasCompost = true; state.carrying = 'compost'; compost = true; lines.push('Compost bin: carry it and put it down'); }
  }
  state.parcels = keep;
  return { ok: lines.length > 0, lines, bench, compost, chest, msg: lines.length ? '' : 'Nothing to collect' };
}
