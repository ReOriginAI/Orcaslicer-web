import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {sliceOptionsSchema,type Job} from '@orca-web/shared';
import {JobStore} from '../src/storage/jobs.js';
import {assertTransition} from '../src/jobs/state.js';
import {registry} from './fixtures.js';
const job=():Job=>({id:randomUUID(),status:'queued',filename:'cube.stl',options:sliceOptionsSchema.parse(registry().catalog.defaults),presets:{machine:'machine',process:'process',filament:'filament'},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
describe('durable job state',()=>{
 it('enforces state transitions',()=>{expect(()=>assertTransition('queued','succeeded')).toThrow();expect(()=>assertTransition('succeeded','running')).toThrow();expect(()=>assertTransition('queued','canceled')).not.toThrow();});
 it('preserves completed jobs and fails interrupted jobs after restart',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'orca-store-'));
  try{let store=new JobStore(dir);const done=job(),interrupted=job(),queued=job();store.create(done);store.create(interrupted);store.create(queued);store.transition(done.id,'running');store.transition(done.id,'validating');store.transition(done.id,'succeeded');store.transition(interrupted.id,'running');store.close();store=new JobStore(dir);expect(store.get(done.id)!.status).toBe('succeeded');expect(store.get(interrupted.id)!.status).toBe('failed');expect(store.queued().map(j=>j.id)).toEqual([queued.id]);store.close();}finally{await fs.rm(dir,{recursive:true,force:true});}
 });
});
