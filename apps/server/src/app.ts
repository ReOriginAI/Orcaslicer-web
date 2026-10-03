import fs from 'node:fs/promises';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { AboutResponse } from '@orca-web/shared';
import type { Config } from './config.js';
import { discoverProfiles, type PresetRegistry } from './presets/discovery.js';
import { getOrcaVersion } from './orca/version.js';
import { JobStore } from './storage/jobs.js';
import { SliceQueue } from './jobs/queue.js';
import { registerRoutes, HttpError } from './api/routes.js';
export async function createApp(config:Config, dependencies?:{ registry:PresetRegistry; version:string }) {
  const app=Fastify({logger:process.env.NODE_ENV !== 'test',bodyLimit:64*1024,requestTimeout:120000});
  await fs.mkdir(config.dataDir,{recursive:true});
  await fs.mkdir(`${config.dataDir}/custom-profiles`,{recursive:true});
  let registry:PresetRegistry|null=null;let version:string|null=null;let setupError:string|undefined;
  try {if(dependencies){registry=dependencies.registry;version=dependencies.version;}else{[registry,version]=await Promise.all([discoverProfiles(config.orcaResources),getOrcaVersion(config.orcaBin)]);}} catch(error) {setupError=(error as Error).message;app.log.error({err:error},'Slicer setup failed');}
  const store=new JobStore(config.dataDir);const queue=new SliceQueue(store,config,registry,version);
  const about:AboutResponse={appVersion:'0.1.0',orcaVersion:version,slicerAvailable:registry !== null && version !== null,supportedFormats:['stl'],maxUploadMb:config.maxUploadMb,...(setupError?{error:setupError}:{})};
  await app.register(multipart,{limits:{fileSize:config.maxUploadMb*1024*1024,files:1,fields:1,parts:2,fieldSize:16*1024,fieldNameSize:100,headerPairs:100},throwFileSizeLimit:true});
  app.setErrorHandler((error,request,reply)=>{
    const details=error as {statusCode?:number;message?:string};
    const status=error instanceof HttpError ? error.statusCode : error instanceof ZodError ? 400 : typeof details.statusCode === 'number' && details.statusCode >= 400 && details.statusCode < 500 ? details.statusCode : 500;
    if(status>=500)request.log.error({err:error},'Request failed');
    reply.code(status).send({error:status === 500 ? 'Internal server error' : details.message ?? 'Invalid request'});
  });
  await registerRoutes(app,{config,registry,store,queue,about});
  try {
    await fs.access(`${config.webDist}/index.html`);
    await app.register(fastifyStatic,{root:config.webDist,prefix:'/',index:'index.html'});
    app.setNotFoundHandler((request,reply)=>request.url.startsWith('/api/') ? reply.code(404).send({error:'Not found'}) : reply.sendFile('index.html'));
  } catch {app.setNotFoundHandler((_request,reply)=>reply.code(404).send({error:'Not found. Build the frontend with pnpm build.'}));}
  app.addHook('onClose',async()=>{await queue.close();store.close();});
  return {app,store,queue,registry,about};
}
