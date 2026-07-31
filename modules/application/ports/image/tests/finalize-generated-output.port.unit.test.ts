import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type {
  FinalizeGeneratedOutputPort,
  FinalizeGeneratedOutputRequest,
  FinalizeGeneratedOutputResult,
} from "../finalize-generated-output.port";

describe("FinalizeGeneratedOutputPort", () => {
  it("uses a safe identifier-only request and safe metadata-only result shape", async () => {
    const request: FinalizeGeneratedOutputRequest = {
      generatedOutputId: "generated.safe-output",
      sourceViewId: "asset-view.generated-output.internal.safe-output",
      displayName: "Safe Image",
      requestId: "request.1",
      correlationId: "correlation.1",
      idempotencyKey: "idem.1",
    };
    const port: FinalizeGeneratedOutputPort = {
      async finalizeGeneratedOutput(input): Promise<FinalizeGeneratedOutputResult> {
        assert.equal(input, request);
        return {
          ok: true,
          status: "finalized",
          finalizedImage: {
            imageAssetId: "image.safe-output",
            backingArtifactId: "artifact.safe-output",
            source: "generated",
            mediaType: "image/png",
            width: 512,
            height: 512,
            seed: 123,
            model: "safe-model",
            engine: "comfyui",
          },
        };
      },
    };

    const result = await port.finalizeGeneratedOutput(request);
    assert.equal(result.ok, true);
    assert.equal(result.status, "finalized");
    assert.doesNotMatch(JSON.stringify({ request, result }), /localPath|storageKey|contentBase64|base64|bytes|prompt|workflow|token|C:\\|\/tmp/i);
  });

  it("does not import adapters, hosts, transports, runtime, storage, or provider clients", () => {
    const source = readFileSync(
      join(process.cwd(), "modules/application/ports/image/finalize-generated-output.port.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:adapters|hosts|contracts\/api|contracts\/ipc|api-express|ipc-electron|preload|renderer|thin-client|runtime\/.*adapter|storage\/.*adapter|persistence\/.*adapter|provider-client|huggingface)[^"']*["']/i);
    assert.doesNotMatch(source, /\b(?:Uint8Array|ArrayBuffer|Blob|Buffer|contentBase64|base64|localPath|storageKey|prompt|workflow)\b/i);
  });
});
