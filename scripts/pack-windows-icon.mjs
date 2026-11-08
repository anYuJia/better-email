// Assemble Tauri-generated PNG sizes into a single Windows ICO file.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [inputDir, output] = process.argv.slice(2);
if (!inputDir || !output) throw new Error('Usage: node scripts/pack-windows-icon.mjs <png-directory> <output.ico>');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const images = sizes.map((size) => readFileSync(join(inputDir, `${size}x${size}.png`)));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i += 1) {
  const entry = 6 + i * 16;
  header[entry] = sizes[i] === 256 ? 0 : sizes[i];
  header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
}
writeFileSync(output, Buffer.concat([header, ...images]));
