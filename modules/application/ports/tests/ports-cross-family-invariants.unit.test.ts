import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, expectTypeOf, it, testDouble } from "../../../testing/node-test";

import {
  createPersistenceOperationForRecord,
  createPersistenceRecordReference,
  type PersistenceOperation,
  type PersistenceRecordReference,
  type PersistenceResult,
} from "../../../contracts/persistence";
import type {
  RuntimeExecutionEvent,
  RuntimeExecutionRequest,
} from "../../../contracts/runtime";
import {
  createRuntimeExecutionError,
  createRuntimeExecutionRequest,
} from "../../../contracts/runtime";
import {
  createStoreArtifactRequest,
  normalizeStorageArtifactKey,
  type StoreArtifactResult,
} from "../../../contracts/storage";
import type { StructuredLogEvent } from "../../../contracts/logging";
import type { ContractBoundaryContext } from "../../../contracts/shared";
import type {
  HasArtifactInRepoRequest,
  RetrieveArtifactFromRepoRequest,
  StoreArtifactInRepoRequest,
} from "../../../contracts/storage";

import type { LoggingPort } from "../logging";
import type { ApplicationRequestContext } from "../application-request-context";
import type {
  PersistenceRecordOperationRequest,
  PersistenceRecordPort,
} from "../persistence";
import type { RuntimeExecutionPort } from "../runtime";
import type { ArtifactRepoStoragePort, ArtifactStoragePort } from "../storage";
import type {
  ArtifactBrowserContentReadPort,
  ArtifactBrowserMetadataReadPort,
  BrowseArtifactsRequest,
  ReadArtifactContentRequest,
  ReadArtifactDetailRequest,
} from "../artifact-browser";

const PORTS_SCAN_ROOT = resolve("modules/application/ports");
const IMPORT_PATTERN = /\bfrom\s+["']([^"']+)["']/g;

type ImportDisciplineViolation = {
  filePath: string;
  importPath: string;
  reason: string;
};

function collectTypeScriptFiles(directoryPath: string): string[] {
  if (!existsSync(directoryPath)) {
    return [];
  }

  const files: string[] = [];
  const entries = readdirSync(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(entryPath);
    }
  }

  return files;
}

function getPortsImportViolation(importPath: string): string | null {
  if (
    importPath.includes("/adapters/")
    || importPath.includes("/hosts/")
    || importPath.includes("/ui/")
    || importPath.includes("/apps/")
  ) {
    return "application ports must not depend on adapters, hosts, ui, or apps";
  }

  const contractsSegmentIndex = importPath.lastIndexOf("contracts");
  if (contractsSegmentIndex === -1) {
    return null;
  }

  const suffix = importPath.slice(contractsSegmentIndex + "contracts".length);
  if (suffix.length === 0) {
    return "root contracts import is disallowed; import from modules/contracts/<family>";
  }

  if (!suffix.startsWith("/")) {
    return null;
  }

  const segments = suffix.split("/").filter(Boolean);
  if (segments.length !== 1) {
    return "deep contracts import is disallowed; import from modules/contracts/<family>";
  }

  return null;
}

describe("application ports cross-family invariants", () => {
  it("keeps application port source files inward-facing and on contracts family barrels", () => {
    const violations: ImportDisciplineViolation[] = [];
    const files = collectTypeScriptFiles(PORTS_SCAN_ROOT).filter(
      (filePath) => !filePath.includes("/tests/") && !filePath.includes("\\tests\\"),
    );

    for (const filePath of files) {
      const fileContent = readFileSync(filePath, "utf8");
      const matches = fileContent.matchAll(IMPORT_PATTERN);
      for (const match of matches) {
        const importPath = match[1];
        const violationReason = getPortsImportViolation(importPath);
        if (!violationReason) {
          continue;
        }

        violations.push({
          filePath,
          importPath,
          reason: violationReason,
        });
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps persistence record and storage artifact seams mechanically distinct", () => {
    expectTypeOf<keyof PersistenceRecordPort>().toEqualTypeOf<
      "loadRecord" | "saveRecord" | "deleteRecord"
    >();
    expectTypeOf<keyof ArtifactStoragePort>().toEqualTypeOf<
      "storeArtifact" | "retrieveArtifact" | "hasArtifact" | "deleteArtifact"
    >();
    expectTypeOf<keyof ArtifactRepoStoragePort>().toEqualTypeOf<
      "storeArtifactInRepo" | "retrieveArtifactFromRepo" | "hasArtifactInRepo"
    >();

    expectTypeOf<PersistenceRecordOperationRequest>().toExtend<{
      operation: PersistenceOperation;
      record: PersistenceRecordReference;
    }>();
    expectTypeOf<PersistenceRecordOperationRequest>().not.toExtend<{
      descriptor: { key: string };
    }>();

    expectTypeOf<Awaited<ReturnType<PersistenceRecordPort["saveRecord"]>>>().toEqualTypeOf<
      PersistenceResult<unknown>
    >();
    expectTypeOf<Awaited<ReturnType<ArtifactStoragePort["storeArtifact"]>>>().toEqualTypeOf<
      StoreArtifactResult
    >();

    expectTypeOf<Parameters<ArtifactStoragePort["storeArtifact"]>[1]>().toExtend<
      ApplicationRequestContext | undefined
    >();
    expectTypeOf<Parameters<ArtifactStoragePort["storeArtifact"]>[0]>().not.toExtend<
      ApplicationRequestContext
    >();

    const persistenceRequest: PersistenceRecordOperationRequest = {
      operation: createPersistenceOperationForRecord("workspace", "save"),
      record: createPersistenceRecordReference("workspace", "ws-42"),
      requestId: "req-ports-1",
      correlationId: "corr-ports-1",
    };

    const storageRequest = createStoreArtifactRequest(new Uint8Array([1, 2, 3]), {
      descriptor: {
        key: normalizeStorageArtifactKey("workspace/ws-42/snapshots/state.json"),
      },
    });

    expectTypeOf<Parameters<ArtifactRepoStoragePort["storeArtifactInRepo"]>[1]>().toExtend<
      ApplicationRequestContext | undefined
    >();
    expectTypeOf<Parameters<ArtifactRepoStoragePort["storeArtifactInRepo"]>[0]>().not.toExtend<{
      descriptor: { key: string };
    }>();
    expectTypeOf<StoreArtifactInRepoRequest>().not.toExtend<ContractBoundaryContext>();
    expectTypeOf<RetrieveArtifactFromRepoRequest>().not.toExtend<ContractBoundaryContext>();
    expectTypeOf<HasArtifactInRepoRequest>().not.toExtend<ContractBoundaryContext>();

    expect("descriptor" in persistenceRequest).toBe(false);
    expect("operation" in storageRequest).toBe(false);
    expect("record" in storageRequest).toBe(false);
  });

  it("keeps logging and runtime seams distinct and role-revealing", async () => {
    expectTypeOf<keyof LoggingPort>().toEqualTypeOf<"log">();
    expectTypeOf<keyof RuntimeExecutionPort>().toEqualTypeOf<"execute">();

    expectTypeOf<Parameters<LoggingPort["log"]>[0]>().toExtend<StructuredLogEvent>();
    expectTypeOf<Parameters<RuntimeExecutionPort["execute"]>[0]>().toExtend<
      RuntimeExecutionRequest
    >();
    expectTypeOf<RuntimeExecutionEvent>().not.toExtend<StructuredLogEvent>();

    let runtimeExecuteCallCount = 0;
    const runtimeExecute: RuntimeExecutionPort["execute"] = async (incomingRequest) => {
      runtimeExecuteCallCount += 1;
      return {
        ok: false,
        error: createRuntimeExecutionError(
          incomingRequest.operation,
          incomingRequest.executionId,
          incomingRequest.target,
          "internal",
          "Execution failed.",
        ),
        operation: incomingRequest.operation,
        executionId: incomingRequest.executionId,
        target: incomingRequest.target,
        requestId: incomingRequest.requestId,
        correlationId: incomingRequest.correlationId,
      };
    };
    const log = testDouble.fn<LoggingPort["log"]>().mockResolvedValue(undefined);

    const runtimePort: RuntimeExecutionPort = { execute: runtimeExecute };
    const loggingPort: LoggingPort = { log };

    const request = createRuntimeExecutionRequest("workspace.create", { name: "Alpha" }, {
      executionId: "exec-ports-1",
      runtimeKind: "local",
      requestId: "req-ports-2",
      correlationId: "corr-ports-2",
    });

    await runtimePort.execute(request);
    await loggingPort.log({
      timestamp: "2026-04-14T12:00:00.000Z",
      level: "info",
      verbosity: "normal",
      event: "runtime.execution.started",
      message: "Execution started",
      component: "application",
    });

    expect(runtimeExecuteCallCount).toBe(1);
    expect(log).toHaveBeenCalledOnce();
    expect("log" in runtimePort).toBe(false);
    expect("execute" in loggingPort).toBe(false);
  });
  it("keeps artifact browser metadata and content seams distinct and storage-key locator based", () => {
    expectTypeOf<keyof ArtifactBrowserMetadataReadPort>().toEqualTypeOf<
      "browseArtifacts" | "readArtifactDetail"
    >();
    expectTypeOf<keyof ArtifactBrowserContentReadPort>().toEqualTypeOf<"readArtifactContent">();

    expectTypeOf<BrowseArtifactsRequest>().toExtend<{
      artifactFamily: "image";
    }>();
    expectTypeOf<ReadArtifactDetailRequest>().toExtend<{
      locator: { storageKey: string };
    }>();
    expectTypeOf<ReadArtifactContentRequest>().toExtend<{
      locator: { storageKey: string };
    }>();

    expectTypeOf<BrowseArtifactsRequest>().not.toExtend<{ requestId: string }>();
    expectTypeOf<BrowseArtifactsRequest>().not.toExtend<{ correlationId: string }>();

    expectTypeOf<ReadArtifactDetailRequest>().not.toExtend<{
      locator: { path: string };
    }>();
    expectTypeOf<ReadArtifactContentRequest>().not.toExtend<{
      locator: { path: string };
    }>();

    expectTypeOf<Parameters<ArtifactBrowserMetadataReadPort["browseArtifacts"]>[1]>().toExtend<
      ApplicationRequestContext | undefined
    >();

    expectTypeOf<Parameters<ArtifactBrowserMetadataReadPort["readArtifactDetail"]>[0]>().not.toExtend<{
      content: unknown;
    }>();
    expectTypeOf<Parameters<ArtifactBrowserContentReadPort["readArtifactContent"]>[0]>().not.toExtend<{
      artifactFamily: string;
    }>();
  });

  it("uses generic application request context for artifact catalog/content seams", () => {
    const artifactCatalogPortSource = readFileSync(
      resolve("modules/application/ports/artifact-catalog/artifact-catalog.port.ts"),
      "utf8",
    );
    const artifactContentPortSource = readFileSync(
      resolve("modules/application/ports/artifact-content/artifact-content-retrieval.port.ts"),
      "utf8",
    );

    expect(artifactCatalogPortSource).toContain("ApplicationRequestContext");
    expect(artifactContentPortSource).toContain("ApplicationRequestContext");
    expect(artifactCatalogPortSource).not.toContain("ArtifactBrowserBoundaryContext");
    expect(artifactContentPortSource).not.toContain("ArtifactBrowserBoundaryContext");
  });

});
