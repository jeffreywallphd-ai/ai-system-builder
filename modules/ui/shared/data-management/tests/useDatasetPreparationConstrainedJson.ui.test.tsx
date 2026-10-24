import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { DatasetPreparationConstrainedJsonResolutionInput } from "../../../../contracts/runtime";
import { useDatasetPreparationConstrainedJson } from "../useDatasetPreparationConstrainedJson";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const now = "2026-10-23T12:00:00.000Z";
const gib = 1024 ** 3;
const sufficient = (): DatasetPreparationConstrainedJsonResolutionInput => ({ selectedDevice: "cpu", estimatedModelBytes: 3 * gib, now,
  capacity: { schemaVersion: "1", capturedAt: now, decoderAvailable: true, schemaSupported: true,
    logicalProcessorCount: 16, totalSystemMemoryBytes: 16 * gib, availableSystemMemoryBytes: 8 * gib } });

describe("stable initial checked-output selection", () => {
  let root: Root | undefined;
  let element: HTMLDivElement;
  let result: ReturnType<typeof useDatasetPreparationConstrainedJson>;
  function Probe({ input, selection }: { input: DatasetPreparationConstrainedJsonResolutionInput; selection: string }) {
    result = useDatasetPreparationConstrainedJson(selection, input);
    return <input aria-label="checked mode" type="checkbox" checked={result.resolution.enabled} readOnly />;
  }
  const render = async (input: DatasetPreparationConstrainedJsonResolutionInput, selection = "workspace-a/model-a/cpu") => {
    if (!root) { element = document.createElement("div"); document.body.appendChild(element); root = createRoot(element); }
    await act(async () => { root!.render(<Probe input={input} selection={selection} />); });
    return result;
  };
  afterEach(async () => { await act(async () => root?.unmount()); root = undefined; element?.remove(); });

  it("holds the first sufficient CPU recommendation across live utilization changes", async () => {
    const input = sufficient();
    expect((await render(input)).resolution.enabled).toBe(true);
    expect((await render({ ...input, capacity: { ...input.capacity!, availableSystemMemoryBytes: gib } })).resolution.enabled).toBe(true);
    expect(result.available).toBe(true); // A recommendation never replaces live memory admission.
  });
  it("holds a constrained CPU default until a different selection is made", async () => {
    const input = sufficient(); input.capacity!.availableSystemMemoryBytes = gib;
    expect((await render(input)).resolution.enabled).toBe(false);
    expect((await render(sufficient())).resolution.enabled).toBe(false);
    expect((await render(sufficient(), "workspace-a/model-b/cpu")).resolution.enabled).toBe(true);
  });
  it("starts checked for a sufficient synthetic accelerator profile", async () => {
    const input = sufficient(); input.selectedDevice = "cuda"; input.capacity!.totalAcceleratorMemoryBytes = 8 * gib;
    expect((await render(input, "workspace-a/model-a/cuda")).resolution.recommendationReason).toBe("recommended-cuda");
    expect(result.resolution.enabled).toBe(true);
  });
  it("keeps unknown models unchecked without removing an explicit checked choice", async () => {
    const input = sufficient(); delete input.estimatedModelBytes;
    expect((await render(input)).resolution.enabled).toBe(false);
    expect((await render({ ...input, preference: true })).resolution.enabled).toBe(true);
    expect(result.available).toBe(true);
  });
  it("waits for the first fresh ready snapshot instead of freezing startup unavailability", async () => {
    const input = sufficient(); input.capacity!.decoderAvailable = false;
    expect((await render(input)).resolution.enabled).toBe(false);
    expect(result.available).toBe(false);
    expect((await render(sufficient())).resolution.enabled).toBe(true);
  });
  it.each(["missing", "stale", "unsupported"])("retains checked intent but removes availability for %s facts", async reason => {
    const input = sufficient(); await render(input);
    if (reason === "missing") delete input.capacity;
    if (reason === "stale") input.capacity!.capturedAt = "2026-10-23T11:00:00.000Z";
    if (reason === "unsupported") input.capacity!.schemaSupported = false;
    const observed = await render({ ...input, preference: true });
    expect(observed.resolution.enabled).toBe(true);
    expect(observed.available).toBe(false);
  });
  it("keeps explicit false across new profiles, and does not reuse another workspace's default", async () => {
    await render(sufficient());
    expect((await render({ ...sufficient(), preference: false }, "workspace-a/model-b/cuda")).resolution.enabled).toBe(false);
    const input = sufficient(); input.capacity!.availableSystemMemoryBytes = gib;
    expect((await render(input, "workspace-b/model-a/cpu")).resolution.enabled).toBe(false);
  });
});
