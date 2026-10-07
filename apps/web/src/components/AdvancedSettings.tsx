import { processSettingKeys, machineSettingKeys, filamentSettingKeys, type MachinePreset, type Overrides, type Preset } from '@orca-web/shared';

type NumericKey = Exclude<{ [K in keyof Overrides]: NonNullable<Overrides[K]> extends number ? K : never }[keyof Overrides], undefined>;
type Field = { key: NumericKey; label: string; min: number; max: number; step?: number; unit?: string; orcaKey?: string };
const groups: { name: string; note?: string; fields: Field[] }[] = [
  { name: 'Quality & strength', fields: [
    { key: 'layerHeight', label: 'Layer height', min: 0.04, max: 0.8, step: 0.01, unit: 'mm' },
    { key: 'firstLayerHeight', label: 'First layer height', min: 0.04, max: 0.8, step: 0.01, unit: 'mm' },
    { key: 'wallCount', label: 'Wall count', min: 1, max: 20 },
    { key: 'topShellLayers', label: 'Top shell layers', min: 0, max: 20 },
    { key: 'bottomShellLayers', label: 'Bottom shell layers', min: 0, max: 20 },
  ] },
  { name: 'Speed & motion', note: 'Speeds and acceleration are bounded by the selected machine profile.', fields: [
    { key: 'firstLayerSpeed', label: 'First layer speed', min: 1, max: 100, unit: 'mm/s' },
    { key: 'outerWallSpeed', label: 'Outer wall speed', min: 1, max: 300, unit: 'mm/s' },
    { key: 'innerWallSpeed', label: 'Inner wall speed', min: 1, max: 500, unit: 'mm/s' },
    { key: 'infillSpeed', label: 'Infill speed', min: 1, max: 500, unit: 'mm/s' },
    { key: 'travelSpeed', label: 'Travel speed', min: 1, max: 500, unit: 'mm/s' },
    { key: 'acceleration', label: 'Acceleration', min: 100, max: 10000, unit: 'mm/s²' },
  ] },
  { name: 'Temperature & extrusion', note: 'Nozzle temperatures stay within both the filament range and stock machine limits. Bed overrides apply to all plate types.', fields: [
    { key: 'firstLayerNozzleTemperature', label: 'First layer nozzle', min: 150, max: 300, unit: '°C' },
    { key: 'nozzleTemperature', label: 'Other layers nozzle', min: 150, max: 300, unit: '°C' },
    { key: 'firstLayerBedTemperature', label: 'First layer bed', min: 0, max: 110, unit: '°C', orcaKey: 'hot_plate_temp_initial_layer' },
    { key: 'bedTemperature', label: 'Other layers bed', min: 0, max: 110, unit: '°C', orcaKey: 'hot_plate_temp' },
    { key: 'flowRatio', label: 'Flow ratio', min: 0.8, max: 1.2, step: 0.01 },
  ] },
  { name: 'Retraction & cooling', note: 'Retraction uses the selected printer and filament defaults. Fan speed sets the regular cooling range; bridge cooling keeps its preset.', fields: [
    { key: 'retractionLength', label: 'Retraction length', min: 0, max: 10, step: 0.1, unit: 'mm' },
    { key: 'retractionSpeed', label: 'Retraction speed', min: 1, max: 80, unit: 'mm/s' },
    { key: 'zHop', label: 'Z hop', min: 0, max: 2, step: 0.1, unit: 'mm' },
    { key: 'fanSpeed', label: 'Part cooling fan', min: 0, max: 100, unit: '%', orcaKey: 'fan_max_speed' },
    { key: 'coolingOffLayers', label: 'Fan off for layers', min: 0, max: 20 },
  ] },
];

export function AdvancedSettings({ enabled, onEnabled, values, onChange, machine, process, filament, disabled }: {
  enabled: boolean; onEnabled: (value: boolean) => void; values: Overrides;
  onChange: (values: Overrides) => void; machine?: MachinePreset; process?: Preset; filament?: Preset; disabled: boolean;
}) {
  const keys: Record<string, string> = { ...processSettingKeys, ...machineSettingKeys, ...filamentSettingKeys };
  const limits = machine?.limits;
  return <section className="advanced-settings" aria-label="Advanced tuning">
    <label className="check-field override-toggle">
      <input type="checkbox" checked={enabled} disabled={disabled} onChange={e => onEnabled(e.target.checked)} />
      Custom print settings
    </label>
    <p className="settings-help">Enable tuning to override the selected presets. Blank fields use the preset shown below them. Turning tuning off retains your entries without applying them.</p>
    <fieldset disabled={disabled || !enabled}>
      <legend className="visually-hidden">Print overrides</legend>
      {groups.map(group => <section className="tuning-group" key={group.name}>
        <h3>{group.name}</h3>
        {group.note && <p className="settings-help">{group.note}</p>}
        <div className="override-grid">{group.fields.map(field => {
          let min = field.min, max = field.max;
          if (limits) {
            if (field.key === 'layerHeight' || field.key === 'firstLayerHeight') { min = Math.max(min, limits.minLayerHeight); max = Math.min(max, limits.maxLayerHeight); }
            if (field.key === 'acceleration') max = Math.min(max, limits.maxAcceleration);
            if (['firstLayerSpeed', 'outerWallSpeed', 'innerWallSpeed', 'infillSpeed', 'travelSpeed'].includes(field.key)) max = Math.min(max, limits.maxSpeed);
            if (field.key === 'nozzleTemperature' || field.key === 'firstLayerNozzleTemperature') {
              min = Math.max(min, Number(filament?.settingValues?.nozzle_temperature_range_low ?? min));
              max = Math.min(max, limits.maxNozzleTemperature, Number(filament?.settingValues?.nozzle_temperature_range_high ?? max));
            }
            if (field.key === 'bedTemperature' || field.key === 'firstLayerBedTemperature') max = Math.min(max, limits.maxBedTemperature);
          }
          const value = values[field.key];
          const invalid = enabled && value !== undefined && (!Number.isFinite(value) || value < min || value > max || (field.step === undefined && !Number.isInteger(value)));
          const source = field.key in processSettingKeys ? process : field.key in machineSettingKeys ? machine : filament;
          const orcaKey = field.orcaKey ?? keys[field.key] ?? '';
          const preset = field.key in machineSettingKeys
            ? filament?.settingValues?.[`filament_${orcaKey}`] ?? source?.settingValues?.[orcaKey]
            : source?.settingValues?.[orcaKey];
          return <label className="field" key={field.key}>
            {field.label}
            <div className="unit-input">
              <input type="number" aria-label={field.label} min={min} max={max} step={field.step ?? 1}
                placeholder="Use preset" value={value ?? ''} aria-invalid={invalid}
                onChange={e => onChange({ ...values, [field.key]: e.target.value === '' ? undefined : Number(e.target.value) })} />
              <span>{field.unit}</span>
            </div>
            <small className={invalid ? 'field-error' : 'field-hint'}>{invalid ? `Enter ${min}–${max}${field.unit ? ` ${field.unit}` : ''}.` : `Preset: ${preset ?? 'Orca default'}`}</small>
          </label>;
        })}</div>
      </section>)}
      <label className="field">Brim
        <select aria-label="Brim" value={values.brim === undefined ? 'preset' : String(values.brim)} onChange={e => onChange({ ...values, brim: e.target.value === 'preset' ? undefined : e.target.value === 'true' })}>
          <option value="preset">Use preset</option><option value="true">Enabled · 5 mm</option><option value="false">Disabled</option>
        </select>
      </label>
    </fieldset>
  </section>;
}
