'use strict';
/* =========================================================================
 * Interfaz: barra de herramientas, paneles, diálogos, paleta de comandos.
 * ========================================================================= */

const DEFAULT_PALETTE = [
  '#0d0b14', '#2b2838', '#4a4659', '#77738a', '#a9a6b8', '#e0dfe8', '#ffffff',
  '#4a1626', '#8c2a3a', '#d0444c', '#f2827a', '#c0506a', '#f0a0d8',
  '#6b3418', '#b8612a', '#ec9a3e', '#f8cf7a', '#f2ec8b',
  '#163a32', '#23603a', '#4f9a3a', '#9ccc4a',
  '#2a8a8a', '#5ad0c8', '#b4f0e8',
  '#1c3a6e', '#2f62c0', '#5aa0f0', '#a8d4ff',
  '#3a2260', '#6b3fa0', '#b06ad8',
  '#4a2c26', '#7a4a3a', '#c88a6a', '#f2c8a4',
].map(c => hexToU32(c));

function icon(name) {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
}

function refreshAll() {
  renderToolbar();
  renderToolOptions();
  renderColors();
  renderPalette();
  renderLayers();
  updateStatus();
  updateCursor();
  requestRender();
}

/* ---------------- Barra de herramientas ---------------- */

function buildToolbar() {
  const bar = $('#toolbar');
  bar.innerHTML = '';
  TOOL_ORDER.forEach((id, i) => {
    const t = Tools[id];
    if (i === 5 || i === 8) bar.append(h('div', { class: 'sep' }));
    bar.append(h('button', {
      class: 'tool', 'data-tool': id, title: `${t.label} (${t.key})\n${t.hint}`,
      html: icon(id) + `<span class="k">${t.key}</span>`,
      onclick: () => { setTool(id); refreshAll(); },
    }));
  });
}
function renderToolbar() {
  const cur = currentToolId();
  document.querySelectorAll('#toolbar .tool').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === S.tool);
    b.classList.toggle('temp', b.dataset.tool === cur && cur !== S.tool);
  });
}

function chip(label, key, on, run, title) {
  return h('button', {
    class: 'chip' + (on ? ' on' : ''), title: title || `${label}${key ? ' (' + key + ')' : ''}`,
    onclick: () => { run(); refreshAll(); },
  }, label, key ? h('kbd', {}, key) : null);
}

function renderToolOptions() {
  const t = Tools[S.tool], box = $('#tool-options');
  box.innerHTML = '';
  box.append(h('span', { class: 'opt-title' }, t.label));
  if (t.brush) {
    box.append(h('div', { class: 'stepper', title: 'Tamaño del pincel ( [ ] o , . o Shift+rueda )' },
      h('button', { onclick: () => { setBrush(S.brushSize - 1); refreshAll(); } }, '−'),
      h('span', {}, S.brushSize + ' px'),
      h('button', { onclick: () => { setBrush(S.brushSize + 1); refreshAll(); } }, '+')));
    if (S.brushSize > 2) box.append(chip(S.brushRound ? 'Redondo' : 'Cuadrado', 'Shift+B', false, () => CmdById['brush.shape'].run()));
  }
  if (t.id === 'pencil') box.append(chip('Pixel perfect', 'P', S.pixelPerfect, () => CmdById['brush.pp'].run()));
  if (t.fillable) box.append(chip('Relleno', 'F', S.fillShapes, () => CmdById['brush.fill'].run()));
  if (t.brush || t.id === 'bucket') {
    box.append(chip('↔', 'Shift+X', S.mirrorX, () => CmdById['mirror.x'].run(), 'Simetría izquierda/derecha (Shift+X)'));
    box.append(chip('↕', 'Shift+Y', S.mirrorY, () => CmdById['mirror.y'].run(), 'Simetría arriba/abajo (Shift+Y)'));
  }
  box.append(h('span', { class: 'opt-hint' }, t.hint));
}

/* ---------------- Colores ---------------- */

function swatchStyle(c) {
  return cA(c) ? `background:${u32ToCss(c)}` : '';
}

function renderColors() {
  const p = $('#sw-primary'), s = $('#sw-secondary');
  p.innerHTML = `<i style="${swatchStyle(S.primary)}"></i>`;
  s.innerHTML = `<i style="${swatchStyle(S.secondary)}"></i>`;
  const hex = $('#hex-input');
  if (document.activeElement !== hex) hex.value = u32ToHex(S.primary).slice(1);
  $('#alpha-input').value = cA(S.primary);
  $('#alpha-val').textContent = Math.round(cA(S.primary) / 2.55) + '%';
  const ramp = $('#ramp');
  ramp.innerHTML = '';
  shadeRamp(S.primary).forEach((c, i) => {
    ramp.append(h('button', {
      class: 'sw' + (i === 3 ? ' cur' : ''), style: swatchStyle(c), title: u32ToHex(c),
      onclick: () => { S.primary = c; renderColors(); renderPalette(); },
      oncontextmenu: ev => { ev.preventDefault(); S.secondary = c; renderColors(); },
    }));
  });
  document.querySelectorAll('#palette .sw').forEach(el => el.classList.toggle('cur', +el.dataset.c === S.primary));
}

function buildColorPanel() {
  $('#sw-primary').onclick = () => openColorPicker('primary');
  $('#sw-secondary').onclick = () => openColorPicker('secondary');
  $('#swap-colors').onclick = () => runCommand('color.swap');
  $('#hex-input').addEventListener('input', e => {
    const c = hexToU32(e.target.value, cA(S.primary) || 255);
    if (c != null) { S.primary = c; renderColors(); renderPalette(); requestRender(); }
  });
  $('#hex-input').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('#alpha-input').addEventListener('input', e => {
    S.primary = withAlpha(S.primary, +e.target.value); renderColors();
  });
  const ci = $('#color-input');
  ci.addEventListener('input', () => {
    const c = hexToU32(ci.value, 255);
    if (ci._target === 'secondary') S.secondary = withAlpha(c, cA(S.secondary) || 255);
    else S.primary = withAlpha(c, cA(S.primary) || 255);
    renderColors(); renderPalette(); requestRender();
  });
  $('#pal-add').onclick = () => runCommand('color.add');
  $('#pal-menu').onclick = () => openCommandPalette('paleta');
}

function openColorPicker(which) {
  const ci = $('#color-input');
  ci._target = which;
  ci.value = u32ToHex(which === 'secondary' ? S.secondary : S.primary);
  ci.click();
}

function renderPalette() {
  const box = $('#palette');
  box.innerHTML = '';
  S.palette.forEach((c, i) => {
    box.append(h('button', {
      class: 'sw' + (c === S.primary ? ' cur' : ''), style: swatchStyle(c), 'data-c': String(c),
      title: `${u32ToHex(c)}${i < 9 ? ' · tecla ' + (i + 1) : ''}\nClic: color 1 · Clic der: color 2 · Ctrl+clic: quitar`,
      onclick: e => {
        if (e.ctrlKey || e.metaKey) { S.palette.splice(i, 1); savePrefs(); renderPalette(); return; }
        S.primary = c; renderColors(); renderPalette(); requestRender();
      },
      oncontextmenu: e => { e.preventDefault(); S.secondary = c; renderColors(); },
    }, i < 9 ? h('span', { class: 'n' }, String(i + 1)) : null));
  });
}

function renderRecent() {
  const box = $('#recent');
  box.innerHTML = '';
  if (!S.recent.length) box.append(h('span', { class: 'muted' }, 'Los colores que uses aparecerán aquí'));
  S.recent.forEach(c => box.append(h('button', {
    class: 'sw', style: swatchStyle(c), title: u32ToHex(c),
    onclick: () => { S.primary = c; renderColors(); renderPalette(); },
    oncontextmenu: e => { e.preventDefault(); S.secondary = c; renderColors(); },
  })));
}

function addToPalette() {
  if (S.palette.includes(S.primary)) return toast('Ese color ya está en la paleta');
  S.palette.push(S.primary); savePrefs(); toast('Color añadido a la paleta');
}
function shiftShade(dir) {
  const r = shadeRamp(S.primary, 1);
  S.primary = dir < 0 ? r[0] : r[2];
}
function cyclePalette(dir) {
  if (!S.palette.length) return;
  let i = S.palette.indexOf(S.primary);
  i = i < 0 ? 0 : (i + dir + S.palette.length) % S.palette.length;
  S.primary = S.palette[i];
}
function pickPaletteIndex(i) {
  if (S.palette[i] == null) return;
  S.primary = S.palette[i];
  renderColors(); renderPalette(); requestRender();
}

/* ---------------- Capas ---------------- */

function renderLayers() {
  const list = $('#layers');
  list.innerHTML = '';
  const d = S.doc;
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const l = d.layers[i];
    const thumb = h('canvas', { class: 'thumb', width: 28, height: 28 });
    const tctx = thumb.getContext('2d');
    l.sync();
    tctx.imageSmoothingEnabled = false;
    const s = Math.min(28 / d.w, 28 / d.h);
    tctx.drawImage(l.canvas, (28 - d.w * s) / 2, (28 - d.h * s) / 2, d.w * s, d.h * s);
    const name = h('span', { class: 'name', title: 'Doble clic para renombrar' }, l.name);
    name.ondblclick = () => renameLayer(i, name);
    list.append(h('div', {
      class: 'layer' + (i === d.active ? ' active' : '') + (l.visible ? '' : ' hidden'),
      onclick: () => { selectLayer(i); refreshAll(); },
    },
      h('button', {
        class: 'eye', title: 'Mostrar/ocultar (Shift+L)', html: l.visible ? '●' : '○',
        onclick: e => { e.stopPropagation(); l.visible = !l.visible; markModified(); refreshAll(); },
      }),
      thumb, name,
      l.opacity < 1 ? h('span', { class: 'op' }, Math.round(l.opacity * 100) + '%') : null));
  }
  const op = $('#layer-opacity');
  op.value = Math.round(activeLayer().opacity * 100);
  $('#layer-opacity-val').textContent = op.value + '%';
}

function buildLayersPanel() {
  const bind = (sel, id) => { $(sel).onclick = () => runCommand(id); };
  bind('#ly-add', 'layer.new'); bind('#ly-dup', 'layer.dup'); bind('#ly-del', 'layer.del');
  bind('#ly-up', 'layer.moveUp'); bind('#ly-down', 'layer.moveDown'); bind('#ly-merge', 'layer.merge');
  $('#layer-opacity').addEventListener('input', e => {
    activeLayer().opacity = +e.target.value / 100;
    $('#layer-opacity-val').textContent = e.target.value + '%';
    markModified(); requestRender();
  });
  $('#layer-opacity').addEventListener('change', () => renderLayers());
}

function renameLayer(i, nameEl) {
  const l = S.doc.layers[i];
  const inp = h('input', { class: 'rename', value: l.name });
  nameEl.replaceWith(inp);
  inp.focus(); inp.select();
  const done = ok => {
    if (ok && inp.value.trim()) { l.name = inp.value.trim(); markModified(); }
    renderLayers();
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') done(true);
    if (e.key === 'Escape') done(false);
  });
  inp.addEventListener('blur', () => done(true));
  inp.addEventListener('click', e => e.stopPropagation());
}

/* ---------------- Barra de estado y avisos ---------------- */

function updateStatus() {
  if (!S.doc) return;
  const t = Tools[currentToolId()];
  const p = S.hover;
  let pos = '—', col = '';
  if (p && inBounds(p.x, p.y)) {
    pos = `${p.x}, ${p.y}`;
    const c = activeLayer().data[p.y * S.doc.w + p.x];
    col = cA(c) ? u32ToHex(c) + (cA(c) < 255 ? ` ${Math.round(cA(c) / 2.55)}%` : '') : 'transparente';
  }
  $('#st-tool').textContent = t.label;
  $('#st-pos').textContent = pos;
  $('#st-color').textContent = col;
  $('#st-size').textContent = `${S.doc.w}×${S.doc.h}`;
  $('#st-zoom').textContent = (V.zoom >= 1 ? Math.round(V.zoom * 100) : (V.zoom * 100).toFixed(0)) + '%';
  const sel = S.shapeInfo || (S.sel ? `sel ${S.sel.w}×${S.sel.h}${S.float ? ' (flotante)' : ''}` : '');
  $('#st-sel').textContent = sel;
  const flags = [];
  if (S.mirrorX) flags.push('↔'); if (S.mirrorY) flags.push('↕');
  if (S.tile) flags.push('mosaico'); if (S.gridMajor) flags.push('bloques ' + S.gridMajor);
  $('#st-flags').textContent = flags.join(' · ');
  $('#st-save').textContent = S.savedAt ? 'Autoguardado ' + S.savedAt : '';
}

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}

function updateCursor() {
  const id = currentToolId();
  viewCanvas.style.cursor = id === 'pan' ? (dragState ? 'grabbing' : 'grab') : id === 'move' ? 'move' : 'crosshair';
}

/* ---------------- Diálogos ---------------- */

function openDialog(title, body, buttons) {
  const ov = $('#overlay');
  ov.innerHTML = '';
  const primary = buttons.find(b => b.primary);
  const close = () => closeDialog();
  const box = h('form', { class: 'dialog', onsubmit: e => { e.preventDefault(); if (primary && primary.run?.() !== false) close(); } },
    h('h2', {}, title),
    h('div', { class: 'dialog-body' }, body),
    h('div', { class: 'dialog-buttons' }, buttons.map(b => h('button', {
      type: b.primary ? 'submit' : 'button', class: b.primary ? 'primary' : '',
      onclick: b.primary ? null : () => { if (b.run?.() !== false) close(); },
    }, b.label))));
  ov.append(box);
  ov.classList.add('open');
  S.modal = { type: 'dialog' };
  const first = box.querySelector('input,select');
  if (first) { first.focus(); first.select?.(); }
}
function closeDialog() {
  const ov = $('#overlay');
  ov.classList.remove('open');
  ov.innerHTML = '';
  S.modal = null;
}

function numField(label, value, min = 1, max = 2048) {
  const input = h('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: '1' });
  return { input, row: h('label', { class: 'field' }, h('span', {}, label), input) };
}

function dlgNew() {
  const w = numField('Ancho', S.doc.w), hh = numField('Alto', S.doc.h);
  const presets = h('div', { class: 'presets' }, [8, 16, 24, 32, 48, 64, 128, 256].map(n =>
    h('button', { type: 'button', onclick: () => { w.input.value = n; hh.input.value = n; } }, `${n}×${n}`)));
  openDialog('Nuevo lienzo', [h('div', { class: 'row' }, w.row, hh.row), presets,
    h('p', { class: 'muted' }, 'Se puede deshacer con Ctrl+Z.')],
  [{ label: 'Cancelar' }, { label: 'Crear', primary: true, run: () => newDoc(+w.input.value, +hh.input.value) }]);
}

function anchorPicker() {
  let anchor = [1, 1];
  const grid = h('div', { class: 'anchor' });
  const draw = () => {
    grid.innerHTML = '';
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      grid.append(h('button', {
        type: 'button', class: x === anchor[0] && y === anchor[1] ? 'on' : '',
        onclick: () => { anchor = [x, y]; draw(); },
      }));
    }
  };
  draw();
  return { el: h('div', { class: 'field' }, h('span', {}, 'Anclaje'), grid), get: () => anchor };
}

function dlgResize() {
  const w = numField('Ancho', S.doc.w), hh = numField('Alto', S.doc.h), a = anchorPicker();
  openDialog('Tamaño del lienzo', [h('div', { class: 'row' }, w.row, hh.row), a.el,
    h('p', { class: 'muted' }, 'Añade o recorta espacio sin escalar los píxeles.')],
  [{ label: 'Cancelar' }, { label: 'Aplicar', primary: true, run: () => resizeCanvas(+w.input.value, +hh.input.value, a.get()) }]);
}

function dlgScale() {
  const w = numField('Ancho', S.doc.w), hh = numField('Alto', S.doc.h);
  const ratio = S.doc.w / S.doc.h;
  const keep = h('input', { type: 'checkbox', checked: true });
  w.input.addEventListener('input', () => { if (keep.checked) hh.input.value = Math.max(1, Math.round(+w.input.value / ratio)); });
  hh.input.addEventListener('input', () => { if (keep.checked) w.input.value = Math.max(1, Math.round(+hh.input.value * ratio)); });
  const quick = h('div', { class: 'presets' }, [0.5, 2, 3, 4].map(f => h('button', {
    type: 'button', onclick: () => { w.input.value = Math.max(1, Math.round(S.doc.w * f)); hh.input.value = Math.max(1, Math.round(S.doc.h * f)); },
  }, (f < 1 ? '÷2' : '×' + f))));
  openDialog('Escalar imagen (vecino más próximo)', [h('div', { class: 'row' }, w.row, hh.row),
    h('label', { class: 'check' }, keep, ' Mantener proporción'), quick],
  [{ label: 'Cancelar' }, { label: 'Escalar', primary: true, run: () => scaleImage(+w.input.value, +hh.input.value) }]);
}

function dlgExport() {
  let scale = S.exportScale || 1;
  const name = h('input', { type: 'text', value: S.fileName });
  const info = h('p', { class: 'muted' });
  const scales = h('div', { class: 'presets' });
  const draw = () => {
    scales.innerHTML = '';
    [1, 2, 4, 8, 10, 16, 20].forEach(s => scales.append(h('button', {
      type: 'button', class: s === scale ? 'on' : '', onclick: () => { scale = s; draw(); },
    }, '×' + s)));
    info.textContent = `Resultado: ${S.doc.w * scale}×${S.doc.h * scale} px`;
  };
  draw();
  openDialog('Exportar PNG', [h('label', { class: 'field' }, h('span', {}, 'Nombre'), name),
    h('div', { class: 'field' }, h('span', {}, 'Escala'), scales), info],
  [{ label: 'Cancelar' }, { label: 'Exportar', primary: true, run: () => {
    S.fileName = name.value.trim() || 'pixel-art';
    exportPNG(scale);
  } }]);
}

/* ---------------- Paleta de comandos ---------------- */

function openCommandPalette(initial = '') {
  if (typeof initial !== 'string') initial = '';
  const ov = $('#overlay');
  ov.innerHTML = '';
  const input = h('input', { class: 'cmd-input', placeholder: 'Escribe una acción… (ej. "capa", "voltear", "exportar")', value: initial });
  const list = h('div', { class: 'cmd-list' });
  let items = [], sel = 0;
  const update = () => {
    const q = normalizeText(input.value.trim());
    const words = q.split(/\s+/).filter(Boolean);
    const all = Commands.filter(c => !c.hidden);
    if (!words.length) {
      const rec = (S.recentCmds || []).map(id => CmdById[id]).filter(Boolean);
      items = [...rec, ...all.filter(c => !rec.includes(c))];
    } else {
      items = all.map(c => {
        const text = normalizeText(c.label + ' ' + c.group + ' ' + c.keys.join(' '));
        if (!words.every(w => text.includes(w))) return null;
        const lab = normalizeText(c.label);
        const score = (lab.startsWith(words[0]) ? 0 : lab.includes(words[0]) ? 1 : 2);
        return { c, score };
      }).filter(Boolean).sort((a, b) => a.score - b.score).map(o => o.c);
    }
    sel = clamp(sel, 0, Math.max(0, items.length - 1));
    list.innerHTML = '';
    items.forEach((c, i) => {
      const row = h('div', { class: 'cmd-item' + (i === sel ? ' sel' : ''), onmousedown: e => { e.preventDefault(); run(i); } },
        h('span', { class: 'grp' }, c.group),
        h('span', { class: 'lab' }, c.label),
        h('span', { class: 'keys' }, c.keys.slice(0, 2).map(k => h('kbd', {}, prettyKey(k)))));
      list.append(row);
    });
    if (!items.length) list.append(h('div', { class: 'muted pad' }, 'Sin resultados'));
    list.children[sel]?.scrollIntoView({ block: 'nearest' });
  };
  const run = i => {
    const c = items[i];
    closeDialog();
    if (c) runCommand(c.id);
  };
  input.addEventListener('input', () => { sel = 0; update(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); update(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); update(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); closeDialog(); }
    e.stopPropagation();
  });
  ov.append(h('div', { class: 'cmd-box' }, input, list));
  ov.classList.add('open');
  S.modal = { type: 'cmd' };
  input.focus();
  update();
}

/* ---------------- Ayuda ---------------- */

function openHelp() {
  const ov = $('#overlay');
  ov.innerHTML = '';
  const groups = {};
  for (const c of Commands) {
    if (!c.keys.length && c.group !== 'Herramientas') continue;
    (groups[c.group] = groups[c.group] || []).push(c);
  }
  const extra = [
    ['Mantener Espacio / botón central', 'Desplazar la vista'],
    ['Mantener Alt', 'Cuentagotas temporal'],
    ['Mantener la tecla de una herramienta', 'La usa mientras la mantienes y vuelve a la anterior al soltar'],
    ['Rueda del ratón', 'Zoom hacia el cursor'],
    ['Shift + rueda', 'Tamaño del pincel'],
    ['Clic derecho', 'Pinta con el color 2'],
    ['Shift + clic (lápiz, goma, trama)', 'Línea recta desde el último punto'],
    ['1 … 9', 'Elegir color de la paleta'],
    ['Esc durante un trazo', 'Cancelar el trazo'],
    ['Arrastrar un archivo', 'Abrir PNG / proyecto'],
  ];
  const cols = Object.entries(groups).map(([g, cs]) => h('section', {},
    h('h3', {}, g),
    cs.map(c => h('div', { class: 'help-row' }, h('span', {}, c.label), h('span', {}, c.keys.map(k => h('kbd', {}, prettyKey(k))))))));
  cols.push(h('section', {}, h('h3', {}, 'Ratón y gestos'),
    extra.map(([k, v]) => h('div', { class: 'help-row gesture' }, h('kbd', {}, k), h('span', {}, v)))));
  ov.append(h('div', { class: 'help' },
    h('div', { class: 'help-head' }, h('h2', {}, 'Atajos de teclado'),
      h('span', { class: 'muted' }, 'Ctrl+K busca cualquier acción por nombre · Esc para cerrar')),
    h('div', { class: 'help-cols' }, cols)));
  ov.classList.add('open');
  S.modal = { type: 'help' };
}
