import path from 'node:path';
import { z } from 'zod';
export const jobIdSchema = z.uuid();
export function displayFilename(value: string): string {
  const name = path.posix.basename(value.replaceAll('\\', '/')).normalize('NFC').replace(/[\x00-\x1f\x7f]/g, '').trim();
  return name.slice(0, 180) || 'model.stl';
}
export function safeFilePath(directory: string, name: string): string {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid file name');
  const resolved = path.resolve(directory, name);
  if (path.dirname(resolved) !== path.resolve(directory)) throw new Error('Invalid file path');
  return resolved;
}
export function jobPaths(dataDir: string, id: string) {
  jobIdSchema.parse(id);
  const root = path.join(dataDir, 'jobs', id);
  return { root, input: path.join(root, 'input'), work: path.join(root, 'work'), output: path.join(root, 'output'),
    datadir: path.join(root, 'work', 'orca-data'), inputFile: path.join(root, 'input', 'model.stl') };
}
