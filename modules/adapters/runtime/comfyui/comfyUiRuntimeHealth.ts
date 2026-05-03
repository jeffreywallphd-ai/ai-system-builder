export type ComfyUiRuntimeStatus = "starting" | "ready" | "unhealthy" | "stopped";

export interface ComfyUiRuntimeHealth {
  status: ComfyUiRuntimeStatus;
  url: string;
  port: number;
  lastCheckAt: number;
}
