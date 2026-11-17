import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../../security/secureFetch", () => ({secureFetch: vi.fn()}));
import { secureFetch } from "../../../security/secureFetch";
import { thinClientPageDashboardSource } from "../thinClientPageDashboardSource";
import { desktopPageDashboardSource } from "../../../../../desktop/src/renderer/features/page-dashboard/desktopPageDashboardSource";
import { loadPageDashboardMetrics } from "../../../../../../modules/ui/shared/page-dashboard/dashboardMetrics";

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks();});
it("both host pages use one bounded transport call without loading full catalogs", async () => {
  const summary = {schemaVersion: "workspace-summary-v1", workspaceId: "workspace.a", page: "models", metrics: {modelsInstalled: {status: "available", value: 5000}, modelsTrained: {status: "unavailable"}}};
  const read = vi.fn(async () => ({ok: true, value: summary}));
  vi.stubGlobal("window", {desktopApi: {readWorkspaceSummary: read}});
  vi.mocked(secureFetch).mockResolvedValue({json: async () => ({ok: true, value: summary})} as Response);
  for (const source of [desktopPageDashboardSource, thinClientPageDashboardSource]) {
    const models = vi.spyOn(source, "listModels").mockRejectedValue(new Error("No full catalog request"));
    const metrics = await loadPageDashboardMetrics("models", source, "workspace.a");
    expect(metrics.map(metric => metric.value)).toEqual([5000, "—"]);
    expect(models).not.toHaveBeenCalled();
  }
  expect(read).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledWith({workspaceId: "workspace.a", page: "models"});
  expect(secureFetch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(secureFetch).mock.calls[0]?.[0]).toBe("/api/workspaces/summary?workspaceId=workspace.a&page=models");
});
