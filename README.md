# PixelEdit

Editor de pixel art en el navegador para **animaciones y escenarios**, organizado por **capas**,
pensado para trabajar rápido con el teclado en el escritorio y con el dedo en el iPhone.
No necesita instalación ni compilación: abre `index.html` en Chrome, Edge, Firefox o Safari.

## Publicarlo en Vercel

Es un sitio estático: no necesita compilación.

1. Entra en [vercel.com](https://vercel.com) con tu cuenta de GitHub → *Add New… → Project*.
2. Importa el repositorio `PixelEdit`. Deja *Framework Preset* en **Other**, sin comando de build
   y con el directorio raíz (`./`) como salida. Pulsa *Deploy*.
3. Cada `git push` a `main` vuelve a publicar la web automáticamente.

`vercel.json` evita que el navegador se quede con versiones antiguas del código.

La web elige la interfaz según el dispositivo (tamaño de pantalla y si es táctil). Se puede forzar
desde la paleta de comandos con *Vista: automática / móvil / escritorio*.

## Usarlo en el iPhone

1. Publícalo en Vercel (arriba) o con GitHub Pages: en GitHub, *Settings → Pages → Build and deployment*,
   elige *Deploy from a branch*, rama `main`, carpeta `/ (root)`. La dirección será
   `https://<usuario>.github.io/PixelEdit/`.
2. Abre esa dirección en Safari, pulsa *Compartir → Añadir a pantalla de inicio*.
   Se abre a pantalla completa, como una app, y funciona sin conexión.

Gestos: **1 dedo** dibuja · **2 dedos** mueven y hacen zoom · **toque con 2 dedos** deshace ·
**toque con 3 dedos** rehace · **mantener el dedo quieto** = cuentagotas · **☰** abre todas las acciones.
Al exportar en el iPhone se abre el menú *Compartir* (por ejemplo, para guardar en Fotos).

## Animación

Cada capa tiene un *cel* por fotograma. La línea de tiempo está bajo el lienzo.

| Tecla | Acción |
|---|---|
| `←` `→` | fotograma anterior / siguiente (si hay selección, la mueven) |
| `↑` `↓` | capa superior / inferior |
| `Alt+D` | duplicar fotograma (lo habitual para animar) |
| `Alt+N` | fotograma vacío |
| `Alt+Supr` | eliminar fotograma |
| `Alt+←` `Alt+→` | reordenar fotogramas |
| `Intro` | reproducir / pausar |
| `Shift+O` | papel cebolla (anterior en rojo, siguiente en azul) |
| `Alt+T` | mostrar / ocultar la línea de tiempo |

Los fps se cambian en la línea de tiempo. Haz doble clic en un fotograma para darle una duración propia.
**Exportar** (`Ctrl+Shift+E`): PNG del fotograma actual, **GIF animado** o **hoja de sprites** (con columnas configurables).

## Convertir una imagen a pixel art

*Convertir imagen* (barra superior, `Ctrl+Alt+P` o el menú ☰ en el móvil). También aparece solo al
abrir o arrastrar una imagen de más de 256 px. Ajustes con vista previa en directo:

- **Ancho** del resultado (el alto mantiene la proporción) y **número de colores**.
- **Paleta**: automática (elige los mejores colores) o **tu paleta actual**, útil para que todo un juego comparta colores.
- **Reducción** *nítida* (color dominante de cada bloque, bordes limpios) o *suave* (promedio).
- **Tramado**: ninguno, ordenado (patrón clásico) o difuso.
- **Saturación** y **contraste**, **quitar fondo** (con tolerancia), **limpiar píxeles sueltos** y **contorno oscuro**.
- El resultado puede ser un **dibujo nuevo** (con su paleta) o una **capa nueva** en el dibujo actual. Las dos cosas se pueden deshacer.

## Escenarios

- **Cuadrícula de tiles** (`Ctrl+Shift+G`, tamaño en *Tamaño de tile…*), aparte de la cuadrícula de píxeles.
- **Sello** (`S`): selecciona un trozo (un tile, un árbol, una roca…), pulsa `Ctrl+B` y píntalo
  por el escenario. Con la cuadrícula de tiles activa encaja en cada casilla (`Shift+S` lo activa o desactiva).
  `Ctrl+clic` con el sello copia el tile que hay bajo el cursor. Con clic derecho borras con su forma.
  `Shift+H`/`Shift+V`/`Shift+R` voltean o rotan el sello.
- **Bloquear capas** (`Alt+L` o el candado) para no pintar sin querer en el fondo.
- **Vista previa navegable**: haz clic o arrastra sobre ella para moverte por escenarios grandes.
- Lienzos de hasta 2048×2048, con redibujado parcial para que el trazo siga siendo fluido.

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
| `S` | Sello | pincel hecho con un trozo del dibujo o un tile (ver *Escenarios*) |
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

- **Guardar** (`Ctrl+S`) descarga un proyecto `.pixeledit.json` con capas, fotogramas y paleta.
- El autoguardado usa el almacenamiento del navegador (IndexedDB), así que caben proyectos grandes.
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
js/doc.js         capas, fotogramas (cels), estado, historial, selección flotante
js/anim.js        línea de tiempo, reproducción y exportación (GIF, hoja de sprites)
js/gif.js         codificador de GIF animado propio
js/convert.js     convertidor de imagen a pixel art
js/view.js        zoom, desplazamiento y dibujado del lienzo
js/tools.js       herramientas
js/commands.js    comandos y atajos de teclado
js/ui.js          paneles, diálogos, paleta de comandos, ayuda
js/main.js        operaciones, ratón/teclado/táctil, archivos, autoguardado, diseño móvil
sw.js, manifest.webmanifest, icons/   instalación como app (PWA)
```
