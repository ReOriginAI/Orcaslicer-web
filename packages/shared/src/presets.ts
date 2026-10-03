export interface BuildVolume { width: number; depth: number; height: number }
export interface Preset { id: string; name: string; compatibleMachineIds: string[] }
export interface MachinePreset extends Preset { buildVolume: BuildVolume; nozzleDiameter: number }
export interface PresetSelection { machineId: string; processId: string; filamentId: string }
export interface PresetCatalog {
  machines: MachinePreset[]; processes: Preset[]; filaments: Preset[];
  defaults: PresetSelection | null;
}
