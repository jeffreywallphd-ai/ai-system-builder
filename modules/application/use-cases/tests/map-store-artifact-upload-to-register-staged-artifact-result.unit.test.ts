import { describe, expect, it } from "../../../testing/node-test";

import { createContractError } from "../../../contracts/shared";
import { mapStoreArtifactUploadToRegisterStagedArtifactResult } from "../artifact-upload/mapStoreArtifactUploadToRegisterStagedArtifactResult";

describe("mapStoreArtifactUploadToRegisterStagedArtifactResult", () => {
  it("maps staged-artifact descriptor success into a register-staged-artifact success result", () => {
    const result = mapStoreArtifactUploadToRegisterStagedArtifactResult(
      {
        ok: true,
        descriptor: {
          key: " uploads/cat.png ",
          mediaType: "image/png",
          sizeBytes: 4,
        },
        sourceKind: "upload",
        originalName: " cat.png ",
      },
      {
        requestId: "req-map-1",
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        sourceKind: "upload",
        originalName: "cat.png",
        storage: {
          key: "uploads/cat.png",
          mediaType: "image/png",
          sizeBytes: 4,
        },
      },
      requestId: "req-map-1",
      correlationId: undefined,
    });
  });

  it("maps contract failures into register-staged-artifact failure results", () => {
    const result = mapStoreArtifactUploadToRegisterStagedArtifactResult(
      {
        ok: false,
        error: createContractError("validation", "bytes must not be empty."),
      },
      {
        requestId: "req-map-2",
      },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        message: "bytes must not be empty.",
        details: undefined,
        requestId: undefined,
        correlationId: undefined,
      },
      requestId: "req-map-2",
      correlationId: undefined,
    });
  });
});
