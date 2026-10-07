import fs from 'node:fs/promises';
import path from 'node:path';
import { overridesSchema, ambientOffsets, processSettingKeys, machineSettingKeys, filamentSettingKeys, bedTemperatureKeys, type Overrides, type SliceOptions } from '@orca-web/shared';
import type { PresetRegistry, ProfileData } from '../presets/discovery.js';
export function applyOverrides(profile: ProfileData, values: Overrides): ProfileData {
  const overrides = overridesSchema.parse(values); const copy = { ...profile };
  for (const [key, orcaKey] of Object.entries(processSettingKeys)) {
    const value = overrides[key as keyof typeof processSettingKeys];
    if (value !== undefined) copy[orcaKey] = String(value);
  }
  if (overrides.infillPercent !== undefined) copy.sparse_infill_density = `${overrides.infillPercent}%`;
  if (overrides.infillPattern !== undefined) copy.sparse_infill_pattern = overrides.infillPattern;
  if (overrides.supportType !== undefined) copy.support_type = overrides.supportType;
  if (overrides.supportOnBuildPlateOnly !== undefined) copy.support_on_build_plate_only = overrides.supportOnBuildPlateOnly ? '1' : '0';
  if (overrides.supports !== undefined) copy.enable_support = overrides.supports ? '1' : '0';
  if (overrides.brim !== undefined) { copy.brim_type = overrides.brim ? 'outer_only' : 'no_brim'; if (overrides.brim) copy.brim_width = '5'; }
  return copy;
}
export function validateMachineOverrides(registry: PresetRegistry, options: SliceOptions) {
  const profiles = registry.resolve(options);
  const limits = registry.catalog.machines.find(m => m.id === options.machineId)!.limits!;
  const values = overridesSchema.parse(options.overrides);
  for (const key of ['layerHeight', 'firstLayerHeight'] as const) {
    const value = values[key];
    if (value !== undefined && (value < limits.minLayerHeight || value > limits.maxLayerHeight))
      throw new Error(`Layer height must be between ${limits.minLayerHeight} and ${limits.maxLayerHeight} mm for the selected nozzle`);
  }
  if (values.acceleration !== undefined && values.acceleration > limits.maxAcceleration)
    throw new Error(`Acceleration cannot exceed ${limits.maxAcceleration} mm/s² for this printer`);
  for (const key of ['firstLayerSpeed', 'outerWallSpeed', 'innerWallSpeed', 'infillSpeed', 'travelSpeed'] as const)
    if (values[key] !== undefined && values[key]! > limits.maxSpeed) throw new Error(`Speed cannot exceed ${limits.maxSpeed} mm/s for this printer`);
  const filament = profiles.filament.flat!;
  const read = (key: string, fallback: number) => profileNumber(filament, key) ?? fallback;
  const low = Math.max(150, read('nozzle_temperature_range_low', 150));
  const high = Math.min(limits.maxNozzleTemperature, read('nozzle_temperature_range_high', limits.maxNozzleTemperature));
  if (values.ambientTemperatureC !== undefined && low > high) throw new Error('This filament temperature range exceeds the selected printer limits');
  for (const key of ['nozzleTemperature', 'firstLayerNozzleTemperature'] as const)
    if (values[key] !== undefined && (values[key]! < low || values[key]! > high)) throw new Error(`Nozzle temperature must be between ${low} and ${high} °C for this printer and filament`);
  for (const key of ['bedTemperature', 'firstLayerBedTemperature'] as const)
    if (values[key] !== undefined && values[key]! > limits.maxBedTemperature) throw new Error(`Bed temperature cannot exceed ${limits.maxBedTemperature} °C for this printer`);
  return { profiles, limits, low, high };
}
function profileNumber(profile: ProfileData, key: string): number | undefined {
  const raw = Array.isArray(profile[key]) ? profile[key][0] : profile[key];
  const value = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(value) ? value : undefined;
}
export function applyFilamentOverrides(profile: ProfileData, values: Overrides, limits: { maxNozzleTemperature: number; maxBedTemperature: number }): ProfileData {
  const overrides = overridesSchema.parse(values);
  const copy = { ...profile };
  for (const [key, orcaKey] of Object.entries(filamentSettingKeys)) {
    const value = overrides[key as keyof typeof filamentSettingKeys];
    if (value !== undefined) copy[orcaKey] = [String(value)];
  }
  // Orca filament retraction values take precedence over printer values.
  for (const [key, orcaKey] of Object.entries(machineSettingKeys)) {
    const value = overrides[key as keyof typeof machineSettingKeys];
    if (value !== undefined) copy[`filament_${orcaKey}`] = [String(value)];
  }
  if (overrides.fanSpeed !== undefined) {
    copy.fan_min_speed = [String(overrides.fanSpeed)];
    copy.fan_max_speed = [String(overrides.fanSpeed)];
  }
  for (const key of bedTemperatureKeys) {
    if (overrides.bedTemperature !== undefined) copy[key] = [String(overrides.bedTemperature)];
    if (overrides.firstLayerBedTemperature !== undefined) copy[`${key}_initial_layer`] = [String(overrides.firstLayerBedTemperature)];
  }
  if (overrides.ambientTemperatureC !== undefined) {
    const offsets = ambientOffsets(overrides.ambientTemperatureC);
    const low = Math.max(150, profileNumber(profile, 'nozzle_temperature_range_low') ?? 150);
    const high = Math.min(limits.maxNozzleTemperature, profileNumber(profile, 'nozzle_temperature_range_high') ?? limits.maxNozzleTemperature);
    const nozzle = profileNumber(copy, 'nozzle_temperature_initial_layer');
    if (nozzle !== undefined) copy.nozzle_temperature_initial_layer = [String(Math.max(low, Math.min(high, nozzle + offsets.nozzle)))];
    for (const key of bedTemperatureKeys) {
      const initialKey = `${key}_initial_layer`;
      const bed = profileNumber(copy, initialKey);
      // A disabled bed stays disabled. Missing plate settings retain Orca defaults.
      if (bed !== undefined && bed > 0) copy[initialKey] = [String(Math.max(0, Math.min(limits.maxBedTemperature, bed + offsets.bed)))];
    }
  }
  return copy;
}
export async function materializeProfiles(registry: PresetRegistry, options: SliceOptions, workDir: string) {
  const { profiles, limits } = validateMachineOverrides(registry, options);
  const paths = { machineProfile: path.join(workDir, 'machine.json'), processProfile: path.join(workDir, 'process.json'), filamentProfile: path.join(workDir, 'filament.json') };
  // Orca CLI does not resolve preset inheritance. Fully flattened copies preserve bundled settings.
  const machine: ProfileData = { ...profiles.machine.flat!, printer_settings_id: profiles.machine.name };
  for (const [key, orcaKey] of Object.entries(machineSettingKeys)) {
    const value = options.overrides[key as keyof typeof machineSettingKeys];
    if (value !== undefined) machine[orcaKey] = [String(value)];
  }
  const process = applyOverrides({ ...profiles.process.flat!, print_settings_id: profiles.process.name }, options.overrides);
  const filament = applyFilamentOverrides({ ...profiles.filament.flat!, filament_settings_id: [profiles.filament.name] }, options.overrides, limits);
  await Promise.all([fs.writeFile(paths.machineProfile, JSON.stringify(machine)), fs.writeFile(paths.processProfile, JSON.stringify(process)), fs.writeFile(paths.filamentProfile, JSON.stringify(filament))]);
  return paths;
}
