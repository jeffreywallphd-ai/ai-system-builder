import { describe, expect, it } from "../../../testing/node-test";

import * as persistenceContracts from "..";

describe("persistence family invariants", () => {
  it("exports only persistence-family surfaces from the family barrel", () => {
    expect(Object.keys(persistenceContracts).sort()).toEqual([
      "PERSISTENCE_RECORD_TYPE_FORMAT_DESCRIPTION",
      "assertPersistenceOperationMatchesRecord",
      "createPersistenceError",
      "createPersistenceFailureResult",
      "createPersistenceOperation",
      "createPersistenceOperationForRecord",
      "createPersistenceRecordReference",
      "createPersistenceSuccessResult",
      "isPersistenceOperation",
      "isPersistenceOperationForRecord",
      "isPersistenceOperationForRecordType",
      "isPersistenceRecordType",
      "normalizePersistenceOperation",
      "normalizePersistenceRecordId",
      "normalizePersistenceRecordType",
    ]);
  });

  it("keeps persistence results and errors operation-aware and record-oriented", () => {
    const operation = persistenceContracts.createPersistenceOperationForRecord(
      "project-run",
      "update",
    );
    const record = persistenceContracts.createPersistenceRecordReference(
      "project-run",
      "run-99",
    );

    const success = persistenceContracts.createPersistenceSuccessResult(
      operation,
      {
        updated: true,
      },
      {
        record,
      },
    );

    expect(success.operation).toBe("project-run.update");
    expect(success.record).toEqual({
      recordType: "project-run",
      id: "run-99",
    });

    const error = persistenceContracts.createPersistenceError(
      operation,
      "conflict",
      "Version mismatch",
      {
        record,
      },
    );

    const failure = persistenceContracts.createPersistenceFailureResult(error);

    expect(failure.operation).toBe("project-run.update");
    expect(failure.error.operation).toBe("project-run.update");
    expect(failure.record).toEqual({
      recordType: "project-run",
      id: "run-99",
    });
  });

  it("rejects mismatched record and operation bindings at creation time", () => {
    const record = persistenceContracts.createPersistenceRecordReference(
      "workspace",
      "ws-7",
    );

    expect(() =>
      persistenceContracts.createPersistenceError(
        "project-run.delete",
        "validation",
        "Mismatched record",
        {
          record,
        },
      ),
    ).toThrow('Persistence operation "project-run.delete" must target record type "workspace"');

    expect(() =>
      persistenceContracts.createPersistenceSuccessResult(
        "project-run.delete",
        {
          deleted: true,
        },
        {
          record,
        },
      ),
    ).toThrow('Persistence operation "project-run.delete" must target record type "workspace"');
  });
});
