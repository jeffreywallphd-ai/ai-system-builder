import type { BrowserContext } from "@playwright/test";

export function nativeZoomPreferences(factor: 1 | 4): {
  partition: { default_zoom_level: { x: number } };
};
export function assertNative400PercentZoom(value: {
  dpr: number; cssZoom: string; visualScale: number; outerWidth: number; innerWidth: number;
}): void;
export function launchOwnedNativeZoomContext(factor?: 1 | 4): Promise<{
  context: BrowserContext;
  close(): Promise<{ nativeExitObserved: boolean; profileRemoved: true }>;
}>;
