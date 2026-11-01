// Items and slot inventories. Items: {kind, qty, species?, q?, fert?, tool?, unknown?}
// kinds: tool, seed, crop, fert, sprinkler, pump (level = tier), pipe (a section to lay), generator, line (a section of power line), belt (a section of belt), fuel (a can for a generator or an engine), picker, hopper, dryer, withered (a dead plant the hoe cleared), pulled (a living plant the hoe dug up),
// product (something made from a crop: {product: 'dried', species, q})
import { CONFIG } from './config.js';

export const itemKey = it => it.kind === 'fert' ? `fert:${it.fert.id || it.fert.name}` : `${it.kind}:${it.species || ''}:${it.q || 0}:${it.tool || ''}${it.level ? ':' + it.level : ''}${it.product ? ':' + it.product : ''}`;
export const isFood = it => !!it && (it.kind === 'crop' || it.kind === 'product');   // what sells as food: at the cart, on the counter
export const makeInventory = n => ({ slots: new Array(n).fill(null) });
export const stackable = it => it.kind !== 'tool';
// true when addItem would take all of it (a stack with room, or a free slot)
export const hasRoom = (inv, item) => { const key = itemKey(item); return inv.slots.some(s => !s || (stackable(item) && itemKey(s) === key && s.qty + item.qty <= CONFIG.inventory.stack)); };

// returns leftover quantity (0 if all added)
export function addItem(inv, item) {
  let qty = item.qty;
  const key = itemKey(item);
  const max = CONFIG.inventory.stack;
  if (stackable(item)) for (const s of inv.slots) {
    if (s && itemKey(s) === key && s.qty < max) { const take = Math.min(max - s.qty, qty); s.qty += take; qty -= take; if (!qty) return 0; }
  }
  for (let i = 0; i < inv.slots.length && qty > 0; i++) {
    if (!inv.slots[i]) { const take = stackable(item) ? Math.min(max, qty) : 1; inv.slots[i] = { ...item, qty: take }; qty -= take; }
  }
  return qty;
}
export function countItem(inv, key) { return inv.slots.reduce((n, s) => n + (s && itemKey(s) === key ? s.qty : 0), 0); }
export function removeFromSlot(inv, i, n = 1) {
  const s = inv.slots[i]; if (!s) return null;
  const take = Math.min(n, s.qty);
  const out = { ...s, qty: take };
  s.qty -= take; if (s.qty <= 0) inv.slots[i] = null;
  return out;
}
export function removeByKey(inv, key, n) {
  let left = n;
  for (let i = 0; i < inv.slots.length && left > 0; i++) { const s = inv.slots[i]; if (s && itemKey(s) === key) { const r = removeFromSlot(inv, i, left); left -= r.qty; } }
  return n - left;
}
export function growInventory(inv, extra) { for (let i = 0; i < extra; i++) inv.slots.push(null); }
export function itemName(it, species) {
  if (!it) return '';
  if (it.kind === 'tool') return it.tool === 'hoe' ? 'Hoe' : 'Watering can';
  if (it.kind === 'seed') return `${species[it.species]?.name || '?'} seeds`;
  if (it.kind === 'crop') return `${species[it.species]?.name || '?'}${it.q ? ' ' + '★'.repeat(it.q) : ''}`;
  if (it.kind === 'product') return `Dried ${species[it.species]?.name || '?'}${it.q ? ' ' + '★'.repeat(it.q) : ''}`;
  if (it.kind === 'fert') return it.fert.name;
  if (it.kind === 'sprinkler') return CONFIG.sprinkler.tiers[it.level || 0].name;
  if (it.kind === 'pipe') return 'Pipe';
  if (it.kind === 'pump') return CONFIG.pump.tiers[it.level || 0].name;
  if (it.kind === 'generator') return 'Generator';
  if (it.kind === 'line') return 'Power line';
  if (it.kind === 'fuel') return 'Fuel';
  if (it.kind === 'belt') return 'Belt';
  if (it.kind === 'picker') return 'Picker';
  if (it.kind === 'hopper') return 'Hopper';
  if (it.kind === 'dryer') return 'Dryer';
  if (it.kind === 'chest') return 'Field chest';
  if (it.kind === 'withered') return 'Withered plant';
  if (it.kind === 'pulled') return it.unknown ? 'Pulled sprout' : `Pulled ${species[it.species]?.name || 'plant'}`;
  return it.kind;
}
