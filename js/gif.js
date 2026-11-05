'use strict';
/* =========================================================================
 * Codificador de GIF animado (GIF89a) sin dependencias.
 * Pensado para pixel art: si hay ≤255 colores la paleta es exacta;
 * si hay más, se reduce la precisión de color hasta que quepan.
 * Píxeles con alfa < 128 → transparentes (índice 0).
 * ========================================================================= */

/**
 * @param {{data: Uint32Array, delay: number}[]} frames  datos w×h y duración en ms
 * @param {number} w @param {number} h @param {number} scale  ampliación entera
 * @returns {Uint8Array}
 */
function encodeGIF(frames, w, h, scale = 1) {
  // 1) Paleta común
  let shift = 0, colors;
  for (;;) {
    const mask = (0xff << shift) & 0xff;
    const set = new Map();
    for (const f of frames) {
      for (let i = 0; i < f.data.length; i++) {
        const c = f.data[i];
        if ((c >>> 24) < 128) continue;
        const k = ((cR(c) & mask) << 16) | ((cG(c) & mask) << 8) | (cB(c) & mask);
        if (!set.has(k)) set.set(k, set.size + 1);
        if (set.size > 255) break;
      }
      if (set.size > 255) break;
    }
    if (set.size <= 255) { colors = set; break; }
    shift++;
  }
  const mask = (0xff << shift) & 0xff;
  let bits = 1;
  while ((1 << bits) < colors.size + 1) bits++;
  const tableSize = 1 << bits;

  const out = new ByteWriter();
  const W = w * scale, H = h * scale;
  out.str('GIF89a');
  out.u16(W); out.u16(H);
  out.byte(0x80 | 0x70 | (bits - 1)); // tabla global, resolución 8 bits
  out.byte(0); out.byte(0);
  const table = new Uint8Array(tableSize * 3);
  for (const [k, idx] of colors) {
    // centra el valor reducido para no oscurecer
    const fix = v => (shift ? Math.min(255, v + (1 << (shift - 1))) : v);
    table[idx * 3] = fix((k >> 16) & 255); table[idx * 3 + 1] = fix((k >> 8) & 255); table[idx * 3 + 2] = fix(k & 255);
  }
  out.bytes(table);
  // Bucle infinito
  out.bytes([0x21, 0xff, 0x0b]); out.str('NETSCAPE2.0'); out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]);

  const minCode = Math.max(2, bits);
  const indices = new Uint8Array(W * H);
  for (const f of frames) {
    for (let y = 0; y < H; y++) {
      const sy = (y / scale) | 0;
      for (let x = 0; x < W; x++) {
        const c = f.data[sy * w + ((x / scale) | 0)];
        indices[y * W + x] = (c >>> 24) < 128 ? 0
          : colors.get(((cR(c) & mask) << 16) | ((cG(c) & mask) << 8) | (cB(c) & mask));
      }
    }
    const delay = Math.max(2, Math.round(f.delay / 10));
    out.bytes([0x21, 0xf9, 0x04, (2 << 2) | 1]); out.u16(delay); out.bytes([0, 0]); // desechar: restaurar fondo
    out.byte(0x2c); out.u16(0); out.u16(0); out.u16(W); out.u16(H); out.byte(0);
    out.byte(minCode);
    const lz = lzwEncode(indices, minCode);
    for (let i = 0; i < lz.length; i += 255) {
      const n = Math.min(255, lz.length - i);
      out.byte(n); out.bytes(lz.subarray(i, i + n));
    }
    out.byte(0);
  }
  out.byte(0x3b);
  return out.result();
}

function lzwEncode(indices, minCode) {
  const clear = 1 << minCode, eoi = clear + 1;
  let codeSize = minCode + 1, next = eoi + 1;
  const dict = new Map();
  const bytes = new ByteWriter();
  let cur = 0, nbits = 0;
  const write = code => {
    cur |= code << nbits; nbits += codeSize;
    while (nbits >= 8) { bytes.byte(cur & 255); cur >>>= 8; nbits -= 8; }
  };
  write(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const v = dict.get(key);
    if (v !== undefined) { prefix = v; continue; }
    write(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      write(clear);
      dict.clear();
      codeSize = minCode + 1; next = eoi + 1;
    }
    prefix = k;
  }
  write(prefix);
  write(eoi);
  if (nbits > 0) bytes.byte(cur & 255);
  return bytes.result();
}

class ByteWriter {
  constructor() { this.buf = new Uint8Array(1 << 16); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let s = this.buf.length * 2;
    while (s < this.len + n) s *= 2;
    const b = new Uint8Array(s); b.set(this.buf.subarray(0, this.len)); this.buf = b;
  }
  byte(v) { this.ensure(1); this.buf[this.len++] = v; }
  u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
  bytes(a) { this.ensure(a.length); this.buf.set(a, this.len); this.len += a.length; }
  str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  result() { return this.buf.slice(0, this.len); }
}
