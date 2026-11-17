import assert from "node:assert/strict";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../../adapters/persistence/sqlite";
import { createStructuredSystemDataRepository } from "../../../../../adapters/persistence/system-data";
import { createSha256SystemBuildHasher } from "../../../../../adapters/storage/system-build";
import type { SystemDataResolvedDefinition } from "../../../../../application/ports/system-data";
import type { CompiledSystemFormAction } from "../../../../../application/services/system-builder/system-form-action.service";
import { SubmitReleasedSystemFormUseCase } from "../../../../../application/use-cases/system-builder/submit-released-system-form.use-case";
import { ReleaseBoundSystemDataUseCases } from "../../../../../application/use-cases/system-data";
import { normalizeSystemReleaseId } from "../../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../../contracts/workspace";

async function run() {
  const [, , phase, root, ...extra] = process.argv;
  assert.ok((phase === "write" || phase === "retry") && root && extra.length === 0);
  assert.equal(path.dirname(root), realpathSync(tmpdir()));
  assert.match(path.basename(root), /^aisb-form-durable-[a-zA-Z0-9]+$/);
  assert.equal(realpathSync(root), root);
  const marker = path.join(root, ".owner");
  const markerStat = lstatSync(marker);
  const owner = process.env.AISB_FORM_TEST_OWNER;
  assert.ok(markerStat.isFile() && markerStat.nlink === 1 && markerStat.size === 36 &&
    realpathSync(marker) === marker && owner && /^[a-f0-9-]{36}$/.test(owner));
  assert.equal(readFileSync(marker, "utf8") === owner, true, "The fixture must own this directory.");

  const policy = resolveLocalSqliteDatabasePolicy({ dataRootDirectory: root, databaseFileName: "form-test.sqlite3" });
  if (phase === "write") {
    assert.equal(lstatSync(policy.persistenceRootDirectory, { throwIfNoEntry: false }), undefined);
  } else {
    assert.equal(realpathSync(policy.persistenceRootDirectory), policy.persistenceRootDirectory);
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const file = policy.databaseFilePath + suffix;
      const stat = lstatSync(file, { throwIfNoEntry: false });
      if (!stat && suffix) continue;
      assert.ok(stat?.isFile() && stat.nlink === 1 && realpathSync(file) === file);
    }
  }
  const database = await openLocalSqliteDatabase({ policy });
  try {
    assert.equal(database.checkHealth().journalMode, "wal");
    const hasher = createSha256SystemBuildHasher();
    const workspaceId = createWorkspaceId("workspace-form-durable");
    const releaseDigest = hasher.digest("synthetic approved form release");
    const releaseId = normalizeSystemReleaseId(`system-release:${releaseDigest.slice(7)}`);
    const request = { workspaceId, releaseId, releaseDigest, formId: "form-durable", submissionId: "20ef28a5-d5b8-484b-8dfd-47100ea558d9",
      answers: { reason: "synthetic answer" } };
    const action: CompiledSystemFormAction = {
      operationId: "create-durable", entityType: "Request", mappings: [{ fieldId: "reason", recordField: "reason" }],
      form: { id: request.formId, title: "Request", steps: [{
        id: "details", label: "Details", defaultDestinationId: request.formId, conditions: [],
        fields: [{ id: "reason", label: "Reason", required: true, helpText: "", kind: "text", options: [],
          min: 0, max: 128, dateKind: "date", earliest: undefined, latest: undefined }],
      }] },
    };
    const definition: SystemDataResolvedDefinition = {
      descriptor: { schemaVersion: "1.0", targetWorkspaceId: workspaceId, releaseId, entityType: "Request",
        title: "Requests", fields: [{ name: "reason", label: "Reason", type: "text", required: true }], maximumPageSize: 20 },
      rolesByAction: { create: ["owner"], read: ["owner"], update: ["owner"], list: ["owner"] }, unmaskRoles: [],
    };
    const stored = createStructuredSystemDataRepository(database.documents);
    let retryCommits = 0;
    const runtime = new ReleaseBoundSystemDataUseCases({
      definitions: { resolve: async () => definition },
      generateAuditId: () => "audit.durable",
      repository: { ...stored, createRecordWithAudit: async (record, audit) => {
        const committed = await stored.createRecordWithAudit(record, audit);
        assert.ok(committed);
        if (phase === "write") {
          // The SQLite transaction has committed. Do not close it or return
          // a receipt; a fresh process must find the original creation marker.
          process.exit(73);
        }
        retryCommits++;
        return committed;
      } },
    });
    const submit = new SubmitReleasedSystemFormUseCase({
      hasher, release: { resolve: async () => action }, records: { createOnce: command => runtime.createFormRecordOnce(command) },
    });
    const authority = { actorId: "fixture-owner", readPrincipal: async () => ({
      actorId: "fixture-owner", authenticated: true, roles: ["owner"],
    }) };
    const result = await submit.execute(request, authority);
    assert.equal(phase, "retry", "The writer must exit before returning a receipt.");
    assert.equal(retryCommits, 0);
    assert.equal(result.status, "already-recorded");
    const records = await stored.listRecords(workspaceId, releaseId, "Request");
    const audit = await stored.listAudit(workspaceId, releaseId, "Request", 10);
    assert.equal(records.length, 1);
    assert.equal(records[0].recordId === result.receiptId, true);
    assert.equal(records[0].values.reason === request.answers.reason, true);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "create");
    assert.equal(audit[0].outcome, "allowed");
    assert.equal(audit[0].actorId === authority.actorId && audit[0].recordId === result.receiptId &&
      audit[0].auditId === `audit.${result.receiptId}`, true);
    assert.deepEqual(audit[0].changedFields, ["reason"]);
    assert.equal(JSON.stringify({ result, audit }).includes(request.answers.reason), false);
    process.stdout.write("durable replay confirmed\n");
  } finally {
    database.close();
  }
}

void run().catch(() => {
  // Report a fixed failure. The test never prints paths, records or receipts.
  process.stderr.write("The owned form recovery fixture did not qualify.\n");
  process.exitCode = 1;
});
