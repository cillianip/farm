// The market: a lane of stalls an hour's walk down the track. Your stall sells to the shoppers who pass while you stand
// there, at full price with no daily order and a tip on top; the other stalls sell seeds from elsewhere and hardware
// on the spot. Pure rules; sim.js ticks it and game.js draws it. Nothing here touches the farm's tiles.
import { CONFIG } from './config.js';
import { makeRng, hashString } from './rng.js';
import { addItem, removeFromSlot, hasRoom, makeInventory, itemKey } from './items.js';
import { salePrice } from './economy.js';
import { WILD_BASES, WILD_NAMES } from './genetics.js';
import { seedOffers, seedSpecies } from './catalog.js';

const MIN_PER_DAY = 1440;
const hourOf = s => (s.minutes % MIN_PER_DAY) / 60;
const dayOf = s => Math.floor(s.minutes / MIN_PER_DAY) + 1;
const fail = msg => ({ ok: false, msg });

// The lane, in tiles. Stalls stand above the lane, their counters on its upper edge; shoppers walk the lane's top row;
// you walk the lower rows. The home sign stands at the left end where the track arrives.
export const MARKET = {
  w: 22, h: 12, laneY: 6,                                    // lane rows laneY and laneY+1
  stalls: { seeds: { x: 4, key: 'seeds', name: 'Seed merchant' }, yours: { x: 10, key: 'yours', name: 'Your stall' }, hardware: { x: 16, key: 'hardware', name: 'Hardware' } },   // each two tiles wide, x is the left tile
  homeSign: { x: 1, y: 8 },
  start: { x: 11, y: 9.2 },
  bounds: { x0: 0.6, x1: 21.4, y0: 6.3, y1: 10.6 },        // where you can walk
};
export const FAMILIES = ['root', 'gourd', 'vine', 'grain', 'bush', 'flower'];
export const stallFront = key => ({ x: MARKET.stalls[key].x + 1, y: MARKET.laneY + 0.5 });   // where a shopper stands to buy

export function makeMarket() {
  return { at: false, counter: makeInventory(CONFIG.market.counterSlots), npcs: [], nextAt: null, count: 0, farmPos: null,
    today: { day: 0, sold: 0, money: 0, tips: 0, visitors: 0 }, lifetime: { sold: 0, money: 0, trips: 0 }, events: [] };
}
export function ensureMarket(state) { if (!state.market) state.market = makeMarket(); const m = state.market; m.events = m.events || []; m.lifetime = m.lifetime || { sold: 0, money: 0, trips: 0 }; return m; }
export const marketOpen = state => { const h = hourOf(state); return h >= CONFIG.market.open && h < CONFIG.market.close; };
export function walkable(x, y) { const b = MARKET.bounds; return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; }

// Leaving and arriving. sim.travel wraps these around the hour's walk.
export function depart(state, dest) {
  const m = ensureMarket(state);
  if (dest === 'market' && m.at) return fail('You are here');
  if (dest === 'farm' && !m.at) return fail('You are home');
  if (state.carrying) return fail('Put down what you carry first');
  if (dest === 'market' && hourOf(state) >= CONFIG.market.close - 1) return fail(`The market shuts at ${CONFIG.market.close - 12}pm: too late to go today`);
  if (dest === 'market') m.farmPos = { x: state.player.x, y: state.player.y, dir: state.player.dir };
  return { ok: true, msg: '' };
}
export function arrive(state, dest) {
  const m = ensureMarket(state);
  if (dest === 'market') { m.at = true; m.npcs = []; m.nextAt = null; m.lifetime.trips++; if (m.today.day !== dayOf(state)) m.today = { day: dayOf(state), sold: 0, money: 0, tips: 0, visitors: 0 }; state.player.x = MARKET.start.x; state.player.y = MARKET.start.y; state.player.dir = 'up'; }
  else { m.at = false; m.npcs = []; const p = m.farmPos; if (p) { state.player.x = p.x; state.player.y = p.y; state.player.dir = p.dir; } }
}

// The counter: a stack from your pockets goes on it whole; click it to take it back.
export function stock(state, slotIndex) {
  const m = ensureMarket(state), it = state.inventory.slots[slotIndex];
  if (!it) return fail('');
  if (it.kind !== 'crop') return fail('Shoppers here want food: only crops sell');
  const left = addItem(m.counter, { ...it }); const moved = it.qty - left;
  if (!moved) return fail('The counter is full');
  removeFromSlot(state.inventory, slotIndex, moved);
  return { ok: true, msg: '', float: `${moved} on the counter`, moved };
}
export function takeBack(state, counterIndex) {
  const m = ensureMarket(state), it = m.counter.slots[counterIndex]; if (!it) return fail('');
  const left = addItem(state.inventory, { ...it }); const moved = it.qty - left;
  if (!moved) return fail('Your pockets are full');
  removeFromSlot(m.counter, counterIndex, moved);
  return { ok: true, msg: '', moved };
}
export const counterCount = state => ensureMarket(state).counter.slots.reduce((n, it) => n + (it ? it.qty : 0), 0);

// Shoppers: while you are at the market and it is open, one comes along the lane every few minutes. Each wants a kind of
// food (or anything); at your counter they buy one or two of what matches, or of anything half the time, at full price
// plus a tip, and walk on. Nothing on the counter, they glance and go. Everything that happens is pushed to m.events
// for the screen (floats, bubbles) and forgotten by the next tick.
export function marketTick(state, dtMinutes) {
  const m = ensureMarket(state); if (!m.at) return;
  const C = CONFIG.market, now = state.minutes;
  if (marketOpen(state)) {
    if (m.nextAt == null) { const r = makeRng(state.seed ^ hashString('shopper' + m.count)); m.nextAt = now + r.range(C.arrivalMinutes[0], C.arrivalMinutes[1]); }
    if (now >= m.nextAt) {
      const r = makeRng(state.seed ^ hashString('shopper' + m.count)), f = stallFront('yours');
      const want = r.chance(C.wantChance) ? r.pick(FAMILIES) : null;
      m.npcs.push({ id: m.count, x: -1, y: f.y, dir: 'right', want, phase: 'in', t: 0, variant: r.int(0, 5), qty: r.chance(C.twoChance) ? 2 : 1, bubble: null });
      m.count++; m.today.visitors++; m.nextAt = now + r.range(C.arrivalMinutes[0], C.arrivalMinutes[1]);
    }
  } else m.nextAt = null;
  const f = stallFront('yours'), keep = [];
  for (const n of m.npcs) {
    const step = C.laneSpeed * dtMinutes;
    if (n.phase === 'in') { n.x = Math.min(f.x, n.x + step); n.dir = 'right'; if (n.x >= f.x) { n.phase = 'buy'; n.t = 0; n.dir = 'up'; buy(state, n); } }
    else if (n.phase === 'buy') { n.t += dtMinutes; if (n.t >= C.pauseMinutes) { n.phase = 'out'; n.dir = 'right'; n.bubble = null; } }
    else { n.x += step; }
    if (n.x < MARKET.w + 1) keep.push(n);
  }
  m.npcs = keep;
}
function buy(state, n) {
  const m = state.market, C = CONFIG.market, r = makeRng(state.seed ^ hashString('buy' + n.id));
  const stacks = m.counter.slots.map((it, i) => ({ it, i })).filter(s => s.it);
  if (!stacks.length) { n.bubble = { kind: 'none' }; return; }
  const matches = stacks.filter(s => n.want && state.species[s.it.species]?.genome.family === n.want);
  let pick = null, match = false;
  if (matches.length) { pick = r.pick(matches); match = true; }
  else if (!n.want || r.chance(C.buyAnyChance)) pick = r.pick(stacks);
  if (!pick) { n.bubble = { kind: 'want', want: n.want }; return; }
  const it = pick.it, qty = Math.min(it.qty, n.qty), base = salePrice(state, it) * qty;
  const tipRate = r.range(0, C.tipMax) + (match ? C.matchTip : 0) + (it.q || 0) * C.starTip, tip = Math.round(base * tipRate * 100) / 100, total = Math.round((base + tip) * 100) / 100;
  removeFromSlot(m.counter, pick.i, qty);
  state.money = Math.round((state.money + total) * 100) / 100;
  state.stats.earned = Math.round(((state.stats.earned || 0) + total) * 100) / 100; state.stats.sold = (state.stats.sold || 0) + qty;
  m.today.sold += qty; m.today.money = Math.round((m.today.money + total) * 100) / 100; m.today.tips = Math.round((m.today.tips + tip) * 100) / 100;
  m.lifetime.sold += qty; m.lifetime.money = Math.round((m.lifetime.money + total) * 100) / 100;
  n.bubble = { kind: 'bought', species: it.species, qty, match };
  m.events.push({ type: 'sale', total, tip, qty, species: it.species, x: n.x, y: n.y });
}

// The other stalls. The seed merchant has three packets from elsewhere each day, never what the catalogue has this
// week; the hardware stall sells the packs the catalogue delivers overnight, on the spot, at a markup.
export function merchantOffers(state, key) {
  const C = CONFIG.market, out = [];
  if (key === 'seeds') {
    const here = seedOffers(state), keys = Object.keys(WILD_BASES).filter(k => !here.includes(k));
    const r = makeRng(state.seed ^ hashString('merchant' + dayOf(state)));
    const picks = []; while (picks.length < 3 && picks.length < keys.length) { const k = r.pick(keys); if (!picks.includes(k)) picks.push(k); }
    for (const k of picks) { const sp = seedSpecies(state, k); out.push({ id: 'seeds:' + k, name: `${sp.name} seeds ×3`, species: sp, price: Math.round(Math.max(1, sp.seedPrice * 3) * C.seedMarkup * 100) / 100, item: { kind: 'seed', species: sp.id, qty: 3 }, effect: `From elsewhere: not in the catalogue this week` }); }
  } else if (key === 'hardware') {
    const P = CONFIG.power, mk = p => Math.round(p * C.hardwareMarkup * 100) / 100;
    out.push({ id: 'fuel', name: `Fuel ×${CONFIG.fuel.packSize}`, price: mk(CONFIG.fuel.price * CONFIG.fuel.packSize), item: { kind: 'fuel', qty: CONFIG.fuel.packSize }, effect: 'In your pocket now, not tonight' });
    out.push({ id: 'pipe', name: `Pipe ×${CONFIG.pipe.packSize}`, price: mk(CONFIG.pipe.packPrice), item: { kind: 'pipe', qty: CONFIG.pipe.packSize }, effect: 'In your pocket now, not tonight' });
    out.push({ id: 'line', name: `Power line ×${P.line.packSize}`, price: mk(P.line.packPrice), item: { kind: 'line', qty: P.line.packSize }, effect: 'In your pocket now, not tonight' });
    out.push({ id: 'belt', name: `Belt ×${P.belt.packSize}`, price: mk(P.belt.packPrice), item: { kind: 'belt', qty: P.belt.packSize }, effect: 'In your pocket now, not tonight' });
  }
  return out;
}
export function buyFromMerchant(state, key, id) {
  const m = ensureMarket(state); if (!m.at) return fail('You are not at the market');
  const o = merchantOffers(state, key).find(o => o.id === id); if (!o) return fail('Sold out');
  if (state.money < o.price) return fail('Not enough money');
  if (!hasRoom(state.inventory, o.item)) return fail('No pocket free');
  state.money = Math.round((state.money - o.price) * 100) / 100; addItem(state.inventory, { ...o.item });
  if (o.species && !state.discovered.includes(o.species.id)) { state.discovered.push(o.species.id); state.stats.discoveries = (state.stats.discoveries || 0) + 1; }
  return { ok: true, msg: '', float: `−$${o.price.toFixed(2)}` };
}
// Packing up: what is left on the counter comes back to your pockets as far as it fits; the rest waits on the counter.
export function packUp(state) {
  const m = ensureMarket(state); let back = 0;
  m.counter.slots.forEach((it, i) => { if (!it) return; const left = addItem(state.inventory, { ...it }); const moved = it.qty - left; if (moved) { removeFromSlot(m.counter, i, moved); back += moved; } });
  return { ok: true, msg: '', back, left: counterCount(state) };
}
export const familyWord = f => ({ root: 'roots', gourd: 'gourds', vine: 'vine fruit', grain: 'grain', bush: 'berries', flower: 'flowers' }[f] || f);
