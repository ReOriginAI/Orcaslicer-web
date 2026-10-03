import type {
  AboutResponse,
  ApiError,
  CreateJobResponse,
  Job,
  PresetCatalog,
  SliceOptions,
} from "@orca-web/shared";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      message = ((await response.json()) as ApiError).error || message;
    } catch {
      /* Use HTTP error when no JSON is available. */
    }
    throw new Error(message);
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}

export const api = {
  about: (signal?: AbortSignal) => request<AboutResponse>("/about", { signal }),
  presets: (signal?: AbortSignal) =>
    request<PresetCatalog>("/presets", { signal }),
  jobs: (signal?: AbortSignal) => request<Job[]>("/jobs", { signal }),
  job: (id: string, signal?: AbortSignal) =>
    request<Job>(`/jobs/${encodeURIComponent(id)}`, { signal }),
  removeJob: (id: string) =>
    request<{ deleted?: boolean; job?: Job }>(
      `/jobs/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  createJob: (file: File, options: SliceOptions) => {
    const body = new FormData();
    body.append("options", JSON.stringify(options));
    body.append("file", file);
    return request<CreateJobResponse>("/jobs", { method: "POST", body });
  },
};

export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "An unexpected error occurred.";
