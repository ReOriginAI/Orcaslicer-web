import { describe,it,expect } from 'vitest';
import { sliceOptionsSchema } from '@orca-web/shared';
import { buildSliceCommand } from '../src/orca/command.js';
import { registry } from './fixtures.js';
const options=sliceOptionsSchema.parse(registry().catalog.defaults);
const input={datadir:'/data/job/work/orca',machineProfile:'/data/job/work/machine.json',processProfile:'/data/job/work/process.json',filamentProfile:'/data/job/work/filament.json',outputDir:'/data/job/output',inputFile:'/data/job/input/hello;$(touch hacked).stl',options};
describe('verified v2.4.2 command',()=>{
 it('keeps paths as individual args and uses server-owned profiles',()=>{
  const args=buildSliceCommand(input);
  expect(args).toContain('/data/job/work/machine.json;/data/job/work/process.json');
  expect(args.slice(-2)).toEqual(['--',input.inputFile]);
  expect(args).toContain('--slice');expect(args).toContain('--ensure-on-bed');
 });
 it('never uses crashing geometry flags; generated 3MF carries transforms',()=>{
  const args=buildSliceCommand({...input,options:{...options,transform:{...options.transform,rotation:{x:15,y:25,z:35},scale:1.5}}});
  expect(args.some(a=>a.startsWith('--rotate')||a === '--scale')).toBe(false);
 });
 it('represents auto orient, arrange and ensure-on-bed choices',()=>{
  const args=buildSliceCommand({...input,options:{...options,transform:{...options.transform,autoOrient:true,autoArrange:false,ensureOnBed:false}}});
  expect(args.slice(args.indexOf('--orient'),args.indexOf('--orient')+4)).toEqual(['--orient','1','--arrange','0']);
  expect(args).not.toContain('--ensure-on-bed');
 });
 it('rejects untrusted additional CLI options',()=>{
  expect(()=>buildSliceCommand({...input,options:{...options,args:['--load-settings','/etc/passwd']} as never})).toThrow();
 });
});
