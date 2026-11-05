'use strict';
/* =========================================================================
 * Aplicación: operaciones, entrada (ratón/teclado) y persistencia.
 * ========================================================================= */

let dragState = null;        // { tool, btn } mientras se arrastra en el lienzo
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

function makeDoc(w, h, layers) {
  return { w, h, layers: layers || [new Layer(w, h, 'Capa 1')], active: 0 };
}

function newDoc(w, h) {
  w = clamp(Math.round(w) || 32, 1, 2048); h = clamp(Math.round(h) || 32, 1, 2048);
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
  doSnap(() => {
    const layers = d.layers.map(l => {
      const out = new Uint32Array(w * h);
      for (let y = 0; y < d.h; y++) {
        const ny = y + oy;
        if (ny < 0 || ny >= h) continue;
        for (let x = 0; x < d.w; x++) {
          const nx = x + ox;
          if (nx >= 0 && nx < w) out[ny * w + nx] = l.data[y * d.w + x];
        }
      }
      return cloneLayer(l, w, h, out);
    });
    S.doc = { w, h, layers, active: d.active };
    S.sel = null;
  });
  fitView();
}

function scaleImage(w, h) {
  w = clamp(Math.round(w) || 1, 1, 2048); h = clamp(Math.round(h) || 1, 1, 2048);
  const d = S.doc;
  commitFloat();
  doSnap(() => {
    const layers = d.layers.map(l => {
      const out = new Uint32Array(w * h);
      for (let y = 0; y < h; y++) {
        const sy = Math.min(d.h - 1, Math.floor(y * d.h / h));
        for (let x = 0; x < w; x++) out[y * w + x] = l.data[sy * d.w + Math.min(d.w - 1, Math.floor(x * d.w / w))];
      }
      return cloneLayer(l, w, h, out);
    });
    S.doc = { w, h, layers, active: d.active };
    S.sel = null;
  });
  fitView();
}

function cloneLayer(l, w, h, data) {
  const n = new Layer(w, h, l.name, data);
  n.id = l.id; n.visible = l.visible; n.opacity = l.opacity;
  return n;
}

function contentBounds() {
  const d = S.doc;
  let x0 = d.w, y0 = d.h, x1 = -1, y1 = -1;
  for (const l of d.layers) {
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) {
      if (cA(l.data[y * d.w + x])) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function cropTo(r) {
  const d = S.doc;
  doSnap(() => {
    const layers = d.layers.map(l => cloneLayer(l, r.w, r.h, extract(l, r)));
    S.doc = { w: r.w, h: r.h, layers, active: d.active };
    S.sel = null;
  });
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
  const d = S.doc;
  doSnap(() => {
    const rot = kind === 'rotate';
    const w = rot ? d.h : d.w, h = rot ? d.w : d.h;
    const layers = d.layers.map(l => cloneLayer(l, w, h,
      rot ? rotateData(l.data, d.w, d.h) : flipData(l.data, d.w, d.h, kind === 'flipH')));
    S.doc = { w, h, layers, active: d.active };
    S.sel = null;
  });
  if (kind === 'rotate') fitView();
}

/* ---------------- Selección / portapapeles ---------------- */

function deselect() {
  if (S.float) commitFloat();
  S.sel = null;
}

function selectionPixels() {
  if (S.float) return { ...S.float, data: S.float.data.slice() };
  const r = S.sel ? clipRect(S.sel) : { x: 0, y: 0, w: S.doc.w, h: S.doc.h };
  if (!r) return null;
  return { ...r, data: extract(activeLayer(), r) };
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

function cutSel() {
  copySel();
  deleteSel();
}

function deleteSel() {
  if (S.float) { doSnap(() => { S.float = null; }); return; }
  if (S.sel) {
    const r = clipRect(S.sel);
    if (!r) return;
    const ed = beginEdit();
    clearRegion(ed.layer, r);
    endEdit();
    return;
  }
  const ed = beginEdit();
  ed.layer.data.fill(0); ed.layer.dirty = true;
  endEdit();
  toast('Capa vaciada');
}

function pasteBlock(c) {
  commitFloat();
  doSnap(() => {
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
  toast('Pegado · arrastra para colocar · Intro para fijar');
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
    if (S.clipboard && S.clipboard.w === w && S.clipboard.h === h && S.clipboard.data.every((v, i) => sameColor(v, data[i]))) {
      pasteBlock(S.clipboard); // es nuestra propia copia: conserva la posición
    } else pasteBlock({ w, h, data });
  } finally { URL.revokeObjectURL(url); }
}

function nudge(dx, dy) {
  if (S.sel || S.float) {
    doSnap(() => {
      if (!liftSel()) return false;
      S.float.x += dx; S.float.y += dy;
      S.sel.x = S.float.x; S.sel.y = S.float.y;
    });
  } else {
    const ed = beginEdit();
    shiftLayer(ed.layer, ed.before, dx, dy);
    endEdit();
  }
}

function flipSel(horiz) {
  if (!S.sel && !S.float) {
    const ed = beginEdit();
    ed.layer.setData(flipData(ed.before, S.doc.w, S.doc.h, horiz));
    endEdit();
    return;
  }
  doSnap(() => {
    if (!liftSel()) return false;
    S.float.data = flipData(S.float.data, S.float.w, S.float.h, horiz);
    S.floatDirty = true;
  });
}

function rotateSel() {
  if (!S.sel && !S.float) {
    if (S.doc.w === S.doc.h) {
      const ed = beginEdit();
      ed.layer.setData(rotateData(ed.before, S.doc.w, S.doc.h));
      endEdit();
    } else transformCanvas('rotate');
    return;
  }
  doSnap(() => {
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
    const n = d.layers.length + 1;
    d.layers.splice(d.active + 1, 0, new Layer(d.w, d.h, 'Capa ' + n));
    d.active++;
  });
}
function duplicateLayer() {
  commitFloat();
  doSnap(() => {
    const d = S.doc, l = activeLayer();
    const c = new Layer(d.w, d.h, l.name + ' copia', l.data.slice());
    c.opacity = l.opacity; c.visible = l.visible;
    d.layers.splice(d.active + 1, 0, c);
    d.active++;
  });
}
function deleteLayer() {
  commitFloat();
  const d = S.doc;
  if (d.layers.length <= 1) {
    const ed = beginEdit(); ed.layer.data.fill(0); ed.layer.dirty = true; endEdit();
    return toast('Era la única capa: se ha vaciado');
  }
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
    top.sync(); bottom.sync();
    const c = h('canvas', { width: d.w, height: d.h }), ctx = c.getContext('2d');
    ctx.globalAlpha = bottom.visible ? bottom.opacity : 0; ctx.drawImage(bottom.canvas, 0, 0);
    ctx.globalAlpha = top.visible ? top.opacity : 0; ctx.drawImage(top.canvas, 0, 0);
    bottom.setData(new Uint32Array(ctx.getImageData(0, 0, d.w, d.h).data.buffer));
    bottom.opacity = 1; bottom.visible = true;
    d.layers.splice(d.active, 1);
    d.active--;
  });
}

/* ---------------- Paleta ---------------- */

function paletteFromImage() {
  const set = new Set();
  for (const l of S.doc.layers) for (const c of l.data) if (cA(c)) set.add(withAlpha(c, 255));
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
  download(new Blob([txt], { type: 'text/plain' }), `${S.fileName}-paleta.hex`);
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
      if (!t || t.startsWith(';') || t.startsWith('#') && !/^#[0-9a-f]{6}\b/i.test(t)) {
        continue;
      }
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
  S.panels = !S.panels;
  $('#app').classList.toggle('focus', !S.panels);
  savePrefs();
}

/* ---------------- Archivos ---------------- */

function layerDataForSave(i) {
  const l = S.doc.layers[i];
  if (!(S.float && i === S.doc.active)) return l.data;
  const copy = l.data.slice();
  stampFloatInto(copy, S.float);
  return copy;
}

function serialize() {
  const d = S.doc;
  return {
    app: 'PixelEdit', version: 1, w: d.w, h: d.h, active: d.active, name: S.fileName,
    layers: d.layers.map((l, i) => ({
      name: l.name, visible: l.visible, opacity: l.opacity,
      png: u32ToCanvas(layerDataForSave(i), d.w, d.h).toDataURL('image/png'),
    })),
    palette: S.palette.map(u32ToHex),
  };
}

async function deserialize(obj) {
  if (!obj || !obj.layers || !obj.w || !obj.h) throw new Error('Archivo no válido');
  const layers = [];
  for (const o of obj.layers) {
    const img = await loadImage(o.png);
    const l = new Layer(obj.w, obj.h, o.name || 'Capa', imageToU32(img).data);
    l.visible = o.visible !== false; l.opacity = o.opacity ?? 1;
    layers.push(l);
  }
  const doc = makeDoc(obj.w, obj.h, layers);
  doc.active = clamp(obj.active || 0, 0, layers.length - 1);
  return doc;
}

function replaceDoc(doc, name) {
  commitFloat();
  doSnap(() => { S.doc = doc; S.sel = null; S.float = null; });
  if (name) S.fileName = name;
  fitView();
  refreshAll();
}

function saveProject() {
  const blob = new Blob([JSON.stringify(serialize())], { type: 'application/json' });
  download(blob, `${S.fileName}.pixeledit.json`);
  toast('Proyecto guardado');
}

function exportPNG(scale = 1) {
  S.exportScale = scale;
  composite();
  const d = S.doc;
  const c = h('canvas', { width: d.w * scale, height: d.h * scale });
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(compCanvas, 0, 0, d.w * scale, d.h * scale);
  c.toBlob(b => download(b, `${S.fileName}${scale > 1 ? '@' + scale + 'x' : ''}.png`));
  toast(`PNG exportado ×${scale}`);
  savePrefs();
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
      replaceDoc(doc, obj.name || base);
      toast('Proyecto abierto');
    } else if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      const { w, h, data } = imageToU32(img);
      if (w > 2048 || h > 2048) return toast('Imagen demasiado grande (máx. 2048 px)');
      replaceDoc(makeDoc(w, h, [new Layer(w, h, base || 'Imagen', data)]), base);
      toast(`Imagen abierta ${w}×${h}`);
    } else toast('Formato no soportado');
  } catch (err) {
    console.error(err);
    toast('No se pudo abrir el archivo');
  }
}

/* ---------------- Persistencia local ---------------- */

const PREFS_KEY = 'pixeledit.prefs', AUTOSAVE_KEY = 'pixeledit.autosave';
let prefsTimer = null, autosaveTimer = null;

function savePrefs(now = false) {
  clearTimeout(prefsTimer);
  const write = () => {
    const p = {
      palette: S.palette.map(u32ToHex), recent: S.recent.map(c => u32ToHex(c) + cA(c).toString(16).padStart(2, '0')),
      brushSize: S.brushSize, brushRound: S.brushRound, pixelPerfect: S.pixelPerfect, fillShapes: S.fillShapes,
      grid: S.grid, gridMajor: S.gridMajor, panels: S.panels, exportScale: S.exportScale,
      primary: u32ToHex(S.primary) + cA(S.primary).toString(16).padStart(2, '0'),
      secondary: u32ToHex(S.secondary) + cA(S.secondary).toString(16).padStart(2, '0'),
      recentCmds: S.recentCmds,
    };
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
  for (const k of ['brushSize', 'brushRound', 'pixelPerfect', 'fillShapes', 'grid', 'gridMajor', 'panels', 'exportScale', 'recentCmds']) {
    if (p[k] !== undefined) S[k] = p[k];
  }
  if (p.primary) S.primary = hexToU32(p.primary) ?? S.primary;
  if (p.secondary) S.secondary = hexToU32(p.secondary) ?? S.secondary;
}

function markModified() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(autosave, 800);
}
function autosave() {
  clearTimeout(autosaveTimer);
  if (!S.doc) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize()));
    S.savedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    S.savedAt = '(sin espacio para autoguardar)';
  }
  updateStatus();
}

async function loadAutosave() {
  try {
    const obj = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) || 'null');
    if (!obj) return false;
    S.doc = await deserialize(obj);
    S.fileName = obj.name || 'sin-titulo';
    return true;
  } catch (err) {
    console.warn('Autoguardado no válido', err);
    return false;
  }
}

/* ---------------- Entrada: ratón ---------------- */

function initPointer() {
  const cv = viewCanvas;
  cv.addEventListener('contextmenu', e => e.preventDefault());

  cv.addEventListener('pointerdown', e => {
    if (dragState || S.modal) return;
    cv.setPointerCapture(e.pointerId);
    const btn = e.button;
    const toolId = btn === 1 ? 'pan' : currentToolId();
    if (btn !== 0 && btn !== 1 && btn !== 2) return;
    const p = screenToDoc(e.clientX, e.clientY);
    dragState = { tool: toolId, btn, pointerId: e.pointerId, last: p, used: true };
    if (heldToolKey) heldToolKey.used = true;
    Tools[toolId].down(p, e, btn);
    afterPointer(p);
    e.preventDefault();
  });

  cv.addEventListener('pointermove', e => {
    const p = screenToDoc(e.clientX, e.clientY);
    const moved = !S.hover || S.hover.x !== p.x || S.hover.y !== p.y;
    S.hover = p;
    if (dragState && dragState.pointerId === e.pointerId) {
      const t = Tools[dragState.tool];
      if (dragState.tool === 'pan') t.move(p, e);
      else if (moved) {
        const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of events) {
          const q = screenToDoc(ev.clientX, ev.clientY);
          if (q.x === dragState.last.x && q.y === dragState.last.y) continue;
          t.move(q, ev);
          dragState.last = q;
        }
      }
      dragState.lastEvent = e;
      requestRender();
      updateStatus();
    } else if (moved) {
      requestRender();
      updateStatus();
    }
  });

  const end = e => {
    if (!dragState || dragState.pointerId !== e.pointerId) return;
    const p = screenToDoc(e.clientX, e.clientY);
    const t = Tools[dragState.tool];
    if (dragState.tool !== 'pan' && (p.x !== dragState.last.x || p.y !== dragState.last.y)) t.move(p, e);
    t.up(p, e);
    dragState = null;
    if (!S.spaceHeld && !S.altHeld && !heldToolKey) S.tempTool = null;
    refreshAll();
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { S.hover = null; requestRender(); updateStatus(); });

  cv.addEventListener('wheel', e => {
    e.preventDefault();
    if (e.shiftKey && !e.ctrlKey) {
      const d = Math.sign(e.deltaY || e.deltaX);
      setBrush(S.brushSize - d);
      renderToolOptions(); requestRender();
      return;
    }
    const r = cv.getBoundingClientRect();
    if (e.ctrlKey && Math.abs(e.deltaY) < 50) {
      // gesto de pellizco en trackpad: zoom continuo
      zoomTo(V.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    } else {
      zoomStep(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    }
  }, { passive: false });
}

function afterPointer() {
  requestRender();
  updateStatus();
}

/** Cancela el trazo en curso (Esc). */
function cancelDrag() {
  if (!dragState) return;
  if (E) { revertEdit(); E = null; }
  if (selDrag.before) { restore(selDrag.before); selDrag.before = null; }
  const t = Tools[dragState.tool];
  t.mode = null; t.s = null;
  S.shapeInfo = '';
  dragState = null;
  refreshAll();
  toast('Trazo cancelado');
}

/* ---------------- Entrada: teclado ---------------- */

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes(t.type) || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function initKeyboard() {
  window.addEventListener('keydown', e => {
    if (S.modal) {
      if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
      else if (e.key === 'Enter' && S.modal.type === 'dialog') {
        e.preventDefault();
        $('#overlay form')?.requestSubmit();
      }
      else if (S.modal.type === 'help') { e.preventDefault(); closeDialog(); }
      return;
    }
    if (isTyping(e)) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === 'Escape' && dragState) { e.preventDefault(); cancelDrag(); return; }

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
    if (e.key === 'Shift' && dragState && dragState.lastEvent) {
      // redibuja la forma con la restricción activada
      Tools[dragState.tool].move(dragState.last, { ...pickEvent(dragState.lastEvent), shiftKey: true });
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
    const c = CmdById[id];
    if (c.tool) {
      if (e.repeat) return;
      // pulsación corta: cambia de herramienta · mantener: uso temporal
      heldToolKey = { key: e.key.toLowerCase(), prev: S.tool, time: performance.now(), used: false };
      setTool(c.tool);
      refreshAll();
      return;
    }
    if (e.repeat && !/^(sel\.|brush\.(bigger|smaller)|view\.zoom|edit\.(undo|redo)|color\.)/.test(id)) return;
    runCommand(id);
  });

  window.addEventListener('keyup', e => {
    if (e.code === 'Space' && S.spaceHeld) { S.spaceHeld = false; if (!dragState) S.tempTool = null; refreshTemp(); }
    if (e.key === 'Alt' && S.altHeld) { e.preventDefault(); S.altHeld = false; if (!dragState) S.tempTool = null; refreshTemp(); }
    if (e.key === 'Shift' && dragState && dragState.lastEvent) {
      Tools[dragState.tool].move(dragState.last, { ...pickEvent(dragState.lastEvent), shiftKey: false });
      requestRender();
    }
    if (heldToolKey && e.key.toLowerCase() === heldToolKey.key) {
      const held = performance.now() - heldToolKey.time;
      const prev = heldToolKey.prev, used = heldToolKey.used;
      heldToolKey = null;
      const heldUsed = t => used && t > 250;
      if (heldUsed(held) && prev !== S.tool) {
        if (dragState) { const t = S.tool; S.tool = prev; dragState.tool = t; }
        else S.tool = prev;
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
  return { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey };
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

/* ---------------- Arranque ---------------- */

async function init() {
  loadPrefs();
  registerCommands();
  buildToolbar();
  buildColorPanel();
  buildLayersPanel();
  document.querySelectorAll('[data-cmd]').forEach(b => {
    const c = CmdById[b.dataset.cmd];
    if (c?.keys[0]) b.title = `${c.label} (${prettyKey(c.keys[0])})`;
    b.addEventListener('click', () => runCommand(b.dataset.cmd));
  });
  $('#st-size').addEventListener('click', () => runCommand('canvas.resize'));
  $('#st-zoom').addEventListener('click', () => runCommand('view.fit'));
  $('#overlay').addEventListener('mousedown', e => { if (e.target.id === 'overlay') closeDialog(); });
  $('#app').classList.toggle('focus', !S.panels);

  initView();
  if (!(await loadAutosave())) S.doc = makeDoc(32, 32);
  initPointer();
  initKeyboard();
  initDrop();
  window.addEventListener('beforeunload', () => { autosave(); savePrefs(true); });
  // Los botones no se quedan con el foco: así Espacio/Intro siguen siendo atajos.
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && !b.closest('#overlay')) b.blur();
  });
  fitView();
  renderRecent();
  refreshAll();
}

window.addEventListener('DOMContentLoaded', init);
