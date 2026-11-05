'use strict';
/* =========================================================================
 * Comandos y atajos de teclado.
 * Todo lo que hace el editor es un comando: así aparece en la paleta de
 * comandos (Ctrl+K), en la ayuda (?) y se puede asignar a una tecla.
 * Para cambiar un atajo, edita el campo `keys` aquí.
 * ========================================================================= */

const Commands = [];
const CmdById = {};
let Keymap = {};

function cmd(id, group, label, keys, run, extra = {}) {
  const c = { id, group, label, keys: keys ? [].concat(keys) : [], run, ...extra };
  Commands.push(c);
  CmdById[id] = c;
  return c;
}

function runCommand(id) {
  const c = CmdById[id];
  if (!c) return;
  if (dragState) return;
  c.run();
  S.recentCmds = [id, ...(S.recentCmds || []).filter(x => x !== id)].slice(0, 8);
  refreshAll();
}

function buildKeymap() {
  Keymap = {};
  for (const c of Commands) for (const k of c.keys) Keymap[k] = c.id;
}

/** Convierte un evento de teclado en una cadena tipo "Ctrl+Shift+Z". */
function comboFromEvent(e) {
  let key = e.key;
  if (key === ' ') key = 'Space';
  const isChar = key.length === 1;
  const isLetter = isChar && /[a-zñ]/i.test(key);
  let ctrl = e.ctrlKey || e.metaKey, alt = e.altKey, shift = e.shiftKey;
  if (isChar && !isLetter) {
    // Símbolos: la tecla ya refleja Shift/AltGr según la distribución del teclado.
    shift = false;
    if (e.getModifierState?.('AltGraph') || (ctrl && alt)) { ctrl = false; alt = false; }
  }
  if (isLetter) key = key.toUpperCase();
  return (ctrl ? 'Ctrl+' : '') + (alt ? 'Alt+' : '') + (shift ? 'Shift+' : '') + key;
}

function prettyKey(k) {
  return k.replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→')
    .replace('Escape', 'Esc').replace('Delete', 'Supr').replace('Backspace', '⌫').replace('PageUp', 'RePág')
    .replace('PageDown', 'AvPág').replace('Enter', 'Intro').replace('Space', 'Espacio');
}

function registerCommands() {
  /* Herramientas */
  for (const id of TOOL_ORDER) {
    const t = Tools[id];
    cmd('tool.' + id, 'Herramientas', t.label, t.key, () => setTool(id), { tool: id });
  }

  /* Edición */
  cmd('edit.undo', 'Edición', 'Deshacer', 'Ctrl+Z', () => History.undo());
  cmd('edit.redo', 'Edición', 'Rehacer', ['Ctrl+Shift+Z', 'Ctrl+Y'], () => History.redo());
  cmd('edit.copy', 'Edición', 'Copiar', 'Ctrl+C', copySel);
  cmd('edit.cut', 'Edición', 'Cortar', 'Ctrl+X', cutSel);
  cmd('edit.paste', 'Edición', 'Pegar (Ctrl+V)', null, pasteFromCommand);
  cmd('edit.delete', 'Edición', 'Borrar selección (o capa entera)', ['Delete', 'Backspace'], deleteSel);
  cmd('edit.flipH', 'Edición', 'Voltear horizontal', 'Shift+H', () => flipSel(true));
  cmd('edit.flipV', 'Edición', 'Voltear vertical', 'Shift+V', () => flipSel(false));
  cmd('edit.rotate', 'Edición', 'Rotar 90°', 'Shift+R', rotateSel);

  /* Selección */
  cmd('sel.all', 'Selección', 'Seleccionar todo', 'Ctrl+A', () => { commitFloat(); S.sel = { x: 0, y: 0, w: S.doc.w, h: S.doc.h }; });
  cmd('sel.none', 'Selección', 'Quitar selección', ['Ctrl+D', 'Escape'], deselect);
  cmd('sel.commit', 'Selección', 'Fijar píxeles flotantes', 'Enter', () => { commitFloat(); });
  cmd('sel.up', 'Selección', 'Mover 1px arriba', 'ArrowUp', () => nudge(0, -1), { hidden: true });
  cmd('sel.down', 'Selección', 'Mover 1px abajo', 'ArrowDown', () => nudge(0, 1), { hidden: true });
  cmd('sel.left', 'Selección', 'Mover 1px izquierda', 'ArrowLeft', () => nudge(-1, 0), { hidden: true });
  cmd('sel.right', 'Selección', 'Mover 1px derecha', 'ArrowRight', () => nudge(1, 0), { hidden: true });
  cmd('sel.cropTo', 'Selección', 'Recortar lienzo a la selección', null, cropToSelection);

  /* Pincel y modos */
  cmd('brush.bigger', 'Pincel', 'Pincel más grande', [']', '.'], () => setBrush(S.brushSize + 1));
  cmd('brush.smaller', 'Pincel', 'Pincel más pequeño', ['[', ','], () => setBrush(S.brushSize - 1));
  cmd('brush.shape', 'Pincel', 'Pincel redondo / cuadrado', 'Shift+B', () => { S.brushRound = !S.brushRound; toast(S.brushRound ? 'Pincel redondo' : 'Pincel cuadrado'); savePrefs(); });
  cmd('brush.pp', 'Pincel', 'Pixel perfect (lápiz 1px)', 'P', () => { S.pixelPerfect = !S.pixelPerfect; toast('Pixel perfect ' + onOff(S.pixelPerfect)); savePrefs(); });
  cmd('brush.fill', 'Pincel', 'Formas rellenas', 'F', () => { S.fillShapes = !S.fillShapes; toast('Formas rellenas ' + onOff(S.fillShapes)); savePrefs(); });
  cmd('mirror.x', 'Pincel', 'Simetría izquierda ↔ derecha', 'Shift+X', () => { S.mirrorX = !S.mirrorX; toast('Simetría ↔ ' + onOff(S.mirrorX)); });
  cmd('mirror.y', 'Pincel', 'Simetría arriba ↕ abajo', 'Shift+Y', () => { S.mirrorY = !S.mirrorY; toast('Simetría ↕ ' + onOff(S.mirrorY)); });

  /* Color */
  cmd('color.swap', 'Color', 'Intercambiar color 1 y 2', 'X', () => { [S.primary, S.secondary] = [S.secondary, S.primary]; });
  cmd('color.add', 'Color', 'Añadir color 1 a la paleta', 'Shift+A', addToPalette);
  cmd('color.darker', 'Color', 'Color 1 más oscuro (rampa)', 'Q', () => shiftShade(-1));
  cmd('color.lighter', 'Color', 'Color 1 más claro (rampa)', 'W', () => shiftShade(1));
  cmd('color.prevPal', 'Color', 'Color anterior de la paleta', 'Shift+Q', () => cyclePalette(-1));
  cmd('color.nextPal', 'Color', 'Color siguiente de la paleta', 'Shift+W', () => cyclePalette(1));
  cmd('color.edit', 'Color', 'Editar color 1 (selector)', 'C', () => openColorPicker('primary'));
  cmd('palette.fromImage', 'Color', 'Crear paleta con los colores del dibujo', null, paletteFromImage);
  cmd('palette.reset', 'Color', 'Restablecer paleta por defecto', null, () => { S.palette = DEFAULT_PALETTE.slice(); savePrefs(); toast('Paleta restablecida'); });
  cmd('palette.import', 'Color', 'Importar paleta (.hex, .gpl o imagen)', null, () => openFileDialog('palette'));
  cmd('palette.export', 'Color', 'Exportar paleta (.hex)', null, exportPalette);

  /* Capas */
  cmd('layer.new', 'Capas', 'Nueva capa', 'Shift+N', addLayer);
  cmd('layer.dup', 'Capas', 'Duplicar capa', 'Shift+D', duplicateLayer);
  cmd('layer.del', 'Capas', 'Eliminar capa', 'Shift+Delete', deleteLayer);
  cmd('layer.merge', 'Capas', 'Combinar con la capa de abajo', 'Shift+M', mergeDown);
  cmd('layer.up', 'Capas', 'Seleccionar capa superior', 'PageUp', () => selectLayer(S.doc.active + 1));
  cmd('layer.down', 'Capas', 'Seleccionar capa inferior', 'PageDown', () => selectLayer(S.doc.active - 1));
  cmd('layer.moveUp', 'Capas', 'Subir capa', 'Shift+PageUp', () => moveLayer(1));
  cmd('layer.moveDown', 'Capas', 'Bajar capa', 'Shift+PageDown', () => moveLayer(-1));
  cmd('layer.toggle', 'Capas', 'Mostrar / ocultar capa activa', 'Shift+L', () => { const l = activeLayer(); l.visible = !l.visible; markModified(); });
  cmd('layer.clear', 'Capas', 'Vaciar capa activa', null, () => { commitFloat(); const ed = beginEdit(); ed.layer.data.fill(0); ed.layer.dirty = true; endEdit(); });

  /* Lienzo */
  cmd('canvas.resize', 'Lienzo', 'Tamaño del lienzo…', 'Ctrl+Alt+C', dlgResize);
  cmd('canvas.scale', 'Lienzo', 'Escalar imagen…', 'Ctrl+Alt+I', dlgScale);
  cmd('canvas.crop', 'Lienzo', 'Recortar al contenido', null, cropToContent);
  cmd('canvas.flipH', 'Lienzo', 'Voltear lienzo horizontal', null, () => transformCanvas('flipH'));
  cmd('canvas.flipV', 'Lienzo', 'Voltear lienzo vertical', null, () => transformCanvas('flipV'));
  cmd('canvas.rotate', 'Lienzo', 'Rotar lienzo 90°', null, () => transformCanvas('rotate'));

  /* Vista */
  cmd('view.zoomIn', 'Vista', 'Acercar', ['+', '='], () => zoomStep(1));
  cmd('view.zoomOut', 'Vista', 'Alejar', '-', () => zoomStep(-1));
  cmd('view.fit', 'Vista', 'Ajustar a la ventana', '0', fitView);
  cmd('view.grid', 'Vista', 'Cuadrícula de píxeles', 'Shift+G', () => { S.grid = !S.grid; toast('Cuadrícula ' + onOff(S.grid)); savePrefs(); });
  cmd('view.gridMajor', 'Vista', 'Cuadrícula de bloques (8 / 16 / no)', 'Ctrl+Shift+G', () => {
    S.gridMajor = S.gridMajor === 0 ? 8 : S.gridMajor === 8 ? 16 : 0;
    toast(S.gridMajor ? `Bloques de ${S.gridMajor}px` : 'Bloques desactivados'); savePrefs();
  });
  cmd('view.tile', 'Vista', 'Modo mosaico (ver repetición)', 'Shift+T', () => { S.tile = !S.tile; toast('Mosaico ' + onOff(S.tile)); });
  cmd('view.panels', 'Vista', 'Mostrar / ocultar paneles', 'Tab', togglePanels);

  /* Archivo */
  cmd('file.new', 'Archivo', 'Nuevo lienzo…', 'Ctrl+Alt+N', dlgNew);
  cmd('file.open', 'Archivo', 'Abrir (proyecto o imagen)…', 'Ctrl+O', () => openFileDialog('open'));
  cmd('file.save', 'Archivo', 'Guardar proyecto', 'Ctrl+S', saveProject);
  cmd('file.export', 'Archivo', 'Exportar PNG…', 'Ctrl+Shift+E', dlgExport);
  cmd('file.quickExport', 'Archivo', 'Exportar PNG rápido (última escala)', 'Ctrl+E', () => exportPNG(S.exportScale || 1));

  /* Ayuda */
  cmd('ui.palette', 'Ayuda', 'Paleta de comandos', ['Ctrl+K', '/'], openCommandPalette);
  cmd('ui.help', 'Ayuda', 'Atajos de teclado', ['?', 'F1'], openHelp);

  buildKeymap();
}

const onOff = v => (v ? 'activado' : 'desactivado');
