# Recorded sound effects

The game makes every sound itself unless a recording is listed here. Put `.ogg` (best), `.wav` or `.mp3` files in this
folder and name them in `manifest.json`; the game loads what it finds on the first click and plays it instead of the
synthesised version, with the pitch nudged a little each time, the way Minecraft does. A name can list several files
(`"step": ["step1.ogg", "step2.ogg", "step3.ogg"]`): one is picked at random each play, which is what keeps footsteps
from sounding like a machine. Missing files are skipped. Settings → Sound → Audition plays each one so you can judge.

What each should be, with the Minecraft sound it is closest to. Keep them short and quiet: these play many times a minute.

| name | plays when | what it should sound like | length |
|---|---|---|---|
| step | every footstep | a soft footfall on grass; 3–4 variants (`grass1..4`) | 0.1 s |
| dig | hoeing, clearing, flattening | a spade into soil (`gravel.dig` / `grass.dig`) | 0.2 s |
| water | a pour from the can | a short splash of water on earth (`water.splash`, small) | 0.4 s |
| fill | filling the can at the well | water gurgling into a bucket (`bucket.fill_water`) | 0.6 s |
| plant | a seed goes in | a soft press into soil, almost a pat (`crop.plant`) | 0.1 s |
| harvest | picking a ripe crop | a snap or pluck, bright and short (`item.pickup` has the feel) | 0.15 s |
| eat | eating | a crunchy bite, 2–3 variants (`player.burp` is the joke; `eat1..3` the real ones) | 0.25 s |
| drink | drinking at the well | a gulp (`drink`) | 0.5 s |
| drop | a crop into the crate or bin | a soft thud of something small into wood (`wood.place`, quiet) | 0.1 s |
| coin | a sale at the stall | a bright coin ping (`experience_orb.pickup`) | 0.2 s |
| buy | an order placed | a cash-register or coins poured (`villager.yes` feel) | 0.4 s |
| chest | the chest opens | a wooden lid (`chest.open`) | 0.3 s |
| ui | a panel opens | a wooden click (`ui.button.click`) | 0.05 s |
| hover | the cursor lands on a thing | a tiny tick, very quiet | 0.03 s |
| move | a stack changes pockets | a pop (`item.pickup`) | 0.08 s |
| close | a panel closes | a lower wooden click | 0.05 s |
| no | an action refused | a dull double knock, never a buzzer (`villager.no` feel, softer) | 0.2 s |
| bird | the bird comes | a short chirp, two or three notes (`parrot` / `bat` are too much) | 0.3 s |
| cart | the cart arrives | wheels on dirt and a bell (`minecart.inside`, quiet) | 1.5 s |
| sleep | going to bed | three descending soft notes, or a yawn | 1 s |
| morning | waking | a rooster, or rising soft notes | 1 s |
| seeds | seeds taken from the rack | a dry rattle of seeds in a paper packet | 0.25 s |
| tired | energy runs low | a tired sigh | 0.5 s |

Where to get them without a licence problem: Kenney's audio packs (kenney.nl/assets, CC0: "Impact Sounds",
"Interface Sounds", "RPG Audio"), freesound.org filtered to CC0, OpenGameArt filtered to CC0. Record your own with a
phone for steps, digs and seeds: it is what Minecraft did. Trim silence off the start, normalise to about −6 dB.
