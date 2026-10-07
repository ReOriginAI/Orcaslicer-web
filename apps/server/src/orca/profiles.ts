import fs from 'node:fs/promises';
import path from 'node:path';
import { overridesSchema, type Overrides, type SliceOptions } from '@orca-web/shared';
import type { PresetRegistry, ProfileData } from '../presets/discovery.js';
export function applyOverrides(profile: ProfileData, values: Overrides): ProfileData {
  const overrides = overridesSchema.parse(values); const copy = { ...profile };
  if (overrides.layerHeight !== undefined) copy.layer_height = String(overrides.layerHeight);
  if (overrides.wallCount !== undefined) copy.wall_loops = String(overrides.wallCount);
  if (overrides.infillPercent !== undefined) copy.sparse_infill_density = `${overrides.infillPercent}%`;
  if (overrides.infillPattern !== undefined) copy.sparse_infill_pattern = overrides.infillPattern;
  if (overrides.supportType !== undefined) copy.support_type = overrides.supportType;
  if (overrides.supportOnBuildPlateOnly !== undefined) copy.support_on_build_plate_only = overrides.supportOnBuildPlateOnly ? '1' : '0';
  if (overrides.supports !== undefined) copy.enable_support = overrides.supports ? '1' : '0';
  if (overrides.brim !== undefined) { copy.brim_type = overrides.brim ? 'outer_only' : 'no_brim'; if (overrides.brim) copy.brim_width = '5'; }
  return copy;
}
export async function materializeProfiles(registry: PresetRegistry, options: SliceOptions, workDir: string) {
  const profiles = registry.resolve(options);
  if (options.overrides.layerHeight !== undefined) {
    const lower = Number((profiles.machine.flat!.min_layer_height as string[] | undefined)?.[0] ?? 0.06);
    const upper = Number((profiles.machine.flat!.max_layer_height as string[] | undefined)?.[0] ?? 0.4);
    if (options.overrides.layerHeight < lower || options.overrides.layerHeight > upper) throw new Error(`Layer height must be between ${lower} and ${upper} mm for the selected nozzle`);
  }
  const paths = { machineProfile: path.join(workDir, 'machine.json'), processProfile: path.join(workDir, 'process.json'), filamentProfile: path.join(workDir, 'filament.json') };
  // Orca CLI does not resolve preset inheritance. Fully flattened copies preserve bundled settings.
  const machine = { ...profiles.machine.flat!, printer_settings_id: profiles.machine.name };
  const process = applyOverrides({ ...profiles.process.flat!, print_settings_id: profiles.process.name }, options.overrides);
  const filament = { ...profiles.filament.flat!, filament_settings_id: [profiles.filament.name] };
  await Promise.all([fs.writeFile(paths.machineProfile, JSON.stringify(machine)), fs.writeFile(paths.processProfile, JSON.stringify(process)), fs.writeFile(paths.filamentProfile, JSON.stringify(filament))]);
  return paths;
}
