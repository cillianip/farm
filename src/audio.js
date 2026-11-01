// Sound. Everything is synthesised with the Web Audio API unless a recording is dropped into assets/sfx and named in
// its manifest: then the recording plays instead, pitched a little differently each time like Minecraft's, and a name
// with several files picks one at random. Short effects for the hands-on actions, a looping theme, a rain bed.
// The rule since Build 66 is Minecraft's: the hands make a sound, the interface stays quiet. No hover ticks, no error
// buzz, no voices, no jingles. Loops are soft and steady. Volumes live in localStorage, not the save.
const KEY = 'farm-audio';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const freq = n => { const m = /^([A-G])(#?)(\d)$/.exec(n); if (!m) return 0; const semi = NOTE[m[1]] + (m[2] ? 1 : 0) + (+m[3] + 1) * 12; return 440 * Math.pow(2, (semi - 69) / 12); };

// The theme: a slow walk round a field. 16 bars of 8 eighth notes; '-' holds the last note, '.' is a rest.
const BPM = 100, EIGHTH = 60 / BPM / 2;
const CHORDS = ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G', 'Am', 'F', 'C', 'G', 'F', 'G', 'C', 'C'];
const LEAD = [
  'E4 G4 A4 G4 E4 D4 C4 D4', 'E4 - A4 - C5 - B4 A4', 'A4 G4 F4 G4 A4 C5 A4 G4', 'G4 - - - D4 E4 F4 G4',
  'E4 G4 C5 - B4 A4 G4 E4', 'A4 - C5 - E5 D5 C5 B4', 'C5 A4 F4 - G4 A4 C5 A4', 'G4 - - - - - . .',
  'E5 - C5 - A4 - B4 C5', 'D5 C5 A4 - F4 - A4 C5', 'E5 - G5 - E5 D5 C5 D5', 'B4 - D5 - G4 - A4 B4',
  'C5 A4 F4 A4 C5 - A4 F4', 'D5 B4 G4 B4 D5 - B4 G4', 'C5 - E5 - G5 - E5 C5', 'C5 - - - - - . .',
].map(b => b.split(' '));
const TRIAD = { C: ['C3', 'E3', 'G3'], Am: ['A2', 'C3', 'E3'], F: ['F2', 'A2', 'C3'], G: ['G2', 'B2', 'D3'] };

export class Sound {
  constructor() {
    this.ctx = null;
    this.prefs = Object.assign({ master: 0.8, sfx: 0.8, music: 0.5, muted: false }, load() || {});
    this.musicOn = false; this.stepT = 0; this.samples = {}; this.sampleGain = {}; this.v = 1; this.loops = {};
  }
  // ---------- families: helpers the effects share ----------
  ticks(t, n, gapMin, gapMax, f, q, gain, dur) { let at = t; for (let k = 0; k < n; k++) { this.noise(at, dur, gain * (0.7 + Math.random() * 0.5), null, { type: 'bandpass', f: f * (0.8 + Math.random() * 0.4), q }); at += gapMin + Math.random() * (gapMax - gapMin); } }
  clank(t, f, gain) { this.noise(t, 0.08, gain, null, { type: 'bandpass', f, q: 8 }); this.osc('sine', f * 0.6, t, 0.06, gain * 0.5, null, { decay: 0.2 }); }
  breath(t, dur, gain, f0, f1) { this.osc('triangle', f0, t, dur, gain * 0.6, null, { to: f1, attack: 0.1 }); this.noise(t, dur, gain, null, { type: 'bandpass', f: 900, q: 1, attack: 0.1 }); }
  // ---------- loops: the game sets each one's level every frame from how near you stand ----------
  setLoop(name, level) {
    if (!this.ctx) return; const c = this.ctx; level = Math.max(0, Math.min(1, level || 0));
    let L = this.loops[name];
    if (!L) { if (level <= 0) return; L = this.loops[name] = { level: 0, timer: 0, nodes: null }; if (this.samples[name]) { const g = c.createGain(); g.gain.value = 0; const s = c.createBufferSource(); s.buffer = this.samples[name][0]; s.loop = true; s.connect(g); g.connect(this.sfxBus); s.start(); L.nodes = { gain: g, base: 0.5 }; } else if (LOOPS[name]) L.nodes = LOOPS[name].call(this, c); }
    L.level = level;
    if (L.nodes) L.nodes.gain.gain.setTargetAtTime(this.prefs.muted ? 0 : level * L.nodes.base, c.currentTime, 0.15);
  }
  tickLoops(dt) {
    if (!this.ctx || this.prefs.muted) return; const t = this.ctx.currentTime;
    for (const [name, L] of Object.entries(this.loops)) { if (L.level <= 0) continue; const P = PERIODIC[name]; if (!P || this.samples[name]) continue; L.timer -= dt; if (L.timer <= 0) { L.timer = P.every(); this.v = 1; P.fire.call(this, t, L.level); } }
  }
  previewLoop(name) { this.unlock(); this.previewUntil = performance.now() + 2500; this.setLoop(name, 1); setTimeout(() => { this.setLoop(name, 0); }, 2500); }

  // every synthesised effect is pitched a little differently each play (±8%); recordings get the same nudge in playbackRate
  vary(pct = 0.08) { return 1 + (Math.random() * 2 - 1) * pct; }
  // recordings: the manifest maps a name to files in assets/sfx; whatever decodes is used, the rest stays synthesised
  async loadSamples() {
    let man = null; try { const r = await fetch('assets/sfx/manifest.json'); if (r.ok) man = await r.json(); } catch {}
    if (!man) return;
    const cache = new Map();   // a file used under several names decodes once
    for (const [name, entry] of Object.entries(man)) {
      const files = Array.isArray(entry) ? entry : entry?.files, gain = Array.isArray(entry) ? 1 : entry?.gain ?? 1;
      if (!Array.isArray(files) || !files.length) continue;
      const bufs = [];
      for (const f of files) { try { if (!cache.has(f)) { const r = await fetch('assets/sfx/' + f); cache.set(f, r.ok ? await this.ctx.decodeAudioData(await r.arrayBuffer()) : null); } const b = cache.get(f); if (b) bufs.push(b); } catch {} }
      if (bufs.length) { this.samples[name] = bufs; this.sampleGain[name] = gain; }
    }
  }
  playSample(name, gain = 1) {
    const bufs = this.samples[name]; if (!bufs?.length) return false;
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain();
    s.buffer = bufs[Math.floor(Math.random() * bufs.length)]; s.playbackRate.value = this.vary(0.1);
    g.gain.value = gain * (this.sampleGain[name] ?? 1); s.connect(g); g.connect(this.sfxBus); s.start();
    return true;
  }
  // Browsers only let audio start after a gesture: call this from the first click or key.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.master);
      const n = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate), d = n.getChannelData(0);   // two seconds of white noise, reused
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = n;
      this.apply(); this.loadSamples();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.musicOn) this.startMusic();
    return true;
  }
  set(k, v) { this.prefs[k] = v; try { localStorage.setItem(KEY, JSON.stringify(this.prefs)); } catch {} this.apply(); }
  apply() {
    if (!this.ctx) return;
    const p = this.prefs, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(p.muted ? 0 : p.master, t, 0.02);
    this.sfxBus.gain.setTargetAtTime(p.sfx, t, 0.02);
    this.musicBus.gain.setTargetAtTime(p.music * 0.6, t, 0.02);
  }

  // ---------- building blocks ----------
  osc(type, f, t0, dur, gain, dest, { to = null, attack = 0.005, decay = null } = {}) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f * this.v, t0); if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to * this.v), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack);
    if (decay != null) g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain * decay), t0 + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || this.sfxBus); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  noise(t0, dur, gain, dest, { type = 'lowpass', f = 1000, to = null, q = 1, attack = 0.005 } = {}) {
    const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; s.loop = true; fl.type = type; fl.frequency.setValueAtTime(f * this.v, t0); if (to) fl.frequency.exponentialRampToValueAtTime(to * this.v, t0 + dur); fl.Q.value = q;
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(dest || this.sfxBus); s.start(t0, Math.random()); s.stop(t0 + dur + 0.05);
  }

  // ---------- effects ----------
  play(name) {
    if (!this.ctx || this.prefs.muted) return;
    if (this.playSample(name)) return;
    this.v = this.vary(); const t = this.ctx.currentTime, fx = this.FX[name]; if (fx) fx.call(this, t); this.v = 1;
  }
  get FX() { return FX; }
  // one footfall: the game calls it as each foot lands in the walk animation, with the ground it lands on
  footfall(surface = 'grass') {
    if (!this.ctx || this.prefs.muted) return;
    const name = surface === 'soil' ? 'stepSoil' : surface === 'track' ? 'stepTrack' : 'step';
    if (this.playSample(name, 0.8)) return;
    this.v = this.vary(0.12); FX[name].call(this, this.ctx.currentTime); this.v = 1;
  }
  get LOOP_NAMES() { return LOOP_NAMES; }
  // the rain bed: a hiss that fades in and out with the weather
  rain(on) {
    if (!this.ctx) return;
    if (on && !this.rainNode) {
      const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
      s.buffer = this.noiseBuf; s.loop = true; fl.type = 'lowpass'; fl.frequency.value = 1100; g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.linearRampToValueAtTime(0.11, c.currentTime + 2);
      s.connect(fl); fl.connect(g); g.connect(this.sfxBus); s.start(); this.rainNode = { s, g };
    } else if (!on && this.rainNode) { const { s, g } = this.rainNode; this.rainNode = null; g.gain.linearRampToValueAtTime(0.0001, this.ctx.currentTime + 1.5); s.stop(this.ctx.currentTime + 1.6); }
  }

  // ---------- music ----------
  startMusic() {
    this.musicOn = true; this.beat = 0; this.nextT = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 120);
  }
  schedule() {
    const c = this.ctx; if (!c) return;
    if (this.nextT < c.currentTime - 0.3) { this.nextT = c.currentTime + 0.05; }   // we fell behind (hidden tab, suspended context): skip ahead rather than burst
    while (this.nextT < c.currentTime + 1.2) {
      const bar = Math.floor(this.beat / 8) % LEAD.length, i = this.beat % 8, t = this.nextT;
      const n = LEAD[bar][i];
      if (n !== '-' && n !== '.') {   // the lead: a plucked triangle; a held note lasts until the next real note
        let len = 1; for (let k = i + 1; k < 8 && LEAD[bar][k] === '-'; k++) len++;
        this.osc('triangle', freq(n), t, EIGHTH * len * 0.95, 0.16, this.musicBus, { attack: 0.01, decay: 0.35 });
      }
      if (i === 0 || i === 4) { const tri = TRIAD[CHORDS[bar]]; this.osc('triangle', freq(tri[0]) / 2, t, EIGHTH * 3.8, 0.2, this.musicBus, { attack: 0.01, decay: 0.4 }); }   // bass on 1 and 3
      if (i === 2 || i === 6) { const tri = TRIAD[CHORDS[bar]]; this.osc('triangle', freq(tri[2]) / 2, t, EIGHTH * 1.8, 0.12, this.musicBus, { attack: 0.01, decay: 0.4 }); }   // the fifth on 2 and 4
      if (i === 0) for (const ch of TRIAD[CHORDS[bar]]) this.osc('sine', freq(ch), t, EIGHTH * 7.8, 0.045, this.musicBus, { attack: 0.3 });   // a soft pad under the bar
      if (i === 2 || i === 6) this.noise(t, 0.04, 0.025, this.musicBus, { type: 'highpass', f: 6000 });   // a brush on the off-beats
      this.nextT += EIGHTH; this.beat++;
    }
  }
}

// Each effect is a few oscillators or filtered noise bursts: the sound of the thing, not a recording of it. Families
// share a recipe: earth is lowpass noise over a thump, wood is a click over a damped tone, metal is a ringing band,
// water is a swept band with bubbles and drops, fibre is a transient and a crackle, particles are clusters of ticks,
// coins are paired sines, voices are a quiet tone under a breath. A recording in assets/sfx replaces any of them.
const FX = {
  // --- you
  step(t) { this.noise(t, 0.09, 0.3, null, { f: 900, to: 350 }); this.osc('sine', 80, t, 0.06, 0.22, null, { to: 55 }); },                                   // grass: a crunch with weight under it
  stepSoil(t) { this.noise(t, 0.1, 0.26, null, { f: 500, to: 200 }); this.osc('sine', 70, t, 0.07, 0.24, null, { to: 50 }); },                                // soil: duller, softer
  stepTrack(t) { this.noise(t, 0.07, 0.28, null, { type: 'bandpass', f: 1400, to: 700, q: 0.8 }); this.osc('sine', 90, t, 0.04, 0.12, null, { to: 60 }); },   // the dirt track: a dry scuff
  eat(t) { this.noise(t, 0.012, 0.22, null, { type: 'highpass', f: 3000 }); this.noise(t + 0.01, 0.09, 0.24, null, { f: 1500, to: 300, attack: 0.003 }); this.osc('sine', 180, t + 0.01, 0.06, 0.08, null, { to: 90 }); this.noise(t + 0.16, 0.07, 0.14, null, { f: 600, to: 250, attack: 0.02 }); this.noise(t + 0.28, 0.07, 0.1, null, { f: 500, to: 220, attack: 0.02 }); },   // one bite: a crisp snap and crunch, then two soft chews; the action repeats it
  drink(t) { for (let k = 0; k < 2; k++) { const g = t + k * 0.22; this.noise(g, 0.14, 0.12, null, { type: 'bandpass', f: 600, to: 1500, q: 2, attack: 0.02 }); this.osc('sine', 380, g + 0.02, 0.12, 0.04, null, { to: 760 }); } },
  passout(t) { this.noise(t, 0.12, 0.3, null, { f: 400, to: 150 }); this.osc('sine', 70, t, 0.12, 0.25, null, { to: 40 }); },   // a thud
  // --- earth
  dig(t) { this.noise(t, 0.14, 0.5, null, { f: 500, to: 180 }); this.osc('sine', 110, t, 0.16, 0.35, null, { to: 45 }); },
  flatten(t) { this.noise(t, 0.32, 0.3, null, { f: 700, to: 250, attack: 0.04 }); this.noise(t + 0.18, 0.14, 0.2, null, { f: 500, to: 200 }); this.osc('sine', 90, t + 0.26, 0.1, 0.15, null, { to: 50 }); },   // a dragging scrape
  drain(t) { this.noise(t, 0.2, 0.3, null, { type: 'bandpass', f: 900, to: 300, q: 1.2 }); for (let k = 0; k < 4; k++) this.osc('sine', 300 + k * 90, t + 0.05 + k * 0.05, 0.06, 0.06, null, { to: 700 + k * 120 }); this.osc('sine', 100, t, 0.12, 0.2, null, { to: 50 }); },   // a wet squelch
  water(t) { this.noise(t, 0.55, 0.11, null, { type: 'bandpass', f: 1300, to: 800, q: 0.7, attack: 0.08 }); this.noise(t + 0.04, 0.4, 0.05, null, { f: 450, to: 280, attack: 0.06 }); },   // one soft pour, as long as the can tilts
  fill(t) { this.noise(t, 0.7, 0.13, null, { type: 'bandpass', f: 700, to: 1800, q: 1, attack: 0.05 }); this.osc('sine', 300, t, 0.7, 0.03, null, { to: 700 }); },
  plant(t) { this.osc('sine', 520, t, 0.08, 0.25, null, { to: 260 }); this.noise(t + 0.02, 0.05, 0.12, null, { f: 700 }); },
  harvest(t) { this.noise(t, 0.05, 0.3, null, { f: 1800, to: 400 }); this.osc('sine', 300, t, 0.08, 0.2, null, { to: 150 }); this.osc('triangle', 900, t + 0.05, 0.1, 0.07, null, { to: 1300 }); },
  pull(t) { this.noise(t, 0.05, 0.3, null, { f: 1800, to: 400 }); this.osc('sine', 260, t, 0.08, 0.15, null, { to: 120 }); this.ticks(t + 0.04, 7, 0.02, 0.05, 2200, 2, 0.14, 0.015); this.noise(t + 0.12, 0.16, 0.18, null, { f: 600, to: 250, attack: 0.03 }); },   // roots tearing
  wither(t) { this.noise(t, 0.22, 0.18, null, { type: 'bandpass', f: 1300, to: 500, q: 0.9, attack: 0.02 }); this.noise(t + 0.06, 0.16, 0.14, null, { f: 700, to: 250, attack: 0.02 }); this.osc('sine', 90, t + 0.14, 0.08, 0.12, null, { to: 50 }); },   // a dry crumble into the soil, no clicks
  fertilise(t) { this.ticks(t, 8, 0.015, 0.03, 1800, 2, 0.1, 0.015); this.noise(t + 0.25, 0.08, 0.18, null, { f: 600, to: 250 }); },   // a shake of crumbs then a pat
  seedback(t) { this.noise(t, 0.012, 0.14, null, { type: 'bandpass', f: 2800, q: 4 }); this.osc('sine', 1400, t + 0.01, 0.03, 0.04, null, { to: 1000 }); },
  // --- wood and stations
  chest(t) { this.noise(t, 0.03, 0.25, null, { f: 1400, to: 600 }); this.noise(t + 0.03, 0.22, 0.09, null, { type: 'bandpass', f: 380, to: 820, q: 2.5, attack: 0.02 }); this.noise(t + 0.24, 0.04, 0.22, null, { f: 1000 }); this.osc('sine', 170, t + 0.24, 0.07, 0.1, null, { to: 110 }); },
  chestClose(t) { this.noise(t, 0.04, 0.3, null, { f: 1200, to: 500 }); this.osc('sine', 140, t, 0.1, 0.18, null, { to: 90 }); },
  move(t) { this.osc('sine', 520, t, 0.05, 0.12, null, { to: 260 }); this.noise(t, 0.03, 0.15, null, { f: 2500, to: 800 }); },
  rackPlace(t) { this.noise(t, 0.06, 0.16, null, { f: 900, to: 400, attack: 0.01 }); this.osc('sine', 220, t + 0.01, 0.06, 0.06, null, { to: 160 }); },
  seeds(t) { this.ticks(t, 9, 0.018, 0.048, 3200, 3, 0.2, 0.012); },
  seedsBred(t) { this.ticks(t, 9, 0.018, 0.048, 3200, 3, 0.2, 0.012); this.osc('sine', 1760, t + 0.12, 0.2, 0.05, null, { decay: 0.3 }); },
  glass(t) { this.osc('sine', 2200, t, 0.12, 0.08, null, { decay: 0.3 }); this.osc('sine', 3300, t, 0.08, 0.04); this.noise(t, 0.015, 0.1, null, { type: 'highpass', f: 5000 }); },
  drop(t) { this.osc('sine', 190, t, 0.1, 0.35, null, { to: 120 }); this.noise(t, 0.04, 0.25, null, { f: 1200 }); },
  scoop(t) { this.noise(t, 0.16, 0.25, null, { f: 800, to: 300, attack: 0.02 }); this.ticks(t + 0.02, 6, 0.012, 0.03, 1500, 2, 0.08, 0.012); },
  crateFull(t) { for (const d of [0, 0.12]) { this.noise(t + d, 0.03, 0.25, null, { f: 900, to: 400 }); this.osc('sine', 120, t + d, 0.09, 0.2, null, { to: 100 }); } },
  ui(t) { this.noise(t, 0.03, 0.22, null, { f: 2200, to: 900 }); this.osc('sine', 420, t, 0.05, 0.07, null, { to: 300 }); },
  buy(t) { this.osc('sine', 1046, t, 0.08, 0.18); this.osc('sine', 1318, t + 0.08, 0.08, 0.18); this.osc('sine', 1760, t + 0.16, 0.3, 0.18, null, { decay: 0.3 }); this.noise(t, 0.05, 0.15, null, { type: 'highpass', f: 4000 }); },
  parcel(t) { this.noise(t, 0.22, 0.2, null, { f: 2500, to: 1200, attack: 0.02 }); this.ticks(t, 8, 0.015, 0.03, 3500, 2, 0.1, 0.012); this.noise(t + 0.26, 0.05, 0.3, null, { f: 700, to: 300 }); this.osc('sine', 110, t + 0.26, 0.1, 0.2, null, { to: 70 }); },   // paper tearing, a thump
  loan(t) { for (let k = 0; k < 4; k++) { this.osc('sine', 880 + k * 110, t + k * 0.07, 0.12, 0.1, null, { decay: 0.3 }); this.noise(t + k * 0.07, 0.015, 0.1, null, { type: 'highpass', f: 5000 }); } this.osc('sine', 220, t, 0.3, 0.1, null, { to: 160 }); },
  // --- metal and machines
  pipeLay(t) { this.clank(t, 2600, 0.2); this.osc('sine', 180, t, 0.08, 0.1, null, { to: 120 }); },
  post(t) { this.noise(t, 0.04, 0.3, null, { f: 1100, to: 450 }); this.osc('sine', 160, t, 0.1, 0.2, null, { to: 100 }); this.noise(t + 0.09, 0.04, 0.2, null, { f: 1000, to: 400 }); },
  beltLay(t) { this.noise(t, 0.06, 0.3, null, { f: 700, to: 250 }); this.osc('sine', 130, t, 0.08, 0.12, null, { to: 80 }); },
  pickup(t) { this.clank(t, 3200, 0.14); },
  sprinklerSet(t) { this.clank(t, 2800, 0.16); this.noise(t + 0.08, 0.25, 0.1, null, { type: 'bandpass', f: 2500, q: 0.8, attack: 0.05 }); },
  pumpSet(t) { this.clank(t, 1800, 0.2); this.osc('sine', 150, t, 0.1, 0.15, null, { to: 100 }); },
  switch(t) { for (const d of [0, 0.07]) { this.noise(t + d, 0.02, 0.3, null, { f: 1800, to: 800 }); this.osc('sine', 500 - d * 1400, t + d, 0.03, 0.08, null, { to: 300 }); } },
  fuelPour(t) { this.noise(t, 0.5, 0.18, null, { type: 'bandpass', f: 500, to: 1100, q: 1.2, attack: 0.05 }); for (let k = 0; k < 4; k++) this.osc('sine', 250 + k * 40, t + 0.08 + k * 0.1, 0.07, 0.06, null, { to: 600 }); this.clank(t, 2200, 0.05); },
  snip(t) { this.noise(t, 0.02, 0.25, null, { type: 'bandpass', f: 3800, q: 3 }); this.osc('sine', 900, t, 0.03, 0.06, null, { to: 1400 }); },
  cascade(t) { this.ticks(t, 22, 0.015, 0.035, 1400, 1.5, 0.12, 0.009); this.noise(t, 0.5, 0.05, null, { f: 800, to: 300, attack: 0.05 }); },
  stake(t) { for (const d of [0, 0.22]) { this.noise(t + d, 0.05, 0.35, null, { f: 900, to: 300 }); this.osc('sine', 110, t + d, 0.1, 0.25, null, { to: 60 }); this.clank(t + d, 2000, 0.06); } },
  // --- market
  coin(t) { this.noise(t, 0.02, 0.1, null, { type: 'highpass', f: 5000 }); this.osc('sine', 1318, t, 0.08, 0.14); this.osc('sine', 1975, t + 0.07, 0.22, 0.14, null, { decay: 0.3 }); },
  coins(t) { for (let k = 0; k < 3; k++) this.osc('sine', 1500 + k * 300, t + k * 0.05, 0.08, 0.08, null, { decay: 0.3 }); this.noise(t + 0.15, 0.04, 0.22, null, { f: 1000, to: 500 }); this.osc('sine', 150, t + 0.15, 0.08, 0.12, null, { to: 100 }); },   // coins on wood
  // --- world and time
  cart(t) { this.noise(t, 1.4, 0.12, null, { f: 300, to: 200, attack: 0.3 }); },   // wheels on the track, no bell
  cartLeave(t) { this.noise(t, 1.2, 0.08, null, { f: 300, to: 120, attack: 0.02 }); },
  splat(t) { this.noise(t, 0.08, 0.25, null, { f: 600, to: 200 }); this.osc('sine', 160, t, 0.06, 0.1, null, { to: 80 }); },
  // --- interface: a panel opening or shutting is all the interface says
  close(t) { this.noise(t, 0.03, 0.12, null, { f: 1500, to: 700 }); this.osc('sine', 300, t, 0.05, 0.04, null, { to: 220 }); },
};
// Things that run: a continuous bed the game fades in by how near you stand (LOOPS), or a sound repeated at an
// interval while you are near (PERIODIC). A recording of a loop's name plays looped in place of the synthesis.
const LOOPS = {
  sprinkler(c) { const g = c.createGain(); g.gain.value = 0; const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500; s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(); return { gain: g, base: 0.04 }; },   // a soft steady hiss, no pulsing
  engine(c) { const g = c.createGain(); g.gain.value = 0; const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 48; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 160; const amp = c.createGain(); amp.gain.value = 0.5; const lfo = c.createOscillator(), lg = c.createGain(); lfo.type = 'square'; lfo.frequency.value = 8; lg.gain.value = 0.5; lfo.connect(lg); lg.connect(amp.gain); o.connect(f); f.connect(amp); amp.connect(g); g.connect(this.sfxBus); o.start(); lfo.start(); return { gain: g, base: 0.08 }; },
  generator(c) { const g = c.createGain(); g.gain.value = 0; const a = c.createOscillator(); a.frequency.value = 60; const b = c.createOscillator(); b.frequency.value = 120; const bg = c.createGain(); bg.gain.value = 0.4; const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 350; const ng = c.createGain(); ng.gain.value = 0.3; a.connect(g); b.connect(bg); bg.connect(g); n.connect(f); f.connect(ng); ng.connect(g); g.connect(this.sfxBus); a.start(); b.start(); n.start(); return { gain: g, base: 0.06 }; },
  murmur(c) { const g = c.createGain(); g.gain.value = 0; const n = c.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 450; n.connect(f); f.connect(g); g.connect(this.sfxBus); n.start(); return { gain: g, base: 0.06 }; },
};
const PERIODIC = {
  windmill: { every: () => 1.6 + Math.random() * 0.3, fire(t, lv) { this.noise(t, 0.35, 0.07 * lv, null, { type: 'bandpass', f: 250, to: 650, q: 3, attack: 0.05 }); } },   // a slow wooden creak each turn
  belt: { every: () => 0.22, fire(t, lv) { this.noise(t, 0.02, 0.035 * lv, null, { f: 1200, to: 600 }); } },                                                             // a faint rattle at the belt's pace
  murmur: { every: () => 0.4 + Math.random() * 0.8, fire(t, lv) { this.osc('triangle', 180 + Math.random() * 140, t, 0.1, 0.03 * lv, null, { to: 160 + Math.random() * 120, attack: 0.03 }); } },   // a voice in the crowd now and then
};
export const LOOP_NAMES = ['sprinkler', 'windmill', 'engine', 'generator', 'belt', 'murmur'];
