// Every tunable number lives here. Times are in GAME HOURS unless the name says "real".
// Conversion: one game day of 24 hours lasts time.dayRealSeconds real seconds (8 minutes → 1 game hour = 20 real seconds).
export const CONFIG = {
  tile: 16,
  // scale 4 = 64 px per tile: a closer, cosier view. Settings can set 3 for a wider view in a small window (saved in the browser).
  // Rendering: 'sharp' draws at the screen's pixel ratio (crisp on retina, four times the pixels); 'fast' draws at 1 for old machines.
  render: (typeof localStorage !== 'undefined' && localStorage.getItem('farm-render')) || 'sharp',
  scale: (typeof localStorage !== 'undefined' && [3, 4].includes(+localStorage.getItem('farm-scale'))) ? +localStorage.getItem('farm-scale') : 4,
  screenEdge: 12,
  layout: 8,                   // bump when the map layout changes; old saves are discarded            // px of margin around the near-fullscreen canvas
  world: { w: 64, h: 48, border: 3, chunk: 4, startChunks: 4 },   // tree border depth; 4×4 chunks; start with 2×2 chunks = 16×16 tiles

  time: {
    dayRealSeconds: 480,     // one full 24h game day in real seconds
    wakeHour: 6,             // the day starts here after sleeping
    passOutHour: 26,         // 2:00 next day → forced sleep
    offlineMaxHours: 0,      // the farm stands still while the game is closed or the tab is hidden (set hours to let it catch up)
  },

  // Soil moisture 0–100 %. Each pour adds waterPerPour; the sun takes evaporationPerHour; a night takes nightDry.
  // Plants grow between growMin and 100 %, fastest between idealMin and idealMax; drought stress below droughtBelow,
  // waterlogging (roots suffocate) above soggyAbove. A second pour on a wet bed waterlogs it; the hoe turns it dry.
  soil: { waterPerPour: 35, evaporationPerHour: 2, nightDry: 15, rainMoisture: 85, growMin: 20, idealMin: 40, idealMax: 85, droughtBelow: 15, soggyAbove: 90,
    // The thirst gene (0–1): a plant drinks uptakePerHour × thirst from its tile while growing, and reads the soil
    // thirstShift × (0.5 − thirst) wetter than it is, so low-thirst plants grow in drier beds and need fewer pours.
    uptakePerHour: 7, thirstShift: 24 },   // the plant's drinking, not the sun, is most of what a bed loses: thirst 0.2 ≈ 1.5 pours a day, 0.8 ≈ 4
  can: { capacity: 8 },         // pours per fill at the well
  // The hoe: seconds per bed and energy per bed at each level. Level 1 is the rusty starter.
  hoe: { seconds: [0.9, 0.6, 0.4], energy: [2, 1.5, 1] },
  // Delivery crate: crops dropped in are collected by the cart overnight and paid in the morning. Base version: one
  // crate, one pickup. SCALING LATER: bigger crates, more crates (eats land), extra pickups per day (carrier upgrades).
  crate: { capacity: 12, middayHour: 12, secondHand: 0.5 },   // with the midday pickup the cart also comes at this hour; the cart buys machines back at this share of the list price
  // The bird is the starter event: it happens once, a few game minutes after the first bed is tilled, and plants one of
  // the 15 basic species. After that, seeds come from the seed rack.
  bird: { firstDelayMinutes: [3, 8], maxTotal: 1, flightSeconds: 2.6 },
  // Seed rack: one produce dries into seeds. seeds = max(minSeeds, round(fruits per harvest × seedsPerFruit)).
  // Base version: one tray. SCALING LATER: more trays, faster drying.
  // seeds = fruits per harvest × seedsPerFruit, rolled within ±seedVariance, never below minSeeds. Drying takes dryHours
  // × (0.7 + size × 0.6) × (0.8 + thirst × 0.4): big, juicy fruit dries slowly, small dry grain fast.
  seedRack: { trays: 1, dryHours: 4, seedsPerFruit: 2, minSeeds: 2, seedVariance: 0.35 },
  actions: { hoeSeconds: 0.9, waterSeconds: 0.7, fillSeconds: 1.0, drinkSeconds: 0.9, eatSeconds: 1.6, plantSeconds: 0.5 },
  // Quick hands: seconds per crop into the crate (or onto a tray) at each level. Level 1 is you, untrained.
  hands: { dropSeconds: [0.35, 0.22, 0.12] },
  // Sprinkler I (stage 3, the first automation). Sits on a tile of your land and, while you are awake, gives a pour to
  // any bed within radius the moment it dries below idealMin (planted or not, so a bed is wet when you plant it). It
  // never goes above the band, so it cannot waterlog. The water is metered: pricePerPour is charged against the night's sale. Sized so
  // a sprinkler over beds the cart can sell runs at 10–20% of what they earn, and one over beds it cannot sell loses
  // money. Prices are flat per tier: scaling comes from the tiers and the infrastructure under them, not a rising price
  // tag. II and III reach 2 and 3 tiles (24 and 48 beds) and draw 2 and 4 of the line's pressure (see `pump`).
  // A sprinkler wets a bed gradually: a pour's worth of water over sprayMinutes, from the moment the bed drops below the band until it is topped up.
  sprinkler: { pricePerPour: 0.2, sprayMinutes: 20, tiers: [
    { name: 'Sprinkler I', radius: 1, price: 140, draw: 1 },
    { name: 'Sprinkler II', radius: 2, price: 350, draw: 2 },
    { name: 'Sprinkler III', radius: 3, price: 900, draw: 4 },
  ] },
  // Pipe: the infrastructure under the sprinklers. Sections come in packs; each one laid takes a clear tile (yard or
  // your land, never a bed). A sprinkler runs only on a pipe tile with an unbroken line back to the well. The limit on
  // automation is what you can lay and where, not a rising price tag.
  pipe: { packSize: 10, packPrice: 20 },
  // Pumps: flow. (The old model: the well ran `wellFeeds` sprinklers and every pump on fed pipe added
  // its `feeds`. Past the cap the sprinklers furthest down the line (by pipe distance) run dry. The windmill stands
  // the engine burns fuel every day it stands on fed pipe. Every pump gives a constant feed: a farm that stops when you are not looking is misery.
  // Power (the start of stage 4). A generator stands on your land and, while switched on and fuelled, burns a can of fuel a night and
  // makes `power` for the line laid from it; each machine on the line draws its own `power`, nearest the generator
  // first by line distance. The line carries power only. A picker on powered line takes `perHour` ripe crops an hour
  // from the beds in its reach into a basket and drops the basket on a belt beside it. Belt is laid a tile a section
  // like pipe and line (it can share a tile with both); a run of belt moves its crops one tile every `stepMinutes`
  // toward the powered hopper it reaches (the hopper's motor drives the belt, which is why it draws more power),
  // each tile holding `holds` crops. A hopper beside the crate tips into it when the cart comes; a hopper anywhere
  // else is a store you empty by hand. Tiers (faster, stronger) come later with a level like pumps.
  power: { generator: { price: 600, fuelPerDay: 1, power: 6, tiers: [{ name: 'Generator', power: 6, fuelPerDay: 1, price: 600 }, { name: 'Generator II', power: 12, fuelPerDay: 2, price: 1400 }, { name: 'Generator III', power: 20, fuelPerDay: 3, price: 3000 }] }, line: { packSize: 10, packPrice: 25 },   // generator tiers (Build 82): more power, more cans a night
    belt: { packSize: 10, packPrice: 40, holds: 4, stepMinutes: 6 },
    picker: { price: 250, radius: 1, perHour: 1, holds: 6, power: 1, tiers: [{ name: 'Picker', radius: 2, block: 1, perHour: 4, holds: 8, power: 1, price: 250 }, { name: 'Picker II', radius: 3, block: 2, perHour: 8, holds: 16, power: 2, price: 600 }, { name: 'Picker III', radius: 4, block: 3, perHour: 16, holds: 32, power: 3, price: 1300 }] },   // a tier serves the sprinkler block of the same tier from the tile beside the sprinkler, so it reaches one further (Build 84)
    // The planter (Build 81): on powered line like a picker; holds seeds and bags you load by hand; once an hour it plants the empty
    // beds in its reach with the seed it holds, working a bag in first when it has one. Planting and fertilising in one machine.
    planter: { seeds: 30, bags: 10, tiers: [{ name: 'Planter', radius: 2, block: 1, perHour: 2, power: 1, price: 350 }, { name: 'Planter II', radius: 3, block: 2, perHour: 4, power: 2, price: 800 }, { name: 'Planter III', radius: 4, block: 3, perHour: 6, power: 3, price: 1700 }] },
    hopper: { price: 400, holds: 30, power: 2 },
    // The dryer (Build 67): the first thing that turns a crop into a product. On powered line like a picker; belt run to it feeds
    // it (its motor drives that belt, like a hopper's) and it sets what it has dried on any running belt beside it that leads away.
    // It dries `batch` of one kind at a time, taking baseHours + skinHours × the skin gene; `holds` wait in the hopper on top, `output` on the tray.
    dryer: { price: 320, holds: 8, output: 12, batch: 4, power: 1, baseHours: 3, skinHours: 5 },
    // Build 71: a splitter sits on a belt tile and sends each crop that arrives down a different way in turn; a filter sends dried
    // goods one way and everything else the other (click it to swap the sides). Neither needs power: the belt carries them.
    splitter: { price: 60 }, filter: { price: 90 } },
  // Flow has a range in tiles, like a signal. The well gives `wellHead` tiles of flow to the pipe leaving it; every tile
  // travelled costs 1; where the pipe splits, each branch gets what it asks for (the sprinklers and tiles beyond it) and
  // what none asked for is shared evenly, so a short stub never starves a long run; a sprinkler drinks its
  // `draw` from the flow at its tile and runs only when that much arrives; a running pump standing in the flow adds its
  // `head` tiles from where it stands. Pipe the flow does not reach is dry. The well alone wets the yard, not the farm.
  pump: { wellHead: 6, tiers: [
    { name: 'Hand pump', head: 16, price: 200 },   // priced so two of them cost a windmill and give less, on two tiles
    { name: 'Windmill', head: 36, price: 400 },
    { name: 'Engine', head: 180, price: 1200, fuelPerDay: 1 },   // five windmills of head on one tile for three windmills' money; it burns a can a night (see `fuel`)
  ] },
  // Fuel is a thing you carry: the catalogue sells it by the can, you pour cans into a generator or an engine, and each
  // running one burns `fuelPerDay` cans a night. A tank holds `tank` cans. Empty, the machine stops until you fill it.
  fuel: { price: 8, packSize: 5, tank: 7 },
  // The bank, at the delivery sign. One loan at a time: the money comes at once, and every night the bank adds
  // `nightly` of what you owe as interest. Nothing is taken from you: you pay back what you like, when you like, in
  // the catalogue (`payments`, or everything). The rate is the same at every size; bigger loans open once you have
  // sold `gates` worth of crops in all.
  loan: { sizes: [250, 600, 1500], gates: [0, 500, 2000], nightly: 0.02, payments: [25, 100] },
  // Humidity 0–100 is rolled each morning (rain days are near 100). Evaporation × (evapBase − humidity/100 × evapSpan):
  // dry air (20%) dries beds at full speed, a rainy day (95%) at about a third.
  weather: { humidityRain: [85, 98], humidityRange: [20, 70], evapBase: 1.2, evapSpan: 0.9, drainPerTurn: 35 },
  catalogSeedDays: 3,
  // The market: an hour's walk down the track. Shoppers come along the lane between open and close while you stand at
  // your stall, one every arrivalMinutes; each wants a family of food (wantChance) or anything, buys one (or two, twoChance)
  // of what matches, or of anything half the time when nothing matches, at full price plus a tip of up to tipMax, more for a
  // match and for stars. The seed merchant marks packets up, the hardware stall marks packs up; both sell on the spot.
  market: { travelMinutes: 60, open: 8, close: 18, arrivalMinutes: [7, 13], pauseMinutes: 4, laneSpeed: 0.45, counterSlots: 6,
    wantChance: 0.6, buyAnyChance: 0.5, twoChance: 0.35, tipMax: 0.25, matchTip: 0.1, starTip: 0.05, seedMarkup: 1.5, hardwareMarkup: 1.25, storeSlots: 16 },   // storeSlots: the chest in the back of your tent          // seed packets rotate every this many days
  // The cart's buyer has a daily order per kind of crop: the first `full` of a species in one pickup fetch the full price,
  // the next `full` the first step, and so on; the cart sells the surplus on cheaper. A crate of one crop pays less
  // per crop than a crate of three, so variety (and every new species bred) is worth money.
  demand: { full: 8, steps: [0.6, 0.4] },
  // The truck (Build 72): once the crate is fully extended the catalogue sells a truck that replaces the cart and empties every
  // delivery crate on the farm along with the one by the porch; delivery crates are set where the belts end.
  // The truck (Build 76) stands in the bay by day with crate slots on its bed; that is the night's capacity. The haulier's
  // crates are free: each morning the truck leaves as many empties on the gravel as it has slots. Belts and hoppers fill them;
  // a full crate is lifted and carried to the truck by hand (the forklift comes later). Bigger trucks replace the small one.
  truck: { crateHolds: 12, emptiesOut: 4, tiers: [{ name: 'Small truck', slots: 4, price: 900 }, { name: 'Medium truck', slots: 8, price: 1500 }, { name: 'Large truck', slots: 12, price: 2800 }] },
  // What drying does to a price: a dried crop is worth its fresh price × (base + sugar × the sugar gene), so a bland crop loses
  // by drying and a sweet one doubles; stars count for half as much once it is dried (the product is the thing, not the fruit).
  // Dried goods are their own line at the cart's buyer (their own `demand.full`) and the market's shoppers ask for them by name.
  dried: { base: 0.7, sugar: 1.6, starValue: 0.5, wantChance: 0.3 },
  wild: { numericJitter: 0.12, growJitter: 0.25 },   // bird seeds vary this much from their base species

  crop: {
    dryHealthLossPerHour: 4, // base health lost per dry hour (scaled by thirst and hardiness)
    wetHealthGainPerHour: 2,
    soggyHealthLossPerHour: 3,
    rotHours: 48,            // after the ripe window, value falls to 0 over this long (two days: it browns visibly first), then the crop dies
    regrowResetTo: 55,       // growth % a regrowing crop drops back to after harvest
    neighbourBonus: 0.05,    // +growth speed per different neighbouring species (max 4)
    nightGrowth: 0.5,        // growth speed from 8pm to 6am, awake or asleep: plants slow down in the dark
  },

  energy: { max: 100, hoe: 2, water: 1, plant: 0.5, harvest: 1, clear: 1, place: 1 },
  needs: { hungerHours: 36, thirstHours: 24, starvingEnergyPerHour: 3,     // hours for a full bar to empty; energy lost per hour at 0
    weakBelow: 25, weakSpeed: 0.7,                                          // under this hunger or thirst you walk slower
    tiredBelow: 20, tiredSpeed: 0.6, tiredActionSlow: 1.5,                 // under this energy you drag your feet and every action takes longer
    sleepDrain: 0.5,                                                        // hunger and thirst drain at this rate while asleep
    wakeFloor: 0.4,                                                         // waking energy = max × (floor + (1 − floor) × lower of hunger/thirst)
    eatEnergyPerHunger: 0.6, drinkEnergy: 5,                                // food gives energy right away (fraction of the hunger it restores); a drink gives a little
    eatBase: 15, eatPerSize: 35 },                                          // hunger restored by one produce: base + size × perSize
  player: { speed: 5.5, reach: 1.7, carrySpeed: 0.55, pickUpSeconds: 0.5,     // tiles per second, tiles; carrying slows you; hold LMB this long to lift
    heavyAt: 60, heavySpeed: 0.75 },                                           // this many crops in your pockets and you walk slower
  inventory: { slots: 5, hotbar: 5, stack: 99 },   // what you carry IS the hotbar: five pockets. Everything else lives in the chest.
  chest: { slots: 24, field: { price: 80, slots: 16, tiers: [{ name: 'Field chest', slots: 16, price: 80 }, { name: 'Large chest', slots: 32, price: 220 }, { name: 'Great chest', slots: 56, price: 500 }] } },   // field chests come in three sizes (Build 71); a belt can end at any of them   // the chest by the porch, and the field chests the catalogue sells: set anywhere on your land

  economy: {
    startMoney: 15,
    landBase: 45, landGrowth: 1.5,          // a land deed: the big-ticket item, so it scales fast
    compostBinCost: 60,
    breedCostBase: 5,                 // + rarity-based extra
    seedPriceFraction: 0.35,          // catalogue seed price as a fraction of one harvest's value
    seedBookBonusPerSpecies: 0.02,    // +2% sale price per species discovered beyond the starters
    rainChance: 0.2,
  },

  // Coins per real minute of growing, per tile = rateBase × rateGrowth^rarity. No cap: rarity keeps rising with
  // generations and rare traits, so price grows exponentially. Tiers are just labels on the rarity score.
  tiers: {
    order: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
    thresholds: { uncommon: 4, rare: 10, epic: 20, legendary: 34 },   // rarity score needed
    rateBase: 1.0, rateGrowth: 1.12,
    seedDrops: { common: [1, 3], uncommon: [1, 2], rare: [0, 1], epic: [0, 1], legendary: [0, 1] },
    seedDropChance: { common: 1, uncommon: 0.9, rare: 0.6, epic: 0.4, legendary: 0.15 },
  },

  genetics: {
    mutationChance: 0.05,        // per gene
    numericNoise: 0.08,          // blend noise (fraction of range)
    mutationSize: 0.35,          // numeric mutation jump (fraction of range)
    familyDistancePenalty: 0.35, // instability added when parents are different families
    mutationInstability: 0.12,   // instability per unit of mutation mass
    rarityInstability: 0.006,    // instability per point of combined parent rarity
    minInstability: 0.04, maxInstability: 0.9,
    rareInheritOne: 0.25, rareInheritBoth: 0.75, rareGainChance: 0.012,
    rareGainCrossFamilyBonus: 2.5,   // multiplies rareGainChance; a rare trait appears from nothing ONLY when the families differ (same-family crosses only inherit)
    failureSplit: { sterile: 0.5, wither: 0.3, revert: 0.2 },
    // Hybrid vigour (the vigor gene, 0–1): a cross between families takes the better parent's vigour plus a step; a
    // same-family cross lets it fade. Each point multiplies the price by (1 + vigorValue), so a first cross-family child
    // sells about 15–22% dearer than its blend would, and the step passes down.
    vigorStep: 0.3, vigorJitter: 0.15, vigorFade: 0.85, vigorValue: 0.5,
    generationRarity: 3.5, maxGenerationRarity: Infinity,   // each generation adds this much rarity: about ×1.5 on the price, uncapped (the Cookie Clicker curve)
    // No premium for care genes: the cart buys a carrot and cannot tell how often it was watered. Thirst and hardiness pay
    // in your time (fewer pours, fewer withered beds), not in the price.
    breederSeedsOnSuccess: [2, 4],
  },

  // Compost bin: crops and withered plants go in by hand during the day (one at a time, like the crate); the lid shuts
  // at bedtime and the heap has rotted into fertiliser by morning. One bag per 3 plants. What goes in sets what comes
  // out: fast crops give Speed, many-fruited give Yield, hardy give Hardiness, low-thirst give Water keep, rarer give
  // Quality (stars on the harvest, +30% price each), bred give Mutation.
  fertiliser: {
    compostHours: 12,             // when started by hand (tests); sleeping finishes it by morning regardless
    compostMinInputs: 3, compostMax: 12,
    compostTiers: [{ max: 12, perBag: 3 }, { max: 24, perBag: 2.5 }, { max: 40, perBag: 2 }],   // the bin and its two extensions (Build 68): bigger, and a bag from fewer plants
    binPrices: [150, 400],
    compostBudgetPerInput: 0.08,  // budget grows with how many and how good the inputs were
    compostBudgetCap: 0.6,          // the cap for common and uncommon inputs; rarer inputs raise it (Build 79)
    compostCapByTier: [0.6, 0.6, 0.75, 0.9, 0.95],   // by the inputs' average tier: common, uncommon, rare, epic, legendary
    qualityPullByTier: [0, 1, 2, 3, 4],             // how hard a crop of each tier pulls the bag toward Quality
    statCap: 0.8,
    qualityStarValue: 0.3,        // each quality star adds +30% value
    mutationBonusPerPoint: 1.5,
  },

  titles: [
    [0, 'Backyard Gardener'], [500, 'Market Gardener'], [5e3, 'Family Farmer'], [5e4, 'Estate Owner'],
    [5e5, 'Agribusiness'], [5e6, 'Biotech Pioneer'], [5e7, 'Seed Baron'], [5e8, 'Terraformer'], [5e9, 'World Gardener'],
  ],
};
