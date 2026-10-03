import fs from 'node:fs/promises';
import type { Job, JobEventName } from '@orca-web/shared';
import type { Config } from '../config.js';
import type { PresetRegistry } from '../presets/discovery.js';
import path from 'node:path';
import { prepareTransformedStl } from '../orca/stl-project.js';
import { buildSliceCommand } from '../orca/command.js';
import { materializeProfiles } from '../orca/profiles.js';
import { sliceModel } from '../orca/runner.js';
import { validateOutput } from '../orca/result.js';
import { JobStore } from '../storage/jobs.js';
import { jobPaths } from '../storage/paths.js';
import { JobEvents } from './events.js';
export class SliceQueue {
  private pending: string[] = []; private active = new Map<string, AbortController>(); private closed = false;
  readonly events = new JobEvents();
  constructor(readonly store: JobStore, private config: Config, private registry: PresetRegistry | null, private version: string | null) {
    this.pending = store.queued().map(j=>j.id); queueMicrotask(()=>this.drain());
  }
  enqueue(job: Job) { this.pending.push(job.id); this.events.emit(job.id,'queued',{job}); queueMicrotask(()=>this.drain()); }
  cancel(id: string): Job {
    const job = this.store.get(id); if (!job) throw new Error('Job not found');
    if (!['queued','running','validating'].includes(job.status)) return job;
    this.pending = this.pending.filter(j=>j !== id); this.active.get(id)?.abort();
    const canceled = this.store.transition(id,'canceled'); this.events.emit(id,'canceled',{job:canceled}); return canceled;
  }
  private update(id: string, status: Job['status'], event: JobEventName, fields: Partial<Pick<Job,'error'|'result'>> = {}) {
    if (this.store.get(id)?.status === 'canceled') return;
    const job = this.store.transition(id,status,fields); this.events.emit(id,event,{job});
  }
  private drain() {
    while (!this.closed && this.pending.length && this.active.size < this.config.maxConcurrentSlices) {
      const id = this.pending.shift()!;
      if (this.store.get(id)?.status !== 'queued') continue;
      const controller = new AbortController(); this.active.set(id,controller);
      void this.run(id,controller).finally(()=>{ this.active.delete(id); this.drain(); });
    }
  }
  private async run(id: string, controller: AbortController) {
    const paths = jobPaths(this.config.dataDir,id); const start = performance.now();
    let timedOut=false;
    const deadline=setTimeout(()=>{timedOut=true;controller.abort();},this.config.slicerTimeoutSeconds*1000);deadline.unref();
    try {
      if (!this.registry || !this.version) throw new Error('OrcaSlicer is unavailable. Check server setup.');
      const job = this.store.get(id)!; this.update(id,'running','started');
      await fs.mkdir(paths.datadir,{recursive:true});
      const profiles = await materializeProfiles(this.registry,job.options,paths.work);
      let inputFile=paths.inputFile;
      const t=job.options.transform;
      if (t.scale !== 1 || t.rotation.x !== 0 || t.rotation.y !== 0 || t.rotation.z !== 0) {
        inputFile=path.join(paths.work,'transformed.3mf');
        await prepareTransformedStl(paths.inputFile,inputFile,t,this.registry.catalog.machines.find(m=>m.id === job.options.machineId)!.buildVolume,controller.signal);
      }
      await sliceModel({ binary:this.config.orcaBin, args:buildSliceCommand({ ...profiles,datadir:paths.datadir,outputDir:paths.output,inputFile,options:job.options }),
        cwd:paths.root,logFile:path.join(paths.work,'orca.log'),timeoutSeconds:this.config.slicerTimeoutSeconds,signal:controller.signal,onOutput:output=>this.events.emit(id,'orca-output',{output}) });
      if (controller.signal.aborted) throw new Error('Slice canceled');
      this.update(id,'validating','validating');
      const result = await validateOutput(paths.output,job.presets.machine,id,this.version,(performance.now()-start)/1000);
      if (controller.signal.aborted) throw new Error('Slice canceled');
      this.update(id,'succeeded','completed',{result});
    } catch (error) {
      if (this.store.get(id)?.status !== 'canceled') this.update(id,'failed','failed',{error:timedOut ? `Slicing timed out after ${this.config.slicerTimeoutSeconds} seconds` : error instanceof Error ? error.message : 'Unexpected slicing error'});
    } finally {clearTimeout(deadline);}
  }
  isActive(id: string): boolean { return this.active.has(id); }
  async close() {
    this.closed = true; for (const controller of this.active.values()) controller.abort();
    while (this.active.size) await new Promise(resolve=>setTimeout(resolve,25));
  }
}
