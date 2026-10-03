import { describe,it,expect } from 'vitest';
import { PresetRegistry,flattenProfile,buildVolume } from '../src/presets/discovery.js';
import { registry,record,machineName,processName,filamentName } from './fixtures.js';
describe('bundled preset registry',()=>{
 it('filters printers and process/material compatibility and follows machine defaults',()=>{
  const r=registry(); expect(r.catalog.machines).toHaveLength(1);expect(r.catalog.processes.map(p=>p.name)).toEqual([processName]);expect(r.catalog.filaments.map(p=>p.name)).toEqual([filamentName]);
  expect(r.catalog.machines[0]!.buildVolume).toEqual({width:220,depth:220,height:245});
  const profiles=r.resolve(r.catalog.defaults!);expect(profiles.machine.name).toBe(machineName);expect(profiles.process.flat!.wall_loops).toBe('2');expect(profiles.machine.flat!.inherits).toBeUndefined();
 });
 it('does not expose a nozzle variant without a compatible bundled filament',()=>{
  const base=registry();const variant=record('machine','Creality Ender-3 V3 KE 0.6 nozzle',{inherits:'base',nozzle_diameter:['0.6']});
  const added=record('process','0.24mm Draft variant',{compatible_printers:[variant.name]});
  const r=new PresetRegistry([...base.records.values(),variant,added]);
  expect(r.catalog.machines.map(m=>m.name)).toEqual([machineName]);expect(r.catalog.processes.map(p=>p.name)).not.toContain(added.name);
  for(const p of [...r.catalog.processes,...r.catalog.filaments])expect(p.compatibleMachineIds).toEqual([r.catalog.machines[0]!.id]);
 });
 it('rejects client filesystem paths and wrong profile types',()=>{
  const r=registry();expect(()=>r.resolve({...r.catalog.defaults!,machineId:'/etc/passwd'})).toThrow('Unknown printer');
  expect(()=>r.resolve({...r.catalog.defaults!,processId:r.catalog.defaults!.machineId})).toThrow('incompatible');
 });
 it('detects missing parents and circular profile inheritance',()=>{
  const a=record('machine','A',{inherits:'B'});const b=record('machine','B',{inherits:'A'});
  expect(()=>flattenProfile(a,new Map([['machine:A',a],['machine:B',b]]))).toThrow('Circular');
  expect(()=>flattenProfile(a,new Map())).toThrow('Missing');
 });
 it('rejects invalid build volume',()=>{expect(()=>buildVolume({printable_area:['wat','nope'],printable_height:'245'})).toThrow();});
});
