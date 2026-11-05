'use strict';
/* =========================================================================
 * Animación: fotogramas, línea de tiempo, reproducción y exportación.
 * ========================================================================= */

function goFrame(i) {
  const d = S.doc, n = d.frames.length;
  i = ((i % n) + n) % n;
  if (i === d.frame) return;
  commitFloat();
  d.frame = i;
}

function addFrame(duplicate) {
  stopPlayback();
  commitFloat();
  doSnap(() => {
    const d = S.doc, at = d.frame + 1;
    d.frames.splice(at, 0, makeFrame(d.frames[d.frame].duration));
    for (const l of d.layers) {
      const src = l.cels[d.frame];
      l.cels.splice(at, 0, new Cel(d.w, d.h, duplicate ? src.data.slice() : undefined));
    }
    d.frame = at;
  });
  toast(duplicate ? `Fotograma ${S.doc.frame + 1} duplicado` : `Fotograma ${S.doc.frame + 1} nuevo`);
}

function deleteFrame() {
  stopPlayback();
  commitFloat();
  const d = S.doc;
  if (d.frames.length <= 1) return toast('Es el único fotograma');
  doSnap(() => {
    d.frames.splice(d.frame, 1);
    for (const l of d.layers) l.cels.splice(d.frame, 1);
    d.frame = Math.min(d.frame, d.frames.length - 1);
  });
}

function moveFrame(dir) {
  commitFloat();
  const d = S.doc, j = d.frame + dir;
  if (j < 0 || j >= d.frames.length) return;
  doSnap(() => {
    const sw = a => { [a[d.frame], a[j]] = [a[j], a[d.frame]]; };
    sw(d.frames);
    for (const l of d.layers) sw(l.cels);
    d.frame = j;
  });
}

function setAllDurations(ms) {
  ms = clamp(Math.round(ms) || 100, 10, 10000);
  doSnap(() => { for (const f of S.doc.frames) f.duration = ms; });
}
function setFrameDuration(ms) {
  ms = clamp(Math.round(ms) || 100, 10, 10000);
  doSnap(() => { S.doc.frames[S.doc.frame].duration = ms; });
}

/* ---------------- Reproducción ---------------- */

let playRAF = 0;
function togglePlayback() {
  if (S.playing) return stopPlayback();
  if (S.doc.frames.length < 2) return toast('Añade fotogramas para animar (Alt+D duplica)');
  commitFloat();
  S.playing = true;
  let last = performance.now(), acc = 0;
  const tick = now => {
    if (!S.playing) return;
    acc += now - last; last = now;
    const d = S.doc;
    let changed = false;
    while (acc >= d.frames[d.frame].duration) {
      acc -= d.frames[d.frame].duration;
      d.frame = (d.frame + 1) % d.frames.length;
      changed = true;
    }
    if (changed) { render(); updateTimelineActive(); updateStatus(); }
    playRAF = requestAnimationFrame(tick);
  };
  playRAF = requestAnimationFrame(tick);
  updateTimelineActive();
}
function stopPlayback() {
  if (!S.playing) return;
  S.playing = false;
  cancelAnimationFrame(playRAF);
  refreshAll();
}

/* ---------------- Línea de tiempo ---------------- */

function buildTimeline() {
  const bind = (sel, id) => { $(sel).onclick = () => runCommand(id); };
  bind('#tl-play', 'anim.play'); bind('#tl-prev', 'frame.prev'); bind('#tl-next', 'frame.next');
  bind('#tl-add', 'frame.new'); bind('#tl-dup', 'frame.dup'); bind('#tl-del', 'frame.del');
  bind('#tl-onion', 'anim.onion');
  const fps = $('#tl-fps');
  fps.addEventListener('change', () => {
    const v = clamp(+fps.value || 10, 1, 60);
    setAllDurations(1000 / v);
    refreshAll();
  });
  fps.addEventListener('keydown', e => { if (e.key === 'Enter') fps.blur(); });
}

function renderTimeline() {
  const d = S.doc, box = $('#frames');
  $('#tl-play').innerHTML = S.playing ? '❚❚' : '▶';
  $('#tl-onion').classList.toggle('on', S.onion);
  const fps = $('#tl-fps');
  if (document.activeElement !== fps) fps.value = Math.round(1000 / d.frames[d.frame].duration);
  $('#tl-info').textContent = `${d.frame + 1} / ${d.frames.length}`;
  box.innerHTML = '';
  const th = 40;
  const s = Math.min(th / d.w, th / d.h);
  d.frames.forEach((f, i) => {
    const cv = h('canvas', { class: 'fthumb', width: Math.max(1, Math.round(d.w * s)), height: Math.max(1, Math.round(d.h * s)) });
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.scale(s, s);
    drawFrame(ctx, i, i === d.frame);
    const custom = Math.round(f.duration) !== Math.round(d.frames[0].duration);
    box.append(h('button', {
      class: 'frame' + (i === d.frame ? ' active' : ''), 'data-i': String(i),
      title: `Fotograma ${i + 1} · ${Math.round(f.duration)} ms\nDoble clic: cambiar duración`,
      onclick: () => { stopPlayback(); goFrame(i); refreshAll(); },
      ondblclick: () => dlgFrameDuration(),
    }, cv, h('span', { class: 'fnum' }, String(i + 1)), custom ? h('span', { class: 'fdur' }, Math.round(f.duration) + 'ms') : null));
  });
  box.querySelector('.frame.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function updateTimelineActive() {
  const d = S.doc;
  document.querySelectorAll('#frames .frame').forEach(b => b.classList.toggle('active', +b.dataset.i === d.frame));
  $('#tl-play').innerHTML = S.playing ? '❚❚' : '▶';
  $('#tl-info').textContent = `${d.frame + 1} / ${d.frames.length}`;
}

function toggleTimeline() {
  S.timeline = !S.timeline;
  $('#app').classList.toggle('no-timeline', !S.timeline);
  savePrefs();
}

function dlgFrameDuration() {
  const f = S.doc.frames[S.doc.frame];
  const ms = numField('Duración (ms)', Math.round(f.duration), 10, 10000);
  const all = h('input', { type: 'checkbox' });
  openDialog(`Fotograma ${S.doc.frame + 1}`, [ms.row, h('label', { class: 'check' }, all, ' Aplicar a todos los fotogramas'),
    h('p', { class: 'muted' }, '100 ms = 10 fps · 83 ms ≈ 12 fps · 42 ms ≈ 24 fps')],
  [{ label: 'Cancelar' }, { label: 'Aplicar', primary: true, run: () => { all.checked ? setAllDurations(+ms.input.value) : setFrameDuration(+ms.input.value); } }]);
}

/* ---------------- Exportación ---------------- */

/** Entrega un archivo: en móvil usa el menú Compartir (guardar en Fotos, etc.). */
async function deliver(blob, name) {
  if (S.mobile && navigator.canShare) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }
  }
  download(blob, name);
}

function exportGIF(scale) {
  const d = S.doc;
  const frames = d.frames.map((f, i) => ({ data: frameData(i), delay: f.duration }));
  const bytes = encodeGIF(frames, d.w, d.h, scale);
  deliver(new Blob([bytes], { type: 'image/gif' }), `${S.fileName}${scale > 1 ? '@' + scale + 'x' : ''}.gif`);
  toast(`GIF exportado (${frames.length} fotogramas)`);
}

function exportSpritesheet(scale, cols) {
  const d = S.doc, n = d.frames.length;
  cols = clamp(cols || n, 1, n);
  const rows = Math.ceil(n / cols);
  const c = h('canvas', { width: d.w * cols * scale, height: d.h * rows * scale });
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tmp = h('canvas', { width: d.w, height: d.h }), tctx = tmp.getContext('2d');
  for (let i = 0; i < n; i++) {
    tctx.clearRect(0, 0, d.w, d.h);
    drawFrame(tctx, i, true);
    ctx.drawImage(tmp, (i % cols) * d.w * scale, Math.floor(i / cols) * d.h * scale, d.w * scale, d.h * scale);
  }
  c.toBlob(b => deliver(b, `${S.fileName}-sheet${scale > 1 ? '@' + scale + 'x' : ''}.png`));
  toast(`Hoja de sprites ${cols}×${rows}`);
}

function exportPNG(scale = 1) {
  S.exportScale = scale;
  composite();
  const d = S.doc;
  const c = h('canvas', { width: d.w * scale, height: d.h * scale });
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(compCanvas, 0, 0, d.w * scale, d.h * scale);
  const suffix = d.frames.length > 1 ? `-f${d.frame + 1}` : '';
  c.toBlob(b => deliver(b, `${S.fileName}${suffix}${scale > 1 ? '@' + scale + 'x' : ''}.png`));
  toast(`PNG exportado ×${scale}`);
  savePrefs();
}

function dlgExport() {
  const d = S.doc;
  let scale = S.exportScale || 1;
  let format = d.frames.length > 1 ? (S.exportFormat || 'gif') : 'png';
  const name = h('input', { type: 'text', value: S.fileName });
  const info = h('p', { class: 'muted' });
  const fmts = h('div', { class: 'presets' });
  const scales = h('div', { class: 'presets' });
  const cols = numField('Columnas', Math.min(d.frames.length, S.sheetCols || d.frames.length), 1, d.frames.length);
  const draw = () => {
    fmts.innerHTML = '';
    [['png', d.frames.length > 1 ? 'PNG (fotograma actual)' : 'PNG'], ['gif', 'GIF animado'], ['sheet', 'Hoja de sprites']].forEach(([k, l]) =>
      fmts.append(h('button', { type: 'button', class: k === format ? 'on' : '', onclick: () => { format = k; draw(); } }, l)));
    scales.innerHTML = '';
    [1, 2, 4, 8, 10, 16].forEach(s => scales.append(h('button', {
      type: 'button', class: s === scale ? 'on' : '', onclick: () => { scale = s; draw(); },
    }, '×' + s)));
    cols.row.style.display = format === 'sheet' ? '' : 'none';
    const c = clamp(+cols.input.value || 1, 1, d.frames.length);
    info.textContent = format === 'sheet'
      ? `Resultado: ${d.w * c * scale}×${d.h * Math.ceil(d.frames.length / c) * scale} px`
      : `Resultado: ${d.w * scale}×${d.h * scale} px${format === 'gif' ? ` · ${d.frames.length} fotogramas` : ''}`;
  };
  cols.input.addEventListener('input', draw);
  draw();
  openDialog('Exportar', [h('label', { class: 'field' }, h('span', {}, 'Nombre'), name),
    h('div', { class: 'field' }, h('span', {}, 'Formato'), fmts),
    h('div', { class: 'field' }, h('span', {}, 'Escala'), scales), cols.row, info],
  [{ label: 'Cancelar' }, { label: 'Exportar', primary: true, run: () => {
    S.fileName = name.value.trim() || 'pixel-art';
    S.exportScale = scale; S.exportFormat = format;
    if (format === 'gif') exportGIF(scale);
    else if (format === 'sheet') { S.sheetCols = +cols.input.value; exportSpritesheet(scale, +cols.input.value); }
    else exportPNG(scale);
    savePrefs();
  } }]);
}

function quickExport() {
  const f = S.exportFormat || 'png', s = S.exportScale || 1;
  if (f === 'gif' && S.doc.frames.length > 1) exportGIF(s);
  else if (f === 'sheet' && S.doc.frames.length > 1) exportSpritesheet(s, S.sheetCols);
  else exportPNG(s);
}
