export const processSettingKeys = {
  layerHeight: 'layer_height', firstLayerHeight: 'initial_layer_print_height', wallCount: 'wall_loops',
  topShellLayers: 'top_shell_layers', bottomShellLayers: 'bottom_shell_layers',
  firstLayerSpeed: 'initial_layer_speed', outerWallSpeed: 'outer_wall_speed', innerWallSpeed: 'inner_wall_speed',
  infillSpeed: 'sparse_infill_speed', travelSpeed: 'travel_speed', acceleration: 'default_acceleration',
} as const;
export const machineSettingKeys = {
  retractionLength: 'retraction_length', retractionSpeed: 'retraction_speed', zHop: 'z_hop',
} as const;
export const filamentSettingKeys = {
  nozzleTemperature: 'nozzle_temperature', firstLayerNozzleTemperature: 'nozzle_temperature_initial_layer',
  flowRatio: 'filament_flow_ratio', coolingOffLayers: 'close_fan_the_first_x_layers',
} as const;
export const bedTemperatureKeys = ['cool_plate_temp', 'eng_plate_temp', 'hot_plate_temp', 'textured_plate_temp'] as const;
export const seasonalAmbientPresets = [
  { id: 'winter', name: 'Winter · cool room', temperature: 15 },
  { id: 'spring', name: 'Spring · mild room', temperature: 22 },
  { id: 'summer', name: 'Summer · warm room', temperature: 30 },
  { id: 'autumn', name: 'Autumn · cool room', temperature: 20 },
] as const;
export function ambientOffsets(temperature: number) {
  // An optional starting-point heuristic around a 22°C room, never a thermal-control model.
  const bound = (value: number) => Math.max(-5, Math.min(5, Math.round(value)));
  return { nozzle: bound((22 - temperature) * 0.3), bed: bound((22 - temperature) * 0.5) };
}
