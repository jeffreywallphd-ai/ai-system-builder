import { describe, expect, it } from "../../../testing/node-test";
import { normalizeAssetDraftId, normalizeAssetOverrideId, normalizeAuthoredAssetId, normalizeSafeAssetEditableField, normalizeSafeAssetEditableFieldPatch, normalizeAssetAuthoringStatus, normalizeAssetOverrideStatus, normalizeCreateAssetDraftCommand, normalizeAssetOverrideRecord, tryNormalizeAuthoredAssetRecord, normalizeAssetAuthoringProvenance } from "..";

describe("asset-authoring contracts", () => {
  it("normalizes valid identifiers and rejects unsafe identifiers", () => {
    expect(normalizeAuthoredAssetId("asset_1")).toBe("asset_1");
    expect(normalizeAssetDraftId("draft-1")).toBe("draft-1");
    expect(normalizeAssetOverrideId("override-1")).toBe("override-1");
    expect(() => normalizeAuthoredAssetId(" ")).toThrow();
    expect(() => normalizeAuthoredAssetId("../a")).toThrow();
    expect(() => normalizeAuthoredAssetId("https://example.com")).toThrow();
    expect(() => normalizeAuthoredAssetId("sk-secret-key")).toThrow();
    expect(() => normalizeAuthoredAssetId("../unsafe")).toThrow(/safe non-empty trimmed identifier/);
  });

  it("supports only declared statuses", () => {
    expect(normalizeAssetAuthoringStatus("draft")).toBe("draft");
    expect(normalizeAssetOverrideStatus("active")).toBe("active");
    expect(() => normalizeAssetAuthoringStatus("syncing")).toThrow();
    expect(() => normalizeAssetOverrideStatus("propagating")).toThrow();
  });

  it("accepts safe editable fields and rejects unsafe field vocabulary", () => {
    expect(normalizeSafeAssetEditableField("display-name")).toBe("display-name");
    expect(() => normalizeSafeAssetEditableField("prompt-text")).toThrow();
    expect(() => normalizeSafeAssetEditableField("workflow-json")).toThrow();
    expect(() => normalizeSafeAssetEditableField("provider-payload")).toThrow();
    expect(() => normalizeSafeAssetEditableField("storage-path")).toThrow();
    expect(() => normalizeSafeAssetEditableField("binary-base64")).toThrow();
    expect(() => normalizeSafeAssetEditableFieldPatch({ "display-name": "  " })).toThrow();
  });

  it("requires explicit workspace ids for workspace-scoped commands", () => {
    expect(() =>
      normalizeCreateAssetDraftCommand({
        targetWorkspaceId: " ",
        draftEditableValues: { "display-name": "Draft Name" },
      }),
    ).toThrow();
  });

  it("rejects override records with system-source mutation semantics", () => {
    expect(() =>
      normalizeAssetOverrideRecord({
        overrideId: "override-1",
        targetWorkspaceId: "workspace-1",
        customizationTarget: {
          targetWorkspaceId: "workspace-1",
          sourceKind: "system-owned-asset",
          effectiveAssetReference: { kind: "asset-instance", id: "asset-1" },
        },
        baseAssetReference: { kind: "asset-instance", id: "asset-1" },
        overrideScope: "workspace-local",
        overrideValues: { "display-name": "Name" },
        status: "draft",
        provenance: { kind: "system-derived-override", operationAt: "2026-05-19T00:00:00.000Z" },
        createdAt: "2026-05-19T00:00:00.000Z",
        updatedAt: "2026-05-19T00:00:00.000Z",
      }),
    ).toThrow(/system-derived/);
  });
});


describe("asset-authoring safe normalization",()=>{
 it("returns sanitized failures",()=>{ const r=tryNormalizeAuthoredAssetRecord({} as never); expect(r.ok).toBe(false); if(!r.ok) expect(r.code).toMatch(/asset-authoring/); });
 it("rejects unsafe nested metadata",()=>{ expect(()=>normalizeSafeAssetEditableFieldPatch({"safe-metadata":{nested:{path:"/tmp/secret"}} as never})).toThrow(); });
 it("validates provenance",()=>{ expect(()=>normalizeAssetAuthoringProvenance({kind:"system-derived-override",operationAt:"2026-01-01T00:00:00.000Z"})).toThrow(); });
});
