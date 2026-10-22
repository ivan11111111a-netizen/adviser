// Иконка расширения для Marketplace: media/icon.png, 256×256. Без зависимостей: фигуры
// рисуются с 4× супердискретизацией и пишутся в PNG через zlib. Запуск: node scripts/make-icon.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 256;
const SS = 4;

/** Точка внутри многоугольника (чётно-нечётное правило). */
function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const TOP = [37, 99, 235];
const BOTTOM = [30, 58, 138];
const WHITE = [255, 255, 255];
const PALE = [191, 219, 254];
const GOLD = [251, 191, 36];

// Шапочка: ромб сверху, основание под ним, кисточка справа.
const diamond = [
  [128, 52],
  [232, 104],
  [128, 156],
  [24, 104],
];
const base = [
  [68, 124],
  [188, 124],
  [188, 172],
  [128, 196],
  [68, 172],
];
const cord = [
  [214, 108],
  [222, 108],
  [222, 168],
  [214, 168],
];

/** Цвет пикселя в точке (x, y) или null — прозрачно. */
function shade(x, y) {
  if (!inRoundedSquare(x, y, SIZE, 52)) {
    return null;
  }
  if (inPolygon(x, y, diamond)) {
    return WHITE;
  }
  if (inPolygon(x, y, base)) {
    return PALE;
  }
  if (inPolygon(x, y, cord) || (x - 218) ** 2 + (y - 176) ** 2 <= 12 ** 2) {
    return GOLD;
  }
  return mix(TOP, BOTTOM, y / SIZE);
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const sum = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const c = shade(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS);
        if (c) {
          sum[0] += c[0];
          sum[1] += c[1];
          sum[2] += c[2];
          sum[3] += 1;
        }
      }
    }
    const o = (py * SIZE + px) * 4;
    const covered = sum[3];
    pixels[o] = covered ? Math.round(sum[0] / covered) : 0;
    pixels[o + 1] = covered ? Math.round(sum[1] / covered) : 0;
    pixels[o + 2] = covered ? Math.round(sum[2] / covered) : 0;
    pixels[o + 3] = Math.round((covered / (SS * SS)) * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) {
    c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // бит на канал
ihdr[9] = 6; // RGBA
const rows = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  rows[y * (SIZE * 4 + 1)] = 0; // фильтр: нет
  pixels.copy(rows, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = path.join(import.meta.dirname, '..', 'media', 'icon.png');
fs.writeFileSync(out, png);
console.log(`${out}: ${png.length} байт`);
