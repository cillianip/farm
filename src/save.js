// Save/load to localStorage with export/import, plus offline progress from the saved timestamp.
import { CONFIG } from './config.js';
import { advance, gameMinutesPerRealSecond } from './sim.js';

export const SAVE_KEY = 'farm-save-v1';

export function serialize(state) {
  return JSON.stringify({ ...state, savedAt: Date.now() });
}
export function deserialize(json) {
  const s = JSON.parse(json);
  if (!s || s.version !== 1 || !s.world || !s.species) throw new Error('Not a farm save');
  return s;
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
export function loadLocal() { try { const j = localStorage.getItem(SAVE_KEY); return j ? deserialize(j) : null; } catch { return null; } }
export function clearLocal() { try { localStorage.removeItem(SAVE_KEY); } catch {} }
