import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";

import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../../../adapters/storage/filesystem";
import { RegisterArtifactFromRepoUseCase } from "../../../../application/use-cases";
import type { HuggingFaceRepoBrowserPort } from "../../../../application/ports/storage";
import { normalizeIngestionSourceSnapshotId } from "../../../../contracts/ingestion";
import { createOrganizationId } from "../../../../contracts/organization";
import { createHasArtifactInRepoSuccessResult } from "../../../../contracts/storage";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { ArtifactId } from "../../../../domain/artifact";
import { composeDesktopIngestionFeature } from "../composeDesktopIngestionFeature";
import { composeIngestionAcquisitionRepository } from "../../../shared/composition/composeIngestionAcquisitionRepository";

const NOW = "2026-07-30T16:00:00.000Z";
const IMMUTABLE_REVISION = "a".repeat(40);

function createFixture(activeContext: boolean | (() => boolean) = true, registrar?: RegisterArtifactFromRepoUseCase) {
  const organizationId = createOrganizationId("organization.local");
  const principalId = "principal.local";
  const workspaceId = createWorkspaceId("workspace-a");
  const documents = createInMemoryStructuredDocumentStore(
    () => NOW,
  ).forOrganization(organizationId);
  const registerArtifactFromRepoUseCase = {
    execute: testDouble.fn().mockResolvedValue({
      ok: true,
      value: { artifactId: "artifact-1" },
    }),
  };
  const feature = composeDesktopIngestionFeature({
    artifacts: { storage: {} as never },
    remoteArtifacts: {
      registerArtifactFromRepoUseCase: registrar ?? registerArtifactFromRepoUseCase as never,
    },
    storageRootDirectory: "artifacts/tmp/desktop-ingestion-context-tests",
    documents,
    workspaceRepository: {
      readWorkspace: async () => ({
        organizationId,
        workspaceId,
        displayName: "Workspace A",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    },
    organizationContextProvider: {
      getCurrentOrganizationContext: () =>
        (typeof activeContext === "function" ? activeContext() : activeContext)
          ? { organizationId, principalId }
          : undefined,
    },
    now: () => NOW,
  });
  return { feature, organizationId, principalId, workspaceId, documents };
}

function controlledRegistrar(verify: () => Promise<void | boolean>,
  readDatasetRevisionLicense?: HuggingFaceRepoBrowserPort["readDatasetRevisionLicense"]) {
  let nextId = 0;
  return new RegisterArtifactFromRepoUseCase({
    readDatasetRevisionLicense,
    artifactRepoStorage: {
      async hasArtifactInRepo() {
        return createHasArtifactInRepoSuccessResult((await verify()) !== false);
      },
    } as never,
    artifactCatalogAppend: { appendArtifactCatalogRecord: async () => { throw new Error("Unowned catalog write."); }},
    artifactBindingStorage: { upsertArtifactStorageBinding: async () => { throw new Error("Unowned binding write."); }} as never,
    logging: { log() {} },
    now: () => NOW,
    createArtifactId: () => ArtifactId.from(`artifacts/20260730160000-provider${++nextId}`),
  });
}

describe("composeDesktopIngestionFeature", () => {
  it("retains one exact license observation with every saved file at the same commit", async () => {
    const source = { repository: "example/synthetic", revision: IMMUTABLE_REVISION };
    const readDatasetRevisionLicense = testDouble.fn(async () => ({ ...source, licenseIds: ["cc-by-nc-4.0"] }));
    const registrar = controlledRegistrar(async () => true, readDatasetRevisionLicense);
    const { feature, documents, workspaceId } = createFixture(true, registrar);
    try {
      const execute = feature.ingestionTasks.executeCommand.bind(feature.ingestionTasks);
      const created = await execute({ action: "create-hugging-face", files: [
        { ...source, path: "data/train.parquet" }, { ...source, path: "data/test.parquet" },
      ] }, { workspaceId });
      if (!created.ok || created.value.kind !== "task") throw new Error("Could not create the provider task.");
      const taskId = created.value.task.taskId;
      const run = () => execute({ action: "run-hugging-face", taskId }, { workspaceId });
      const result = await run();
      if (!result.ok || result.value.kind !== "task") throw new Error("Could not save the provider task.");
      expect(result.value.task.status).toBe("succeeded");
      const repository = composeIngestionAcquisitionRepository("artifacts/tmp/desktop-ingestion-context-tests", documents);
      for (const file of result.value.task.files) {
        const snapshotId = normalizeIngestionSourceSnapshotId(file.output!.sourceSnapshotId!);
        expect(await repository.readSourceSnapshot(workspaceId, snapshotId)).toMatchObject({
          locator: { repository: source.repository, revision: source.revision },
          providerRevision: source.revision, providerLicenseIds: ["cc-by-nc-4.0"],
        });
      }
      expect(await run()).toEqual(result);
      expect(readDatasetRevisionLicense).toHaveBeenCalledTimes(1);
    } finally {
      feature.dispose();
    }
  });

  it("concurrent selected provider imports complete one source and keep their artifact records together", { timeout: 10_000 }, async () => {
    const firstEntered = Promise.withResolvers<void>();
    const bothEntered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let verificationCalls = 0;
    const registrar = controlledRegistrar(async () => {
      if (++verificationCalls === 1) firstEntered.resolve();
      if (verificationCalls === 2) bothEntered.resolve();
      await release.promise;
    });
    const { feature, documents, workspaceId } = createFixture(true, registrar);
    try {
      const execute = feature.ingestionTasks.executeCommand.bind(feature.ingestionTasks);
      const created = await execute({action:"create-hugging-face",files:[{
        repository:"example/synthetic",path:"train/data.parquet",revision:IMMUTABLE_REVISION,
      }]},{workspaceId});
      if (!created.ok || created.value.kind !== "task") throw new Error("Could not create the synthetic task.");
      const taskId = created.value.task.taskId;
      const run = () => execute({action:"run-hugging-face",taskId},{workspaceId});
      const first = run();
      await firstEntered.promise;
      const second = run();
      await bothEntered.promise;
      release.resolve();
      const results = await Promise.all([first, second]);
      expect(results[0]).toMatchObject({ok:true,value:{kind:"task",task:{status:"succeeded",revision:3}}});
      expect(results[1]).toEqual(results[0]);
      expect(await run()).toEqual(results[0]);
      expect(verificationCalls).toBe(2);

      const options = { rootDirectory:"artifacts/tmp/desktop-ingestion-context-tests", documents };
      const catalog = await createLocalArtifactCatalogPersistenceAdapter(options).browseArtifactCatalogRecords({workspaceId});
      if (!catalog.ok) throw new Error("Could not read the synthetic catalog.");
      expect(catalog.value.records.length).toBe(1);
      const artifactId = catalog.value.records[0]!.storageKey;
      const bindings = await createLocalArtifactStorageBindingAdapter(options).readArtifactStorageBindings({workspaceId,artifactId});
      expect(bindings).toMatchObject({ok:true,value:{bindings:[{workspaceId,artifactId,role:"imported-source",
        backing:{target:{repository:"example/synthetic",path:"train/data.parquet",revision:IMMUTABLE_REVISION}}}]}});
      expect(results[0]).toMatchObject({ok:true,value:{kind:"task",task:{files:[{output:{key:artifactId,providerRevision:IMMUTABLE_REVISION}}]}}});
    } finally {
      release.resolve();
      feature.dispose();
    }
  });

  for (const providerFileExists of [true, false]) it(
    `leaves provider task and artifacts unchanged when context retires before a ${providerFileExists ? "successful" : "missing-file"} reply`,
    { timeout: 10_000 }, async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let active = true;
    let exists = providerFileExists;
    const readDatasetRevisionLicense = testDouble.fn(async () => undefined);
    const registrar = controlledRegistrar(
      async () => { entered.resolve(); await release.promise; return exists; },
      readDatasetRevisionLicense,
    );
    const { feature, documents, workspaceId } = createFixture(() => active, registrar);
    try {
      const execute = feature.ingestionTasks.executeCommand.bind(feature.ingestionTasks);
      const files = [{repository:"example/synthetic",path:"train/data.parquet",revision:IMMUTABLE_REVISION}];
      const created = await execute({action:"create-hugging-face",files},{workspaceId});
      if (!created.ok || created.value.kind !== "task") throw new Error("Could not create the synthetic task.");
      const taskId = created.value.task.taskId;
      const run = () => execute({action:"run-hugging-face",taskId},{workspaceId});
      const outstanding = run();
      await entered.promise;
      active = false;
      release.resolve();
      expect(await outstanding).toMatchObject({ok:false,error:{code:"forbidden"}});
      expect(readDatasetRevisionLicense).not.toHaveBeenCalled();
      const catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory:"artifacts/tmp/desktop-ingestion-context-tests", documents });
      expect(await catalog.browseArtifactCatalogRecords({workspaceId})).toMatchObject({ok:true,value:{records:[]}});
      active = true;
      expect(await execute({action:"read",taskId},{workspaceId})).toMatchObject({
        ok:true,value:{kind:"task",task:{status:"transferring",revision:2,files:[{status:"pending"}]}},
      });
      exists = true;
      expect(await run()).toMatchObject({ok:true,value:{kind:"task",task:{status:"succeeded"}}});
      expect(readDatasetRevisionLicense).toHaveBeenCalledTimes(1);
    } finally {
      release.resolve();
      feature.dispose();
    }
  });

  it("keeps a Hugging Face namespace separate from the authoritative ingestion organization", async () => {
    const { feature, organizationId, workspaceId } = createFixture();

    const result = await feature.ingestionTasks.executeCommand(
      {
        action: "create-hugging-face",
        files: [
          {
            repository: "OpenFinAL/Reddit",
            path: "default/train/0000.parquet",
            revision: IMMUTABLE_REVISION,
          },
        ],
      },
      { workspaceId },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: "task",
        task: {
          organizationId,
          workspaceId,
          kind: "hugging-face",
          files: [
            {
              providerSource: {
                repository: "OpenFinAL/Reddit",
                path: "default/train/0000.parquet",
                revision: IMMUTABLE_REVISION,
              },
            },
          ],
        },
      },
    });
  });

  it("rejects a caller-supplied organization that conflicts with the active host context", async () => {
    const { feature, workspaceId } = createFixture();

    const denied = await feature.ingestionTasks.executeCommand(
      {
        action: "create-hugging-face",
        files: [
          {
            repository: "OpenFinAL/Reddit",
            path: "default/train/0000.parquet",
            revision: IMMUTABLE_REVISION,
          },
        ],
      },
      {
        workspaceId,
        organizationId: createOrganizationId("organization.other"),
      },
    );

    expect(denied).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    await expect(
      feature.ingestionTasks.executeCommand(
        { action: "list" },
        { workspaceId },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: "tasks", tasks: [] },
    });
  });

  it("fails closed when the host cannot establish an active organization", async () => {
    const { feature, workspaceId } = createFixture(false);

    const denied = await feature.ingestionTasks.executeCommand(
      {
        action: "create-hugging-face",
        files: [
          {
            repository: "OpenFinAL/Reddit",
            path: "default/train/0000.parquet",
            revision: IMMUTABLE_REVISION,
          },
        ],
      },
      { workspaceId },
    );

    expect(denied).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });
});
