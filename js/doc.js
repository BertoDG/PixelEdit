'use strict';
/* =========================================================================
 * Modelo del documento: capas, estado global, instantáneas e historial.
 * ========================================================================= */

class Layer {
  constructor(w, h, name, data) {
    this.id = uid();
    this.name = name;
    this.visible = true;
    this.opacity = 1;
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.setData(data || new Uint32Array(w * h));
  }
  setData(d) {
    this.data = d;
    this.img = new ImageData(new Uint8ClampedArray(d.buffer, d.byteOffset, d.byteLength), this.w, this.h);
    this.dirty = true;
  }
  sync() {
    if (this.dirty) { this.ctx.putImageData(this.img, 0, 0); this.dirty = false; }
  }
}

/** Estado global de la aplicación. */
const S = {
  doc: null,                 // { w, h, layers: Layer[], active }
  tool: 'pencil',
  tempTool: null,            // herramienta temporal (Espacio, Alt, tecla mantenida)
  primary: rgba(34, 32, 52),
  secondary: rgba(255, 255, 255),
  brushSize: 1,
  brushRound: true,
  pixelPerfect: true,
  fillShapes: false,
  mirrorX: false,
  mirrorY: false,
  grid: true,
  gridMajor: 0,
  tile: false,
  panels: true,
  palette: [],
  recent: [],
  sel: null,                 // { x, y, w, h }
  float: null,               // { x, y, w, h, data } píxeles flotantes (selección levantada)
  floatCanvas: null,
  floatDirty: false,
  clipboard: null,
  hover: null,
  lastPoint: null,
  fileName: 'sin-titulo',
  modal: null,
  shapeInfo: '',
};

function activeLayer() { return S.doc.layers[S.doc.active]; }

function snapshot() {
  const d = S.doc;
  return {
    w: d.w, h: d.h, active: d.active,
    layers: d.layers.map(l => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, data: l.data.slice() })),
    sel: S.sel ? { ...S.sel } : null,
    float: S.float ? { ...S.float, data: S.float.data.slice() } : null,
  };
}

function restore(sn) {
  const sizeChanged = !S.doc || S.doc.w !== sn.w || S.doc.h !== sn.h;
  S.doc = {
    w: sn.w, h: sn.h, active: sn.active,
    layers: sn.layers.map(o => {
      const l = new Layer(sn.w, sn.h, o.name, o.data.slice());
      l.id = o.id; l.visible = o.visible; l.opacity = o.opacity;
      return l;
    }),
  };
  S.sel = sn.sel ? { ...sn.sel } : null;
  S.float = sn.float ? { ...sn.float, data: sn.float.data.slice() } : null;
  S.floatDirty = true;
  if (sizeChanged) fitView();
}

/** Diferencia de píxeles de una capa respecto a una copia previa. */
function diffEntry(layer, before) {
  const a = layer.data;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== before[i]) n++;
  if (!n) return null;
  const idx = new Uint32Array(n), oldv = new Uint32Array(n), newv = new Uint32Array(n);
  for (let i = 0, k = 0; i < a.length; i++) {
    if (a[i] !== before[i]) { idx[k] = i; oldv[k] = before[i]; newv[k] = a[i]; k++; }
  }
  return { type: 'pixels', layerId: layer.id, idx, oldv, newv };
}

const History = {
  undoStack: [],
  redoStack: [],
  limit: 200,
  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    markModified();
  },
  apply(e, dir) {
    if (e.type === 'pixels') {
      const i = S.doc.layers.findIndex(l => l.id === e.layerId);
      if (i < 0) return;
      const l = S.doc.layers[i], vals = dir === 'undo' ? e.oldv : e.newv;
      for (let k = 0; k < e.idx.length; k++) l.data[e.idx[k]] = vals[k];
      l.dirty = true;
      S.doc.active = i;
    } else {
      restore(dir === 'undo' ? e.before : e.after);
    }
  },
  undo() {
    if (dragState) return;
    const e = this.undoStack.pop();
    if (!e) return toast('Nada que deshacer');
    this.apply(e, 'undo');
    this.redoStack.push(e);
    markModified(); refreshAll();
  },
  redo() {
    if (dragState) return;
    const e = this.redoStack.pop();
    if (!e) return toast('Nada que rehacer');
    this.apply(e, 'redo');
    this.undoStack.push(e);
    markModified(); refreshAll();
  },
  clear() { this.undoStack.length = 0; this.redoStack.length = 0; },
};

/** Ejecuta una operación estructural registrándola como instantánea deshacible. */
function doSnap(fn) {
  const before = snapshot();
  const r = fn();
  if (r === false) return false;
  History.push({ type: 'snap', before, after: snapshot() });
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
function extract(layer, r) {
  const w = S.doc.w, out = new Uint32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    const s = (r.y + y) * w + r.x;
    out.set(layer.data.subarray(s, s + r.w), y * r.w);
  }
  return out;
}
function clearRegion(layer, r) {
  const w = S.doc.w;
  for (let y = 0; y < r.h; y++) layer.data.fill(0, (r.y + y) * w + r.x, (r.y + y) * w + r.x + r.w);
  layer.dirty = true;
}
/** Convierte la selección en píxeles flotantes (sin registrar historial). */
function liftSel() {
  if (S.float) return true;
  if (!S.sel) return false;
  const r = clipRect(S.sel);
  if (!r) { S.sel = null; return false; }
  const l = activeLayer();
  S.float = { ...r, data: extract(l, r) };
  clearRegion(l, r);
  S.sel = { ...r };
  S.floatDirty = true;
  return true;
}
function stampFloatInto(data, f) {
  const d = S.doc;
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const v = f.data[y * f.w + x];
    if (cA(v) === 0) continue;
    const X = f.x + x, Y = f.y + y;
    if (X < 0 || Y < 0 || X >= d.w || Y >= d.h) continue;
    data[Y * d.w + X] = v;
  }
}
/** Fija los píxeles flotantes en la capa activa. */
function commitFloat() {
  if (!S.float) return;
  doSnap(() => {
    const l = activeLayer();
    stampFloatInto(l.data, S.float);
    l.dirty = true;
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
