export interface BuildVolume { width: number; depth: number; height: number }
export interface Preset { id: string; name: string; compatibleMachineIds: string[]; settingValues?: Record<string, string> }
export interface MachinePreset extends Preset { buildVolume: BuildVolume; nozzleDiameter: number;
  defaults?: PresetSelection;
  limits?: { minLayerHeight: number; maxLayerHeight: number; maxNozzleTemperature: number; maxBedTemperature: number; maxAcceleration: number; maxSpeed: number };
}
export interface PresetSelection { machineId: string; processId: string; filamentId: string }
export interface PresetCatalog {
  machines: MachinePreset[]; processes: Preset[]; filaments: Preset[];
  defaults: PresetSelection | null;
}
