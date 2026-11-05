'use strict';
/* =========================================================================
 * Herramientas de dibujo.
 * Cada herramienta implementa down(p, e, btn), move(p, e), up(p, e).
 * p = { x, y } en píxeles del documento; btn = 0 izquierdo, 2 derecho.
 * ========================================================================= */

const ICONS = {
  pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
  eraser: '<path d="M4 15l8-8 6 6-6 6H8z"/><path d="M8 19h12"/><path d="M8 11l6 6"/>',
  bucket: '<path d="M4 12l7-7 7 7-7 7z"/><path d="M4 12h14"/><path d="M20 15.5c0 1.5-.7 2.5-1.5 2.5S17 17 17 15.5 18.5 13 18.5 13 20 14 20 15.5z"/>',
  picker: '<path d="M15 4l5 5-2.5 2.5-5-5z"/><path d="M13.5 8.5L5 17v3h3l8.5-8.5"/>',
  dither: '<path fill="currentColor" stroke="none" d="M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z"/>',
  line: '<path d="M5 19L19 5"/><path d="M3 21h4v-4M17 7V3h4"/>',
  rect: '<rect x="4" y="6" width="16" height="12"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
  select: '<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2.4"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>',
  stamp: '<path d="M9 4h6v5l3 3v3H6v-3l3-3z"/><path d="M5 19h14"/>',
  pan: '<path d="M8 13V6.5a1.5 1.5 0 013 0V11"/><path d="M11 11V4.5a1.5 1.5 0 013 0V11"/><path d="M14 11V6a1.5 1.5 0 013 0v7.5c0 4-2.6 6.5-6 6.5-2.4 0-3.8-1-5.2-3L3.6 14a1.5 1.5 0 012.5-1.6L8 14.5"/>',
};

/* ---------------- Ayudantes de pintura ---------------- */

function mirrorPoints(x, y) {
  const d = S.doc, pts = [[x, y]];
  if (S.mirrorX) pts.push([d.w - 1 - x, y]);
  if (S.mirrorY) pts.push([x, d.h - 1 - y]);
  if (S.mirrorX && S.mirrorY) pts.push([d.w - 1 - x, d.h - 1 - y]);
  return pts;
}
function inBounds(x, y) { return x >= 0 && y >= 0 && x < S.doc.w && y < S.doc.h; }
function canPaint(x, y) {
  if (!inBounds(x, y)) return false;
  const s = S.sel;
  return !s || (x >= s.x && y >= s.y && x < s.x + s.w && y < s.y + s.h);
}
function plot(cel, x, y, colorAt) {
  for (const [mx, my] of mirrorPoints(x, y)) {
    if (!canPaint(mx, my)) continue;
    cel.data[my * cel.w + mx] = colorAt(mx, my);
    cel.touch(mx, my);
    if (E) expandBox(E, mx, my);
  }
}
function stamp(cel, x, y, colorAt, size = S.brushSize) {
  for (const [dx, dy] of brushOffsets(size, S.brushRound)) plot(cel, x + dx, y + dy, colorAt);
}
function expandBox(ed, x, y) {
  const b = ed.box;
  if (!b) ed.box = { x0: x, y0: y, x1: x, y1: y };
  else { if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y; }
  const t = ed.total;
  if (!t) ed.total = { x0: x, y0: y, x1: x, y1: y };
  else { if (x < t.x0) t.x0 = x; if (x > t.x1) t.x1 = x; if (y < t.y0) t.y0 = y; if (y > t.y1) t.y1 = y; }
}

/* Sesión de edición sobre el cel activo (un trazo = un paso de historial).
 * boxOnly: la herramienta solo escribe con plot(), así el diff se limita a la zona tocada. */
let E = null;
function beginEdit(boxOnly = false) {
  commitFloat();
  if (!editable()) return null;
  const cel = activeCel();
  E = { cel, before: cel.data.slice(), boxOnly, box: null, total: null };
  return E;
}
/** Deshace lo dibujado desde la última reversión (vista previa de formas). */
function revertEdit() {
  const ed = E, b = ed.box, w = ed.cel.w;
  if (!b) return;
  for (let y = clamp(b.y0, 0, ed.cel.h - 1); y <= clamp(b.y1, 0, ed.cel.h - 1); y++) {
    const s = y * w + clamp(b.x0, 0, w - 1), e = y * w + clamp(b.x1, 0, w - 1) + 1;
    ed.cel.data.set(ed.before.subarray(s, e), s);
  }
  ed.cel.touch(b.x0, b.y0, b.x1, b.y1);
  ed.box = null;
}
function endEdit() {
  if (!E) return;
  const entry = E.boxOnly ? (E.total ? diffEntry(E.cel, E.before, E.total) : null) : diffEntry(E.cel, E.before);
  if (entry) History.push(entry);
  E = null;
}

function addRecent(c) {
  if (!cA(c)) return;
  S.recent = [c, ...S.recent.filter(x => x !== c)].slice(0, 16);
  renderRecent();
  savePrefs();
}

/* ---------------- Fábricas de herramientas ---------------- */

function brushTool(def) {
  return {
    brush: true,
    ...def,
    down(p, e, btn) {
      const ed = beginEdit(true);
      if (!ed) return;
      ed.colorAt = def.colorFor(btn);
      ed.color = btn === 2 ? S.secondary : S.primary;
      ed.pp = def.pixelPerfect && S.pixelPerfect && S.brushSize === 1;
      ed.pts = [];
      if (e.shiftKey && S.lastPoint) {
        ed.last = S.lastPoint;
        this.move(p, e);
      } else {
        this.addCell(ed, p.x, p.y);
        ed.last = { x: p.x, y: p.y };
      }
    },
    move(p) {
      const ed = E;
      if (!ed || (ed.last.x === p.x && ed.last.y === p.y)) return;
      lineCells(ed.last.x, ed.last.y, p.x, p.y, (x, y) => {
        const l = ed.pts[ed.pts.length - 1];
        if (l && l.x === x && l.y === y) return;
        this.addCell(ed, x, y);
      });
      ed.last = { x: p.x, y: p.y };
    },
    up() {
      if (!E) return;
      S.lastPoint = E.last;
      const c = E.color;
      endEdit();
      if (def.id !== 'eraser') addRecent(c);
    },
    addCell(ed, x, y) {
      ed.pts.push({ x, y });
      const n = ed.pts.length;
      if (ed.pp && n >= 3) {
        // "Pixel perfect": elimina las esquinas en L de los trazos de 1px.
        const a = ed.pts[n - 3], b = ed.pts[n - 2], c = ed.pts[n - 1];
        if (Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1 &&
            ((b.x === a.x && b.y === c.y) || (b.x === c.x && b.y === a.y))) {
          for (const [mx, my] of mirrorPoints(b.x, b.y)) {
            if (inBounds(mx, my)) { const i = my * S.doc.w + mx; ed.cel.data[i] = ed.before[i]; ed.cel.touch(mx, my); }
          }
          ed.pts.splice(n - 2, 1);
        }
      }
      if (ed.pts.length > 64) ed.pts.splice(0, ed.pts.length - 8);
      stamp(ed.cel, x, y, ed.colorAt);
    },
  };
}

function shapeTool(def) {
  return {
    brush: true,
    ...def,
    down(p, e, btn) {
      const ed = beginEdit(true);
      if (!ed) return;
      ed.start = p;
      ed.color = btn === 2 ? S.secondary : S.primary;
      const c = ed.color;
      ed.colorAt = () => c;
      this.draw(ed, p, e);
    },
    move(p, e) {
      if (!E) return;
      revertEdit();
      this.draw(E, p, e);
    },
    up() {
      if (!E) return;
      const c = E.color;
      endEdit();
      S.shapeInfo = '';
      addRecent(c);
    },
    draw(ed, p, e) {
      const s = ed.start;
      let [x1, y1] = e.shiftKey ? def.constrain(s.x, s.y, p.x, p.y) : [p.x, p.y];
      def.cells(s.x, s.y, x1, y1, ed);
      S.shapeInfo = `${Math.abs(x1 - s.x) + 1}×${Math.abs(y1 - s.y) + 1}`;
    },
  };
}

/* ---------------- Arrastre de selección ---------------- */

const selDrag = {
  start(p) {
    this.before = celSnapshot();
    if (!liftSel()) { this.before = null; return false; }
    this.p0 = p;
    this.o = { x: S.float.x, y: S.float.y };
    return true;
  },
  move(p) {
    if (!this.before) return;
    S.float.x = this.o.x + p.x - this.p0.x;
    S.float.y = this.o.y + p.y - this.p0.y;
    S.sel.x = S.float.x; S.sel.y = S.float.y;
  },
  end() {
    if (!this.before) return;
    History.push({ type: 'snap', before: this.before, after: celSnapshot() });
    this.before = null;
  },
};

/* ---------------- Sello (pincel personalizado / tiles) ---------------- */

/** Esquina superior izquierda donde caería el sello para el punto p. */
function stampOrigin(p) {
  const st = S.stamp;
  if (S.stampSnap && S.tileGrid) {
    return { x: Math.floor(p.x / S.tileW) * S.tileW, y: Math.floor(p.y / S.tileH) * S.tileH };
  }
  return { x: p.x - (st.w >> 1), y: p.y - (st.h >> 1) };
}

function applyStamp(ed, o, erase) {
  const st = S.stamp;
  for (let y = 0; y < st.h; y++) for (let x = 0; x < st.w; x++) {
    const v = st.data[y * st.w + x];
    if (!cA(v)) continue;
    const X = o.x + x, Y = o.y + y;
    plot(ed.cel, X, Y, () => (erase ? 0 : v));
  }
}

/* ---------------- Definición de herramientas ---------------- */

const Tools = {
  pencil: brushTool({
    id: 'pencil', label: 'Lápiz', key: 'B', pixelPerfect: true,
    hint: 'Clic izq: color 1 · clic der: color 2 · Shift+clic: línea desde el último punto',
    colorFor: btn => { const c = btn === 2 ? S.secondary : S.primary; return () => c; },
  }),
  eraser: brushTool({
    id: 'eraser', label: 'Goma', key: 'E',
    hint: 'Borra a transparente · Shift+clic: línea',
    colorFor: () => () => 0,
  }),
  bucket: {
    id: 'bucket', label: 'Relleno', key: 'G', cell: true,
    hint: 'Rellena el área contigua · Shift+clic: reemplaza ese color en toda la capa',
    down(p, e, btn) {
      if (!canPaint(p.x, p.y)) return;
      const ed = beginEdit();
      if (!ed) return;
      const c = btn === 2 ? S.secondary : S.primary;
      if (e.shiftKey) replaceColor(ed.cel, ed.cel.data[p.y * S.doc.w + p.x], c);
      else floodFill(ed.cel, p.x, p.y, c);
      ed.cel.dirty = true;
      endEdit();
      addRecent(c);
    },
    move() {}, up() {},
  },
  picker: {
    id: 'picker', label: 'Cuentagotas', key: 'I', cell: true,
    hint: 'Clic izq: toma color 1 · clic der: color 2 · mantén Alt (o mantén el dedo quieto)',
    down(p, e, btn) { this.btn = btn; this.pick(p); },
    move(p) { this.pick(p); },
    up() {},
    pick(p) {
      if (!inBounds(p.x, p.y)) return;
      const c = colorAtComposite(p.x, p.y);
      if (!cA(c)) return;
      if (this.btn === 2) S.secondary = c; else S.primary = c;
      renderColors();
    },
  },
  dither: brushTool({
    id: 'dither', label: 'Trama', key: 'D',
    hint: 'Pinta un tablero alternando color 1 y color 2 (clic der invierte)',
    colorFor: btn => {
      const [a, b] = btn === 2 ? [S.secondary, S.primary] : [S.primary, S.secondary];
      return (x, y) => ((x + y) & 1 ? b : a);
    },
  }),
  stamp: {
    id: 'stamp', label: 'Sello', key: 'S',
    hint: 'Pinta con un trozo de dibujo o un tile · Ctrl+B: selección → sello · Ctrl+clic: copiar tile · Shift+S: ajustar a tiles',
    down(p, e, btn) {
      if (e.ctrlKey || e.metaKey) { grabTileAsStamp(p); return; }
      if (!S.stamp) { toast('Selecciona algo y pulsa Ctrl+B (o Ctrl+clic sobre un tile)'); return; }
      const ed = beginEdit(true);
      if (!ed) return;
      ed.erase = btn === 2;
      ed.lastO = null;
      this.move(p);
    },
    move(p) {
      const ed = E;
      if (!ed || !S.stamp) return;
      const o = stampOrigin(p), l = ed.lastO;
      // en modo libre, deja huecos del tamaño del sello para no emborronar
      if (l && (S.stampSnap && S.tileGrid ? (l.x === o.x && l.y === o.y)
        : (Math.abs(o.x - l.x) < S.stamp.w && Math.abs(o.y - l.y) < S.stamp.h))) return;
      applyStamp(ed, o, ed.erase);
      ed.lastO = o;
    },
    up() { endEdit(); },
  },
  line: shapeTool({
    id: 'line', label: 'Línea', key: 'L',
    hint: 'Arrastra · Shift: ángulos limpios (0°, 1:2, 45°, 2:1, 90°)',
    constrain: snapLine,
    cells(x0, y0, x1, y1, ed) { lineCells(x0, y0, x1, y1, (x, y) => stamp(ed.cel, x, y, ed.colorAt)); },
  }),
  rect: shapeTool({
    id: 'rect', label: 'Rectángulo', key: 'R', fillable: true,
    hint: 'Arrastra · Shift: cuadrado · F: relleno',
    constrain: squareEnd,
    cells(x0, y0, x1, y1, ed) {
      if (S.fillShapes) rectCells(x0, y0, x1, y1, true, (x, y) => plot(ed.cel, x, y, ed.colorAt));
      else rectCells(x0, y0, x1, y1, false, (x, y) => stamp(ed.cel, x, y, ed.colorAt));
    },
  }),
  ellipse: shapeTool({
    id: 'ellipse', label: 'Elipse', key: 'O', fillable: true,
    hint: 'Arrastra · Shift: círculo · F: relleno',
    constrain: squareEnd,
    cells(x0, y0, x1, y1, ed) {
      if (S.fillShapes) ellipseCells(x0, y0, x1, y1, true, (x, y) => plot(ed.cel, x, y, ed.colorAt));
      else ellipseCells(x0, y0, x1, y1, false, (x, y) => stamp(ed.cel, x, y, ed.colorAt));
    },
  }),
  select: {
    id: 'select', label: 'Selección', key: 'M', cell: true,
    hint: 'Arrastra para seleccionar · arrastra dentro para mover · flechas: mover 1px · Esc: quitar',
    down(p, e) {
      if (S.sel && inRect(p, S.sel) && !e.shiftKey) { this.mode = 'move'; selDrag.start(p); return; }
      commitFloat();
      this.mode = 'new'; this.p0 = p; S.sel = null;
    },
    move(p) {
      if (this.mode === 'move') selDrag.move(p);
      else if (this.mode === 'new') S.sel = rectFrom(this.p0, p);
    },
    up(p) {
      if (this.mode === 'move') selDrag.end();
      else if (this.mode === 'new') {
        S.sel = (p.x === this.p0.x && p.y === this.p0.y) || !S.sel ? null : clipRect(S.sel);
      }
      this.mode = null;
    },
  },
  move: {
    id: 'move', label: 'Mover', key: 'V',
    hint: 'Mueve la selección o, si no hay, toda la capa',
    down(p) {
      if (S.sel || S.float) { this.mode = 'sel'; selDrag.start(p); return; }
      if (!beginEdit()) return;
      this.mode = 'layer'; this.p0 = p;
    },
    move(p) {
      if (this.mode === 'sel') return selDrag.move(p);
      if (this.mode !== 'layer' || !E) return;
      shiftCel(E.cel, E.before, p.x - this.p0.x, p.y - this.p0.y);
    },
    up() {
      if (this.mode === 'sel') selDrag.end();
      else if (this.mode === 'layer') endEdit();
      this.mode = null;
    },
  },
  pan: {
    id: 'pan', label: 'Mano', key: 'H',
    hint: 'Arrastra para desplazar · también Espacio, botón central o dos dedos',
    down(p, e) { this.s = { x: e.clientX, y: e.clientY, px: V.panX, py: V.panY }; },
    move(p, e) {
      if (!this.s) return;
      V.panX = this.s.px + e.clientX - this.s.x;
      V.panY = this.s.py + e.clientY - this.s.y;
    },
    up() { this.s = null; },
  },
};
const TOOL_ORDER = ['pencil', 'eraser', 'bucket', 'picker', 'dither', 'stamp', 'line', 'rect', 'ellipse', 'select', 'move', 'pan'];
const TOOL_SEPARATORS = [6, 9];

/* ---------------- Operaciones de píxeles ---------------- */

function colorAtComposite(x, y) {
  composite();
  const px = compCtx.getImageData(x, y, 1, 1).data;
  return rgba(px[0], px[1], px[2], px[3]);
}

function floodFill(cel, sx, sy, c) {
  const { w, h } = cel, data = cel.data, target = data[sy * w + sx];
  if (sameColor(target, c)) return;
  const match = (x, y) => canPaint(x, y) && sameColor(data[y * w + x], target);
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (!match(x, y)) continue;
    let lx = x, rx = x;
    while (match(lx - 1, y)) lx--;
    while (match(rx + 1, y)) rx++;
    for (let i = lx; i <= rx; i++) data[y * w + i] = c;
    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inSpan = false;
      for (let i = lx; i <= rx; i++) {
        if (match(i, ny)) { if (!inSpan) { stack.push(i, ny); inSpan = true; } }
        else inSpan = false;
      }
    }
  }
}

function replaceColor(cel, target, c) {
  const { w } = cel, data = cel.data;
  if (sameColor(target, c)) return;
  for (let i = 0; i < data.length; i++) {
    if (sameColor(data[i], target) && canPaint(i % w, (i / w) | 0)) data[i] = c;
  }
}

function shiftCel(cel, src, dx, dy) {
  const { w, h } = cel, data = cel.data;
  data.fill(0);
  for (let y = 0; y < h; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;
    for (let x = 0; x < w; x++) {
      const nx = x + dx;
      if (nx >= 0 && nx < w) data[ny * w + nx] = src[y * w + x];
    }
  }
  cel.dirty = true;
}
