import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import type { BuildVolume, Transform } from '@orca-web/shared';

type Vector = [number, number, number];
type Triangle = [Vector, Vector, Vector];
const coordinate = (value: number) => {
  if (!Number.isFinite(value) || Math.abs(value) > 1e7) throw new Error('STL contains an invalid vertex coordinate.');
  return value;
};

/** Read triangles with bounded memory, including binary STL headers beginning with "solid". */
export async function* readStlTriangles(filename: string, signal?: AbortSignal): AsyncGenerator<Triangle> {
  signal?.throwIfAborted();
  const info = await stat(filename);
  const handle = await open(filename, 'r');
  const header = Buffer.alloc(84);
  let bytesRead: number;
  try { ({ bytesRead } = await handle.read(header, 0, 84, 0)); } finally { await handle.close(); }
  const count = bytesRead === 84 ? header.readUInt32LE(80) : 0;
  if (bytesRead === 84 && 84 + count * 50 === info.size) {
    if (!count) throw new Error('STL has no triangles.');
    let pending = Buffer.alloc(0);
    let parsed = 0;
    for await (const chunk of createReadStream(filename, { start: 84, highWaterMark: 65536, signal })) {
      const data = Buffer.concat([pending, chunk as Buffer]);
      let offset = 0;
      while (offset + 50 <= data.length) {
        const vertex = (start: number): Vector => [coordinate(data.readFloatLE(start)), coordinate(data.readFloatLE(start + 4)), coordinate(data.readFloatLE(start + 8))];
        yield [vertex(offset + 12), vertex(offset + 24), vertex(offset + 36)];
        parsed++;
        offset += 50;
      }
      pending = Buffer.from(data.subarray(offset));
    }
    if (pending.length || parsed !== count) throw new Error('Truncated binary STL.');
    return;
  }
  let pending = '';
  let vertices: Vector[] = [];
  let countAscii = 0;
  const parse = (line: string) => {
    const trimmed = line.trim();
    if (!/^vertex\s/i.test(trimmed)) return;
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 4) throw new Error('Invalid ASCII STL vertex.');
    const numbers = parts.slice(1).map((value) => coordinate(Number(value))) as Vector;
    vertices.push(numbers);
  };
  for await (const chunk of createReadStream(filename, { encoding: 'utf8', highWaterMark: 65536, signal })) {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) {
      parse(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
      if (vertices.length === 3) { yield vertices as Triangle; vertices = []; countAscii++; }
    }
    if (pending.length > 65536) throw new Error('STL line exceeds the allowed length.');
  }
  if (pending) parse(pending);
  if (vertices.length === 3) { yield vertices as Triangle; vertices = []; countAscii++; }
  if (vertices.length || !countAscii) throw new Error('STL contains incomplete or no triangles.');
}

/** Row-vector 3MF matrix: Rz * Ry * Rx for the browser's ZYX Euler order. */
export function rotationScaleMatrix(transform: Transform): number[] {
  const rad = Math.PI / 180;
  const { x, y, z } = transform.rotation;
  const cx = Math.cos(x * rad), sx = Math.sin(x * rad);
  const cy = Math.cos(y * rad), sy = Math.sin(y * rad);
  const cz = Math.cos(z * rad), sz = Math.sin(z * rad);
  return [
    cz * cy, sz * cy, -sy,
    cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx,
    cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx,
  ].map((value) => Math.abs(value) < 1e-14 ? 0 : value * transform.scale);
}

/** Orca 2.4.2 crashes with direct rotate/scale flags; use its standard 3MF placement support. */
export async function prepareTransformedStl(inputPath: string, outputPath: string, transform: Transform, volume: BuildVolume, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const matrix = rotationScaleMatrix(transform);
  const min: Vector = [Infinity, Infinity, Infinity], max: Vector = [-Infinity, -Infinity, -Infinity];
  let minimumProjectedZ = Infinity;
  let triangleCount = 0;
  for await (const triangle of readStlTriangles(inputPath, signal)) {
    triangleCount++;
    for (const vertex of triangle) {
      for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], vertex[axis]); max[axis] = Math.max(max[axis], vertex[axis]); }
      minimumProjectedZ = Math.min(minimumProjectedZ, matrix[2] * vertex[0] + matrix[5] * vertex[1] + matrix[8] * vertex[2]);
    }
  }
  const center = min.map((value, axis) => (value + max[axis]) / 2) as Vector;
  const minimumCenteredZ = minimumProjectedZ - (matrix[2] * center[0] + matrix[5] * center[1] + matrix[8] * center[2]);
  const translation: Vector = [
    transform.autoArrange ? volume.width / 2 : center[0],
    transform.autoArrange ? volume.depth / 2 : center[1],
    transform.ensureOnBed ? -minimumCenteredZ : center[2],
  ];
  const xmlPath = `${outputPath}.model.xml`;
  async function* xml() {
    yield '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model" name="Transformed model"><mesh><vertices>';
    let buffer = '';
    for await (const triangle of readStlTriangles(inputPath, signal)) {
      for (const vertex of triangle) buffer += `<vertex x="${vertex[0] - center[0]}" y="${vertex[1] - center[1]}" z="${vertex[2] - center[2]}"/>`;
      if (buffer.length > 65536) { signal?.throwIfAborted(); yield buffer; buffer = ''; }
    }
    yield buffer + '</vertices><triangles>';
    buffer = '';
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const index = triangle * 3;
      buffer += `<triangle v1="${index}" v2="${index + 1}" v3="${index + 2}"/>`;
      if (buffer.length > 65536) { yield buffer; buffer = ''; }
    }
    yield buffer + `</triangles></mesh></object></resources><build><item objectid="1" transform="${[...matrix, ...translation].join(' ')}"/></build></model>`;
  }
  try {
    await pipeline(Readable.from(xml()), createWriteStream(xmlPath, { flags: 'wx', mode: 0o600 }), { signal });
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'), '[Content_Types].xml');
    zip.addBuffer(Buffer.from('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>'), '_rels/.rels');
    zip.addFile(xmlPath, '3D/3dmodel.model');
    zip.on('error', (error) => (zip.outputStream as Readable).destroy(error));
    const saved = pipeline(zip.outputStream, createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }), { signal });
    zip.end();
    await saved;
  } finally { await unlink(xmlPath).catch(() => undefined); }
}
