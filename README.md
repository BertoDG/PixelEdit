# PixelEdit

Editor de pixel art en el navegador, pensado para trabajar **rápido y con el teclado**.
No necesita instalación ni compilación: abre `index.html` en Chrome, Edge o Firefox.

## Ideas principales

- **Todo es un comando.** `Ctrl+K` (o `/`) abre una paleta de comandos: escribe
  "voltear", "capa", "exportar"… e Intro. Nada queda escondido en un menú.
- **Una tecla por herramienta**, y cada botón muestra su letra.
- **Herramientas temporales:** mantén `Espacio` para desplazar la vista, `Alt` para el
  cuentagotas, o mantén la tecla de cualquier herramienta (p. ej. `E`): se usa mientras
  la mantienes y al soltarla vuelves a la herramienta anterior.
- **Dos colores siempre a mano:** clic izquierdo pinta con el color 1 y clic derecho con
  el color 2, en todas las herramientas. `X` los intercambia.
- **Colores sin buscar:** `1`–`9` eligen colores de la paleta; `Q`/`W` oscurecen o aclaran
  siguiendo una rampa con cambio de tono (sombras hacia azul y luces hacia amarillo);
  hay una fila de colores recientes.
- **Todo se puede deshacer**, incluso "Nuevo lienzo" o "Abrir", así que nunca hay
  diálogos de "¿seguro?".
- **Autoguardado** en el navegador: si cierras la pestaña, el dibujo sigue ahí.
- `?` muestra todos los atajos.

## Herramientas

| Tecla | Herramienta | Notas |
|---|---|---|
| `B` | Lápiz | *Pixel perfect* (`P`) quita las esquinas en L; `Shift+clic` traza una línea desde el último punto |
| `E` | Goma | |
| `G` | Relleno | `Shift+clic` reemplaza ese color en toda la capa |
| `I` | Cuentagotas | también con `Alt` mantenido |
| `D` | Trama | dithering en tablero con color 1 / color 2 |
| `L` | Línea | `Shift` ajusta a ángulos limpios (0°, 1:2, 45°, 2:1, 90°) |
| `R` / `O` | Rectángulo / Elipse | `Shift` hace cuadrado o círculo, `F` alterna el relleno |
| `M` | Selección | arrastra dentro para mover; las flechas mueven 1 px; `Intro` fija la selección y `Esc` la quita |
| `V` | Mover | mueve la selección o la capa entera |
| `H` | Mano | |

Otros atajos: `[` `]` (o `,` `.` en teclado español) o `Shift+rueda` cambian el tamaño del
pincel, la rueda del ratón hace zoom hacia el cursor, `0` ajusta a la ventana,
`Shift+X`/`Shift+Y` activan la simetría, `Shift+G` la cuadrícula, `Shift+T` el modo
mosaico para tiles, `Tab` oculta los paneles, `Esc` cancela el trazo en curso,
`Ctrl+Z`/`Ctrl+Y` deshacen y rehacen, y `Ctrl+C`/`X`/`V` copian, cortan y pegan
(también imágenes copiadas desde otras aplicaciones).

## Archivos

- **Guardar** (`Ctrl+S`) descarga un proyecto `.pixeledit.json` con las capas y la paleta.
- **Abrir** (`Ctrl+O`) o arrastrar a la ventana: proyectos `.json` o imágenes PNG/GIF/etc.
- **Exportar PNG** (`Ctrl+Shift+E`) a escala ×1–×20; `Ctrl+E` repite la última exportación.
- Las paletas se importan desde `.hex`, `.gpl` (GIMP/Aseprite) o desde una imagen.

## Cambiar atajos

Todos los atajos están en `js/commands.js`. Edita el campo de teclas de cada `cmd(...)`.

## Estructura

```
index.html        interfaz
css/style.css     estilos
js/util.js        colores, algoritmos de líneas/elipses, utilidades DOM
js/doc.js         capas, estado, historial (deshacer/rehacer), selección flotante
js/view.js        zoom, desplazamiento y dibujado del lienzo
js/tools.js       herramientas
js/commands.js    comandos y atajos de teclado
js/ui.js          paneles, diálogos, paleta de comandos, ayuda
js/main.js        operaciones, entrada de ratón/teclado, archivos y autoguardado
```
