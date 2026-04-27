import { describe, expect, it, testDouble } from "../../../testing/node-test";

import { createHasArtifactInRepoSuccessResult } from "../../../contracts/storage";
import { createContractError } from "../../../contracts/shared";
import type { ArtifactCatalogAppendPort } from "../../ports/artifact-catalog";
import type { LoggingPort } from "../../ports/logging";
import type {
  ArtifactRepoStoragePort,
  ArtifactStorageBindingPort,
} from "../../ports/storage";
import { RegisterArtifactFromRepoUseCase } from "../register-artifact-from-repo.use-case";
import { ArtifactId, type ArtifactIdFactory } from "../../../domain/artifact";

describe("RegisterArtifactFromRepoUseCase", () => {
  it("verifies remote target and writes imported-source binding + catalog record", async () => {
    const log = testDouble.fn();
    const logging: LoggingPort = { log };
    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => createHasArtifactInRepoSuccessResult(true)),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(),
    } as unknown as ArtifactRepoStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      readArtifactStorageBindings: testDouble.fn(),
      upsertArtifactStorageBinding: testDouble.fn(async (request) => ({
        ok: true,
        value: { binding: request.binding },
      })),
    } as unknown as ArtifactStorageBindingPort;

    const artifactCatalogAppend: ArtifactCatalogAppendPort = {
      appendArtifactCatalogRecord: testDouble.fn(async (request) => ({
        ok: true,
        value: { storageKey: request.record.storageKey },
      })),
    };

    const useCase = new RegisterArtifactFromRepoUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      artifactCatalogAppend,
      logging,
      now: () => "2026-04-17T00:00:00.000Z",
      createArtifactId: () => ArtifactId.from("artifacts/20260417000000-import001"),
    });

    const result = await useCase.execute({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/a.png",
      },
      artifactFamily: "image",
      mediaType: "image/png",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected register from repo success.");
    }

    expect(result.value.artifactId).toBe("artifacts/20260417000000-import001");
    const upsertCall = (artifactBindingStorage.upsertArtifactStorageBinding as ReturnType<typeof testDouble.fn>).mock.calls[0]?.[0];
    const appendCall = (artifactCatalogAppend.appendArtifactCatalogRecord as ReturnType<typeof testDouble.fn>).mock.calls[0]?.[0];
    expect(upsertCall).toMatchObject({
      binding: {
        artifactId: "artifacts/20260417000000-import001",
        role: "imported-source",
      },
    });
    expect(appendCall).toMatchObject({
      record: {
        storageKey: "artifacts/20260417000000-import001",
        artifactFamily: "image",
      },
    });
    const logCalls = (log as ReturnType<typeof testDouble.fn>).mock.calls.map((call) => call[0]);
    expect(logCalls.some((entry) => entry?.event === "application.huggingface.file-registration.started")).toBe(true);
    expect(logCalls.some((entry) => entry?.event === "application.huggingface.file-registration.succeeded")).toBe(true);
  });

  it("uses artifactIdFactory seam for system-owned id generation", async () => {
    const logging: LoggingPort = { log: testDouble.fn() };
    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => createHasArtifactInRepoSuccessResult(true)),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(),
    } as unknown as ArtifactRepoStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      readArtifactStorageBindings: testDouble.fn(),
      upsertArtifactStorageBinding: testDouble.fn(async (request) => ({
        ok: true,
        value: { binding: request.binding },
      })),
    } as unknown as ArtifactStorageBindingPort;

    const artifactCatalogAppend: ArtifactCatalogAppendPort = {
      appendArtifactCatalogRecord: testDouble.fn(async (request) => ({
        ok: true,
        value: { storageKey: request.record.storageKey },
      })),
    };
    const artifactIdFactory: ArtifactIdFactory = {
      createArtifactId: testDouble.fn(() => ArtifactId.from("artifacts/20260418000000-factory001")),
    };

    const useCase = new RegisterArtifactFromRepoUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      artifactCatalogAppend,
      logging,
      now: () => "2026-04-17T00:00:00.000Z",
      artifactIdFactory,
    });

    const result = await useCase.execute({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/a.png",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected register from repo success.");
    }
    expect(artifactIdFactory.createArtifactId).toHaveBeenCalledTimes(1);
    expect(result.value.artifactId).toBe("artifacts/20260418000000-factory001");
    const appendCall = (artifactCatalogAppend.appendArtifactCatalogRecord as ReturnType<typeof testDouble.fn>).mock.calls[0]?.[0];
    expect(appendCall).toMatchObject({
      record: {
        artifactFamily: "binary",
      },
    });
  });

  it("derives catalog artifactFamily from media type family when artifactFamily is omitted", async () => {
    const logging: LoggingPort = { log: testDouble.fn() };
    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => createHasArtifactInRepoSuccessResult(true)),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(),
    } as unknown as ArtifactRepoStoragePort;
    const artifactBindingStorage: ArtifactStorageBindingPort = {
      readArtifactStorageBindings: testDouble.fn(),
      upsertArtifactStorageBinding: testDouble.fn(async (request) => ({
        ok: true,
        value: { binding: request.binding },
      })),
    } as unknown as ArtifactStorageBindingPort;
    const artifactCatalogAppend: ArtifactCatalogAppendPort = {
      appendArtifactCatalogRecord: testDouble.fn(async (request) => ({
        ok: true,
        value: { storageKey: request.record.storageKey },
      })),
    };

    const useCase = new RegisterArtifactFromRepoUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      artifactCatalogAppend,
      logging,
      createArtifactId: () => ArtifactId.from("artifacts/20260418000000-factory002"),
    });

    const result = await useCase.execute({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "data/train.parquet",
      },
      mediaType: "application/x-parquet",
    });

    expect(result.ok).toBe(true);
    const appendCall = (artifactCatalogAppend.appendArtifactCatalogRecord as ReturnType<typeof testDouble.fn>).mock.calls[0]?.[0];
    expect(appendCall).toMatchObject({
      record: {
        artifactFamily: "tabular",
      },
    });
  });

  it("returns explicit register/import auth guidance when repository access is unavailable", async () => {
    const log = testDouble.fn();
    const logging: LoggingPort = { log };
    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => ({
        ok: false as const,
        error: createContractError("unavailable", "Hugging Face hasArtifactInRepo requires an access token for this repository. No token is configured."),
      })),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(),
    } as unknown as ArtifactRepoStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      readArtifactStorageBindings: testDouble.fn(),
      upsertArtifactStorageBinding: testDouble.fn(),
    } as unknown as ArtifactStorageBindingPort;
    const artifactCatalogAppend: ArtifactCatalogAppendPort = {
      appendArtifactCatalogRecord: testDouble.fn(),
    };

    const useCase = new RegisterArtifactFromRepoUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      artifactCatalogAppend,
      logging,
    });

    const result = await useCase.execute({
      target: {
        provider: "huggingface",
        repository: "openai/private-demo",
        path: "images/a.png",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unavailable failure.");
    }
    expect(result.error.code).toBe("unavailable");
    expect(result.error.message).toContain("register/import");
    const logCalls = (log as ReturnType<typeof testDouble.fn>).mock.calls.map((call) => call[0]);
    expect(logCalls.some((entry) => entry?.event === "application.huggingface.file-registration.failed")).toBe(true);
  });
});
