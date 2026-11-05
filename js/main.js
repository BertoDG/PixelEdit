'use strict';
/* =========================================================================
 * Aplicación: operaciones, entrada (ratón / teclado / táctil) y persistencia.
 * ========================================================================= */

let dragState = null;        // trazo en curso en el lienzo
let heldToolKey = null;      // tecla de herramienta mantenida (cambio temporal)

function currentToolId() { return dragState?.tool || S.tempTool || S.tool; }

function setTool(id) {
  if (!Tools[id]) return;
  S.tool = id;
  S.tempTool = null;
}

function setBrush(n) {
  S.brushSize = clamp(n, 1, 64);
  savePrefs();
}

/* ---------------- Documento ---------------- */

function newDoc(w, h) {
  w = clamp(Math.round(w) || 32, 1, 2048); h = clamp(Math.round(h) || 32, 1, 2048);
  stopPlayback();
  commitFloat();
  doSnap(() => { S.doc = makeDoc(w, h); S.sel = null; S.float = null; });
  S.fileName = 'sin-titulo';
  fitView();
}

function resizeCanvas(w, h, anchor = [1, 1]) {
  w = clamp(Math.round(w) || 1, 1, 2048); h = clamp(Math.round(h) || 1, 1, 2048);
  const d = S.doc;
  if (w === d.w && h === d.h) return;
  commitFloat();
  const ox = Math.round((w - d.w) * anchor[0] / 2), oy = Math.round((h - d.h) * anchor[1] / 2);
  const ow = d.w, oh = d.h;
  doSnap(() => {
    remapCels(w, h, src => {
      const out = new Uint32Array(w * h);
      for (let y = 0; y < oh; y++) {
        const ny = y + oy;
        if (ny < 0 || ny >= h) continue;
        for (let x = 0; x < ow; x++) {
          const nx = x + ox;
          if (nx >= 0 && nx < w) out[ny * w + nx] = src[y * ow + x];
        }
      }
      return out;
    });
    S.sel = null;
  });
  fitView();
}

function scaleImage(w, h) {
  w = clamp(Math.round(w) || 1, 1, 2048); h = clamp(Math.round(h) || 1, 1, 2048);
  const ow = S.doc.w, oh = S.doc.h;
  commitFloat();
  doSnap(() => {
    remapCels(w, h, src => {
      const out = new Uint32Array(w * h);
      for (let y = 0; y < h; y++) {
        const sy = Math.min(oh - 1, Math.floor(y * oh / h));
        for (let x = 0; x < w; x++) out[y * w + x] = src[sy * ow + Math.min(ow - 1, Math.floor(x * ow / w))];
      }
      return out;
    });
    S.sel = null;
  });
  fitView();
}

function contentBounds() {
  const d = S.doc;
  let x0 = d.w, y0 = d.h, x1 = -1, y1 = -1;
  for (const l of d.layers) for (const c of l.cels) {
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
      if (cA(c.data[y * d.w + x])) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function cropTo(r) {
  doSnap(() => { remapCels(r.w, r.h, (_, c) => extract(c, r)); S.sel = null; });
  fitView();
}
function cropToContent() {
  commitFloat();
  const r = contentBounds();
  if (!r) return toast('El lienzo está vacío');
  cropTo(r);
}
function cropToSelection() {
  commitFloat();
  const r = S.sel && clipRect(S.sel);
  if (!r) return toast('No hay selección');
  cropTo(r);
}

function transformCanvas(kind) {
  commitFloat();
  const d = S.doc, ow = d.w, oh = d.h, rot = kind === 'rotate';
  doSnap(() => {
    remapCels(rot ? oh : ow, rot ? ow : oh, src => (rot ? rotateData(src, ow, oh) : flipData(src, ow, oh, kind === 'flipH')));
    S.sel = null;
  });
  if (rot) fitView();
}

/* ---------------- Selección / portapapeles ---------------- */

function deselect() {
  stopPlayback();
  if (S.float) commitFloat();
  S.sel = null;
}

function selectionPixels() {
  if (S.float) return { ...S.float, data: S.float.data.slice() };
  const r = S.sel ? clipRect(S.sel) : { x: 0, y: 0, w: S.doc.w, h: S.doc.h };
  if (!r) return null;
  return { ...r, data: extract(activeCel(), r) };
}

function copySel() {
  const c = selectionPixels();
  if (!c) return;
  S.clipboard = c;
  toast(`Copiado ${c.w}×${c.h}`);
  try {
    u32ToCanvas(c.data, c.w, c.h).toBlob(b => {
      if (b && navigator.clipboard?.write && window.ClipboardItem) {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).catch(() => {});
      }
    });
  } catch (_) { /* el portapapeles del sistema es opcional */ }
}

function cutSel() { copySel(); deleteSel(); }

function deleteSel() {
  if (S.float) { doCelSnap(() => { S.float = null; }); return; }
  if (S.sel) {
    const r = clipRect(S.sel);
    if (!r) return;
    const ed = beginEdit();
    if (!ed) return;
    clearRegion(ed.cel, r);
    endEdit();
    return;
  }
  const ed = beginEdit();
  if (!ed) return;
  ed.cel.data.fill(0); ed.cel.dirty = true;
  endEdit();
  toast('Capa vaciada en este fotograma');
}

function pasteBlock(c) {
  commitFloat();
  if (!editable()) return;
  doCelSnap(() => {
    let { x, y } = c;
    if (x == null || x + c.w > S.doc.w || y + c.h > S.doc.h || x < 0 || y < 0) {
      // centra en la vista si no cabe en su posición original
      const r = viewCanvas.getBoundingClientRect();
      const center = screenToDoc(r.left + r.width / 2, r.top + r.height / 2);
      x = clamp(center.x - (c.w >> 1), Math.min(0, S.doc.w - c.w), Math.max(0, S.doc.w - c.w));
      y = clamp(center.y - (c.h >> 1), Math.min(0, S.doc.h - c.h), Math.max(0, S.doc.h - c.h));
    }
    S.float = { x, y, w: c.w, h: c.h, data: c.data.slice() };
    S.sel = { x, y, w: c.w, h: c.h };
    S.floatDirty = true;
  });
  setTool('move');
  toast(S.mobile ? 'Pegado · arrastra para colocar · "Fijar" para terminar' : 'Pegado · arrastra para colocar · Intro para fijar');
}

async function pasteFromCommand() {
  try {
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const type = it.types.find(t => t.startsWith('image/'));
        if (type) { await pasteImageBlob(await it.getType(type)); refreshAll(); return; }
      }
    }
  } catch (_) { /* sin permiso: usamos el portapapeles interno */ }
  if (S.clipboard) { pasteBlock(S.clipboard); refreshAll(); }
  else toast('El portapapeles está vacío');
}

async function pasteImageBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const { w, h, data } = imageToU32(img);
    const cb = S.clipboard;
    if (cb && cb.w === w && cb.h === h && cb.data.every((v, i) => sameColor(v, data[i]))) pasteBlock(cb);
    else pasteBlock({ w, h, data });
  } finally { URL.revokeObjectURL(url); }
}

function nudge(dx, dy) {
  if (S.sel || S.float) {
    doCelSnap(() => {
      if (!liftSel()) return false;
      S.float.x += dx; S.float.y += dy;
      S.sel.x = S.float.x; S.sel.y = S.float.y;
    });
  } else {
    const ed = beginEdit();
    if (!ed) return;
    shiftCel(ed.cel, ed.before, dx, dy);
    endEdit();
  }
}

function flipSel(horiz) {
  if (S.tool === 'stamp' && S.stamp && !S.sel) {
    S.stamp = { ...S.stamp, data: flipData(S.stamp.data, S.stamp.w, S.stamp.h, horiz) };
    return toast('Sello volteado');
  }
  if (!S.sel && !S.float) {
    const ed = beginEdit();
    if (!ed) return;
    ed.cel.setData(flipData(ed.before, S.doc.w, S.doc.h, horiz));
    endEdit();
    return;
  }
  doCelSnap(() => {
    if (!liftSel()) return false;
    S.float.data = flipData(S.float.data, S.float.w, S.float.h, horiz);
    S.floatDirty = true;
  });
}

function rotateSel() {
  if (S.tool === 'stamp' && S.stamp && !S.sel) {
    const st = S.stamp;
    S.stamp = { w: st.h, h: st.w, data: rotateData(st.data, st.w, st.h) };
    return toast('Sello rotado');
  }
  if (!S.sel && !S.float) {
    if (S.doc.w === S.doc.h) {
      const ed = beginEdit();
      if (!ed) return;
      ed.cel.setData(rotateData(ed.before, S.doc.w, S.doc.h));
      endEdit();
    } else transformCanvas('rotate');
    return;
  }
  doCelSnap(() => {
    if (!liftSel()) return false;
    const f = S.float;
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    f.data = rotateData(f.data, f.w, f.h);
    [f.w, f.h] = [f.h, f.w];
    f.x = Math.round(cx - f.w / 2); f.y = Math.round(cy - f.h / 2);
    S.sel = { x: f.x, y: f.y, w: f.w, h: f.h };
    S.floatDirty = true;
  });
}

/* ---------------- Sello ---------------- */

function stampFromSelection() {
  const c = selectionPixels();
  if (!c || !S.sel) return toast('Primero selecciona algo (M)');
  if (!c.data.some(v => cA(v))) return toast('La selección está vacía');
  S.stamp = { w: c.w, h: c.h, data: c.data };
  commitFloat();
  S.sel = null;
  setTool('stamp');
  toast(`Sello de ${c.w}×${c.h} listo`);
}

function grabTileAsStamp(p) {
  const tw = S.tileGrid ? S.tileW : 16, th = S.tileGrid ? S.tileH : 16;
  const r = clipRect({ x: Math.floor(p.x / tw) * tw, y: Math.floor(p.y / th) * th, w: tw, h: th });
  if (!r) return;
  const tmp = frameData(S.doc.frame), w = S.doc.w, data = new Uint32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) data.set(tmp.subarray((r.y + y) * w + r.x, (r.y + y) * w + r.x + r.w), y * r.w);
  S.stamp = { w: r.w, h: r.h, data };
  toast(`Tile ${r.w}×${r.h} copiado como sello`);
}

/* ---------------- Capas ---------------- */

function selectLayer(i) {
  if (i < 0 || i >= S.doc.layers.length || i === S.doc.active) return;
  commitFloat();
  S.doc.active = i;
}
function addLayer() {
  commitFloat();
  doSnap(() => {
    const d = S.doc;
    d.layers.splice(d.active + 1, 0, new Layer('Capa ' + (d.layers.length + 1), d.frames.map(() => new Cel(d.w, d.h))));
    d.active++;
  });
}
function duplicateLayer() {
  commitFloat();
  doSnap(() => {
    const d = S.doc, l = activeLayer();
    const c = new Layer(l.name + ' copia', l.cels.map(cel => new Cel(d.w, d.h, cel.data.slice())));
    c.opacity = l.opacity; c.visible = l.visible;
    d.layers.splice(d.active + 1, 0, c);
    d.active++;
  });
}
function deleteLayer() {
  commitFloat();
  const d = S.doc;
  if (d.layers.length <= 1) return toast('Es la única capa');
  doSnap(() => {
    d.layers.splice(d.active, 1);
    d.active = Math.max(0, d.active - 1);
  });
}
function moveLayer(dir) {
  commitFloat();
  const d = S.doc, j = d.active + dir;
  if (j < 0 || j >= d.layers.length) return;
  doSnap(() => {
    [d.layers[d.active], d.layers[j]] = [d.layers[j], d.layers[d.active]];
    d.active = j;
  });
}
function mergeDown() {
  commitFloat();
  const d = S.doc;
  if (d.active === 0) return toast('No hay capa debajo');
  doSnap(() => {
    const top = d.layers[d.active], bottom = d.layers[d.active - 1];
    const c = h('canvas', { width: d.w, height: d.h }), ctx = c.getContext('2d', { willReadFrequently: true });
    bottom.cels.forEach((bc, f) => {
      const tc = top.cels[f];
      bc.sync(); tc.sync();
      ctx.globalAlpha = 1; ctx.clearRect(0, 0, d.w, d.h);
      ctx.globalAlpha = bottom.visible ? bottom.opacity : 0; ctx.drawImage(bc.canvas, 0, 0);
      ctx.globalAlpha = top.visible ? top.opacity : 0; ctx.drawImage(tc.canvas, 0, 0);
      bc.setData(new Uint32Array(ctx.getImageData(0, 0, d.w, d.h).data.buffer));
    });
    bottom.opacity = 1; bottom.visible = true;
    d.layers.splice(d.active, 1);
    d.active--;
  });
}

/* ---------------- Paleta ---------------- */

function paletteFromImage() {
  const set = new Set();
  for (const l of S.doc.layers) for (const cel of l.cels) for (const c of cel.data) if (cA(c)) set.add(withAlpha(c, 255));
  if (!set.size) return toast('El dibujo no tiene colores');
  if (set.size > 256) return toast(`Demasiados colores (${set.size}); máximo 256`);
  S.palette = [...set].sort((a, b) => {
    const [h1, , v1] = rgbToHsv(cR(a), cG(a), cB(a)), [h2, , v2] = rgbToHsv(cR(b), cG(b), cB(b));
    return Math.round(h1 / 30) - Math.round(h2 / 30) || v1 - v2;
  });
  savePrefs();
  toast(`Paleta con ${set.size} colores`);
}

function exportPalette() {
  const txt = S.palette.map(c => u32ToHex(c).slice(1)).join('\n');
  deliver(new Blob([txt], { type: 'text/plain' }), `${S.fileName}-paleta.hex`);
}

async function importPalette(file) {
  let colors = [];
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    const { data } = imageToU32(await loadImage(url));
    URL.revokeObjectURL(url);
    const set = new Set();
    for (const c of data) if (cA(c)) set.add(withAlpha(c, 255));
    colors = [...set].slice(0, 256);
  } else {
    const txt = await file.text();
    for (const line of txt.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith(';') || (t.startsWith('#') && !/^#[0-9a-f]{6}\b/i.test(t))) continue;
      const gpl = t.match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
      if (gpl) { colors.push(rgba(+gpl[1], +gpl[2], +gpl[3])); continue; }
      const hex = t.match(/^#?([0-9a-f]{6})\b/i);
      if (hex) colors.push(hexToU32(hex[1]));
    }
  }
  if (!colors.length) return toast('No se encontraron colores');
  S.palette = colors;
  savePrefs(); refreshAll();
  toast(`Paleta importada (${colors.length} colores)`);
}

/* ---------------- Vista ---------------- */

function togglePanels() {
  if (S.mobile) return closeSheet();
  S.panels = !S.panels;
  $('#app').classList.toggle('focus', !S.panels);
  savePrefs();
}

/* ---------------- Archivos ---------------- */

function celPNG(cel, li, fi) {
  const d = S.doc;
  if (S.float && li === d.active && fi === d.frame) {
    const copy = cel.data.slice();
    stampBlock(copy, d.w, d.h, S.float);
    return u32ToCanvas(copy, d.w, d.h).toDataURL('image/png');
  }
  cel.sync();
  if (cel._pngV !== cel.version) { cel._png = cel.canvas.toDataURL('image/png'); cel._pngV = cel.version; }
  return cel._png;
}

function serialize() {
  const d = S.doc;
  return {
    app: 'PixelEdit', version: 2, w: d.w, h: d.h, active: d.active, frame: d.frame, name: S.fileName,
    frames: d.frames.map(f => ({ duration: f.duration })),
    layers: d.layers.map((l, li) => ({
      name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked,
      cels: l.cels.map((c, fi) => celPNG(c, li, fi)),
    })),
    palette: S.palette.map(u32ToHex),
    tile: { w: S.tileW, h: S.tileH },
  };
}

async function deserialize(obj) {
  if (!obj || !obj.layers || !obj.w || !obj.h) throw new Error('Archivo no válido');
  const frames = (obj.frames || [{ duration: 100 }]).map(f => makeFrame(f.duration || 100));
  const layers = [];
  for (const o of obj.layers) {
    const srcs = o.cels || [o.png]; // v1: una imagen por capa
    const cels = [];
    for (let i = 0; i < frames.length; i++) {
      const src = srcs[i];
      cels.push(new Cel(obj.w, obj.h, src ? imageToU32(await loadImage(src)).data : undefined));
    }
    const l = new Layer(o.name || 'Capa', cels);
    l.visible = o.visible !== false; l.opacity = o.opacity ?? 1; l.locked = !!o.locked;
    layers.push(l);
  }
  const doc = makeDoc(obj.w, obj.h, { layers, frames });
  doc.active = clamp(obj.active || 0, 0, layers.length - 1);
  doc.frame = clamp(obj.frame || 0, 0, frames.length - 1);
  return doc;
}

function replaceDoc(doc, name) {
  stopPlayback();
  commitFloat();
  doSnap(() => { S.doc = doc; S.sel = null; S.float = null; });
  if (name) S.fileName = name;
  fitView();
  refreshAll();
}

function saveProject() {
  const blob = new Blob([JSON.stringify(serialize())], { type: 'application/json' });
  deliver(blob, `${S.fileName}.pixeledit.json`);
  toast('Proyecto guardado');
}

function openFileDialog(mode) {
  const fi = $('#file-input');
  fi.accept = mode === 'palette' ? '.hex,.gpl,.txt,image/*' : '.json,image/*';
  fi.onchange = async () => {
    const f = fi.files[0];
    fi.value = '';
    if (!f) return;
    if (mode === 'palette') await importPalette(f);
    else await openFile(f);
  };
  fi.click();
}

async function openFile(file) {
  const base = file.name.replace(/\.pixeledit\.json$|\.json$|\.[a-z0-9]+$/i, '');
  try {
    if (/\.json$/i.test(file.name) || file.type === 'application/json') {
      const obj = JSON.parse(await file.text());
      const doc = await deserialize(obj);
      if (obj.palette?.length) S.palette = obj.palette.map(c => hexToU32(c)).filter(c => c != null);
      if (obj.tile) { S.tileW = obj.tile.w; S.tileH = obj.tile.h; }
      replaceDoc(doc, obj.name || base);
      toast('Proyecto abierto');
    } else if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      const { w, h, data } = imageToU32(img);
      if (w > 2048 || h > 2048) return toast('Imagen demasiado grande (máx. 2048 px)');
      replaceDoc(makeDoc(w, h, { layers: [new Layer(base || 'Imagen', [new Cel(w, h, data)])] }), base);
      toast(`Imagen abierta ${w}×${h}`);
    } else toast('Formato no soportado');
  } catch (err) {
    console.error(err);
    toast('No se pudo abrir el archivo');
  }
}

/* ---------------- Persistencia local ---------------- */

const PREFS_KEY = 'pixeledit.prefs';
const IDB = {
  db: null,
  open() {
    if (!this.db) {
      this.db = new Promise((res, rej) => {
        const r = indexedDB.open('pixeledit', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return this.db;
  },
  async get(k) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  },
  async set(k, v) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite');
      t.objectStore('kv').put(v, k);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  },
};

let prefsTimer = null, autosaveTimer = null;
const PREF_KEYS = ['brushSize', 'brushRound', 'pixelPerfect', 'fillShapes', 'grid', 'tileGrid', 'tileW', 'tileH',
  'panels', 'timeline', 'onion', 'stampSnap', 'exportScale', 'exportFormat', 'sheetCols', 'recentCmds'];
const hex8 = c => u32ToHex(c) + cA(c).toString(16).padStart(2, '0');

function savePrefs(now = false) {
  clearTimeout(prefsTimer);
  const write = () => {
    const p = { palette: S.palette.map(u32ToHex), recent: S.recent.map(hex8), primary: hex8(S.primary), secondary: hex8(S.secondary) };
    for (const k of PREF_KEYS) p[k] = S[k];
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (_) {}
  };
  if (now) write(); else prefsTimer = setTimeout(write, 300);
}

function loadPrefs() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null'); } catch (_) {}
  S.palette = DEFAULT_PALETTE.slice();
  if (!p) return;
  const pal = (p.palette || []).map(c => hexToU32(c)).filter(c => c != null);
  if (pal.length) S.palette = pal;
  S.recent = (p.recent || []).map(c => hexToU32(c)).filter(c => c != null);
  for (const k of PREF_KEYS) if (p[k] !== undefined) S[k] = p[k];
  if (p.primary) S.primary = hexToU32(p.primary) ?? S.primary;
  if (p.secondary) S.secondary = hexToU32(p.secondary) ?? S.secondary;
}

function markModified() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, 1200);
}
async function autosave() {
  clearTimeout(autosaveTimer);
  if (!S.doc) return;
  try {
    await IDB.set('autosave', JSON.stringify(serialize()));
    S.savedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (err) {
    console.warn(err);
    S.savedAt = '(no se pudo autoguardar)';
  }
  updateStatus();
}

async function loadAutosave() {
  try {
    let txt = await IDB.get('autosave').catch(() => null);
    if (!txt) txt = localStorage.getItem('pixeledit.autosave'); // versión anterior
    if (!txt) return false;
    const obj = JSON.parse(txt);
    S.doc = await deserialize(obj);
    S.fileName = obj.name || 'sin-titulo';
    if (obj.tile) { S.tileW = obj.tile.w; S.tileH = obj.tile.h; }
    return true;
  } catch (err) {
    console.warn('Autoguardado no válido', err);
    return false;
  }
}

/* ---------------- Entrada: ratón, lápiz y táctil ---------------- */

const touchPts = new Map();
let gesture = null, longPressTimer = 0;
const DEFERRED_ON_TOUCH = new Set(['bucket']);     // se aplican al levantar el dedo
const LONG_PRESS_TOOLS = new Set(['pencil', 'eraser', 'dither', 'line', 'rect', 'ellipse', 'bucket', 'stamp']);

function initPointer() {
  const cv = viewCanvas;
  cv.addEventListener('contextmenu', e => e.preventDefault());

  cv.addEventListener('pointerdown', e => {
    if (S.modal) return;
    stopPlayback();
    closeSheet();
    const isTouch = e.pointerType === 'touch';
    if (isTouch) {
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchPts.size >= 2) {
        if (dragState?.touch) {
          // segundo dedo poco después del primero: era un gesto, no un trazo
          if (performance.now() - dragState.t0 < 350 || dragState.tool === 'pan' || dragState.deferred) cancelDrag(true);
          else return;
        }
        startGesture();
        return;
      }
      if (gesture) return;
    }
    if (dragState) return;
    const btn = e.button;
    if (btn !== 0 && btn !== 1 && btn !== 2) return;
    cv.setPointerCapture(e.pointerId);
    const toolId = btn === 1 ? 'pan' : currentToolId();
    const p = screenToDoc(e.clientX, e.clientY);
    dragState = { tool: toolId, btn, pointerId: e.pointerId, last: p, touch: isTouch, t0: performance.now(), sx: e.clientX, sy: e.clientY };
    if (heldToolKey) heldToolKey.used = true;
    if (isTouch && DEFERRED_ON_TOUCH.has(toolId)) dragState.deferred = { p, e: pickEvent(e) };
    else Tools[toolId].down(p, e, btn);
    if (isTouch && LONG_PRESS_TOOLS.has(toolId)) {
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => longPressPick(e.pointerId), 480);
    }
    S.hover = isTouch ? null : p;
    requestRender(); updateStatus();
    e.preventDefault();
  });

  cv.addEventListener('pointermove', e => {
    const isTouch = e.pointerType === 'touch';
    if (isTouch && touchPts.has(e.pointerId)) {
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gesture) { updateGesture(); return; }
    }
    const p = screenToDoc(e.clientX, e.clientY);
    const moved = !S.hover || S.hover.x !== p.x || S.hover.y !== p.y;
    if (!isTouch) S.hover = p;
    if (dragState && dragState.pointerId === e.pointerId) {
      if (dragState.touch && !dragState.movedFar && Math.hypot(e.clientX - dragState.sx, e.clientY - dragState.sy) > 8) {
        dragState.movedFar = true;
        clearTimeout(longPressTimer);
      }
      if (dragState.deferred) return;
      const t = Tools[dragState.tool];
      if (dragState.tool === 'pan') t.move(p, e);
      else {
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of events.length ? events : [e]) {
          const q = screenToDoc(ev.clientX, ev.clientY);
          if (q.x === dragState.last.x && q.y === dragState.last.y) continue;
          t.move(q, ev);
          dragState.last = q;
        }
      }
      dragState.lastEvent = pickEvent(e);
      requestRender();
      updateStatus();
    } else if (moved && !isTouch) {
      requestRender();
      updateStatus();
    }
  });

  const end = e => {
    if (e.pointerType === 'touch') {
      touchPts.delete(e.pointerId);
      if (gesture) { if (!touchPts.size) finishGesture(); return; }
    }
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    clearTimeout(longPressTimer);
    const p = screenToDoc(e.clientX, e.clientY);
    const t = Tools[dragState.tool];
    if (dragState.deferred) {
      if (e.type === 'pointerup') { t.down(dragState.deferred.p, dragState.deferred.e, 0); t.up(p, e); }
    } else {
      if (dragState.tool !== 'pan' && (p.x !== dragState.last.x || p.y !== dragState.last.y)) t.move(p, e);
      t.up(p, e);
    }
    const wasTouch = dragState.touch;
    dragState = null;
    if (!S.spaceHeld && !S.altHeld && !heldToolKey) S.tempTool = null;
    if (wasTouch) S.hover = null;
    refreshAll();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') { S.hover = null; requestRender(); updateStatus(); } });

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.shiftKey && !e.ctrlKey) {
      setBrush(S.brushSize - Math.sign(e.deltaY || e.deltaX));
      renderToolOptions(); requestRender();
      return;
    }
    const r = cv.getBoundingClientRect();
    if (e.ctrlKey && Math.abs(e.deltaY) < 50) {
      zoomTo(V.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top); // pellizco en trackpad
    } else if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5 && e.deltaMode === 0) {
      V.panX -= e.deltaX; requestRender(); // desplazamiento horizontal de trackpad
    } else {
      zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    }
  }, { passive: false });

  // iOS: evita el zoom de página con pellizco
  document.addEventListener('gesturestart', e => e.preventDefault());
}

function longPressPick(pointerId) {
  if (!dragState || dragState.pointerId !== pointerId || dragState.movedFar || gesture) return;
  const p = dragState.last;
  cancelDrag(true);
  dragState = { tool: 'picker', btn: 0, pointerId, last: p, touch: true, t0: performance.now(), movedFar: true };
  Tools.picker.down(p, {}, 0);
  toast('Cuentagotas');
  refreshAll();
}

function gesturePts() {
  const pts = [...touchPts.values()].slice(0, 2);
  const r = viewCanvas.getBoundingClientRect();
  const c = { x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top };
  return { c, d: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)) };
}
function startGesture() {
  const { c, d } = gesturePts();
  if (gesture) { gesture.maxN = Math.max(gesture.maxN, touchPts.size); }
  gesture = { c0: c, d0: d, z0: V.zoom, px0: V.panX, py0: V.panY, t0: gesture?.t0 || performance.now(), maxN: Math.max(gesture?.maxN || 0, touchPts.size), moved: gesture?.moved || false };
}
function updateGesture() {
  if (touchPts.size < 2) return;
  const g = gesture, { c, d } = gesturePts();
  if (!g.moved && (Math.abs(d - g.d0) > 14 || Math.hypot(c.x - g.c0.x, c.y - g.c0.y) > 14)) g.moved = true;
  if (!g.moved) return;
  g.c = c;
  const z = clamp(g.z0 * d / g.d0, 0.05, 200);
  const dx = (g.c0.x - g.px0) / g.z0, dy = (g.c0.y - g.py0) / g.z0;
  V.zoom = z;
  V.panX = Math.round(c.x - dx * z);
  V.panY = Math.round(c.y - dy * z);
  requestRender(); updateStatus();
}
function finishGesture() {
  const g = gesture;
  gesture = null;
  if (!g.moved && performance.now() - g.t0 < 400) {
    if (g.maxN === 2) History.undo();
    else if (g.maxN >= 3) History.redo();
  } else if (V.zoom > 1 && g.c) {
    // al terminar el pellizco, redondea a un zoom entero (píxeles nítidos)
    zoomTo(Math.round(V.zoom), g.c.x, g.c.y);
  }
}

/** Cancela el trazo en curso (Esc o segundo dedo). */
function cancelDrag(silent) {
  if (!dragState) return;
  clearTimeout(longPressTimer);
  if (E) { E.cel.data.set(E.before); E.cel.dirty = true; E = null; }
  if (selDrag.before) { restoreCel(selDrag.before); selDrag.before = null; }
  const t = Tools[dragState.tool];
  t.mode = null; t.s = null;
  S.shapeInfo = '';
  dragState = null;
  refreshAll();
  if (!silent) toast('Trazo cancelado');
}

/* ---------------- Entrada: teclado ---------------- */

function isTyping(e) {
  const t = e.target;
  return t && ((t.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes(t.type)) || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

const REPEATABLE = /^(nav\.|nudge\.|brush\.(bigger|smaller)|view\.zoom|edit\.(undo|redo)|color\.|frame\.(prev|next))/;

function initKeyboard() {
  window.addEventListener('keydown', e => {
    if (S.modal) {
      if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
      else if (e.key === 'Enter' && S.modal.type === 'dialog') { e.preventDefault(); $('#overlay form')?.requestSubmit(); }
      else if (S.modal.type === 'help') { e.preventDefault(); closeDialog(); }
      return;
    }
    if (isTyping(e)) { if (e.key === 'Escape') e.target.blur(); return; }
    if (e.key === 'Escape' && dragState) { e.preventDefault(); cancelDrag(); return; }
    if (e.key === 'Escape' && S.playing) { e.preventDefault(); stopPlayback(); return; }

    // Modificadores mantenidos
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat && !S.spaceHeld) { S.spaceHeld = true; if (!dragState) S.tempTool = 'pan'; refreshTemp(); }
      return;
    }
    if (e.key === 'Alt') {
      e.preventDefault();
      if (!S.altHeld && !e.ctrlKey) { S.altHeld = true; if (!dragState) S.tempTool = 'picker'; refreshTemp(); }
      return;
    }
    if (e.key === 'Shift' && dragState?.lastEvent) {
      Tools[dragState.tool].move(dragState.last, { ...dragState.lastEvent, shiftKey: true });
      requestRender();
      return;
    }
    if (['Control', 'Shift', 'Meta', 'AltGraph'].includes(e.key)) return;

    const combo = comboFromEvent(e);
    if (/^[1-9]$/.test(combo)) { e.preventDefault(); pickPaletteIndex(+combo - 1); return; }
    if (combo === 'Ctrl+V') return; // lo gestiona el evento "paste"

    const id = Keymap[combo];
    if (!id) return;
    e.preventDefault();
    if (dragState) return;
    S.altHeld = false; if (S.tempTool === 'picker') S.tempTool = null;
    const c = CmdById[id];
    if (c.tool) {
      if (e.repeat) return;
      // pulsación corta: cambia de herramienta · mantener mientras dibujas: uso temporal
      heldToolKey = { code: e.code, prev: S.tool, time: performance.now(), used: false };
      setTool(c.tool);
      refreshAll();
      return;
    }
    if (e.repeat && !REPEATABLE.test(id)) return;
    runCommand(id);
  });

  window.addEventListener('keyup', e => {
    if (e.code === 'Space' && S.spaceHeld) { S.spaceHeld = false; if (!dragState) S.tempTool = null; refreshTemp(); }
    if (e.key === 'Alt') { e.preventDefault(); if (S.altHeld) { S.altHeld = false; if (!dragState) S.tempTool = null; refreshTemp(); } }
    if (e.key === 'Shift' && dragState?.lastEvent) {
      Tools[dragState.tool].move(dragState.last, { ...dragState.lastEvent, shiftKey: false });
      requestRender();
    }
    if (heldToolKey && e.code === heldToolKey.code) {
      const { prev, used, time } = heldToolKey;
      heldToolKey = null;
      if (used && performance.now() - time > 250 && prev !== S.tool) {
        S.tool = prev;
        refreshAll();
      }
    }
  });

  window.addEventListener('blur', () => {
    S.spaceHeld = S.altHeld = false; S.tempTool = null; heldToolKey = null;
    refreshTemp();
  });

  document.addEventListener('paste', e => {
    if (isTyping(e) || S.modal) return;
    const items = [...(e.clipboardData?.items || [])];
    const img = items.find(i => i.type.startsWith('image/'));
    e.preventDefault();
    if (img) pasteImageBlob(img.getAsFile()).then(refreshAll);
    else if (S.clipboard) { pasteBlock(S.clipboard); refreshAll(); }
    else toast('El portapapeles está vacío');
  });
}

function pickEvent(e) {
  return { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey };
}

function refreshTemp() {
  renderToolbar(); updateCursor(); updateStatus(); requestRender();
}

/* ---------------- Arrastrar y soltar ---------------- */

function initDrop() {
  window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dropping'); });
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  window.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('dropping');
    const f = e.dataTransfer.files[0];
    if (f) openFile(f);
  });
}

/* ---------------- Diseño escritorio / móvil ---------------- */

const mobileQuery = matchMedia('(max-width: 760px), (max-height: 520px) and (pointer: coarse)');
function applyLayout() {
  const app = $('#app');
  S.mobile = mobileQuery.matches;
  app.classList.toggle('mobile', S.mobile);
  app.classList.toggle('landscape', S.mobile && innerWidth > innerHeight);
  app.classList.toggle('focus', !S.mobile && !S.panels);
  app.classList.toggle('no-timeline', !S.timeline);
  const opts = $('#tool-options');
  if (S.mobile) $('#mobile-opts').append(opts);
  else $('#topbar').insertBefore(opts, $('#cmd-button'));
  closeSheet();
  if (S.doc) refreshAll();
}

/* ---------------- Arranque ---------------- */

async function init() {
  loadPrefs();
  registerCommands();
  buildToolbar();
  buildColorPanel();
  initPicker();
  buildLayersPanel();
  buildTimeline();
  document.querySelectorAll('[data-cmd]').forEach(b => {
    const c = CmdById[b.dataset.cmd];
    if (c?.keys[0] && !b.title) b.title = `${c.label} (${prettyKey(c.keys[0])})`;
    b.addEventListener('click', () => runCommand(b.dataset.cmd));
  });
  document.querySelectorAll('[data-sheet-open]').forEach(b => b.addEventListener('click', () => openSheet(b.dataset.sheetOpen)));
  $('#sheet-close').addEventListener('click', closeSheet);
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#st-size').addEventListener('click', () => runCommand('canvas.resize'));
  $('#st-zoom').addEventListener('click', () => runCommand('view.fit'));
  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay' || S.modal?.type === 'help') closeDialog(); });

  initView();
  initPreviewNav();
  if (!(await loadAutosave())) S.doc = makeDoc(32, 32);
  initPointer();
  initKeyboard();
  initDrop();
  mobileQuery.addEventListener('change', applyLayout);
  window.addEventListener('resize', () => $('#app').classList.toggle('landscape', S.mobile && innerWidth > innerHeight));
  applyLayout();

  window.addEventListener('beforeunload', () => { autosave(); savePrefs(true); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { autosave(); savePrefs(true); } });
  // Los botones no se quedan con el foco: así Espacio/Intro siguen siendo atajos.
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.closest('#overlay')) b.blur();
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  fitView();
  renderRecent();
  refreshAll();
}

window.addEventListener('DOMContentLoaded', init);
