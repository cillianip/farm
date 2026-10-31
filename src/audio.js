// Sound. Everything is synthesised with the Web Audio API unless a recording is dropped into assets/sfx and named in
// its manifest: then the recording plays instead, pitched a little differently each time like Minecraft's, and a name
// with several files picks one at random. Short effects for the hands-on actions, a looping theme, a rain bed.
// Volumes live in localStorage, not the save.
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
    this.musicOn = false; this.stepT = 0; this.samples = {}; this.v = 1;
  }
  // every synthesised effect is pitched a little differently each play (±8%); recordings get the same nudge in playbackRate
  vary(pct = 0.08) { return 1 + (Math.random() * 2 - 1) * pct; }
  // recordings: the manifest maps a name to files in assets/sfx; whatever decodes is used, the rest stays synthesised
  async loadSamples() {
    let man = null; try { const r = await fetch('assets/sfx/manifest.json'); if (r.ok) man = await r.json(); } catch {}
    if (!man) return;
    for (const [name, files] of Object.entries(man)) {
      if (!Array.isArray(files) || !files.length) continue;
      const bufs = [];
      for (const f of files) { try { const r = await fetch('assets/sfx/' + f); if (!r.ok) continue; bufs.push(await this.ctx.decodeAudioData(await r.arrayBuffer())); } catch {} }
      if (bufs.length) this.samples[name] = bufs;
    }
  }
  playSample(name, gain = 1) {
    const bufs = this.samples[name]; if (!bufs?.length) return false;
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain();
    s.buffer = bufs[Math.floor(Math.random() * bufs.length)]; s.playbackRate.value = this.vary(0.1);
    g.gain.value = gain; s.connect(g); g.connect(this.sfxBus); s.start();
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
  // soft footsteps while walking, paced by the caller
  step(dt, moving, factor = 1) {
    if (!moving || !this.ctx) { this.stepT = 0.2; return; }
    this.stepT -= dt; if (this.stepT > 0) return; this.stepT = 0.32 / Math.max(0.5, factor);
    if (this.playSample('step', 0.5)) return;
    this.v = this.vary(0.12); const t = this.ctx.currentTime; this.noise(t, 0.08, 0.14, null, { f: 700, to: 300 }); this.osc('sine', 90, t, 0.05, 0.1, null, { to: 60 }); this.v = 1;   // a soft crunch with a little weight under it
  }
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

// Each effect is a few oscillators or a filtered noise burst: the sound of the thing, not a recording of it.
const FX = {
  dig(t) { this.noise(t, 0.14, 0.5, null, { f: 500, to: 180 }); this.osc('sine', 110, t, 0.16, 0.35, null, { to: 45 }); },
  water(t) { this.noise(t, 0.12, 0.3, null, { type: 'highpass', f: 2500, to: 800 }); this.osc('sine', 420, t + 0.01, 0.08, 0.1, null, { to: 150 }); for (let k = 0; k < 3; k++) this.noise(t + 0.1 + k * 0.06, 0.02, 0.1, null, { type: 'bandpass', f: 3200 - k * 400, q: 4 }); },   // a short splash: a hiss, a plop, three drops
  fill(t) { this.noise(t, 0.7, 0.25, null, { type: 'bandpass', f: 700, to: 1800, q: 1, attack: 0.05 }); this.osc('sine', 300, t, 0.7, 0.05, null, { to: 700 }); },
  plant(t) { this.osc('sine', 520, t, 0.08, 0.25, null, { to: 260 }); this.noise(t + 0.02, 0.05, 0.12, null, { f: 700 }); },
  harvest(t) { this.noise(t, 0.05, 0.3, null, { f: 1800, to: 400 }); this.osc('sine', 300, t, 0.08, 0.2, null, { to: 150 }); this.osc('triangle', 900, t + 0.05, 0.1, 0.07, null, { to: 1300 }); },   // a snap with a small bright tail
  eat(t) { for (let k = 0; k < 3; k++) this.noise(t + k * 0.11, 0.07, 0.35, null, { f: 1800, to: 500 }); },
  drink(t) {   // two gulps: a watery bandpass swallow with a rising bubble in each, then a small satisfied breath
    for (let k = 0; k < 2; k++) { const g = t + k * 0.22; this.noise(g, 0.14, 0.22, null, { type: 'bandpass', f: 600, to: 1500, q: 2, attack: 0.02 }); this.osc('sine', 380, g + 0.02, 0.12, 0.08, null, { to: 760 }); }
    this.noise(t + 0.5, 0.12, 0.08, null, { type: 'highpass', f: 2500 }); },
  drop(t) { this.osc('sine', 190, t, 0.1, 0.35, null, { to: 120 }); this.noise(t, 0.04, 0.25, null, { f: 1200 }); },
  coin(t) { this.noise(t, 0.02, 0.1, null, { type: 'highpass', f: 5000 }); this.osc('sine', 1318, t, 0.08, 0.14); this.osc('sine', 1975, t + 0.07, 0.22, 0.14, null, { decay: 0.3 }); },
  buy(t) { this.osc('sine', 1046, t, 0.08, 0.18); this.osc('sine', 1318, t + 0.08, 0.08, 0.18); this.osc('sine', 1760, t + 0.16, 0.3, 0.18, null, { decay: 0.3 }); this.noise(t, 0.05, 0.15, null, { type: 'highpass', f: 4000 }); },
  chest(t) { this.noise(t, 0.03, 0.25, null, { f: 1400, to: 600 }); this.noise(t + 0.03, 0.22, 0.09, null, { type: 'bandpass', f: 380, to: 820, q: 2.5, attack: 0.02 }); this.noise(t + 0.24, 0.04, 0.22, null, { f: 1000 }); this.osc('sine', 170, t + 0.24, 0.07, 0.1, null, { to: 110 }); },   // a wooden lid: a click, the hinge creaking up, the lid knocking back
  ui(t) { this.noise(t, 0.03, 0.22, null, { f: 2200, to: 900 }); this.osc('sine', 420, t, 0.05, 0.07, null, { to: 300 }); },   // a wooden click, not a beep
  hover(t) { this.noise(t, 0.02, 0.05, null, { type: 'highpass', f: 5000 }); },   // the faintest tick as the cursor lands on a thing
  move(t) { this.osc('sine', 520, t, 0.05, 0.12, null, { to: 260 }); this.noise(t, 0.03, 0.15, null, { f: 2500, to: 800 }); },   // a pop: an item changing pockets
  close(t) { this.noise(t, 0.03, 0.18, null, { f: 1500, to: 700 }); this.osc('sine', 300, t, 0.05, 0.06, null, { to: 220 }); },   // the same click, lower
  no(t) { this.osc('sine', 150, t, 0.07, 0.1, null, { to: 110 }); this.noise(t, 0.03, 0.08, null, { f: 800 }); },   // "that doesn't go": one soft low knock when a click is refused
  cart(t) { this.noise(t, 1.4, 0.18, null, { f: 300, to: 200, attack: 0.3 }); this.osc('triangle', 1568, t + 0.9, 0.4, 0.12, null, { decay: 0.3 }); },
  sleep(t) { ['C5', 'G4', 'E4'].forEach((n, k) => this.osc('triangle', freq(n), t + k * 0.25, 0.6, 0.12, null, { attack: 0.03, decay: 0.4 })); },
  morning(t) { ['C5', 'E5', 'G5', 'C6'].forEach((n, k) => this.osc('triangle', freq(n), t + k * 0.16, 0.5, 0.12, null, { attack: 0.02, decay: 0.4 })); },
  seeds(t) { let at = t; for (let k = 0; k < 9; k++) { this.noise(at, 0.012, 0.16 + Math.random() * 0.08, null, { type: 'bandpass', f: 2600 + Math.random() * 1200, q: 3 }); at += 0.018 + Math.random() * 0.03; } },   // a dry rattle in a paper packet: short ticks at uneven gaps, no tone
  tired(t) { this.osc('triangle', 220, t, 0.5, 0.08, null, { to: 160 }); },
};
