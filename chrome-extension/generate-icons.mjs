import { deflateRaw } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { promisify } from 'util';
const deflate = promisify(deflateRaw);

function crc32(buf) {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  let c = 0xFFFFFFFF;
  for (const b of buf) c = t[(c ^ b) & 0xFF] ^ (c >>> 8);
  return ((c ^ 0xFFFFFFFF) >>> 0);
}

function chunk(type, data) {
  const ty = Buffer.from(type);
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcBuf = Buffer.concat([ty, data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(crcBuf));
  return Buffer.concat([len, ty, data, cr]);
}

async function makePNG(size) {
  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0); // PNG filter byte per row
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * (size - 1));
      // gradient: #5FD3EE → #0E7490
      const r = Math.round(0x5F + t * (0x0E - 0x5F));
      const g = Math.round(0xD3 + t * (0x74 - 0xD3));
      const b = Math.round(0xEE + t * (0x90 - 0xEE));
      // small white circle in centre
      const cx = x - size / 2 + 0.5, cy = y - size / 2 + 0.5;
      const rad = size * 0.28;
      if (cx*cx + cy*cy < rad*rad) raw.push(255, 255, 255, 255);
      else raw.push(r, g, b, 255);
    }
  }
  const compressed = await deflate(Buffer.from(raw));
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync('icons', { recursive: true });
for (const size of [16, 48, 128]) {
  const png = await makePNG(size);
  writeFileSync(`icons/icon${size}.png`, png);
  console.log(`icons/icon${size}.png  (${png.length} bytes)`);
}
console.log('Icons generated.');
