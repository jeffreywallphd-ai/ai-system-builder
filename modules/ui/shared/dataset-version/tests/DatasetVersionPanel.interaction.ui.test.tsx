// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatasetVersionRecord } from "../../../../contracts/dataset";
import { NotificationProvider, useNotificationCenter } from "../../notifications/NotificationProvider";
import { DatasetVersionPanel } from "../DatasetVersionPanel";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = undefined; container = undefined; });
const digest = (seed: string) => `sha256:${seed.repeat(64)}` as const;
function version(id: string, rows: number, createdAt: string): DatasetVersionRecord { return { schemaVersion: "1.0", versionId: id as never, datasetId: "support" as never, workspaceId: "workspace-a" as never, versionDigest: digest(id === "v2" ? "2" : "1"), artifacts: [{ role: "dataset", artifactKey: `data/${id}.jsonl`, digest: digest("a"), mediaType: "application/jsonl", sizeBytes: 10, rowCount: rows }], lineage: { sources: [{ sourceArtifactId: "source-1", artifactKey: "source.csv", digest: digest("b"), mediaType: "text/csv" }], recipe: { artifactKey: "recipe.json", digest: digest("c"), implementationId: "prepare", implementationVersion: "1" }, quality: { policyId: "recommended", policyVersion: "1", policyFingerprint: digest("d"), reportFingerprint: digest("e") } }, documentation: { name: "Support data", summary: "Summary", intendedUses: ["Training"], limitations: ["Review"] }, totalRows: rows, createdAt, createdBy: "person-1" }; }
function button(label: string) { const found = [...container!.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label); if (!found) throw new Error(`Missing ${label}`); return found; }
function setInput(input: HTMLInputElement, value: string) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }
function NotificationMessages() { const notifications = useNotificationCenter(); useEffect(() => notifications.setActiveWorkspaceId("workspace-a"), [notifications.setActiveWorkspaceId]); return <output data-testid="notifications">{notifications.records.map((record) => record.message).join("\n")}</output>; }

describe("DatasetVersionPanel", () => {
  it("shows plain changes, reuses verified setup, defaults publishing to private, and requires public confirmation", async () => {
    const reuse = vi.fn();
    const publish = vi.fn(async (input: any) => ({ schemaVersion: "1.0", publicationId: "publication-1", versionId: input.versionId, workspaceId: input.workspaceId, provider: "hugging-face", repositoryId: input.repositoryId, revision: "abc1234", visibility: input.visibility, publishedAt: "2026-07-29T12:00:00.000Z", publishedBy: "person-1" }));
    const service = { list: vi.fn(async () => [version("v2", 14, "2026-07-29T12:00:00.000Z"), version("v1", 10, "2026-07-28T12:00:00.000Z")]), compare: vi.fn(async () => ({ fromVersionId: "v1", toVersionId: "v2", identical: false, rowDelta: 4, sources: { added: 0, removed: 0, changed: 1 }, changedArtifactRoles: ["dataset"], recipeChanged: false, qualityPolicyChanged: false, documentationChanged: false } as any)), reproduce: vi.fn(async () => ({ versionId: "v2", sourceArtifactIds: ["source-1"], recipeSnapshot: { split: { seed: 42 } }, lineage: version("v2", 14, "2026-07-29T12:00:00.000Z").lineage })), publish };
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => root?.render(<NotificationProvider><DatasetVersionPanel workspaceId="workspace-a" currentVersionId="v2" datasetId="support" service={service as any} onReuse={reuse} /><NotificationMessages /></NotificationProvider>));
    await vi.waitFor(() => expect(container?.textContent).toContain("4 more rows"));
    expect(container?.textContent).toContain("1 source change");
    const advanced = [...container!.querySelectorAll("details")].find((item) => item.querySelector("summary")?.textContent === "Advanced details")!;
    expect(advanced.open).toBe(false);
    expect(advanced.textContent).toContain(digest("2"));
    await act(async () => button("Use this setup again").click());
    expect(reuse).toHaveBeenCalledWith(expect.objectContaining({ sourceArtifactIds: ["source-1"] }));
    const access = container.querySelectorAll<HTMLSelectElement>("select")[1];
    expect(access.value).toBe("private");
    await act(async () => { access.value = "public"; access.dispatchEvent(new Event("change", { bubbles: true })); });
    const repository = container.querySelector<HTMLInputElement>('input[placeholder="owner/dataset-name"]')!;
    await act(async () => setInput(repository, "owner/support"));
    await act(async () => button("Publish publicly").click());
    expect(publish).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(container.querySelector('[data-testid="notifications"]')?.textContent).toContain("Confirm that this dataset may be publicly accessible."));
  });
});
