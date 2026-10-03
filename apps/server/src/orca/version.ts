import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killProcess } from './runner.js';
export async function getOrcaVersion(binary: string): Promise<string> {
  // Orca writes result.json/log artifacts even for --help. Keep them out of the application directory.
  const directory = await mkdtemp(join(tmpdir(), 'orca-web-version-'));
  try {
    return await new Promise((resolve, reject) => {
    const child = spawn(binary, ['--help'], { cwd: directory, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    const timer = setTimeout(() => { killProcess(child, 'SIGKILL'); reject(new Error('OrcaSlicer version check timed out')); }, 15000); timer.unref();
    for (const stream of [child.stdout, child.stderr]) stream!.on('data', (chunk: Buffer) => { text = (text + chunk.toString()).slice(0, 128 * 1024); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      const match = text.match(/OrcaSlicer(?:\s+Version)?[^\d\n]{0,20}(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/i);
      if (!match || code !== 0) reject(new Error('Cannot determine installed OrcaSlicer version'));
      else resolve(match[1]!);
    });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
