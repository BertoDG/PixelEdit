'use strict';
/* =========================================================================
 * Utilidades: colores, geometría de píxeles y DOM.
 * Los colores se guardan como enteros u32 en el orden de memoria de
 * ImageData (little-endian): 0xAABBGGRR.
 * ========================================================================= */

const $ = (s, root = document) => root.querySelector(s);

function rgba(r, g, b, a = 255) { return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; }
const cR = c => c & 255;
const cG = c => (c >>> 8) & 255;
const cB = c => (c >>> 16) & 255;
const cA = c => c >>> 24;

function hexToU32(hex, alpha = 255) {
  hex = String(hex).trim().replace(/^#/, '');
  if (hex.length === 3 || hex.length === 4) hex = hex.split('').map(ch => ch + ch).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex)) return null;
  const n = parseInt(hex.slice(0, 6), 16);
  const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : alpha;
  return rgba((n >> 16) & 255, (n >> 8) & 255, n & 255, a);
}
function u32ToHex(c) {
  return '#' + [cR(c), cG(c), cB(c)].map(v => v.toString(16).padStart(2, '0')).join('');
}
function u32ToCss(c) { return `rgba(${cR(c)},${cG(c)},${cB(c)},${(cA(c) / 255).toFixed(3)})`; }
function withAlpha(c, a) { return ((c & 0x00ffffff) | (a << 24)) >>> 0; }
function sameColor(a, b) { return a === b || (cA(a) === 0 && cA(b) === 0); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}
function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
function hueToward(h, target, amount) {
  let d = ((target - h + 540) % 360) - 180;
  const step = Math.sign(d) * Math.min(Math.abs(d), amount);
  return h + step;
}
/** Rampa de sombreado con desplazamiento de tono: sombras hacia azul, luces hacia amarillo. */
function shadeRamp(c, steps = 3) {
  const [h, s, v] = rgbToHsv(cR(c), cG(c), cB(c));
  const out = [];
  for (let k = -steps; k <= steps; k++) {
    if (k === 0) { out.push(c); continue; }
    let nh, ns, nv;
    if (k < 0) {
      const t = -k;
      nh = s < 0.05 ? h : hueToward(h, 245, t * 9);
      ns = clamp(s + t * 0.06, 0, 1);
      nv = clamp(v - t * 0.16, 0.04, 1);
    } else {
      nh = s < 0.05 ? h : hueToward(h, 55, k * 9);
      ns = clamp(s - k * 0.09, 0, 1);
      nv = clamp(v + k * 0.13, 0, 1);
    }
    const [r, g, b] = hsvToRgb(nh, ns, nv);
    out.push(rgba(r, g, b, cA(c)));
  }
  return out;
}

/* ---------------- Geometría ---------------- */

function lineCells(x0, y0, x1, y1, cb) {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function rectCells(x0, y0, x1, y1, filled, cb) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1), by = Math.max(y0, y1);
  if (filled) {
    for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) cb(x, y);
    return;
  }
  for (let x = ax; x <= bx; x++) { cb(x, ay); if (by !== ay) cb(x, by); }
  for (let y = ay + 1; y < by; y++) { cb(ax, y); if (bx !== ax) cb(bx, y); }
}

/** Elipse inscrita en un rectángulo (algoritmo de A. Zingl). */
function ellipseCells(x0, y0, x1, y1, filled, cb) {
  const rows = new Map();
  const pts = [];
  const plot = (x, y) => {
    pts.push(x, y);
    const r = rows.get(y);
    if (!r) rows.set(y, [x, x]);
    else { if (x < r[0]) r[0] = x; if (x > r[1]) r[1] = x; }
  };
  let a = Math.abs(x1 - x0), b = Math.abs(y1 - y0), b1 = b & 1;
  let dx = 4 * (1 - a) * b * b, dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a, e2;
  if (x0 > x1) { x0 = x1; x1 += a; }
  if (y0 > y1) y0 = y1;
  y0 += (b + 1) >> 1; y1 = y0 - b1;
  a *= 8 * a; b1 = 8 * b * b;
  do {
    plot(x1, y0); plot(x0, y0); plot(x0, y1); plot(x1, y1);
    e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; err += dy += a; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; }
  } while (x0 <= x1);
  while (y0 - y1 <= b) {
    plot(x0 - 1, y0); plot(x1 + 1, y0++);
    plot(x0 - 1, y1); plot(x1 + 1, y1--);
  }
  if (filled) {
    for (const [y, [l, r]] of rows) for (let x = l; x <= r; x++) cb(x, y);
  } else {
    const seen = new Set();
    for (let i = 0; i < pts.length; i += 2) {
      const k = pts[i] + ',' + pts[i + 1];
      if (seen.has(k)) continue;
      seen.add(k); cb(pts[i], pts[i + 1]);
    }
  }
}

/** Ajusta una línea a ángulos "limpios" de pixel art: 0°, 1:2, 45°, 2:1, 90°. */
function snapLine(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  if (!dx && !dy) return [x1, y1];
  const ax = Math.abs(dx), ay = Math.abs(dy);
  let best = null, bestErr = Infinity;
  for (const [ux, uy] of [[1, 0], [2, 1], [1, 1], [1, 2], [0, 1]]) {
    const len = Math.hypot(ux, uy);
    const err = Math.abs(ax * uy - ay * ux) / len;
    if (err < bestErr) { bestErr = err; best = [ux, uy, (ax * ux + ay * uy) / (len * len)]; }
  }
  const k = Math.max(1, Math.round(best[2]));
  return [x0 + Math.sign(dx || 1) * best[0] * k, y0 + Math.sign(dy || 1) * best[1] * k];
}

function squareEnd(x0, y0, x1, y1) {
  const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  return [x0 + Math.sign(x1 - x0 || 1) * s, y0 + Math.sign(y1 - y0 || 1) * s];
}

const _brushCache = new Map();
function brushOffsets(size, round) {
  const key = size + (round ? 'r' : 's');
  if (_brushCache.has(key)) return _brushCache.get(key);
  const out = [], off = Math.floor((size - 1) / 2), c = (size - 1) / 2, r2 = (size / 2 - 0.25) ** 2;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    if (round && size > 2 && (i - c) ** 2 + (j - c) ** 2 > r2) continue;
    out.push([i - off, j - off]);
  }
  _brushCache.set(key, out);
  return out;
}

/* ---------------- Datos de imagen ---------------- */

function u32ToCanvas(data, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)), w, h), 0, 0);
  return c;
}
function imageToU32(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  return { w, h, data: new Uint32Array(d.buffer.slice(0)) };
}
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

/* ---------------- DOM ---------------- */

function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) if (c != null && c !== false) e.append(c);
  return e;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function uid() { return Math.random().toString(36).slice(2, 10); }

function normalizeText(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
