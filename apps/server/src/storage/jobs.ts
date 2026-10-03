import Database from 'better-sqlite3';
import path from 'node:path';
import type { Job, JobStatus } from '@orca-web/shared';
import { assertTransition } from '../jobs/state.js';
export class JobStore {
  private db: Database.Database;
  constructor(dataDir: string) {
    this.db = new Database(path.join(dataDir, 'app.db'));
    this.db.pragma('journal_mode = WAL'); this.db.pragma('busy_timeout = 5000');
    this.db.exec('CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL)');
    for (const job of this.list()) if (job.status === 'running' || job.status === 'validating') this.transition(job.id, 'failed', { error: 'Server restarted during slicing. Upload the model again to retry.' });
  }
  create(job: Job): Job { this.db.prepare('INSERT INTO jobs (id,status,created_at,json) VALUES (?,?,?,?)').run(job.id, job.status, job.createdAt, JSON.stringify(job)); return job; }
  get(id: string): Job | undefined { const row = this.db.prepare('SELECT json FROM jobs WHERE id=?').get(id) as {json:string}|undefined; return row ? JSON.parse(row.json) as Job : undefined; }
  list(): Job[] { return (this.db.prepare('SELECT json FROM jobs ORDER BY created_at DESC, rowid DESC').all() as {json:string}[]).map(row=>JSON.parse(row.json) as Job); }
  queued(): Job[] { return this.list().filter(j=>j.status === 'queued').reverse(); }
  transition(id: string, status: JobStatus, update: Partial<Pick<Job,'error'|'result'>> = {}): Job {
    const job = this.get(id); if (!job) throw new Error('Job not found'); assertTransition(job.status, status);
    const next: Job = { ...job, ...update, status, updatedAt: new Date().toISOString() };
    this.db.prepare('UPDATE jobs SET status=?,json=? WHERE id=?').run(status,JSON.stringify(next),id); return next;
  }
  delete(id: string): void { this.db.prepare('DELETE FROM jobs WHERE id=?').run(id); }
  close(): void { this.db.close(); }
}
