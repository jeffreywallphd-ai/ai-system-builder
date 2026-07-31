import type { SystemRuntimePreloadApi } from "../system-runtime-preload/systemRuntimePreloadApi";

declare global {
  interface Window {
    readonly systemRuntime: SystemRuntimePreloadApi;
  }
}

export {};
