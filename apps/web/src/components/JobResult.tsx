import type { Job, JobStatus } from "@orca-web/shared";

export const statusLabels: Record<JobStatus, string> = {
  queued: "Queued",
  running: "Slicing…",
  validating: "Validating G-code…",
  succeeded: "Completed",
  failed: "Failed",
  canceled: "Canceled",
};
export function formatBytes(size: number): string {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function JobResult({
  job,
  logs,
  onCancel,
}: {
  job: Job;
  logs?: string[];
  onCancel: () => void;
}) {
  const active = ["queued", "running", "validating"].includes(job.status);
  return (
    <section
      className={`job-result job-${job.status}`}
      aria-label="Slicing result"
    >
      <div className="result-header">
        <div>
          <span className="eyebrow">Slicing job</span>
          <h2 aria-live="polite">
            <span className={`status-dot ${active ? "status-working" : ""}`} />
            {statusLabels[job.status]}
          </h2>
          <p className="result-filename">{job.filename}</p>
        </div>
        {active && (
          <button className="button secondary" onClick={onCancel}>
            Cancel job
          </button>
        )}
      </div>
      {job.error && (
        <p className="notice error" role="alert">
          {job.error}
        </p>
      )}
      {job.result && (
        <>
          <dl className="result-stats">
            <div>
              <dt>Printer</dt>
              <dd>{job.presets.machine}</dd>
            </div>
            <div>
              <dt>Process</dt>
              <dd>{job.presets.process}</dd>
            </div>
            <div>
              <dt>Filament</dt>
              <dd>{job.presets.filament}</dd>
            </div>
            <div>
              <dt>OrcaSlicer</dt>
              <dd>{job.result.orcaVersion}</dd>
            </div>
            <div>
              <dt>Slice time</dt>
              <dd>{job.result.sliceTimeSeconds.toFixed(1)} seconds</dd>
            </div>
            <div>
              <dt>G-code size</dt>
              <dd>
                {formatBytes(
                  job.result.files.reduce(
                    (total, file) => total + file.size,
                    0,
                  ),
                )}
              </dd>
            </div>
            {job.result.estimatedPrintTime && (
              <div>
                <dt>Estimated print</dt>
                <dd>{job.result.estimatedPrintTime}</dd>
              </div>
            )}
            {job.result.filamentLengthMm !== undefined && (
              <div>
                <dt>Filament length</dt>
                <dd>{(job.result.filamentLengthMm / 1000).toFixed(2)} m</dd>
              </div>
            )}
            {job.result.filamentWeightGrams !== undefined && (
              <div>
                <dt>Filament weight</dt>
                <dd>{job.result.filamentWeightGrams.toFixed(2)} g</dd>
              </div>
            )}
          </dl>
          <div className="downloads">
            {job.result.files.map((file, index) => (
              <a
                className="button primary"
                key={file.name}
                href={file.downloadUrl}
                download
              >
                {job.result!.files.length === 1
                  ? "Download G-code"
                  : `Download G-code ${index + 1}`}
                <span aria-hidden="true">↓</span>
              </a>
            ))}
          </div>
        </>
      )}
      {active && (
        <p className="muted">
          OrcaSlicer is working on your server. You can leave this page and find
          the result in Jobs.
        </p>
      )}
      {logs && logs.length > 0 && (
        <details className="logs">
          <summary>Orca output</summary>
          <pre>{logs.join("\n")}</pre>
        </details>
      )}
    </section>
  );
}
