import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { ambientOffsets, overridesSchema, seasonalAmbientPresets, sliceOptionsSchema } from '@orca-web/shared';
import { applyFilamentOverrides, materializeProfiles, validateMachineOverrides } from '../src/orca/profiles.js';
import { PresetRegistry } from '../src/presets/discovery.js';
import { registry, record } from './fixtures.js';

const filament = {
  filament_retraction_length: ['2'], nozzle_temperature: ['220'], nozzle_temperature_initial_layer: ['220'],
  nozzle_temperature_range_low: ['190'], nozzle_temperature_range_high: ['230'],
  hot_plate_temp: ['55'], hot_plate_temp_initial_layer: ['55'],
  textured_plate_temp: ['55'], textured_plate_temp_initial_layer: ['55'],
  cool_plate_temp: ['0'], cool_plate_temp_initial_layer: ['0'],
};
const limits = { maxNozzleTemperature: 300, maxBedTemperature: 100 };
describe('advanced and ambient tuning', () => {
  it('keeps presets untouched when no overrides are supplied', () => {
    expect(applyFilamentOverrides(filament, {}, limits)).toEqual(filament);
  });
  it('applies manual values before a bounded first-layer adjustment and preserves later layers', () => {
    const result = applyFilamentOverrides(filament, {
      firstLayerNozzleTemperature: 225, nozzleTemperature: 215,
      firstLayerBedTemperature: 60, bedTemperature: 50, ambientTemperatureC: 15,
      flowRatio: 0.95, fanSpeed: 0, coolingOffLayers: 2,
    }, limits);
    expect(result).toMatchObject({ nozzle_temperature: ['215'], nozzle_temperature_initial_layer: ['227'],
      hot_plate_temp: ['50'], hot_plate_temp_initial_layer: ['64'], textured_plate_temp_initial_layer: ['64'],
      filament_flow_ratio: ['0.95'], fan_min_speed: ['0'], fan_max_speed: ['0'], close_fan_the_first_x_layers: ['2'] });
    expect(filament.nozzle_temperature_initial_layer).toEqual(['220']);
  });
  it('clamps extreme weather to material and machine limits and preserves an unheated bed', () => {
    expect(applyFilamentOverrides({ ...filament, nozzle_temperature_initial_layer: ['230'], hot_plate_temp_initial_layer: ['99'] }, { ambientTemperatureC: 10 }, limits))
      .toMatchObject({ nozzle_temperature_initial_layer: ['230'], hot_plate_temp_initial_layer: ['100'], cool_plate_temp_initial_layer: ['0'] });
    expect(applyFilamentOverrides({ ...filament, nozzle_temperature_initial_layer: ['190'] }, { ambientTemperatureC: 40 }, limits))
      .toMatchObject({ nozzle_temperature_initial_layer: ['190'], hot_plate_temp_initial_layer: ['50'] });
    expect(applyFilamentOverrides(filament, { ambientTemperatureC: 22 }, limits)).toEqual(filament);
  });
  it('provides four editable seasons and caps both offsets at five degrees', () => {
    expect(seasonalAmbientPresets).toHaveLength(4);
    for (const season of seasonalAmbientPresets) expect(overridesSchema.safeParse({ ambientTemperatureC: season.temperature }).success).toBe(true);
    expect(ambientOffsets(10)).toEqual({ nozzle: 4, bed: 5 });
    expect(ambientOffsets(40)).toEqual({ nozzle: -5, bed: -5 });
  });
  it.each([{ ambientTemperatureC: 9.9 }, { ambientTemperatureC: 40.1 }, { ambientTemperatureC: Infinity },
    { fanSpeed: 101 }, { nozzleTemperature: 301 }, { bedTemperature: -1 }, { retractionLength: 11 },
    { flowRatio: 1.21 }, { topShellLayers: 1.5 }, { acceleration: 10001 }])('rejects invalid tuning %j', overrides => {
    expect(overridesSchema.safeParse(overrides).success).toBe(false);
  });
  it('rejects layer heights, temperatures, and acceleration outside the selected machine limits', () => {
    const r = registry();
    for (const overrides of [{ layerHeight: 0.4 }, { firstLayerHeight: 0.4 }, { acceleration: 501 }, { bedTemperature: 101 }])
      expect(() => validateMachineOverrides(r, sliceOptionsSchema.parse({ ...r.catalog.defaults, overrides }))).toThrow();
  });
  it('writes process, filament and machine settings to the proper job profiles', async () => {
    const base = registry();
    const r = new PresetRegistry([...base.records.values()].map(p => p.kind === 'filament' ? { ...p, flat: undefined, data: { ...p.data, ...filament } } : p));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orca-tuning-'));
    try {
      const options = sliceOptionsSchema.parse({ ...r.catalog.defaults, overrides: {
        firstLayerHeight: 0.2, topShellLayers: 4, bottomShellLayers: 3,
        firstLayerSpeed: 20, outerWallSpeed: 30, innerWallSpeed: 50, infillSpeed: 60, travelSpeed: 120, acceleration: 500,
        retractionLength: 0, retractionSpeed: 35, zHop: 0.4, firstLayerNozzleTemperature: 220, nozzleTemperature: 215,
        firstLayerBedTemperature: 55, bedTemperature: 50, ambientTemperatureC: 15, flowRatio: 0.95, fanSpeed: 80, coolingOffLayers: 2,
      } });
      const paths = await materializeProfiles(r, options, dir);
      const read = async (filename: string) => JSON.parse(await fs.readFile(filename, 'utf8'));
      expect(await read(paths.machineProfile)).toMatchObject({ retraction_length: ['0'], retraction_speed: ['35'], z_hop: ['0.4'] });
      expect(await read(paths.processProfile)).toMatchObject({ initial_layer_print_height: '0.2', top_shell_layers: '4', bottom_shell_layers: '3', initial_layer_speed: '20', outer_wall_speed: '30', inner_wall_speed: '50', sparse_infill_speed: '60', travel_speed: '120', default_acceleration: '500' });
      expect(await read(paths.filamentProfile)).toMatchObject({ nozzle_temperature: ['215'], nozzle_temperature_initial_layer: ['222'], hot_plate_temp_initial_layer: ['59'], hot_plate_temp: ['50'], filament_flow_ratio: ['0.95'], fan_max_speed: ['80'], filament_retraction_length: ['0'] });
      expect(() => validateMachineOverrides(r, { ...options, overrides: { nozzleTemperature: 235 } })).toThrow(/190 and 230/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('exposes Pro nozzle variants with their own defaults while retaining the KE default', () => {
    const base = registry();
    const name = 'Creality Ender-3 Pro 0.4 nozzle';
    const process = record('process', 'Pro Standard', { compatible_printers: [name] });
    const pla = record('filament', 'Pro PLA', { compatible_printers: [name] });
    const pro = record('machine', name, { inherits: 'base', printable_height: '250', default_print_profile: process.name, default_filament_profile: [pla.name], retraction_length: ['4'], machine_max_acceleration_extruding: ['500'] });
    const r = new PresetRegistry([...base.records.values(), pro, process, pla]);
    expect(r.catalog.defaults).toEqual(base.catalog.defaults);
    const preset = r.catalog.machines.find(m => m.name === name)!;
    expect(preset.buildVolume.height).toBe(250);
    expect(preset.settingValues?.retraction_length).toBe('4');
    expect(r.resolve(preset.defaults!).machine.name).toBe(name);
    expect(() => r.resolve({ ...r.catalog.defaults!, machineId: preset.id })).toThrow(/incompatible/);
    expect(() => validateMachineOverrides(r, sliceOptionsSchema.parse({ ...preset.defaults, overrides: { nozzleTemperature: 251 } }))).toThrow(/250/);
  });
});
