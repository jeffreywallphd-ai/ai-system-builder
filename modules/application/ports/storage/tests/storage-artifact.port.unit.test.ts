import { describe, expect, expectTypeOf, it } from "../../../../testing/node-test";

import {
  createDeleteArtifactRequest,
  createDeleteArtifactSuccessResult,
  createHasArtifactRequest,
  createHasArtifactSuccessResult,
  createRetrieveArtifactRequest,
  createRetrieveArtifactSuccessResult,
  createStoreArtifactRequest,
  createStoreArtifactSuccessResult,
  type DeleteArtifactRequest,
  type DeleteArtifactResult,
  type HasArtifactRequest,
  type HasArtifactResult,
  type RetrieveArtifactRequest,
  type RetrieveArtifactResult,
  type StoreArtifactRequest,
  type StoreArtifactResult,
} from "../../../../contracts/storage";
import type { ApplicationRequestContext } from "../../application-request-context";

import type { ArtifactStoragePort } from "../storage-artifact.port";

function asRetrievedContent<TContent>(bytes: Uint8Array): TContent {
  return bytes as unknown as TContent;
}

describe("ArtifactStoragePort", () => {
  it("keeps a key-based artifact seam with store/retrieve/has/delete operations", () => {
    expectTypeOf<keyof ArtifactStoragePort>().toEqualTypeOf<
      "storeArtifact" | "retrieveArtifact" | "hasArtifact" | "deleteArtifact"
    >();

    expectTypeOf<Parameters<ArtifactStoragePort["storeArtifact"]>[0]>().toExtend<
      StoreArtifactRequest<unknown>
    >();
    expectTypeOf<Parameters<ArtifactStoragePort["retrieveArtifact"]>[0]>().toExtend<
      RetrieveArtifactRequest
    >();
    expectTypeOf<Parameters<ArtifactStoragePort["storeArtifact"]>[1]>().toExtend<
      ApplicationRequestContext | undefined
    >();
    expectTypeOf<Parameters<ArtifactStoragePort["hasArtifact"]>[0]>().toExtend<
      HasArtifactRequest
    >();
    expectTypeOf<Parameters<ArtifactStoragePort["deleteArtifact"]>[0]>().toExtend<
      DeleteArtifactRequest
    >();

    expectTypeOf<Awaited<ReturnType<ArtifactStoragePort["storeArtifact"]>>>().toEqualTypeOf<
      StoreArtifactResult
    >();
    expectTypeOf<
      Awaited<ReturnType<ArtifactStoragePort["retrieveArtifact"]>>
    >().toEqualTypeOf<RetrieveArtifactResult<unknown>>();
    expectTypeOf<Awaited<ReturnType<ArtifactStoragePort["hasArtifact"]>>>().toEqualTypeOf<
      HasArtifactResult
    >();
    expectTypeOf<Awaited<ReturnType<ArtifactStoragePort["deleteArtifact"]>>>().toEqualTypeOf<
      DeleteArtifactResult
    >();
  });

  it("passes key-based artifact requests through all storage operations", async () => {
    const context: ApplicationRequestContext = {
      requestId: "req-storage-1",
      correlationId: "corr-storage-1",
    };

    const storeRequest = createStoreArtifactRequest(new Uint8Array([1, 2, 3]), {
      descriptor: {
        key: "workspace/ws-42/artifacts/output.json",
        mediaType: "application/json",
      },
    });
    const retrieveRequest = createRetrieveArtifactRequest("workspace/ws-42/artifacts/output.json");
    const hasRequest = createHasArtifactRequest("workspace/ws-42/artifacts/output.json");
    const deleteRequest = createDeleteArtifactRequest("workspace/ws-42/artifacts/output.json");

    const storeArtifactCalls: StoreArtifactRequest<unknown>[] = [];
    const retrieveArtifactCalls: RetrieveArtifactRequest[] = [];
    const hasArtifactCalls: HasArtifactRequest[] = [];
    const deleteArtifactCalls: DeleteArtifactRequest[] = [];
    const storeContexts: Array<ApplicationRequestContext | undefined> = [];
    const retrieveContexts: Array<ApplicationRequestContext | undefined> = [];
    const hasContexts: Array<ApplicationRequestContext | undefined> = [];
    const deleteContexts: Array<ApplicationRequestContext | undefined> = [];

    const storeArtifact: ArtifactStoragePort["storeArtifact"] = async (incomingRequest, incomingContext) => {
      storeArtifactCalls.push(incomingRequest);
      storeContexts.push(incomingContext);
      return createStoreArtifactSuccessResult(
        {
          key: incomingRequest.descriptor.key ?? "workspace/ws-42/artifacts/output.json",
          mediaType: "application/json",
          sizeBytes: 3,
        },
        context,
      );
    };
    const retrieveArtifact: ArtifactStoragePort["retrieveArtifact"] = async <TContent>(
      incomingRequest: RetrieveArtifactRequest,
      incomingContext,
    ) => {
      retrieveArtifactCalls.push(incomingRequest);
      retrieveContexts.push(incomingContext);
      return createRetrieveArtifactSuccessResult(
        {
          key: incomingRequest.key,
          mediaType: "application/json",
          sizeBytes: 3,
        },
        asRetrievedContent<TContent>(new Uint8Array([1, 2, 3])),
        context,
      );
    };
    const hasArtifact: ArtifactStoragePort["hasArtifact"] = async (incomingRequest, incomingContext) => {
      hasArtifactCalls.push(incomingRequest);
      hasContexts.push(incomingContext);
      return createHasArtifactSuccessResult(true, {
        descriptor: {
          key: incomingRequest.key,
          mediaType: "application/json",
          sizeBytes: 3,
        },
        ...context,
      });
    };
    const deleteArtifact: ArtifactStoragePort["deleteArtifact"] = async (incomingRequest, incomingContext) => {
      deleteArtifactCalls.push(incomingRequest);
      deleteContexts.push(incomingContext);
      return createDeleteArtifactSuccessResult(true, context);
    };

    const port: ArtifactStoragePort = {
      storeArtifact,
      retrieveArtifact,
      hasArtifact,
      deleteArtifact,
    };

    const storeResult = await port.storeArtifact(storeRequest, context);
    const retrieveResult = await port.retrieveArtifact(retrieveRequest, context);
    const hasResult = await port.hasArtifact(hasRequest, context);
    const deleteResult = await port.deleteArtifact(deleteRequest, context);

    expect(storeArtifactCalls).toEqual([storeRequest]);
    expect(retrieveArtifactCalls).toEqual([retrieveRequest]);
    expect(hasArtifactCalls).toEqual([hasRequest]);
    expect(deleteArtifactCalls).toEqual([deleteRequest]);
    expect(storeContexts).toEqual([context]);
    expect(retrieveContexts).toEqual([context]);
    expect(hasContexts).toEqual([context]);
    expect(deleteContexts).toEqual([context]);

    expect(storeResult.ok).toBe(true);
    if (!storeResult.ok) {
      throw new Error("Expected storeArtifact success result.");
    }
    expect(storeResult.value.key).toBe("workspace/ws-42/artifacts/output.json");
    expect(retrieveResult.ok).toBe(true);
    if (!retrieveResult.ok) {
      throw new Error("Expected retrieveArtifact success result.");
    }
    expect(retrieveResult.value.descriptor.key).toBe("workspace/ws-42/artifacts/output.json");
    expect(hasResult.ok).toBe(true);
    if (!hasResult.ok) {
      throw new Error("Expected hasArtifact success result.");
    }
    expect(hasResult.value.exists).toBe(true);
    expect(deleteResult.ok).toBe(true);
    if (!deleteResult.ok) {
      throw new Error("Expected deleteArtifact success result.");
    }
    expect(deleteResult.value.deleted).toBe(true);

    expect("record" in storeRequest).toBe(false);
    expect("operation" in retrieveRequest).toBe(false);
    expect("record" in hasRequest).toBe(false);
    expect("operation" in deleteRequest).toBe(false);
    expect(storeRequest.requestId).toBeUndefined();
    expect(storeRequest.correlationId).toBeUndefined();
  });
});
