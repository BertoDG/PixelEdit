'use strict';
/* =========================================================================
 * Vista: zoom, desplazamiento y dibujado del lienzo.
 * ========================================================================= */

const V = { zoom: 12, panX: 0, panY: 0, dpr: 1 };
const ZOOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128];
let viewCanvas, viewCtx, compCanvas, compCtx, onionCanvas, onionCtx, checkerPattern, previewCanvas, previewCtx;
let renderQueued = false;
let stampCanvas = null, stampCanvasFor = null;

function initView() {
  viewCanvas = $('#view');
  viewCtx = viewCanvas.getContext('2d');
  compCanvas = document.createElement('canvas');
  compCtx = compCanvas.getContext('2d', { willReadFrequently: true });
  onionCanvas = document.createElement('canvas');
  onionCtx = onionCanvas.getContext('2d');
  previewCanvas = $('#preview');
  previewCtx = previewCanvas.getContext('2d');
  new ResizeObserver(resizeView).observe($('#viewport'));
  resizeView();
}

function resizeView() {
  const r = $('#viewport').getBoundingClientRect();
  V.dpr = window.devicePixelRatio || 1;
  viewCanvas.width = Math.max(1, Math.round(r.width * V.dpr));
  viewCanvas.height = Math.max(1, Math.round(r.height * V.dpr));
  viewCanvas.style.width = r.width + 'px';
  viewCanvas.style.height = r.height + 'px';
  makeChecker();
  if (S.doc && !V.fitted) fitView();
  requestRender();
}

function makeChecker() {
  const s = Math.max(4, Math.round(8 * V.dpr));
  const c = document.createElement('canvas');
  c.width = c.height = s * 2;
  const x = c.getContext('2d');
  x.fillStyle = '#c9c9d2'; x.fillRect(0, 0, s * 2, s * 2);
  x.fillStyle = '#e9e9ef'; x.fillRect(0, 0, s, s); x.fillRect(s, s, s, s);
  checkerPattern = viewCtx.createPattern(c, 'repeat');
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

function screenToDoc(clientX, clientY) {
  const r = viewCanvas.getBoundingClientRect();
  const fx = (clientX - r.left - V.panX) / V.zoom, fy = (clientY - r.top - V.panY) / V.zoom;
  return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
}

function zoomTo(z, cx, cy) {
  const r = viewCanvas.getBoundingClientRect();
  if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
  z = clamp(z, 0.05, 200);
  const dx = (cx - V.panX) / V.zoom, dy = (cy - V.panY) / V.zoom;
  V.zoom = z;
  V.panX = Math.round(cx - dx * z);
  V.panY = Math.round(cy - dy * z);
  requestRender(); updateStatus();
}
function zoomStep(dir, cx, cy) {
  let z;
  if (dir > 0) z = ZOOMS.find(v => v > V.zoom + 1e-6) ?? V.zoom * 1.25;
  else z = [...ZOOMS].reverse().find(v => v < V.zoom - 1e-6) ?? V.zoom / 1.25;
  zoomTo(z, cx, cy);
}
function fitView() {
  if (!S.doc || !viewCanvas) return;
  const r = $('#viewport').getBoundingClientRect();
  if (!r.width || !r.height) return;
  V.fitted = true;
  const fit = Math.min(r.width * 0.9 / S.doc.w, r.height * 0.9 / S.doc.h);
  const z = fit >= 1 ? (ZOOMS.filter(v => v <= fit).pop() || 1) : fit;
  V.zoom = z;
  V.panX = Math.round((r.width - S.doc.w * z) / 2);
  V.panY = Math.round((r.height - S.doc.h * z) / 2);
  requestRender(); updateStatus();
}
/** Centra la vista en un punto del documento. */
function centerOn(x, y) {
  const r = $('#viewport').getBoundingClientRect();
  V.panX = Math.round(r.width / 2 - x * V.zoom);
  V.panY = Math.round(r.height / 2 - y * V.zoom);
  requestRender();
}

function composite() {
  const d = S.doc;
  if (compCanvas.width !== d.w || compCanvas.height !== d.h) { compCanvas.width = d.w; compCanvas.height = d.h; }
  compCtx.clearRect(0, 0, d.w, d.h);
  drawFrame(compCtx, d.frame, true);
}

function drawOnion(ctx, x, y, dw, dh) {
  const d = S.doc;
  if (!S.onion || S.playing || d.frames.length < 2) return;
  if (onionCanvas.width !== d.w || onionCanvas.height !== d.h) { onionCanvas.width = d.w; onionCanvas.height = d.h; }
  const list = [[d.frame - 1, 'rgba(255,70,90,1)'], [d.frame + 1, 'rgba(60,150,255,1)']];
  for (const [f, tint] of list) {
    if (f < 0 || f >= d.frames.length) continue;
    onionCtx.globalCompositeOperation = 'source-over';
    onionCtx.clearRect(0, 0, d.w, d.h);
    drawFrame(onionCtx, f, false);
    onionCtx.globalCompositeOperation = 'source-atop';
    onionCtx.globalAlpha = 0.45;
    onionCtx.fillStyle = tint;
    onionCtx.fillRect(0, 0, d.w, d.h);
    onionCtx.globalAlpha = 1;
    onionCtx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.4;
    ctx.drawImage(onionCanvas, x, y, dw, dh);
    ctx.globalAlpha = 1;
  }
}

function render() {
  if (!S.doc) return;
  composite();
  const ctx = viewCtx, d = S.doc, dpr = V.dpr;
  const W = viewCanvas.width, H = viewCanvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#16171d';
  ctx.fillRect(0, 0, W, H);

  const z = V.zoom * dpr, ox = Math.round(V.panX * dpr), oy = Math.round(V.panY * dpr);
  const dw = Math.round(d.w * z), dh = Math.round(d.h * z);
  const tiles = S.tile ? [-1, 0, 1] : [0];
  for (const ty of tiles) for (const tx of tiles) {
    const x = ox + tx * dw, y = oy + ty * dh;
    if (x > W || y > H || x + dw < 0 || y + dh < 0) continue;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = checkerPattern; ctx.fillRect(0, 0, dw, dh);
    ctx.restore();
    if (!tx && !ty) drawOnion(ctx, x, y, dw, dh);
    ctx.drawImage(compCanvas, x, y, dw, dh);
    if (tx || ty) { ctx.fillStyle = 'rgba(22,23,29,0.35)'; ctx.fillRect(x, y, dw, dh); }
  }

  // Solo dibujamos las líneas visibles (importante en escenarios grandes)
  const vx0 = Math.max(0, Math.floor(-ox / z)), vy0 = Math.max(0, Math.floor(-oy / z));
  const vx1 = Math.min(d.w, Math.ceil((W - ox) / z)), vy1 = Math.min(d.h, Math.ceil((H - oy) / z));
  const gridLines = (stepX, stepY, style) => {
    ctx.beginPath();
    for (let i = Math.max(stepX, Math.ceil(vx0 / stepX) * stepX); i < vx1; i += stepX) {
      const X = Math.round(ox + i * z) + 0.5; ctx.moveTo(X, Math.max(0, oy)); ctx.lineTo(X, Math.min(H, oy + dh));
    }
    for (let j = Math.max(stepY, Math.ceil(vy0 / stepY) * stepY); j < vy1; j += stepY) {
      const Y = Math.round(oy + j * z) + 0.5; ctx.moveTo(Math.max(0, ox), Y); ctx.lineTo(Math.min(W, ox + dw), Y);
    }
    ctx.strokeStyle = style; ctx.lineWidth = 1; ctx.stroke();
  };
  if (S.grid && V.zoom >= 6) gridLines(1, 1, 'rgba(40,40,60,0.16)');
  if (S.tileGrid && S.tileW * V.zoom >= 4) gridLines(S.tileW, S.tileH, 'rgba(70,90,220,0.55)');
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.strokeRect(ox - 0.5, oy - 0.5, dw + 1, dh + 1);

  // Ejes de simetría
  if (S.mirrorX || S.mirrorY) {
    ctx.save();
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.strokeStyle = 'rgba(0,200,255,0.85)';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    if (S.mirrorX) { const X = Math.round(ox + dw / 2) + 0.5; ctx.moveTo(X, oy - 8 * dpr); ctx.lineTo(X, oy + dh + 8 * dpr); }
    if (S.mirrorY) { const Y = Math.round(oy + dh / 2) + 0.5; ctx.moveTo(ox - 8 * dpr, Y); ctx.lineTo(ox + dw + 8 * dpr, Y); }
    ctx.stroke();
    ctx.restore();
  }

  // Selección
  if (S.sel) {
    const r = S.sel;
    const x = Math.round(ox + r.x * z) + 0.5, y = Math.round(oy + r.y * z) + 0.5;
    const w = Math.round(r.w * z) - 1, hh = Math.round(r.h * z) - 1;
    ctx.save();
    ctx.lineWidth = Math.max(1, Math.round(dpr));
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.strokeStyle = '#fff'; ctx.strokeRect(x, y, w, hh);
    ctx.lineDashOffset = 4 * dpr;
    ctx.strokeStyle = '#000'; ctx.strokeRect(x, y, w, hh);
    ctx.restore();
  }

  drawCursor(ctx, ox, oy, z);
  renderPreview();
}

function drawCursor(ctx, ox, oy, z) {
  const p = S.hover;
  if (!p || dragState?.tool === 'pan' || S.playing) return;
  const tool = Tools[currentToolId()];
  if (!tool) return;
  if (tool.id === 'stamp') {
    if (!S.stamp) return;
    if (stampCanvasFor !== S.stamp) { stampCanvas = u32ToCanvas(S.stamp.data, S.stamp.w, S.stamp.h); stampCanvasFor = S.stamp; }
    const o = stampOrigin(p);
    ctx.globalAlpha = 0.6;
    ctx.drawImage(stampCanvas, Math.round(ox + o.x * z), Math.round(oy + o.y * z), Math.round(S.stamp.w * z), Math.round(S.stamp.h * z));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(108,140,255,0.9)';
    ctx.strokeRect(Math.round(ox + o.x * z) + 0.5, Math.round(oy + o.y * z) + 0.5, Math.round(S.stamp.w * z) - 1, Math.round(S.stamp.h * z) - 1);
    return;
  }
  const cells = [];
  if (tool.brush) {
    for (const [dx, dy] of brushOffsets(S.brushSize, S.brushRound)) {
      for (const pt of mirrorPoints(p.x + dx, p.y + dy)) cells.push(pt);
    }
  } else if (tool.cell) {
    cells.push([p.x, p.y]);
  } else return;
  ctx.save();
  if (tool.id === 'eraser') {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
  } else {
    const c = S.primary;
    ctx.fillStyle = cA(c) ? u32ToCss(withAlpha(c, Math.min(cA(c), 200))) : 'rgba(255,255,255,0.35)';
  }
  for (const [x, y] of cells) {
    ctx.fillRect(Math.round(ox + x * z), Math.round(oy + y * z), Math.ceil(z), Math.ceil(z));
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.strokeRect(Math.round(ox + p.x * z) + 0.5, Math.round(oy + p.y * z) + 0.5, Math.ceil(z) - 1, Math.ceil(z) - 1);
  ctx.restore();
}

let previewGeom = null;
function renderPreview() {
  if (!previewCanvas.offsetParent) return; // panel oculto
  const d = S.doc;
  const cw = previewCanvas.clientWidth || 228, ch = 120;
  const dpr = V.dpr;
  if (previewCanvas.width !== Math.round(cw * dpr)) {
    previewCanvas.width = Math.round(cw * dpr);
    previewCanvas.height = Math.round(ch * dpr);
  }
  const ctx = previewCtx, W = previewCanvas.width, H = previewCanvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#101116'; ctx.fillRect(0, 0, W, H);
  let s = Math.min(W / d.w, H / d.h);
  if (s >= 1) s = Math.floor(s);
  const w = Math.round(d.w * s), hh = Math.round(d.h * s);
  const x = Math.round((W - w) / 2), y = Math.round((H - hh) / 2);
  previewGeom = { x: x / dpr, y: y / dpr, s: s / dpr };
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = checkerPattern; ctx.fillRect(0, 0, w, hh); ctx.restore();
  ctx.drawImage(compCanvas, x, y, w, hh);
  // Rectángulo de la zona visible
  const r = $('#viewport').getBoundingClientRect();
  const vx = -V.panX / V.zoom, vy = -V.panY / V.zoom, vw = r.width / V.zoom, vh = r.height / V.zoom;
  if (vx > 0 || vy > 0 || vw < d.w || vh < d.h) {
    ctx.strokeStyle = '#6c8cff';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeRect(x + vx * s, y + vy * s, vw * s, vh * s);
  }
}

/** Clic/arrastre en la vista previa: navega por el escenario. */
function initPreviewNav() {
  const go = e => {
    if (!previewGeom) return;
    const r = previewCanvas.getBoundingClientRect();
    centerOn((e.clientX - r.left - previewGeom.x) / previewGeom.s, (e.clientY - r.top - previewGeom.y) / previewGeom.s);
  };
  previewCanvas.addEventListener('pointerdown', e => { previewCanvas.setPointerCapture(e.pointerId); go(e); });
  previewCanvas.addEventListener('pointermove', e => { if (e.buttons) go(e); });
}
