import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readStlTriangles, rotationScaleMatrix, prepareTransformedStl } from './stl-project.js';
import { transformSchema } from '@orca-web/shared';

describe('STL placement project', () => {
  it('reads actual ASCII cube triangles and writes a 3MF geometry project', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stl-project-'));
    try {
      const triangles = [];
      for await (const triangle of readStlTriangles(resolve('fixtures/cube-20mm.stl'))) triangles.push(triangle);
      expect(triangles).toHaveLength(12);
      const output = join(dir, 'model.3mf');
      await prepareTransformedStl(resolve('fixtures/cube-20mm.stl'), output, transformSchema.parse({ scale: 1.5, rotation: { x: 15, y: 25, z: 35 } }), { width: 220, depth: 220, height: 245 });
      expect((await stat(output)).size).toBeGreaterThan(200);
    } finally { await rm(dir, { force: true, recursive: true }); }
  });
  it('applies X then Y then Z rotation and uniform scale', () => {
    const matrix = rotationScaleMatrix(transformSchema.parse({ scale: 2, rotation: { x: 90, y: 0, z: 90 } }));
    // +Y first rotates into +Z; subsequent Z rotation preserves +Z.
    expect(matrix[3]).toBeCloseTo(0);
    expect(matrix[4]).toBeCloseTo(0);
    expect(matrix[5]).toBeCloseTo(2);
    // +X finally points +Y.
    expect(matrix[0]).toBeCloseTo(0);
    expect(matrix[1]).toBeCloseTo(2);
  });
  it('recognizes binary STL whose arbitrary header begins with solid', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stl-binary-'));
    try {
      const binary = Buffer.alloc(134);
      binary.write('solid binary header'); binary.writeUInt32LE(1, 80);
      binary.writeFloatLE(1, 96); binary.writeFloatLE(2, 112); binary.writeFloatLE(3, 128);
      const file = join(dir, 'binary.stl'); await writeFile(file, binary);
      const triangles = [];
      for await (const triangle of readStlTriangles(file)) triangles.push(triangle);
      expect(triangles).toHaveLength(1);
      expect(triangles[0][0][0]).toBe(1);
    } finally { await rm(dir, { force: true, recursive: true }); }
  });
  it('rejects non-finite vertices and oversized ASCII lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'stl-invalid-'));
    try {
      for (const text of ['solid bad\nvertex Infinity 0 0\n', 'x'.repeat(70000)]) {
        const file = join(dir, 'bad.stl'); await writeFile(file, text);
        const parse = async () => { for await (const _ of readStlTriangles(file)) { /* drain */ } };
        await expect(parse()).rejects.toThrow();
      }
    } finally { await rm(dir, { force: true, recursive: true }); }
  });
});
