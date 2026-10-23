// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PageDashboard } from "../PageDashboard";
import type { PageDashboardDataSource } from "../dashboardMetrics";

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(() => {act(() => root?.unmount()); container?.remove(); root = undefined;});

const source: PageDashboardDataSource = {
  async listSystems() {return [{systemId: "one"}, {systemId: "two"}];},
  async listReleases() {return [{systemId: "one", approvedAt: "2026-01-01", createdAt: "2026-01-01", assetCount: 3}];},
  async listDatasetIds() {return [];}, async listArtifacts() {return [];}, async listModels() {return [];},
  async listCustomAssetIds() {return ["copy"];}, async readSettingsDefaults() {return {runtimeDevice: "cpu", globalModel: "none"};},
};

describe("ready page summary semantics", () => {
  for (const [kind, detail] of [["assets", "Across latest published system builds"], ["systems", "1 published · 1 unpublished"]] as const) {
    it(`associates the ${kind} metric detail with its description after real loading`, async () => {
      container = document.createElement("div"); document.body.append(container); root = createRoot(container);
      await act(async () => root!.render(<PageDashboard kind={kind} source={source} workspaceId="synthetic-workspace" />));
      const description = container.querySelector(".page-dashboard__detail");
      expect(description?.textContent).toBe(detail);
      expect(description?.parentElement?.tagName).toBe("DD");
      expect(description?.parentElement?.textContent).toContain(kind === "assets" ? "3" : "2");
      const groups = container.querySelectorAll("dl > div");
      expect(groups.length).toBeGreaterThan(0);
      for (const group of groups) {
        expect([...group.children].map(child => child.tagName)).toEqual(["DT", "DD"]);
      }
      expect(container.querySelector("[aria-busy=true]")).toBeNull();
    });
  }
});
