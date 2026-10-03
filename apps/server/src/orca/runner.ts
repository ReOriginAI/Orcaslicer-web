import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
export function killProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (!child.pid) return;
  try { if (process.platform !== 'win32') process.kill(-child.pid, signal); else child.kill(signal); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}
export interface RunInput { binary: string; args: string[]; cwd: string; logFile: string; timeoutSeconds: number; signal: AbortSignal; onOutput: (text: string) => void }
export async function sliceModel(input: RunInput): Promise<void> {
  if (input.signal.aborted) throw new Error('Slice canceled');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.binary, input.args, { shell: false, cwd: input.cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let timedOut = false; let diagnosticOverflow = false; let tail = ''; let escalation: NodeJS.Timeout | undefined;
    const logs = [fs.createWriteStream(path.join(input.cwd, 'stdout.log')), fs.createWriteStream(path.join(input.cwd, 'stderr.log'))];
    const bytes = [0, 0]; const logLimit = 20 * 1024 * 1024;
    const terminate = () => { killProcess(child); escalation ??= setTimeout(() => killProcess(child, 'SIGKILL'), 3000); escalation.unref(); };
    const output = (chunk: Buffer) => {
      const text=chunk.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '');
      tail=(tail+text).slice(-4000);
      for(let offset=0;offset<text.length;offset+=4096) input.onOutput(text.slice(offset,offset+4096));
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, input.timeoutSeconds * 1000); timer.unref();
    input.signal.addEventListener('abort', terminate, { once: true });
    [child.stdout, child.stderr].forEach((stream, i) => stream!.on('data', (chunk: Buffer) => {
      const remaining = logLimit - bytes[i]!;
      if (remaining > 0) {
        const part = chunk.subarray(0, remaining); bytes[i]! += part.length;
        if (!logs[i]!.write(part)) { stream!.pause(); logs[i]!.once('drain',()=>stream!.resume()); }
      }
      output(chunk.subarray(0,4096));
    }));
    logs.forEach(log => log.on('error', () => terminate()));
    // Orca's Linux build requires a regular logfile: Node child stdout is a socket, not an openable pipe.
    let position=0; let reading:Promise<void>|undefined;
    async function readLog(final=false):Promise<void> {
      if(reading) {await reading;if(!final)return;}
      reading=(async()=>{
        let handle:fsp.FileHandle|undefined;
        try {
          handle=await fsp.open(input.logFile,'r');const stat=await handle.stat();
          if(stat.size>logLimit){diagnosticOverflow=true;if(!final)terminate();}
          const start=final ? Math.max(position,stat.size-64*1024) : position;
          const length=Math.min(64*1024,Math.max(0,stat.size-start));
          if(length){const data=Buffer.alloc(length);const {bytesRead}=await handle.read(data,0,length,start);position=start+bytesRead;output(data.subarray(0,bytesRead));}
        }catch(error){if((error as NodeJS.ErrnoException).code !== 'ENOENT') tail=(tail+`\nUnable to read Orca log: ${(error as Error).message}`).slice(-4000);}
        finally{await handle?.close();}
      })();
      try{await reading;}finally{reading=undefined;}
    }
    const polling=setInterval(()=>{void readLog();},250);polling.unref();
    const cleanup = () => { clearTimeout(timer);clearInterval(polling); if (escalation) clearTimeout(escalation); input.signal.removeEventListener('abort', terminate); logs.forEach(log => log.end()); };
    child.once('error', error => { cleanup(); reject(new Error(`Unable to start OrcaSlicer: ${error.message}`)); });
    child.once('close', (code, signal) => { void (async()=>{
      cleanup();await readLog(true);
      if (input.signal.aborted) reject(new Error('Slice canceled'));
      else if (timedOut) reject(new Error(`Slicing timed out after ${input.timeoutSeconds} seconds`));
      else if (diagnosticOverflow) reject(new Error('OrcaSlicer exceeded the diagnostic output limit'));
      else if (code !== 0) reject(new Error(`OrcaSlicer exited with ${code ?? signal}. ${tail.trim()}`));
      else resolve();
    })(); });
  });
}
