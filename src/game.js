// Browser glue: input, camera, the render loop and the world drawing. Rules live in sim.js.
import { CONFIG } from './config.js';
import * as S from './sim.js';
import { tileAt, isBlockedAt, BUILDINGS, chunkOrigin, CHUNK, buyableChunks, isTree, buildingAt, MOVABLE, chunkOfTile } from './world.js';
import { saveLocal, loadLocal, clearLocal, serialize, deserialize, applyOffline } from './save.js';
import { UI } from './ui.js';
import { grassTile, soilTile, treeSprite, houseSprite, sprinklerSprite, witheredSprite, playerSprite, PLAYER_H, rackSprite, wellSprite, birdSprite, splatSprite, toolOverlay, crateSprite, trackTile, seedRackSprite, signSprite, heldOverlay, cursorSprite, groundPatch, playerBob, benchSprite, parcelSprite, chestSprite, soilEdge, seedIcon, cartSprite, compostSprite, fertOverlay, spraySprite, pipeSprite, pumpSprite } from './render/sprites.js';
import { drawHud, hotbarRects, itemSprite } from './render/hud.js';
import { itemName } from './items.js';
import { cropSprite, produceSprite } from './render/crops.js';
import { drawText, textWidth } from './render/font.js';
import { formatMoney } from './economy.js';
import { catalogueFlag, markCatalogueSeen } from './catalog.js';
import { Sound } from './audio.js';

const T = CONFIG.tile * CONFIG.scale;   // CSS pixels per tile

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, tx: -1, ty: -1, inside: false };
    this.selected = 0;
    this.floats = [];
    this.landMode = false;
    this.cam = { x: 0, y: 0 };
    this.walkT = 0; this.moving = false;
    this.lastSave = performance.now();
    this.state = this.boot();
    this.sound = new Sound();
    this.ui = new UI(this);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    if (this.offlineReport) this.ui.toast(this.offlineReport);
    this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
  }
  resize() {
    const edge = CONFIG.screenEdge;
    this.vw = window.innerWidth - edge * 2; this.vh = window.innerHeight - edge * 2;
    const dpr = CONFIG.render === 'fast' ? 1 : (window.devicePixelRatio || 1);
    this.canvas.style.width = this.vw + 'px'; this.canvas.style.height = this.vh + 'px';
    this.canvas.width = Math.round(this.vw * dpr); this.canvas.height = Math.round(this.vh * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.ctx.imageSmoothingEnabled = false;
    const g = document.getElementById('game'); g.style.width = this.vw + 'px'; g.style.height = this.vh + 'px'; g.style.marginTop = edge + 'px';
  }
  boot() {
    const saved = loadLocal();
    if (saved && saved.layout === CONFIG.layout) {
      const r = applyOffline(saved);
      if (r.hours > 0.1) this.offlineReport = `Welcome back: ${r.hours.toFixed(1)} game hours passed while you were away.`;
      return S.migrate(saved);
    }
    if (saved) clearLocal();
    return S.createState();
  }
  save() { saveLocal(this.state); this.lastSave = performance.now(); }
  exportSave() { return serialize(this.state); }
  importSave(text) { const s = deserialize(text); applyOffline(s); this.state = s; this.save(); this.ui.refresh(); }
  newGame() { clearLocal(); this.state = S.createState(); this.save(); this.ui.closePanel(); this.ui.refresh(); this.ui.toast('A fresh farm.'); }
  earned(amount) { if (amount > 0) { this.addFloat(`+${formatMoney(amount)}`, this.state.player.x, this.state.player.y - 1.2, '#f6c453'); this.sound.play('coin'); } }
  onPurchase() { this.ui.updateHud(); this.sound.play('buy'); }

  // ---------- input ----------
  // Only movement for now (WASD / arrows). Everything else comes back one step at a time.
  bindInput() {
    const c = this.canvas;
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase(); this.sound.unlock();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); this.keys.add(k); }
      else if (/^[1-9]$/.test(k) && +k <= CONFIG.inventory.hotbar) this.selected = +k - 1;   // number keys pick a hotbar slot
      else if (k === 'e') this.interactKey();
      else if (k === 'escape' && this.ui.openPanel) this.ui.closePanel();
      else if (k === 'escape' && this.landMode) { this.landMode = false; this.ui.toast('The deed waits at the sign. Press E there and click Claim.'); }
      else if (k === 'escape' && !this.sleeping) this.ui.openSettings();   // nothing open: the settings (sound, save)
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    c.addEventListener('mousemove', e => { const r = c.getBoundingClientRect(); this.mouse.x = e.clientX - r.left; this.mouse.y = e.clientY - r.top; this.mouse.inside = true; if (this.drag && Math.hypot(this.mouse.x - this.drag.x0, this.mouse.y - this.drag.y0) > 6) this.drag.moved = true; });
    c.addEventListener('mouseleave', () => { this.mouse.inside = false; this.ui.hideHover(); });
    c.addEventListener('mousedown', e => { e.preventDefault(); this.sound.unlock(); if (e.button === 0) { this.mouseHeld = true; this.mouseDown(); } });
    window.addEventListener('mouseup', e => { if (e.button === 0) { this.mouseHeld = false; this.mouseUp(); } });
    c.addEventListener('wheel', e => { e.preventDefault(); this.selected = (this.selected + (e.deltaY > 0 ? 1 : CONFIG.inventory.hotbar - 1)) % CONFIG.inventory.hotbar; }, { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.save(); this.hiddenAt = Date.now(); return; }
      // the loop stops while the tab is hidden; on return the farm catches up, capped like offline time
      if (!this.hiddenAt || this.sleeping) return;
      const real = Math.min((Date.now() - this.hiddenAt) / 1000, CONFIG.time.offlineMaxHours * 3600 / S.gameMinutesPerRealSecond() / 60); this.hiddenAt = null;
      if (real < 3) return;
      const events = S.advance(this.state, real); this.last = performance.now();
      const hrs = real * S.gameMinutesPerRealSecond() / 60; this.ui.toast(`${hrs < 1 ? Math.round(hrs * 60) + ' game minutes' : hrs.toFixed(1) + ' game hours'} passed while you were away.`);
      for (const e of events) if (e.type === 'sleep') { this.save(); this.ui.openMorning(e.report); }
    });
  }
  // Press on a movable object: a short press uses it, holding lifts it. Everything else acts on press.
  mouseDown() {
    const hb = hotbarRects(this.vw, this.vh), slot = hb.slots.findIndex(r => this.mouse.x >= r.x && this.mouse.x < r.x + r.w && this.mouse.y >= r.y && this.mouse.y < r.y + r.h);
    if (slot >= 0) { this.drag = { from: slot, x0: this.mouse.x, y0: this.mouse.y, moved: false }; return; }
    if (this.state.carrying) return this.placeCarried();
    if (this.hit && MOVABLE.includes(this.hit.kind) && !this.action && !this.ui.openPanel) { this.press = { t: 0, hit: this.hit }; return; }
    this.click();
  }
  mouseUp() {
    if (this.drag) {   // drop on another hotbar slot swaps; a plain click selects
      const d = this.drag; this.drag = null;
      const hb = hotbarRects(this.vw, this.vh), to = hb.slots.findIndex(r => this.mouse.x >= r.x && this.mouse.x < r.x + r.w && this.mouse.y >= r.y && this.mouse.y < r.y + r.h);
      const inv = this.state.inventory.slots;
      if (d.moved && to >= 0 && to !== d.from) { [inv[d.from], inv[to]] = [inv[to], inv[d.from]]; this.selected = to; this.sound.play('move'); }
      else this.selected = d.from;
      return;
    }
    const p = this.press; this.press = null;
    if (p && p.t < CONFIG.player.pickUpSeconds) this.interact(p.hit);
  }
  placeCarried() {
    const s = this.state, { tx, ty } = this.mouse;
    const r = S.placeObject(s, tx, ty); if (!r.ok) this.ui.toast(r.msg === 'Not here' ? 'Put it on open grass within reach' : r.msg);
  }
  // E: open the UI of the station you are standing by (the seed rack for now), or close an open panel.
  interactKey() {
    if (this.ui.openPanel) return this.ui.closePanel();
    if (this.sleeping || this.action || this.state.carrying) return;
    const stations = [['seedrack', { ...S.objectPos(this.state, 'seedrack'), w: 1, h: 1 }, () => this.ui.openSeedRack()], ['crate', BUILDINGS.crate, () => this.state.parcels?.length ? this.interact({ kind: 'crate', near: BUILDINGS.crate }) : this.ui.openCrate()], ['sign', BUILDINGS.sign, () => this.openSign()], ['chest', BUILDINGS.chest, () => this.ui.openChest()]];
    const BP = S.objectPos(this.state, 'bench'); if (BP && this.state.carrying !== 'bench') stations.push(['bench', { ...BP, w: 1, h: 1 }, () => this.ui.openBench()]);
    const CP = S.objectPos(this.state, 'compost'); if (CP && this.state.carrying !== 'compost') stations.push(['compost', { ...CP, w: 1, h: 1 }, () => this.ui.openCompost()]);
    let best = null;
    for (const [key, b, open] of stations) { const p = this.state.player, cx = Math.min(Math.max(p.x, b.x), b.x + b.w), cy = Math.min(Math.max(p.y, b.y), b.y + b.h), d = Math.hypot(p.x - cx, p.y - cy); if (d < 2.2 && (!best || d < best.d)) best = { d, open }; }
    if (best) best.open();
  }
  openSign() { markCatalogueSeen(this.state); this.ui.openCatalogue(); }
  // Left click: hotbar slot → select; rack → take tools; well → fill the can; soil → use the selected tool (animated).
  click() {
    const s = this.state, { tx, ty } = this.mouse;
    if (this.action || this.sleeping || this.ui.openPanel) return;
    if (this.landMode) {   // claim a highlighted plot with a deed
      const c = chunkOfTile(tx, ty), r = S.claimLand(s, c.cx, c.cy);
      this.ui.toast(r.msg); if (r.ok) { this.landMode = s.deeds > 0; this.save(); const o = chunkOrigin(c.cx, c.cy); this.addFloat('Yours', o.x + CHUNK / 2, o.y + CHUNK / 2, '#f6c453'); this.sound.play('dig'); this.sound.play('buy'); }
      return;
    }
    const it = this.hotbarItem();
    if (this.hit && this.interact(this.hit)) return;
    const b = buildingAt(s.world, tx, ty);
    if (b === 'house') return this.ui.toast('The door is on the porch.');
    if (b) return;
    if (!it) return;
    if (!S.inReach(s, tx, ty)) return this.ui.toast('Too far');
    const t = tileAt(s.world, tx, ty);
    if (it.kind === 'tool' && it.tool === 'hoe') {
      if (t?.crop?.dead) return this.startAction('clear', tx, ty, S.hoeSeconds(s));                                   // clear a withered plant
      if (t?.tilled && !t.crop && S.moistureOf(t) > CONFIG.soil.soggyAbove) return this.startAction('drain', tx, ty, S.hoeSeconds(s));   // turn a waterlogged bed
      if (t?.tilled && t.crop && S.moistureOf(t) > CONFIG.soil.soggyAbove) return this.startAction('drain', tx, ty, S.hoeSeconds(s));
      if (t?.crop && t.crop.growth >= 100) return this.ui.toast('Ripe: pick it by hand first');
      if (t?.crop) return this.startAction('clear', tx, ty, S.hoeSeconds(s) * 2);                                       // dig up a living plant (a regrowing bed can be moved)
      if (!t || t.t !== 'grass' || t.track || t.tilled || t.crop || isTree(s.world, tx, ty)) return this.ui.toast(t?.tilled ? (t.crop ? 'A plant grows there' : 'Already tilled') : '');
      return this.startAction('hoe', tx, ty, S.hoeSeconds(s));
    }
    if (it.kind === 'tool' && it.tool === 'can') { if (!t?.tilled) return this.ui.toast('Only tilled soil takes water'); if (s.can.water <= 0) return this.ui.toast('The can is empty. Fill it at the well.'); return this.startAction('water', tx, ty, CONFIG.actions.waterSeconds); }
    if (it.kind === 'seed') { if (!t?.tilled) return this.ui.toast('Till the soil first'); if (t.crop) return this.ui.toast(''); return this.startAction('plant', tx, ty, CONFIG.actions.plantSeconds); }
    const r = S.useItem(s, this.selected, tx, ty); if (r.msg) this.ui.toast(r.msg); if (r.float) this.addFloat(r.float, tx + 0.5, ty, '#ffffff');
    if (r.ok && (it.kind === 'sprinkler' || it.kind === 'pipe' || it.kind === 'pump')) { this.sound.play('move'); this.save(); }
  }
  hotbarItem() { return this.state.inventory.slots[this.selected]; }
  // Everything clickable that is not a soil tile: a rect to highlight (world px, 16 per tile) and a prompt.
  interactables() {
    const s = this.state, B = BUILDINGS, it = this.hotbarItem(), h = S.hourOf(s), out = [];
    const H = B.house, hb = (H.y + H.h + 1) * 16 - 120;
    out.push({ kind: 'house', near: H, rect: [H.x * 16 + 37, hb + 68, 18, 40], label: h >= 18 || h < CONFIG.time.wakeHour ? 'Sleep' : 'Sleep after 6pm' });
    const W = B.well;
    out.push({ kind: 'well', near: W, rect: [W.x * 16 - 4, (W.y + 1) * 16 - 32, 24, 32], label: it?.tool === 'can' ? (s.can.water >= s.can.capacity ? 'The can is full' : 'Draw water') : !it ? 'Drink' : 'Hold the can to draw water' });
    for (const [key, tool, name] of [['rackHoe', 'hoe', 'hoe'], ['rackCan', 'can', 'watering can']]) { if (s.carrying === key) continue; const R = { ...S.objectPos(s, key), w: 1, h: 1 }; out.push({ kind: key, near: R, rect: [R.x * 16 + 2, (R.y + 1) * 16 - 20, 12, 20], label: (it?.kind === 'tool' && it.tool === tool && !s.rack[tool] ? `Hang up the ${name}` : s.rack[tool] ? `Take the ${name}` : 'Empty rack') + '  (hold: pick up)' }); }
    if (s.carrying !== 'seedrack') { const SR = { ...S.objectPos(s, 'seedrack'), w: 1, h: 1 }, ready = S.seedRackReady(s);
      out.push({ kind: 'seedrack', near: SR, rect: [SR.x * 16 + 1, (SR.y + 1) * 16 - 26 + 2, 14, 24], label: (ready ? 'Take the seeds' : it?.kind === 'crop' ? (s.seedRack.trays.some(t => !t.item) ? 'Dry it for seeds' : 'Trays busy') : S.activeTray(s) ? 'Drying' : 'Needs a crop') + '  (E: open, hold: pick up)' }); }
    const Cr = B.crate, full = S.crateCount(s) >= s.crate.capacity, parcels = s.parcels?.length || 0;
    out.push({ kind: 'crate', near: Cr, rect: [Cr.x * 16 - 1, (Cr.y + 1) * 16 - 16, 18, 16], label: parcels ? `Collect ${parcels === 1 ? 'the parcel' : parcels + ' parcels'}` : it?.kind === 'crop' ? (full ? 'Crate is full' : 'Drop in the crate') : S.crateCount(s) ? (s.crate.pickups && S.hourOf(s) < CONFIG.crate.middayHour ? 'Collected at noon' : 'Collected tonight') : 'Needs a crop' });
    const BP = S.objectPos(s, 'bench');
    if (BP && s.carrying !== 'bench') out.push({ kind: 'bench', near: { ...BP, w: 1, h: 1 }, rect: [BP.x * 16, (BP.y + 1) * 16 - 26 + 2, 16, 24], label: (s.breeder.result ? 'Take the seeds' : s.breeder.running ? 'Breeding, results in the morning' : s.breeder.a && s.breeder.b ? 'Ready to breed' : 'Breeding bench') + '  (E: open, hold: pick up)' });
    const CP = S.objectPos(s, 'compost');
    if (CP && s.carrying !== 'compost') out.push({ kind: 'compost', near: { ...CP, w: 1, h: 1 }, rect: [CP.x * 16, (CP.y + 1) * 16 - 20 + 1, 16, 19], label: (s.compost.ready ? (it && it.kind !== 'fert' ? 'Compost ready: empty hands to take it' : 'Take the compost') : s.compost.running ? 'Rotting down, ready by morning' : it && S.COMPOSTABLE.includes(it.kind) ? (S.compostCount(s) >= CONFIG.fertiliser.compostMax ? 'The bin is full' : 'Drop it in') : 'Compost bin') + '  (E: open, hold: pick up)' });
    const Ch = B.chest; out.push({ kind: 'chest', near: Ch, rect: [Ch.x * 16 - 1, (Ch.y + 1) * 16 - 15, 18, 15], label: it && it.kind !== 'tool' ? `Put away  (E: open)` : 'Chest  (E: open)' });
    const Sg = B.sign; out.push({ kind: 'sign', near: null, rect: [Sg.x * 16 - 10, (Sg.y + 1) * 16 - 22, 36, 12], label: s.orders.length ? `Catalogue  (${s.orders.length} ordered)` : this.flag ? 'Catalogue  (new: you can afford something)' : 'Catalogue' });
    return out;
  }
  // What the mouse is over: an object, a ripe crop, or nothing.
  hitTest() {
    if (!this.mouse.inside) return null;
    const mx = (this.mouse.x + this.cam.x) / CONFIG.scale, my = (this.mouse.y + this.cam.y) / CONFIG.scale;
    for (const o of this.interactables()) { const [x, y, w, h] = o.rect; if (mx >= x && mx < x + w && my >= y && my < y + h) return o; }
    const t = tileAt(this.state.world, this.mouse.tx, this.mouse.ty);
    if (t?.crop && !t.crop.dead && t.crop.growth >= 100) return { kind: 'harvest', rect: [this.mouse.tx * 16, this.mouse.ty * 16, 16, 16], label: 'Harvest', near: null };
    const it = this.hotbarItem(), p = this.state.player;   // eat: the cursor on your own body while holding produce, and no ripe crop under it
    if (it?.kind === 'crop' && this.mouseOnPlayer()) return { kind: 'eat', rect: [p.x * 16 - 7, p.y * 16 - PLAYER_H + 3, 14, PLAYER_H], label: `Eat the ${this.state.species[it.species]?.name || 'crop'}`, near: null };
    return null;
  }
  // Click on an interactable. Returns true when handled.
  interact(o) {
    const s = this.state, it = this.hotbarItem(), { tx, ty } = this.mouse;
    if (o.near && !this.near(o.near, 1.8)) { this.ui.toast('Walk closer'); return true; }
    switch (o.kind) {
      case 'house': { if (S.hourOf(s) < 18 && S.hourOf(s) >= CONFIG.time.wakeHour) this.ui.toast('Too early to sleep. Come back after 6pm.'); else this.goToSleep(); return true; }
      case 'rackHoe': case 'rackCan': { const tool = o.kind === 'rackHoe' ? 'hoe' : 'can'; const r = it?.kind === 'tool' && it.tool === tool ? S.returnTool(s, tool, this.selected) : S.takeTool(s, tool); this.ui.toast(r.msg); return true; }
      case 'well': {
        if (!it) { this.startAction('drink', tx, ty, CONFIG.actions.drinkSeconds); return true; }
        if (it.tool !== 'can') { this.ui.toast('Hold the watering can to draw water, or empty hands to drink'); return true; }
        if (s.can.water >= s.can.capacity) { this.ui.toast('The can is already full'); return true; }
        this.startAction('fill', BUILDINGS.well.x, BUILDINGS.well.y, CONFIG.actions.fillSeconds); return true;
      }
      case 'seedrack': {
        if (S.seedRackReady(s)) { const r = S.takeSeeds(s); const P2 = S.objectPos(s, 'seedrack'); if (r.msg) this.ui.toast(r.msg); if (r.float) { this.addFloat(r.float, P2.x + 0.5, P2.y - 0.2, '#f6c453'); this.sound.play('seeds'); } return true; }
        if (!it || it.kind !== 'crop') { this.ui.toast(S.activeTray(s) ? 'Still drying' : 'Hold a crop to dry it for seeds'); return true; }
        if (!s.seedRack.trays.some(t => !t.item)) { this.ui.toast('Every tray is busy'); return true; }
        if (s.species[it.species]?.sterile) { this.ui.toast('Sterile: its seeds are dead'); return true; }
        { const P2 = S.objectPos(s, 'seedrack'); this.startAction('dry', P2.x, P2.y, S.dropSeconds(s)); return true; }
      }
      case 'compost': {
        const CP = S.objectPos(s, 'compost');
        if (s.compost.ready && (!it || it.kind === 'fert')) { const r = S.takeCompost(s); if (r.msg) this.ui.toast(r.msg); if (r.float) { this.addFloat(r.float, CP.x + 0.5, CP.y - 0.2, '#f6c453'); this.sound.play('harvest'); this.save(); } return true; }
        if (it && S.COMPOSTABLE.includes(it.kind)) { const chk = S.canCompost(s); if (!chk.ok) { this.ui.toast(chk.msg); return true; } this.startAction('compost', CP.x, CP.y, S.dropSeconds(s)); return true; }
        this.ui.openCompost(); return true;
      }
      case 'bench': { if (s.breeder.result) { const r = S.takeBreedResult(s); const BP = S.objectPos(s, 'bench'); if (r.msg) this.ui.toast(r.msg); if (r.float) { this.addFloat(r.float, BP.x + 0.5, BP.y - 0.2, '#f6c453'); this.sound.play('seeds'); } this.save(); return true; } this.ui.openBench(); return true; }
      case 'crate': {
        if (s.parcels?.length) { const r = S.collectParcels(s); for (const l of r.lines) this.ui.toast(l); if (r.lines.length) { this.addFloat('Parcels!', BUILDINGS.crate.x + 0.5, BUILDINGS.crate.y - 0.4, '#f6c453'); this.sound.play('buy'); } if (s.deeds > 0) this.landMode = true; if (r.bench) this.ui.toast('Carry the bench to where you want it and click to put it down'); if (r.compost) this.ui.toast('Carry the bin to where you want it and click to put it down'); this.save(); return true; }
        if (!it || it.kind !== 'crop') { this.ui.toast(S.crateCount(s) ? 'The cart collects it tonight.' : 'Hold a crop to drop it in'); return true; }
        if (S.crateCount(s) >= s.crate.capacity) { this.ui.toast('The crate is full. The cart comes tonight.'); return true; }
        this.startAction('drop', BUILDINGS.crate.x, BUILDINGS.crate.y, S.dropSeconds(s)); return true;
      }
      case 'sign': { this.openSign(); return true; }
      case 'chest': { if (it && it.kind !== 'tool') { const r = S.stash(s, this.selected); if (r.msg) this.ui.toast(r.msg); if (r.float) { this.addFloat(r.float, BUILDINGS.chest.x + 0.5, BUILDINGS.chest.y - 0.2, '#f6c453'); this.sound.play('chest'); } } else this.ui.openChest(); return true; }
      case 'eat': { this.startAction('eat', Math.floor(s.player.x), Math.floor(s.player.y), CONFIG.actions.eatSeconds); return true; }
      case 'harvest': { if (!S.inReach(s, tx, ty)) { this.ui.toast('Too far'); return true; } const r = S.useItem(s, it ? -1 : this.selected, tx, ty); if (r.msg) this.ui.toast(r.msg); if (r.float) { this.addFloat(r.float, tx + 0.5, ty, '#ffffff'); this.sound.play('harvest'); } else this.sound.play('no'); return true; }
    }
    return false;
  }
  playerRect() { const p = this.state.player, T2 = T; return { x: Math.round(p.x * T2 - T2 / 2) - this.cam.x, y: Math.round(p.y * T2) - this.cam.y - PLAYER_H * CONFIG.scale + 3 * CONFIG.scale, w: T2, h: PLAYER_H * CONFIG.scale }; }
  mouseOnPlayer() { const r = this.playerRect(); return this.mouse.x >= r.x + 8 && this.mouse.x < r.x + r.w - 8 && this.mouse.y >= r.y && this.mouse.y < r.y + r.h; }
  near(b, d) { const p = this.state.player; const cx = Math.min(Math.max(p.x, b.x), b.x + b.w), cy = Math.min(Math.max(p.y, b.y), b.y + b.h); return Math.hypot(p.x - cx, p.y - cy) < d; }
  startAction(type, x, y, dur) {
    this.facePoint(x + 0.5, y + 0.5); this.action = { type, x, y, t: 0, dur: dur * S.actionFactor(this.state), slot: this.selected };
    this.sound.play({ hoe: 'dig', drain: 'dig', clear: 'dig', fill: 'fill', plant: 'plant', drop: 'drop', dry: 'drop', compost: 'drop' }[type]);
  }
  actionItem() { return this.action ? this.state.inventory.slots[this.action.slot] : null; }
  finishAction() {
    const a = this.action, s = this.state; this.action = null;
    if (a.type === 'fill') { S.fillCan(s); this.addFloat('FULL', s.player.x, s.player.y - 1.6, '#8cc6f0'); return; }
    if (a.type === 'drink') { const r = S.drink(s); this.addFloat(r.float, s.player.x, s.player.y - 1.6, '#8cc6f0'); return; }
    if (a.type === 'eat') { const r = S.eat(s, a.slot); if (r.msg) this.ui.toast(r.msg); if (r.float) this.addFloat(r.float, s.player.x, s.player.y - 1.6, '#f6c453'); return; }
    if (a.type === 'dry') { const r = S.putOnSeedRack(s, a.slot); if (r.msg) this.ui.toast(r.msg); if (r.float) this.addFloat(r.float, a.x + 0.5, a.y - 0.2, '#f6c453'); return; }
    if (a.type === 'drop') { const r = S.putInCrate(s, a.slot, 1); if (r.msg) this.ui.toast(r.msg); if (r.float) this.addFloat(r.float, a.x + 0.5, a.y - 0.2, '#f6c453'); if (r.full) this.ui.toast('The crate is full. The cart comes tonight.'); else if (r.ok && this.mouseHeld) this.dropAgain = 'crate'; return; }
    if (a.type === 'compost') { const r = S.addToCompost(s, a.slot, 1); if (r.msg) this.ui.toast(r.msg); if (r.float) this.addFloat(r.float, a.x + 0.5, a.y - 0.2, '#f6c453'); if (r.full) this.ui.toast(`The bin is full. It rots down while you sleep.`); else if (r.ok && this.mouseHeld) this.dropAgain = 'compost'; return; }
    if (a.type === 'drain') { const r = S.drainSoil(s, a.x, a.y); if (r.msg) this.ui.toast(r.msg); if (r.float) this.addFloat(r.float, a.x + 0.5, a.y, '#8cc6f0'); return; }
    if (a.type === 'clear') { const r = S.useItem(s, a.slot, a.x, a.y); if (r.msg) this.ui.toast(r.msg); if (r.float) this.addFloat(r.float, a.x + 0.5, a.y, r.float === 'Seed back' ? '#f6c453' : '#8a6a44'); return; }
    const r = S.useItem(s, a.slot, a.x, a.y);
    if (r.msg) this.ui.toast(r.msg); if (r.float) this.addFloat(r.float, a.x + 0.5, a.y, '#ffffff');
  }
  // what the hover card shows as the tile's title
  tileInfo(x, y) {
    const w = this.state.world, t = tileAt(w, x, y);
    if (!t) return { title: '' };
    if (t.t === 'house') return { title: 'Farmhouse', sub: 'Your home.' };
    if (t.t === 'rackHoe') return { title: 'Tool rack', sub: this.state.rack.hoe ? 'A hoe. Click to take it.' : 'Empty.' };
    if (t.t === 'rackCan') return { title: 'Tool rack', sub: this.state.rack.can ? 'A watering can. Click to take it.' : 'Empty.' };
    if (t.t === 'well') return { title: 'Well', sub: 'Click with the can to draw water. Empty hands to drink.' };
    if (t.t === 'bench') return { title: 'Breeding bench', sub: this.state.breeder.running ? 'A seedling grows under the glass.' : 'Press E. Two parents, one child by morning.' };
    if (t.t === 'compost') return { title: 'Compost bin', sub: this.state.compost.ready ? 'Ready. Take the compost with empty hands.' : this.state.compost.running ? 'Rotting down. Ready by morning.' : 'Drop in spare crops or the plants the hoe pulls up. It rots down while you sleep.' };
    if (t.t === 'chest') return { title: 'Chest', sub: 'Your pockets empty into here. Click with something in hand to put it away, E to open.' };
    if (t.t === 'sign') return { title: 'Delivery sign', sub: 'Crops left in the crate are collected at night.' };
    if (t.t === 'seedrack') return { title: 'Seed rack', sub: S.activeTray(this.state) ? `${this.state.seedRack.trays.length} ${this.state.seedRack.trays.length === 1 ? 'tray' : 'trays'}` : 'Lay a crop on a tray. It dries into seeds.' };
    if (t.t === 'crate') return { title: 'Delivery crate', sub: 'Drop crops in. The cart collects them at night and pays in the morning.' };
    if (t.obj?.kind === 'sprinkler') return { title: 'Sprinkler I', sub: S.sprinklerFed(this.state, x, y) ? 'Running: tops up the beds around it while you are awake. The hoe picks it up.' : S.pipeFed(this.state, x, y) ? 'No pressure: the line already runs all it can. A pump on the line adds more.' : 'Dry. It needs pipe under it with a line back to the well.' };
    if (t.obj?.kind === 'pump') { const tier = S.pumpTier(t.obj), P = S.pressure(this.state); return { title: tier.name, sub: !S.pipeFed(this.state, x, y) ? 'Dry: this pipe has no line back to the well.' : !S.pumpRunning(this.state, t) ? 'Still: the air is calm today. It turns when the wind picks up.' : `Running: ${tier.feeds} more sprinklers. The line runs ${Math.min(P.fed, P.cap)} of ${P.fed}.${tier.fuelPerDay ? ` Burns ${formatMoney(tier.fuelPerDay)} of fuel a day.` : ''}` }; }
    if (t.pipe) return { title: 'Pipe', sub: S.pipeFed(this.state, x, y) ? 'Fed from the well.' : 'Dry: no unbroken line back to the well.' };
    if (t.track) return { title: 'Cart track', sub: 'The road the delivery cart comes up at night. It leads out of the clearing.' };
    if (isTree(w, x, y)) return { title: 'Forest', sub: 'Not your land yet.' };
    if (t.tilled) return { title: 'Tilled soil', sub: S.moistureOf(t) > CONFIG.soil.soggyAbove ? 'Waterlogged. Turn it with the hoe to drain.' : t.crop?.dead ? 'Clear it with the hoe.' : t.crop ? '' : 'Ready for a seed.' };
    return { title: 'Grass', sub: 'Hoe it to make a bed.' };
  }
  facePoint(x, y) {
    const p = this.state.player, dx = x - p.x, dy = y - p.y;
    p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }
  afterMorning() { if (this.state.deeds > 0) this.landMode = true; }
  goToSleep() {
    if (this.sleeping) return;
    this.sleeping = true; this.ui.hideHover(); this.sound.play('sleep');
    const fade = document.getElementById('fade'); fade.classList.add('on');
    setTimeout(() => {   // dark, a few breaths of zzz, then the morning comes up slowly behind the report
      const report = S.sleep(this.state);
      this.save();
      fade.classList.remove('on');
      this.sleeping = false;
      setTimeout(() => this.ui.openMorning(report), 500);
    }, 2400);
  }

  // ---------- loop ----------
  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    try { this.update(dt, now); this.render(now); }
    catch (e) { console.error(e); if (!this.crashed) { this.crashed = true; this.action = null; this.ui.toast('Something went wrong. It has been logged.'); } }
    requestAnimationFrame(t => this.frame(t));
  }
  update(dt, now) {
    const s = this.state;
    this.flagT = (this.flagT || 0) - dt; if (this.flagT <= 0) { this.flagT = 1; const flag = catalogueFlag(s); if (flag && !this.flag) this.flash = 1; this.flag = flag; }   // the catalogue is costly to build: once a second
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt / 1.6);
    if (!this.sleeping) {
      const events = S.advance(s, dt);
      for (const e of events) if (e.type === 'sleep') { this.save(); this.ui.openMorning(e.report); }
    }
    this.moving = false;
    if (this.press) { this.press.t += dt; if (this.press.t >= CONFIG.player.pickUpSeconds) { const r = S.pickUp(s, this.press.hit.kind); if (r.msg) this.ui.toast(r.msg); this.press = null; } }
    if (this.ui.openPanel?.tick) { this.panelT = (this.panelT || 0) + dt; if (this.panelT > 0.5) { this.panelT = 0; this.ui.openPanel.tick(); } }
    if (this.action) { this.action.t += dt; if (this.action.t >= this.action.dur) this.finishAction(); }
    else if (!this.ui.openPanel && !this.sleeping) this.movePlayer(dt);
    if (this.dropAgain && !this.action) {   // holding the button: the rest follow at the same pace
      const kind = this.dropAgain, h = this.hitTest(), it = this.hotbarItem(); this.dropAgain = false;
      if (this.mouseHeld && h?.kind === kind) {
        if (kind === 'crate' && it?.kind === 'crop' && S.crateCount(s) < s.crate.capacity) this.startAction('drop', BUILDINGS.crate.x, BUILDINGS.crate.y, S.dropSeconds(s));
        else if (kind === 'compost' && it && S.COMPOSTABLE.includes(it.kind) && S.canCompost(s).ok) { const CP = S.objectPos(s, 'compost'); this.startAction('compost', CP.x, CP.y, S.dropSeconds(s)); }
      }
    }
    // a label above the head for a moment when what you hold changes
    { const it = this.hotbarItem(), key = it ? `${this.selected}:${it.kind}:${it.species || it.tool || ''}` : ''; if (key !== this.heldKey) { this.heldKey = key; this.heldLabel = it ? { text: itemName(it, s.species) + (it.qty > 1 && it.kind !== 'tool' ? ` ×${it.qty}` : ''), t: 0 } : null; } if (this.heldLabel) { this.heldLabel.t += dt; if (this.heldLabel.t > 1.6) this.heldLabel = null; } }
    { const tired = S.isTired(s), heavy = S.isHeavy(s);   // one word when your state changes, not a nag
      if (tired && !this.wasTired) { this.ui.toast('Worn out. You drag your feet and everything takes longer. Eat, drink, or sleep.'); this.sound.play('tired'); }
      if (heavy && !this.wasHeavy) this.ui.toast('Your pockets are heavy. Put things in the chest by the porch.');
      this.wasTired = tired; this.wasHeavy = heavy; }
    // the money counter rolls towards the real figure instead of jumping
    if (this.shownMoney == null) this.shownMoney = s.money; else { const d = s.money - this.shownMoney; this.shownMoney = Math.abs(d) < 0.01 ? s.money : this.shownMoney + d * Math.min(1, dt * 5); }
    // bird: fly in from the side, drop the seed over the tile, fly out
    if (s.bird.pending && !this.bird) { this.bird = { x: s.bird.pending.x, y: s.bird.pending.y, t: 0, dropped: false }; this.sound.play('bird'); }
    if (this.bird) {
      this.bird.t += dt;
      const f = this.bird.t / CONFIG.bird.flightSeconds;
      if (!this.bird.dropped && f >= 0.5) { this.bird.dropped = true; const r = S.birdDrop(s); if (r) this.splat = { x: r.x, y: r.y, t: 0 }; }
      if (f >= 1) this.bird = null;
    }
    if (this.splat) { this.splat.t += dt; if (this.splat.t > 2.5) this.splat = null; }
    // the midday cart: rolls up the track, takes the crate, rolls away
    if (s.crate.pendingPickup && !this.cart) { this.cart = { t: 0, sale: s.crate.pendingPickup, paid: false }; s.crate.pendingPickup = null; }
    if (this.cart) { this.cart.t += dt; if (this.cart.t < dt * 1.5) this.sound.play('cart'); if (!this.cart.paid && this.cart.t > 2.0) { this.cart.paid = true; this.sound.play('coin'); this.addFloat(`+${formatMoney(this.cart.sale.total)}`, BUILDINGS.crate.x + 0.5, BUILDINGS.crate.y - 0.6, '#f6c453'); this.ui.toast(`The cart took ${this.cart.sale.count} ${this.cart.sale.count === 1 ? 'crop' : 'crops'} for ${formatMoney(this.cart.sale.total)}.`); } if (this.cart.t > 5) this.cart = null; }
    this.cam.x = Math.max(0, Math.min(s.world.w * T - this.vw, s.player.x * T - this.vw / 2));
    this.cam.y = Math.max(0, Math.min(s.world.h * T - this.vh, s.player.y * T - this.vh / 2));
    this.mouse.tx = Math.floor((this.mouse.x + this.cam.x) / T); this.mouse.ty = Math.floor((this.mouse.y + this.cam.y) / T);
    this.hit = this.action || this.sleeping || this.ui.openPanel || s.carrying || this.hotbarHover >= 0 ? null : this.hitTest();
    { const hk = this.hit ? this.hit.kind + ':' + this.hit.label : ''; if (hk && hk !== this.lastHitKey) this.sound.play('hover'); this.lastHitKey = hk; }   // a tick as the cursor finds each thing
    const hbSlot = this.mouse.inside ? hotbarRects(this.vw, this.vh).slots.findIndex(r => this.mouse.x >= r.x && this.mouse.x < r.x + r.w && this.mouse.y >= r.y && this.mouse.y < r.y + r.h) : -1;
    if (hbSlot !== this.hotbarHover && hbSlot >= 0 && s.inventory.slots[hbSlot]) this.sound.play('hover');
    this.hotbarHover = hbSlot;
    if (this.mouse.inside && !this.ui.openPanel && hbSlot >= 0 && s.inventory.slots[hbSlot] && !this.drag?.moved) this.ui.hoverItem(s.inventory.slots[hbSlot], this.mouse.x, this.mouse.y);
    else if (this.mouse.inside && !this.ui.openPanel && hbSlot < 0) this.ui.hover(tileAt(s.world, this.mouse.tx, this.mouse.ty), this.mouse.tx, this.mouse.ty, this.mouse.x, this.mouse.y); else if (!this.ui.panelHover) this.ui.hideHover();
    for (const f of this.floats) f.t += dt; this.floats = this.floats.filter(f => f.t < 2.2);
    this.sound.step(dt, this.moving && !this.action, S.walkFactor(s)); this.sound.rain(!!s.rainToday && !this.sleeping);
    if (now - this.lastSave > 30000) this.save();
  }
  movePlayer(dt) {
    const p = this.state.player, k = this.keys;
    let dx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let dy = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (!dx && !dy) { this.walkT = 0; return; }
    const len = Math.hypot(dx, dy); dx /= len; dy /= len;
    p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    const wf = S.walkFactor(this.state), sp = CONFIG.player.speed * dt * (this.state.carrying ? CONFIG.player.carrySpeed : 1) * wf;
    const w = this.state.world, rad = 0.3;
    const free = (x, y) => !isBlockedAt(w, x - rad, y - rad) && !isBlockedAt(w, x + rad, y - rad) && !isBlockedAt(w, x - rad, y + rad) && !isBlockedAt(w, x + rad, y + rad);
    if (free(p.x + dx * sp, p.y)) p.x += dx * sp;
    if (free(p.x, p.y + dy * sp)) p.y += dy * sp;
    this.walkT += dt * Math.max(0.5, wf); this.moving = true;
  }
  addFloat(text, x, y, color) { this.floats.push({ text, x, y, color, t: 0 }); }
  // the "come and get it" arrow: ripe crops, dried seeds
  drawArrow(ax, ay0, now) {
    const ctx = this.ctx, u = CONFIG.scale, ay = ay0 + Math.round(Math.sin(now / 220) * 3);
    ctx.fillStyle = '#3b2314'; ctx.fillRect(ax - 2 * u, ay - 3 * u, 4 * u, 4 * u); ctx.fillRect(ax - 4 * u, ay, 8 * u, 2 * u); ctx.fillRect(ax - 3 * u, ay + 2 * u, 6 * u, u); ctx.fillRect(ax - 2 * u, ay + 3 * u, 4 * u, u); ctx.fillRect(ax - u, ay + 4 * u, 2 * u, u);
    ctx.fillStyle = '#fff1b8'; ctx.fillRect(ax - u, ay - 2 * u, 2 * u, 3 * u); ctx.fillRect(ax - 3 * u, ay + u, 6 * u, u); ctx.fillRect(ax - 2 * u, ay + 2 * u, 4 * u, u); ctx.fillRect(ax - u, ay + 3 * u, 2 * u, u);
    ctx.fillStyle = '#f6c453'; ctx.fillRect(ax - u, ay - 2 * u, u, 3 * u);
  }

  // ---------- render ----------
  render(now) {
    const ctx = this.ctx, s = this.state, w = s.world;
    const cx = Math.round(this.cam.x), cy = Math.round(this.cam.y);
    ctx.fillStyle = '#2b4a26'; ctx.fillRect(0, 0, this.vw, this.vh);
    const x0 = Math.max(0, Math.floor(cx / T) - 1), y0 = Math.max(0, Math.floor(cy / T) - 2);
    const x1 = Math.min(w.w - 1, Math.ceil((cx + this.vw) / T) + 1), y1 = Math.min(w.h - 1, Math.ceil((cy + this.vh) / T) + 1);
    const drawables = [];   // {y, draw} sorted by base y so taller things overlap correctly
    const sprays = [];      // sprinklers spraying right now: drawn over their 3×3 after the ground pass
    const fed = S.fedPipes(s), wellB = BUILDINGS.well, pipeOrWell = (x, y) => { const t = tileAt(w, x, y); return !!t?.pipe || (x === wellB.x && y === wellB.y); };
    // ground + flat things
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = w.tiles[y * w.w + x], sx = x * T - cx, sy = y * T - cy;
      let v = (x * 7 + y * 13 + ((x * x + y) % 5)) % 6;
      if ((x * 31 + y * 17) % 23 === 0) v = 6; else if ((x * 13 + y * 29) % 37 === 0) v = 7;   // the odd flower
      const tree = isTree(w, x, y);
      if (tree) v = (x * 7 + y * 13) % 3;   // no flowers under the forest
      if (t.track) ctx.drawImage(trackTile(x % 3), sx, sy, T, T);
      else if (t.t === 'grass' && t.tilled) ctx.drawImage(soilTile(['dry', 'moist', 'wet', 'soggy'].indexOf(S.moistureState(t)), v & 3), sx, sy, T, T);
      else {
        ctx.drawImage(grassTile(v), sx, sy, T, T);
        if (t.t === 'grass' && !tree) {   // dirt spills over from a tilled neighbour: nobody tills a clean straight edge
          const ev = (x * 5 + y * 3) % 4;
          for (const [side, nx, ny] of [[0, x, y - 1], [1, x + 1, y], [2, x, y + 1], [3, x - 1, y]]) { const n = w.tiles[ny * w.w + nx]; if (n && n.t === 'grass' && n.tilled) ctx.drawImage(soilEdge(side, ev, ['dry', 'moist', 'wet', 'soggy'].indexOf(S.moistureState(n))), sx, sy, T, T); }
        }
      }
      if (tree) { ctx.fillStyle = 'rgba(20,40,20,0.35)'; ctx.fillRect(sx, sy, T, T); }
      if (t.fert && t.tilled) ctx.drawImage(fertOverlay(), sx, sy, T, T);
      if (t.pipe) ctx.drawImage(pipeSprite((pipeOrWell(x, y - 1) ? 1 : 0) | (pipeOrWell(x + 1, y) ? 2 : 0) | (pipeOrWell(x, y + 1) ? 4 : 0) | (pipeOrWell(x - 1, y) ? 8 : 0), fed.has(y * w.w + x)), sx, sy, T, T);
      if (tree) drawables.push({ y: y + 1 + t.jy / 16, draw: () => ctx.drawImage(treeSprite(t.v), sx - 2 * CONFIG.scale + t.jx * CONFIG.scale, sy - T + t.jy * CONFIG.scale, 20 * CONFIG.scale, 32 * CONFIG.scale) });
      if (t.obj?.kind === 'sprinkler') { const on = (t.obj.sprayUntil || 0) > s.minutes; ctx.drawImage(sprinklerSprite(on ? 1 + Math.floor(now / 160) % 2 : 0), sx, sy, T, T); if (on) sprays.push([sx, sy]); }
      if (t.obj?.kind === 'pump') { const lv = t.obj.level || 0, run = fed.has(y * w.w + x) && S.pumpRunning(s, t), H = lv === 1 ? 32 : lv === 2 ? 20 : 16; drawables.push({ y: y + 1, draw: () => ctx.drawImage(pumpSprite(lv, run ? 1 + Math.floor(now / (lv === 1 ? 240 : 180)) % 2 : 0), sx, sy + T - H * CONFIG.scale, T, H * CONFIG.scale) }); }
      if (t.crop) {
        const sp = s.species[t.crop.speciesId]; if (!sp) continue;
        const stage = S.cropStage(t.crop);
        ctx.drawImage(stage === 'dead' ? witheredSprite() : cropSprite(sp, stage, t.crop.v || 0), sx, sy, T, T);
        if (stage === 3 && !this.ui.openPanel) this.drawArrow(sx + T / 2, sy - 14, now);   // bobbing outlined arrow: ready to harvest
        if (stage !== 'dead' && stage !== 3 && S.moistureGrowthFactor(S.feltMoisture(t, sp.genome)) === 0 && t.crop.health < 70) { ctx.fillStyle = '#e86a6a'; ctx.fillRect(sx + T - 8, sy + 2, 6, 6); }
      }
    }
    for (const [sx, sy] of sprays) ctx.drawImage(spraySprite(Math.floor(now / 160) % 2), sx - T, sy - T, 3 * T, 3 * T);
    // worn ground under the stations
    { const u = CONFIG.scale;   // a small patch under each leg, where it actually meets the ground
      { const o = S.objectPos(s, 'compost'); if (o && s.carrying !== 'compost') ctx.drawImage(groundPatch(16, 6, 6), o.x * T - cx, (o.y + 1) * T - cy - 3 * u, 16 * u, 6 * u); }   // the bin sits flat on the ground
      for (const key of ['rackHoe', 'rackCan', 'seedrack', 'bench']) { const o = S.objectPos(s, key); if (!o || s.carrying === key) continue; const legs = key === 'seedrack' || key === 'bench' ? [2, 12] : [3, 11]; for (const lx of legs) ctx.drawImage(groundPatch(8, 6, lx), o.x * T - cx + (lx - 3) * u, (o.y + 1) * T - cy - 3 * u, 8 * u, 6 * u); }
      { const o = BUILDINGS.well; ctx.drawImage(groundPatch(26, 8, 3), o.x * T - cx - 5 * u, (o.y + 1) * T - cy - 5 * u, 26 * u, 8 * u); }
      { const o = BUILDINGS.sign; ctx.drawImage(groundPatch(10, 6, 4), o.x * T - cx + 3 * u, (o.y + 1) * T - cy - 2 * u, 10 * u, 6 * u); }
      { const o = BUILDINGS.chest; ctx.drawImage(groundPatch(20, 6, 5), o.x * T - cx - 2 * u, (o.y + 1) * T - cy - 3 * u, 20 * u, 6 * u); } }
    // house (shadow on the grass, then the building sorted with everything else)
    const H = BUILDINGS.house;
    drawables.push({ y: H.y + H.h + 0.05, draw: () => ctx.drawImage(houseSprite(), H.x * T - cx, (H.y + H.h + 1) * T - cy - 120 * CONFIG.scale, 96 * CONFIG.scale, 120 * CONFIG.scale) });
    for (const [key, tool] of [['rackHoe', 'hoe'], ['rackCan', 'can']]) { if (s.carrying === key) continue; const R = S.objectPos(s, key); drawables.push({ y: R.y + 1, draw: () => ctx.drawImage(rackSprite(tool, s.rack[tool]), R.x * T - cx, (R.y + 1) * T - cy - 24 * CONFIG.scale, T, 24 * CONFIG.scale) }); }
    const Wl = BUILDINGS.well, Sg = BUILDINGS.sign;
    drawables.push({ y: Sg.y + 1, draw: () => ctx.drawImage(signSprite(this.flag), Sg.x * T - cx - 10 * CONFIG.scale, (Sg.y + 1) * T - cy - 24 * CONFIG.scale + 2 * CONFIG.scale, 36 * CONFIG.scale, 24 * CONFIG.scale) });
    drawables.push({ y: Wl.y + 1, draw: () => ctx.drawImage(wellSprite(this.action?.type === 'fill' || this.action?.type === 'drink' ? Math.floor(now / 200) % 2 : 0), Wl.x * T - cx - 4 * CONFIG.scale, (Wl.y + 1) * T - cy - 32 * CONFIG.scale, 24 * CONFIG.scale, 32 * CONFIG.scale) });
    const SR = S.objectPos(s, 'seedrack'), shownTray = S.activeTray(s), rackState = S.seedRackReady(s) ? 2 : shownTray ? 1 : 0;
    if (s.carrying !== 'seedrack') drawables.push({ y: SR.y + 1, draw: () => {
      const u = CONFIG.scale, rx = SR.x * T - cx, ry = (SR.y + 1) * T - cy - 28 * u;
      ctx.drawImage(seedRackSprite(0), rx, ry, T, 28 * u);
      // what lies on the tray: each tray's crop, squashed flat as if laid out to dry; a finished tray shows its seeds in their own colour
      const trays = s.seedRack.trays.filter(t => t.item), n = trays.length, wpx = n <= 1 ? 7 : n === 2 ? 5 : 3;
      trays.forEach((tr, k) => {
        const sp = s.species[tr.item.species]; if (!sp) return;
        const x0 = rx + Math.round((2 + k * (12 / n) + (12 / n - wpx) / 2) * u);
        if (S.trayReady(s, tr)) ctx.drawImage(seedIcon(Math.round(sp.genome.hue1), sp.genome.sat1, sp.genome.light1), x0 - u, ry + 7 * u, (wpx + 2) * u, 5 * u);
        else ctx.drawImage(produceSprite(sp), x0, ry + 8 * u, wpx * u, 4 * u);
      });
    } });
    { const BP = S.objectPos(s, 'bench'); if (BP && s.carrying !== 'bench') { const st = s.breeder.running ? 2 : s.breeder.a || s.breeder.b ? 1 : 0; drawables.push({ y: BP.y + 1, draw: () => { ctx.drawImage(benchSprite(st, Math.floor(now / 350) % 2), BP.x * T - cx, (BP.y + 1) * T - cy - 28 * CONFIG.scale, T, 28 * CONFIG.scale); if (s.breeder.result) { const sp = s.species[s.breeder.result.species], u = CONFIG.scale; if (sp) ctx.drawImage(seedIcon(Math.round(sp.genome.hue1), sp.genome.sat1, sp.genome.light1), BP.x * T - cx + 3 * u, (BP.y + 1) * T - cy - 24 * u, 10 * u, 8 * u); } } }); } }
    { const CP = S.objectPos(s, 'compost'); if (CP && s.carrying !== 'compost') { const lv = S.compostLevel(s); drawables.push({ y: CP.y + 1, draw: () => ctx.drawImage(compostSprite(lv), CP.x * T - cx, (CP.y + 1) * T - cy - 20 * CONFIG.scale, T, 20 * CONFIG.scale) }); } }
    { const Ch = BUILDINGS.chest, u = CONFIG.scale; drawables.push({ y: Ch.y + 1, draw: () => ctx.drawImage(chestSprite(this.ui.openPanel?.key === 'chest'), Ch.x * T - cx - u, (Ch.y + 1) * T - cy - 15 * u, 18 * u, 16 * u) }); }
    const Cr = BUILDINGS.crate, crateLevel = S.crateCount(s) >= s.crate.capacity ? 2 : S.crateCount(s) > 0 ? 1 : 0;
    drawables.push({ y: Cr.y + 1, draw: () => {
      const u = CONFIG.scale, ox = Cr.x * T - cx - 2 * u, oy = (Cr.y + 1) * T - cy - 18 * u + 2 * u;
      const cs = crateSprite(0);
      ctx.drawImage(cs, ox, oy, 20 * u, 18 * u);
      // what is inside sits in the hole: clipped to the opening, then the front boards are drawn back over it
      ctx.save(); ctx.beginPath(); ctx.rect(ox + 3 * u, oy - 6 * u, 14 * u, 11 * u); ctx.clip();
      const kinds = s.crate.items.slice(0, 6);
      kinds.forEach((it, i) => { const sp = s.species[it.species]; if (!sp) return; const col = i % 3, row = Math.floor(i / 3); ctx.drawImage(produceSprite(sp), ox + (3 + col * 4) * u, oy + (crateLevel === 2 ? 0 : 2) * u - row * 2 * u, 6 * u, 6 * u); });
      if (s.parcels?.length) ctx.drawImage(parcelSprite(), ox + 4 * u, oy - 2 * u + Math.round(Math.sin(now / 300)) * u, 12 * u, 10 * u);
      ctx.restore();
      ctx.drawImage(cs, 0, 5, 20, 13, ox, oy + 5 * u, 20 * u, 13 * u);
    } });
    if (this.cart) {   // in from the trees on the right, stop beside the crate, back out again
      const c = this.cart, f = c.t, Cr = BUILDINGS.crate, far = Cr.x + 7.5, near = Cr.x + 1.4;
      const ease = v => v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2;
      const wx = f < 1.6 ? far - (far - near) * ease(f / 1.6) : f < 3.2 ? near : near + (far - near) * ease((f - 3.2) / 1.8);
      const rolling = f < 1.6 || f > 3.2, u = CONFIG.scale;
      drawables.push({ y: Cr.y + 1.01, draw: () => { ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(Math.round(wx * T) - cx - 10 * u, (Cr.y + 1) * T - cy + 2 * u, 22 * u, 3 * u); ctx.drawImage(cartSprite(rolling ? Math.floor(now / 90) % 2 : 0), Math.round(wx * T) - cx - 14 * u, (Cr.y + 1) * T - cy - 16 * u + (rolling ? (Math.floor(now / 180) % 2) * u : 0), 28 * u, 20 * u); } });
    }
    if (this.splat) { ctx.globalAlpha = Math.min(1, 2.5 - this.splat.t); ctx.drawImage(splatSprite(), this.splat.x * T - cx + T / 4, this.splat.y * T - cy + T / 4, T / 2, T / 2); ctx.globalAlpha = 1; }
    // player
    const p = s.player;
    const frame = this.moving ? Math.floor(this.walkT * 7) % 4 : 0;
    const px = Math.round(p.x * T - T / 2) - cx, py = Math.round(p.y * T) - cy - PLAYER_H * CONFIG.scale + 3 * CONFIG.scale;
    drawables.push({ y: p.y, draw: () => {
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(Math.round(p.x * T) - cx - 10, Math.round(p.y * T) - cy + 6, 20, 5);
      const heldNow = this.action ? this.actionItem() : this.hotbarItem(), act = this.action?.type;
      const pose = s.carrying ? 'carry' : act === 'drink' || act === 'eat' ? 'drink' : act === 'plant' ? 'plant' : (!this.action && heldNow && heldNow.kind !== 'tool' ? 'hold' : 'idle');
      const spr = playerSprite(p.dir, frame, pose), u0 = CONFIG.scale;
      if (S.isTired(s) && !s.carrying) {   // worn out: the head sinks a pixel into the shoulders, and a drop of sweat
        ctx.drawImage(spr, 0, 10, 16, PLAYER_H - 10, px, py + 10 * u0, T, (PLAYER_H - 10) * u0);
        ctx.drawImage(spr, 0, 0, 16, 10, px, py + u0, T, 10 * u0);
        if (Math.floor(now / 1200) % 2 === 0) { const sxx = p.dir === 'left' ? px + 3 * u0 : px + 12 * u0, syy = py + 6 * u0 + (Math.floor(now / 300) % 2) * u0; ctx.fillStyle = '#8cc6f0'; ctx.fillRect(sxx, syy, u0, 2 * u0); ctx.fillStyle = '#dff3ff'; ctx.fillRect(sxx, syy, u0, u0); }
      } else ctx.drawImage(spr, px, py, T, PLAYER_H * CONFIG.scale);
      const bobPx = playerBob(frame) * CONFIG.scale;   // overlays ride the walk bob
      if (s.carrying) {   // the object rides above the raised hands
        const bob = bobPx, key = s.carrying;
        const img = key === 'bench' ? benchSprite(0) : key === 'compost' ? compostSprite(0) : key === 'seedrack' ? seedRackSprite(S.seedRackReady(s) ? 2 : 0) : rackSprite(key === 'rackHoe' ? 'hoe' : 'can', s.rack[key === 'rackHoe' ? 'hoe' : 'can']);
        const h = img.height * CONFIG.scale;
        ctx.drawImage(img, px, py - h + 4 * CONFIG.scale + bob, T, h);
      }
      const held = heldNow;
      if (!this.action && !s.carrying && held?.kind === 'tool') ctx.drawImage(heldOverlay(held.tool, p.dir), px, py + bobPx, T, PLAYER_H * CONFIG.scale);
      else if (!this.action && !s.carrying && held && held.kind !== 'tool' && p.dir !== 'up') {   // in the extended hand
        const img = itemSprite(held, s.species);
        if (img) { const u = CONFIG.scale; if (p.dir === 'down') { ctx.drawImage(img, px + 4 * u, py + 12 * u + bobPx, 8 * u, 8 * u); ctx.fillStyle = '#f1c7a1'; ctx.fillRect(px + 4 * u, py + 17 * u + bobPx, 2 * u, 2 * u); ctx.fillRect(px + 10 * u, py + 17 * u + bobPx, 2 * u, 2 * u); ctx.fillStyle = '#d9a784'; ctx.fillRect(px + 4 * u, py + 18 * u + bobPx, 2 * u, u); ctx.fillRect(px + 10 * u, py + 18 * u + bobPx, 2 * u, u); } else { const hx = p.dir === 'left' ? px - 4 * u : px + 12 * u; ctx.drawImage(img, hx, py + 9 * u + bobPx, 8 * u, 8 * u); } }
      }
      if (act === 'drink' || act === 'eat') {   // sips: little drops / crumbs at the mouth
        const k = Math.floor(now / 140) % 3, u = CONFIG.scale, mx = px + 7 * u, my = py + 9 * u + bobPx;
        ctx.fillStyle = act === 'drink' ? '#8cc6f0' : '#f6c453'; ctx.fillRect(mx + (k - 1) * u, my - k * u, u, u); ctx.fillRect(mx + 2 * u - k * u, my - u + (k % 2) * u, u, u);
        if (act === 'eat') {   // the fruit shrinks bite by bite; the head dips on each bite
          const img = itemSprite(heldNow, s.species), f = this.action.t / this.action.dur, bites = Math.min(3, Math.floor(f * 4)), keep = 1 - bites * 0.28;
          if (img && keep > 0.1) { const sw = Math.max(2, Math.round(img.width * keep)), sx0 = Math.round((img.width - sw) / 2); ctx.drawImage(img, sx0, 0, sw, img.height, px + 8 * u - Math.round(3.5 * u * keep), py + 7 * u + bobPx + (Math.floor(f * 8) % 2) * u, Math.round(7 * u * keep), 7 * u); }
          ctx.fillStyle = '#f1c7a1'; ctx.fillRect(px + 5 * u, py + 11 * u + bobPx, 2 * u, u); ctx.fillRect(px + 10 * u, py + 11 * u + bobPx, 2 * u, u);   // hands under it
          if (bites > 0) { ctx.fillStyle = '#e9d6a8'; ctx.fillRect(px + 7 * u + (bites % 2) * 2 * u, py + 13 * u + bobPx + Math.round(f * 6) * u, u, u); }
        }
      }
      if (act === 'plant') {   // a seed drops from the hand to the bed
        const a = this.action, f = a.t / a.dur, u = CONFIG.scale, hx = px + (p.dir === 'left' ? 2 : 13) * u, hy = py + 17 * u, tx = a.x * T - cx + T / 2, ty = a.y * T - cy + T / 2;
        ctx.fillStyle = '#5e4a2a'; ctx.fillRect(Math.round(hx + (tx - hx) * f), Math.round(hy + (ty - hy) * f - Math.sin(f * Math.PI) * 10), u, u);
        if (f > 0.7) { ctx.fillStyle = 'rgba(94,74,42,0.6)'; ctx.fillRect(tx - 2 * u, ty - u, u, u); ctx.fillRect(tx + u, ty - 2 * u, u, u); }
      }
      { const at = this.action?.type, hoeing = at === 'hoe' || at === 'clear' || at === 'drain';
        if (hoeing || at === 'water') { const phase = hoeing ? Math.floor(this.action.t / (this.action.dur / 3) * 2) % 2 : Math.floor(now / 120) % 2; ctx.drawImage(toolOverlay(hoeing ? 'hoe' : 'can', p.dir, phase), px, py, T, PLAYER_H * CONFIG.scale); } }
    } });
    if (this.bird) {
      const f = this.bird.t / CONFIG.bird.flightSeconds, bx = (this.bird.x + 0.5) * T - cx + (f - 0.5) * (this.vw + 200), by = (this.bird.y - 2.5) * T - cy + Math.sin(f * Math.PI * 4) * 6;
      drawables.push({ y: 1e9, draw: () => { ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect((this.bird.x + 0.5) * T - cx + (f - 0.5) * (this.vw + 200) - 12, (this.bird.y + 0.5) * T - cy - 3, 24, 6); ctx.drawImage(birdSprite(Math.floor(now / 110) % 2), bx - 6 * CONFIG.scale, by, 12 * CONFIG.scale, 10 * CONFIG.scale); if (this.bird.dropped && f < 0.75) { const d = (f - 0.5) / 0.25; ctx.drawImage(splatSprite(), (this.bird.x + 0.5) * T - cx - 8, by + d * ((this.bird.y + 0.5) * T - cy - by), 16, 16); } } });
    }
    drawables.sort((a, b) => a.y - b.y);
    for (const d of drawables) d.draw();
    // a sprinkler's reach: under the cursor while you hold one, or over a placed one you point at
    if (!this.ui.openPanel && this.mouse.inside && !s.carrying) {
      const it = this.hotbarItem(), mt = tileAt(w, this.mouse.tx, this.mouse.ty), R = CONFIG.sprinkler.radius;
      if ((it?.kind === 'pipe' || it?.kind === 'pump') && !this.hit && mt) { const x0 = this.mouse.tx * T - cx, y0 = this.mouse.ty * T - cy; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y0 + 1, T - 2, T - 2); }
      if ((it?.kind === 'sprinkler' && !this.hit) || mt?.obj?.kind === 'sprinkler') {
        const x0 = (this.mouse.tx - R) * T - cx, y0 = (this.mouse.ty - R) * T - cy, L = (2 * R + 1) * T;
        ctx.fillStyle = 'rgba(63,143,214,0.18)'; ctx.fillRect(x0, y0, L, L); ctx.strokeStyle = 'rgba(63,143,214,0.75)'; ctx.lineWidth = 2; ctx.strokeRect(x0 + 1, y0 + 1, L - 2, L - 2);
      }
    }
    // land to claim: drawn over the trees so the plots read as plots
    if (this.landMode) for (const c of buyableChunks(w)) {
      const o = chunkOrigin(c.cx, c.cy);
      ctx.fillStyle = 'rgba(246,196,83,0.35)'; ctx.fillRect(o.x * T - cx, o.y * T - cy, CHUNK * T, CHUNK * T);
      ctx.strokeStyle = '#f6c453'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(o.x * T - cx + 1, o.y * T - cy + 1, CHUNK * T - 2, CHUNK * T - 2); ctx.setLineDash([]);
      drawText(ctx, 'CLAIM', o.x * T - cx + CHUNK * T / 2 - textWidth('CLAIM', 2) / 2, o.y * T - cy + CHUNK * T / 2 - 5, '#f6c453', 2);
    }
    // seeds ready: the same arrow as a ripe crop, over the rack (and over the bench when bred seeds wait)
    if (!this.ui.openPanel && s.carrying !== 'seedrack' && rackState === 2) this.drawArrow(SR.x * T - cx + T / 2, (SR.y + 1) * T - cy - 28 * CONFIG.scale - 14, now);
    { const BP = S.objectPos(s, 'bench'); if (!this.ui.openPanel && BP && s.carrying !== 'bench' && s.breeder.result) this.drawArrow(BP.x * T - cx + T / 2, (BP.y + 1) * T - cy - 28 * CONFIG.scale - 14, now); }
    { const CP = S.objectPos(s, 'compost'); if (!this.ui.openPanel && CP && s.carrying !== 'compost' && s.compost.ready) this.drawArrow(CP.x * T - cx + T / 2, (CP.y + 1) * T - cy - 20 * CONFIG.scale - 14, now); }
    // drying progress over the seed rack
    if (rackState === 1 && s.carrying !== 'seedrack') { const bx = SR.x * T - cx + 8, by = (SR.y + 1) * T - cy - 28 * CONFIG.scale - 6, bw = T - 16, f = S.trayProgress(s, shownTray); ctx.fillStyle = '#3b2314'; ctx.fillRect(bx - 2, by - 2, bw + 4, 10); ctx.fillStyle = '#f5e6c3'; ctx.fillRect(bx, by, bw, 6); ctx.fillStyle = '#e8a23b'; ctx.fillRect(bx, by, Math.round(bw * Math.max(0, Math.min(1, f))), 6); }
    // progress bar over the tile being worked
    if (this.action && !['fill', 'drink', 'eat'].includes(this.action.type)) { const a = this.action, bx = a.x * T - cx + 8, by = a.y * T - cy - 10, bw = T - 16; ctx.fillStyle = '#3b2314'; ctx.fillRect(bx - 2, by - 2, bw + 4, 10); ctx.fillStyle = '#f5e6c3'; ctx.fillRect(bx, by, bw, 6); ctx.fillStyle = a.type === 'hoe' ? '#b5834f' : a.type === 'drop' || a.type === 'dry' || a.type === 'compost' ? '#f6c453' : '#3f8fd6'; ctx.fillRect(bx, by, Math.round(bw * a.t / a.dur), 6); }
    else if (this.action) { const a = this.action, bx = Math.round(p.x * T) - cx - 24, by = py - 14; ctx.fillStyle = '#3b2314'; ctx.fillRect(bx - 2, by - 2, 52, 10); ctx.fillStyle = '#f5e6c3'; ctx.fillRect(bx, by, 48, 6); ctx.fillStyle = a.type === 'eat' ? '#f6c453' : '#3f8fd6'; ctx.fillRect(bx, by, Math.round(48 * a.t / a.dur), 6); }
    // cursor: outline the soil tile, or highlight the object under the mouse with a prompt
    if (this.mouse.inside && !this.ui.openPanel) {
      const hit = this.hit, u = CONFIG.scale;
      if (s.carrying) {   // where it would land
        const ok = S.canPlaceAt(s, this.mouse.tx, this.mouse.ty);
        ctx.fillStyle = ok ? 'rgba(255,241,184,0.25)' : 'rgba(217,69,61,0.25)'; ctx.fillRect(this.mouse.tx * T - cx, this.mouse.ty * T - cy, T, T);
        ctx.strokeStyle = ok ? 'rgba(255,241,184,0.9)' : 'rgba(217,69,61,0.9)'; ctx.lineWidth = 3; ctx.strokeRect(this.mouse.tx * T - cx + 2, this.mouse.ty * T - cy + 2, T - 4, T - 4);
      } else if (hit) {
        const [rx, ry, rw, rh] = hit.rect, pulse = 0.7 + 0.3 * Math.sin(now / 180);
        ctx.strokeStyle = `rgba(59,35,20,0.8)`; ctx.lineWidth = 2; ctx.strokeRect(rx * u - cx - 3, ry * u - cy - 3, rw * u + 6, rh * u + 6);
        ctx.strokeStyle = `rgba(255,241,184,${pulse.toFixed(2)})`; ctx.lineWidth = 3; ctx.strokeRect(rx * u - cx - 1.5, ry * u - cy - 1.5, rw * u + 3, rh * u + 3);
      } else {
        const reach = S.inReach(s, this.mouse.tx, this.mouse.ty);
        ctx.strokeStyle = reach ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)'; ctx.lineWidth = 3;
        ctx.strokeRect(this.mouse.tx * T - cx + 2, this.mouse.ty * T - cy + 2, T - 4, T - 4);
        ctx.strokeStyle = 'rgba(59,35,20,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(this.mouse.tx * T - cx + 0.5, this.mouse.ty * T - cy + 0.5, T - 1, T - 1);
      }
    }
    // night tint
    const h = S.hourOf(s);
    const dark = h >= 18 && h < 22 ? (h - 18) / 4 * 0.55 : h >= 22 || h < 4 ? 0.55 : h < 7 ? (7 - h) / 3 * 0.55 : 0;
    const warm = h >= 17.5 && h < 20.5 ? 0.18 * (1 - Math.abs(h - 19) / 1.5) : h >= 5 && h < 8 ? 0.14 * (1 - Math.abs(h - 6.5) / 1.5) : 0;
    if (warm > 0) { ctx.fillStyle = `rgba(255,140,60,${warm.toFixed(3)})`; ctx.fillRect(0, 0, this.vw, this.vh); }
    if (dark > 0) { ctx.fillStyle = `rgba(20,16,60,${dark.toFixed(3)})`; ctx.fillRect(0, 0, this.vw, this.vh); }
    { const hum = S.humidityOf(s);   // wet weather: a cool cast, and glints on the ground after rain
      if (s.rainToday) {
        ctx.fillStyle = 'rgba(70,100,150,0.16)'; ctx.fillRect(0, 0, this.vw, this.vh);
        ctx.fillStyle = 'rgba(230,240,255,0.55)'; for (let i = 0; i < 40; i++) { const gx = ((i * 97 + 13) % 101) / 101 * (w.w * T), gy = ((i * 61 + 7) % 103) / 103 * (w.h * T); if ((Math.floor(now / 400) + i) % 3 === 0) ctx.fillRect(Math.round(gx - cx), Math.round(gy - cy), 3, 3); }   // glints on wet ground
        ctx.strokeStyle = 'rgba(205,225,255,0.5)'; ctx.lineWidth = 2; ctx.beginPath();   // the rain itself: thin slanted streaks falling across the screen
        const n = 140, H = this.vh + 40, Wd = this.vw + 80;
        for (let i = 0; i < n; i++) { const sp = 380 + (i % 5) * 40, x = ((i * 137 + 29) % Wd) - 40 - ((now * 0.06 + i * 7) % Wd) * 0.12, y = ((i * 89 + 11) % H) + (now * sp / 1000) % H; const yy = y % H - 20; ctx.moveTo(x, yy); ctx.lineTo(x - 2, yy + 9); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(220,235,255,0.35)'; for (let i = 0; i < 24; i++) { const t = (now / 500 + i * 0.37) % 1, gx = ((i * 211 + 5) % 97) / 97 * this.vw, gy = ((i * 53 + 3) % 89) / 89 * this.vh; if (t < 0.3) { const r = Math.round(t * 10); ctx.fillRect(gx - r, gy, 2 * r + 1, 1); } }   // splashes
      }
      else if (hum > 60) { ctx.fillStyle = `rgba(200,210,230,${((hum - 60) / 40 * 0.1).toFixed(3)})`; ctx.fillRect(0, 0, this.vw, this.vh); } }
    ctx.font = '11px "Press Start 2P", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (const f of this.floats) { const a = f.t < 1.5 ? 1 : 1 - (f.t - 1.5) / 0.7, fx = Math.round(f.x * T - cx), fy = Math.round(f.y * T - cy - 20 - Math.min(f.t, 1.5) * 22); ctx.globalAlpha = Math.max(0, a); ctx.lineWidth = 4; ctx.strokeStyle = '#3b2314'; ctx.lineJoin = 'round'; ctx.strokeText(f.text, fx, fy); ctx.fillStyle = f.color; ctx.fillText(f.text, fx, fy); ctx.globalAlpha = 1; }
    ctx.textAlign = 'left';
    if (this.heldLabel && !this.ui.openPanel) {   // what you just picked up, over your head
      const a = this.heldLabel.t < 1.1 ? 1 : 1 - (this.heldLabel.t - 1.1) / 0.5, txt = this.heldLabel.text; ctx.font = '9px "Press Start 2P", monospace'; const tw = Math.ceil(ctx.measureText(txt).width);
      const lx = Math.round(p.x * T - cx - tw / 2 - 6), ly = py - 26; ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = '#3b2314'; ctx.fillRect(lx - 3, ly - 3, tw + 18, 22); ctx.fillStyle = '#f5e6c3'; ctx.fillRect(lx, ly, tw + 12, 16); ctx.fillStyle = '#3b2314'; ctx.textBaseline = 'top'; ctx.fillText(txt, lx + 6, ly + 4); ctx.globalAlpha = 1;
    }
    if (this.landMode) { const msg = `LAND DEED: CLICK A HIGHLIGHTED PLOT TO CLAIM IT   ${s.deeds} LEFT   ESC = LATER`; const tw = textWidth(msg, 2); ctx.fillStyle = 'rgba(59,35,20,0.85)'; ctx.fillRect((this.vw - tw) / 2 - 12, 110, tw + 24, 26); drawText(ctx, msg, (this.vw - tw) / 2, 118, '#f6c453', 2); }
    drawHud(ctx, s, this.vw, this.vh, this.selected, { flash: this.flash || 0, flag: this.flag, money: this.shownMoney ?? s.money });
    if (this.drag?.moved) { const img = itemSprite(s.inventory.slots[this.drag.from], s.species); if (img) { ctx.globalAlpha = 0.85; ctx.drawImage(img, this.mouse.x - 20, this.mouse.y - 20, 40, 40); ctx.globalAlpha = 1; } }
    if (this.mouse.inside && !this.ui.openPanel) {
      const cs = 3, hit = this.hit || (s.carrying ? { label: S.canPlaceAt(s, this.mouse.tx, this.mouse.ty) ? 'Put it down here' : 'Needs open grass in reach' } : null);
      if (this.press && this.press.t > 0.08) {   // lift progress ring under the cursor
        ctx.strokeStyle = '#3b2314'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(this.mouse.x, this.mouse.y + 30, 12, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = '#f6c453'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(this.mouse.x, this.mouse.y + 30, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.press.t / CONFIG.player.pickUpSeconds)); ctx.stroke();
      }
      if (hit) {   // prompt above the hand cursor
        ctx.font = `9px "Press Start 2P", monospace`; ctx.textAlign = 'left'; const tw = Math.ceil(ctx.measureText(hit.label).width);   // the HUD may leave textAlign at 'right'
        const lx = Math.min(this.vw - tw - 16, Math.max(4, this.mouse.x + 10)), ly = Math.max(4, this.mouse.y - 34);
        ctx.fillStyle = '#3b2314'; ctx.fillRect(lx - 3, ly - 3, tw + 18, 22); ctx.fillStyle = '#f5e6c3'; ctx.fillRect(lx, ly, tw + 12, 16);
        ctx.fillStyle = '#3b2314'; ctx.textBaseline = 'top'; ctx.fillText(hit.label, lx + 6, ly + 4);
      }
      ctx.drawImage(cursorSprite(this.hit || s.carrying ? 'hand' : 'arrow'), this.mouse.x - (this.hit || s.carrying ? 4 * cs : 0), this.mouse.y, 12 * cs, 14 * cs);
    }
  }
}
