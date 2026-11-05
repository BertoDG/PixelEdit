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
function plot(layer, x, y, colorAt) {
  for (const [mx, my] of mirrorPoints(x, y)) {
    if (canPaint(mx, my)) layer.data[my * S.doc.w + mx] = colorAt(mx, my);
  }
}
function stamp(layer, x, y, colorAt, size = S.brushSize) {
  for (const [dx, dy] of brushOffsets(size, S.brushRound)) plot(layer, x + dx, y + dy, colorAt);
}

/* Sesión de edición sobre la capa activa (un trazo = un paso de historial) */
let E = null;
function beginEdit() {
  commitFloat();
  const layer = activeLayer();
  E = { layer, before: layer.data.slice() };
  return E;
}
function revertEdit() { E.layer.data.set(E.before); E.layer.dirty = true; }
function endEdit() {
  if (!E) return;
  const entry = diffEntry(E.layer, E.before);
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
      const ed = beginEdit();
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
        ed.layer.dirty = true;
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
      ed.layer.dirty = true;
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
            if (inBounds(mx, my)) { const i = my * S.doc.w + mx; ed.layer.data[i] = ed.before[i]; }
          }
          ed.pts.splice(n - 2, 1);
        }
      }
      if (ed.pts.length > 64) ed.pts.splice(0, ed.pts.length - 8);
      stamp(ed.layer, x, y, ed.colorAt);
    },
  };
}

function shapeTool(def) {
  return {
    brush: true,
    ...def,
    down(p, e, btn) {
      const ed = beginEdit();
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
      ed.layer.dirty = true;
    },
  };
}

/* ---------------- Arrastre de selección ---------------- */

const selDrag = {
  start(p) {
    this.before = snapshot();
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
    History.push({ type: 'snap', before: this.before, after: snapshot() });
    this.before = null;
  },
};

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
  dither: brushTool({
    id: 'dither', label: 'Trama', key: 'D',
    hint: 'Pinta un tablero alternando color 1 y color 2 (clic der invierte)',
    colorFor: btn => {
      const [a, b] = btn === 2 ? [S.secondary, S.primary] : [S.primary, S.secondary];
      return (x, y) => ((x + y) & 1 ? b : a);
    },
  }),
  bucket: {
    id: 'bucket', label: 'Relleno', key: 'G', cell: true,
    hint: 'Rellena el área contigua · Shift+clic: reemplaza ese color en toda la capa',
    down(p, e, btn) {
      if (!canPaint(p.x, p.y)) return;
      const ed = beginEdit();
      const c = btn === 2 ? S.secondary : S.primary;
      if (e.shiftKey) replaceColor(ed.layer, ed.layer.data[p.y * S.doc.w + p.x], c);
      else floodFill(ed.layer, p.x, p.y, c);
      ed.layer.dirty = true;
      endEdit();
      addRecent(c);
    },
    move() {}, up() {},
  },
  picker: {
    id: 'picker', label: 'Cuentagotas', key: 'I', cell: true,
    hint: 'Clic izq: toma color 1 · clic der: color 2 · mantén Alt con cualquier herramienta',
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
  line: shapeTool({
    id: 'line', label: 'Línea', key: 'L',
    hint: 'Arrastra · Shift: ángulos limpios (0°, 1:2, 45°, 2:1, 90°)',
    constrain: snapLine,
    cells(x0, y0, x1, y1, ed) { lineCells(x0, y0, x1, y1, (x, y) => stamp(ed.layer, x, y, ed.colorAt)); },
  }),
  rect: shapeTool({
    id: 'rect', label: 'Rectángulo', key: 'R', fillable: true,
    hint: 'Arrastra · Shift: cuadrado · F: relleno',
    constrain: squareEnd,
    cells(x0, y0, x1, y1, ed) {
      if (S.fillShapes) rectCells(x0, y0, x1, y1, true, (x, y) => plot(ed.layer, x, y, ed.colorAt));
      else rectCells(x0, y0, x1, y1, false, (x, y) => stamp(ed.layer, x, y, ed.colorAt));
    },
  }),
  ellipse: shapeTool({
    id: 'ellipse', label: 'Elipse', key: 'O', fillable: true,
    hint: 'Arrastra · Shift: círculo · F: relleno',
    constrain: squareEnd,
    cells(x0, y0, x1, y1, ed) {
      if (S.fillShapes) ellipseCells(x0, y0, x1, y1, true, (x, y) => plot(ed.layer, x, y, ed.colorAt));
      else ellipseCells(x0, y0, x1, y1, false, (x, y) => stamp(ed.layer, x, y, ed.colorAt));
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
        S.sel = (p.x === this.p0.x && p.y === this.p0.y) ? null : clipRect(S.sel);
      }
      this.mode = null;
    },
  },
  move: {
    id: 'move', label: 'Mover', key: 'V',
    hint: 'Mueve la selección o, si no hay, toda la capa · flechas: 1px',
    down(p) {
      if (S.sel || S.float) { this.mode = 'sel'; selDrag.start(p); return; }
      this.mode = 'layer'; beginEdit(); this.p0 = p;
    },
    move(p) {
      if (this.mode === 'sel') return selDrag.move(p);
      if (this.mode !== 'layer' || !E) return;
      shiftLayer(E.layer, E.before, p.x - this.p0.x, p.y - this.p0.y);
    },
    up() {
      if (this.mode === 'sel') selDrag.end();
      else if (this.mode === 'layer') endEdit();
      this.mode = null;
    },
  },
  pan: {
    id: 'pan', label: 'Mano', key: 'H',
    hint: 'Arrastra para desplazar · también Espacio o botón central',
    down(p, e) { this.s = { x: e.clientX, y: e.clientY, px: V.panX, py: V.panY }; },
    move(p, e) {
      if (!this.s) return;
      V.panX = this.s.px + e.clientX - this.s.x;
      V.panY = this.s.py + e.clientY - this.s.y;
    },
    up() { this.s = null; },
  },
};
const TOOL_ORDER = ['pencil', 'eraser', 'bucket', 'picker', 'dither', 'line', 'rect', 'ellipse', 'select', 'move', 'pan'];

/* ---------------- Operaciones de píxeles ---------------- */

function colorAtComposite(x, y) {
  composite();
  const px = compCtx.getImageData(x, y, 1, 1).data;
  return rgba(px[0], px[1], px[2], px[3]);
}

function floodFill(layer, sx, sy, c) {
  const { w, h } = S.doc, data = layer.data, target = data[sy * w + sx];
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

function replaceColor(layer, target, c) {
  const { w } = S.doc, data = layer.data;
  if (sameColor(target, c)) return;
  for (let i = 0; i < data.length; i++) {
    if (sameColor(data[i], target) && canPaint(i % w, (i / w) | 0)) data[i] = c;
  }
}

function shiftLayer(layer, src, dx, dy) {
  const { w, h } = S.doc, data = layer.data;
  data.fill(0);
  for (let y = 0; y < h; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;
    for (let x = 0; x < w; x++) {
      const nx = x + dx;
      if (nx >= 0 && nx < w) data[ny * w + nx] = src[y * w + x];
    }
  }
  layer.dirty = true;
}
