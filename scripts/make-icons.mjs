// Gera icon-192.png e icon-512.png (sem dependências) com as barras do logo.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function png(size, { maskable }) {
  const bg = [0x12, 0x15, 0x1a], fg = [0xf2, 0xb8, 0x4b];
  const k = size / 512;
  const scale = maskable ? 0.72 : 1; // área segura para ícones maskable
  const bars = [[96, 212, 170], [180, 130, 252], [264, 180, 202], [348, 250, 132]];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / k, py = (y + 0.5) / k;
      const cx = 256 + (px - 256) / scale, cy = 256 + (py - 256) / scale;
      let inBar = false;
      for (const [bx, by, bh] of bars) {
        const w = 52, r = 26;
        if (cx >= bx && cx <= bx + w && cy >= by && cy <= by + bh) {
          const dy = cy < by + r ? by + r - cy : cy > by + bh - r ? cy - (by + bh - r) : 0;
          if (!dy || Math.hypot(cx - (bx + r), dy) <= r) inBar = true;
        }
      }
      const rounded = maskable || (() => { // cantos arredondados do fundo
        const rr = 112, ex = Math.min(px, 512 - px), ey = Math.min(py, 512 - py);
        return ex >= rr || ey >= rr || Math.hypot(rr - ex, rr - ey) <= rr;
      })();
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const col = inBar ? fg : bg;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = rounded ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = new URL('../icons/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), png(192, { maskable: false }));
writeFileSync(new URL('icon-512.png', out), png(512, { maskable: false }));
writeFileSync(new URL('icon-maskable-512.png', out), png(512, { maskable: true }));
console.log('ícones gerados');
