import fs from 'node:fs/promises';
import path from 'node:path';
import type { SliceResult } from '@orca-web/shared';
import { readGcodeMetadata } from '../gcode/metadata.js';
import { displayFilename, safeFilePath } from '../storage/paths.js';
export async function validateOutput(outputDir: string, printerName: string, jobId: string, orcaVersion: string, sliceTimeSeconds: number, inputFilename?: string): Promise<SliceResult> {
  const files: SliceResult['files'] = []; let metadata: Awaited<ReturnType<typeof readGcodeMetadata>> | undefined;
  for (const entry of (await fs.readdir(outputDir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.gcode')) continue;
    const filename = safeFilePath(outputDir, entry.name); const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.size === 0) throw new Error('Orca generated an empty or invalid G-code file');
    const parsed = await readGcodeMetadata(filename);
    if (!parsed.generatedByOrca || !parsed.hasMotion) throw new Error('Orca output is not a valid slicing result');
    if (!parsed.printerName || parsed.printerName !== printerName) throw new Error(`G-code printer does not match selected printer (${parsed.printerName ?? 'missing metadata'})`);
    metadata ??= parsed;
    files.push({ name: entry.name, size: stat.size, downloadUrl: `/api/jobs/${jobId}/files/${encodeURIComponent(entry.name)}` });
  }
  if (!files.length) throw new Error('OrcaSlicer did not produce a G-code file');
  if (inputFilename) {
    const original = displayFilename(inputFilename);
    const stem = original.slice(0, -path.extname(original).length) || 'model';
    // Stage every file first, so a model named plate_2 cannot overwrite another plate.
    const staged: string[] = [];
    for (const [index, file] of files.entries()) {
      const temporary = safeFilePath(outputDir, `.rename-${jobId}-${index}`);
      await fs.rename(safeFilePath(outputDir, file.name), temporary);
      staged.push(temporary);
    }
    for (const [index, file] of files.entries()) {
      const name = `${stem}${files.length > 1 ? `_plate_${index + 1}` : ''}.gcode`;
      await fs.rename(staged[index]!, safeFilePath(outputDir, name));
      file.name = name;
      file.downloadUrl = `/api/jobs/${jobId}/files/${encodeURIComponent(name)}`;
    }
  }
  return { files, sliceTimeSeconds, orcaVersion, printerName: metadata!.printerName, estimatedPrintTime: metadata!.estimatedPrintTime,
    filamentLengthMm: metadata!.filamentLengthMm, filamentWeightGrams: metadata!.filamentWeightGrams };
}
