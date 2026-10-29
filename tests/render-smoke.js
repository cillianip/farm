// Draws every starter and 200 bred genomes through all stages with a stub canvas, to catch renderer exceptions. `node tests/render-smoke.js`
const calls = { n: 0 };
const ctxStub = { fillStyle: '#000', imageSmoothingEnabled: false, fillRect(x, y, w, h) { calls.n++; if (![x, y, w, h].every(Number.isFinite)) throw new Error(`bad fillRect ${x},${y},${w},${h}`); }, drawImage() {} };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctxStub }) };
const G = await import('../src/genetics.js');
const { cropSprite, produceSprite } = await import('../src/render/crops.js');
const sprites = await import('../src/render/sprites.js');
const species = Object.values(G.starterSpecies());
let drawn = 0;
const genomes = species.map(s => s.genome);
for (let i = 0; i < 200; i++) { const a = genomes[i % genomes.length], b = genomes[(i * 7 + 3) % genomes.length]; const { child } = G.cross(a, b, i, { mutationBonus: 4 }); genomes.push(child); }
for (const g of genomes) { const sp = G.makeSpecies(g); for (const st of [0, 1, 2, 3, 'dead']) { cropSprite(sp, st); drawn++; } produceSprite(sp); }
for (const fn of ['grassTile', 'soilTile', 'treeSprite', 'houseSprite', 'chestSprite', 'compostSprite', 'breederSprite', 'sprinklerSprite', 'witheredSprite']) sprites[fn](0, 0);
for (let v = 0; v < 3; v++) sprites.treeSprite(v);
for (const d of ['up', 'down', 'left', 'right']) for (const f of [0, 1, 2, 3]) for (const po of ['idle', 'carry', 'hold']) sprites.playerSprite(d, f, po); sprites.groundPatch(20, 10, 1); sprites.groundPatch(28, 12, 3);
sprites.toolIcon('hoe'); sprites.toolIcon('can'); sprites.seedIcon(30, 0.8, 0.5); sprites.fertIcon();
for (let l = 0; l < 3; l++) { sprites.crateSprite(l); sprites.trackTile(l); sprites.seedRackSprite(l); } sprites.wellSprite(1); sprites.signSprite(); sprites.parcelSprite(); for (let b = 0; b < 3; b++) { sprites.benchSprite(b, 0); sprites.benchSprite(b, 1); } sprites.cursorSprite('arrow'); sprites.cursorSprite('hand'); for (const t of ['hoe', 'can']) { sprites.rackSprite(t, true); sprites.rackSprite(t, false); for (const d of ['up', 'down', 'left', 'right']) sprites.heldOverlay(t, d); }
console.log(`render smoke: ${genomes.length} genomes × 5 stages = ${drawn} sprites, ${calls.n} pixel ops, no exceptions`);
