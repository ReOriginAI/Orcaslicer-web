import { EventEmitter } from 'node:events';
import type { JobEvent, JobEventName } from '@orca-web/shared';
export class JobEvents {
  private emitter = new EventEmitter();
  emit(id: string, name: JobEventName, event: JobEvent) { this.emitter.emit(id, name, event); }
  subscribe(id: string, listener: (name: JobEventName, event: JobEvent) => void): () => void {
    if (this.emitter.listenerCount(id) >= 20) throw new Error('Too many live connections for this job');
    this.emitter.setMaxListeners(20); this.emitter.on(id, listener); return () => this.emitter.off(id, listener);
  }
}
