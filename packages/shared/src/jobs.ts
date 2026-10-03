import { z } from 'zod';
import type { PresetSelection } from './presets.js';
export const overridesSchema = z.object({
  layerHeight: z.number().min(0.06).max(0.4).optional(),
  wallCount: z.number().int().min(1).max(20).optional(),
  infillPercent: z.number().min(0).max(100).optional(),
  supports: z.boolean().optional(),
  brim: z.boolean().optional(),
}).strict();
export const transformSchema = z.object({
  rotation: z.object({ x: z.number().min(-360).max(360), y: z.number().min(-360).max(360), z: z.number().min(-360).max(360) }).strict().default({ x: 0, y: 0, z: 0 }),
  scale: z.number().min(0.01).max(100).default(1),
  autoOrient: z.boolean().default(false), autoArrange: z.boolean().default(true), ensureOnBed: z.boolean().default(true),
}).strict();
export const sliceOptionsSchema = z.object({
  machineId: z.string().min(1).max(200), processId: z.string().min(1).max(200), filamentId: z.string().min(1).max(200),
  transform: transformSchema.default({ rotation: { x: 0, y: 0, z: 0 }, scale: 1, autoOrient: false, autoArrange: true, ensureOnBed: true }),
  overrides: overridesSchema.default({}),
}).strict();
export type SliceOptions = z.infer<typeof sliceOptionsSchema>;
export type Transform = z.infer<typeof transformSchema>;
export type Overrides = z.infer<typeof overridesSchema>;
export type JobStatus = 'queued' | 'running' | 'validating' | 'succeeded' | 'failed' | 'canceled';
export interface ResultFile { name: string; size: number; downloadUrl: string }
export interface SliceResult {
  files: ResultFile[]; sliceTimeSeconds: number; orcaVersion: string;
  estimatedPrintTime?: string; filamentLengthMm?: number; filamentWeightGrams?: number;
  printerName?: string;
}
export interface Job {
  id: string; status: JobStatus; filename: string; createdAt: string; updatedAt: string;
  options: SliceOptions; presets: { machine: string; process: string; filament: string };
  result?: SliceResult; error?: string;
}
export interface CreateJobResponse { id: string; status: JobStatus }
export type JobEventName = 'queued' | 'started' | 'orca-output' | 'validating' | 'completed' | 'failed' | 'canceled' | 'snapshot';
export interface JobEvent { job?: Job; output?: string }
export const terminalStatuses: JobStatus[] = ['succeeded', 'failed', 'canceled'];
