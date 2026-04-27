import { describe, expect, it } from "../../testing/node-test";

import {
  createHostContext,
  createHostIdentity,
  HOST_ID_FORMAT_DESCRIPTION,
  isKnownHostKind,
  KNOWN_HOST_KINDS,
  normalizeHostContextMetadata,
  resolveHostKind,
} from ".";

describe("host contracts", () => {
  it("exposes known host kinds while allowing future host kinds", () => {
    expect(KNOWN_HOST_KINDS).toEqual(["desktop", "server", "hybrid"]);
    expect(isKnownHostKind("desktop")).toBe(true);
    expect(isKnownHostKind("mobile")).toBe(false);
    expect(resolveHostKind(undefined)).toBe("desktop");
    expect(resolveHostKind(" SERVER ")).toBe("server");
    expect(resolveHostKind("mobile")).toBe("mobile");
  });

  it("creates a host identity with optional host instance identity", () => {
    const identity = createHostIdentity(" SERVER ", { id: " server-east-1 " });

    expect(identity).toEqual({
      kind: "server",
      id: "server-east-1",
    });
  });

  it("rejects empty host identity ids", () => {
    expect(() => createHostIdentity("server", { id: "   " })).toThrow(
      `Host id must be ${HOST_ID_FORMAT_DESCRIPTION}. Received "   ".`,
    );
  });

  it("creates a host context with only host-neutral boundary metadata", () => {
    const context = createHostContext(
      {
        kind: " DESKTOP ",
        id: " desktop-main ",
      },
      {
        requestId: "req-301",
        correlationId: "corr-301",
        metadata: {
          " entryPoint ": "desktop.ipc",
          surface: "ui",
          placement: {
            tier: "host",
          },
        },
      },
    );

    expect(context).toEqual({
      host: {
        kind: "desktop",
        id: "desktop-main",
      },
      requestId: "req-301",
      correlationId: "corr-301",
      metadata: {
        entryPoint: "desktop.ipc",
        surface: "ui",
        placement: {
          tier: "host",
        },
      },
    });
  });

  it("rejects host-context metadata that introduces session or framework semantics", () => {
    expect(() =>
      normalizeHostContextMetadata({
        sessionToken: "abc",
      }),
    ).toThrow(
      'Host context metadata must be a plain object containing JSON-serializable values and no auth/session/request/window/framework semantics. Metadata key "sessionToken" introduces a non-goal semantic.',
    );
  });

  it("rejects host-context metadata that is not JSON-serializable", () => {
    expect(() =>
      createHostContext("desktop", {
        metadata: {
          createdAt: new Date("2026-04-14T00:00:00.000Z") as unknown as string,
        },
      }),
    ).toThrow(
      'Host context metadata must be a plain object containing JSON-serializable values and no auth/session/request/window/framework semantics. Received non-plain object at "metadata.createdAt".',
    );
  });

  it("creates host context from host-kind input while normalizing host id", () => {
    const context = createHostContext("desktop", {
      hostId: "desktop-main",
      requestId: "req-301",
      correlationId: "corr-301",
      metadata: {
        entryPoint: "desktop.ipc",
        surface: "ui",
      },
    });
    expect(context.host).toEqual({
      kind: "desktop",
      id: "desktop-main",
    });
  });
});
