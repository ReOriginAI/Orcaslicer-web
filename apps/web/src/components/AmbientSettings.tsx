import { ambientOffsets, seasonalAmbientPresets, type MachinePreset, type Overrides, type Preset } from '@orca-web/shared';

export function AmbientSettings({ values, onChange, filament, machine, disabled }: {
  values: Overrides; onChange: (values: Overrides) => void; filament?: Preset; machine?: MachinePreset; disabled: boolean;
}) {
  const temperature = values.ambientTemperatureC;
  const valid = temperature !== undefined && Number.isFinite(temperature) && temperature >= 10 && temperature <= 40;
  const offsets = ambientOffsets(valid ? temperature : 22);
  const settings = filament?.settingValues;
  const firstNozzle = values.firstLayerNozzleTemperature ?? Number(settings?.nozzle_temperature_initial_layer);
  const firstBed = values.firstLayerBedTemperature ?? Number(settings?.hot_plate_temp_initial_layer);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const nozzle = clamp(firstNozzle + offsets.nozzle, Number(settings?.nozzle_temperature_range_low ?? 150), Math.min(machine?.limits?.maxNozzleTemperature ?? 300, Number(settings?.nozzle_temperature_range_high ?? 300)));
  const bed = firstBed === 0 ? 0 : clamp(firstBed + offsets.bed, 0, machine?.limits?.maxBedTemperature ?? 100);
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`;
  return <section className="ambient-settings" aria-labelledby="ambient-title">
    <div className="section-title"><h3 id="ambient-title">Room &amp; season</h3><span className="eyebrow">Optional</span></div>
    <fieldset disabled={disabled}>
      <legend className="visually-hidden">Ambient temperature adjustment</legend>
      <label className="field">Season shortcut
        <select aria-label="Season shortcut" value={temperature === undefined ? 'off' : seasonalAmbientPresets.find(p => p.temperature === temperature)?.id ?? 'custom'} onChange={e => {
          const preset = seasonalAmbientPresets.find(p => p.id === e.target.value);
          onChange({ ...values, ambientTemperatureC: e.target.value === 'off' ? undefined : preset?.temperature ?? temperature ?? 22 });
        }}>
          <option value="off">Off · keep preset temperatures</option>
          {seasonalAmbientPresets.map(p => <option key={p.id} value={p.id}>{p.name} · {p.temperature}°C</option>)}
          <option value="custom">Custom room temperature</option>
        </select>
      </label>
      <label className="field">Ambient temperature
        <div className="unit-input"><input aria-label="Ambient temperature" type="number" min="10" max="40" step="0.5" placeholder="Off" value={temperature ?? ''} aria-invalid={temperature !== undefined && !valid}
          onChange={e => onChange({ ...values, ambientTemperatureC: e.target.value === '' ? undefined : Number(e.target.value) })} /><span>°C</span></div>
      </label>
      <p className="settings-help">Use the measured air temperature near the printer, not the outdoor forecast. Seasonal values are editable starting points.</p>
      {temperature !== undefined && !valid && <p className="field-error" role="alert">Enter an ambient temperature from 10 to 40°C.</p>}
      {valid && <div className="ambient-preview" role="status">
        <strong>First layer adjustment</strong>
        <span>Nozzle {signed(offsets.nozzle)}°C · Bed {signed(offsets.bed)}°C before limits</span>
        {Number.isFinite(nozzle) && <span>Result: nozzle {nozzle}°C{Number.isFinite(bed) ? ` · hot plate ${bed}°C` : ''}</span>}
        <span>Applied after manual temperatures, capped by filament and machine limits. An unheated bed stays off. Later layers keep their selected temperatures.</span>
      </div>}
      {valid && (temperature < 15 || temperature > 32) && <p className="notice warning">{temperature < 15 ? 'Cold room: stabilize the room and avoid drafts to reduce warping.' : 'Hot room: improve room ventilation and watch for heat creep and soft first layers.'} Small temperature offsets cannot compensate for extreme conditions.</p>}
      <p className="settings-help">This ±5°C first-layer heuristic is a tuning aid, not automatic climate control. Start with a small test print.</p>
    </fieldset>
  </section>;
}
