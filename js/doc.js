'use strict';
/* =========================================================================
 * Modelo del documento.
 *
 *   doc = { w, h, layers: Layer[], frames: Frame[], active, frame }
 *   Layer = { id, name, visible, opacity, locked, cels: Cel[] }  (un cel por fotograma)
 *   Frame = { id, duration }  (duración en ms)
 *   Cel   = píxeles de una capa en un fotograma (Uint32Array + canvas)
 * ========================================================================= */

class Cel {
  constructor(w, h, data) {
    this.id = uid();
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.version = 0;
    this.setData(data || new Uint32Array(w * h));
  }
  setData(d) {
    this.data = d;
    this.img = new ImageData(new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength), this.w, this.h);
    this.dirty = true;
  }
  /** Marca un píxel/rectángulo como modificado (sincronización parcial, rápida en lienzos grandes). */
  touch(x0, y0, x1 = x0, y1 = y0) {
    const r = this.dr;
    if (!r) this.dr = { x0, y0, x1, y1 };
    else {
      if (x0 < r.x0) r.x0 = x0; if (y0 < r.y0) r.y0 = y0;
      if (x1 > r.x1) r.x1 = x1; if (y1 > r.y1) r.y1 = y1;
    }
  }
  sync() {
    if (this.dirty) {
      this.ctx.putImageData(this.img, 0, 0);
      this.dirty = false; this.dr = null; this.version++;
    } else if (this.dr) {
      const r = this.dr;
      const x0 = clamp(r.x0, 0, this.w - 1), y0 = clamp(r.y0, 0, this.h - 1);
      const x1 = clamp(r.x1, 0, this.w - 1), y1 = clamp(r.y1, 0, this.h - 1);
      this.ctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      this.dr = null; this.version++;
    }
  }
}

class Layer {
  constructor(name, cels = []) {
    this.id = uid();
    this.name = name;
    this.visible = true;
    this.opacity = 1;
    this.locked = false;
    this.cels = cels;
  }
}

function makeFrame(duration = 100) { return { id: uid(), duration }; }

function makeDoc(w, h, opts = {}) {
  const frames = opts.frames || [makeFrame()];
  const layers = opts.layers || [new Layer('Capa 1', frames.map(() => new Cel(w, h)))];
  return { w, h, layers, frames, active: 0, frame: 0 };
}

/** Estado global de la aplicación. */
const S = {
  doc: null,
  tool: 'pencil',
  tempTool: null,
  primary: rgba(34, 32, 52),
  secondary: rgba(255, 255, 255),
  brushSize: 1,
  brushRound: true,
  pixelPerfect: true,
  fillShapes: false,
  mirrorX: false,
  mirrorY: false,
  grid: true,
  tileGrid: false,
  tileW: 16, tileH: 16,
  tile: false,
  panels: true,
  timeline: true,
  onion: false,
  playing: false,
  palette: [],
  recent: [],
  sel: null,                 // { x, y, w, h }
  float: null,               // { x, y, w, h, data } píxeles flotantes en el cel activo
  floatCanvas: null,
  floatDirty: false,
  clipboard: null,
  stamp: null,               // { w, h, data } pincel personalizado (sello)
  stampSnap: true,
  hover: null,
  lastPoint: null,
  fileName: 'sin-titulo',
  modal: null,
  shapeInfo: '',
  mobile: false,
  layout: 'auto',            // 'auto' | 'mobile' | 'desktop'
};

function activeLayer() { return S.doc.layers[S.doc.active]; }
function activeCel() { return S.doc.layers[S.doc.active].cels[S.doc.frame]; }
function findCel(id) {
  const d = S.doc;
  for (let li = 0; li < d.layers.length; li++) {
    const fi = d.layers[li].cels.findIndex(c => c.id === id);
    if (fi >= 0) return { cel: d.layers[li].cels[fi], li, fi };
  }
  return null;
}

/* ---------------- Instantáneas ---------------- */

/** Instantánea completa (cambios de estructura: capas, fotogramas, tamaño). */
function snapshot() {
  const d = S.doc;
  let bytes = 0;
  const layers = d.layers.map(l => ({
    id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked,
    cels: l.cels.map(c => { bytes += c.data.byteLength; return { id: c.id, data: c.data.slice() }; }),
  }));
  return {
    kind: 'full', w: d.w, h: d.h, active: d.active, frame: d.frame,
    frames: d.frames.map(f => ({ ...f })), layers, bytes,
    sel: S.sel ? { ...S.sel } : null,
    float: S.float ? { ...S.float, data: S.float.data.slice() } : null,
  };
}

function restore(sn) {
  const sizeChanged = !S.doc || S.doc.w !== sn.w || S.doc.h !== sn.h;
  S.doc = {
    w: sn.w, h: sn.h, active: sn.active, frame: sn.frame,
    frames: sn.frames.map(f => ({ ...f })),
    layers: sn.layers.map(o => {
      const l = new Layer(o.name, o.cels.map(c => { const n = new Cel(sn.w, sn.h, c.data.slice()); n.id = c.id; return n; }));
      l.id = o.id; l.visible = o.visible; l.opacity = o.opacity; l.locked = o.locked;
      return l;
    }),
  };
  S.sel = sn.sel ? { ...sn.sel } : null;
  S.float = sn.float ? { ...sn.float, data: sn.float.data.slice() } : null;
  S.floatDirty = true;
  if (sizeChanged) fitView();
}

/** Instantánea ligera de un solo cel + selección (mover/pegar/voltear selección). */
function celSnapshot() {
  const c = activeCel();
  return {
    kind: 'cel', celId: c.id, data: c.data.slice(), bytes: c.data.byteLength,
    sel: S.sel ? { ...S.sel } : null,
    float: S.float ? { ...S.float, data: S.float.data.slice() } : null,
  };
}
function restoreCel(sn) {
  const f = findCel(sn.celId);
  if (!f) return;
  S.doc.active = f.li; S.doc.frame = f.fi;
  f.cel.setData(sn.data.slice());
  S.sel = sn.sel ? { ...sn.sel } : null;
  S.float = sn.float ? { ...sn.float, data: sn.float.data.slice() } : null;
  S.floatDirty = true;
}

/** Diferencia de píxeles de un cel respecto a una copia previa (opcionalmente solo en una caja). */
function diffEntry(cel, before, box) {
  const a = cel.data, w = cel.w;
  let x0 = 0, y0 = 0, x1 = cel.w - 1, y1 = cel.h - 1;
  if (box) {
    x0 = clamp(box.x0, 0, cel.w - 1); y0 = clamp(box.y0, 0, cel.h - 1);
    x1 = clamp(box.x1, 0, cel.w - 1); y1 = clamp(box.y1, 0, cel.h - 1);
  }
  const idx = [], oldv = [], newv = [];
  for (let y = y0; y <= y1; y++) {
    for (let i = y * w + x0, e = y * w + x1; i <= e; i++) {
      if (a[i] !== before[i]) { idx.push(i); oldv.push(before[i]); newv.push(a[i]); }
    }
  }
  if (!idx.length) return null;
  return {
    type: 'pixels', celId: cel.id, idx: Uint32Array.from(idx),
    oldv: Uint32Array.from(oldv), newv: Uint32Array.from(newv), bytes: idx.length * 12,
  };
}

const History = {
  undoStack: [],
  redoStack: [],
  maxBytes: 384 * 1024 * 1024,
  bytes: 0,
  push(entry) {
    entry.bytes = entry.bytes || ((entry.before?.bytes || 0) + (entry.after?.bytes || 0));
    this.undoStack.push(entry);
    this.bytes += entry.bytes;
    for (const e of this.redoStack) this.bytes -= e.bytes;
    this.redoStack.length = 0;
    while ((this.bytes > this.maxBytes || this.undoStack.length > 300) && this.undoStack.length > 1) {
      this.bytes -= this.undoStack.shift().bytes;
    }
    markModified();
  },
  apply(e, dir) {
    if (e.type === 'pixels') {
      const f = findCel(e.celId);
      if (!f) return;
      const vals = dir === 'undo' ? e.oldv : e.newv;
      for (let k = 0; k < e.idx.length; k++) f.cel.data[e.idx[k]] = vals[k];
      f.cel.dirty = true;
      S.doc.active = f.li; S.doc.frame = f.fi;
    } else {
      const sn = dir === 'undo' ? e.before : e.after;
      if (sn.kind === 'cel') restoreCel(sn); else restore(sn);
    }
  },
  undo() {
    if (dragState) return;
    stopPlayback();
    const e = this.undoStack.pop();
    if (!e) return toast('Nada que deshacer');
    this.apply(e, 'undo');
    this.redoStack.push(e);
    markModified(); refreshAll();
  },
  redo() {
    if (dragState) return;
    stopPlayback();
    const e = this.redoStack.pop();
    if (!e) return toast('Nada que rehacer');
    this.apply(e, 'redo');
    this.undoStack.push(e);
    markModified(); refreshAll();
  },
};

/** Operación estructural deshacible (instantánea completa). */
function doSnap(fn) {
  const before = snapshot();
  if (fn() === false) return false;
  History.push({ type: 'snap', before, after: snapshot() });
  return true;
}
/** Operación deshacible sobre el cel activo y la selección (instantánea ligera). */
function doCelSnap(fn) {
  const before = celSnapshot();
  if (fn() === false) return false;
  History.push({ type: 'snap', before, after: celSnapshot() });
  return true;
}

/** ¿Se puede editar la capa activa? Avisa si no. */
function editable() {
  const l = activeLayer();
  if (l.locked) { toast('La capa está bloqueada'); return false; }
  if (!l.visible) { toast('La capa está oculta'); return false; }
  return true;
}

/* ---------------- Selección y píxeles flotantes ---------------- */

function clipRect(r) {
  const d = S.doc;
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  const x1 = Math.min(d.w, r.x + r.w), y1 = Math.min(d.h, r.y + r.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function inRect(p, r) { return r && p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h; }
function rectFrom(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x) + 1, h: Math.abs(a.y - b.y) + 1 };
}
function extract(cel, r) {
  const w = cel.w, out = new Uint32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const s = (r.y + y) * w + r.x;
    out.set(cel.data.subarray(s, s + r.w), y * r.w);
  }
  return out;
}
function clearRegion(cel, r) {
  const w = cel.w;
  for (let y = 0; y < r.h; y++) cel.data.fill(0, (r.y + y) * w + r.x, (r.y + y) * w + r.x + r.w);
  cel.touch(r.x, r.y, r.x + r.w - 1, r.y + r.h - 1);
}
/** Convierte la selección en píxeles flotantes (sin historial). */
function liftSel() {
  if (S.float) return true;
  if (!S.sel) return false;
  const r = clipRect(S.sel);
  if (!r) { S.sel = null; return false; }
  if (!editable()) return false;
  const c = activeCel();
  S.float = { ...r, data: extract(c, r) };
  clearRegion(c, r);
  S.sel = { ...r };
  S.floatDirty = true;
  return true;
}
/** Estampa un bloque (solo píxeles no transparentes) dentro de `data` (w×h). */
function stampBlock(data, w, h, b, color) {
  for (let y = 0; y < b.h; y++) {
    const Y = b.y + y;
    if (Y < 0 || Y >= h) continue;
    for (let x = 0; x < b.w; x++) {
      const v = b.data[y * b.w + x];
      if (cA(v) === 0) continue;
      const X = b.x + x;
      if (X < 0 || X >= w) continue;
      data[Y * w + X] = color === undefined ? v : color;
    }
  }
}
/** Fija los píxeles flotantes en el cel activo. */
function commitFloat() {
  if (!S.float) return;
  doCelSnap(() => {
    const c = activeCel(), f = S.float;
    stampBlock(c.data, c.w, c.h, f);
    c.touch(f.x, f.y, f.x + f.w - 1, f.y + f.h - 1);
    S.float = null;
  });
}
function syncFloatCanvas() {
  if (!S.float || !S.floatDirty) return;
  S.floatCanvas = u32ToCanvas(S.float.data, S.float.w, S.float.h);
  S.floatDirty = false;
}

/* Transformaciones de bloques de píxeles */
function flipData(data, w, h, horiz) {
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    out[y * w + x] = horiz ? data[y * w + (w - 1 - x)] : data[(h - 1 - y) * w + x];
  }
  return out;
}
function rotateData(data, w, h) { // 90° horario → (h × w)
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = data[y * w + x];
  return out;
}

/** Reconstruye el documento aplicando `fn(data) → nuevaData` a cada cel (mismo id). */
function remapCels(w, h, fn) {
  const d = S.doc;
  const layers = d.layers.map(l => {
    const n = new Layer(l.name, l.cels.map(c => { const nc = new Cel(w, h, fn(c.data, c)); nc.id = c.id; return nc; }));
    n.id = l.id; n.visible = l.visible; n.opacity = l.opacity; n.locked = l.locked;
    return n;
  });
  S.doc = { ...d, w, h, layers };
}

/** Dibuja un fotograma compuesto en `ctx` (tamaño del documento). */
function drawFrame(ctx, f, withFloat = true) {
  const d = S.doc;
  d.layers.forEach((l, i) => {
    if (!l.visible) return;
    const c = l.cels[f];
    c.sync();
    ctx.globalAlpha = l.opacity;
    ctx.drawImage(c.canvas, 0, 0);
    if (withFloat && S.float && i === d.active && f === d.frame) {
      syncFloatCanvas();
      ctx.drawImage(S.floatCanvas, S.float.x, S.float.y);
    }
  });
  ctx.globalAlpha = 1;
}

/** Píxeles RGBA de un fotograma compuesto. */
function frameData(f) {
  const d = S.doc;
  const c = document.createElement('canvas');
  c.width = d.w; c.height = d.h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  drawFrame(ctx, f, true);
  return new Uint32Array(ctx.getImageData(0, 0, d.w, d.h).data.buffer);
}
