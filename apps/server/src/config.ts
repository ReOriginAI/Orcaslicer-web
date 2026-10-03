import path from 'node:path';
import { z } from 'zod';
const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8084),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  ORCA_BIN: z.string().default('/opt/orca/AppRun'),
  ORCA_RESOURCES: z.string().default('/opt/orca/resources'),
  WEB_DIST: z.string().optional(),
  WEB_DIST_DIR: z.string().optional(),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(2048).default(250),
  MAX_CONCURRENT_SLICES: z.coerce.number().int().min(1).max(8).default(1),
  SLICER_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(7200).default(900),
});
export interface Config {
  port: number; host: string; dataDir: string; orcaBin: string; orcaResources: string; webDist: string;
  maxUploadMb: number; maxConcurrentSlices: number; slicerTimeoutSeconds: number;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const v = envSchema.parse(env);
  return { port: v.PORT, host: v.HOST, dataDir: path.resolve(v.DATA_DIR), orcaBin: v.ORCA_BIN,
    orcaResources: path.resolve(v.ORCA_RESOURCES), webDist: path.resolve(v.WEB_DIST ?? v.WEB_DIST_DIR ?? './apps/web/dist'), maxUploadMb: v.MAX_UPLOAD_MB,
    maxConcurrentSlices: v.MAX_CONCURRENT_SLICES, slicerTimeoutSeconds: v.SLICER_TIMEOUT_SECONDS };
}
