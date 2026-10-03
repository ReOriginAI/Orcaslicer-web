import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {sliceOptionsSchema,type Job} from '@orca-web/shared';
import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import {createApp} from '../src/app.js';
import {config,registry} from './fixtures.js';
let dir:string;let application:Awaited<ReturnType<typeof createApp>>;
function multipart(options:unknown,filename='cube.stl',body='solid cube\nendsolid cube\n') {
 const boundary='orca-unit-boundary';return {headers:{'content-type':`multipart/form-data; boundary=${boundary}`},payload:Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="options"\r\n\r\n${JSON.stringify(options)}\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n${body}\r\n--${boundary}--\r\n`)};
}
beforeEach(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'orca-api-'));application=await createApp(config(dir),{registry:registry(),version:'2.4.2'});await application.app.ready();});
afterEach(async()=>{await application.app.close();await fs.rm(dir,{recursive:true,force:true});});
describe('API boundaries',()=>{
 it('rejects arbitrary preset paths and removes incomplete uploads',async()=>{
  const response=await application.app.inject({method:'POST',url:'/api/jobs',...multipart({...registry().catalog.defaults,machineId:'/etc/passwd'})});
  expect(response.statusCode).toBe(400);expect(response.json().error).toMatch(/Unknown printer/);expect(await fs.readdir(path.join(dir,'jobs'))).toEqual([]);
 });
 it('rejects unknown CLI arguments and unverified upload formats',async()=>{
  let response=await application.app.inject({method:'POST',url:'/api/jobs',...multipart({...registry().catalog.defaults,args:['--outputdir','/etc']})});expect(response.statusCode).toBe(400);
  response=await application.app.inject({method:'POST',url:'/api/jobs',...multipart(registry().catalog.defaults,'project.3mf')});expect(response.statusCode).toBe(415);
 });
 it('enforces streamed upload limit',async()=>{
  const response=await application.app.inject({method:'POST',url:'/api/jobs',...multipart(registry().catalog.defaults,'cube.stl','a'.repeat(1024*1024+10))});expect(response.statusCode).toBe(413);
 });
 it('validates job IDs and never downloads arbitrary output paths',async()=>{
  expect((await application.app.inject({method:'GET',url:'/api/jobs/not-a-uuid'})).statusCode).toBe(400);
  expect((await application.app.inject({method:'GET',url:`/api/jobs/${randomUUID()}/files/..%2Fsecret`})).statusCode).toBe(404);
 });
 it('closes open SSE streams when server shuts down',async()=>{
  const now=new Date().toISOString();const job:Job={id:randomUUID(),status:'queued',filename:'fixture.stl',options:sliceOptionsSchema.parse(registry().catalog.defaults),presets:{machine:'machine',process:'process',filament:'filament'},createdAt:now,updatedAt:now};application.store.create(job);
  const address=await application.app.listen({host:'127.0.0.1',port:0});const response=await fetch(`${address}/api/jobs/${job.id}/events`);const reader=response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: snapshot');
  const timeout=setTimeout(()=>{void reader.cancel();},2000);
  try{await application.app.close();expect((await reader.read()).done).toBe(true);}finally{clearTimeout(timeout);await reader.cancel();}
 });
 it('returns real installed presets and reports exact version',async()=>{
  const about=(await application.app.inject({method:'GET',url:'/api/about'})).json();expect(about.orcaVersion).toBe('2.4.2');expect(about.supportedFormats).toEqual(['stl']);
  const presets=(await application.app.inject({method:'GET',url:'/api/presets'})).json();expect(presets.defaults.machineId).toBe(registry().catalog.defaults!.machineId);
 });
});
