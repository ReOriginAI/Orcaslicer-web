import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { ServerResponse } from 'node:http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sliceOptionsSchema, terminalStatuses, type AboutResponse, type Job, type JobEvent, type JobEventName } from '@orca-web/shared';
import type { Config } from '../config.js';
import type { PresetRegistry } from '../presets/discovery.js';
import type { JobStore } from '../storage/jobs.js';
import type { SliceQueue } from '../jobs/queue.js';
import { displayFilename, jobIdSchema, jobPaths, safeFilePath } from '../storage/paths.js';
export class HttpError extends Error { constructor(public statusCode: number,message: string) {super(message);} }
export interface RouteContext { config:Config; registry:PresetRegistry|null; store:JobStore; queue:SliceQueue; about:AboutResponse }
export async function registerRoutes(app:FastifyInstance, ctx:RouteContext) {
  const { config,registry,store,queue,about } = ctx;
  const connections=new Set<ServerResponse>();
  app.addHook('preClose',async()=>{for(const response of connections)response.end();connections.clear();});
  function getJob(request: FastifyRequest):Job {
    const id = (request.params as {id:string}).id;
    if (!jobIdSchema.safeParse(id).success) throw new HttpError(400,'Invalid job ID');
    const job = store.get(id); if (!job) throw new HttpError(404,'Job not found'); return job;
  }
  app.get('/api/health',async()=>({status:'ok',slicerAvailable:about.slicerAvailable}));
  app.get('/api/about',async()=>about);
  app.get('/api/presets',async()=>registry?.catalog ?? {machines:[],processes:[],filaments:[],defaults:null});
  app.get('/api/jobs',async()=>store.list());
  app.get('/api/jobs/:id',async request=>getJob(request));
  app.post('/api/jobs',async(request,reply)=>{
    if (!registry || !about.slicerAvailable) throw new HttpError(503,'OrcaSlicer is unavailable. Check the server setup.');
    if (!request.isMultipart()) throw new HttpError(415,'Use multipart/form-data with model and options fields');
    const id=randomUUID(); const dirs=jobPaths(config.dataDir,id);
    await Promise.all([fs.mkdir(dirs.input,{recursive:true}),fs.mkdir(dirs.work,{recursive:true}),fs.mkdir(dirs.output,{recursive:true})]);
    let filename:string|undefined; let optionsText:string|undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (!['model','file'].includes(part.fieldname) || filename) { part.file.resume(); throw new HttpError(400,'Upload exactly one model file'); }
          filename=displayFilename(part.filename);
          if (path.extname(filename).toLowerCase() !== '.stl') { part.file.resume(); throw new HttpError(415,'Only STL has been verified with the installed Orca release'); }
          await pipeline(part.file,createWriteStream(dirs.inputFile,{flags:'wx'}));
          if (part.file.truncated) throw new HttpError(413,`Model exceeds ${config.maxUploadMb} MB upload limit`);
        } else {
          if (part.fieldname !== 'options' || optionsText !== undefined || typeof part.value !== 'string' || part.valueTruncated) throw new HttpError(400,'Expected a single options JSON field');
          optionsText=part.value;
        }
      }
      if (!filename || !optionsText) throw new HttpError(400,'Model and options are required');
      if ((await fs.stat(dirs.inputFile)).size === 0) throw new HttpError(400,'The model file is empty');
      let raw:unknown; try {raw=JSON.parse(optionsText);} catch {throw new HttpError(400,'Invalid options JSON');}
      const parsed=sliceOptionsSchema.safeParse(raw); if (!parsed.success) throw new HttpError(400,parsed.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).join('; '));
      let selected; try {selected=registry.resolve(parsed.data);} catch(error) {throw new HttpError(400,(error as Error).message);}
      if (parsed.data.overrides.layerHeight !== undefined) {
        const min=Number((selected.machine.flat!.min_layer_height as string[]|undefined)?.[0] ?? 0.06); const max=Number((selected.machine.flat!.max_layer_height as string[]|undefined)?.[0] ?? 0.4);
        if (parsed.data.overrides.layerHeight < min || parsed.data.overrides.layerHeight > max) throw new HttpError(400,`Layer height must be between ${min} and ${max} mm for this nozzle`);
      }
      const now=new Date().toISOString();
      const job:Job={id,status:'queued',filename,options:parsed.data,presets:{machine:selected.machine.name,process:selected.process.name,filament:selected.filament.name},createdAt:now,updatedAt:now};
      store.create(job); queue.enqueue(job); return reply.code(202).send({id,status:'queued'});
    } catch(error) {await fs.rm(dirs.root,{recursive:true,force:true}); throw error;}
  });
  app.delete('/api/jobs/:id',async(request,reply)=>{
    const job=getJob(request);
    if (!terminalStatuses.includes(job.status)) return reply.code(202).send(queue.cancel(job.id));
    if (queue.isActive(job.id)) throw new HttpError(409,'Cancellation is finishing. Retry deletion shortly.');
    await fs.rm(jobPaths(config.dataDir,job.id).root,{recursive:true,force:true}); store.delete(job.id); return reply.code(204).send();
  });
  app.get('/api/jobs/:id/files',async request=>{const job=getJob(request);return job.status === 'succeeded' ? job.result!.files : [];});
  app.get('/api/jobs/:id/files/:file',async(request,reply)=>{
    const job=getJob(request);const name=(request.params as {file:string}).file;
    let filename:string;try {filename=safeFilePath(jobPaths(config.dataDir,job.id).output,name);} catch {throw new HttpError(400,'Invalid download filename');}
    if (job.status !== 'succeeded' || !job.result?.files.some(f=>f.name === name)) throw new HttpError(404,'G-code file not found');
    const stat=await fs.lstat(filename);if (!stat.isFile()) throw new HttpError(404,'G-code file not found');
    reply.type('application/octet-stream').header('Content-Length',stat.size).header('Content-Disposition',`attachment; filename="model.gcode"; filename*=UTF-8''${encodeURIComponent(name)}`);
    return reply.send(createReadStream(filename));
  });
  app.get('/api/jobs/:id/events',async(request,reply)=>{
    const job=getJob(request);
    let unsubscribe:()=>void;
    const send=(name:JobEventName,event:JobEvent)=>{
      if (reply.raw.destroyed) return;
      if (reply.raw.writableLength > 1024*1024) {reply.raw.destroy();return;}
      reply.raw.write(`event: ${name}\ndata: ${JSON.stringify(event)}\n\n`);
      if(event.job && terminalStatuses.includes(event.job.status))reply.raw.end();
    };
    try {unsubscribe=queue.events.subscribe(job.id,send);} catch {throw new HttpError(429,'Too many live connections for this job');}
    reply.hijack();reply.raw.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
    connections.add(reply.raw);
    send('snapshot',{job:store.get(job.id)!});
    const heartbeat=setInterval(()=>{if(!reply.raw.destroyed)reply.raw.write(': heartbeat\n\n');},15000);heartbeat.unref();
    reply.raw.on('close',()=>{clearInterval(heartbeat);unsubscribe();connections.delete(reply.raw);});
  });
}
