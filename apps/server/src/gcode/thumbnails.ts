import { createReadStream, createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { open, rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { deflateSync } from 'node:zlib';

type Point = [number, number, number];
type Segment = { from: Point; to: Point; width: number; support: boolean };
export interface GcodeThumbnail { size: number; png: Buffer; firstRow: number; lastRow: number }
const sizes = [96, 300] as const;

async function* lines(filename: string, signal?: AbortSignal) {
  let pending = '';
  for await (const chunk of createReadStream(filename, { encoding: 'utf8', highWaterMark: 65536, signal })) {
    signal?.throwIfAborted();
    const batch = (pending + chunk).split('\n');
    pending = batch.pop()!;
    for (const line of batch) yield line.trim();
    if (pending.length > 65536) throw new Error('G-code line is too long to generate a preview.');
  }
  if (pending) yield pending.trim();
}

// Use the final extrusion paths, so automatic orientation, scaling and supports
// match the slice. Travel, startup purge lines, retractions and shutdown are omitted.
async function visitSegments(filename: string, visit: (segment: Segment) => void, signal?: AbortSignal) {
  let position: Point = [0, 0, 0], extrusion = 0;
  let relativePosition = false, relativeExtrusion = false, printable = false, support = false, width = 0.42, layerCount = 0;
  for await (const line of lines(filename, signal)) {
    const type = line.match(/^;TYPE:(.+)/i)?.[1];
    if (type) { printable = !/custom|skirt|brim|wipe tower/i.test(type); support = /support/i.test(type); continue; }
    const total = line.match(/^;\s*total layer number:\s*(\d+)/i)?.[1];
    if (total) { layerCount = Number(total); continue; }
    const lineWidth = line.match(/^;WIDTH:([\d.]+)/i)?.[1];
    if (lineWidth) { const value = Number(lineWidth); if (value > 0 && value <= 5) width = value; continue; }
    const command = line.split(';', 1)[0].trim();
    const code = command.match(/^(G0?[0123]|G9[012]|M8[23])(?:\s|$)/i)?.[1]?.toUpperCase();
    if (!code) continue;
    if (code === 'G90') { relativePosition = false; continue; }
    if (code === 'G91') { relativePosition = true; continue; }
    if (code === 'M82') { relativeExtrusion = false; continue; }
    if (code === 'M83') { relativeExtrusion = true; continue; }
    const fields: Record<string, number> = {};
    for (const match of command.matchAll(/([XYZEIJR])\s*([-+]?(?:\d+\.?\d*|\.\d+))/gi)) fields[match[1].toUpperCase()] = Number(match[2]);
    if (Object.values(fields).some(value => !Number.isFinite(value) || Math.abs(value) > 1e7)) throw new Error('G-code contains an invalid preview coordinate.');
    if (code === 'G92') {
      position = position.map((value, index) => fields['XYZ'[index]] ?? value) as Point;
      extrusion = fields.E ?? extrusion;
      continue;
    }
    const next = position.map((value, index) => fields['XYZ'[index]] === undefined ? value : fields['XYZ'[index]] + (relativePosition ? value : 0)) as Point;
    const amount = fields.E === undefined ? 0 : relativeExtrusion ? fields.E : fields.E - extrusion;
    if (fields.E !== undefined) extrusion = relativeExtrusion ? extrusion + fields.E : fields.E;
    const arc = code === 'G2' || code === 'G02' || code === 'G3' || code === 'G03';
    if (printable && amount > 0 && (arc || next.some((value, index) => value !== position[index]))) {
      if (arc) {
        const clockwise = code === 'G2' || code === 'G02';
        let cx: number, cy: number;
        if (fields.I !== undefined || fields.J !== undefined) {
          cx = position[0] + (fields.I ?? 0); cy = position[1] + (fields.J ?? 0);
        } else if (fields.R !== undefined) {
          const dx = next[0] - position[0], dy = next[1] - position[1], chord = Math.hypot(dx, dy);
          const offset = Math.sqrt(Math.max(0, fields.R ** 2 - chord ** 2 / 4));
          if (!chord || chord > 2 * Math.abs(fields.R) + 1e-4) throw new Error('Invalid G-code preview arc.');
          const side = (clockwise ? -1 : 1) * (fields.R < 0 ? -1 : 1);
          cx = (position[0] + next[0]) / 2 - side * dy / chord * offset;
          cy = (position[1] + next[1]) / 2 + side * dx / chord * offset;
        } else throw new Error('G-code preview arc has no center.');
        const radius = Math.hypot(position[0] - cx, position[1] - cy);
        const start = Math.atan2(position[1] - cy, position[0] - cx);
        let sweep = Math.atan2(next[1] - cy, next[0] - cx) - start;
        if (clockwise && sweep >= 0) sweep -= 2 * Math.PI;
        if (!clockwise && sweep <= 0) sweep += 2 * Math.PI;
        const steps = Math.min(512, Math.max(4, Math.ceil(Math.abs(sweep) * radius / 0.5)));
        let previous = position;
        for (let step = 1; step <= steps; step++) {
          const t = step / steps, angle = start + sweep * t;
          const point: Point = step === steps ? next : [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle), position[2] + (next[2] - position[2]) * t];
          visit({ from: previous, to: point, width, support }); previous = point;
        }
      } else visit({ from: position, to: next, width, support });
    }
    position = next;
  }
  return layerCount;
}

const project = ([x, y, z]: Point): Point => [(x - y) / Math.SQRT2, (x + y - 2 * z) / Math.sqrt(6), (x + y + z) / Math.sqrt(3)];

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length); chunk.write(type, 4, 4, 'ascii'); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}
function encodePng(size: number, pixels: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}

export async function renderGcodeThumbnails(filename: string, signal?: AbortSignal): Promise<{ images: GcodeThumbnail[]; layerCount: number }> {
  signal?.throwIfAborted();
  const min = [Infinity, Infinity], max = [-Infinity, -Infinity];
  let count = 0, maximumWidth = 0;
  const layerCount = await visitSegments(filename, segment => {
    count++; maximumWidth = Math.max(maximumWidth, segment.width);
    for (const point of [segment.from, segment.to]) {
      const projected = project(point);
      for (let axis = 0; axis < 2; axis++) { min[axis] = Math.min(min[axis], projected[axis]); max[axis] = Math.max(max[axis], projected[axis]); }
    }
  }, signal);
  if (!count) throw new Error('Orca produced no printable extrusion paths for the preview.');
  const extent = Math.max(max[0] - min[0], max[1] - min[1], maximumWidth * 2, 0.01);
  const frames = sizes.map(size => ({ size, scale: size * 0.86 / extent, pixels: Buffer.alloc(size * size * 4), depth: new Float64Array(size * size).fill(-Infinity) }));
  await visitSegments(filename, segment => {
    const a = project(segment.from), b = project(segment.to);
    const brightness = 0.72 + 0.28 * Math.abs(b[0] - a[0]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
    const color = (segment.support ? [100, 155, 190] : [244, 174, 77]).map(value => Math.round(value * brightness));
    for (const frame of frames) {
      const xy = (p: Point) => [(p[0] - (min[0] + max[0]) / 2) * frame.scale + frame.size / 2, (p[1] - (min[1] + max[1]) / 2) * frame.scale + frame.size / 2];
      const start = xy(a), end = xy(b), steps = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1])));
      const radius = Math.min(8, Math.max(0.65, segment.width * frame.scale / 2));
      for (let step = 0; step <= steps; step++) {
        const t = step / steps, x = start[0] + (end[0] - start[0]) * t, y = start[1] + (end[1] - start[1]) * t, depth = a[2] + (b[2] - a[2]) * t;
        for (let py = Math.max(0, Math.floor(y - radius)); py <= Math.min(frame.size - 1, Math.ceil(y + radius)); py++) {
          for (let px = Math.max(0, Math.floor(x - radius)); px <= Math.min(frame.size - 1, Math.ceil(x + radius)); px++) {
            if ((px - x) ** 2 + (py - y) ** 2 > radius ** 2 + 0.5) continue;
            const index = py * frame.size + px;
            if (depth < frame.depth[index]) continue;
            frame.depth[index] = depth;
            for (let channel = 0; channel < 3; channel++) frame.pixels[index * 4 + channel] = color[channel];
            frame.pixels[index * 4 + 3] = 255;
          }
        }
      }
    }
  }, signal);
  const images = frames.map(({ size, pixels }) => {
    let firstRow = size - 1, lastRow = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (pixels[(y * size + x) * 4 + 3]) { firstRow = Math.min(firstRow, y); lastRow = Math.max(lastRow, y); }
    return { size, png: encodePng(size, pixels), firstRow, lastRow };
  });
  signal?.throwIfAborted();
  return { images, layerCount };
}

/** Prepend only comments; preserve every original byte and printer command. */
export async function embedGcodeThumbnails(filename: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const handle = await open(filename, 'r');
  let existing: string;
  try { const head = Buffer.alloc(512 * 1024); const { bytesRead } = await handle.read(head, 0, head.length, 0); existing = head.toString('utf8', 0, bytesRead); } finally { await handle.close(); }
  if (sizes.every(size => existing.includes('; png begin ' + size + '*' + size + ' ') && existing.includes('; thumbnail begin ' + size + 'x' + size + ' '))) return;
  const { images, layerCount } = await renderGcodeThumbnails(filename, signal);
  const block = (image: GcodeThumbnail, creality: boolean) => {
    const encoded = image.png.toString('base64'), tag = creality ? 'png' : 'thumbnail';
    const dimensions = image.size + (creality ? '*' : 'x') + image.size;
    const extra = creality ? ' ' + image.firstRow + ' ' + image.lastRow + ' ' + layerCount : '';
    return '; ' + tag + ' begin ' + dimensions + ' ' + encoded.length + extra + '\n' +
      encoded.match(/.{1,78}/g)!.map(row => '; ' + row + '\n').join('') + '; ' + tag + ' end\n\n';
  };
  // Creality's small image goes first. Standard blocks also support Moonraker.
  const prefix = Buffer.from(images.map(image => block(image, true)).join('') + images.map(image => block(image, false)).join(''));
  const temporary = join(dirname(filename), '.thumbnail-' + randomUUID() + '.tmp');
  async function* content() { yield prefix; yield* createReadStream(filename, { signal }); }
  try {
    await pipeline(Readable.from(content()), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
    signal?.throwIfAborted();
    await rename(temporary, filename);
  } finally { await rm(temporary, { force: true }); }
}
