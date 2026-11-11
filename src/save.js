// Save/load to localStorage with export/import, plus offline progress from the saved timestamp.
import { CONFIG } from './config.js';
import { advance, gameMinutesPerRealSecond, migrate } from './sim.js';

export const SAVE_KEY = 'farm-save-v1';
// Build 102, the game is public: an update must never lose a farm. The save as it was before an update is copied to
// BACKUP_KEY; a save this build cannot open is moved to RESCUE_KEY untouched and a fresh farm starts beside it.
export const BACKUP_KEY = 'farm-save-before-update', RESCUE_KEY = 'farm-save-rescued';

export function serialize(state) {
  return JSON.stringify({ ...state, savedAt: Date.now() });
}
export function deserialize(json) {
  const s = JSON.parse(json);
  if (!s || s.version !== 1 || !s.world || !s.species) throw new Error('Not a farm save');
  return s;
}
// Open a save text the way the game does: check it, bring it up to this build, and only then run the time it was away
// (the catch-up runs this build's rules, so it needs the upgraded farm). Throws if it cannot.
export function openSave(json, nowReal = Date.now()) {
  const s = deserialize(json);
  if (s.layout !== CONFIG.layout) throw new Error(`made for map layout ${s.layout}, this game has ${CONFIG.layout}`);
  const from = s.build || 0;
  migrate(s);
  const { hours } = applyOffline(s, nowReal);
  s.build = CONFIG.build;
  return { state: s, hours, from };
}
// Apply the time that passed while the game was closed. Returns the game hours simulated.
export function applyOffline(state, nowReal = Date.now()) {
  const elapsed = Math.max(0, (nowReal - (state.savedAt || nowReal)) / 1000);
  const maxReal = CONFIG.time.offlineMaxHours * 60 / gameMinutesPerRealSecond();
  const realSeconds = Math.min(elapsed, maxReal);
  if (realSeconds < 5) return { hours: 0, events: [] };
  const events = advance(state, realSeconds);
  return { hours: realSeconds * gameMinutesPerRealSecond() / 60, events };
}
export function saveLocal(state) { try { localStorage.setItem(SAVE_KEY, serialize(state)); return true; } catch { return false; } }
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
// The game's start-up load. Returns null (no save), { state, hours, from } or { rescued: message }.
export function loadLocal(nowReal = Date.now()) {
  const raw = get(SAVE_KEY); if (!raw) return null;
  try {
    const r = openSave(raw, nowReal);
    if (r.from !== CONFIG.build) set(BACKUP_KEY, JSON.stringify({ build: r.from, at: Date.now(), save: raw }));
    return r;
  } catch (e) {
    const msg = String(e?.message || e);
    set(RESCUE_KEY, JSON.stringify({ build: CONFIG.build, at: Date.now(), error: msg, save: raw }));
    try { console.error('Save could not be opened, kept under ' + RESCUE_KEY, e); } catch {}
    return { rescued: msg };
  }
}
export const savedCopy = which => { try { return JSON.parse(get(which === 'rescue' ? RESCUE_KEY : BACKUP_KEY)); } catch { return null; } };
export const dropRescue = () => { try { localStorage.removeItem(RESCUE_KEY); } catch {} };
export function clearLocal() { try { localStorage.removeItem(SAVE_KEY); } catch {} }
