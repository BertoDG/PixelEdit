'use strict';
/* =========================================================================
 * Convertidor de imagen → pixel art.
 *  1. Reducción de tamaño (color dominante por bloque, o promedio)
 *  2. Ajustes de saturación y contraste
 *  3. Quitar fondo (relleno desde los bordes con tolerancia)
 *  4. Reducción de colores (k-means) o ajuste a la paleta actual
 *  5. Tramado opcional (ordenado o Floyd–Steinberg)
 *  6. Contorno opcional
 * ========================================================================= */

const CONVERT_DEFAULTS = {
  width: 64, colors: 16, palette: 'auto', mode: 'sharp', dither: 'none',
  saturation: 110, contrast: 105, removeBg: false, bgTolerance: 40, outline: false, cleanup: true,
};

/** Generador pseudoaleatorio con semilla (resultados estables entre ajustes). */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const colorDist = (r1, g1, b1, r2, g2, b2) => {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
};

/** Carga una imagen limitando su tamaño (para que el proceso sea rápido). */
function sourceFromImage(img, max = 1024) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  const s = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return { w, h, data: new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer.slice(0)) };
}

/** Reduce a tw×th. Devuelve Float32Array RGBA (0–255). */
function downscale(src, tw, th, mode) {
  const out = new Float32Array(tw * th * 4);
  const sx = src.w / tw, sy = src.h / th;
  for (let ty = 0; ty < th; ty++) {
    const y0 = Math.floor(ty * sy), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * sy));
    for (let tx = 0; tx < tw; tx++) {
      const x0 = Math.floor(tx * sx), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * sx));
      let n = 0, nt = 0, r = 0, g = 0, b = 0, a = 0;
      const buckets = mode === 'sharp' ? new Map() : null;
      for (let y = y0; y < y1 && y < src.h; y++) {
        for (let x = x0; x < x1 && x < src.w; x++) {
          const c = src.data[y * src.w + x], al = c >>> 24;
          n++;
          if (al < 128) { nt++; continue; }
          if (buckets) {
            const k = ((c & 0xf0) << 4) | ((c >>> 8) & 0xf0) | (((c >>> 16) & 0xf0) >> 4);
            let e = buckets.get(k);
            if (!e) buckets.set(k, e = [0, 0, 0, 0]);
            e[0]++; e[1] += c & 255; e[2] += (c >>> 8) & 255; e[3] += (c >>> 16) & 255;
          } else {
            r += (c & 255) * al; g += ((c >>> 8) & 255) * al; b += ((c >>> 16) & 255) * al; a += al;
          }
        }
      }
      const o = (ty * tw + tx) * 4;
      if (nt * 2 > n) continue; // mayoría transparente
      if (buckets) {
        let best = null;
        for (const e of buckets.values()) if (!best || e[0] > best[0]) best = e;
        out[o] = best[1] / best[0]; out[o + 1] = best[2] / best[0]; out[o + 2] = best[3] / best[0]; out[o + 3] = 255;
      } else if (a) {
        out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; out[o + 3] = 255;
      }
    }
  }
  return out;
}

function adjust(px, saturation, contrast) {
  const s = saturation / 100, k = contrast / 100;
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    let r = px[i], g = px[i + 1], b = px[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s;
    px[i] = clamp((r - 128) * k + 128, 0, 255);
    px[i + 1] = clamp((g - 128) * k + 128, 0, 255);
    px[i + 2] = clamp((b - 128) * k + 128, 0, 255);
  }
}

/** Vuelve transparente el fondo conectado con los bordes. */
function removeBackground(px, w, h, tol) {
  // color de referencia: el más frecuente del borde
  const counts = new Map();
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  for (const i of border) {
    if (!px[i * 4 + 3]) continue;
    const k = ((px[i * 4] >> 4) << 8) | ((px[i * 4 + 1] >> 4) << 4) | (px[i * 4 + 2] >> 4);
    const e = counts.get(k) || [0, 0, 0, 0];
    e[0]++; e[1] += px[i * 4]; e[2] += px[i * 4 + 1]; e[3] += px[i * 4 + 2];
    counts.set(k, e);
  }
  let ref = null;
  for (const e of counts.values()) if (!ref || e[0] > ref[0]) ref = e;
  if (!ref) return;
  const rr = ref[1] / ref[0], rg = ref[2] / ref[0], rb = ref[3] / ref[0];
  const t2 = tol * tol * 9;
  const near = i => px[i * 4 + 3] && colorDist(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], rr, rg, rb) <= t2;
  const seen = new Uint8Array(w * h), stack = [];
  for (const i of border) if (!seen[i] && near(i)) { seen[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    px[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) if (j >= 0 && !seen[j] && near(j)) { seen[j] = 1; stack.push(j); }
  }
}

/** k-means++ sobre los píxeles opacos. Devuelve [[r,g,b], ...]. */
function kmeans(px, k) {
  const pts = [];
  for (let i = 0; i < px.length; i += 4) if (px[i + 3]) pts.push(px[i], px[i + 1], px[i + 2]);
  const n = pts.length / 3;
  if (!n) return [];
  const rand = mulberry32(12345);
  k = Math.min(k, n);
  const cent = [];
  let idx = Math.floor(rand() * n);
  cent.push([pts[idx * 3], pts[idx * 3 + 1], pts[idx * 3 + 2]]);
  const d = new Float64Array(n).fill(Infinity);
  while (cent.length < k) {
    const c = cent[cent.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dd = colorDist(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], c[0], c[1], c[2]);
      if (dd < d[i]) d[i] = dd;
      sum += d[i];
    }
    if (!sum) break;
    let r = rand() * sum;
    for (idx = 0; idx < n - 1 && (r -= d[idx]) > 0; idx++);
    cent.push([pts[idx * 3], pts[idx * 3 + 1], pts[idx * 3 + 2]]);
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < 10; it++) {
    const acc = cent.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < cent.length; c++) {
        const dd = colorDist(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], cent[c][0], cent[c][1], cent[c][2]);
        if (dd < bd) { bd = dd; best = c; }
      }
      assign[i] = best;
      const a = acc[best]; a[0] += pts[i * 3]; a[1] += pts[i * 3 + 1]; a[2] += pts[i * 3 + 2]; a[3]++;
    }
    let moved = false;
    cent.forEach((c, j) => {
      const a = acc[j];
      if (!a[3]) return;
      const nc = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
      if (Math.abs(nc[0] - c[0]) + Math.abs(nc[1] - c[1]) + Math.abs(nc[2] - c[2]) > 0.5) moved = true;
      cent[j] = nc;
    });
    if (!moved) break;
  }
  return cent.map(c => c.map(v => Math.round(v)));
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Asigna cada píxel al color más cercano de la paleta (con tramado opcional). */
function mapToPalette(px, w, h, pal, dither) {
  const out = new Uint32Array(w * h);
  const nearest = (r, g, b) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const dd = colorDist(r, g, b, pal[i][0], pal[i][1], pal[i][2]);
      if (dd < bd) { bd = dd; best = i; }
    }
    return best;
  };
  const spread = 160 / Math.cbrt(pal.length);
  const buf = dither === 'fs' ? Float32Array.from(px) : px;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4;
    if (!buf[o + 3]) continue;
    let r = buf[o], g = buf[o + 1], b = buf[o + 2];
    if (dither === 'ordered') {
      const t = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * spread;
      r += t; g += t; b += t;
    }
    const c = pal[nearest(r, g, b)];
    out[i] = rgba(c[0], c[1], c[2], 255);
    if (dither === 'fs') {
      const er = r - c[0], eg = g - c[1], eb = b - c[2];
      const push = (xx, yy, f) => {
        if (xx < 0 || xx >= w || yy >= h) return;
        const q = (yy * w + xx) * 4;
        if (!buf[q + 3]) return;
        buf[q] += er * f; buf[q + 1] += eg * f; buf[q + 2] += eb * f;
      };
      push(x + 1, y, 7 / 16); push(x - 1, y + 1, 3 / 16); push(x, y + 1, 5 / 16); push(x + 1, y + 1, 1 / 16);
    }
  }
  return out;
}

/** Sustituye píxeles aislados por el color que los rodea (limpia el ruido de las fotos). */
function cleanupStray(data, w, h) {
  for (let pass = 0; pass < 2; pass++) {
    const src = data.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, c = src[i];
      if (!cA(c)) continue;
      const nb = [];
      if (x > 0) nb.push(src[i - 1]); if (x < w - 1) nb.push(src[i + 1]);
      if (y > 0) nb.push(src[i - w]); if (y < h - 1) nb.push(src[i + w]);
      if (nb.some(n => n === c)) continue;
      const count = new Map();
      for (const n of nb) if (cA(n)) count.set(n, (count.get(n) || 0) + 1);
      let best = null, bc = 0;
      for (const [n, k] of count) if (k > bc) { best = n; bc = k; }
      if (best !== null && bc >= 3) data[i] = best;
    }
  }
}

function addOutline(data, w, h, color) {
  const src = data.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (cA(src[i])) continue;
    if ((x > 0 && cA(src[i - 1])) || (x < w - 1 && cA(src[i + 1])) ||
        (y > 0 && cA(src[i - w])) || (y < h - 1 && cA(src[i + w]))) data[i] = color;
  }
}

/** Proceso completo. */
function convertToPixelArt(src, o) {
  const tw = clamp(Math.round(o.width), 4, 512);
  const th = Math.max(1, Math.round(tw * src.h / src.w));
  const px = downscale(src, tw, th, o.mode);
  adjust(px, o.saturation, o.contrast);
  if (o.removeBg) removeBackground(px, tw, th, o.bgTolerance);
  const pal = o.palette === 'current' ? S.palette.filter(c => cA(c)).map(c => [cR(c), cG(c), cB(c)])
    : o.palette === 'fixed' && o.fixed ? o.fixed.map(c => { const u = hexToU32(c); return [cR(u), cG(u), cB(u)]; })
    : kmeans(px, o.colors);
  const data = pal.length ? mapToPalette(px, tw, th, pal, o.dither) : new Uint32Array(tw * th);
  if (o.cleanup) cleanupStray(data, tw, th);
  if (o.outline && pal.length) {
    let dark = pal[0];
    for (const c of pal) if (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11 < dark[0] * 0.3 + dark[1] * 0.59 + dark[2] * 0.11) dark = c;
    addOutline(data, tw, th, rgba(dark[0], dark[1], dark[2]));
  }
  const used = [...new Set(data.filter(c => cA(c)))];
  return { w: tw, h: th, data, colors: used };
}

/* ---------------- Diálogo ---------------- */

async function convertFromFileDialog() {
  const fi = $('#file-input');
  fi.accept = 'image/*';
  fi.onchange = async () => {
    const f = fi.files[0];
    fi.value = '';
    if (f) openConverter(await fileToImage(f), f.name.replace(/\.[a-z0-9]+$/i, ''));
  };
  fi.click();
}

async function fileToImage(file) {
  const url = URL.createObjectURL(file);
  try { return await loadImage(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/* ---------------- Estilos predefinidos ---------------- */

const CONVERT_STYLES = [
  { id: 'balanced', name: 'Equilibrado', desc: 'Fiel a la imagen, 16 colores',
    opts: { width: 64, colors: 16, mode: 'sharp', dither: 'none', saturation: 110, contrast: 105, cleanup: true } },
  { id: 'sprite', name: 'Sprite de juego', desc: 'Pequeño, sin fondo, con contorno',
    opts: { width: 32, colors: 8, mode: 'sharp', dither: 'none', saturation: 130, contrast: 115, removeBg: true, outline: true, cleanup: true } },
  { id: 'icon', name: 'Icono mini', desc: '16 px, pocos colores muy vivos',
    opts: { width: 16, colors: 6, mode: 'sharp', dither: 'none', saturation: 150, contrast: 120, removeBg: true, outline: true, cleanup: true } },
  { id: 'scene', name: 'Escenario', desc: 'Grande, muchos colores, para fondos',
    opts: { width: 128, colors: 32, mode: 'sharp', dither: 'none', saturation: 115, contrast: 108, cleanup: true } },
  { id: 'retro8', name: 'Retro con trama', desc: '8 colores y patrón clásico',
    opts: { width: 80, colors: 8, mode: 'smooth', dither: 'ordered', saturation: 120, contrast: 110, cleanup: false } },
  { id: 'green', name: 'Portátil verde', desc: '4 tonos de verde, estilo consola clásica',
    opts: { width: 64, palette: 'fixed', fixed: ['#1c2a1b', '#3f6b34', '#8db04c', '#d6e6a3'], mode: 'smooth', dither: 'ordered', saturation: 100, contrast: 115, cleanup: true } },
  { id: 'onebit', name: '1 bit', desc: 'Blanco y negro con trama difusa',
    opts: { width: 96, palette: 'fixed', fixed: ['#16141e', '#efe9d6'], mode: 'smooth', dither: 'fs', saturation: 100, contrast: 120, cleanup: false } },
  { id: 'pastel', name: 'Pastel', desc: 'Suave y luminoso',
    opts: { width: 48, colors: 12, mode: 'smooth', dither: 'none', saturation: 65, contrast: 85, cleanup: true } },
  { id: 'vivid', name: 'Colores vivos', desc: 'Saturado y con mucho contraste',
    opts: { width: 64, colors: 20, mode: 'sharp', dither: 'none', saturation: 170, contrast: 130, cleanup: true } },
  { id: 'sepia', name: 'Sepia', desc: 'Foto antigua en marrones',
    opts: { width: 72, palette: 'fixed', fixed: ['#2b1d14', '#5a3d26', '#8c6640', '#c09a68', '#ead7ad'], mode: 'smooth', dither: 'fs', saturation: 100, contrast: 110, cleanup: false } },
  { id: 'night', name: 'Noche', desc: 'Azules fríos y luces cálidas',
    opts: { width: 64, palette: 'fixed', fixed: ['#0b0d1f', '#1b2350', '#30448a', '#4f73c4', '#8fb6ec', '#f2d27a', '#fff4c9'], mode: 'sharp', dither: 'ordered', saturation: 100, contrast: 115, cleanup: true } },
];

function styleOptions(style) {
  return { ...CONVERT_DEFAULTS, palette: 'auto', fixed: null, removeBg: false, outline: false, ...style.opts };
}

/**
 * @param img   HTMLImageElement
 * @param name  nombre base
 * @param allowRaw  muestra "Abrir sin convertir" (al abrir una imagen grande)
 */
function openConverter(img, name = 'imagen', allowRaw = false) {
  const src = sourceFromImage(img);
  const small = sourceFromImage(img, 320); // para las miniaturas de estilos
  let styleId = S.convertStyle || 'balanced';
  let o = S.convertOpts ? { ...CONVERT_DEFAULTS, ...S.convertOpts } : styleOptions(CONVERT_STYLES[0]);
  let result = null, timer = 0;

  const preview = h('canvas', { class: 'cv-preview' });
  const info = h('div', { class: 'muted cv-info' });
  const original = h('img', { class: 'cv-original', src: img.src, alt: 'Original' });
  const toggleOrig = h('button', { type: 'button', class: 'chip', onclick: () => {
    const show = original.style.display !== 'block';
    original.style.display = show ? 'block' : 'none';
    preview.style.display = show ? 'none' : 'block';
    toggleOrig.classList.toggle('on', show);
  } }, 'Ver original');

  /* Galería de estilos: cada miniatura es la propia imagen convertida */
  const gallery = h('div', { class: 'cv-styles' });
  const cards = CONVERT_STYLES.map(st => {
    const cv = h('canvas', { class: 'cv-thumb' });
    const card = h('button', {
      type: 'button', class: 'cv-style', title: st.desc,
      onclick: () => { styleId = st.id; o = styleOptions(st); buildControls(); markActive(); render(); },
    }, h('div', { class: 'cv-thumb-box' }, cv), h('span', {}, st.name));
    card._canvas = cv; card._style = st;
    gallery.append(card);
    return card;
  });
  const markActive = () => cards.forEach(c => c.classList.toggle('on', c._style.id === styleId));
  // Las miniaturas se calculan poco a poco para que el diálogo aparezca al instante
  let qi = 0;
  const nextThumb = () => {
    if (qi >= cards.length || !document.body.contains(gallery)) return;
    const card = cards[qi++], so = styleOptions(card._style);
    so.width = Math.min(so.width, small.w);
    const r = convertToPixelArt(small, so);
    card._canvas.width = r.w; card._canvas.height = r.h;
    card._canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data.buffer.slice(0)), r.w, r.h), 0, 0);
    setTimeout(nextThumb, 0);
  };

  /* Controles finos (se reconstruyen al elegir un estilo) */
  const controls = h('div', { class: 'cv-right' });
  const customize = () => { if (styleId !== 'custom') { styleId = 'custom'; markActive(); } };
  let sync = () => {};
  const buildControls = () => {
    const slider = (label, key, min, max, step = 1, fmt = v => v) => {
      const val = h('span', { class: 'cv-val' }, fmt(o[key]));
      const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(o[key]) });
      input.addEventListener('input', () => { o[key] = +input.value; val.textContent = fmt(o[key]); customize(); schedule(); });
      return h('label', { class: 'cv-row' }, h('span', {}, label), input, val);
    };
    const select = (label, key, options) => {
      const sel = h('select', {}, options.map(([v, l]) => h('option', { value: v, selected: o[key] === v }, l)));
      sel.addEventListener('change', () => { o[key] = sel.value; customize(); sync(); schedule(); });
      return h('label', { class: 'cv-row' }, h('span', {}, label), sel);
    };
    const check = (label, key) => {
      const cb = h('input', { type: 'checkbox', checked: !!o[key] });
      cb.addEventListener('change', () => { o[key] = cb.checked; customize(); sync(); schedule(); });
      return h('label', { class: 'check' }, cb, ' ' + label);
    };
    o.width = Math.min(o.width, src.w);
    const widthRow = slider('Ancho', 'width', 8, Math.min(256, src.w), 1, v => v + ' px');
    const sizePresets = h('div', { class: 'presets' }, [16, 24, 32, 48, 64, 96, 128].filter(n => n <= src.w).map(n =>
      h('button', { type: 'button', onclick: () => {
        o.width = n; widthRow.querySelector('input').value = n; widthRow.querySelector('.cv-val').textContent = n + ' px';
        customize(); schedule();
      } }, String(n))));
    const palOpts = [['auto', 'Automática'], ['current', 'Mi paleta actual']];
    if (o.fixed) palOpts.push(['fixed', 'La del estilo']);
    const colorsRow = slider('Colores', 'colors', 2, 64, 1);
    const tolRow = slider('Tolerancia', 'bgTolerance', 5, 120, 1);
    sync = () => {
      colorsRow.style.display = o.palette === 'auto' ? '' : 'none';
      tolRow.style.display = o.removeBg ? '' : 'none';
    };
    controls.replaceChildren(
      widthRow, sizePresets,
      select('Paleta', 'palette', palOpts),
      colorsRow,
      select('Reducción', 'mode', [['sharp', 'Nítida (color dominante)'], ['smooth', 'Suave (promedio)']]),
      select('Tramado', 'dither', [['none', 'Ninguno'], ['ordered', 'Ordenado (patrón)'], ['fs', 'Difuso (Floyd–Steinberg)']]),
      slider('Saturación', 'saturation', 0, 200, 5, v => v + '%'),
      slider('Contraste', 'contrast', 50, 160, 5, v => v + '%'),
      check('Quitar fondo', 'removeBg'), tolRow,
      check('Limpiar píxeles sueltos', 'cleanup'),
      check('Contorno oscuro', 'outline'));
    sync();
  };

  const render = () => {
    result = convertToPixelArt(src, o);
    const s = Math.max(1, Math.floor(Math.min(300 / result.w, 260 / result.h)));
    preview.width = result.w; preview.height = result.h;
    preview.style.width = result.w * s + 'px'; preview.style.height = result.h * s + 'px';
    preview.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.data.buffer.slice(0)), result.w, result.h), 0, 0);
    original.style.width = preview.style.width;
    const st = CONVERT_STYLES.find(x => x.id === styleId);
    info.textContent = `${st ? st.name : 'Personalizado'} · ${result.w}×${result.h} px · ${result.colors.length} colores`;
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 60); };

  const finish = asLayer => {
    if (!result) render();
    S.convertOpts = { ...o }; S.convertStyle = styleId;
    savePrefs();
    if (asLayer) addConvertedLayer(result, name);
    else {
      const doc = makeDoc(result.w, result.h, { layers: [new Layer(name || 'Imagen', [new Cel(result.w, result.h, result.data)])] });
      if (o.palette !== 'current' && result.colors.length) S.palette = result.colors.slice();
      replaceDoc(doc, name);
    }
    toast('Imagen convertida a pixel art');
  };

  const buttons = [{ label: 'Cancelar' }];
  if (allowRaw) buttons.push({ label: 'Abrir sin convertir', run: () => openRawImage(img, name) });
  buttons.push({ label: 'Añadir como capa', run: () => finish(true) });
  buttons.push({ label: 'Crear dibujo', primary: true, run: () => finish(false) });

  openDialog('Convertir a pixel art', [
    h('div', { class: 'cv-head' }, h('strong', {}, 'Estilo'), h('span', { class: 'muted' }, 'elige uno y ajusta a tu gusto')),
    gallery,
    h('div', { class: 'cv' },
      h('div', { class: 'cv-left' }, h('div', { class: 'cv-stage' }, preview, original), info, toggleOrig),
      controls),
  ], buttons);
  $('#overlay .dialog').classList.add('wide');
  buildControls();
  markActive();
  render();
  setTimeout(nextThumb, 30);
}

function openRawImage(img, name) {
  const { w, h, data } = imageToU32(img);
  if (w > 2048 || h > 2048) { toast('Imagen demasiado grande (máx. 2048 px)'); return false; }
  replaceDoc(makeDoc(w, h, { layers: [new Layer(name || 'Imagen', [new Cel(w, h, data)])] }), name);
}

/** Añade el resultado como capa nueva en el fotograma actual, centrado. */
function addConvertedLayer(res, name) {
  commitFloat();
  doSnap(() => {
    const d = S.doc;
    const layer = new Layer(name || 'Imagen', d.frames.map(() => new Cel(d.w, d.h)));
    const ox = Math.floor((d.w - res.w) / 2), oy = Math.floor((d.h - res.h) / 2);
    const cel = layer.cels[d.frame];
    stampBlock(cel.data, d.w, d.h, { x: ox, y: oy, w: res.w, h: res.h, data: res.data });
    cel.dirty = true;
    d.layers.splice(d.active + 1, 0, layer);
    d.active++;
  });
  if (res.w > S.doc.w || res.h > S.doc.h) toast('La imagen es más grande que el lienzo: se ha recortado');
}
