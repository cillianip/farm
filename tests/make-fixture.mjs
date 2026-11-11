// Writes save fixtures for the old-save test: plays a little with one build's own code and saves what it made.
//   this build:  node tests/make-fixture.mjs src <build> tests/fixtures
//   an old one:  git archive <commit> src | tar -x -C /some/dir, then node tests/make-fixture.mjs /some/dir/src <build> tests/fixtures
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const [srcArg, build, out] = process.argv.slice(2);
const src = pathToFileURL(path.resolve(srcArg)).href;
const S = await import(src + '/sim.js'), G = await import(src + '/genetics.js'), SV = await import(src + '/save.js');
const write = (name, state) => { const j = SV.serialize(state); fs.writeFileSync(`${out}/save-b${build}-${name}.json.gz`, zlib.gzipSync(j)); console.log(build, name, j.length); };
const s = S.createState(11);
s.money = 5000;
const base = Object.values(s.species);
const A = base[0], B = base[base.length - 1];
for (let seed = 1, n = 0; seed < 50 && n < 3; seed++) { const r = G.cross(A.genome, B.genome, seed); if (r.outcome !== 'success') continue; const sp = G.makeSpecies(r.child, { parents: [A.id, B.id] }); sp.discoveredDay = 1; s.species[sp.id] = sp; n++; }
const ids = Object.keys(s.species); let k = 0;
for (const t of s.world.tiles) { if (k >= 12) break; if (t.tilled && !t.crop && !t.obj) { t.crop = { speciesId: ids[k % ids.length], growth: 40 + k * 5, health: 100, ripeAt: null, dead: false, plantedAt: s.minutes, harvests: 0 }; k++; } }
S.advance(s, 60);
write('play', s);
if (S.makeModelFarm) { const m = S.makeModelFarm(); S.advance(m, 60); write('model', m); }
