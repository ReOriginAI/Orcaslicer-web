import path from 'node:path';
import { sliceOptionsSchema, type SliceOptions } from '@orca-web/shared';
export interface SliceCommandInput { datadir: string; machineProfile: string; processProfile: string; filamentProfile: string; outputDir: string; inputFile: string; options: SliceOptions }
export function buildSliceCommand(input: SliceCommandInput): string[] {
  const { transform } = sliceOptionsSchema.parse(input.options);
  const args = ['--debug', '3', '--logfile', path.join(path.dirname(input.datadir), 'orca.log'), '--datadir', input.datadir, '--load-settings', `${input.machineProfile};${input.processProfile}`, '--load-filaments', input.filamentProfile];
  // v2.4.2 rotation and scale CLI flags crash. Transforms are carried in a server-generated standard 3MF.
  if (transform.ensureOnBed) args.push('--ensure-on-bed');
  args.push('--allow-rotations=0', '--orient', transform.autoOrient ? '1' : '0', '--arrange', transform.autoArrange ? '1' : '0', '--slice', '0', '--outputdir', input.outputDir, '--', input.inputFile);
  return args;
}
