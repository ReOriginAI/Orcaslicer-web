import { describe, expect, it } from 'vitest';
import { sliceOptionsSchema } from './jobs.js';
const selection = { machineId: 'machine', processId: 'process', filamentId: 'filament' };
describe('public slice options', () => {
  it('supplies safe transform and preset-only defaults', () => {
    expect(sliceOptionsSchema.parse(selection)).toMatchObject({ transform: { scale: 1, ensureOnBed: true, autoArrange: true }, overrides: {} });
  });
  it.each([
    { arguments: ['--config', '/etc/passwd'] },
    { overrides: { printer_start_gcode: 'arbitrary' } },
    { overrides: { infillPercent: 101 } },
    { overrides: { wallCount: 1.5 } },
    { transform: { scale: 0 } },
    { transform: { rotation: { x: Infinity, y: 0, z: 0 } } },
  ])('rejects unsupported or unsafe settings: %j', (extra) => {
    expect(sliceOptionsSchema.safeParse({ ...selection, ...extra }).success).toBe(false);
  });
  it('accepts all allowlisted override types', () => {
    expect(sliceOptionsSchema.parse({ ...selection, overrides: { layerHeight: 0.16, wallCount: 3, infillPercent: 20, supports: true, brim: false } }).overrides.wallCount).toBe(3);
  });
});
