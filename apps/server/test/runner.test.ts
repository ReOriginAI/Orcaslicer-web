import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach,beforeEach,describe,it,expect} from 'vitest';
import {sliceModel} from '../src/orca/runner.js';
let dir:string;
beforeEach(async()=>{dir=await fs.mkdtemp(path.join(os.tmpdir(),'orca-runner-'));});
afterEach(async()=>{await fs.rm(dir,{recursive:true,force:true});});
async function script(source:string) {const filename=path.join(dir,'fixture.cjs');await fs.writeFile(filename,source);return filename;}
describe('safe child process lifecycle',()=>{
 it('streams real process diagnostics from a regular logfile',async()=>{
  const logFile=path.join(dir,'orca.log');const file=await script('require("node:fs").writeFileSync(process.argv[2],"Preparing model\\nSlicing layers\\n");');
  const messages:string[]=[];await sliceModel({binary:process.execPath,args:[file,logFile],cwd:dir,logFile,timeoutSeconds:2,signal:new AbortController().signal,onOutput:t=>messages.push(t)});
  expect(messages.join('')).toContain('Slicing layers');
 });
 it('reports Orca diagnostic text on unsuccessful exit',async()=>{
  const logFile=path.join(dir,'orca.log');const file=await script('require("node:fs").writeFileSync(process.argv[2],"Object exceeds print volume");process.exit(4);');
  await expect(sliceModel({binary:process.execPath,args:[file,logFile],cwd:dir,logFile,timeoutSeconds:2,signal:new AbortController().signal,onOutput:()=>{}})).rejects.toThrow('Object exceeds print volume');
 });
 it('terminates a stalled child at the slicing deadline',async()=>{
  const file=await script('setInterval(()=>{},100);');
  await expect(sliceModel({binary:process.execPath,args:[file],cwd:dir,logFile:path.join(dir,'orca.log'),timeoutSeconds:0.1,signal:new AbortController().signal,onOutput:()=>{}})).rejects.toThrow('timed out');
 });
 it('cancels a running child and drains its output',async()=>{
  const file=await script('process.stdout.write("started\\n");setInterval(()=>{},100);');const controller=new AbortController();
  await expect(sliceModel({binary:process.execPath,args:[file],cwd:dir,logFile:path.join(dir,'orca.log'),timeoutSeconds:2,signal:controller.signal,onOutput:()=>controller.abort()})).rejects.toThrow('canceled');
 });
});
