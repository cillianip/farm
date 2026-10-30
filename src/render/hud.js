// Pixel-style HUD drawn on the canvas: money and date/time panels, health / hunger / thirst bars, an empty hotbar.
import { CONFIG } from '../config.js';
import * as S from '../sim.js';
import { formatMoney } from '../economy.js';
import { toolIcon, seedIcon, fertIcon, sprinklerSprite, witheredSprite, pipeSprite, pumpIcon } from './sprites.js';
import { produceSprite, cropSprite } from './crops.js';

const U = 3;   // HUD pixel unit in CSS px
const FONT = '"Press Start 2P", monospace';
const COL = { frameDark: '#3b2314', wood: '#8c5a2b', woodLight: '#b07a3e', paper: '#f5e6c3', paperShade: '#e0cda2', text: '#3b2314', gold: '#e9a93a', goldDark: '#b57a1f' };

function panel(ctx, x, y, w, h) {
  ctx.fillStyle = COL.frameDark; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COL.wood; ctx.fillRect(x + U, y + U, w - 2 * U, h - 2 * U);
  ctx.fillStyle = COL.woodLight; ctx.fillRect(x + U, y + U, w - 2 * U, U); ctx.fillRect(x + U, y + U, U, h - 2 * U);
  ctx.fillStyle = COL.frameDark; ctx.fillRect(x + 3 * U, y + 3 * U, w - 6 * U, h - 6 * U);
  ctx.fillStyle = COL.paper; ctx.fillRect(x + 4 * U, y + 4 * U, w - 8 * U, h - 8 * U);
  ctx.fillStyle = COL.paperShade; ctx.fillRect(x + 4 * U, y + 4 * U, w - 8 * U, U); ctx.fillRect(x + 4 * U, y + 4 * U, U, h - 8 * U);
  // corner studs
  for (const [sx, sy] of [[x + 2 * U, y + 2 * U], [x + w - 3 * U, y + 2 * U], [x + 2 * U, y + h - 3 * U], [x + w - 3 * U, y + h - 3 * U]]) { ctx.fillStyle = COL.goldDark; ctx.fillRect(sx, sy, U, U); }
}
function text(ctx, str, x, y, size, color, align = 'left') {
  ctx.font = `${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillText(str, x + 2, y + 2);
  ctx.fillStyle = color; ctx.fillText(str, x, y);
}
function icon(ctx, rows, x, y, pal) {   // rows: strings of palette keys, '.' = empty
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) { const k = rows[j][i]; if (k !== '.') { ctx.fillStyle = pal[k]; ctx.fillRect(x + i * U, y + j * U, U, U); } }
}
const ICONS = {
  coin: { rows: ['.oooo.', 'oyyyyo', 'oyddyo', 'oyddyo', 'oyyyyo', '.oooo.'], pal: { o: '#b57a1f', y: '#f6c453', d: '#e9a93a' } },
  bolt: { rows: ['...yy..', '..yy...', '.yyyy..', '..lyyy.', '...yy..', '..yy...', '.y.....'], pal: { y: '#f6c453', l: '#fff1b8' } },
  apple: { rows: ['...s.g.', '..rrgg.', '.rlrrrr', 'rlrrrrr', 'rrrrrrr', '.rrrrr.', '..rr.r.'], pal: { r: '#d9453d', l: '#f08a7d', s: '#5a3a1e', g: '#7fb04a' } },
  drop: { rows: ['...b...', '..bbb..', '.bbbbb.', 'bblbbbb', 'bbbbbbb', '.bbbbb.', '..bbb..'], pal: { b: '#3f8fd6', l: '#a9d8f7' } },
  sun: { rows: ['..y.y..', '.yyyyy.', 'yyyoyyy', '.yyyyy.', '..y.y..'], pal: { y: '#f6c453', o: '#fff1b8' } },
  moon: { rows: ['..www..', '.ww....', 'ww.....', '.ww....', '..www..'], pal: { w: '#e9eef7' } },
  rain: { rows: ['.ggggg.', 'ggggggg', '.b.b.b.', 'b.b.b.b'], pal: { g: '#9aa3b2', b: '#6fb1e8' } },
  humid: { rows: ['...b...', '..bbb..', '.bbbbb.', '.blbbb.', '..bbb..', 'w.w.w.w', '.w.w.w.'], pal: { b: '#3f8fd6', l: '#a9d8f7', w: '#8fb8d8' } },
};

function bar(ctx, x, y, w, h, frac, color, light, iconName) {
  const ic = ICONS[iconName]; icon(ctx, ic.rows, x + Math.round((w - ic.rows[0].length * U) / 2), y - 9 * U, ic.pal);
  ctx.fillStyle = COL.frameDark; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = COL.wood; ctx.fillRect(x + U, y + U, w - 2 * U, h - 2 * U);
  ctx.fillStyle = '#2a1a10'; ctx.fillRect(x + 2 * U, y + 2 * U, w - 4 * U, h - 4 * U);
  const inner = h - 4 * U, fill = Math.round(inner * Math.max(0, Math.min(1, frac)));
  if (fill > 0) {
    ctx.fillStyle = color; ctx.fillRect(x + 2 * U, y + 2 * U + inner - fill, w - 4 * U, fill);
    ctx.fillStyle = light; ctx.fillRect(x + 2 * U, y + 2 * U + inner - fill, U, fill); ctx.fillRect(x + 2 * U, y + 2 * U + inner - fill, w - 4 * U, U);
  }
  for (let yy = y + 2 * U + U * 6; yy < y + h - 2 * U; yy += U * 6) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 2 * U, yy, w - 4 * U, 1); }
}

export function hotbarRects(vw, vh) {
  const pad = 4 * U, slot = 16 * U, gap = U, n = CONFIG.inventory.hotbar, hw = n * slot + (n - 1) * gap + 8 * U, hx = Math.round((vw - hw) / 2), hy = vh - pad - 24 * U;
  const slots = []; for (let i = 0; i < n; i++) slots.push({ x: hx + 4 * U + i * (slot + gap), y: hy + 4 * U, w: slot, h: slot });
  return { x: hx, y: hy, w: hw, h: 24 * U, slots };
}
export function itemSprite(it, species) {
  if (!it) return null;
  if (it.kind === 'tool') return toolIcon(it.tool);
  if (it.kind === 'seed') { const g = species[it.species]?.genome; return g ? seedIcon(Math.round(g.hue1), g.sat1, g.light1) : null; }
  if (it.kind === 'crop') { const sp = species[it.species]; return sp ? produceSprite(sp) : null; }
  if (it.kind === 'fert') return fertIcon();
  if (it.kind === 'sprinkler') return sprinklerSprite(it.level || 0, 0);
  if (it.kind === 'pump') return pumpIcon(it.level || 0);
  if (it.kind === 'pipe') return pipeSprite(10);
  if (it.kind === 'withered') return witheredSprite();
  if (it.kind === 'pulled') { const sp = species[it.species]; return sp ? cropSprite(sp, it.unknown ? 1 : 2, 0) : witheredSprite(); }
  return null;
}

export function drawHud(ctx, state, vw, vh, selected = 0, extra = {}) {
  const pad = 4 * U;
  // money (top-left) with the two numbers that move: last night's sale and what is planted
  const money = formatMoney(extra.money ?? state.money);
  const y = S.yesterday(state), rate = S.fieldValue(state);
  const lines = [];
  lines.push(['Sold last night', y ? formatMoney(y.sale) : 'nothing yet', COL.text]);
  lines.push(['In the ground', rate > 0 ? `${formatMoney(rate)} at harvest` : 'nothing', rate > 0 ? '#3f7a1f' : COL.text]);
  lines.push(['Crate', `${S.crateCount(state)} / ${state.crate.capacity}${state.crate.pickups ? ', noon & night' : ' a night'}`, S.crateCount(state) >= state.crate.capacity ? '#a0462f' : COL.text]);
  ctx.font = `20px ${FONT}`; const mw = ctx.measureText(money).width;
  ctx.font = `9px ${FONT}`; const lw = Math.max(...lines.map(([k, v]) => ctx.measureText(`${k}    ${v}`).width));
  const pitch = 6 * U, top = 21 * U;
  const pw = Math.max(60 * U, mw + 22 * U, lw + 16 * U), ph = top + lines.length * pitch + 4 * U;
  panel(ctx, pad, pad, pw, ph);
  if (extra.flash > 0) { ctx.fillStyle = `rgba(246,196,83,${0.45 * extra.flash})`; ctx.fillRect(pad + 4 * U, pad + 4 * U, pw - 8 * U, ph - 8 * U); }
  icon(ctx, ICONS.coin.rows, pad + 6 * U, pad + 7 * U, ICONS.coin.pal);
  text(ctx, money, pad + 14 * U, pad + 6.5 * U, 20, COL.goldDark);
  ctx.fillStyle = COL.paperShade; ctx.fillRect(pad + 6 * U, pad + 17 * U, pw - 12 * U, U);   // rule under the money
  lines.forEach(([k, v, c], i) => { const ly = pad + top + i * pitch; text(ctx, k, pad + 7 * U, ly, 9, '#8a6a44'); text(ctx, v, pad + pw - 7 * U, ly, 9, c, 'right'); });
  // date & time (top-right)
  const h = S.hourOf(state), hh = Math.floor(h), mm = Math.floor((state.minutes % 60) / 10) * 10;
  const ampm = hh >= 12 ? 'PM' : 'AM', h12 = ((hh + 11) % 12) + 1;
  const dw = 80 * U, dx = vw - pad - dw, hum = S.humidityOf(state);
  panel(ctx, dx, pad, dw, 46 * U);
  text(ctx, `Day ${S.dayOf(state)}`, dx + 6 * U, pad + 6 * U, 12, COL.text);
  text(ctx, `${h12}:${String(mm).padStart(2, '0')} ${ampm}`, dx + 6 * U, pad + 16 * U, 12, COL.text);
  const wi = state.rainToday ? ICONS.rain : (h >= 20 || h < 6) ? ICONS.moon : ICONS.sun;
  icon(ctx, wi.rows, dx + dw - 14 * U, pad + 7 * U, wi.pal);
  // humidity: how fast beds dry today. A labelled row under its own rule.
  ctx.fillStyle = COL.paperShade; ctx.fillRect(dx + 6 * U, pad + 26 * U, dw - 12 * U, U);
  icon(ctx, ICONS.humid.rows, dx + 6 * U, pad + 30 * U, ICONS.humid.pal);
  text(ctx, 'Humidity', dx + 15 * U, pad + 31 * U, 9, '#8a6a44');
  text(ctx, `${hum}% ${S.humidityWord(hum)}`, dx + dw - 7 * U, pad + 31 * U, 9, hum >= 65 ? '#3f6fa8' : hum < 40 ? '#b5834f' : COL.text, 'right');
  // bars (bottom-right): health, hunger, thirst
  const bw = 10 * U, bh = 44 * U, by = vh - pad - bh, bx = vw - pad - 3 * bw - 2 * 4 * U;
  const tired = S.isTired(state), blink = tired && Math.floor(Date.now() / 500) % 2 === 0;
  bar(ctx, bx, by, bw, bh, state.energy / state.energyMax, tired ? '#d9533a' : '#e9b93a', tired ? '#f08a73' : '#ffe08a', 'bolt');   // energy: red when you are worn out
  if (tired) { const tw = 3 * bw + 2 * 4 * U; ctx.fillStyle = blink ? '#a0462f' : COL.frameDark; ctx.fillRect(bx, by - 20 * U, tw, 9 * U); ctx.fillStyle = COL.paper; ctx.fillRect(bx + U, by - 19 * U, tw - 2 * U, 7 * U); text(ctx, 'TIRED', bx + tw / 2, by - 17.5 * U, 8, '#a0462f', 'center'); }
  bar(ctx, bx + bw + 4 * U, by, bw, bh, (state.hunger ?? 100) / 100, '#d9533a', '#f08a73', 'apple');
  bar(ctx, bx + 2 * (bw + 4 * U), by, bw, bh, (state.thirst ?? 100) / 100, '#3f8fd6', '#8cc6f0', 'drop');
  // hotbar (bottom-centre)
  const hb = hotbarRects(vw, vh);
  panel(ctx, hb.x, hb.y, hb.w, hb.h);
  hb.slots.forEach((r, i) => {
    const it = state.inventory.slots[i], sel = i === selected;
    ctx.fillStyle = sel ? COL.gold : COL.frameDark; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = COL.paperShade; ctx.fillRect(r.x + U, r.y + U, r.w - 2 * U, r.h - 2 * U);
    ctx.fillStyle = sel ? '#fff4d6' : COL.paper; ctx.fillRect(r.x + 2 * U, r.y + 2 * U, r.w - 4 * U, r.h - 4 * U);
    if (it) {
      const img = itemSprite(it, state.species); if (img) ctx.drawImage(img, r.x + 2 * U, r.y + 2 * U, r.w - 4 * U, r.h - 4 * U);
      if (it.kind !== 'tool' && it.qty > 1) text(ctx, String(it.qty), r.x + r.w - 2 * U, r.y + r.h - 4 * U, 7, COL.text, 'right');
      if (it.kind === 'tool' && it.tool === 'can') {   // water level
        const fw = r.w - 4 * U, f = state.can.water / state.can.capacity;
        ctx.fillStyle = '#2a1a10'; ctx.fillRect(r.x + 2 * U, r.y + r.h - 3 * U, fw, U);
        ctx.fillStyle = '#3f8fd6'; ctx.fillRect(r.x + 2 * U, r.y + r.h - 3 * U, Math.round(fw * f), U);
      }
    } else text(ctx, String(i + 1), r.x + 2 * U, r.y + 2 * U, 6, '#b8a080');
  });
}
