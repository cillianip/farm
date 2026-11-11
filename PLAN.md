# Farm (working title) — plan

A browser farming game: Stardew Valley on the surface (a little farmer on a square grid, a house with a bed, tools),
Cookie Clicker underneath (numbers go up, and every 10–15 minutes something new to buy changes how you play).
Peaceful, single-player first, saves in the browser. Endless variety comes from **breeding crops with genes**.

## Tech
- Vanilla JS ES modules + Canvas 2D, no build step, served by a tiny static server (`npx serve` or a small express).
- Single-player: save to localStorage (with export/import); offline progress computed from timestamps on load.
- All tunable numbers in one `config.js`. Seeded RNG for breeding (same parents + seed → same result).
- Node tests for the rules (genetics, growth, death, economy) with no browser: `node tests/run.js`.

## Art
Code-drawn pixel art: 16×16 px tiles scaled ×3 with nearest-neighbour, a limited cosy palette, a 3×5 or 5×7 pixel font.
Crops are assembled from parts chosen by their genes (stem, leaves, produce shape/size/colour/pattern/glow) for 4 growth
stages (seed, sprout, leafy, ripe with the produce visible). No AI-generated images: everything is drawn by code so
millions of plants stay in one consistent style.

## The farm (Stardew basics)
- Grid of tiles: grass → (hoe) tilled soil → (seed) planted → (water) wet soil grows the crop.
- Player: top-down character, WASD, acts on the tile under the cursor within reach; hotbar 1–9 (hoe, can, seeds, items).
- Energy: each tool use costs energy; sleeping restores it.
- Time: an in-game clock (a day ≈ 8 real minutes, configurable). Sleep in your bed to end the day: restores energy, saves,
  dries all soil, triggers overnight events (breeder finishes, market prices move, chance of rain = everything watered).
- Growth: each crop has a grow time; growth % (0→100) only advances while its soil is wet. Soil stays wet for N hours.
- Dying: dry soil → the crop loses health a few % per hour; at 0 it dies (a withered tile). Ripe crops have a ripe window,
  then rot (value falls), then die.
- Hover a crop: card with name, growth %, water, health, value, and its traits.
- Harvest → item in inventory (stacks, Minecraft-style slots) → carry to the **farmers market** stall → instant sell.
- Storage: chests in the house (slots, stacks).

## Money paths (Cookie Clicker scaling: each purchase costs ~1.15× the last)
- **Land:** buy adjacent chunks (3×3 → bigger).
- **Tools:** watering can 1 → 3 → 9 tiles; better hoe; later sprinklers (auto-water).
- **Storage:** more chests / slots.
- **Seeds:** shop seeds; later your own bred species.

## Incremental stages (each one a new way to play, not just bigger numbers)
1. Hand farming (0–10 min): 3×3 plot, hoe, can, 3 cheap fast seeds; everything by hand.
2. Expansion (10–30 min): land chunks, can upgrades, a chest, more seed types.
3. Automation (30–60 min): sprinklers, a farmhand who harvests; the farm earns while you do other things.
4. Breeding (~1 h): buy the Breeder machine → the breeding screen opens.
5. Greenhouse: rarer mutations, no weather. 6. Market: moving prices, orders, mystery seeds (in-game coins only).
7. Processing: jam/juice machines multiply value. End: breed the legendary World Tree; then prestige (sell the farm, keep
   the seed book and a permanent bonus).
Build stages 1–4 first.

## Breeding (the core)
- Every crop is a **genome** (a set of genes). Genes, wide variability, not just colour:
  - family / body plan: root, fruit bush, vine, grain, flower, gourd (decides the sprite structure and whether it regrows)
  - produce: shape (round, long, spiky, star, cluster, heart…), size, count per harvest
  - looks: primary/secondary colour, pattern (stripes, spots, gradient), glow
  - plant: leaf shape, density, height
  - behaviour: grow time, thirst (how fast it dries/suffers), hardiness (death rate), ripe window, regrowth
  - rare traits: golden, glowing, self-watering, multi-harvest, frost-hardy…
- Cross two crops in the Breeder (inputs: two harvested crops or seeds + coins + time, e.g. overnight).
- Child: each gene from parent A, parent B, or a blend (numeric genes average ± noise); each gene has a small mutation
  chance. Same family → mostly stable; different families → hybrid body plans and more instability.
- **Instability** score (family distance + mutation size). Roll against it: failure = sterile plant (grows once, no
  seeds), a seedling that withers, or a revert to one parent. Success = a **new stable species**.
- A new species gets a generated name from its genes ("Spotted Moon Carrot"), its grow time and sale value derived from
  its genes (rarer traits and bigger yields pay more; slower crops pay more per harvest), and goes in the **seed book**.
  You can plant it from then on.
- Species ID = hash of the genome: the same genome is always the same species (ready for a shared "first discovered by"
  log later).

## First milestone (done = all of this works and is tested)
- Stage 1–2: grid, character, hoe/water/plant/harvest, growth %, water, death and rot, sleep/day cycle, energy,
  inventory + chest, market instant sell, land and can upgrades, save/load + offline growth.
- Code-drawn crops for 3 starter species through 4 growth stages, with the hover card.
- Then the Breeder (stage 4): genome, crossing, mutation, instability, naming, seed book.

## Roadmap after the automation playtest (agreed 2026-11-11)
- **Stage 3, the breeding chase:** rare colours and traits with their odds shown before you breed, luck boosters, and a
  seed book that shows what is found and what is still missing.
- **Stage 4, the kitchen:** crops (and dried goods, the first step already in) become dishes the player designs; a dish is
  custom and pays far more than its crops. How dishes are made and judged is still open.
- **The ending:** the World Tree (a legendary crop at the end of a long breeding line), then prestige: sell the farm, keep
  the seed book and a permanent bonus, start again.

## Later
Shared discovery log and leaderboards (small server), seasons/weather, processing, greenhouse, market gambling
(in-game coins only — never real money for random rewards), prestige, the World Tree ending.

## Design answers
**Growth stages for infinite species.** Stages are templates per *family* (body plan), filled in from the genes, not drawn
per species: (1) sprout: the same small sprout for everyone, tinted by the leaf colour gene; (2) growing: the family's
foliage shape (root = leaf rosette, vine = climbing stem, bush = round shrub, grain = stalks, flower = stem + bud, gourd =
sprawling leaves) using the leaf shape/density/height genes; (3) ripe: the same plus the produce drawn from its genes
(shape, size, count, colour, pattern, glow), clearly visible on the plant. Each species × stage is drawn once and cached.

**Rarity and price from genes.** Every gene value has a rarity weight (common values ~0, unusual ones more, special
traits like golden/glowing a lot). Rarity score = sum of trait weights + generations away from a starter crop + number of
rare traits. Tiers: common / uncommon / rare / epic / legendary. Sale price = family base × produce size × yield × tier
multiplier. Prices are fixed (demand never runs out; no price drops from selling a lot).
**Earn per hour, not just per harvest:** what matters to the player is coins per minute of growing = price ÷ grow time.
A slow crop must pay more per harvest just to keep up (a 2-minute crop at 10 coins = 5/min; a 10-minute crop must sell
for 50 just to match it). Rarer tiers beat that line: e.g. common ≈ 5/min, rare ≈ 9/min, legendary ≈ 25/min, so breeding
something rarer always makes the farm earn faster, not just bigger single sales.

**Produce shapes differ by species, not just colour.** The produce is drawn from a shape archetype gene plus numeric
shape genes, so a potato, a carrot and a tomato look like different things:
- archetypes: long taper (carrot, parsnip), lumpy oval (potato), round bulb (radish, turnip, onion), round with crown
  (tomato), cluster (grapes, berries), pod (beans, peas), elongated (pepper, cucumber, aubergine), big ribbed (pumpkin,
  melon), ear (corn), head (cabbage, lettuce), spiky or star (exotic, from mutations).
- numeric shape genes: elongation, width, bumpiness, ribs/segments, tip (pointed/blunt), curve, top (leafy crown, stem,
  none), count per plant and arrangement (hanging, on top, underground with the top showing).
- the family decides where the produce sits (roots underground with a leafy top showing; fruit hanging from the bush or
  vine; grain heads on stalks), the archetype and shape genes decide what it looks like. A cross can blend archetypes
  (long taper × round bulb = a stubby cone) or mutate into a new one.

**Keeping rare things rare (hard to reproduce).**
- Rare traits are recessive: a child inherits one only with a low chance (e.g. 25% from one parent, higher if both have it).
- Instability rises with the parents' rarity: rare crosses fail more often (sterile, wither, revert).
- Seed yield falls with rarity: common crops drop several seeds, rare ones 0–1, legendary rarely any. Rare species are
  never sold in the shop.
- A brand-new rare species is unstable at first: it must be bred back over a few generations to stabilise before it
  reliably makes seeds.
- Legendary traits need specific combinations (hidden recipes: e.g. glowing + frost-hardy + vine) plus a rare mutation roll.

**No AI-generated content in the shipped game.** Everything players see is made by game code (procedural art from genes,
names built from syllables tied to genes) or free-licensed assets (CC0 sounds, open fonts). No language model naming,
no generated images, no generated text. AI coding help is fine (Steam exempts code tools since Jan 2026), so the game
needs no AI label.

**Why grow many species, not one best crop (crop diversity).** Rewards, never punishments:
- **Seed book bonus** (like Cookie Clicker's milk from achievements): every species discovered adds a permanent +% to
  all sale prices. Breeding something new always pays, even if you never plant it again.
- **Neighbour bonus:** different species next to each other grow a little faster and raise the mutation chance in the
  Breeder for crosses taken from that patch; a field of one crop gets no bonus (it isn't penalised either).
- **Mutations need variety:** the rarest traits only appear from crossing different families, so the next big unlock
  always needs something you don't have yet.
- Later: farmers market orders ("3 long purple roots by tonight") paying a premium, optional.

**Numbers go big, slowly.** It starts real (a carrot sells for about $2, a few dollars a minute) and grows through
stacked multipliers: crop tiers (each tier ~5–10× the value of the last), sale upgrades (+%), the seed book bonus, quality
stars, processing (jam ×3), and prestige. Aim: each stage earns ~10× the last per minute. Show K / M / B / T. The world
gets a **title** from lifetime earnings so the numbers feel earned: Backyard Gardener → Family Farmer → Estate Owner →
Agribusiness → Biotech Pioneer → … (titles are names and a little ceremony on reaching them, not separate game states:
the farm itself just keeps growing).

## Fertilisers (start with compost, improve like breeding)
**A fertiliser is a set of effect stats**, all tunable numbers, so every fertiliser is just a different mix of them (no
special-case code per fertiliser):
- `speed`: −% grow time · `quality`: + quality stars (worth more) · `yield`: + produce per harvest
- `waterKeep`: soil stays wet longer · `hardiness`: slower health loss when dry, rots later
- `mutation`: + mutation chance when that crop is used in the Breeder
One fertiliser per tile (a choice, not a stack); applied to tilled soil; used up at harvest. Shown with its stats on hover.
**Power budget: no fertiliser has all six.** Each fertiliser has a total power (set by its tier / how good its inputs
were) shared across the stats it has. Most have 1–3 stats. Spending the budget on one stat makes a **specialist**
(e.g. +40% speed and nothing else); spreading it makes an **all-purpose** one (e.g. +8% on four stats). Same budget, a
real choice. A stat that isn't there is simply 0.

**Compost is the first fertiliser.** Buy a compost bin early (stage 1–2). Put crops in (excess, rotten or withered ones
are fine, so neglect isn't a total loss); after a while it gives compost. **Its stats come from what went in**, from the
crops' genes: fast crops → `speed`, big-yield crops → `yield`, hardy crops → `hardiness`, low-thirst crops →
`waterKeep`, high-value or rare crops → `quality`, unusual mutated crops → `mutation`. Basic compost from starter crops
is weak (small budget); better inputs make better compost. Feeding the bin one kind of crop concentrates the budget
(a specialist); a mixed load spreads it (all-purpose).

**Then it improves like breeding.** A **mixer** (bought later) blends two fertilisers: the budgets combine (a little more than the
average), and the stats are shared out by what went in. Mixing two specialists gives a two-stat blend; there's a
chance the budget comes out bigger, and a small chance of a dud. A **refiner** (later) does the opposite: drops the
weakest stat and puts its share into the others, turning an all-purpose mix into a specialist. Strong mixes get a generated name and go in a
**fertiliser book** with their recipe, so you can make them again. Upgrading the bin and mixer raises the stat caps and
the chance of a strong result. Rare crops in the bin are the way to the best fertilisers, which ties it back to breeding.

## Status — build 1 (25 Oct 2026)
The first milestone is built and playable: stages 1–4 plus compost/fertilisers, save/offline, code-drawn art for all
species, 31 Node tests (`npm test`) and a renderer smoke test. See `README.md` for controls, what is in, and where to tweak.
Not built yet: farmhand, greenhouse, market prices/orders, processing, prestige, World Tree, shared discovery log.
