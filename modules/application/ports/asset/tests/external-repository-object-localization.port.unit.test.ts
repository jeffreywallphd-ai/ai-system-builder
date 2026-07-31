import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { AssetReference } from "../../../../contracts/asset";
import type {
  ExternalRepositoryObjectLocalizationPort,
  ExternalRepositoryObjectLocalizationRequest,
  ExternalRepositoryObjectLocalizationResult,
} from "../external-repository-object-localization.port";

const request: ExternalRepositoryObjectLocalizationRequest = {
  operation: "localize",
  viewId: "view.external",
  externalObjectRef: {
    provider: "huggingface",
    repositoryId: "owner/repo",
    objectPath: "model.bin",
    objectKind: "model",
  },
  sourceIdentity: {
    sourceKind: "external-repository-object",
    sourceSystem: "external-repository-object",
    sourceId: "external.safe",
    deduplicationKey: "asset-source.external.safe",
  },
  targetDefinitionRef: { kind: "asset-definition", id: "builtin.model" as AssetReference["id"], version: "1.0.0" },
  requestId: "request.safe",
  correlationId: "correlation.safe",
  idempotencyKey: "idem.safe",
};

describe("ExternalRepositoryObjectLocalizationPort", () => {
  it("carries safe descriptor refs and internal resource refs without provider credentials or bytes", async () => {
    const port: ExternalRepositoryObjectLocalizationPort = {
      async processExternalRepositoryObject(input): Promise<ExternalRepositoryObjectLocalizationResult> {
        assert.deepEqual(input, request);
        return {
          ok: true,
          status: "localized",
          internalResourceRefs: [{ kind: "artifact", id: "artifact.safe" as AssetReference["id"] }],
          diagnostics: [{ severity: "info", code: "localized", message: "Localized." }],
        };
      },
    };

    const result = await port.processExternalRepositoryObject(request);
    assert.equal(result.ok, true);
    assert.equal(result.status, "localized");
    assert.deepEqual(Object.keys(request).sort(), [
      "correlationId",
      "externalObjectRef",
      "idempotencyKey",
      "operation",
      "requestId",
      "sourceIdentity",
      "targetDefinitionRef",
      "viewId",
    ]);
    assert.deepEqual(Object.keys(request.externalObjectRef).sort(), [
      "objectKind",
      "objectPath",
      "provider",
      "repositoryId",
    ]);
    assert.doesNotMatch(JSON.stringify(request), /token|secret|authorization|authHeader|signedUrl|downloadUrl|localPath|destinationPath|C:\\|\/tmp|rawProvider|payload|bytes|blob|base64|data:|sourceView|fileContents|raw error|stack/i);
  });

  it("port module does not import adapters, hosts, transport, UI, runtime, storage, persistence, provider clients, or filesystem APIs", () => {
    const source = readFileSync("modules/application/ports/asset/external-repository-object-localization.port.ts", "utf8");

    assert.doesNotMatch(source, /from\s+["'][^"']*(?:adapters|hosts|api-express|ipc-electron|electron|express|preload|renderer|thin-client|runtime|storage|persistence|provider-client|huggingface)[^"']*["']/i);
    assert.doesNotMatch(source, /node:fs|node:path|fetch\(|readFile|readdir|scan|download|upload|token|authorization|signedUrl|base64|bytes/i);
  });
});
