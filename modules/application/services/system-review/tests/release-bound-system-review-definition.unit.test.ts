import { describe, expect, it } from "../../../../testing/node-test";
import {
  normalizeSystemBuildArtifactId,
  normalizeSystemReleaseId,
} from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { ReleaseBoundSystemReviewDefinitionService } from "../release-bound-system-review-definition.service";

const workspaceId = createWorkspaceId("workspace-review-release");
const releaseId = normalizeSystemReleaseId("release-review");
const descriptor = {
  artifactId: normalizeSystemBuildArtifactId("artifact-review-manifest"),
  kind: "manifest",
  digest: ("sha256:" + "b".repeat(64)) as never,
  mediaType: "application/vnd.ai-system-builder.manifest+json",
  sizeBytes: 1,
} as const;

function manifest() {
  return {
    instances: [
      {
        definitionRef: { id: "builtin.security.authentication-requirement" },
        selectedConfiguration: { required: true },
      },
      {
        definitionRef: { id: "builtin.security.artifact-read-policy" },
        selectedConfiguration: {
          allowedRoles: ["owner", "viewer"],
          allowedMediaTypes: [
            "text/plain",
            "application/json",
            "image/png",
            "application/pdf",
          ],
          maximumListItems: 50,
          maximumPreviewBytes: 65536,
        },
      },
      {
        definitionRef: { id: "builtin.security.field-mask" },
        selectedConfiguration: {
          protectedFields: ["secret"],
          visibleToRoles: ["owner"],
        },
      },
      {
        definitionRef: { id: "builtin.security.audit-event" },
        selectedConfiguration: { eventType: "system-review.artifact" },
      },
      {
        definitionRef: { id: "builtin.shell.resource-browser" },
        selectedConfiguration: {
          title: "Approved artifacts",
          resourceKind: "artifact",
        },
      },
      {
        definitionRef: { id: "builtin.shell.detail-page" },
        selectedConfiguration: { primaryResourceKind: "artifact" },
      },
      ...[
        "builtin.preview.artifact",
        "builtin.preview.text",
        "builtin.preview.table",
        "builtin.preview.raster-image",
        "builtin.preview.pdf",
        "builtin.preview.unsupported",
      ].map((id) => ({ definitionRef: { id }, selectedConfiguration: {} })),
    ],
  };
}

function release() {
  return {
    releaseId,
    targetWorkspaceId: workspaceId,
    artifacts: [descriptor],
  } as any;
}

describe("release-bound system-review definition resolver", () => {
  it("derives finite review policy only from one verified approved release manifest", async () => {
    const service = new ReleaseBoundSystemReviewDefinitionService(
      {
        async readRelease(candidateWorkspace: typeof workspaceId, candidateRelease: typeof releaseId) {
          return candidateWorkspace === workspaceId &&
            candidateRelease === releaseId
            ? release()
            : undefined;
        },
      } as any,
      {
        async readVerified() {
          return new TextEncoder().encode(JSON.stringify(manifest()));
        },
      } as any,
    );

    const resolved = await service.resolve(workspaceId, releaseId);
    expect(resolved?.descriptor).toEqual({
      schemaVersion: "1.0",
      targetWorkspaceId: workspaceId,
      releaseId,
      title: "Approved artifacts",
      allowedMediaTypes: [
        "text/plain",
        "application/json",
        "image/png",
        "application/pdf",
      ],
      maximumListItems: 50,
      maximumPreviewBytes: 65536,
    });
    expect(resolved?.allowedRoles).toEqual(["owner", "viewer"]);
    expect(resolved?.protectedMetadataFields).toEqual(["secret"]);
  });

  it("fails closed for invalid integrity evidence, duplicate security assets, or incomplete preview declarations", async () => {
    const candidates = [
      (() => {
        const value = manifest();
        value.instances.push(value.instances[0]);
        return value;
      })(),
      (() => {
        const value = manifest();
        value.instances.splice(
          value.instances.findIndex(
            (item) => item.definitionRef.id === "builtin.preview.pdf",
          ),
          1,
        );
        return value;
      })(),
      (() => {
        const value = manifest();
        (value.instances[1].selectedConfiguration as any).maximumPreviewBytes =
          9;
        return value;
      })(),
    ];
    for (const candidate of candidates) {
      const service = new ReleaseBoundSystemReviewDefinitionService(
        {
          async readRelease() {
            return release();
          },
        } as any,
        {
          async readVerified() {
            return new TextEncoder().encode(JSON.stringify(candidate));
          },
        } as any,
      );
      expect(await service.resolve(workspaceId, releaseId)).toBeUndefined();
    }
    const integrityFailure = new ReleaseBoundSystemReviewDefinitionService(
      {
        async readRelease() {
          return release();
        },
      } as any,
      {
        async readVerified() {
          throw new Error("digest mismatch");
        },
      } as any,
    );
    expect(
      await integrityFailure.resolve(workspaceId, releaseId),
    ).toBeUndefined();
  });
});
