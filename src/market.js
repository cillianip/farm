// The market: a lane of stalls an hour's walk down the track. Your stall sells to the shoppers who pass while you stand
// there, at full price with no daily order and a tip on top; the other stalls sell seeds from elsewhere and hardware
// on the spot. Pure rules; sim.js ticks it and game.js draws it. Nothing here touches the farm's tiles.
import { CONFIG } from './config.js';
import { makeRng, hashString } from './rng.js';
import { addItem, removeFromSlot, hasRoom, makeInventory, itemKey, isFood } from './items.js';
import { salePrice } from './economy.js';
import { WILD_BASES, WILD_NAMES } from './genetics.js';
import { seedOffers, seedSpecies } from './catalog.js';

const MIN_PER_DAY = 1440;
const hourOf = s => (s.minutes % MIN_PER_DAY) / 60;
const dayOf = s => Math.floor(s.minutes / MIN_PER_DAY) + 1;
const fail = msg => ({ ok: false, msg });

// The square, in tiles (Build 69). Cobbles inside a ring of trees, a fountain in the middle, the track in through a gate at
// the bottom. Three stalls face south across the top: the seed merchant, your tent (four wide, a chest in the back you
// can stand beside), the hardware stall. Shoppers come in at the gate, walk the round past every stall, buy at your
// counter when they pass it, and leave the way they came. You walk anywhere the cobbles and grass allow, behind the
// stalls included.
// Sized to sit whole on a normal screen at the game's scale (18 × 12 tiles), so the camera never has to follow you here.
export const MARKET = {
  w: 18, h: 12,
  stalls: { seeds: { x: 2, y: 5, w: 2, key: 'seeds', name: 'Seed merchant' }, yours: { x: 7, y: 2, w: 4, key: 'yours', name: 'Your stall' }, hardware: { x: 14, y: 5, w: 2, key: 'hardware', name: 'Hardware' } },   // y is the back row; the counter is the row below it; shoppers stand on the row below that
  fountain: { x: 8, y: 5, w: 2, h: 2 },
  store: { x: 10, y: 2 },                                    // the chest in the back of your tent
  seats: [{ x: 4, y: 7 }, { x: 13, y: 7 }],
  gate: { x: 8, w: 2, y0: 9 },                               // the track into the square, from the bottom edge
  homeSign: { x: 11, y: 10 },                                // beside the gate, off the shoppers' round
  start: { x: 9, y: 9.5 },
  paved: { x0: 2, x1: 15, y0: 2, y1: 9 },                    // the cobbles
  loop: [[5.5, 4.5], [9, 4.6], [12.5, 4.5], [12.5, 8.5], [5.5, 8.5]],   // the shoppers' round: NW, your counter, NE, SE, SW
  entry: [9, 8.5], spawn: [9, 11.6],
  bounds: { x0: 1.5, x1: 16.5, y0: 1.3, y1: 10.6 },
};
const BLOCKED = [
  MARKET.fountain,
  { x: 2, y: 5, w: 2, h: 2 }, { x: 14, y: 5, w: 2, h: 2 },   // the merchants' stalls
  { x: 7, y: 3, w: 4, h: 1 }, { x: 7, y: 2, w: 1, h: 1 }, { ...MARKET.store, w: 1, h: 1 },   // your counter, the tent pole, the chest
  ...MARKET.seats.map(s => ({ ...s, w: 1, h: 1 })), { ...MARKET.homeSign, w: 1, h: 1 },
];
export const FAMILIES = ['root', 'gourd', 'vine', 'grain', 'bush', 'flower'];
export const stallFront = key => { const st = MARKET.stalls[key]; return { x: st.x + st.w / 2, y: st.y + 2.5 }; };   // where a shopper stands to buy
export const paved = (x, y) => { const P = MARKET.paved; return x >= P.x0 && x <= P.x1 && y >= P.y0 && y <= P.y1; };

export function makeMarket() {
  return { at: false, counter: makeInventory(CONFIG.market.counterSlots), store: makeInventory(CONFIG.market.storeSlots), npcs: [], nextAt: null, count: 0, farmPos: null,
    today: { day: 0, sold: 0, money: 0, tips: 0, visitors: 0 }, lifetime: { sold: 0, money: 0, trips: 0 }, events: [] };
}
export function ensureMarket(state) { if (!state.market) state.market = makeMarket(); const m = state.market; m.events = m.events || []; m.lifetime = m.lifetime || { sold: 0, money: 0, trips: 0 }; m.store = m.store || makeInventory(CONFIG.market.storeSlots); return m; }
export const marketOpen = state => { const h = hourOf(state); return h >= CONFIG.market.open && h < CONFIG.market.close; };
export function walkable(x, y) { const b = MARKET.bounds; if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) return false; return !BLOCKED.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h); }

// Leaving and arriving. sim.travel wraps these around the hour's walk.
export function depart(state, dest) {
  const m = ensureMarket(state);
  if (dest === 'market' && m.at) return fail('You are here');
  if (dest === 'farm' && !m.at) return fail('You are home');
  if (state.carrying) return fail('Put down what you carry first');
  if (dest === 'market' && hourOf(state) >= CONFIG.market.close - 1) return fail(`The market shuts at ${CONFIG.market.close - 12}pm: too late to go today`);
  if (dest === 'market') m.farmPos = { x: state.player.x, y: state.player.y, dir: state.player.dir };
  if (state.barrow) state.barrow.held = false;   // the barrow stays home
  if (state.forklift?.mounted) { state.forklift.mounted = false; state.forklift.x = state.player.x - 0.5; state.forklift.y = state.player.y - 0.5; }   // and so does the forklift
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
  if (!isFood(it)) return fail('Shoppers here want food: crops and dried goods sell');
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

// Shoppers: while you are at the market and it is open, one comes in at the gate every few minutes. Each wants a kind of
// food (or anything). They walk the round, a few legs of it clockwise or the other way, pausing at a corner now and
// then; when they pass your counter they buy one or two of what matches, or of anything half the time, at full price
// plus a tip; nothing on the counter, they glance and go. Then back to the gate. Everything that happens is pushed to
// m.events for the screen (floats, bubbles) and forgotten by the next tick.
export function spawnShopper(state, want) {
  const m = ensureMarket(state), C = CONFIG.market, r = makeRng(state.seed ^ hashString('shopper' + m.count));
  if (want === undefined) want = r.chance(C.wantChance) ? (r.chance(CONFIG.dried.wantChance) ? 'dried' : r.pick(FAMILIES)) : null;
  const n = { id: m.count, x: MARKET.spawn[0], y: MARKET.spawn[1], dir: 'up', want, phase: 'in', t: 0, variant: r.int(0, 5), qty: r.chance(C.twoChance) ? 2 : 1, bubble: null, cw: r.chance(0.5), legs: r.int(4, 8), wp: -1, shopped: false, pause: 0, stage: 0 };
  m.npcs.push(n); m.count++; m.today.visitors++;
  return n;
}
// one step toward a point; true when there
function walkTo(n, [tx, ty], step) {
  const dx = tx - n.x, dy = ty - n.y, d = Math.hypot(dx, dy);
  if (d <= step) { n.x = tx; n.y = ty; return true; }
  n.x += dx / d * step; n.y += dy / d * step;
  n.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  return false;
}
const nextWp = n => (n.wp + (n.cw ? 1 : -1) + MARKET.loop.length) % MARKET.loop.length;
export function marketTick(state, dtMinutes) {
  const m = ensureMarket(state); if (!m.at) return;
  const C = CONFIG.market, now = state.minutes;
  if (marketOpen(state)) {
    if (m.nextAt == null) { const r = makeRng(state.seed ^ hashString('shopper' + m.count)); m.nextAt = now + r.range(C.arrivalMinutes[0], C.arrivalMinutes[1]); }
    if (now >= m.nextAt) { spawnShopper(state); const r = makeRng(state.seed ^ hashString('next' + m.count)); m.nextAt = now + r.range(C.arrivalMinutes[0], C.arrivalMinutes[1]); }
  } else m.nextAt = null;
  const keep = [];
  for (const n of m.npcs) {
    const step = C.laneSpeed * dtMinutes;
    if (n.phase === 'in') { if (walkTo(n, MARKET.entry, step)) { n.phase = 'loop'; n.wp = n.cw ? 4 : 3; } }   // from the south edge: clockwise heads west to the SW corner, the other way east
    else if (n.phase === 'loop') {
      if (n.pause > 0) n.pause -= dtMinutes;
      else if (walkTo(n, MARKET.loop[n.wp], step)) {
        if (n.wp === 1 && !n.shopped) { n.shopped = true; n.phase = 'buy'; n.t = 0; n.dir = 'up'; buy(state, n); }
        else if (n.legs <= 0 && (n.wp === 3 || n.wp === 4)) { n.phase = 'out'; n.stage = 1; }   // leaving from a bottom corner, so the way out never crosses the fountain
        else { n.legs--; n.wp = nextWp(n); if (n.wp !== 1 && (n.id * 7 + n.wp * 3) % 10 < 5) n.pause = 2 + ((n.id + n.wp) % 3); }   // a stroll: half the corners get a two- to four-minute stand and stare
      }
    }
    else if (n.phase === 'buy') { n.t += dtMinutes; if (n.t >= C.pauseMinutes) { n.phase = 'loop'; n.bubble = null; n.legs--; n.wp = nextWp(n); } }
    else if (n.phase === 'out') { if (n.stage === 1) { if (walkTo(n, MARKET.entry, step)) n.stage = 2; } else walkTo(n, MARKET.spawn, step); }
    if (!(n.phase === 'out' && n.stage === 2 && n.y >= MARKET.spawn[1] - 0.01)) keep.push(n);
  }
  m.npcs = keep;
}
function buy(state, n) {
  const m = state.market, C = CONFIG.market, r = makeRng(state.seed ^ hashString('buy' + n.id));
  const stacks = m.counter.slots.map((it, i) => ({ it, i })).filter(s => s.it);
  if (!stacks.length) { n.bubble = { kind: 'none' }; m.events.push({ type: 'pass', x: n.x, y: n.y }); return; }
  const matches = stacks.filter(s => n.want && (n.want === 'dried' ? s.it.kind === 'product' : state.species[s.it.species]?.genome.family === n.want));
  let pick = null, match = false;
  if (matches.length) { pick = r.pick(matches); match = true; }
  else if (!n.want || r.chance(C.buyAnyChance)) pick = r.pick(stacks);
  if (!pick) { n.bubble = { kind: 'want', want: n.want }; m.events.push({ type: 'pass', x: n.x, y: n.y }); return; }
  const it = pick.it, qty = Math.min(it.qty, n.qty), base = salePrice(state, it) * qty;
  const tipRate = r.range(0, C.tipMax) + (match ? C.matchTip : 0) + (it.q || 0) * C.starTip, tip = Math.round(base * tipRate * 100) / 100, total = Math.round((base + tip) * 100) / 100;
  removeFromSlot(m.counter, pick.i, qty);
  state.money = Math.round((state.money + total) * 100) / 100;
  state.stats.earned = Math.round(((state.stats.earned || 0) + total) * 100) / 100; state.stats.sold = (state.stats.sold || 0) + qty;
  m.today.sold += qty; m.today.money = Math.round((m.today.money + total) * 100) / 100; m.today.tips = Math.round((m.today.tips + tip) * 100) / 100;
  m.lifetime.sold += qty; m.lifetime.money = Math.round((m.lifetime.money + total) * 100) / 100;
  n.bubble = { kind: 'bought', species: it.species, qty, match, product: it.product || null };
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
export const familyWord = f => ({ root: 'roots', gourd: 'gourds', vine: 'vine fruit', grain: 'grain', bush: 'berries', flower: 'flowers', dried: 'something dried' }[f] || f);
