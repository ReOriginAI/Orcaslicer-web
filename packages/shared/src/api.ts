export interface AboutResponse {
  appVersion: string; orcaVersion: string | null; slicerAvailable: boolean;
  supportedFormats: string[]; maxUploadMb: number; error?: string;
}
export interface HealthResponse { status: 'ok'; slicerAvailable: boolean }
export interface ApiError { error: string }
