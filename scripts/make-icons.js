'use strict';
/**
 * 生成 PWA 图标（纯 Node，无依赖）：渐变圆角方块 + 白色 "L"
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- CRC32 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    rgba.copy(raw, p, y * width * 4, (y + 1) * width * 4);
    p += width * 4;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) { return a + (b - a) * t; }

function draw(size, radiusRatio, pad) {
  const buf = Buffer.alloc(size * size * 4);
  const c1 = [0x63, 0x66, 0xf1];
  const c2 = [0xa8, 0x55, 0xf7];
  const inner = size * pad; // 内部图形区域（maskable 时留白更多）
  const r = size * radiusRatio;

  const inRounded = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  };

  // "L" 形状（相对坐标）
  const L = { x0: 0.32, x1: 0.44, y0: 0.26, y1: 0.74, x2: 0.70, yBottom: 0.60 };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const t = (x / size + y / size) / 2;
      let R = lerp(c1[0], c2[0], t);
      let G = lerp(c1[1], c2[1], t);
      let B = lerp(c1[2], c2[2], t);
      let A = 255;

      if (!inRounded(x + 0.5, y + 0.5)) {
        A = 0;
      } else {
        // 绘制白色 L
        const ux = (x - (size - inner) / 2) / inner;
        const uy = (y - (size - inner) / 2) / inner;
        const inL =
          (ux >= L.x0 && ux <= L.x1 && uy >= L.y0 && uy <= L.y1) ||
          (ux >= L.x1 && ux <= L.x2 && uy >= L.yBottom && uy <= L.y1);
        if (inL) { R = 255; G = 255; B = 255; }
      }
      buf[i] = Math.round(R);
      buf[i + 1] = Math.round(G);
      buf[i + 2] = Math.round(B);
      buf[i + 3] = A;
    }
  }
  return buf;
}

const files = [
  ['icon-192.png', 192, 0.22, 0.62],
  ['icon-512.png', 512, 0.22, 0.62],
  ['icon-maskable-512.png', 512, 0.5, 0.46],
];

files.forEach(([name, size, radius, pad]) => {
  fs.writeFileSync(path.join(OUT, name), png(size, size, draw(size, radius, pad)));
  console.log('generated', name);
});
