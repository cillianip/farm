// Rule tests, no browser needed: `node tests/run.js`
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';
import { makeRng, hashString } from '../src/rng.js';
import * as G from '../src/genetics.js';
import * as S from '../src/sim.js';
import { serialize, deserialize, applyOffline } from '../src/save.js';
import { formatMoney, titleFor, salePrice } from '../src/economy.js';
import { makeCompost } from '../src/fertiliser.js';
import { addItem, makeInventory, itemKey } from '../src/items.js';
import { FARM_ORIGIN } from '../src/world.js';
import * as W from '../src/world.js';
const WB = W.BUILDINGS;
const X = FARM_ORIGIN.x + 1, Y = FARM_ORIGIN.y + 1;
const r2 = v => Math.round(v * 100) / 100;   // a tile inside the starter land

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { failed++; console.log('  ✗', name, '\n    ', e.message); } }
const byName = (s, n) => Object.values(s.species).find(sp => sp.name === n);
const wet = (s, t) => { t.moisture = 60; };
const arm = s => { S.takeTools(s); S.fillCan(s); addItem(s.inventory, { kind: 'seed', species: byName(s, 'Carrot').id, qty: 5 }); addItem(s.inventory, { kind: 'seed', species: byName(s, 'Turnip').id, qty: 4 }); return s; };
// advance game minutes directly (no pass-out) for growth tests
const tickMinutes = (s, m) => { s.minutes += m; S.tick(s, m); };

console.log('rng');
await test('seeded rng is deterministic', () => { const a = makeRng(7), b = makeRng(7); for (let i = 0; i < 20; i++) assert.equal(a(), b()); assert.equal(hashString('carrot'), hashString('carrot')); assert.notEqual(hashString('a'), hashString('b')); });

console.log('genetics');
await test('species id is stable and depends only on the genome', () => {
  const a = G.makeSpecies(G.STARTER_GENOMES.carrot), b = G.makeSpecies({ ...G.STARTER_GENOMES.carrot });
  assert.equal(a.id, b.id);
  const c = G.makeSpecies({ ...G.STARTER_GENOMES.carrot, hue1: 200 });
  assert.notEqual(a.id, c.id);
});
await test('starters are common and cheap, pumpkin is uncommon', () => {
  const s = G.starterSpecies();
  for (const sp of Object.values(s)) { assert.ok(sp.value > 0 && sp.seedPrice > 0, sp.name); }
  assert.equal(byName({ species: s }, 'Carrot').tier, 'common');
  assert.equal(byName({ species: s }, 'Pumpkin').tier, 'uncommon');
});
await test('crossing is deterministic for the same parents and seed', () => {
  const a = G.STARTER_GENOMES.carrot, b = G.STARTER_GENOMES.turnip;
  const r1 = G.cross(a, b, 123), r2 = G.cross(a, b, 123);
  assert.deepEqual(r1, r2);
  assert.notDeepEqual(G.cross(a, b, 124).child, r1.child);
});
await test('children stay inside gene ranges', () => {
  const a = G.STARTER_GENOMES.carrot, b = G.STARTER_GENOMES.pumpkin;
  for (let seed = 0; seed < 300; seed++) {
    const { child } = G.cross(a, b, seed);
    for (const spec of G.GENES) {
      const v = child[spec.k];
      if (spec.type === 'cat') assert.ok(spec.values.includes(v), `${spec.k}=${v}`);
      else if (spec.type !== 'bool') { const lo = spec.min ?? 0, hi = spec.max ?? 1; assert.ok(v >= lo && v <= hi, `${spec.k}=${v}`); }
    }
    assert.ok(Number.isInteger(child.count) && child.count >= 1 && child.count <= 8);
    assert.equal(child.gen, 1);
  }
});
await test('same-family crosses are more stable than cross-family ones', () => {
  let same = 0, diff = 0; const N = 400;
  for (let i = 0; i < N; i++) { same += G.cross(G.STARTER_GENOMES.carrot, G.STARTER_GENOMES.turnip, i).instability; diff += G.cross(G.STARTER_GENOMES.carrot, G.STARTER_GENOMES.tomato, i).instability; }
  assert.ok(same / N < diff / N, `${same / N} vs ${diff / N}`);
  assert.ok(same / N < 0.25, 'starters should be mostly stable: ' + same / N);
});
await test('rare traits are recessive and rare', () => {
  const golden = { ...G.STARTER_GENOMES.carrot, traits: { golden: true } };
  let one = 0, both = 0, none = 0; const N = 600;
  for (let i = 0; i < N; i++) {
    if (G.cross(golden, G.STARTER_GENOMES.carrot, i).child.traits.golden) one++;
    if (G.cross(golden, golden, i).child.traits.golden) both++;
    if (G.cross(G.STARTER_GENOMES.carrot, G.STARTER_GENOMES.carrot, i).child.traits.golden) none++;
  }
  assert.ok(one / N > 0.15 && one / N < 0.35, 'one parent: ' + one / N);
  assert.ok(both / N > 0.65, 'both parents: ' + both / N);
  assert.ok(none / N < 0.05, 'no parent: ' + none / N);
});
await test('rarer tiers earn more per minute and golden multiplies value', () => {
  const base = G.makeSpecies(G.STARTER_GENOMES.carrot);
  const gold = G.makeSpecies({ ...G.STARTER_GENOMES.carrot, traits: { golden: true } });
  assert.ok(gold.rarity > base.rarity && gold.value > base.value * 3);
  const perMin = sp => sp.value * sp.genome.count / G.growRealMinutes(sp.genome);
  assert.ok(perMin(gold) > perMin(base));
  assert.equal(G.tierOf(0), 'common'); assert.equal(G.tierOf(CONFIG.tiers.thresholds.legendary), 'legendary');
  assert.ok(G.ratePerMinute(60) > G.ratePerMinute(34) * 10, 'no price cap: rarity keeps paying');
});
await test('names are built from genes', () => {
  const sp = G.makeSpecies({ ...G.STARTER_GENOMES.carrot, pattern: 'spots', hue1: 230, traits: { glowing: true } });
  assert.equal(sp.name, 'Spotted Moon Azure Carrot');
  assert.ok(G.variantWord(sp.genome).length >= 4);
  assert.equal(G.makeSpecies(G.STARTER_GENOMES.potato).name, 'Amber Potato');
});

console.log('farming');
await test('hoe → plant → water → grows only while wet → harvest gives produce and seeds', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  assert.ok(S.useItem(s, 0, X, Y).ok, 'hoe');
  assert.ok(S.useItem(s, 2, X, Y).ok, 'plant');
  const t = s.world.tiles[Y * s.world.w + X];
  assert.ok(t.crop);
  tickMinutes(s, 60); assert.equal(t.crop.growth, 0, 'dry soil does not grow');
  assert.ok(S.useItem(s, 1, X, Y).ok, 'water'); assert.ok(S.useItem(s, 1, X, Y).ok, 'water again'); assert.equal(s.can.water, 6); assert.equal(t.moisture, 70);
  tickMinutes(s, 60 * 3); assert.ok(t.crop.growth > 45 && t.crop.growth < 55, 'half grown: ' + t.crop.growth);
  wet(s, t); tickMinutes(s, 60 * 3); assert.equal(t.crop.growth, 100);
  const before = s.inventory.slots.filter(Boolean).length;
  const r = S.useItem(s, 2, X, Y);           // using seeds on a ripe crop harvests it
  assert.ok(r.ok && r.count === 1 && !r.seeds, JSON.stringify(r));   // no seeds from harvesting: they come from the seed rack
  assert.equal(t.crop, null);
  assert.ok(s.inventory.slots.some(i => i?.kind === 'crop'));
});
await test('energy is spent and refuses when empty', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5; s.energy = 1;
  assert.equal(S.useItem(s, 0, X, Y).msg, 'Too tired');
});
await test('out of reach and unowned land are refused', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  assert.equal(S.useItem(s, 0, X + 9, Y + 9).msg, 'Too far');
  s.player.x = X - 4.5; s.player.y = Y + 0.5;
  assert.equal(S.useItem(s, 0, X - 5, Y).msg, 'Not your land');
});
await test('dry crops lose health and die; withered plants can be cleared', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  S.useItem(s, 0, X, Y); S.useItem(s, 2, X, Y);
  const t = s.world.tiles[Y * s.world.w + X];
  tickMinutes(s, 60 * 10); assert.ok(t.crop.health < 100 && !t.crop.dead);
  tickMinutes(s, 60 * 60); assert.ok(t.crop.dead, 'dead after long drought');
  assert.equal(S.cropStage(t.crop), 'dead');
  s.energy = 100;
  const empties = s.inventory.slots.map((it, i) => it ? -1 : i).filter(i => i >= 0); for (const i of empties) s.inventory.slots[i] = { kind: 'sprinkler', level: 0, qty: 1 };
  const r = S.useItem(s, 0, X, Y); assert.ok(!r.ok && /No pocket free/.test(r.msg), 'full pockets: the withered plant is not thrown away: ' + r.msg); assert.ok(t.crop?.dead, 'it stays in the bed');
  for (const i of empties) s.inventory.slots[i] = null;
  assert.ok(S.useItem(s, 0, X, Y).ok); assert.equal(t.crop, null);
  assert.ok(s.inventory.slots.some(i => i?.kind === 'withered'));
});
await test('ripe crops rot and then die', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  S.useItem(s, 0, X, Y); S.useItem(s, 2, X, Y);
  const t = s.world.tiles[Y * s.world.w + X]; wet(s, t);
  const sp = s.species[t.crop.speciesId];
  tickMinutes(s, sp.genome.growHours * 60 + 1); assert.equal(t.crop.growth, 100);
  assert.equal(S.rotFactor(s, t.crop), 1);
  tickMinutes(s, sp.genome.ripeHours * 60 + CONFIG.crop.rotHours * 30);
  const rf = S.rotFactor(s, t.crop); assert.ok(rf > 0.3 && rf < 0.7, 'half rotten: ' + rf);
  tickMinutes(s, CONFIG.crop.rotHours * 40); assert.ok(t.crop.dead);
});
await test('regrowing crops come back after harvest', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  const tomato = byName(s, 'Tomato'); addItem(s.inventory, { kind: 'seed', species: tomato.id, qty: 1 });
  const slot = s.inventory.slots.findIndex(i => i?.species === tomato.id);
  S.useItem(s, 0, X, Y); S.useItem(s, slot, X, Y);
  const t = s.world.tiles[Y * s.world.w + X]; wet(s, t);
  for (let m = 0; m < tomato.genome.growHours * 60 * 1.3; m += 60) { wet(s, t); tickMinutes(s, 60); }   // kept watered; long enough even with the slower night hours
  t.fert = { name: 'Plain compost I', stats: {}, id: 'fx' };
  const r = S.useItem(s, 0, X, Y); assert.ok(r.ok && r.count === 3, JSON.stringify(r));
  assert.ok(t.crop && t.crop.growth === CONFIG.crop.regrowResetTo);
  assert.equal(t.fert, null, 'the harvest spends the bag on a regrowing plant too');
});
await test('second-hand: machines, pipe, line and belt go in the crate and the cart pays half the list price', () => {
  const s = arm(S.createState(1));
  s.inventory.slots[2] = { kind: 'sprinkler', level: 1, qty: 1 }; s.inventory.slots[3] = { kind: 'pipe', qty: 4 }; s.inventory.slots[4] = { kind: 'fert', fert: { name: 'x', stats: {}, id: 'f' }, qty: 1 };
  assert.equal(S.useItem.length, 4); assert.equal(S.putInCrate(s, 4).msg, 'Crops go in the crate, and machines to sell second-hand');
  let r = S.putInCrate(s, 2); assert.ok(r.ok && r.float === '+1 Sprinkler II', JSON.stringify(r)); r = S.putInCrate(s, 3); assert.ok(r.ok && r.count === 4);
  assert.equal(S.crateCount(s), 5); assert.equal(S.secondHand({ kind: 'sprinkler', level: 1 }), CONFIG.sprinkler.tiers[1].price / 2);
  const P = S.priceCrate(s, s.crate.items); assert.equal(P.lines.length, 2); assert.equal(P.lines[0].name, 'Sprinkler II (second-hand)'); assert.equal(P.lines[0].total, CONFIG.sprinkler.tiers[1].price / 2);
  assert.equal(P.lines[1].total, Math.round(CONFIG.pipe.packPrice / CONFIG.pipe.packSize / 2 * 4 * 100) / 100); assert.equal(P.count, 5);
  const m = s.money, sale = S.collectCrate(s); assert.ok(Math.abs(s.money - m - P.total) < 1e-9 && sale.count === 5 && !s.crate.items.length);
});
await test('neighbouring different species grow faster', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  for (const [x, y] of [[X, Y], [X - 1, Y], [X + 1, Y]]) S.useItem(s, 0, x, y);
  S.useItem(s, 2, X, Y); S.useItem(s, 3, X - 1, Y); S.useItem(s, 3, X + 1, Y);
  const t = s.world.tiles[Y * s.world.w + X]; for (const x of [X - 1, X, X + 1]) wet(s, s.world.tiles[Y * s.world.w + x]);
  tickMinutes(s, 60);
  const expected = 100 / s.species[t.crop.speciesId].genome.growHours;
  assert.ok(Math.abs(t.crop.growth - expected * 1.05) < 0.01, `${t.crop.growth} vs ${expected * 1.05}`);   // two neighbours, one distinct species
});

console.log('day cycle');
await test('time advances, passing 2am forces sleep, sleeping dries soil and restores energy', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  S.useItem(s, 0, X, Y); S.useItem(s, 1, X, Y); s.energy = 10;
  const t = s.world.tiles[Y * s.world.w + X];
  assert.ok(S.isWet(t)); assert.equal(S.moistureState(t), 'moist');
  const ev = S.advance(s, CONFIG.time.dayRealSeconds);     // 24 game hours → passes 2am
  assert.equal(ev.length, 1); assert.equal(ev[0].type, 'sleep'); assert.ok(ev[0].forced);
  assert.equal(S.dayOf(s), 2); assert.equal(Math.floor(S.hourOf(s)), CONFIG.time.wakeHour);
  assert.ok(s.energy > 0 && s.energy <= Math.round(s.energyMax * 0.6), 'groggy, and less when hungry: ' + s.energy);
  if (!s.rainToday) assert.ok(!S.isWet(t), 'evaporated: ' + t.moisture);
  s.energy = 5; s.hunger = 100; s.thirst = 100; const rep = S.sleep(s); assert.equal(s.energy, s.energyMax); assert.equal(rep.day, 3);
});
await test('moisture: evaporates, grows fastest in the ideal band, waterlogging and drought hurt', () => {
  assert.equal(S.moistureGrowthFactor(10), 0); assert.equal(S.moistureGrowthFactor(60), 1); assert.ok(S.moistureGrowthFactor(30) < 1 && S.moistureGrowthFactor(30) > 0); assert.ok(S.moistureGrowthFactor(98) < 1);
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  S.useItem(s, 0, X, Y); S.useItem(s, 2, X, Y); const t = s.world.tiles[Y * s.world.w + X];
  t.moisture = 100; tickMinutes(s, 60 * 2); assert.ok(t.crop.health < 100, 'soggy soil hurts: ' + t.crop.health); assert.ok(t.moisture < 100, 'evaporates');
  t.moisture = 60; const h = t.crop.health; tickMinutes(s, 60); assert.ok(t.crop.health > h, 'recovers when right');
  for (let i = 0; i < 9; i++) S.useItem(s, 1, X, Y); assert.equal(s.can.water, 0); assert.ok(t.moisture <= 100);
  assert.equal(S.useItem(s, 1, X, Y).msg, 'The can is empty. Fill it at the well.');
});
await test('a bird drops an unknown wild seed on bare tilled soil', () => {
  const s = arm(S.createState(2)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  tickMinutes(s, 30); assert.equal(s.bird.nextAt, null, 'no tilled soil, no bird');
  S.useItem(s, 0, X, Y); tickMinutes(s, 1); assert.ok(s.bird.nextAt != null);
  tickMinutes(s, 10); assert.ok(s.bird.pending, 'bird on its way');
  const r = S.birdDrop(s); assert.ok(r && r.x === X && r.y === Y);
  const t = s.world.tiles[Y * s.world.w + X]; assert.ok(t.crop.unknown); const sp = s.species[t.crop.speciesId]; assert.ok(sp.wild && sp.name.startsWith('Wild ')); assert.ok(['common', 'uncommon'].includes(sp.tier));
  for (const v of Object.values(sp.genome.traits)) assert.equal(v, false);
  wet(s, t); tickMinutes(s, sp.genome.growHours * 60 + 1); assert.ok(!t.crop.unknown, 'revealed when ripe');
});
await test('sleeping before midnight goes to 6am next day, after midnight to 6am same day', () => {
  const s = S.createState(1); s.minutes = 22 * 60; S.sleep(s); assert.equal(S.dayOf(s), 2);
  s.minutes = S.MIN_PER_DAY + 60; S.sleep(s); assert.equal(S.dayOf(s), 2); assert.equal(S.hourOf(s), 6);
});

console.log('economy');
await test('money formats and titles', () => {
  assert.equal(formatMoney(1234567), '$1.23M'); assert.equal(formatMoney(2.5), '$2.50'); assert.equal(formatMoney(1500), '$1.50K');
  assert.equal(titleFor(0), 'Backyard Gardener'); assert.equal(titleFor(6000), 'Family Farmer');
});
await test('the sale price is the species value, stars and the seed book bonus', () => {
  const s = S.createState(1); const carrot = byName(s, 'Carrot');
  assert.ok(Math.abs(salePrice(s, { species: carrot.id }) - carrot.value) < 1e-9, 'no bonus yet');
  s.discovered.push('made-up'); assert.ok(Math.abs(salePrice(s, { species: carrot.id }) - carrot.value * (1 + CONFIG.economy.seedBookBonusPerSpecies)) < 1e-9, 'one discovery');
  assert.ok(Math.abs(salePrice(s, { species: carrot.id, q: 2 }) / salePrice(s, { species: carrot.id }) - (1 + 2 * CONFIG.fertiliser.qualityStarValue)) < 1e-9, 'two stars');
});
await test('a deed claims only a plot touching your land, and the trees come down', () => {
  const s = S.createState(1);
  assert.equal(S.claimLand(s, 2, 0).msg, 'No deed to claim with');
  s.deeds = 1; assert.equal(S.claimLand(s, 4, 0).msg, 'Must touch land you own');
  assert.ok(S.claimLand(s, 2, 0).ok); assert.equal(s.deeds, 0); assert.ok(W.ownsChunk(s.world, 2, 0));
  assert.equal(S.claimLand(s, 3, 0).msg, 'No deed to claim with');
});
await test('the can reaches one bed, a row of three, or a 3×3 by level', () => {
  const s = S.createState(1);
  assert.equal(S.canTiles(s, 5, 5).length, 1); s.upgrades.can = 1; assert.equal(S.canTiles(s, 5, 5).length, 3); s.upgrades.can = 2; assert.equal(S.canTiles(s, 5, 5).length, 9);
});

console.log('inventory');
await test('stacks merge, split and respect the stack limit', () => {
  const inv = makeInventory(2);
  assert.equal(addItem(inv, { kind: 'crop', species: 'x', qty: 150 }), 0);
  assert.equal(inv.slots[0].qty, 99); assert.equal(inv.slots[1].qty, 51);
  assert.equal(addItem(inv, { kind: 'crop', species: 'x', qty: 60 }), 12);
  assert.notEqual(itemKey({ kind: 'crop', species: 'x', q: 1 }), itemKey({ kind: 'crop', species: 'x', q: 0 }));
});
await test('chest moves and quick-moves', () => {
  const s = arm(S.createState(1));
  S.quickMove(s, s.inventory, 2, s.chest); assert.ok(s.chest.slots[0]?.kind === 'seed'); assert.equal(s.inventory.slots[2], null);
  S.moveSlot(s, s.chest, 0, s.inventory, 0); assert.equal(s.inventory.slots[0].kind, 'seed'); assert.equal(s.chest.slots[0].kind, 'tool');
});

console.log('breeder');
await test('breeding consumes parents and money, resolves overnight into a species with seeds', () => {
  const s = arm(S.createState(5)); s.money = 1e6;
  assert.ok(S.setBreederParent(s, 'a', 2).ok); assert.ok(S.setBreederParent(s, 'b', 3).ok);
  assert.equal(s.inventory.slots[2].qty, 4);
  assert.equal(S.setBreederParent(s, 'a', 0).msg, 'Needs a crop or a seed');
  const m = s.money; assert.ok(S.startBreed(s).ok); assert.ok(s.money < m); assert.ok(s.breeder.running);
  const rep = S.sleep(s);
  assert.ok(rep.breeder); assert.ok(['success', 'sterile', 'wither', 'revert'].includes(rep.breeder.outcome));
  if (rep.breeder.species) assert.ok(s.species[rep.breeder.species]);
  if (rep.breeder.outcome === 'success') { assert.ok(rep.breeder.isNew); assert.ok(s.discovered.includes(rep.breeder.species)); assert.ok(!s.inventory.slots.some(i => i?.kind === 'seed' && i.species === rep.breeder.species), 'seeds are not handed over'); assert.equal(s.breeder.result.species, rep.breeder.species); const r = S.takeBreedResult(s); assert.ok(r.ok && r.seeds === rep.breeder.seeds); assert.ok(s.inventory.slots.some(i => i?.kind === 'seed' && i.species === rep.breeder.species)); assert.equal(s.breeder.result, null); }
});
await test('over many breeds every outcome shows up and names stay unique', () => {
  const s = S.createState(9); s.money = 1e9;
  const seen = new Set();
  const ids = Object.keys(s.species);
  for (let i = 0; i < 80; i++) {
    const a = ids[i % ids.length], b = ids[(i * 3 + 1) % ids.length];
    s.breeder.a = { kind: 'seed', species: a, qty: 1 }; s.breeder.b = { kind: 'seed', species: b, qty: 1 };
    assert.ok(S.startBreed(s).ok); const rep = S.sleep(s); seen.add(rep.breeder.outcome); s.breeder.result = null;
  }
  assert.ok(seen.has('success') && seen.size >= 2, [...seen].join());
  const names = Object.values(s.species).map(x => x.name); assert.equal(new Set(names).size, names.length, 'duplicate names');
  for (const sp of Object.values(s.species)) assert.equal(sp.id, sp.sterile ? G.genomeId(sp.genome) + '_s' : G.genomeId(sp.genome));
});
await test('sterile species give no seeds on the rack', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  const st = { ...G.makeSpecies(G.STARTER_GENOMES.carrot, { sterile: true }), id: 'sp_st', name: 'Sterile' }; s.species[st.id] = st;
  addItem(s.inventory, { kind: 'seed', species: st.id, qty: 1 }); const slot = s.inventory.slots.findIndex(i => i?.species === st.id);
  S.useItem(s, 0, X, Y); S.useItem(s, slot, X, Y); const t = s.world.tiles[Y * s.world.w + X]; wet(s, t); tickMinutes(s, 60 * 7);
  const r = S.useItem(s, 0, X, Y); assert.ok(r.ok);
  const slotC = s.inventory.slots.findIndex(i => i?.kind === 'crop' && i.species === st.id);
  assert.equal(S.putOnSeedRack(s, slotC).ok, false, 'sterile refused');
  assert.equal(S.seedsFromProduce(st), 0);
});
await test('seed rack: one produce dries into seeds, bird happens only once', () => {
  const s = S.createState(3); S.takeTools(s);
  const tomato = byName(s, 'Tomato');
  addItem(s.inventory, { kind: 'crop', species: tomato.id, qty: 2 });
  assert.equal(S.putOnSeedRack(s, 0).ok, false, 'tools refused');
  const r = S.putOnSeedRack(s, 2); assert.ok(r.ok);
  assert.equal(s.inventory.slots[2].qty, 1, 'one produce used');
  assert.equal(S.putOnSeedRack(s, 2).ok, false, 'tray busy');
  assert.equal(S.takeSeeds(s).ok, false, 'not dry yet');
  tickMinutes(s, Math.ceil(S.dryHoursFor(tomato) * 60));
  assert.ok(S.seedRackReady(s));
  const [lo, hi] = S.seedRange(tomato); assert.ok(lo <= 6 && hi >= 6 && lo < hi, `range ${lo}-${hi}`);
  const t = S.takeSeeds(s); assert.ok(t.ok); assert.ok(t.seeds >= lo && t.seeds <= hi, 'seeds within the range: ' + t.seeds);
  assert.ok(s.inventory.slots.some(i => i?.kind === 'seed' && i.species === tomato.id && i.qty === t.seeds));
  assert.ok(S.dryHoursFor(byName(s, 'Pumpkin')) > S.dryHoursFor(G.makeSpecies(G.WILD_BASES.wheat)), 'big juicy fruit dries slower than grain');
  assert.equal(s.seedRack.trays[0].item, null);
  // bird: once ever
  s.player.x = X + 0.5; s.player.y = Y + 0.5; S.useItem(s, 0, X, Y); S.useItem(s, 0, X + 1, Y);
  tickMinutes(s, 1); tickMinutes(s, 10); assert.ok(s.bird.pending, 'first bird');
  S.birdDrop(s); tickMinutes(s, 600); assert.equal(s.bird.pending, null, 'no second bird'); assert.equal(s.bird.nextAt, null);
  assert.equal(s.bird.count, 1);
});

console.log('compost');
await test('compost stats come from the inputs and respect the budget', () => {
  const sp = G.starterSpecies(); const turnip = Object.values(sp).find(x => x.name === 'Turnip'), potato = Object.values(sp).find(x => x.name === 'Potato');
  const fast = makeCompost([{ species: turnip.id, qty: 6 }], sp);
  assert.ok(fast.stats.speed > 0, JSON.stringify(fast));
  const mixed = makeCompost([{ species: turnip.id, qty: 3 }, { species: potato.id, qty: 3 }], sp);
  assert.ok(Object.keys(mixed.stats).length >= 2);
  const sum = Object.values(mixed.stats).reduce((a, b) => a + b, 0); assert.ok(sum <= mixed.budget + 0.03);
  assert.ok(fast.stats.speed > (mixed.stats.speed || 0), 'specialist beats all-purpose on its stat');
});
await test('compost bin flow and fertiliser effect on growth', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  const turnip = byName(s, 'Turnip'); addItem(s.inventory, { kind: 'crop', species: turnip.id, qty: 6 });
  const slot = s.inventory.slots.findIndex(i => i?.kind === 'crop');
  assert.equal(S.startCompost(s).ok, false);
  assert.ok(S.addToCompost(s, slot, 6).ok); assert.ok(S.startCompost(s).ok);
  tickMinutes(s, CONFIG.fertiliser.compostHours * 60 + 1); assert.ok(s.compost.ready);
  assert.ok(S.takeCompost(s).ok); const f = s.inventory.slots.findIndex(i => i?.kind === 'fert'); assert.ok(f >= 0);
  S.useItem(s, 0, X, Y); assert.ok(S.useItem(s, f, X, Y).ok); S.useItem(s, 2, X, Y);
  const t = s.world.tiles[Y * s.world.w + X]; wet(s, t); tickMinutes(s, 60);
  assert.ok(t.crop.growth > 100 / 6 + 0.01, 'speed fertiliser grows faster: ' + t.crop.growth);
});

await test('hunger and thirst drain, starving drains energy, sleep does not restore, drinking and eating do', () => {
  const s = S.createState(1); tickMinutes(s, 60 * 12); assert.ok(s.hunger < 100 && s.thirst < 100 && s.energy === 100);
  tickMinutes(s, 60 * 30); assert.equal(s.thirst, 0); assert.ok(s.energy < 100);
  S.sleep(s); assert.equal(s.thirst, 0, 'sleep is not a drink');
  S.drink(s); assert.equal(s.thirst, 100);
  const h = s.hunger; addItem(s.inventory, { kind: 'crop', species: byName(s, 'Pumpkin').id, qty: 1 }); const i = s.inventory.slots.findIndex(x => x?.kind === 'crop');
  assert.equal(S.eat(s, 9).ok, false, 'nothing to eat in an empty slot');
  s.energy = 50; const r = S.eat(s, i); assert.ok(r.ok && s.hunger > h, 'ate'); assert.equal(s.inventory.slots[i], null); assert.ok(s.energy > 50 && r.energy > 0, 'food gives energy');
  s.hunger = 0; s.thirst = 100; const rep = S.sleep(s); assert.equal(s.energy, Math.round(s.energyMax * CONFIG.needs.wakeFloor), 'starving: wake at the floor'); assert.ok(rep.lines.some(l => l.includes('hungry')));
  s.hunger = 100; s.thirst = 100; S.sleep(s); assert.equal(s.energy, s.energyMax, 'fed: full energy');
  assert.equal(S.takeTool(s, 'hoe').ok, true); assert.equal(S.takeTool(s, 'hoe').ok, false, 'rack empty');
});

console.log('save');
await test('serialize/deserialize round trip and offline progress', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  S.useItem(s, 0, X, Y); S.useItem(s, 2, X, Y); S.useItem(s, 1, X, Y); S.useItem(s, 1, X, Y);
  const json = serialize(s); const back = deserialize(json);
  assert.deepEqual(back.world.chunks, s.world.chunks); assert.equal(back.species[Object.keys(s.species)[0]].name, Object.values(s.species)[0].name);
  back.savedAt = Date.now() - 120 * 1000;              // 2 real minutes ago = 6 game hours
  const r = applyOffline(back); assert.ok(Math.abs(r.hours - 6) < 0.01, 'hours ' + r.hours);
  assert.ok(back.world.tiles[Y * back.world.w + X].crop.growth > 60, 'grew while away');
  back.savedAt = Date.now() - 1e9; const r2 = applyOffline(back); assert.ok(r2.hours <= CONFIG.time.offlineMaxHours + 0.01);
  assert.throws(() => deserialize('{"nope":1}'));
});

console.log('delivery crate');
await test('only crops go in, up to the capacity, and the cart pays at night', () => {
  const s = S.createState(5);
  const carrot = byName(s, 'Carrot');
  assert.equal(S.putInCrate(s, 0).ok, false, 'empty slot');
  addItem(s.inventory, { kind: 'crop', species: carrot.id, qty: 20 });
  addItem(s.inventory, { kind: 'seed', species: carrot.id, qty: 2 });
  assert.equal(S.putInCrate(s, 1).ok, false, 'seeds refused');
  const r = S.putInCrate(s, 0);
  assert.ok(r.ok && r.full, 'fills to capacity');
  assert.equal(S.crateCount(s), CONFIG.crate.capacity);
  assert.equal(s.inventory.slots[0].qty, 20 - CONFIG.crate.capacity, 'rest stays in the bag');
  assert.equal(S.putInCrate(s, 0).ok, false, 'full crate refuses');
  const expect = S.crateValue(s); assert.ok(expect > 0);
  const money = s.money;
  const report = S.sleep(s);
  assert.ok(report.sale && report.sale.count === CONFIG.crate.capacity, 'sale in the morning report');
  assert.ok(Math.abs(s.money - money - expect) < 1e-9, 'paid the crate value');
  assert.equal(S.crateCount(s), 0, 'crate emptied');
  assert.ok(report.lines.some(l => l.includes('cart')), 'report mentions the cart');
  assert.equal(S.sleep(s).sale, null, 'nothing to sell the next night');
});
await test('crate stacks the same crop and keeps qualities apart', () => {
  const s = S.createState(6); const carrot = byName(s, 'Carrot');
  addItem(s.inventory, { kind: 'crop', species: carrot.id, qty: 2 }); addItem(s.inventory, { kind: 'crop', species: carrot.id, q: 1, qty: 1 });
  S.putInCrate(s, 0); S.putInCrate(s, 1);   // plain stack, then the ★ stack
  assert.equal(s.crate.items.length, 2); assert.equal(S.crateCount(s), 3);
  assert.ok(S.crateValue(s) > carrot.value * 3, 'quality star worth more');
});
await test('the track cannot be tilled and the crate tile is solid', async () => {
  const W = await import('../src/world.js');
  const s = S.createState(7); S.takeTools(s);
  const tr = W.TRACK[0]; s.player.x = tr.x - 0.5; s.player.y = tr.y + 0.5;
  s.world.chunks.push('2,1');   // own the chunk under the track
  assert.equal(S.useItem(s, 0, tr.x, tr.y).ok, false);
  assert.equal(W.isSolid(s.world, tr.x, tr.y), false, 'track walkable');
  assert.equal(W.isSolid(s.world, W.BUILDINGS.crate.x, W.BUILDINGS.crate.y), true, 'crate solid');
  assert.equal(W.isTree(s.world, tr.x, tr.y), false, 'no tree on the track');
});
await test('thirst gene: low-thirst plants grow in drier soil and drink less', () => {
  const s = arm(S.createState(9)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  const low = { ...G.makeSpecies({ ...G.STARTER_GENOMES.carrot, thirst: 0.1 }), id: 'low', name: 'Low' }, high = { ...G.makeSpecies({ ...G.STARTER_GENOMES.carrot, thirst: 0.9 }), id: 'high', name: 'High' };
  s.species.low = low; s.species.high = high;
  s.inventory.slots[s.inventory.slots.findIndex(i => i?.species === byName(s, 'Turnip').id)] = null;   // five pockets: make room
  addItem(s.inventory, { kind: 'seed', species: 'low', qty: 1 }); addItem(s.inventory, { kind: 'seed', species: 'high', qty: 1 });
  const iL = s.inventory.slots.findIndex(i => i?.species === 'low'), iH = s.inventory.slots.findIndex(i => i?.species === 'high');
  S.useItem(s, 0, X, Y); S.useItem(s, iL, X, Y); S.useItem(s, 0, X + 1, Y); S.useItem(s, iH, X + 1, Y);
  const tL = s.world.tiles[Y * s.world.w + X], tH = s.world.tiles[Y * s.world.w + X + 1];
  tL.moisture = 14; tH.moisture = 14;      // too dry for a normal plant
  assert.ok(S.moistureGrowthFactor(S.feltMoisture(tL, low.genome)) > 0, 'low thirst grows');
  assert.equal(S.moistureGrowthFactor(S.feltMoisture(tH, high.genome)), 0, 'thirsty does not');
  tL.moisture = 60; tH.moisture = 60; tL.crop.growth = 50; tH.crop.growth = 50;
  tickMinutes(s, 60);
  assert.ok(tH.moisture < tL.moisture, 'thirsty plant drinks more: ' + tH.moisture + ' vs ' + tL.moisture);
});
await test('pick up a rack, walk it somewhere, put it down', async () => {
  const W = await import('../src/world.js');
  const s = S.createState(11);
  const from = S.objectPos(s, 'rackHoe');
  assert.equal(W.buildingAt(s.world, from.x, from.y), 'rackHoe');
  assert.ok(S.pickUp(s, 'rackHoe').ok); assert.equal(s.carrying, 'rackHoe');
  assert.equal(W.buildingAt(s.world, from.x, from.y), null, 'tile freed');
  assert.equal(S.pickUp(s, 'rackCan').ok, false, 'hands full');
  s.player.x = X + 0.5; s.player.y = Y + 0.5;
  assert.equal(S.placeObject(s, X, Y).ok, false, 'not under your own feet');
  assert.equal(S.placeObject(s, X + 1, Y).ok, true);
  assert.equal(W.buildingAt(s.world, X + 1, Y), 'rackHoe'); assert.equal(s.carrying, null);
  assert.deepEqual(S.objectPos(s, 'rackHoe'), { x: X + 1, y: Y });
  assert.equal(W.isSolid(s.world, X + 1, Y), true, 'placed object is solid');
  assert.equal(S.takeTool(s, 'hoe').ok, true, 'rack still holds its tool after moving');
  const hoeSlot = s.inventory.slots.findIndex(x => x?.tool === 'hoe');
  assert.equal(S.returnTool(s, 'can', hoeSlot).ok, false, 'wrong rack');
  assert.equal(S.returnTool(s, 'hoe', hoeSlot).ok, true); assert.equal(s.rack.hoe, true); assert.equal(s.inventory.slots[hoeSlot], null);
  S.takeTool(s, 'can'); S.fillCan(s); const canSlot = s.inventory.slots.findIndex(x => x?.tool === 'can'); S.returnTool(s, 'can', canSlot); assert.equal(s.can.water, s.can.capacity, 'water kept on the rack');
  // the seed rack cannot be lifted while something dries on it
  addItem(s.inventory, { kind: 'crop', species: byName(s, 'Carrot').id, qty: 1 }); const i = s.inventory.slots.findIndex(x => x?.kind === 'crop');
  S.putOnSeedRack(s, i); assert.equal(S.pickUp(s, 'seedrack').ok, false);
});
await test('house blocks by its wall pixels: steps and the grass beside the foundation are open', async () => {
  const W = await import('../src/world.js'); const s = S.createState(2); const H = W.BUILDINGS.house, yb = H.y + H.h;
  assert.equal(W.isBlockedAt(s.world, H.x + 2.5, H.y + 1.5), true, 'inside the wall');
  assert.equal(W.isBlockedAt(s.world, H.door.x + 0.5, yb + 0.5), false, 'on the steps');
  assert.equal(W.isBlockedAt(s.world, H.x + 0.5, yb + 0.5), false, 'grass beside the steps, below the foundation');
  assert.equal(W.isBlockedAt(s.world, H.x + 0.5, yb - 0.1), true, 'foundation');
  assert.equal(W.isBlockedAt(s.world, H.x + 0.1, yb - 0.5), false, 'the 4 px of tile left of the wall is open');
});
await test('plants grow through the night while you sleep, at the night rate; needs drain slowly', () => {
  const s = arm(S.createState(4)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  S.useItem(s, 0, X, Y); S.useItem(s, 2, X, Y); const t = s.world.tiles[Y * s.world.w + X]; t.moisture = 95;
  s.minutes = (CONFIG.time.wakeHour + 14) * 60;   // 8pm
  const hunger = s.hunger;
  S.sleep(s);
  assert.ok(t.crop.growth > 20 && t.crop.growth < 100, 'grew overnight but slower than by day: ' + t.crop.growth);
  assert.ok(s.hunger < hunger && s.hunger > hunger - 10 * 100 / CONFIG.needs.hungerHours, 'drained at half rate: ' + s.hunger);
  assert.equal(S.hourOf(s), CONFIG.time.wakeHour);
});
await test('catalogue: order, pay, cart delivers overnight; trays, can, crate, seeds, deed → claim', async () => {
  const C = await import('../src/catalog.js'); const W = await import('../src/world.js');
  const s = S.createState(12); s.money = 500;
  const items = C.catalog(s); assert.ok(items.some(i => i.id === 'tray') && items.filter(i => i.id.startsWith('seeds:')).length === 3);
  assert.ok(C.placeOrder(s, 'bench').ok, 'the bench is orderable'); assert.ok(C.cancelOrder(s, 0).ok);
  for (const id of ['tray', 'can', 'crate', 'deed', items.find(i => i.id.startsWith('seeds:')).id]) assert.ok(C.placeOrder(s, id).ok, id);
  const spent = 500 - s.money; assert.ok(spent > 0 && s.orders.length === 5);
  assert.ok(C.cancelOrder(s, 1).ok); assert.ok(s.orders.length === 4 && 500 - s.money < spent, 'refund');
  assert.ok(C.placeOrder(s, 'can').ok);
  assert.equal(C.catalog(s).find(i => i.id === 'tray').level, '2 / 4', 'pending order counts toward the level');
  const rep = S.sleep(s);
  assert.equal(rep.delivery.count, 5); assert.ok(rep.lines.some(l => l.includes('parcels in the crate')));
  assert.equal(s.parcels.length, 5); assert.equal(s.seedRack.trays.length, 1, 'nothing applied until collected');
  const col = S.collectParcels(s); assert.ok(col.ok && col.lines.length === 5); assert.equal(s.parcels.length, 0);
  assert.equal(s.seedRack.trays.length, 2); assert.equal(s.can.capacity, C.CAN_LEVELS[1]); assert.equal(s.crate.capacity, CONFIG.crate.capacity + C.CRATE_STEP); assert.equal(s.deeds, 1);
  assert.ok(s.inventory.slots.some(i => i?.kind === 'seed' && i.qty === 3), 'seed packet in the bag');
  // two trays dry at once
  addItem(s.inventory, { kind: 'crop', species: byName(s, 'Carrot').id, qty: 2 }); const ci = s.inventory.slots.findIndex(i => i?.kind === 'crop');
  assert.ok(S.putOnSeedRack(s, ci).ok); assert.ok(S.putOnSeedRack(s, ci).ok, 'second tray'); assert.equal(S.putOnSeedRack(s, ci).ok, false, 'no third tray');
  tickMinutes(s, 24 * 60); const t = S.takeSeeds(s); assert.ok(t.ok && t.seeds >= 4, 'seeds from both trays: ' + t.seeds);
  // claim land with the deed
  const target = W.buyableChunks(s.world)[0]; const before = s.world.chunks.length;
  assert.equal(S.claimLand(s, 99, 99).ok, false);
  assert.ok(S.claimLand(s, target.cx, target.cy).ok); assert.equal(s.world.chunks.length, before + 1); assert.equal(s.deeds, 0);
  assert.equal(S.claimLand(s, target.cx + 1, target.cy).ok, false, 'no deed left');
});
await test('breeding bench: ordered, carried, placed; two parents breed overnight into seeds of a new species', async () => {
  const C = await import('../src/catalog.js'); const W = await import('../src/world.js');
  const s = S.createState(13); s.money = 100;
  assert.ok(C.placeOrder(s, 'bench').ok); assert.equal(C.placeOrder(s, 'bench').ok, false, 'one bench');
  S.sleep(s); assert.equal(S.objectPos(s, 'bench'), null, 'not placed yet');
  const col = S.collectParcels(s); assert.ok(col.bench && s.carrying === 'bench');
  s.player.x = X + 0.5; s.player.y = Y + 0.5; assert.ok(S.placeObject(s, X + 1, Y).ok); assert.equal(W.buildingAt(s.world, X + 1, Y), 'bench');
  addItem(s.inventory, { kind: 'seed', species: byName(s, 'Carrot').id, qty: 2 }); addItem(s.inventory, { kind: 'crop', species: byName(s, 'Tomato').id, qty: 1 });
  const si = s.inventory.slots.findIndex(i => i?.kind === 'seed'), ci = s.inventory.slots.findIndex(i => i?.kind === 'crop');
  assert.ok(S.setBreederParent(s, 'a', si).ok); assert.ok(S.setBreederParent(s, 'b', ci).ok);
  const pv = S.breedPreview(s); assert.ok(pv && pv.instability > 0 && pv.crossFamily, 'preview');
  assert.equal(S.pickUp(s, 'bench').ok, false, 'cannot lift a loaded bench');
  const money = s.money; assert.ok(S.startBreed(s).ok); assert.ok(s.money < money && s.breeder.running);
  const before = Object.keys(s.species).length;
  const rep = S.sleep(s); assert.ok(rep.breeder && ['success', 'sterile', 'wither', 'revert'].includes(rep.breeder.outcome));
  if (rep.breeder.outcome === 'success') { assert.ok(Object.keys(s.species).length === before + 1 || !rep.breeder.isNew); assert.ok(s.breeder.result && s.breeder.result.species === rep.breeder.species, 'child seeds wait on the bench'); }
  assert.equal(s.breeder.running, null);
});
await test('day ledger: fills, hoed, planted, crate full hour and the sale close at night; the morning compares days', async () => {
  const s = arm(S.createState(14)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  S.fillCan(s); S.fillCan(s); assert.equal(S.today(s).fills, 1, 'arm() filled once; a full can does not count as a trip');
  const hoe = s.inventory.slots.findIndex(i => i?.tool === 'hoe'), seed = s.inventory.slots.findIndex(i => i?.kind === 'seed');
  assert.ok(S.useItem(s, hoe, X, Y).ok); assert.ok(S.useItem(s, seed, X, Y).ok);
  assert.equal(S.today(s).hoed, 1); assert.equal(S.today(s).planted, 1);
  assert.ok(Math.abs(S.fieldValue(s) - byName(s, 'Carrot').value * byName(s, 'Carrot').genome.count) < 1e-9, 'one carrot planted = one harvest of carrots');
  addItem(s.inventory, { kind: 'crop', species: byName(s, 'Carrot').id, qty: 20 }); const ci = s.inventory.slots.findIndex(i => i?.kind === 'crop');
  assert.ok(S.putInCrate(s, ci).full, 'crate fills'); assert.ok(S.today(s).crateFullAt != null); assert.equal(S.putInCrate(s, ci).ok, false); assert.equal(S.today(s).crateRefused, 1);
  const rep = S.sleep(s); assert.ok(rep.yesterday.sale > 0 && rep.yesterday.sold === s.crate.capacity); assert.equal(rep.dayBefore, null);
  assert.equal(S.yesterday(s).hoed, 1); assert.equal(S.today(s).hoed, 0, 'fresh day');
  const C = await import('../src/catalog.js');
  assert.ok(C.whyLine(s, 'crate').includes('crate full by'), 'the ledger still knows the bottleneck'); assert.equal(C.catalog(s).find(i => i.id === 'crate').why, null, 'but the rows no longer say it');
  assert.ok(C.whyLine(s, 'deed').includes('tiles tilled'));
  const rep2 = S.sleep(s); assert.ok(rep2.dayBefore && rep2.dayBefore.sale === rep.yesterday.sale, 'morning compares with the day before');
});
await test('catalogue lights up: next target, affordable flag clears when the sign is read; sharper hoe is faster and cheaper on energy', async () => {
  const C = await import('../src/catalog.js');
  const s = S.createState(15); s.money = 10;
  const nt = C.nextTarget(s); assert.ok(nt && nt.item.id === 'tray' && Math.abs(nt.gap - 15) < 1e-9, 'cheapest unbought item is the target');
  assert.equal(C.catalogueFlag(s), false, 'nothing affordable, no flag');
  s.money = 30; assert.ok(C.catalogueFlag(s), 'tray and hoe affordable → flag'); C.markCatalogueSeen(s); assert.equal(C.catalogueFlag(s), false, 'read the sign → flag down');
  s.money = 300; assert.ok(C.catalogueFlag(s), 'more became affordable → flag again');
  assert.equal(S.hoeSeconds(s), CONFIG.hoe.seconds[0]);
  assert.ok(C.placeOrder(s, 'hoe').ok); S.sleep(s); S.collectParcels(s);
  assert.equal(s.hoe.level, 1); assert.equal(S.hoeSeconds(s), CONFIG.hoe.seconds[1]); assert.ok(S.hoeEnergy(s) < CONFIG.hoe.energy[0]);
  S.takeTools(s); s.player.x = X + 0.5; s.player.y = Y + 0.5; const e = s.energy; S.useItem(s, s.inventory.slots.findIndex(i => i?.tool === 'hoe'), X, Y); assert.equal(e - s.energy, CONFIG.hoe.energy[1]);
  assert.ok(C.placeOrder(s, 'hoe').ok); S.sleep(s); S.collectParcels(s); assert.equal(C.catalog(s).find(i => i.id === 'hoe').blocked, 'Sharpest hoe');
});
await test('weather: humidity slows evaporation, rain days are humid; the hoe drains a waterlogged bed; one honest night line', async () => {
  const s = arm(S.createState(16)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  const hoe = s.inventory.slots.findIndex(i => i?.tool === 'hoe'); S.useItem(s, hoe, X, Y); const t = s.world.tiles[Y * s.world.w + X];
  t.moisture = 60; s.humidity = 20; s.minutes = 10 * 60; tickMinutes(s, 60); const dryAir = 60 - t.moisture;
  t.moisture = 60; s.humidity = 90; tickMinutes(s, 60); const wetAir = 60 - t.moisture;
  assert.ok(dryAir > wetAir * 2, `dry air ${dryAir} vs humid ${wetAir}`);
  t.moisture = 97; assert.equal(S.drainSoil(s, X + 1, Y).ok, false, 'only beds'); const e = s.energy;
  assert.ok(S.drainSoil(s, X, Y).ok); assert.ok(t.moisture < 97 && s.energy < e); assert.equal(S.drainSoil(s, X, Y).ok, false, 'no longer waterlogged');
  s.hunger = 10; s.thirst = 100; s.minutes = 26 * 60 - 1; const rep = S.sleep(s, { forced: true });
  assert.ok(rep.night.includes('passed out') && rep.night.includes('hungry'), rep.night); assert.equal(rep.lines.filter(l => l.includes('energy')).length, 1, 'one line about the night');
  assert.ok(rep.humidity >= 20 && rep.humidity <= 98); if (rep.rain) assert.ok(rep.humidity >= 85);
  assert.ok(Math.abs(S.effectiveHoursPerDay() - 19) < 1e-9);
});
await test('seed packets rotate every few days, not daily', async () => {
  const C = await import('../src/catalog.js'); const s = S.createState(17);
  const a = C.seedOffers(s).join(); s.minutes += 1440; assert.equal(C.seedOffers(s).join(), a, 'same packets the next day');
  s.minutes += 1440 * CONFIG.catalogSeedDays; assert.notEqual(C.seedOffers(s).join(), a, 'different packets later');
});
await test('too tired really means too tired: no pour, no wet bed, no water lost; actions and walking slow down', () => {
  const s = arm(S.createState(18)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  const hoe = s.inventory.slots.findIndex(i => i?.tool === 'hoe'), can = s.inventory.slots.findIndex(i => i?.tool === 'can');
  S.useItem(s, hoe, X, Y); const t = s.world.tiles[Y * s.world.w + X]; t.moisture = 0;
  s.energy = 0; const water = s.can.water;
  assert.equal(S.useItem(s, can, X, Y).msg, 'Too tired'); assert.equal(t.moisture, 0, 'the bed stays dry'); assert.equal(s.can.water, water, 'the can keeps its water');
  s.energy = 50; assert.ok(S.useItem(s, can, X, Y).ok); assert.equal(t.moisture, CONFIG.soil.waterPerPour); assert.equal(s.can.water, water - 1);
  assert.equal(S.walkFactor(s), 1); assert.equal(S.actionFactor(s), 1);
  s.energy = CONFIG.needs.tiredBelow - 1; assert.ok(S.isTired(s)); assert.equal(S.walkFactor(s), CONFIG.needs.tiredSpeed); assert.equal(S.actionFactor(s), CONFIG.needs.tiredActionSlow);
});
await test('five pockets, a chest by the porch; heavy pockets slow you; old 27-slot saves pour the overflow into the chest', () => {
  const s = arm(S.createState(19));
  assert.equal(s.inventory.slots.length, 5); assert.equal(s.world.tiles[W.BUILDINGS.chest.y * s.world.w + W.BUILDINGS.chest.x].t, 'chest');
  const carrot = byName(s, 'Carrot'), i = s.inventory.slots.findIndex(x => x?.kind === 'seed');
  assert.ok(!S.isHeavy(s)); addItem(s.inventory, { kind: 'crop', species: carrot.id, qty: CONFIG.player.heavyAt }); assert.ok(S.isHeavy(s)); assert.equal(S.walkFactor(s), CONFIG.player.heavySpeed);
  const r = S.stash(s, i); assert.ok(r.ok && r.moved === 5); assert.equal(s.inventory.slots[i], null); assert.equal(s.chest.slots.find(x => x?.kind === 'seed').qty, 5);
  const hoe = s.inventory.slots.findIndex(x => x?.tool === 'hoe'); assert.equal(S.stash(s, hoe).msg, 'Tools hang on the rack');
  const ci = s.chest.slots.findIndex(x => x?.kind === 'seed'); assert.ok(S.moveSome(s, s.chest, ci, s.inventory, 1).ok); assert.equal(s.chest.slots[ci].qty, 4);
  // an old save: 27 pockets with things hiding past the fifth, and no chest tile
  const o = S.createState(20); o.inventory.slots = new Array(27).fill(null); o.inventory.slots[9] = { kind: 'crop', species: carrot.id, qty: 7 }; o.world.tiles[W.BUILDINGS.chest.y * o.world.w + W.BUILDINGS.chest.x].t = 'grass';
  S.migrate(o); assert.equal(o.inventory.slots.length, 5); assert.equal(o.chest.slots.find(x => x?.kind === 'crop').qty, 7); assert.equal(o.world.tiles[W.BUILDINGS.chest.y * o.world.w + W.BUILDINGS.chest.x].t, 'chest');
});
await test('seed dots land in different spots per bed', () => {
  const s = arm(S.createState(21)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  const hoe = s.inventory.slots.findIndex(i => i?.tool === 'hoe'), seed = s.inventory.slots.findIndex(i => i?.kind === 'seed');
  const vs = new Set(); for (let k = 0; k < 4; k++) { s.player.x = X + k + 0.5; S.useItem(s, hoe, X + k, Y); S.useItem(s, seed, X + k, Y); vs.add(s.world.tiles[Y * s.world.w + X + k].crop.v); }
  assert.ok(vs.size >= 2, [...vs].join());
});
await test('a drink at a full bar gives no energy', () => {
  const s = S.createState(22); s.energy = 50; s.thirst = 100;
  assert.equal(S.drink(s).float, 'Not thirsty'); assert.equal(s.energy, 50);
  s.thirst = 20; assert.ok(S.drink(s).float.includes('energy')); assert.equal(s.thirst, 100); assert.equal(s.energy, 54);
  assert.equal(S.drink(s).float, 'Not thirsty'); assert.equal(s.energy, 54);
});
await test('the family never mutates: a child is always in one parent\'s family', () => {
  for (let i = 0; i < 300; i++) { const r = G.cross(G.STARTER_GENOMES.potato, G.WILD_BASES.lettuce, 1000 + i, { mutationBonus: 12 }); assert.ok(['root', 'gourd'].includes(r.child.family), r.child.family); assert.ok(!r.mutations.includes('family')); }
});
await test('midday pickup: the cart empties the crate at noon, pays on the spot, and the day ledger counts both sales', async () => {
  const C = await import('../src/catalog.js'); const s = arm(S.createState(23)); s.money = 500;
  const carrot = byName(s, 'Carrot'); addItem(s.inventory, { kind: 'crop', species: carrot.id, qty: 10 });
  const i = s.inventory.slots.findIndex(x => x?.kind === 'crop'); S.putInCrate(s, i, 4);
  s.minutes = 11 * 60; tickMinutes(s, 120); assert.equal(S.crateCount(s), 4, 'no midday pickup yet');
  assert.ok(C.placeOrder(s, 'pickup').ok); assert.equal(C.catalog(s).find(x => x.id === 'pickup').blocked, 'The cart already comes twice');
  S.sleep(s); S.collectParcels(s); assert.equal(s.crate.pickups, 1); assert.equal(S.crateCount(s), 0, 'the night cart took the 4');
  S.putInCrate(s, s.inventory.slots.findIndex(x => x?.kind === 'crop'), 3); const m = s.money;
  s.minutes = (s.minutes - s.minutes % 1440) + 11 * 60 + 50; tickMinutes(s, 20);
  assert.equal(S.crateCount(s), 0); assert.ok(s.money > m); assert.ok(s.crate.pendingPickup && s.crate.pendingPickup.count === 3); assert.equal(S.today(s).sold, 3);
  s.crate.pendingPickup = null; S.putInCrate(s, s.inventory.slots.findIndex(x => x?.kind === 'crop'), 2); const rep = S.sleep(s);
  assert.equal(rep.yesterday.sold, 5, 'noon 3 + night 2'); assert.equal(rep.sale.count, 2);
});
await test('bred children are named after their parents', () => {
  assert.equal(G.blendName('Lettuce', 'Potato'), 'Lettato'); assert.equal(G.blendName('Turnip', 'Tomato'), 'Turnato');
  assert.equal(G.blendName('Wild Potato', 'Pumpkin'), 'Potkin'); assert.equal(G.blendName('Carrot', 'Tomato'), 'Carrato');
  assert.equal(G.blendName('Crimson Lettato (sterile)', 'Carrot'), 'Lettrot'); assert.equal(G.blendName('Tomato', 'Carrot'), 'Tomrot');
  for (const [a, b] of [['Sweetcorn', 'Lavender'], ['Pea', 'Wheat'], ['Onion', 'Beetroot']]) { const n = G.blendName(a, b); assert.ok(/^[A-Z][a-z]{3,9}$/.test(n), n); }
  const s = S.createState(24); s.money = 500; const ids = Object.keys(s.species);
  for (let i = 0; i < 40; i++) { s.breeder.a = { kind: 'seed', species: ids[0], qty: 1 }; s.breeder.b = { kind: 'seed', species: ids[1], qty: 1 }; S.startBreed(s); const rep = S.sleep(s); s.breeder.result = null; if (rep.breeder.outcome === 'success') { const sp = s.species[rep.breeder.species]; assert.ok(sp.name.endsWith(G.blendName(s.species[ids[0]].name, s.species[ids[1]].name)), sp.name); break; } }
});
await test('breeding pays: each generation steps the price up about ×1.5, and the seed book adds to every sale', () => {
  const base = G.STARTER_GENOMES.carrot, v = gen => G.makeSpecies({ ...base, gen }).value;
  for (let gen = 1; gen <= 6; gen++) { const step = v(gen) / v(gen - 1); assert.ok(step > 1.4 && step < 1.6, `gen ${gen}: ×${step.toFixed(2)}`); }
  assert.ok(v(5) > 5 * v(0), 'five generations: more than five times the starter');
  const s = S.createState(25); const n0 = s.discovered.length, carrot = byName(s, 'Carrot');
  const p0 = S.salePrice(s, { species: carrot.id }); s.discovered.push('x1', 'x2'); const p1 = S.salePrice(s, { species: carrot.id });
  assert.ok(Math.abs(p1 / p0 - (1 + 2 * CONFIG.economy.seedBookBonusPerSpecies)) < 1e-9, `${p0} → ${p1}`); assert.equal(s.discovered.length, n0 + 2);
});
await test('old saves: bred species named by the family table are renamed after their parents', () => {
  const s = S.createState(26); const car = byName(s, 'Carrot'), pot = byName(s, 'Potato');
  const child = G.makeSpecies({ ...G.STARTER_GENOMES.carrot, gen: 1, hue1: 300 }, { parents: [car.id, pot.id], discoveredDay: 5 }); child.name = 'Crimson Radish'; s.species[child.id] = child;
  const grand = G.makeSpecies({ ...G.STARTER_GENOMES.carrot, gen: 2, hue1: 200 }, { parents: [child.id, pot.id], discoveredDay: 7 }); grand.name = 'Pale Radish'; s.species[grand.id] = grand;
  assert.equal(S.renameBred(s), 2); assert.equal(child.name, 'Carrato'); assert.ok(grand.name.endsWith(G.blendName('Carrato', 'Potato')) && grand.name !== 'Carrato', grand.name); assert.ok(child.blended);
  assert.equal(S.renameBred(s), 0, 'only once');
});
await test('cross log explains every gene', () => {
  const r = G.cross(G.STARTER_GENOMES.carrot, G.STARTER_GENOMES.tomato, 99);
  assert.equal(r.log.length, G.GENES.length);
  for (const l of r.log) { assert.ok(['A', 'B', 'blend'].includes(l.from), l.k); assert.equal(l.after, r.child[l.k]); }
  assert.equal(r.traitLog.length, G.RARE_TRAITS.length);
  assert.ok(r.crossFamily && r.instabilityParts.family === CONFIG.genetics.familyDistancePenalty);
});

console.log('compost');
const placeNear = (s, key) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = Math.floor(s.player.x) + dx, y = Math.floor(s.player.y) + dy; if (S.canPlaceAt(s, x, y)) { assert.ok(S.placeObject(s, x, y).ok); return { x, y }; } } throw new Error('nowhere to put the ' + key); };
await test('compost bin: ordered, carried, placed, filled by hand, rots down overnight into bags of fertiliser', async () => {
  const C = await import('../src/catalog.js');
  const s = arm(S.createState(27)); s.money = 500;
  assert.ok(C.catalog(s).some(i => i.id === 'compost' && !i.blocked)); assert.ok(C.placeOrder(s, 'compost').ok);
  assert.equal(C.catalog(s).find(i => i.id === 'compost').blocked, 'You have one', 'one per farm');
  S.sleep(s); assert.ok(s.parcels.some(p => p.id === 'compost'));
  const got = C.collectParcels(s); assert.ok(got.compost && s.carrying === 'compost' && s.hasCompost);
  const pos = placeNear(s, 'compost'); assert.equal(W.buildingAt(s.world, pos.x, pos.y), 'compost'); assert.equal(s.carrying, null); assert.deepEqual(S.objectPos(s, 'compost'), pos);
  assert.equal(S.compostLevel(s), 0); assert.equal(S.compostPreview(s), null);
  const car = byName(s, 'Carrot'); s.inventory.slots[s.inventory.slots.findIndex(it => it?.species === byName(s, 'Turnip').id)] = null;   // five pockets: make room
  addItem(s.inventory, { kind: 'crop', species: car.id, qty: 2 }); addItem(s.inventory, { kind: 'withered', qty: 1 });
  const slotOf = kind => s.inventory.slots.findIndex(it => it?.kind === kind);
  assert.equal(S.addToCompost(s, slotOf('seed')).ok, false, 'seeds do not rot down');
  assert.ok(S.addToCompost(s, slotOf('crop'), 1).ok); assert.equal(S.compostCount(s), 1); assert.equal(S.pickUp(s, 'compost').msg, 'Empty the bin first');
  assert.ok(S.takeFromCompost(s, 0).ok, 'take one back'); assert.equal(S.compostCount(s), 0); assert.equal(s.inventory.slots[slotOf('crop')].qty, 2);
  assert.ok(S.addToCompost(s, slotOf('crop'), 2).ok); assert.ok(S.addToCompost(s, slotOf('withered'), 1).ok);
  assert.equal(S.compostCount(s), 3); assert.equal(S.compostLevel(s), 1); assert.equal(slotOf('withered'), -1);
  const pv = S.compostPreview(s); assert.ok(pv && /compost I{1,3}$/.test(pv.name) && pv.grade >= 1, pv?.name);
  const r = S.sleep(s); assert.ok(s.compost.ready && !s.compost.running && !s.compost.inputs.length, 'the lid shut and the heap rotted');
  assert.equal(S.compostLevel(s), 2); assert.ok(r.compost && r.compost.startsWith(pv.name), r.compost);
  assert.equal(S.canCompost(s).ok, false, 'full of finished compost'); assert.equal(S.pickUp(s, 'compost').ok, false);
  assert.ok(S.takeCompost(s).ok); const fs = slotOf('fert'); assert.ok(fs >= 0 && s.inventory.slots[fs].qty === 1 && s.inventory.slots[fs].fert.id === pv.id);
  assert.equal(S.compostLevel(s), 0); assert.ok(S.pickUp(s, 'compost').ok, 'empty again: can be lifted');
});
await test('compost bin: cap, empty-night message, and only when there is enough', () => {
  const s = arm(S.createState(28)); const car = byName(s, 'Carrot');
  addItem(s.inventory, { kind: 'crop', species: car.id, qty: 20 }); const i = s.inventory.slots.findIndex(it => it?.kind === 'crop');
  assert.ok(S.addToCompost(s, i, 2).ok); const r = S.sleep(s); assert.ok(!s.compost.ready && S.compostCount(s) === 2, 'two is not enough'); assert.ok(r.lines.some(l => l.includes('needs 3')));
  const a = S.addToCompost(s, i, 99); assert.ok(a.ok && a.full && S.compostCount(s) === CONFIG.fertiliser.compostMax); assert.equal(S.canCompost(s).msg, 'The bin is full');
  assert.equal(s.inventory.slots[i].qty, 20 - CONFIG.fertiliser.compostMax);
  S.sleep(s); assert.equal(s.compost.readyCount, S.compostBags(CONFIG.fertiliser.compostMax));
});
await test('fertiliser: works into a tilled bed, speeds growth, quality compost puts stars on the harvest and stars raise the price', () => {
  const s = arm(S.createState(29)); const car = byName(s, 'Carrot');
  s.player.x = X + 0.5; s.player.y = Y + 0.5; s.inventory.slots[s.inventory.slots.findIndex(it => it?.species === byName(s, 'Turnip').id)] = null;
  const fert = { name: 'Quality compost', stats: { quality: 0.5, speed: 0.5 }, id: 'ftest' };
  addItem(s.inventory, { kind: 'fert', fert, qty: 2 }); const fi = s.inventory.slots.findIndex(it => it?.kind === 'fert');
  const t = W.tileAt(s.world, X + 1, Y);
  assert.equal(S.useItem(s, fi, X + 1, Y).msg, 'Fertiliser goes on tilled soil');
  t.tilled = true; const u = S.useItem(s, fi, X + 1, Y); assert.ok(u.ok && u.float === 'Quality compost' && t.fert === fert); assert.equal(S.useItem(s, fi, X + 1, Y).msg, 'Already fertilised');
  const plain = W.tileAt(s.world, X + 1, Y + 1); plain.tilled = true;
  const si = s.inventory.slots.findIndex(it => it?.kind === 'seed' && it.species === car.id);
  assert.ok(S.useItem(s, si, X + 1, Y).ok); assert.ok(S.useItem(s, si, X + 1, Y + 1).ok); wet(s, t); wet(s, plain);
  tickMinutes(s, 60); assert.ok(t.crop.growth > plain.crop.growth * 1.3, `speed: ${t.crop.growth} vs ${plain.crop.growth}`);
  t.crop.growth = 100; const h = S.harvest(s, t, X + 1, Y); assert.ok(h.ok);
  const starred = s.inventory.slots.find(it => it?.kind === 'crop' && it.q >= 2); assert.ok(starred, 'quality 0.5 gives two stars or more');
  assert.equal(t.fert, null, 'used up with the plant');
  const p0 = S.salePrice(s, { species: car.id, q: 0 }), p2 = S.salePrice(s, { species: car.id, q: 2 });
  assert.ok(Math.abs(p2 / p0 - (1 + 2 * CONFIG.fertiliser.qualityStarValue)) < 1e-9, `${p0} → ${p2}`);
  assert.ok(itemKey(starred) !== itemKey({ kind: 'crop', species: car.id, q: 0 }), 'starred crops stack apart');
});

await test('fertiliser grade: a few common crops make a thin batch, a full bin or rarer crops a rich one', () => {
  const s = S.createState(30); const car = byName(s, 'Carrot');
  const thin = makeCompost([{ species: car.id, qty: 3 }], s.species), full = makeCompost([{ species: car.id, qty: CONFIG.fertiliser.compostMax }], s.species);
  assert.equal(thin.grade, 1); assert.ok(thin.name.endsWith(' I'), thin.name); assert.equal(full.grade, 3); assert.ok(full.name.endsWith(' III'), full.name);
  const rare = G.makeSpecies({ ...G.STARTER_GENOMES.carrot, gen: 3 }); s.species[rare.id] = rare; assert.notEqual(rare.tier, 'common');
  const rich = makeCompost([{ species: rare.id, qty: 3 }], s.species); assert.ok(rich.grade >= 2 && rich.stats.quality, `${rich.name} ${JSON.stringify(rich.stats)}`);
});

console.log('value and traits');
await test('the cart pays for what it can see: thirst and hardiness change neither the price nor the rarity', () => {
  const base = G.STARTER_GENOMES.carrot;
  const easy = G.makeSpecies({ ...base, thirst: 0.1, hardiness: 0.9 }), hard = G.makeSpecies({ ...base, thirst: 0.9, hardiness: 0.1 });
  assert.equal(easy.value, hard.value); assert.equal(easy.rarity, hard.rarity);
  // but they pay in pours: a low-water line wants about half the watering of a thirsty one
  const dry = S.poursPerDay(easy.genome), wet = S.poursPerDay(hard.genome);
  assert.ok(wet >= dry * 2 && dry >= 1 && wet <= 5, `${dry} vs ${wet} pours a day`);
});
await test('rare traits appear from nothing only across families; same-family crosses only pass them down', () => {
  const car = G.STARTER_GENOMES.carrot, tur = G.STARTER_GENOMES.turnip, tom = G.STARTER_GENOMES.tomato;
  assert.equal(car.family, tur.family); assert.notEqual(car.family, tom.family);
  let same = 0, across = 0;
  for (let seed = 0; seed < 400; seed++) { const a = G.cross(car, tur, seed), b = G.cross(car, tom, seed); same += a.mutations.filter(m => m.startsWith('trait:')).length; across += b.mutations.filter(m => m.startsWith('trait:')).length; }
  assert.equal(same, 0, 'same family never gains a trait'); assert.ok(across > 0, 'cross family sometimes does');
  const gold = { ...car, traits: { ...car.traits, golden: true } }; let kept = 0;
  for (let seed = 0; seed < 100; seed++) if (G.cross(gold, tur, seed).child.traits.golden) kept++;
  assert.ok(kept > 10, `golden passes down same-family (${Math.round(CONFIG.genetics.rareInheritOne * 100)}% from one parent): ${kept}/100`);
});
await test('the cards can say what a bed earns and how much water a species wants', () => {
  const s = S.createState(31); const car = byName(s, 'Carrot');
  const rate = S.bedRatePerDay(s, car), perHarvest = S.salePrice(s, { species: car.id }) * car.genome.count, harvestsADay = rate / perHarvest;
  assert.ok(harvestsADay > 1 && harvestsADay < CONFIG.time.dayRealSeconds / 60 / G.growRealMinutes(car.genome), `a carrot bed gives ${harvestsADay.toFixed(1)} harvests a day: fewer than perfect, since plants slow at night`);
  const regrow = G.makeSpecies({ ...G.STARTER_GENOMES.carrot, regrow: true }); s.species[regrow.id] = regrow;
  assert.ok(S.bedRatePerDay(s, regrow) > rate, 'a regrowing bed earns more a day');
  const dry = S.poursPerDay({ ...car.genome, thirst: 0.1 }), wet = S.poursPerDay({ ...car.genome, thirst: 0.9 });
  assert.ok(dry < wet && dry >= 0.5 && wet < 6, `${dry} vs ${wet}`); assert.equal(dry * 2, Math.round(dry * 2), 'half pours');
});

await test('the trees stand at the plot edge, and a station left in them is walked to clear ground', () => {
  const s = S.createState('walk');
  const o = W.chunkOrigin(0, 0);
  assert.ok(W.isCleared(s.world, o.x, o.y) && W.isCleared(s.world, o.x + 7, o.y + 7), 'own 8×8');
  assert.ok(W.isTree(s.world, o.x - 1, o.y + 3) && W.isTree(s.world, o.x + 8, o.y + 3) && W.isTree(s.world, o.x + 3, o.y + 8), 'trees right at the edge');
  assert.ok(W.isCleared(s.world, o.x + 2, o.y - 1), 'the yard row above joins the house to the plots');
  // a bench left where the old walkway was
  s.hasBench = true; const bt = W.tileAt(s.world, o.x - 1, o.y + 3); bt.t = 'bench'; s.objects = { bench: { x: o.x - 1, y: o.y + 3 } };
  S.migrate(s);
  const p = S.objectPos(s, 'bench');
  assert.ok(W.isCleared(s.world, p.x, p.y) && W.tileAt(s.world, p.x, p.y).t === 'bench' && bt.t === 'grass', 'moved to clear ground');
});

await test('the hoe digs up a living plant: a seed comes back as the seed, a bigger plant is pulled up for the compost', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 0.5;
  const seeds = () => s.inventory.slots.find(i => i?.kind === 'seed' && i.species === byName(s, 'Carrot').id)?.qty || 0, n0 = seeds();
  assert.ok(S.useItem(s, 0, X, Y).ok, 'hoe'); assert.ok(S.useItem(s, 2, X, Y).ok, 'plant'); assert.equal(seeds(), n0 - 1);
  const t = s.world.tiles[Y * s.world.w + X]; assert.ok(t.crop && !t.crop.dead && S.cropStage(t.crop) === 0);
  let r = S.useItem(s, 0, X, Y);
  assert.ok(r.ok && r.float === 'Seed back' && !t.crop && t.tilled, JSON.stringify(r)); assert.equal(seeds(), n0, 'the seed is back in the pocket');
  assert.ok(S.useItem(s, 2, X, Y).ok, 'plant again'); t.moisture = 60; tickMinutes(s, 60); t.moisture = 60; tickMinutes(s, 60);
  assert.ok(S.cropStage(t.crop) >= 1, 'grown past a seed: ' + t.crop.growth);
  r = S.useItem(s, 0, X, Y);
  assert.ok(r.ok && r.float === 'Pulled up' && !t.crop, JSON.stringify(r));
  const pulled = s.inventory.slots.find(i => i?.kind === 'pulled'); assert.ok(pulled && pulled.species === byName(s, 'Carrot').id, 'the plant is in a pocket');
  assert.equal(S.cropStage(t.crop), null);
  // the pulled plant rots down like a withered one
  const pi = s.inventory.slots.indexOf(pulled); const rc = S.addToCompost(s, pi, 1); assert.ok(rc.ok, JSON.stringify(rc)); assert.equal(S.compostCount(s), 1); assert.equal(s.compost.inputs[0].species, null);
  // no free pocket: the plant stays in the ground
  assert.ok(S.useItem(s, 2, X, Y).ok, 'plant'); t.moisture = 60; tickMinutes(s, 60); t.moisture = 60; tickMinutes(s, 60);
  for (let i = 0; i < s.inventory.slots.length; i++) if (!s.inventory.slots[i]) s.inventory.slots[i] = { kind: 'fert', qty: 1, fert: { id: 'x' + i, name: 'x' } };
  r = S.useItem(s, 0, X, Y); assert.equal(r.msg, 'No pocket free'); assert.ok(t.crop, 'still growing');
});

await test('an old save\'s wild strawberry takes the berry shape on load', () => {
  const s = S.createState(1), sp = G.wildSpecies(makeRng(3), 'strawberry'); s.species[sp.id] = sp;
  sp.genome.archetype = 'taper'; sp.genome.pattern = 'dots';
  S.migrate(s);
  assert.equal(sp.genome.archetype, 'berry'); assert.equal(sp.genome.pattern, 'none');
  assert.equal(s.species[byName(s, 'Carrot').id].genome.archetype, 'taper', 'starter species untouched');
});

console.log('automation');
await test('a sprinkler tops up every bed around it the moment it dries below the band, never a wet one, and the night bills the pours', () => {
  const s = arm(S.createState(1)); s.player.x = X + 0.5; s.player.y = Y + 1.5; s.money = 50; const S0 = CONFIG.soil;
  addItem(s.inventory, { kind: 'sprinkler', qty: 1 }); const slot = s.inventory.slots.findIndex(i => i?.kind === 'sprinkler');
  const beds = [[X - 1, Y], [X + 1, Y + 1], [X - 1, Y + 2], [X + 1, Y]];
  for (const [x, y] of beds) { assert.ok(S.useItem(s, 0, x, y).ok, 'hoe'); }
  for (const [x, y] of beds.slice(0, 3)) assert.ok(S.useItem(s, 2, x, y).ok, 'plant');   // the fourth bed stays empty
  assert.equal(S.useItem(s, slot, X - 1, Y).msg, 'A plant grows there');
  assert.ok(S.useItem(s, slot, X, Y + 1).ok, 'set'); assert.ok(S.isSprinkler(s.world.tiles[(Y + 1) * s.world.w + X]));
  const tile = (x, y) => s.world.tiles[y * s.world.w + x];
  { const well = WB.well; for (let y = well.y + 1; y <= Y + 1; y++) tile(well.x, y).pipe = true; for (let x = X; x <= well.x; x++) tile(x, Y + 1).pipe = true; tile(well.x, well.y + 1).obj = { kind: 'pump', level: 0 }; s.pipeRev = 1; }   // a pipe line from the well to the sprinkler, with a hand pump at the well: the farm is past the well's own reach
  assert.ok(S.sprinklerFed(s, X, Y + 1), 'fed');
  tile(X + 1, Y + 1).moisture = 60;                       // already wet: no spray
  const topTo = Math.min(S0.idealMax, S0.idealMin + S0.waterPerPour), perMin = S0.waterPerPour / CONFIG.sprinkler.sprayMinutes;
  tickMinutes(s, 5);                                      // gradual: five minutes wets a bone-dry bed a quarter of a pour, not a pour at once
  for (const [x, y] of [beds[0], beds[2], beds[3]]) assert.ok(Math.abs(S.moistureOf(tile(x, y)) - 5 * perMin) < 0.5 && tile(x, y).spray, `bed ${x},${y} after five minutes: ${S.moistureOf(tile(x, y))}`);
  assert.ok(tile(X, Y + 1).obj.sprayUntil > s.minutes, 'it is spraying');
  tickMinutes(s, 60);                                     // long enough to top up: it stops a pour above the band
  for (const [x, y] of [beds[0], beds[2], beds[3]]) { const mo = S.moistureOf(tile(x, y)); assert.ok(mo > S0.idealMin && mo <= topTo && !tile(x, y).spray, `bed ${x},${y} topped up: ${mo}`); }
  assert.ok(S.moistureOf(tile(X + 1, Y + 1)) <= 60 && S.moistureOf(tile(X + 1, Y + 1)) > 50, 'wet bed left alone');
  assert.ok(Math.abs(s.water.pours - 3 * topTo / S0.waterPerPour) < 0.1, 'the meter counts the water: ' + s.water.pours);
  assert.ok(S.sprinklerCovers(s, X - 1, Y) && !S.sprinklerCovers(s, X + 3, Y));
  const p1 = s.water.pours; tickMinutes(s, 60); assert.equal(s.water.pours, p1, 'an hour in the band: nothing');
  tile(X - 1, Y).moisture = S0.idealMin - 1; tickMinutes(s, 0.05); assert.ok(s.water.pours > p1 && s.water.pours < p1 + 0.01 && tile(X - 1, Y).spray, 'the moment a bed dips under the band the spray turns to it');
  tickMinutes(s, 30); assert.ok(S.moistureOf(tile(X - 1, Y)) > S0.idealMin + 30 && !tile(X - 1, Y).spray, 'topped up in half an hour');
  s.minutes = (S.dayOf(s) - 1) * 1440 + 19 * 60; const m = s.money, tot = s.water.pours;
  const rep = S.sleep(s);
  assert.ok(rep.water && rep.water.pours === Math.round(tot) && Math.abs(rep.water.bill - Math.round(tot * CONFIG.sprinkler.pricePerPour * 100) / 100) < 1e-9, JSON.stringify(rep.water) + ' for ' + tot);
  assert.ok(Math.abs(s.money - (m - rep.water.bill)) < 1e-9, 'bill taken'); assert.equal(s.water.pours, 0);
  const r = S.useItem(s, 0, X, Y + 1);                    // the hoe picks it up
  assert.ok(r.ok && r.float === 'Picked up' && !tile(X, Y + 1).obj && s.inventory.slots.some(i => i?.kind === 'sprinkler'));
});
await test('the catalogue sells sprinklers at a flat price and the cart delivers them to a pocket', async () => {
  const { catalog, placeOrder } = await import('../src/catalog.js');
  const s = arm(S.createState(1)); s.money = 1e6;
  const price = () => catalog(s).find(i => i.id === 'sprinkler').price;
  const p0 = price(); assert.equal(p0, CONFIG.sprinkler.tiers[0].price);
  assert.ok(placeOrder(s, 'sprinkler').ok); assert.equal(price(), p0, 'flat: the next one costs the same');
  S.sleep(s); assert.ok(s.parcels.some(p => p.id === 'sprinkler'));
  const r = S.collectParcels(s); assert.ok(r.ok, r.msg);
  assert.ok(s.inventory.slots.some(i => i?.kind === 'sprinkler') || s.chest.slots.some(i => i?.kind === 'sprinkler'));
});


await test('pipe: laid from the well a tile at a time; a sprinkler runs only on pipe the well feeds; the hoe picks sections up', () => {
  const s = arm(S.createState(1)); const W = s.world, well = WB.well; s.money = 50; s.inventory.slots[3] = null;   // five pockets: hoe, can, carrot seeds, pipe, sprinkler
  assert.equal(addItem(s.inventory, { kind: 'pipe', qty: 10 }), 0); assert.equal(addItem(s.inventory, { kind: 'sprinkler', qty: 1 }), 0);
  const pipe = () => s.inventory.slots.findIndex(i => i?.kind === 'pipe'), spr = s.inventory.slots.findIndex(i => i?.kind === 'sprinkler');
  const tile = (x, y) => W.tiles[y * W.w + x];
  // a line down from the well through the yard, one step west, then onto the starter land: the end is E = (33,22)
  const E = { x: well.x - 1, y: 22 }, line = [[well.x, 17], [well.x, 18], [well.x, 19], [well.x, 20], [well.x, 21], [E.x, 21], [E.x, E.y]];
  for (const [x, y] of line) { s.player.x = x - 0.5; s.player.y = y + 0.5; const r = S.useItem(s, pipe(), x, y); assert.ok(r.ok, `${x},${y}: ${r.msg}`); assert.ok(tile(x, y).pipe); assert.ok(/^Laid \(\d+\)$/.test(r.float) || r.float === 'Laid (dry)', r.float); }
  assert.equal(s.inventory.slots.find(i => i?.kind === 'pipe').qty, 3);
  assert.ok(S.pipeLinked(s, E.x, E.y) && !S.pipeFed(s, E.x, E.y), 'the end of the line is linked but past the well\'s own reach');
  tile(well.x, well.y + 1).obj = { kind: 'pump', level: 0 }; s.pipeRev++;   // a hand pump at the well head carries it on
  assert.ok(S.pipeFed(s, E.x, E.y), 'the end of the line is fed');
  // a loose section away from the line is dry
  s.player.x = 28.5; s.player.y = 23.5; let r = S.useItem(s, pipe(), 28, 24); assert.ok(r.ok && r.float === 'Laid (dry)', JSON.stringify(r)); assert.ok(!S.pipeFed(s, 28, 24));
  // not through a bed, not on the track, not in the trees
  // under a bed: the bed stays a bed; the hoe flattens it first and lifts the pipe second
  assert.ok(S.useItem(s, 0, 28, 23).ok, 'hoe a bed'); r = S.useItem(s, pipe(), 28, 23); assert.ok(r.ok && r.float === 'Laid (dry) under the bed' && s.world.tiles[23 * s.world.w + 28].tilled && s.world.tiles[23 * s.world.w + 28].pipe, JSON.stringify(r));
  r = S.useItem(s, 0, 28, 23); assert.ok(r.ok && r.float === 'Flattened' && r.msg === 'Flattened: the hoe lifts what ran under it next' && s.world.tiles[23 * s.world.w + 28].pipe, JSON.stringify(r));
  r = S.useItem(s, 0, 28, 23); assert.ok(r.ok && r.float === 'Pipe up' && !s.world.tiles[23 * s.world.w + 28].pipe, JSON.stringify(r));
  s.player.x = 34.5; s.player.y = 26.5; assert.equal(S.useItem(s, pipe(), 34, 27).msg, 'Pipe goes on clear ground');
  // a sprinkler at the end of the line runs; one on the loose section is dry
  s.player.x = E.x + 0.5; s.player.y = E.y + 1.5; r = S.useItem(s, spr, E.x, E.y); assert.ok(r.ok && r.msg === '', JSON.stringify(r)); assert.ok(S.sprinklerFed(s, E.x, E.y));
  const B = { x: E.x - 1, y: E.y };
  assert.ok(S.useItem(s, 0, B.x, B.y).ok, 'hoe'); assert.ok(S.useItem(s, 2, B.x, B.y).ok, 'plant'); tile(B.x, B.y).moisture = 0;
  tickMinutes(s, 0.05); assert.ok(S.moistureOf(tile(B.x, B.y)) > 0, 'the fed sprinkler poured');
  assert.ok(S.sprinklerCovers(s, B.x, B.y));
  addItem(s.inventory, { kind: 'sprinkler', qty: 1 }); s.player.x = 28.5; s.player.y = 25.5;
  r = S.useItem(s, s.inventory.slots.findIndex(i => i?.kind === 'sprinkler'), 28, 24); assert.ok(r.ok && /Dry/.test(r.msg), JSON.stringify(r));
  assert.ok(!S.sprinklerFed(s, 28, 24)); assert.ok(!S.sprinklerCovers(s, 27, 24));
  // break the line in the middle: the end goes dry, the pours stop
  s.player.x = well.x - 0.5; s.player.y = 19.5; r = S.useItem(s, 0, well.x, 19); assert.ok(r.ok && r.float === 'Pipe up', JSON.stringify(r)); assert.ok(!tile(well.x, 19).pipe);
  assert.ok(!S.pipeFed(s, E.x, E.y) && S.pipeFed(s, well.x, 18), 'fed up to the break only');
  tile(B.x, B.y).moisture = 0; const p = s.water.pours; tickMinutes(s, 0.05); assert.equal(s.water.pours, p, 'no pour from a dry sprinkler'); assert.equal(S.moistureOf(tile(B.x, B.y)), 0);
  // the hoe takes the sprinkler first, then the pipe under it
  s.player.x = E.x + 0.5; s.player.y = E.y + 1.5; assert.equal(S.useItem(s, 0, E.x, E.y).float, 'Picked up'); assert.equal(S.useItem(s, 0, E.x, E.y).float, 'Pipe up'); assert.ok(!tile(E.x, E.y).pipe);
});

await test('the catalogue sells pipe by the pack, and an old save with sprinklers gets two packs in the chest', async () => {
  const { catalog, placeOrder } = await import('../src/catalog.js');
  const s = arm(S.createState(1)); s.money = 100;
  const item = catalog(s).find(i => i.id === 'pipe'); assert.ok(item && item.price === CONFIG.pipe.packPrice && item.group === 'Water');
  assert.ok(placeOrder(s, 'pipe').ok);
  s.minutes = (S.dayOf(s) - 1) * 1440 + 19 * 60; S.sleep(s); S.collectParcels(s);
  assert.equal(s.inventory.slots.find(i => i?.kind === 'pipe')?.qty, CONFIG.pipe.packSize);
  const o = S.createState(2); o.world.tiles[23 * o.world.w + 28].obj = { kind: 'sprinkler' }; delete o.pipesGifted;
  S.migrate(o); assert.equal(o.chest.slots.find(i => i?.kind === 'pipe')?.qty, 2 * CONFIG.pipe.packSize); assert.ok(o.pipesGifted);
  S.migrate(o); assert.equal(o.chest.slots.filter(i => i?.kind === 'pipe').length, 1, 'gifted once');
});

console.log('demand and vigour');
await test('the buyer takes 8 of a kind at full price and the cart sells the rest on cheaper, so a mixed crate pays more', () => {
  const s = S.createState(1); const D = CONFIG.demand;
  const corn = byName(s, 'Sweetcorn') || Object.values(s.species).find(sp => /corn/i.test(sp.name)), carrot = byName(s, 'Carrot'), turnip = byName(s, 'Turnip');
  const each = salePrice(s, { species: corn.id });
  assert.equal(S.demandFactor(1), 1); assert.equal(S.demandFactor(D.full), 1); assert.equal(S.demandFactor(D.full + 1), D.steps[0]); assert.equal(S.demandFactor(2 * D.full + 1), D.steps[1]); assert.equal(S.demandFactor(99), D.steps[D.steps.length - 1]);
  const P = S.priceCrate(s, [{ kind: 'crop', species: corn.id, qty: 24 }]);
  assert.equal(P.count, 24); assert.equal(P.lines.length, 1); assert.equal(P.lines[0].full, 8); assert.equal(P.lines[0].cut, 16);
  assert.ok(Math.abs(P.total - each * (8 + 8 * 0.6 + 8 * 0.4)) < 0.011, `24 of one kind pay two thirds: ${P.total} vs ${each * 16}`);
  const M = S.priceCrate(s, [{ kind: 'crop', species: corn.id, qty: 8 }, { kind: 'crop', species: carrot.id, qty: 8 }, { kind: 'crop', species: turnip.id, qty: 8 }]);
  assert.ok(M.lines.every(l => !l.cut), 'three kinds of eight all at full price');
  // stars go to the buyer first
  const Q = S.priceCrate(s, [{ kind: 'crop', species: corn.id, qty: 8, q: 0 }, { kind: 'crop', species: corn.id, qty: 2, q: 2 }]);
  assert.ok(Math.abs(Q.total - (salePrice(s, { species: corn.id, q: 2 }) * 2 + each * (6 + 2 * D.steps[0]))) < 0.011, 'the starred two sell at full, two plain ones take the cut');
  // the crate's sale uses the same pricing, and the hover's tonight figure matches it
  s.crate.items = [{ kind: 'crop', species: corn.id, qty: 24 }]; s.crate.capacity = 24;
  const tonight = S.crateValue(s), m = s.money, sale = S.collectCrate(s);
  assert.ok(Math.abs(sale.total - tonight) < 1e-9 && Math.abs(s.money - m - sale.total) < 1e-9); assert.equal(sale.lines[0].cut, 16);
});

await test('hybrid vigour: a cross between families steps the price up and passes down; a same-family cross lets it fade; old saves get 0', () => {
  const G2 = CONFIG.genetics;
  for (const sp of Object.values(S.createState(1).species)) assert.equal(sp.genome.vigor, 0, sp.name + ' starts without vigour');
  const r = G.cross(G.STARTER_GENOMES.corn, G.STARTER_GENOMES.tomato, 5);
  assert.ok(r.crossFamily); const v = r.child.vigor; assert.ok(v >= G2.vigorStep - 1e-9 && v <= G2.vigorStep + G2.vigorJitter + 1e-9, 'first cross: ' + v);
  const child = G.makeSpecies(r.child), plain = G.makeSpecies({ ...r.child, vigor: 0 });
  assert.ok(Math.abs(child.value / plain.value - (1 + G2.vigorValue * v)) < 0.02, `vigour multiplies the price: ${child.value} vs ${plain.value}`);
  const l = r.log.find(l => l.k === 'vigor'); assert.ok(l && l.from === 'blend' && l.after === child.genome.vigor);
  const r2 = G.cross(r.child, G.STARTER_GENOMES.pumpkin, 6); assert.ok(r2.crossFamily && r2.child.vigor > v, 'a second cross-family generation steps up again: ' + r2.child.vigor);
  const r3 = G.cross(r.child, { ...r.child, hue1: 200 }, 7); assert.ok(!r3.crossFamily && r3.child.vigor < v && r3.child.vigor > 0, 'same family: it fades, not vanishes: ' + r3.child.vigor);
  const o = S.createState(2); for (const sp of Object.values(o.species)) delete sp.genome.vigor; S.migrate(o); assert.ok(Object.values(o.species).every(sp => sp.genome.vigor === 0));
});

await test('field chests: bought and carried like the bench, put down on any open grass, filled by hand, lifted with what is in it; a machine that lands in the chest says so', async () => {
  const { catalog, placeOrder } = await import('../src/catalog.js'); const s = arm(S.createState(1)); const C2 = CONFIG.chest.field; s.money = 500; s.player.x = X + 0.5; s.player.y = Y + 1.5;
  assert.ok(catalog(s).some(i => i.id === 'chest' && i.price === C2.price), 'the catalogue sells it');
  assert.ok(placeOrder(s, 'chest').ok); S.sleep(s); let r = S.collectParcels(s); assert.ok(r.chest && s.carrying === 'chest' && s.carriedChest?.slots.length === C2.slots, r.lines.join('|'));
  s.player.x = X + 0.5; s.player.y = Y + 1.5;   // the night took you home
  assert.ok(!S.placeObject(s, WB.well.x, WB.well.y + 1).ok, 'too far');
  r = S.placeObject(s, X + 1, Y); assert.ok(r.ok, r.msg); const t = s.world.tiles[Y * s.world.w + X + 1]; assert.ok(S.isChest(t) && t.obj.slots.length === C2.slots && !s.carrying && !s.carriedChest);
  assert.equal(S.chestTiles(s).length, 1);
  const carrot = byName(s, 'Carrot'); addItem(s.inventory, { kind: 'crop', species: carrot.id, qty: 7 }); const ci = s.inventory.slots.findIndex(i => i?.kind === 'crop');
  r = S.stash(s, ci, t.obj); assert.ok(r.ok && r.moved === 7, JSON.stringify(r)); assert.equal(t.obj.slots[0].qty, 7); assert.equal(s.chest.slots.filter(Boolean).length, 0, 'the porch chest got nothing');
  assert.equal(S.useItem(s, 0, X + 1, Y).msg, 'Hold on it to pick it up');
  assert.ok(S.pickUpChest(s, X + 1, Y).ok); assert.ok(!t.obj && s.carrying === 'chest' && s.carriedChest.slots[0].qty === 7, 'carried with what is in it');
  s.player.x = X + 1.5; r = S.placeObject(s, X + 2, Y); assert.ok(r.ok, r.msg); assert.equal(s.world.tiles[Y * s.world.w + X + 2].obj.slots[0].qty, 7); assert.ok(!s.carrying);
  // the yard is fine too: any open grass that is yours
  assert.ok(S.pickUpChest(s, X + 2, Y).ok); let spot = null; for (let y = W.YARD.y0; y <= W.YARD.y1 && !spot; y++) for (let x = W.YARD.x0; x <= W.YARD.x1 && !spot; x++) { s.player.x = x + 0.5; s.player.y = y + 1.5; if (S.canPlaceAt(s, x, y)) spot = [x, y]; }
  assert.ok(spot, 'somewhere in the yard'); r = S.placeObject(s, spot[0], spot[1]); assert.ok(r.ok, 'in the yard: ' + r.msg); assert.equal(s.world.tiles[spot[1] * s.world.w + spot[0]].obj.slots[0].qty, 7);
  // a chest still in a pocket (an older delivery) is set down with a click and sells back second-hand
  s.player.x = X + 0.5; s.player.y = Y + 1.5; addItem(s.inventory, { kind: 'chest', qty: 1 }); const slot = () => s.inventory.slots.findIndex(i => i?.kind === 'chest');
  assert.equal(S.secondHand(s.inventory.slots[slot()]), C2.price * CONFIG.crate.secondHand);
  assert.ok(S.useItem(s, 0, X, Y).ok, 'hoe a bed'); assert.equal(S.useItem(s, slot(), X, Y).msg, 'Flatten the bed first');
  r = S.useItem(s, slot(), X + 1, Y); assert.ok(r.ok && r.float === 'Set', JSON.stringify(r)); assert.equal(S.chestTiles(s).length, 2); assert.equal(slot(), -1);
  // a windmill bought with full pockets lands in the porch chest, and the collection line says so
  s.money = 1000; const empties = s.inventory.slots.map((it, i) => it ? -1 : i).filter(i => i >= 0); for (const i of empties) s.inventory.slots[i] = { kind: 'sprinkler', level: 0, qty: 1 };
  assert.ok(placeOrder(s, 'pump1').ok); S.sleep(s); r = S.collectParcels(s); assert.ok(r.lines.some(l => /Windmill: no pocket free, so it went in the chest by the porch/.test(l)), r.lines.join('|'));
  assert.ok(s.chest.slots.some(i => i?.kind === 'pump' && i.level === 1), 'it is in the chest'); assert.equal(s.parcels.length, 0);
});

console.log('pumps');
await test('flow: the well gives a few tiles, a tile costs 1, a sprinkler drinks its draw, a pump in the flow adds its head from where it stands, a split gives each branch what it asks for and shares the rest; the windmill stands still in calm air; the engine burns a can a night', () => {
  const s = arm(S.createState(1)); const W = s.world, well = WB.well; s.money = 100; s.humidity = 50; const H0 = CONFIG.pump.wellHead, T = CONFIG.pump.tiers;
  const tile = (x, y) => W.tiles[y * W.w + x];
  // a trunk from the well down to row Y+1, then west along it: sprinklers at four distances
  const row = Y + 1; for (let y = well.y + 1; y <= row; y++) tile(well.x, y).pipe = true; for (let x = X - 1; x <= well.x; x++) tile(x, row).pipe = true;
  const chain = []; for (let y = well.y + 1; y <= row; y++) chain.push([well.x, y]); for (let x = well.x - 1; x >= X - 1; x--) chain.push([x, row]);   // the whole line in order from the well
  const spots = [X + 4, X + 2, X, X - 1].map(x => ({ x, y: row }));   // nearest to the well first
  for (const { x, y } of spots) tile(x, y).obj = { kind: 'sprinkler' };
  s.pipeRev = 1;
  // the reference walk along a single chain: what every tile should get
  const walk = () => { let r = H0; for (const [x, y] of chain) { const t = tile(x, y), h = r; assert.equal(S.headAt(s, x, y), h, `head at ${x},${y}`); assert.equal(S.pipeFed(s, x, y), h > 0, `wet at ${x},${y}`);
    if (t.obj?.kind === 'sprinkler') { const d = S.sprinklerTier(t.obj).draw; assert.equal(S.sprinklerFed(s, x, y), h >= d, `sprinkler at ${x},${y}`); if (h >= d) r -= d; }
    if (t.obj?.kind === 'pump') { if (h > 0 && S.pumpRunning(s, t)) r += S.pumpTier(t.obj).head; assert.equal(S.pumpInFlow(s, x, y), h > 0 && S.pumpRunning(s, t)); }
    r = Math.max(0, r - 1); } };
  walk();
  assert.equal(S.headAt(s, well.x, well.y + 1), H0, 'the first tile has the well\'s whole head'); assert.equal(S.headAt(s, well.x, well.y + H0), 1); assert.equal(S.headAt(s, well.x, well.y + H0 + 1), 0, 'and then it runs out');
  assert.ok(S.pipeLinked(s, X - 1, row) && !S.pipeFed(s, X - 1, row), 'the row is linked to the well but dry');
  assert.ok(spots.every(({ x, y }) => !S.sprinklerFed(s, x, y)), 'no pump: nothing on the farm runs');
  s.player.x = X - 0.5; s.player.y = row + 2.5; assert.ok(S.useItem(s, 0, X - 1, row + 1).ok, 'hoe a bed under the far sprinkler');
  tickMinutes(s, 0.05); assert.equal(S.moistureOf(tile(X - 1, row + 1)), 0, 'no flow, no pour');
  // a hand pump where the flow has already run out does nothing; in the flow it carries it on
  addItem(s.inventory, { kind: 'pump', level: 0, qty: 1 }); const slot = () => s.inventory.slots.findIndex(i => i?.kind === 'pump');
  s.player.x = well.x - 0.5; s.player.y = row + 0.5;
  let r = S.useItem(s, slot(), well.x, row); assert.ok(r.ok && /runs out before here/.test(r.msg), JSON.stringify(r)); assert.ok(!S.pumpInFlow(s, well.x, row)); walk();
  assert.ok(S.useItem(s, 0, well.x, row).ok, 'take it back'); assert.ok(tile(well.x, row).pipe);
  s.player.x = well.x + 0.5; s.player.y = well.y + 3.5;
  assert.equal(S.useItem(s, slot(), well.x + 1, well.y + 2).msg, 'A pump sits on a pipe');
  r = S.useItem(s, slot(), well.x, well.y + 2); assert.ok(r.ok && r.msg === '' && r.float === 'Set', JSON.stringify(r)); assert.ok(S.isPump(tile(well.x, well.y + 2)));
  walk(); assert.equal(S.pressure(s).running, 1);
  assert.equal(S.headAt(s, well.x, well.y + 2), H0 - 1, 'the pump\'s own tile gets what arrives'); assert.equal(S.headAt(s, well.x, well.y + 3), H0 - 1 + T[0].head - 1, 'the next gets that plus the pump\'s head, less the tile');
  assert.ok(spots.every(({ x, y }) => S.sprinklerFed(s, x, y)), 'with the pump every sprinkler runs');
  tickMinutes(s, 0.05); assert.ok(S.moistureOf(tile(X - 1, row + 1)) > 0, 'and the far one pours');
  // a split: a dead-end stub north off the row asks for 2 (two tiles on), the west run asks for its three sprinklers and
  // the tiles between; each gets what it asks for and the rest is shared, nothing dropped
  for (let y = row - 1; y >= row - 3; y--) tile(X + 3, y).pipe = true; s.pipeRev++;
  const atFork = S.headAt(s, X + 3, row), west = S.headAt(s, X + 2, row), north = S.headAt(s, X + 3, row - 1), westNeed = 1 + 1 + 1 + 1 + 1 + 1;   // X+2 (1) · X+1 · X (1) · X-1 (1) and the three steps
  assert.ok(atFork - 1 > westNeed + 2, 'plenty at the fork: ' + atFork);
  assert.equal(west + north, atFork - 1, 'everything that arrives is handed on'); assert.ok(north >= 2 && west >= westNeed, `west ${west} north ${north}`);
  assert.equal(north - 2, Math.floor((atFork - 1 - westNeed - 2) / 2), 'the stub gets its 2 and half the surplus'); assert.equal(S.headAt(s, X + 3, row - 2), north - 1);
  assert.ok([X + 2, X, X - 1].every(x => S.sprinklerFed(s, x, row)), 'the west run still runs');
  // starve it: with just the well's head at the fork (pump off) the stub would have taken half; now the long run gets what little there is
  tile(X + 3, row).obj = { kind: 'sprinkler', level: 1 }; s.pipeRev++;   // a Sprinkler II at the fork drinks 2 first
  const fewer = S.headAt(s, X + 3, row) - 2 - 1; assert.ok(fewer < westNeed + 2, 'now short: ' + fewer);
  const w2 = S.headAt(s, X + 2, row), n2 = S.headAt(s, X + 3, row - 1); assert.equal(w2 + n2, fewer); assert.equal(n2, Math.min(2, Math.floor(fewer / 2))); assert.equal(w2, fewer - n2);
  tile(X + 3, row).obj = null; for (let y = row - 1; y >= row - 3; y--) tile(X + 3, y).pipe = false; s.pipeRev++; walk();
  // the hoe takes the pump back with its level, and the flow drops again
  r = S.useItem(s, 0, well.x, well.y + 2); assert.ok(r.ok && r.float === 'Picked up'); assert.ok(tile(well.x, well.y + 2).pipe, 'the pipe stays');
  assert.ok(s.inventory.slots.some(i => i?.kind === 'pump' && i.level === 0)); assert.ok(!S.sprinklerFed(s, X - 1, row)); walk();
  // a windmill: still when the air is calm
  s.inventory.slots[slot()] = { kind: 'pump', level: 1, qty: 1 };
  r = S.useItem(s, slot(), well.x, well.y + 2); assert.ok(r.ok, r.msg);
  s.humidity = T[1].stillBelow - 1; assert.ok(!S.pumpRunning(s, tile(well.x, well.y + 2))); walk(); assert.ok(!S.sprinklerFed(s, X + 4, row), 'calm day: no help');
  s.humidity = 60; assert.ok(S.pumpRunning(s, tile(well.x, well.y + 2))); walk(); assert.ok(S.sprinklerFed(s, X - 1, row), 'wind: it turns and the whole row runs');
  // an engine on loose pipe counts for nothing and burns nothing; in the flow it burns a can a night
  tile(28, 26).pipe = true; tile(28, 26).obj = { kind: 'pump', level: 2, fuel: 2 }; s.pipeRev++;   // a loose section, no line to the well
  assert.ok(!S.pipeLinked(s, 28, 26) && !S.pumpInFlow(s, 28, 26)); walk();
  s.minutes = (S.dayOf(s) - 1) * 1440 + 19 * 60; let m = s.money; let rep = S.sleep(s); assert.ok(!rep.fuel, 'no fuel for a loose engine: ' + JSON.stringify(rep.fuel));
  tile(well.x, well.y + 1).obj = { kind: 'pump', level: 2 }; s.pipeRev++;   // in the flow but with an empty tank: it stands still
  s.humidity = 60;   // the night rerolled the air: give the windmill its wind back
  assert.ok(!S.pumpRunning(s, tile(well.x, well.y + 1)), 'no fuel: the engine stands still'); walk();
  // fuel is poured in by hand, a can at a time; a running engine burns a can a night and the morning says so
  s.inventory.slots[s.inventory.slots.findIndex(i => !i || i.kind === 'seed')] = { kind: 'fuel', qty: 3 }; const fs = s.inventory.slots.findIndex(i => i?.kind === 'fuel');
  s.player.x = well.x + 0.5; s.player.y = well.y + 2.5;
  assert.equal(S.useItem(s, fs, well.x, well.y + 2).msg, 'It burns nothing', 'a windmill takes no fuel');
  let rf = S.useItem(s, fs, well.x, well.y + 1); assert.ok(rf.ok && rf.float === '+3 fuel' && rf.fuel === 3, JSON.stringify(rf)); assert.ok(!s.inventory.slots[fs], 'the cans are gone from the pocket');
  assert.ok(S.pumpRunning(s, tile(well.x, well.y + 1)) && S.pumpInFlow(s, well.x, well.y + 1)); walk(); assert.equal(S.headAt(s, well.x, well.y + 2), H0 + T[2].head - 1, 'fuelled, it runs');
  s.minutes = (S.dayOf(s) - 1) * 1440 + 19 * 60; m = s.money; rep = S.sleep(s);
  assert.equal(rep.fuel.cans, T[2].fuelPerDay, 'one can burned: ' + JSON.stringify(rep.fuel)); assert.equal(tile(well.x, well.y + 1).obj.fuel, 3 - T[2].fuelPerDay);
  assert.ok(Math.abs(s.money - (m + (rep.sale?.total || 0) - (rep.water?.bill || 0))) < 1e-9, 'no money taken for fuel: the cans were paid for already');
  assert.ok(rep.lines.some(l => /Fuel: 1 can burned/.test(l)), rep.lines.join(' | '));
  tile(well.x, well.y + 1).obj.fuel = 1; s.minutes = (S.dayOf(s) - 1) * 1440 + 19 * 60; rep = S.sleep(s); assert.equal(rep.fuel.dry, 1, 'the last can: it reports running dry'); assert.ok(rep.lines.some(l => /out of fuel/.test(l)));
  assert.ok(!S.pumpRunning(s, tile(well.x, well.y + 1)), 'and stands still in the morning');
  s.inventory.slots[fs] = { kind: 'fuel', qty: 9 }; rf = S.useItem(s, fs, well.x, well.y + 1); assert.equal(rf.fuel, CONFIG.fuel.tank, 'the tank takes what it holds'); assert.equal(s.inventory.slots[fs].qty, 9 - CONFIG.fuel.tank); assert.equal(S.useItem(s, fs, well.x, well.y + 1).msg, 'The tank is full');
  // the hoe gives the cans back with the engine
  s.inventory.slots[fs] = null; const r5 = S.useItem(s, 0, well.x, well.y + 1); assert.ok(r5.ok, JSON.stringify(r5)); assert.ok(s.inventory.slots.some(i => i?.kind === 'fuel' && i.qty === CONFIG.fuel.tank), 'the cans came back');
});
await test('the catalogue sells the three pumps and the cart delivers them to a pocket with their level', async () => {
  const { catalog, placeOrder } = await import('../src/catalog.js');
  const s = arm(S.createState(1)); s.money = 2000;
  const rows = catalog(s).filter(i => i.id.startsWith('pump')); assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.price), CONFIG.pump.tiers.map(t => t.price)); assert.ok(rows.every(r => r.group === 'Water' && !r.blocked));
  assert.ok(placeOrder(s, 'pump1').ok); assert.equal(catalog(s).find(i => i.id === 'pump1').level, '1 owned');
  S.sleep(s); assert.ok(s.parcels.some(p => p.id === 'pump1')); S.collectParcels(s);
  const it = [...s.inventory.slots, ...s.chest.slots].find(i => i?.kind === 'pump'); assert.ok(it && it.level === 1, JSON.stringify(it));
  assert.equal(itemKey(it), 'pump::0::1'); assert.notEqual(itemKey(it), itemKey({ kind: 'pump', level: 0, qty: 1 }), 'tiers stack apart');
});
await test('Sprinkler II and III reach 2 and 3 tiles and drink more of the flow: a III on the bare well has no pressure, a hand pump runs it', async () => {
  const s = arm(S.createState(1)); const W = s.world, well = WB.well, tile = (x, y) => W.tiles[y * W.w + x]; s.humidity = 50;
  const row = Y + 1; for (let y = well.y + 1; y <= row; y++) tile(well.x, y).pipe = true; for (let x = X; x <= well.x; x++) tile(x, row).pipe = true;
  addItem(s.inventory, { kind: 'sprinkler', level: 2, qty: 1 }); const slot = () => s.inventory.slots.findIndex(i => i?.kind === 'sprinkler');
  s.player.x = X + 0.5; s.player.y = row + 1.5;
  let r = S.useItem(s, slot(), X, row); assert.ok(r.ok && /No pressure: 0 tiles of flow reach here, it drinks 4/.test(r.msg), JSON.stringify(r)); assert.equal(tile(X, row).obj.level, 2);
  assert.equal(S.headAt(s, X, row), 0); assert.ok(!S.sprinklerCovers(s, X + 3, row + 3));
  tile(well.x, well.y + 1).obj = { kind: 'pump', level: 0 }; s.pipeRev++;
  assert.ok(S.sprinklerFed(s, X, row)); assert.ok(S.headAt(s, X, row) >= CONFIG.sprinkler.tiers[2].draw);
  tile(X - 1, row).pipe = true; s.pipeRev++; assert.equal(S.headAt(s, X - 1, row), S.headAt(s, X, row) - CONFIG.sprinkler.tiers[2].draw - 1, 'a III drinks 4 of the flow'); tile(X - 1, row).pipe = false; s.pipeRev++;
  assert.ok(S.sprinklerCovers(s, X + 3, row + 3) && !S.sprinklerCovers(s, X + 4, row), 'reach 3');
  s.player.x = X + 3.5; s.player.y = row + 4.5; assert.ok(S.useItem(s, 0, X + 3, row + 3).ok, 'hoe');
  tickMinutes(s, 0.05); assert.ok(S.moistureOf(tile(X + 3, row + 3)) > 0, 'a III waters three tiles out');
  s.player.x = X + 0.5; s.player.y = row + 1.5; r = S.useItem(s, 0, X, row); assert.ok(r.ok && s.inventory.slots.some(i => i?.kind === 'sprinkler' && i.level === 2), 'the hoe takes it back as a III');
  s.inventory.slots[slot()] = { kind: 'sprinkler', level: 1, qty: 1 };
  r = S.useItem(s, slot(), X, row); assert.ok(r.ok && r.msg === '', 'a II runs on the hand pump: ' + JSON.stringify(r)); assert.ok(S.sprinklerCovers(s, X + 2, row + 2) && !S.sprinklerCovers(s, X + 3, row), 'reach 2');
  tile(well.x, well.y + 1).obj = null; s.pipeRev++; assert.ok(!S.sprinklerFed(s, X, row), 'no pump: the farm is out of the well\'s reach');
  const { catalog, placeOrder } = await import('../src/catalog.js'); s.money = 2000;
  const rows = catalog(s).filter(i => i.id.startsWith('sprinkler')); assert.deepEqual(rows.map(i => i.price), CONFIG.sprinkler.tiers.map(t => t.price));
  assert.ok(placeOrder(s, 'sprinkler2').ok); S.sleep(s); S.collectParcels(s);
  assert.ok([...s.inventory.slots, ...s.chest.slots].some(i => i?.kind === 'sprinkler' && i.level === 2), 'a III arrives as a III');
});

console.log('power');
await test('the chain: a generator powers the line; a picker takes one ripe crop an hour and drops it on the belt; the belt carries it a tile a step to the hopper beside the crate; the cart sells it; dead without a generator; nearest machines first when the line asks for more', () => {
  const s = arm(S.createState(1)); const W = s.world, Cr = WB.crate, tile = (x, y) => W.tiles[y * W.w + x], B = CONFIG.power.belt;
  const carrot = byName(s, 'Carrot');
  for (let x = X; x <= Cr.x - 1; x++) tile(x, Cr.y - 1).line = true;   // a line from beside the crate west along the row above it
  const hx = Cr.x - 1, hy = Cr.y - 1;
  tile(hx, hy).obj = { kind: 'hopper', held: [] }; tile(X, hy).obj = { kind: 'picker', held: [] }; s.lineRev = 1;
  for (let x = X + 1; x < hx; x++) { tile(x, hy).belt = true; tile(x, hy).load = []; } s.beltRev = 1;   // belt between them, sharing the line's tiles
  const D = hx - 1 - X;   // belt tiles from the picker to the hopper
  s.player.x = X - 0.5; s.player.y = hy - 0.5;
  assert.ok(S.useItem(s, 0, X, hy - 1).ok, 'hoe'); assert.ok(S.useItem(s, 2, X, hy - 1).ok, 'plant a carrot');
  tile(X, hy - 1).crop.growth = 100; tile(X, hy - 1).crop.ripeAt = s.minutes;
  s.minutes = (S.dayOf(s) - 1) * 1440 + 8 * 60 + 59;
  assert.ok(!S.beltRunning(s, X + 1, hy), 'no generator: no powered hopper, the belt stands still'); assert.equal(S.beltDir(s, X + 1, hy), -1);
  tickMinutes(s, 2); assert.equal(tile(X, hy).obj.held.length, 0, 'no generator: the picker is dead'); assert.ok(tile(X, hy - 1).crop);
  assert.ok(!S.linePowered(s, X, hy) && !S.machinePowered(s, X, hy));
  tile(X + 1, hy + 1).obj = { kind: 'generator' }; s.lineRev++;   // a generator below the line, with an empty tank
  assert.ok(!S.linePowered(s, X, hy) && !S.generatorLive(s, X + 1, hy + 1), 'no fuel: no power');
  tile(X + 1, hy + 1).obj.fuel = 5; s.lineRev++;
  assert.ok(S.linePowered(s, X, hy) && S.machinePowered(s, X, hy) && S.machinePowered(s, hx, hy));
  assert.ok(S.beltRunning(s, X + 1, hy) && S.beltRunning(s, hx - 1, hy), 'the hopper drives the belt'); assert.equal(S.beltNet(s).dist.get(hy * W.w + hx - 1), 1); assert.equal(S.beltNet(s).dist.get(hy * W.w + X + 1), D);
  assert.equal(S.beltDir(s, X + 1, hy), 1, 'the belt runs east toward the hopper'); assert.equal(S.beltDir(s, hx - 1, hy), 1);
  tickMinutes(s, 1); assert.equal(tile(X, hy).obj.held.length, 0, 'between hours nothing moves');
  s.minutes = (S.dayOf(s) - 1) * 1440 + 9 * 60 + 59; s.beltClock = 0; tickMinutes(s, 1);   // across 10:00
  assert.ok(!tile(X, hy - 1).crop, 'the bed is cleared'); assert.equal(tile(X, hy).obj.held.length, 0, 'the basket went onto the belt');
  assert.equal(S.heldCount(tile(X + 1, hy).load), carrot.genome.count, 'on the first belt tile'); assert.equal(tile(hx, hy).obj.held.length, 0, 'not at the hopper yet');
  assert.equal(S.ledger(s).today.picked, carrot.genome.count);
  for (let i = 0; i < B.stepMinutes; i++) tickMinutes(s, 1);
  assert.equal(tile(X + 1, hy).load.length, 0, 'a step on, the first tile is clear'); assert.equal(S.heldCount(tile(X + 2, hy).load), carrot.genome.count, 'the crop moved one tile');
  for (let i = 0; i < B.stepMinutes * (D - 1); i++) tickMinutes(s, 1);
  const hop = tile(hx, hy).obj.held; assert.equal(hop.length, 1, 'it reached the hopper'); assert.equal(hop[0].species, carrot.id); assert.equal(hop[0].qty, carrot.genome.count);
  assert.ok(!tile(X + 1, hy).load.length && !tile(hx - 1, hy).load.length, 'the belt is clear');
  s.minutes = (S.dayOf(s) - 1) * 1440 + 19 * 60; const m = s.money;
  const rep = S.sleep(s);
  assert.ok(rep.sale && rep.sale.count === carrot.genome.count, 'the hopper tipped into the crate and the cart took it: ' + JSON.stringify(rep.sale));
  assert.equal(tile(hx, hy).obj.held.length, 0); assert.equal(rep.fuel.cans, CONFIG.power.generator.fuelPerDay); assert.equal(tile(X + 1, hy + 1).obj.fuel, 5 - CONFIG.power.generator.fuelPerDay); assert.equal(rep.picked, carrot.genome.count);
  assert.ok(Math.abs(s.money - (m + rep.sale.total)) < 1e-9, 'sale in, nothing out: fuel is paid for by the can');
  assert.ok(rep.lines.some(l => /pickers took/.test(l)));
  // a full hopper backs the belt up: the crops wait on the tile before it
  tile(hx, hy).obj.held = [{ species: carrot.id, q: 0, qty: CONFIG.power.hopper.holds }]; tile(hx - 1, hy).load = [{ species: carrot.id, q: 0, qty: 2 }];
  S.beltStep(s); assert.equal(S.heldCount(tile(hx - 1, hy).load), 2, 'nowhere to go'); tile(hx, hy).obj.held = []; S.beltStep(s); assert.equal(tile(hx - 1, hy).load.length, 0, 'emptied, it takes them');
  // a belt tile holds so many: the rest waits a step behind
  tile(X + 1, hy).load = [{ species: carrot.id, q: 0, qty: B.holds + 2 }]; S.beltStep(s); assert.equal(S.heldCount(tile(X + 2, hy).load), B.holds); assert.equal(S.heldCount(tile(X + 1, hy).load), 2);
  for (let x = X + 1; x < hx; x++) tile(x, hy).load = []; tile(hx, hy).obj.held = [];
  // more machines than the generator powers: the furthest down the line goes dead, and its belt stops
  for (let x = X + 1; x <= X + 5; x++) { tile(x, hy).obj = { kind: 'picker', held: [] }; tile(x, hy).belt = false; } s.lineRev++; s.beltRev++;
  const net = S.lineNet(s); assert.equal(net.used[net.comp.get(hy * W.w + X)], CONFIG.power.generator.power);
  assert.ok(S.machinePowered(s, X, hy) && !S.machinePowered(s, hx, hy), 'the hopper, furthest from the generator, is the one cut');
  assert.ok(!S.beltRunning(s, hx - 1, hy), 'no powered hopper: the belt stands still');
  for (let x = X + 1; x <= X + 5; x++) { tile(x, hy).obj = null; tile(x, hy).belt = true; } s.lineRev++; s.beltRev++; assert.ok(S.beltRunning(s, hx - 1, hy));
  // by hand: empty hands take a basket or what lies on a belt tile; the hoe refuses either while it holds crops
  tile(X, hy).obj.held = [{ species: carrot.id, q: 0, qty: 2 }];
  s.player.x = X - 0.5; s.player.y = hy + 0.5; assert.equal(S.useItem(s, 0, X, hy).msg, 'Empty it first');
  const r = S.takeHeld(s, X, hy); assert.ok(r.ok && r.taken === 2, JSON.stringify(r)); assert.equal(tile(X, hy).obj.held.length, 0);
  s.player.x = X + 0.5; tile(X + 1, hy).load = [{ species: carrot.id, q: 0, qty: 1 }]; assert.equal(S.useItem(s, 0, X + 1, hy).msg, 'Empty it first');
  assert.ok(S.takeHeld(s, X + 1, hy).taken === 1); assert.equal(tile(X + 1, hy).load.length, 0);
  s.inventory.slots[s.inventory.slots.findIndex(i => i?.kind === 'crop')] = null;   // a pocket for it
  assert.ok(S.useItem(s, 0, X, hy).ok, 'now the hoe takes it'); assert.ok(s.inventory.slots.some(i => i?.kind === 'picker'));
  s.inventory.slots[s.inventory.slots.findIndex(i => i && i.kind !== 'tool' && i.kind !== 'picker')] = null;   // and one for the belt
  const r3 = S.useItem(s, 0, X + 1, hy); assert.ok(r3.ok && r3.float === 'Belt up', JSON.stringify(r3)); assert.ok(!tile(X + 1, hy).belt && tile(X + 1, hy).line, 'the belt is up, the line stays'); assert.ok(s.inventory.slots.some(i => i?.kind === 'belt'));
  // the switch: off, the line is dead and the night burns no fuel
  let r2 = S.toggleGenerator(s, X + 1, hy + 1); assert.ok(r2.ok && r2.float === 'Off' && r2.off); assert.ok(!S.linePowered(s, X + 1, hy) && !S.generatorLive(s, X + 1, hy + 1));
  s.minutes = (S.dayOf(s) - 1) * 1440 + 19 * 60; const rep2 = S.sleep(s); assert.ok(!rep2.fuel, 'switched off: no fuel');
  r2 = S.toggleGenerator(s, X + 1, hy + 1); assert.ok(r2.float === 'On' && S.linePowered(s, X + 1, hy));
  // power is in units: the generator makes 6, each machine draws its share (the hopper more: it drives the belt)
  const net2 = S.lineNet(s), c2 = net2.comp.get(hy * W.w + X + 1); assert.equal(net2.cap[c2], CONFIG.power.generator.power); assert.ok(net2.used[c2] <= net2.cap[c2]);
  assert.ok(CONFIG.power.hopper.power > CONFIG.power.picker.power);
});
await test('placing the chain: line and belt on clear ground only and never on each other\'s machines, picker and hopper on line beside the belt; the catalogue sells and delivers all five', async () => {
  const s = arm(S.createState(1)); const W = s.world, Cr = WB.crate, tile = (x, y) => W.tiles[y * W.w + x]; s.inventory.slots[3] = null;
  addItem(s.inventory, { kind: 'line', qty: 10 }); addItem(s.inventory, { kind: 'generator', qty: 1 });
  const slotOf = kind => s.inventory.slots.findIndex(i => i?.kind === kind);
  s.player.x = X + 0.5; s.player.y = Y + 1.5;
  let r = S.useItem(s, slotOf('generator'), X, Y); assert.ok(r.ok && /Lay line/.test(r.msg), JSON.stringify(r)); tile(X, Y).obj.fuel = 4;
  r = S.useItem(s, slotOf('line'), X + 1, Y); assert.ok(r.ok && r.float === 'Laid', JSON.stringify(r));
  s.player.x = X + 3.5; s.player.y = Y + 1.5; r = S.useItem(s, slotOf('line'), X + 3, Y); assert.ok(r.ok && r.float === 'Laid (dead)', 'a loose section: ' + JSON.stringify(r));
  assert.ok(S.useItem(s, 0, X + 2, Y + 1).ok, 'hoe a bed'); r = S.useItem(s, slotOf('line'), X + 2, Y + 1); assert.ok(r.ok && r.float === 'Laid (dead) under the bed' && s.world.tiles[(Y + 1) * s.world.w + X + 2].tilled, 'line runs under a bed: ' + JSON.stringify(r));
  r = S.useItem(s, 0, X + 2, Y + 1); assert.ok(r.ok && r.float === 'Flattened' && s.world.tiles[(Y + 1) * s.world.w + X + 2].line, 'flatten first'); r = S.useItem(s, 0, X + 2, Y + 1); assert.ok(r.ok && r.float === 'Line up', 'then lift');
  s.player.x = Cr.x - 0.5; s.player.y = Cr.y + 0.5; assert.equal(S.useItem(s, slotOf('line'), Cr.x, Cr.y).msg, 'Line goes on clear ground');
  s.inventory.slots[slotOf('generator') >= 0 ? slotOf('generator') : 4] = { kind: 'hopper', qty: 1 };
  s.player.x = X + 1.5; s.player.y = Y + 1.5;
  assert.equal(S.useItem(s, slotOf('hopper'), X + 2, Y).msg, 'A hopper stands on the power line');
  r = S.useItem(s, slotOf('hopper'), X + 1, Y); assert.ok(r.ok && /Run belt/.test(r.msg), 'a hopper stands anywhere on powered line, and asks for belt: ' + JSON.stringify(r));
  tile(X + 1, Y).obj.held = [{ species: byName(s, 'Carrot').id, q: 0, qty: 3 }];
  s.minutes = (S.dayOf(s) - 1) * 1440 + 19 * 60; const rep = S.sleep(s); assert.ok(!rep.sale, 'away from the crate it is a store: the cart sees nothing'); assert.equal(S.heldCount(tile(X + 1, Y).obj.held), 3);
  // belt: clear ground, not a bed, not under a machine; it shares a tile with line; a machine cannot stand on it
  s.inventory.slots[s.inventory.slots.findIndex(i => !i)] = { kind: 'belt', qty: 10 };
  assert.ok(S.useItem(s, 0, X + 2, Y + 1).ok, 'hoe the bed again'); assert.equal(S.useItem(s, slotOf('belt'), X + 2, Y + 1).msg, 'Not through a bed: flatten it first');   // the belt stays on the surface
  assert.equal(S.useItem(s, slotOf('belt'), X + 1, Y).msg, 'Something stands there');
  r = S.useItem(s, slotOf('belt'), X + 2, Y); assert.ok(r.ok && r.float === 'Laid', 'beside the powered hopper, on its line tile, it runs at once: ' + JSON.stringify(r)); assert.ok(tile(X + 2, Y).belt && S.beltRunning(s, X + 2, Y));
  r = S.useItem(s, slotOf('belt'), X + 2, Y + 2); assert.ok(r.ok && r.float === 'Laid (still)', 'a loose section: ' + JSON.stringify(r));
  assert.equal(S.useItem(s, slotOf('belt'), X + 2, Y).msg, 'Belt is already laid here');
  s.inventory.slots[s.inventory.slots.findIndex(i => !i)] = { kind: 'picker', qty: 1 };
  s.player.x = X + 3.5; s.player.y = Y + 1.5; r = S.useItem(s, slotOf('belt'), X + 3, Y); assert.ok(r.ok && r.float === 'Laid', 'belt over the loose line, joined to the running run: ' + JSON.stringify(r));
  assert.equal(S.useItem(s, slotOf('picker'), X + 3, Y).msg, 'Not on the belt: beside it');
  s.player.x = X + 1.5; s.player.y = Y + 1.5; tile(X + 1, Y).obj = null; s.lineRev++;
  r = S.useItem(s, slotOf('picker'), X + 1, Y); assert.ok(r.ok && r.msg === '', 'a picker beside belt: ' + JSON.stringify(r)); assert.ok(S.machinePowered(s, X + 1, Y));
  s.money = 3000; const { catalog, placeOrder } = await import('../src/catalog.js');
  const ids = ['generator', 'line', 'belt', 'picker', 'hopper', 'fuel']; for (const id of ids) { const it = catalog(s).find(i => i.id === id); assert.ok(it && !it.blocked && it.group === 'Power', id); assert.ok(placeOrder(s, id).ok); }
  assert.equal(catalog(s).find(i => i.id === 'picker').level, '2 owned');
  S.sleep(s); S.collectParcels(s);
  const all = [...s.inventory.slots, ...s.chest.slots];
  assert.ok(all.some(i => i?.kind === 'generator') && all.some(i => i?.kind === 'picker') && all.some(i => i?.kind === 'hopper') && all.some(i => i?.kind === 'line' && i.qty >= CONFIG.power.line.packSize) && all.some(i => i?.kind === 'belt' && i.qty >= CONFIG.power.belt.packSize) && all.some(i => i?.kind === 'fuel' && i.qty >= CONFIG.fuel.packSize), 'everything arrived');
});

console.log('bank');
await test('loans: the money comes at once, the bank adds interest a night and takes nothing, pay back any amount or all at any time, one at a time, bigger ones open as you sell', async () => {
  const s = arm(S.createState(1)); const { catalog, placeOrder } = await import('../src/catalog.js'); const Lo = CONFIG.loan, r2 = v => Math.round(v * 100) / 100;
  s.money = 10; s.stats.earned = 0;
  const rows = () => catalog(s).filter(i => i.group === 'Bank');
  assert.equal(rows().length, Lo.sizes.length); assert.ok(!rows()[0].blocked, 'the small loan is open from the start'); assert.ok(/sold first/.test(rows()[1].blocked), 'the bigger ones wait for sales');
  assert.equal(placeOrder(s, 'loan:' + Lo.sizes[1]).ok, false);
  const r = placeOrder(s, 'loan:' + Lo.sizes[0]); assert.ok(r.ok && r.loan, JSON.stringify(r)); assert.equal(s.money, 10 + Lo.sizes[0]); assert.equal(s.orders.length, 0, 'no parcel: it is money');
  assert.equal(s.loan.owed, Lo.sizes[0], 'you owe what you borrowed, no interest up front');
  assert.ok(rows().filter(i => i.family === 'Borrow').every(i => i.blocked === 'One loan at a time'));
  assert.deepEqual(rows().filter(i => i.family === 'Pay back').map(i => i.tier), [...Lo.payments.map(p => '$' + p), 'All'], 'a chip a payment and one for the lot');
  s.minutes = (S.dayOf(s) - 1) * 1440 + 19 * 60; let m = s.money; let rep = S.sleep(s);
  assert.equal(rep.loan.interest, r2(Lo.sizes[0] * Lo.nightly)); assert.equal(s.loan.owed, r2(Lo.sizes[0] * (1 + Lo.nightly)), 'interest added');
  assert.equal(s.money, r2(m + (rep.sale?.total || 0) - (rep.water?.bill || 0)), 'nothing taken'); assert.ok(rep.lines.some(l => /The bank added/.test(l)));
  s.minutes = (S.dayOf(s) - 1) * 1440 + 19 * 60; rep = S.sleep(s); assert.equal(s.loan.owed, r2(r2(Lo.sizes[0] * (1 + Lo.nightly)) * (1 + Lo.nightly)), 'compounds');
  s.money = 40; let p = placeOrder(s, 'repay:' + Lo.payments[0]); assert.ok(p.ok && p.pay === Lo.payments[0] && s.money === 40 - Lo.payments[0] && s.loan, JSON.stringify(p));
  p = placeOrder(s, 'repay:' + Lo.payments[1]); assert.ok(p.ok && p.pay === 40 - Lo.payments[0] && s.money === 0, 'short: pays what you have');
  assert.equal(placeOrder(s, 'repay:all').ok, false, 'nothing to pay with');
  s.money = 1000; const owed = s.loan.owed; p = placeOrder(s, 'repay:all'); assert.ok(p.ok && /paid off/.test(p.msg)); assert.equal(s.loan, null); assert.equal(s.money, r2(1000 - owed));
  assert.ok(!rows()[0].blocked, 'free to borrow again');
  s.stats.earned = Lo.gates[2]; assert.ok(rows().every(i => !i.blocked), 'everything open once enough is sold');
  placeOrder(s, 'loan:' + Lo.sizes[0]); s.loan.owed = 7; s.money = 100; assert.deepEqual(rows().filter(i => i.family === 'Pay back').map(i => i.tier), ['All'], 'only the lot when the debt is under the smallest payment');
  p = placeOrder(s, 'repay:all'); assert.ok(p.ok && p.pay === 7 && !s.loan, 'the lot clears it'); assert.equal(placeOrder(s, 'repay:all').ok, false, 'no loan, no row');
});

await test('the hoe flattens an empty bed back to grass (and says when fertiliser goes with it); the catalogue rows carry a family and a tier', async () => {
  const s = arm(S.createState(1)); const tile = (x, y) => s.world.tiles[y * s.world.w + x];
  s.player.x = X + 0.5; s.player.y = Y + 1.5;
  assert.ok(S.useItem(s, 0, X, Y).ok, 'till'); assert.ok(tile(X, Y).tilled);
  let r = S.useItem(s, 0, X, Y); assert.ok(r.ok && r.float === 'Flattened' && !tile(X, Y).tilled, JSON.stringify(r));
  assert.ok(S.useItem(s, 0, X, Y).ok); tile(X, Y).fert = { name: 'Bone meal', stats: {} };
  r = S.useItem(s, 0, X, Y); assert.ok(r.ok && /fertiliser is lost/.test(r.msg) && !tile(X, Y).fert, JSON.stringify(r));
  const { catalog } = await import('../src/catalog.js'); const items = catalog(s);
  assert.deepEqual(items.filter(i => i.family === 'Sprinkler').map(i => i.tier), ['I', 'II', 'III']);
  assert.deepEqual(items.filter(i => i.family === 'Pump').map(i => i.tier), CONFIG.pump.tiers.map(t => t.name.replace(' pump', '')));   // the chip says Hand, the row says Hand pump
  assert.equal(items.filter(i => i.family === 'Borrow').length, CONFIG.loan.sizes.length);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
