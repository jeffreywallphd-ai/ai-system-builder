import { describe, expect, it } from "../../../testing/node-test";

import * as hostContracts from "..";

describe("host family invariants", () => {
  it("exports only host-family surfaces from the family barrel", () => {
    expect(Object.keys(hostContracts).sort()).toEqual([
      "HOST_CONTEXT_METADATA_FORMAT_DESCRIPTION",
      "HOST_ID_FORMAT_DESCRIPTION",
      "KNOWN_HOST_KINDS",
      "createHostContext",
      "createHostIdentity",
      "isKnownHostKind",
      "normalizeHostContextMetadata",
      "normalizeHostId",
      "resolveHostKind",
    ]);
  });

  it("keeps host context small and serialization-friendly", () => {
    const context = hostContracts.createHostContext(" server ", {
      hostId: " server-primary ",
      requestId: "req-1",
      correlationId: "corr-1",
      metadata: {
        entryPoint: "host.bootstrap",
        roles: ["compose", "delegate"],
        tags: {
          mode: "desktop-first",
        },
      },
    });

    expect(context).toEqual({
      host: {
        kind: "server",
        id: "server-primary",
      },
      requestId: "req-1",
      correlationId: "corr-1",
      metadata: {
        entryPoint: "host.bootstrap",
        roles: ["compose", "delegate"],
        tags: {
          mode: "desktop-first",
        },
      },
    });
  });

  it("rejects metadata keys that pull session/auth/request/window/framework semantics inward", () => {
    expect(() =>
      hostContracts.createHostContext("desktop", {
        metadata: {
          authProvider: "oauth",
        },
      }),
    ).toThrow(
      'Host context metadata must be a plain object containing JSON-serializable values and no auth/session/request/window/framework semantics. Metadata key "authProvider" introduces a non-goal semantic.',
    );

    expect(() =>
      hostContracts.createHostContext("desktop", {
        metadata: {
          uiWindowId: "main",
        },
      }),
    ).toThrow(
      'Host context metadata must be a plain object containing JSON-serializable values and no auth/session/request/window/framework semantics. Metadata key "uiWindowId" introduces a non-goal semantic.',
    );
  });
});
