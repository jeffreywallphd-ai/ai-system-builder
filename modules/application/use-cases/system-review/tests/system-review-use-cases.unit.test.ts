import { describe, expect, it } from "../../../../testing/node-test";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import type { SystemReviewAuditEntry } from "../../../../contracts/system-review";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  createSystemReviewArtifactRef,
  ReleaseBoundSystemReviewUseCases,
} from "../system-review-use-cases";

const workspaceId = createWorkspaceId("workspace-review");
const otherWorkspaceId = createWorkspaceId("workspace-other");
const releaseId = normalizeSystemReleaseId("release-review");
const storageKey = "workspaces/workspace-review/private/reports/data.json";
const artifactRef = createSystemReviewArtifactRef(storageKey);
const definition = {
  descriptor: {
    schemaVersion: "1.0" as const,
    targetWorkspaceId: workspaceId,
    releaseId,
    title: "Secured review",
    allowedMediaTypes: [
      "application/json",
      "image/png",
      "application/pdf",
      "text/plain",
    ],
    maximumListItems: 50,
    maximumPreviewBytes: 64,
  },
  allowedRoles: ["owner", "viewer"],
  protectedMetadataFields: ["secret"],
  unmaskRoles: ["owner"],
};

const principal = {
  actorId: "person-1",
  roles: ["viewer"],
  authenticated: true,
};

function createRuntime(
  options: {
    sizeBytes?: number;
    bytes?: Uint8Array;
    auditFailure?: boolean;
  } = {},
) {
  const audits: SystemReviewAuditEntry[] = [];
  const contentCalls: unknown[] = [];
  let auditSequence = 0;
  const item = {
    artifactId: storageKey,
    storageKey,
    artifactFamily: "structured-text" as const,
    mediaType: "application/json",
    sizeBytes: options.sizeBytes ?? 24,
    originalName: "folder/data.json",
    createdAt: "2026-07-17T00:00:00.000Z",
  };
  const runtime = new ReleaseBoundSystemReviewUseCases({
    definitions: {
      async resolve(candidateWorkspace, candidateRelease) {
        return candidateWorkspace === workspaceId &&
          candidateRelease === releaseId
          ? definition
          : undefined;
      },
    },
    artifacts: {
      async browseArtifacts(_request: any, context: any) {
        return context?.workspaceId === workspaceId
          ? { ok: true as const, value: { items: [item] } }
          : {
              ok: false as const,
              error: { code: "not-found" as const, message: "not found" },
            };
      },
      async readArtifactDetail(_request: any, context: any) {
        return context?.workspaceId === workspaceId
          ? {
              ok: true as const,
              value: {
                artifact: {
                  locator: { storageKey },
                  artifactFamily: "data" as const,
                  mediaType: "application/json",
                  sizeBytes: item.sizeBytes,
                  originalName: item.originalName,
                  createdAt: item.createdAt,
                  checksum: {
                    algorithm: "sha256" as const,
                    value: "a".repeat(64),
                  },
                  metadata: {
                    publicLabel: "Quarterly",
                    secret: "hidden",
                    storagePath: "C:/private",
                    providerPayload: "hidden",
                  },
                },
              },
            }
          : {
              ok: false as const,
              error: { code: "not-found" as const, message: "not found" },
            };
      },
    } as any,
    content: {
      async retrieveArtifactViewerMediaByStorageKey(request, context) {
        contentCalls.push({ request, context });
        return {
          ok: true as const,
          value: {
            storageKey,
            mediaType: "application/json",
            bytes:
              options.bytes ??
              new TextEncoder().encode('[{"name":"alpha","value":"=2+2"}]'),
          },
        };
      },
    },
    audit: {
      async appendAudit(entry) {
        if (options.auditFailure) throw new Error("audit down");
        audits.push(entry);
      },
      async listAudit(candidateWorkspace, candidateRelease, limit) {
        return audits
          .filter(
            (entry) =>
              entry.targetWorkspaceId === candidateWorkspace &&
              entry.releaseId === candidateRelease,
          )
          .slice(0, limit);
      },
    },
    generateAuditId: () => `audit-${++auditSequence}`,
    now: () => "2026-07-17T12:00:00.000Z",
  });
  return { runtime, audits, contentCalls };
}

describe("release-bound system-review use cases", () => {
  it("returns opaque references, masks path/provider metadata, and parses bounded JSON as an inert table", async () => {
    const { runtime, audits, contentCalls } = createRuntime();
    const browse = await runtime.browse({
      workspaceId,
      releaseId,
      principal,
      limit: 10,
    });
    expect(browse.ok).toBe(true);
    if (!browse.ok) return;
    expect(browse.value.items[0]).toEqual({
      artifactRef,
      displayName: "data.json",
      artifactFamily: "structured-text",
      mediaType: "application/json",
      sizeBytes: 24,
      createdAt: "2026-07-17T00:00:00.000Z",
    });
    expect(JSON.stringify(browse.value)).not.toContain(
      "workspace-review/private",
    );

    const detail = await runtime.detail({
      workspaceId,
      releaseId,
      principal,
      artifactRef,
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.metadata).toEqual({ publicLabel: "Quarterly" });
    expect(JSON.stringify(detail.value)).not.toMatch(
      /storagePath|providerPayload|checksum|hidden/,
    );

    const preview = await runtime.preview({
      workspaceId,
      releaseId,
      principal,
      artifactRef,
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.value.table).toEqual({
      columns: ["name", "value"],
      rows: [["alpha", "'=2+2"]],
    });
    expect(contentCalls[0]).toEqual({
      request: { storageKey, maximumBytes: 64 },
      context: { workspaceId },
    });
    expect(JSON.stringify(audits)).not.toContain(storageKey);
  });

  it("fails closed for unauthenticated, cross-workspace, oversized, malformed, and audit-unavailable paths", async () => {
    const deniedRuntime = createRuntime();
    const denied = await deniedRuntime.runtime.browse({
      workspaceId,
      releaseId,
      principal: { actorId: "anonymous", roles: [], authenticated: false },
    });
    expect(denied.ok).toBe(false);
    expect(deniedRuntime.audits[0].outcome).toBe("denied");

    const crossWorkspace = await deniedRuntime.runtime.browse({
      workspaceId: otherWorkspaceId,
      releaseId,
      principal,
    });
    expect(crossWorkspace.ok).toBe(false);

    const oversizedRuntime = createRuntime({ sizeBytes: 65 });
    const oversized = await oversizedRuntime.runtime.preview({
      workspaceId,
      releaseId,
      principal,
      artifactRef,
    });
    expect(oversized.ok && oversized.value.status).toBe("oversized");
    expect(oversizedRuntime.contentCalls).toEqual([]);

    const malformedRuntime = createRuntime({
      bytes: new TextEncoder().encode('{"broken":'),
    });
    const malformed = await malformedRuntime.runtime.preview({
      workspaceId,
      releaseId,
      principal,
      artifactRef,
    });
    expect(malformed.ok && malformed.value.status).toBe("malformed");
    if (malformed.ok)
      expect(malformed.value.message).toBe(
        "The artifact could not be safely parsed.",
      );

    const auditFailureRuntime = createRuntime({ auditFailure: true });
    const auditFailure = await auditFailureRuntime.runtime.browse({
      workspaceId,
      releaseId,
      principal,
    });
    expect(auditFailure).toEqual({
      ok: false,
      error: {
        code: "system-review.audit-unavailable",
        message: "The review audit service is unavailable.",
      },
    });
  });
});
