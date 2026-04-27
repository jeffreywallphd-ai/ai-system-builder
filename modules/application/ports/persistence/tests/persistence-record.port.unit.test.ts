import { describe, expect, expectTypeOf, it } from "../../../../testing/node-test";

import {
  createPersistenceOperationForRecord,
  createPersistenceRecordReference,
  createPersistenceSuccessResult,
  type PersistenceOperation,
  type PersistenceRecordReference,
  type PersistenceResult,
} from "../../../../contracts/persistence";
import type { ContractBoundaryContext } from "../../../../contracts/shared";

import type {
  DeletePersistenceRecordRequest,
  LoadPersistenceRecordRequest,
  PersistenceRecordOperationRequest,
  PersistenceRecordPort,
  SavePersistenceRecordRequest,
} from "../persistence-record.port";

describe("PersistenceRecordPort", () => {
  it("keeps a thin seam with load/save/delete record operations", () => {
    expectTypeOf<keyof PersistenceRecordPort>().toEqualTypeOf<
      "loadRecord" | "saveRecord" | "deleteRecord"
    >();
  });

  it("requires operation identity and record reference on all request types", () => {
    expectTypeOf<PersistenceRecordOperationRequest>().toExtend<{
      operation: PersistenceOperation;
      record: PersistenceRecordReference;
    }>();
    expectTypeOf<PersistenceRecordOperationRequest>().toExtend<ContractBoundaryContext>();

    expectTypeOf<LoadPersistenceRecordRequest>().toExtend<{
      operation: PersistenceOperation;
      record: PersistenceRecordReference;
    }>();
    expectTypeOf<LoadPersistenceRecordRequest>().toExtend<ContractBoundaryContext>();

    expectTypeOf<SavePersistenceRecordRequest<{ name: string }>>().toExtend<{
      operation: PersistenceOperation;
      record: PersistenceRecordReference;
      value: { name: string };
    }>();
    expectTypeOf<SavePersistenceRecordRequest<{ name: string }>>().toExtend<ContractBoundaryContext>();

    expectTypeOf<DeletePersistenceRecordRequest>().toExtend<{
      operation: PersistenceOperation;
      record: PersistenceRecordReference;
    }>();
    expectTypeOf<DeletePersistenceRecordRequest>().toExtend<ContractBoundaryContext>();
  });

  it("keeps return types contract-aligned and operation-aware", () => {
    expectTypeOf<Awaited<ReturnType<PersistenceRecordPort["loadRecord"]>>>().toEqualTypeOf<
      PersistenceResult<unknown | null>
    >();
    expectTypeOf<Awaited<ReturnType<PersistenceRecordPort["saveRecord"]>>>().toEqualTypeOf<
      PersistenceResult<unknown>
    >();
    expectTypeOf<
      Awaited<ReturnType<PersistenceRecordPort["deleteRecord"]>>
    >().toEqualTypeOf<PersistenceResult<boolean>>();
  });

  it("passes operation-aware record requests through load/save/delete port operations", async () => {
    const loadOperation = createPersistenceOperationForRecord("project", "load");
    const saveOperation = createPersistenceOperationForRecord("project", "save");
    const deleteOperation = createPersistenceOperationForRecord("project", "delete");
    const record = createPersistenceRecordReference("project", "project-42");

    const loadRequest: LoadPersistenceRecordRequest = {
      operation: loadOperation,
      record,
      requestId: "req-42",
      correlationId: "corr-42",
    };

    const saveRequest: SavePersistenceRecordRequest<{ id: string; name: string }> = {
      operation: saveOperation,
      record,
      value: {
        id: "project-42",
        name: "Project 42",
      },
      requestId: "req-42",
      correlationId: "corr-42",
    };

    const deleteRequest: DeletePersistenceRecordRequest = {
      operation: deleteOperation,
      record,
      requestId: "req-42",
      correlationId: "corr-42",
    };

    const loadRecordCalls: LoadPersistenceRecordRequest[] = [];
    const saveRecordCalls: SavePersistenceRecordRequest[] = [];
    const deleteRecordCalls: DeletePersistenceRecordRequest[] = [];
    const loadRecord: PersistenceRecordPort["loadRecord"] = async (incomingRequest) => {
      loadRecordCalls.push(incomingRequest);
      return createPersistenceSuccessResult(
        loadOperation,
        null,
        {
          record,
          requestId: loadRequest.requestId,
          correlationId: loadRequest.correlationId,
        },
      );
    };
    const saveRecord: PersistenceRecordPort["saveRecord"] = async <TValue>(
      incomingRequest: SavePersistenceRecordRequest<TValue>,
    ) => {
      saveRecordCalls.push(incomingRequest);
      return createPersistenceSuccessResult(saveOperation, incomingRequest.value, {
        record,
        requestId: saveRequest.requestId,
        correlationId: saveRequest.correlationId,
      });
    };
    const deleteRecord: PersistenceRecordPort["deleteRecord"] = async (incomingRequest) => {
      deleteRecordCalls.push(incomingRequest);
      return createPersistenceSuccessResult(deleteOperation, true, {
        record,
        requestId: deleteRequest.requestId,
        correlationId: deleteRequest.correlationId,
      });
    };

    const port: PersistenceRecordPort = {
      loadRecord,
      saveRecord,
      deleteRecord,
    };

    const loadResult = await port.loadRecord(loadRequest);
    const saveResult = await port.saveRecord(saveRequest);
    const deleteResult = await port.deleteRecord(deleteRequest);

    expect(loadRecordCalls).toEqual([loadRequest]);
    expect(saveRecordCalls).toEqual([saveRequest]);
    expect(deleteRecordCalls).toEqual([deleteRequest]);

    expect(loadResult.ok).toBe(true);
    expect(loadResult.operation).toBe("project.load");
    expect(loadResult.record).toEqual({
      recordType: "project",
      id: "project-42",
    });
    expect(saveResult.ok).toBe(true);
    expect(saveResult.operation).toBe("project.save");
    expect(saveResult.record).toEqual({
      recordType: "project",
      id: "project-42",
    });
    expect(deleteResult.ok).toBe(true);
    expect(deleteResult.operation).toBe("project.delete");
    expect(deleteResult.record).toEqual({
      recordType: "project",
      id: "project-42",
    });
  });

  it("keeps requests record-oriented rather than storage-key oriented across all operations", () => {
    const loadRequest: LoadPersistenceRecordRequest = {
      operation: createPersistenceOperationForRecord("project", "load"),
      record: createPersistenceRecordReference("project", "project-42"),
    };

    const saveRequest: SavePersistenceRecordRequest<{ name: string }> = {
      operation: createPersistenceOperationForRecord("project", "save"),
      record: createPersistenceRecordReference("project", "project-42"),
      value: {
        name: "Project 42",
      },
    };

    const deleteRequest: DeletePersistenceRecordRequest = {
      operation: createPersistenceOperationForRecord("project", "delete"),
      record: createPersistenceRecordReference("project", "project-42"),
    };

    expect("key" in loadRequest).toBe(false);
    expect("key" in saveRequest).toBe(false);
    expect("key" in deleteRequest).toBe(false);

    expect(loadRequest.record).toEqual({
      recordType: "project",
      id: "project-42",
    });
    expect(saveRequest.record).toEqual({
      recordType: "project",
      id: "project-42",
    });
    expect(deleteRequest.record).toEqual({
      recordType: "project",
      id: "project-42",
    });
  });
});
