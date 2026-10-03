import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  sliceOptionsSchema,
  terminalStatuses,
  transformSchema,
  type AboutResponse,
  type Job,
  type JobEvent,
  type JobEventName,
  type Overrides,
  type PresetCatalog,
  type PresetSelection,
  type Transform,
} from "@orca-web/shared";
import { api, errorMessage } from "../api/client";
import { Modal } from "../components/Modal";
import { JobResult, formatBytes, statusLabels } from "../components/JobResult";
import { ModelViewer, type ModelBounds } from "../viewer/ModelViewer";
import { turnOnAxis, type Axis } from "../viewer/placement";

const defaultTransform = () => transformSchema.parse({});
const eventNames: JobEventName[] = [
  "snapshot",
  "queued",
  "started",
  "orca-output",
  "validating",
  "completed",
  "failed",
  "canceled",
];

export function App() {
  const [about, setAbout] = useState<AboutResponse | null>(null);
  const [catalog, setCatalog] = useState<PresetCatalog | null>(null);
  const [selection, setSelection] = useState<PresetSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [bounds, setBounds] = useState<ModelBounds | null>(null);
  const [transform, setTransform] = useState<Transform>(defaultTransform);
  const [selectingFace, setSelectingFace] = useState(false);
  const [customSettings, setCustomSettings] = useState(false);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [submitting, setSubmitting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [streamDisconnected, setStreamDisconnected] = useState(false);
  const [panel, setPanel] = useState<"about" | "jobs" | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const initialize = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setConnectionError(null);
    const [aboutResult, presetsResult] = await Promise.allSettled([
      api.about(signal),
      api.presets(signal),
    ]);
    if (signal?.aborted) return;
    if (aboutResult.status === "fulfilled") setAbout(aboutResult.value);
    if (presetsResult.status === "fulfilled") {
      setCatalog(presetsResult.value);
      setSelection((current) => current ?? presetsResult.value.defaults);
    }
    const failure = [aboutResult, presetsResult].find(
      (result) => result.status === "rejected",
    );
    if (failure?.status === "rejected")
      setConnectionError(errorMessage(failure.reason));
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void initialize(controller.signal);
    return () => controller.abort();
  }, [initialize]);

  const refreshJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      setJobs(await api.jobs());
    } catch (cause) {
      setJobsError(errorMessage(cause));
    } finally {
      setJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (panel === "jobs") void refreshJobs();
  }, [panel, refreshJobs]);

  const jobId = job?.id;
  const jobIsTerminal = job ? terminalStatuses.includes(job.status) : false;
  useEffect(() => {
    if (!jobId || jobIsTerminal) return;
    const source = new EventSource(
      `/api/jobs/${encodeURIComponent(jobId)}/events`,
    );
    setStreamDisconnected(false);
    const handle = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as JobEvent;
        if (payload.job) setJob(payload.job);
        if (payload.output)
          setLogs((current) => [...current, payload.output!].slice(-200));
        setStreamDisconnected(false);
      } catch {
        setStreamDisconnected(true);
      }
    };
    eventNames.forEach((name) =>
      source.addEventListener(name, handle as EventListener),
    );
    source.onopen = () => setStreamDisconnected(false);
    source.onerror = () => setStreamDisconnected(true);
    return () => source.close();
  }, [jobId, jobIsTerminal]);

  const machine = catalog?.machines.find(
    (preset) => preset.id === selection?.machineId,
  );
  const processes =
    catalog?.processes.filter((preset) =>
      preset.compatibleMachineIds.includes(selection?.machineId ?? ""),
    ) ?? [];
  const filaments =
    catalog?.filaments.filter((preset) =>
      preset.compatibleMachineIds.includes(selection?.machineId ?? ""),
    ) ?? [];
  const formats =
    about?.supportedFormats.map((format) =>
      format.replace(/^\./, "").toLowerCase(),
    ) ?? [];
  const activeJob = job !== null && !terminalStatuses.includes(job.status);
  const ready =
    !!file &&
    !!selection &&
    !!about?.slicerAvailable &&
    !loading &&
    !submitting &&
    !activeJob;

  const chooseFile = (candidate: File) => {
    setUploadError(null);
    const extension = candidate.name.split(".").pop()?.toLowerCase();
    if (!extension || !formats.includes(extension)) {
      setUploadError(
        `Choose a supported model: ${formats.length ? formats.map((format) => format.toUpperCase()).join(", ") : "formats unavailable while the server is offline"}.`,
      );
      return;
    }
    if (about && candidate.size > about.maxUploadMb * 1024 * 1024) {
      setUploadError(
        `This file exceeds the ${about.maxUploadMb} MB upload limit.`,
      );
      return;
    }
    if (!candidate.size) {
      setUploadError("This file is empty. Choose a model with geometry.");
      return;
    }
    setFile(candidate);
    setTransform(defaultTransform());
    setSelectingFace(false);
    setBounds(null);
    if (!activeJob) {
      setJob(null);
      setLogs([]);
    }
  };

  const uploadChanged = (event: ChangeEvent<HTMLInputElement>) => {
    const candidate = event.target.files?.[0];
    if (candidate) chooseFile(candidate);
    event.target.value = "";
  };
  const drop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const candidate = event.dataTransfer.files[0];
    if (candidate) chooseFile(candidate);
  };

  const selectMachine = (machineId: string) => {
    if (!catalog || !selection) return;
    const compatibleProcess = catalog.processes.filter((preset) =>
      preset.compatibleMachineIds.includes(machineId),
    );
    const compatibleFilament = catalog.filaments.filter((preset) =>
      preset.compatibleMachineIds.includes(machineId),
    );
    setSelection({
      machineId,
      processId:
        compatibleProcess.find((preset) => preset.id === selection.processId)
          ?.id ??
        compatibleProcess[0]?.id ??
        "",
      filamentId:
        compatibleFilament.find((preset) => preset.id === selection.filamentId)
          ?.id ??
        compatibleFilament[0]?.id ??
        "",
    });
  };

  const slice = async () => {
    if (!file || !selection) return;
    setUploadError(null);
    setSubmitting(true);
    setSelectingFace(false);
    try {
      const options = sliceOptionsSchema.safeParse({
        ...selection,
        transform,
        overrides: customSettings ? overrides : {},
      });
      if (!options.success)
        throw new Error(
          options.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
        );
      const created = await api.createJob(file, options.data);
      const latest = await api.job(created.id);
      setLogs([]);
      setJob(latest);
      window.setTimeout(
        () =>
          resultRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          }),
        100,
      );
    } catch (cause) {
      setUploadError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  };

  const removeJob = async (target: Job) => {
    setActionBusy(target.id);
    setJobsError(null);
    try {
      await api.removeJob(target.id);
      if (job?.id === target.id) {
        if (terminalStatuses.includes(target.status)) setJob(null);
        else setJob(await api.job(target.id));
      }
      if (panel === "jobs") await refreshJobs();
    } catch (cause) {
      if (panel === "jobs") setJobsError(errorMessage(cause));
      else setUploadError(errorMessage(cause));
    } finally {
      setActionBusy(null);
    }
  };

  const numericTransform = (key: "scale" | "x" | "y" | "z", value: string) => {
    const number = Number(value);
    if (key === "scale")
      setTransform((current) => ({ ...current, scale: number / 100 }));
    else
      setTransform((current) => ({
        ...current,
        rotation: { ...current.rotation, [key]: number },
      }));
  };

  return (
    <div
      className="app-shell"
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current--;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={drop}
    >
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <div>
            <h1>Orca Web</h1>
            <span className="brand-subtitle">Your local slicing workspace</span>
          </div>
        </div>
        <nav aria-label="Application">
          <span
            className={`server-badge${about?.slicerAvailable ? " online" : ""}`}
          >
            <span className="status-dot" />
            {loading
              ? "Connecting"
              : about?.slicerAvailable
                ? "Server ready"
                : "Server unavailable"}
          </span>
          <button className="nav-button" onClick={() => setPanel("jobs")}>
            Jobs
          </button>
          <button className="nav-button" onClick={() => setPanel("about")}>
            About
          </button>
        </nav>
      </header>

      {connectionError && (
        <div className="connection-notice" role="alert">
          <span>
            Could not connect to the slicing server: {connectionError}
          </span>
          <button onClick={() => void initialize()}>Retry connection</button>
        </div>
      )}
      {!loading && about && !about.slicerAvailable && (
        <div className="connection-notice" role="alert">
          OrcaSlicer is unavailable.{" "}
          {about.error ?? "Check the server installation and restart it."}
        </div>
      )}
      {!loading && catalog && !catalog.defaults && (
        <div className="connection-notice" role="alert">
          Compatible bundled printer profiles were not found. Check the
          OrcaSlicer resource directory on the server.
        </div>
      )}

      <main className="workspace">
        <aside className="models-panel panel" aria-label="Models">
          <div className="panel-title">
            <h2>Models</h2>
            <span className="count-badge">{file ? 1 : 0}</span>
          </div>
          <input
            ref={uploadRef}
            id="model-upload"
            className="visually-hidden"
            type="file"
            aria-label="Add model"
            data-testid="model-upload"
            accept={formats.map((format) => `.${format}`).join(",")}
            onChange={uploadChanged}
            disabled={loading || !formats.length || submitting}
          />
          <button
            className="add-model"
            onClick={() => uploadRef.current?.click()}
            disabled={loading || !formats.length || submitting}
          >
            <span aria-hidden="true">+</span>Add model
          </button>
          {file ? (
            <div className="model-card">
              <div className="model-file-icon" aria-hidden="true">
                ◇
              </div>
              <div className="model-file-info">
                <strong title={file.name}>{file.name}</strong>
                <span>
                  {formatBytes(file.size)} ·{" "}
                  {file.name.split(".").pop()?.toUpperCase()}
                </span>
              </div>
              <button
                className="model-remove"
                aria-label={`Remove ${file.name}`}
                onClick={() => {
                  setFile(null);
                  setBounds(null);
                  if (!activeJob) setJob(null);
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <p className="model-hint">
              Add a model or drop it anywhere in this workspace.
            </p>
          )}
          {bounds && (
            <dl className="model-dimensions">
              <div>
                <dt>Width · X</dt>
                <dd>{bounds.width.toFixed(1)} mm</dd>
              </div>
              <div>
                <dt>Depth · Y</dt>
                <dd>{bounds.depth.toFixed(1)} mm</dd>
              </div>
              <div>
                <dt>Height · Z</dt>
                <dd>{bounds.height.toFixed(1)} mm</dd>
              </div>
            </dl>
          )}
          {bounds?.outsideBed && (
            <p className="notice warning">
              The preview extends outside the build volume. Adjust the scale or
              rotation before slicing.
            </p>
          )}
          <div className="models-footer">
            <span className="eyebrow">One model, one filament</span>
            <p>
              {formats.length
                ? formats.map((format) => format.toUpperCase()).join(" / ")
                : "Loading supported formats…"}
              {about && ` · up to ${about.maxUploadMb} MB`}
            </p>
          </div>
        </aside>

        <ModelViewer
          file={file}
          volume={machine?.buildVolume}
          transform={transform}
          onBounds={setBounds}
          selectingFace={selectingFace && !!file && !submitting && !activeJob}
          onFaceSelected={(next) => { setTransform(next); setSelectingFace(false); }}
          onSelectionCancel={() => setSelectingFace(false)}
        />

        <aside className="settings-panel panel" aria-label="Slicing settings">
          <div className="panel-title">
            <h2>Print setup</h2>
            <span className="eyebrow">Stock Orca presets</span>
          </div>
          <div className="preset-fields">
            <label className="field">
              Printer
              <select
                aria-label="Printer"
                value={selection?.machineId ?? ""}
                onChange={(event) => selectMachine(event.target.value)}
                disabled={!catalog || submitting || activeJob}
              >
                {!catalog?.machines.length && (
                  <option value="">
                    {loading ? "Loading presets…" : "No compatible printer"}
                  </option>
                )}
                {catalog?.machines.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            {machine && (
              <p className="preset-note">
                {machine.nozzleDiameter} mm nozzle · {machine.buildVolume.width}{" "}
                × {machine.buildVolume.depth} × {machine.buildVolume.height} mm
              </p>
            )}
            <label className="field">
              Process
              <select
                aria-label="Process"
                value={selection?.processId ?? ""}
                onChange={(event) =>
                  setSelection(
                    (current) =>
                      current && { ...current, processId: event.target.value },
                  )
                }
                disabled={!processes.length || submitting || activeJob}
              >
                {!processes.length && (
                  <option value="">
                    {loading ? "Loading presets…" : "No compatible process"}
                  </option>
                )}
                {processes.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Filament
              <select
                aria-label="Filament"
                value={selection?.filamentId ?? ""}
                onChange={(event) =>
                  setSelection(
                    (current) =>
                      current && { ...current, filamentId: event.target.value },
                  )
                }
                disabled={!filaments.length || submitting || activeJob}
              >
                {!filaments.length && (
                  <option value="">
                    {loading ? "Loading presets…" : "No compatible filament"}
                  </option>
                )}
                {filaments.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <section
            className="transform-settings"
            aria-labelledby="transform-title"
          >
            <div className="section-title">
              <h3 id="transform-title">Transform</h3>
              <button
                className="text-button"
                disabled={!file || submitting || activeJob}
                onClick={() => { setTransform(defaultTransform()); setSelectingFace(false); }}
              >
                Reset
              </button>
            </div>
            <fieldset disabled={!file || submitting || activeJob}>
              <legend className="visually-hidden">Model transformation</legend>
              <div className="face-controls">
                <div className="axis-turns">{(["x", "y", "z"] as Axis[]).map((axis) => <button
                  type="button" key={axis} aria-label={`Turn ${axis.toUpperCase()} 90 degrees`}
                  onClick={() => { setTransform((current) => turnOnAxis(current, axis, 90)); setSelectingFace(false); }}
                >{axis.toUpperCase()} +90°</button>)}</div>
                <div className="axis-turns">{(["x", "y", "z"] as Axis[]).map((axis) => <button
                  type="button" key={axis} aria-label={`Flip ${axis.toUpperCase()} 180 degrees`}
                  onClick={() => { setTransform((current) => turnOnAxis(current, axis, 180)); setSelectingFace(false); }}
                >Flip {axis.toUpperCase()}</button>)}</div>
                <button type="button" className={`place-face-button${selectingFace ? " selected" : ""}`}
                  aria-pressed={selectingFace} disabled={!bounds}
                  onClick={() => setSelectingFace((current) => !current)}
                >Place on face</button>
                <p className="placement-note">Turns and face placement snap the model onto the bed.</p>
              </div>
              <div className="rotation-fields">
                {(["x", "y", "z"] as const).map((axis) => (
                  <label className="field small-field" key={axis}>
                    Rotate {axis.toUpperCase()}
                    <div className="unit-input">
                      <input
                        type="number"
                        min="-360"
                        max="360"
                        step="1"
                        aria-label={`Rotation ${axis.toUpperCase()}`}
                        value={transform.rotation[axis]}
                        onChange={(event) =>
                          numericTransform(axis, event.target.value)
                        }
                      />
                      <span>°</span>
                    </div>
                  </label>
                ))}
              </div>
              <label className="field scale-field">
                Uniform scale
                <div className="unit-input">
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    step="1"
                    aria-label="Uniform scale"
                    value={Number((transform.scale * 100).toFixed(2))}
                    onChange={(event) =>
                      numericTransform("scale", event.target.value)
                    }
                  />
                  <span>%</span>
                </div>
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={transform.autoOrient}
                  onChange={(event) =>
                    setTransform((current) => ({
                      ...current,
                      autoOrient: event.target.checked,
                    }))
                  }
                />
                Auto orient<span className="muted">during slicing</span>
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={transform.autoArrange}
                  onChange={(event) =>
                    setTransform((current) => ({
                      ...current,
                      autoArrange: event.target.checked,
                    }))
                  }
                />
                Auto arrange
              </label>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={transform.ensureOnBed}
                  onChange={(event) =>
                    setTransform((current) => ({
                      ...current,
                      ensureOnBed: event.target.checked,
                    }))
                  }
                />
                Ensure on bed
              </label>
            </fieldset>
          </section>

          <section className="override-settings">
            <label className="check-field override-toggle">
              <input
                type="checkbox"
                checked={customSettings}
                onChange={(event) => setCustomSettings(event.target.checked)}
                disabled={submitting || activeJob}
              />
              Custom print settings
            </label>
            {customSettings && (
              <fieldset disabled={submitting || activeJob}>
                <legend className="visually-hidden">Print overrides</legend>
                <div className="override-grid">
                  <label className="field">
                    Layer height
                    <div className="unit-input">
                      <input
                        aria-label="Layer height"
                        type="number"
                        min="0.06"
                        max="0.4"
                        step="0.01"
                        placeholder="Use preset"
                        value={overrides.layerHeight ?? ""}
                        onChange={(event) =>
                          setOverrides((current) => ({
                            ...current,
                            layerHeight:
                              event.target.value === ""
                                ? undefined
                                : Number(event.target.value),
                          }))
                        }
                      />
                      <span>mm</span>
                    </div>
                  </label>
                  <label className="field">
                    Wall count
                    <input
                      aria-label="Wall count"
                      type="number"
                      min="1"
                      max="20"
                      step="1"
                      placeholder="Use preset"
                      value={overrides.wallCount ?? ""}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          wallCount:
                            event.target.value === ""
                              ? undefined
                              : Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  Infill
                  <div className="unit-input">
                    <input
                      aria-label="Infill percentage"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      placeholder="Use preset"
                      value={overrides.infillPercent ?? ""}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          infillPercent:
                            event.target.value === ""
                              ? undefined
                              : Number(event.target.value),
                        }))
                      }
                    />
                    <span>%</span>
                  </div>
                </label>
                <div className="override-grid boolean-overrides">
                  <label className="field">
                    Supports
                    <select
                      aria-label="Supports"
                      value={
                        overrides.supports === undefined
                          ? "preset"
                          : String(overrides.supports)
                      }
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          supports:
                            event.target.value === "preset"
                              ? undefined
                              : event.target.value === "true",
                        }))
                      }
                    >
                      <option value="preset">Use preset</option>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </label>
                  <label className="field">
                    Brim
                    <select
                      aria-label="Brim"
                      value={
                        overrides.brim === undefined
                          ? "preset"
                          : String(overrides.brim)
                      }
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          brim:
                            event.target.value === "preset"
                              ? undefined
                              : event.target.value === "true",
                        }))
                      }
                    >
                      <option value="preset">Use preset</option>
                      <option value="true">Enabled</option>
                      <option value="false">Disabled</option>
                    </select>
                  </label>
                </div>
              </fieldset>
            )}
          </section>
        </aside>
      </main>

      <footer className="slice-bar">
        <div>
          <strong>{file ? file.name : "Ready when you are"}</strong>
          <span>
            {submitting
              ? "Uploading model to your server…"
              : activeJob
                ? statusLabels[job!.status]
                : file
                  ? "Slice on your server, download to any device."
                  : "Add a model to start slicing."}
          </span>
        </div>
        <button
          className="button primary slice-button"
          onClick={() => void slice()}
          disabled={!ready}
        >
          <span aria-hidden="true">≋</span>
          {submitting ? "Uploading…" : "Slice"}
        </button>
      </footer>
      {uploadError && (
        <p className="workspace-error notice error" role="alert">
          {uploadError}
        </p>
      )}
      {job && (
        <div className="result-area" ref={resultRef}>
          {streamDisconnected && !jobIsTerminal && (
            <p className="notice warning" role="status">
              Live updates disconnected. Reconnecting automatically…
            </p>
          )}
          <JobResult
            job={job}
            logs={logs}
            onCancel={() => void removeJob(job)}
          />
        </div>
      )}
      <div className="app-footnote">
        <span>Built for your home LAN</span>
        <span>
          {about?.orcaVersion
            ? `OrcaSlicer ${about.orcaVersion}`
            : "OrcaSlicer headless"}
        </span>
      </div>

      {dragging && (
        <div className="drop-overlay">
          <div>
            <span aria-hidden="true">+</span>
            <h2>Drop your model here</h2>
            <p>{formats.map((format) => format.toUpperCase()).join(" / ")}</p>
          </div>
        </div>
      )}

      {panel === "about" && (
        <Modal title="About Orca Web" onClose={() => setPanel(null)}>
          <p className="modal-intro">
            A native browser workspace for OrcaSlicer, running on your home
            server.
          </p>
          <dl className="about-details">
            <div>
              <dt>Orca Web</dt>
              <dd>{about?.appVersion ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>OrcaSlicer</dt>
              <dd>{about?.orcaVersion ?? "Unavailable"}</dd>
            </div>
            <div>
              <dt>Server status</dt>
              <dd>
                {about?.slicerAvailable
                  ? "Ready to slice"
                  : "Slicer unavailable"}
              </dd>
            </div>
            <div>
              <dt>Supported models</dt>
              <dd>
                {formats.length
                  ? formats.map((format) => format.toUpperCase()).join(", ")
                  : "Unavailable"}
              </dd>
            </div>
            <div>
              <dt>Upload limit</dt>
              <dd>{about ? `${about.maxUploadMb} MB` : "Unavailable"}</dd>
            </div>
          </dl>
          <p className="muted">
            Your browser displays the model. OrcaSlicer generates the toolpaths
            using its bundled printer, process, and filament profiles. Completed
            jobs stay on your server until you delete them.
          </p>
        </Modal>
      )}

      {panel === "jobs" && (
        <Modal title="Jobs" wide onClose={() => setPanel(null)}>
          <div className="jobs-toolbar">
            <p className="muted">Slicing history on this server</p>
            <button
              className="text-button"
              disabled={jobsLoading}
              onClick={() => void refreshJobs()}
            >
              Refresh
            </button>
          </div>
          {jobsError && (
            <p className="notice error" role="alert">
              {jobsError}
            </p>
          )}
          {jobsLoading && (
            <p className="muted" role="status">
              Loading jobs…
            </p>
          )}
          {!jobsLoading && !jobs.length && !jobsError && (
            <div className="jobs-empty">
              <span aria-hidden="true">≋</span>
              <p>No jobs yet. Add a model and slice your first print.</p>
            </div>
          )}
          <ul className="job-list">
            {jobs.map((item) => (
              <li key={item.id}>
                <button
                  className="job-open"
                  onClick={() => {
                    setJob(item);
                    setLogs([]);
                    setPanel(null);
                    window.setTimeout(
                      () =>
                        resultRef.current?.scrollIntoView({
                          behavior: "smooth",
                          block: "nearest",
                        }),
                      100,
                    );
                  }}
                >
                  <strong>{item.filename}</strong>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </button>
                <span className={`job-status status-${item.status}`}>
                  {statusLabels[item.status]}
                </span>
                {item.status === "succeeded" && item.result?.files[0] && (
                  <a
                    className="job-download"
                    href={item.result.files[0].downloadUrl}
                    download
                    aria-label={`Download G-code for ${item.filename}`}
                  >
                    ↓
                  </a>
                )}
                <button
                  className="text-button danger"
                  disabled={actionBusy === item.id}
                  onClick={() => void removeJob(item)}
                >
                  {terminalStatuses.includes(item.status) ? "Delete" : "Cancel"}
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}
