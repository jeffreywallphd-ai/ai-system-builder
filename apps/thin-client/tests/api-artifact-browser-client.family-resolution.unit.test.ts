import { afterEach, describe, expect, it } from "../../../modules/testing/node-test";

import { createApiArtifactBrowserClient } from "../src/features/artifact-browser/api/apiArtifactBrowserClient";
import { resolveArtifactFamily } from "../../../modules/application/shared/artifact-family-classifier";

const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as { fetch?: typeof fetch }).fetch = originalFetch;
});

describe("thin-client api artifact browser family resolution", () => {
  it("uses the canonical resolver for register-from-repo artifactFamily payloads", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    (globalThis as { fetch?: typeof fetch }).fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      calls.push({ url: String(input), init });
      return {
        async json() {
          return {
            ok: true,
            value: {
              artifactId: "artifacts/20260418000000-import001",
              backing: {
                role: "imported-source",
                target: {
                  provider: "huggingface",
                  repository: "openai/demo",
                  path: "data/train.parquet",
                  revision: "main",
                  locator: "openai/demo/data/train.parquet",
                },
                verification: {
                  exists: true,
                  verifiedAt: "2026-04-18T00:00:00.000Z",
                },
              },
            },
          };
        },
      } as Response;
    }) as typeof fetch;

    const client = createApiArtifactBrowserClient({ apiBaseUrl: "/api" });
    const scenarios = [
      { path: "data/train.parquet", mediaType: "application/x-parquet" },
      { path: "images/cat.png", mediaType: "image/png" },
      { path: "unknown/file.bin", mediaType: undefined },
    ] as const;

    for (const scenario of scenarios) {
      await client.registerArtifactFromRepo({
        repository: "openai/demo",
        path: scenario.path,
        revision: "main",
        mediaType: scenario.mediaType,
      });
    }

    expect(calls.length).toBe(scenarios.length);
    for (const [index, scenario] of scenarios.entries()) {
      const call = calls[index];
      expect(call?.url).toBe("/api/artifact/register-from-repo");
      const body = JSON.parse(call?.init?.body as string) as {
        artifactFamily?: string;
        target?: { path?: string };
        mediaType?: string;
      };
      expect(body.target?.path).toBe(scenario.path);
      expect(body.mediaType).toBe(scenario.mediaType);
      expect(body.artifactFamily).toBe(
        resolveArtifactFamily({
          mediaType: scenario.mediaType,
          fileName: scenario.path,
        }),
      );
    }
  });
});
