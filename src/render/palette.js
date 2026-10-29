// Cosy limited palette + colour helpers.
export const PAL = {
  grass: "#74b35a", grass2: "#7fbd63", grass3: "#6aa651", grassDark: "#55903f", grassUnowned: "#5a8f45",
  soil: '#9c6b3f', soilDark: '#7e5430', soilWet: '#6b4527', soilWetDark: '#54351e',
  path: '#c9b07c', pathStone: '#b89d6b', water: '#4f8fcf', waterLight: '#7fb4e6', waterDark: '#3f72a8',
  wood: '#8c5a2b', woodDark: '#6a4220', woodLight: '#b07a3e', roof: '#b84a3c', roofDark: '#8f3730', wall: '#f1e2c2', wallDark: '#d6c3a0',
  window: '#9bd3ee', door: '#5a3a1e', metal: '#8b93a6', metalDark: '#5c6273', metalLight: '#c2c8d6', glass: '#bfe9f7',
  skin: '#f1c7a1', hair: '#5a3a1e', hat: '#c98f3c', hatBand: '#8f5a1f', shirt: '#4b7fc4', shirtDark: '#3a63a0', pants: '#4a3b6b', boots: '#3a2a1a',
  outline: '#2a1f14', white: '#ffffff', black: '#000000', gold: '#f6c453', withered: '#8a7b63', witheredDark: '#5e5343',
  fence: '#a97c4a',
};
export function hsl(h, s, l, a = 1) { return `hsla(${Math.round(((h % 360) + 360) % 360)},${Math.round(s * 100)}%,${Math.round(l * 100)}%,${a})`; }
// a 2D pixel drawer around a canvas context (1 unit = 1 pixel)
export function pixelDrawer(ctx) {
  return {
    ctx,
    px(x, y, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, 1, 1); },
    rect(x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(x | 0, y | 0, w | 0, h | 0); },
    line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; for (let i = 0; i <= n; i++) this.px(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c); },
    disc(cx, cy, r, c) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.5) this.px(cx + x, cy + y, c); },
  };
}
export function makeCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}
