import type { JobStatus } from '@orca-web/shared';
const transitions: Record<JobStatus, JobStatus[]> = {
  queued: ['running', 'failed', 'canceled'], running: ['validating', 'failed', 'canceled'], validating: ['succeeded', 'failed', 'canceled'], succeeded: [], failed: [], canceled: [],
};
export function assertTransition(from: JobStatus, to: JobStatus): void {
  if (!transitions[from].includes(to)) throw new Error(`Invalid job transition: ${from} → ${to}`);
}
