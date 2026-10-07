import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { processSettingKeys, machineSettingKeys, filamentSettingKeys, bedTemperatureKeys } from '@orca-web/shared';
import type { BuildVolume, MachinePreset, Preset, PresetCatalog, PresetSelection } from '@orca-web/shared';
export type ProfileKind = 'machine' | 'process' | 'filament';
export type ProfileData = Record<string, unknown>;
export interface ProfileRecord { id: string; kind: ProfileKind; name: string; path: string; data: ProfileData; flat?: ProfileData }
const kinds = new Set(['machine', 'process', 'filament']);
const displayedSettings = new Set([
  ...Object.values(processSettingKeys), ...Object.values(machineSettingKeys), ...Object.values(filamentSettingKeys),
  ...Object.values(machineSettingKeys).map(key => `filament_${key}`),
  ...bedTemperatureKeys, ...bedTemperatureKeys.map(key => `${key}_initial_layer`),
  'nozzle_temperature_range_low', 'nozzle_temperature_range_high', 'fan_max_speed',
]);
export const profileId = (kind: ProfileKind, name: string) => `${kind}-${createHash('sha256').update(name).digest('hex').slice(0, 20)}`;
export function buildVolume(data: ProfileData): BuildVolume {
  const area = data.printable_area;
  if (!Array.isArray(area) || area.length < 3) throw new Error('Missing printable area in bundled machine profile');
  const points = area.map(p => String(p).split('x').map(Number));
  if (points.some(p => p.length !== 2 || p.some(n => !Number.isFinite(n)))) throw new Error('Invalid printable area');
  const xs = points.map(p => p[0]!); const ys = points.map(p => p[1]!);
  const volume = { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys), height: Number(data.printable_height) };
  if (Object.values(volume).some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Invalid build volume');
  return volume;
}
export function flattenProfile(record: ProfileRecord, byName: Map<string, ProfileRecord>, stack = new Set<string>()): ProfileData {
  if (record.flat) return record.flat;
  const key = `${record.kind}:${record.name}`;
  if (stack.has(key)) throw new Error(`Circular Orca profile inheritance: ${record.name}`);
  stack.add(key);
  let inherited: ProfileData = {};
  if (typeof record.data.inherits === 'string' && record.data.inherits) {
    const parent = byName.get(`${record.kind}:${record.data.inherits}`);
    if (!parent) throw new Error(`Missing bundled parent profile: ${record.data.inherits}`);
    inherited = flattenProfile(parent, byName, stack);
  }
  const data = { ...inherited, ...record.data };
  delete data.inherits;
  stack.delete(key);
  record.flat = data;
  return data;
}
export function compatibleWith(data: ProfileData, machineName: string): boolean {
  // v1 exposes explicit, bundled compatibility lists. Orca condition expressions are not evaluated in Node.
  return Array.isArray(data.compatible_printers) && data.compatible_printers.includes(machineName);
}
export class PresetRegistry {
  readonly catalog: PresetCatalog;
  readonly records: Map<string, ProfileRecord>;
  constructor(records: ProfileRecord[]) {
    this.records = new Map(records.map(r => [r.id, r]));
    const byName = new Map(records.map(r => [`${r.kind}:${r.name}`, r]));
    const number = (data: ProfileData, key: string, fallback: number) => {
      const raw = Array.isArray(data[key]) ? data[key][0] : data[key];
      const value = Number(raw);
      return raw !== undefined && Number.isFinite(value) ? value : fallback;
    };
    const settingValues = (data: ProfileData): Record<string, string> => Object.fromEntries(
      Object.entries(data).flatMap(([key, raw]) => {
        const value = Array.isArray(raw) ? raw[0] : raw;
        return displayedSettings.has(key) && typeof value === 'string' && /^-?\d+(?:\.\d+)?%?$/.test(value) ? [[key, value]] : [];
      }),
    );
    const machines: MachinePreset[] = records.filter(r => r.kind === 'machine' && /^Creality Ender-3 (?:V3 KE|Pro) \d+(?:\.\d+)? nozzle$/.test(r.name) && r.data.instantiation === 'true')
      .map(r => {
        const d = flattenProfile(r, byName);
        const pro = r.name.startsWith('Creality Ender-3 Pro ');
        return {
          id: r.id, name: r.name, compatibleMachineIds: [r.id], buildVolume: buildVolume(d),
          nozzleDiameter: number(d, 'nozzle_diameter', 0.4), settingValues: settingValues(d),
          limits: {
            minLayerHeight: number(d, 'min_layer_height', 0.06), maxLayerHeight: number(d, 'max_layer_height', 0.32),
            maxNozzleTemperature: pro ? 250 : 300, maxBedTemperature: pro ? 110 : 100,
            maxAcceleration: Math.min(number(d, 'machine_max_acceleration_x', 500), number(d, 'machine_max_acceleration_y', 500), number(d, 'machine_max_acceleration_extruding', 500)),
            maxSpeed: Math.min(number(d, 'machine_max_speed_x', 500), number(d, 'machine_max_speed_y', 500)),
          },
        };
      });
    const entries = (kind: ProfileKind): Preset[] => records.filter(r => r.kind === kind && r.data.instantiation === 'true')
      .flatMap(r => {
        const flat = flattenProfile(r, byName);
        const compatibleMachineIds = machines.filter(m => compatibleWith(flat, m.name)).map(m => m.id);
        return compatibleMachineIds.length ? [{ id: r.id, name: r.name, compatibleMachineIds, settingValues: settingValues(flat) }] : [];
      });
    const processes = entries('process'); const filaments = entries('filament');
    const availableMachines = machines.filter(m => processes.some(p => p.compatibleMachineIds.includes(m.id)) && filaments.some(p => p.compatibleMachineIds.includes(m.id)));
    const availableIds = new Set(availableMachines.map(m => m.id));
    for (const entry of [...processes, ...filaments]) entry.compatibleMachineIds = entry.compatibleMachineIds.filter(id => availableIds.has(id));
    for (const machine of availableMachines) {
      const data = this.records.get(machine.id)!.flat!;
      const compatibleProcesses = processes.filter(p => p.compatibleMachineIds.includes(machine.id));
      const compatibleFilaments = filaments.filter(p => p.compatibleMachineIds.includes(machine.id));
      const process = compatibleProcesses.find(p => p.name === data.default_print_profile) ?? compatibleProcesses[0]!;
      const filament = compatibleFilaments.find(p => Array.isArray(data.default_filament_profile) && data.default_filament_profile.includes(p.name)) ?? compatibleFilaments[0]!;
      machine.defaults = { machineId: machine.id, processId: process.id, filamentId: filament.id };
    }
    const defaultMachine = availableMachines.find(m => m.name === 'Creality Ender-3 V3 KE 0.4 nozzle');
    this.catalog = {
      machines: availableMachines.sort((a, b) => Number(b.id === defaultMachine?.id) - Number(a.id === defaultMachine?.id) || a.name.localeCompare(b.name)),
      processes: processes.filter(p => p.compatibleMachineIds.length).sort((a, b) => a.name.localeCompare(b.name)),
      filaments: filaments.filter(p => p.compatibleMachineIds.length).sort((a, b) => a.name.localeCompare(b.name)),
      defaults: defaultMachine?.defaults ?? null,
    };
  }
  resolve(selection: PresetSelection): { machine: ProfileRecord; process: ProfileRecord; filament: ProfileRecord } {
    const machine = this.records.get(selection.machineId); const process = this.records.get(selection.processId); const filament = this.records.get(selection.filamentId);
    if (!machine || !this.catalog.machines.some(m=>m.id === machine.id)) throw new Error('Unknown printer preset');
    for (const [record, options, label] of [[process, this.catalog.processes, 'process'], [filament, this.catalog.filaments, 'filament']] as const) {
      if (!record || !options.some(p => p.id === record.id && p.compatibleMachineIds.includes(machine.id))) throw new Error(`Unknown or incompatible ${label} preset`);
    }
    return { machine, process: process!, filament: filament! };
  }
}
export async function discoverProfiles(resourceDir: string): Promise<PresetRegistry> {
  const records: ProfileRecord[] = [];
  // The complete Creality vendor tree holds KE and Pro presets and their inherited base profiles.
  const profileRoot = path.join(resourceDir, 'profiles', 'Creality');
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        const data = JSON.parse(await fs.readFile(filename, 'utf8')) as ProfileData;
        if (kinds.has(String(data.type)) && typeof data.name === 'string') {
          const kind = data.type as ProfileKind; records.push({ id: profileId(kind, data.name), kind, name: data.name, path: filename, data });
        }
      }
    }
  }
  await visit(profileRoot);
  const registry = new PresetRegistry(records);
  if (!registry.catalog.defaults) throw new Error('Required stock Ender-3 V3 KE / 0.4 mm presets were not found in this Orca installation');
  return registry;
}
