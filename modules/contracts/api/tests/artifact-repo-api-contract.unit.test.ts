import { describe, expect, it } from "../../../testing/node-test";

import {
  API_ARTIFACT_REPO_HAS_OPERATION,
  API_ARTIFACT_REPO_STORE_OPERATION,
  createApiArtifactRepoHasRequest,
  createApiArtifactRepoHasSuccessResponse,
  createApiArtifactRepoStoreRequest,
  createApiArtifactRepoStoreSuccessResponse,
} from "..";

describe("artifact-repo api contracts", () => {
  it("keeps artifact-repo operations explicit and provider-neutral", () => {
    expect(API_ARTIFACT_REPO_HAS_OPERATION).toBe("artifact.repo.has");
    expect(API_ARTIFACT_REPO_STORE_OPERATION).toBe("artifact.repo.store");
  });

  it("normalizes request payloads without embedding transport/http fields", () => {
    const hasRequest = createApiArtifactRepoHasRequest({
      target: {
        provider: " huggingface ",
        repository: " datasets/openai/demo ",
        revision: " main ",
        path: " artifacts/a.bin ",
      },
      boundary: {
        host: "server",
        source: " thin-client.repo-check ",
      },
    });

    const storeRequest = createApiArtifactRepoStoreRequest({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "artifacts/a.bin",
      },
      contentBase64: "AQID",
      boundary: {
        host: "server",
        source: " thin-client.repo-store ",
      },
    });

    expect(hasRequest.payload.target).toEqual({
      provider: "huggingface",
      repository: "datasets/openai/demo",
      revision: "main",
      path: "artifacts/a.bin",
    });
    expect(storeRequest.payload.boundary.source).toBe("thin-client.repo-store");
    expect("status" in hasRequest).toBe(false);
  });

  it("maps success responses through shared transport envelopes", () => {
    const hasResponse = createApiArtifactRepoHasSuccessResponse({ exists: true });
    const storeResponse = createApiArtifactRepoStoreSuccessResponse({
      descriptor: {
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "artifacts/a.bin",
        },
        sizeBytes: 3,
      },
    });

    expect(hasResponse).toMatchObject({
      ok: true,
      operation: "artifact.repo.has",
      value: { exists: true },
    });
    expect(storeResponse).toMatchObject({
      ok: true,
      operation: "artifact.repo.store",
      value: {
        descriptor: {
          target: {
            provider: "huggingface",
          },
        },
      },
    });
  });
});
