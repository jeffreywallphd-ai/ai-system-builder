import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../../security/secureFetch", () => ({ secureFetch: vi.fn() }));
vi.mock("../../../security/apiErrorEnvelope", () => ({ parseApiEnvelope: (v: unknown) => v }));
import { secureFetch } from "../../../security/secureFetch";
import { createThinClientAssetCompositionClient } from "../api/thinClientAssetCompositionClient";
import { createDesktopAssetCompositionClient } from "../../../../../desktop/src/renderer/features/asset-composition/api/desktopAssetCompositionClient";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("both host clients preserve the owning relationship command contract", async () => {
  const command = { targetWorkspaceId: "workspace.a", planId: "plan.a", sourceNodeId: "node.a", targetNodeId: "node.b", relationshipKind: "depends-on" };
  const ipc = vi.fn(async () => ({ ok: true, value: command }));
  vi.stubGlobal("window", { desktopApi: { connectAssetCompositionNodes: ipc } });
  expect((await createDesktopAssetCompositionClient().connectNodes(command)).ok).toBe(true);
  expect(ipc).toHaveBeenCalledWith(command);
  vi.mocked(secureFetch).mockResolvedValue({ json: async () => ({ ok: true, value: command }) } as Response);
  expect((await createThinClientAssetCompositionClient().connectNodes(command)).ok).toBe(true);
  const [url, options] = vi.mocked(secureFetch).mock.calls[0]!;
  expect(url).toBe("/api/asset-composition/workspaces/workspace.a/plans/plan.a/relationships");
  expect(JSON.parse(options!.body as string)).toEqual(command);
});
