/**
 * Draws the extension icons (a white bookmark on an indigo rounded square) and
 * writes them as PNGs. No image libraries involved — just zlib.
 *
 *   node tools/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];
const SAMPLES = 4; // supersampling factor, for antialiased edges

const TOP = [79, 70, 229]; //  #4f46e5
const BOTTOM = [124, 58, 237]; // #7c3aed

/** Rounded square covering the whole canvas, in unit coordinates. */
function insideBackground(x, y, radius = 0.22) {
  const dx = Math.max(radius - x, x - (1 - radius), 0);
  const dy = Math.max(radius - y, y - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/** Bookmark: a rectangle with a V cut out of its bottom edge. */
function insideBookmark(x, y) {
  const x0 = 0.31;
  const x1 = 0.69;
  const top = 0.18;
  const notchTip = 0.63;
  const bottom = 0.81;
  if (x < x0 || x > x1 || y < top) return false;
  const half = (x1 - x0) / 2;
  const edge = notchTip + (bottom - notchTip) * (Math.abs(x - (x0 + half)) / half);
  return y <= edge;
}

function renderRGBA(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SAMPLES);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px * SAMPLES + sx + 0.5) * step;
          const y = (py * SAMPLES + sy + 0.5) * step;
          if (!insideBackground(x, y)) continue;

          a += 1;
          if (insideBookmark(x, y)) {
            r += 255;
            g += 255;
            b += 255;
          } else {
            r += TOP[0] + (BOTTOM[0] - TOP[0]) * y;
            g += TOP[1] + (BOTTOM[1] - TOP[1]) * y;
            b += TOP[2] + (BOTTOM[2] - TOP[2]) * y;
          }
        }
      }

      const total = SAMPLES * SAMPLES;
      const offset = (py * size + px) * 4;
      if (a > 0) {
        // Un-premultiply so partially covered edge pixels keep their colour.
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
        pixels[offset + 3] = Math.round((a / total) * 255);
      }
    }
  }
  return pixels;
}

/* --- PNG container ------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function toPNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12: compression, filter, interlace — all zero.

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, toPNG(size, renderRGBA(size)));
  console.log(`wrote ${file}`);
}
