import { describe,it,expect } from 'vitest';
import { overridesSchema } from '@orca-web/shared';
import { displayFilename,safeFilePath,jobPaths } from '../src/storage/paths.js';
import { applyOverrides } from '../src/orca/profiles.js';
describe('filesystem boundaries',()=>{
 it('normalizes user-facing filename without allowing original paths',()=>{
  expect(displayFilename('../../model.stl')).toBe('model.stl');expect(displayFilename('C:\\secret\\cube.stl')).toBe('cube.stl');expect(displayFilename('\u0000cube\nstl.stl')).toBe('cubestl.stl');
 });
 it.each(['../secret','..','/etc/passwd','a\\b','x\u0000.gcode'])('rejects traversal %s',name=>{expect(()=>safeFilePath('/data/jobs/owned/output',name)).toThrow();});
 it('requires server-generated UUID job directories',()=>{expect(()=>jobPaths('/data','../../etc')).toThrow();});
});
describe('allowlisted overrides',()=>{
 it('writes verified string configuration keys to a copy',()=>{
  const original={wall_loops:'2',inherits:'parent'};
  expect(applyOverrides(original,{layerHeight:0.16,wallCount:3,infillPercent:25,supports:true,brim:true,infillPattern:'gyroid',supportType:'tree(auto)',supportOnBuildPlateOnly:true})).toMatchObject({layer_height:'0.16',wall_loops:'3',sparse_infill_density:'25%',enable_support:'1',brim_type:'outer_only',brim_width:'5',sparse_infill_pattern:'gyroid',support_type:'tree(auto)',support_on_build_plate_only:'1'});
  expect(original.wall_loops).toBe('2');
 });
 it('preserves preset values when options are unset and supports explicit zero/off values',()=>{
  const original={sparse_infill_density:'15%',enable_support:'1',support_on_build_plate_only:'1'};
  expect(applyOverrides(original,{})).toEqual(original);
  expect(applyOverrides(original,{infillPercent:0,supports:false,supportOnBuildPlateOnly:false})).toMatchObject({sparse_infill_density:'0%',enable_support:'0',support_on_build_plate_only:'0'});
 });
 it('rejects unknown config keys and out-of-range values',()=>{
  expect(overridesSchema.safeParse({machine_start_gcode:'RUN_SHELL_COMMAND'}).success).toBe(false);expect(overridesSchema.safeParse({infillPercent:101}).success).toBe(false);expect(overridesSchema.safeParse({wallCount:1.5}).success).toBe(false);
 });
});
