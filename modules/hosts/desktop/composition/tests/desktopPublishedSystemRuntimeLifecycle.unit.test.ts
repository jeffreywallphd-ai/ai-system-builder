import assert from "node:assert/strict";
import test from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeSystemReleaseId } from "../../../../contracts/system-build";
import { systemDeploymentSuccess } from "../../../../contracts/system-deployment";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createDesktopPublishedSystemRuntimeLifecycle } from "../desktopPublishedSystemRuntimeLifecycle";

const command = {
  organizationId: createOrganizationId("org-runtime-lifecycle"),
  workspaceId: createWorkspaceId("workspace-runtime-lifecycle"),
  actorId: "person-runtime",
  releaseId: normalizeSystemReleaseId("release-runtime-lifecycle"),
  action: "start" as const,
  expectedRevision: "revision-1",
};

test("opens visual starts and closes the exact release on stop", async () => {
  const calls: string[] = [];
  const lifecycle = {
    async execute(input: typeof command) {
      calls.push(input.action);
      return systemDeploymentSuccess({
        schemaVersion: "1.0" as const,
        releaseId: input.releaseId,
        state:
          input.action === "start"
            ? ("running" as const)
            : ("active-stopped" as const),
        revision: input.action === "start" ? "revision-2" : "revision-3",
        eligibleActions:
          input.action === "start" ? ["stop" as const] : ["start" as const],
        health:
          input.action === "start" ? ("ready" as const) : ("stopped" as const),
        runtimeKind: "visual" as const,
        launchDescriptor: {
          schemaVersion: "1.0",
          kind: "trusted-declarative",
        } as never,
        diagnostics: [],
      });
    },
  };
  const opened: unknown[] = [];
  const closed: unknown[] = [];
  const controller = { open: async () => ({}) as never };
  const wrapped = createDesktopPublishedSystemRuntimeLifecycle({
    lifecycle: lifecycle as never,
    controller,
    prepareRuntime: async () => {
      calls.push("prepare-runtime");
    },
    windows: {
      async open(query, received) {
        opened.push(query, received);
      },
      async close(query) {
        closed.push(query);
      },
    },
  });
  assert.equal((await wrapped.execute(command)).ok, true);
  assert.equal(opened.length, 2);
  await wrapped.execute({
    ...command,
    action: "stop",
    expectedRevision: "revision-2",
  });
  assert.equal(closed.length, 1);
  assert.deepEqual(calls, ["start", "prepare-runtime", "stop"]);
});

test("fails safely and compensates with Stop when runtime preparation fails", async () => {
  const actions: string[] = [];
  const lifecycle = {
    async execute(input: typeof command) {
      actions.push(input.action);
      return systemDeploymentSuccess({
        schemaVersion: "1.0" as const,
        releaseId: input.releaseId,
        state:
          input.action === "start"
            ? ("running" as const)
            : ("active-stopped" as const),
        revision: input.action === "start" ? "revision-2" : "revision-3",
        eligibleActions:
          input.action === "start" ? ["stop" as const] : ["start" as const],
        health: "ready" as const,
        runtimeKind: "visual" as const,
        launchDescriptor: {
          schemaVersion: "1.0",
          kind: "trusted-declarative",
        } as never,
        diagnostics: [],
      });
    },
  };
  const wrapped = createDesktopPublishedSystemRuntimeLifecycle({
    lifecycle: lifecycle as never,
    controller: { open: async () => ({}) as never },
    prepareRuntime: async () => {
      throw new Error("C:\\private\\runtime-startup");
    },
    windows: {
      async open() {
        assert.fail("The window must not open when runtime preparation fails.");
      },
      async close() {},
    },
  });
  const result = await wrapped.execute(command);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.error.message,
      "The published system window could not be opened.",
    );
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
  assert.deepEqual(actions, ["start", "stop"]);
});

test("fails safely and compensates with Stop when the visual window cannot open", async () => {
  const actions: string[] = [];
  const lifecycle = {
    async execute(input: typeof command) {
      actions.push(input.action);
      return systemDeploymentSuccess({
        schemaVersion: "1.0" as const,
        releaseId: input.releaseId,
        state:
          input.action === "start"
            ? ("running" as const)
            : ("active-stopped" as const),
        revision: input.action === "start" ? "revision-2" : "revision-3",
        eligibleActions:
          input.action === "start" ? ["stop" as const] : ["start" as const],
        health: "ready" as const,
        runtimeKind: "visual" as const,
        launchDescriptor: {
          schemaVersion: "1.0",
          kind: "trusted-declarative",
        } as never,
        diagnostics: [],
      });
    },
  };
  const wrapped = createDesktopPublishedSystemRuntimeLifecycle({
    lifecycle: lifecycle as never,
    controller: { open: async () => ({}) as never },
    prepareRuntime: async () => undefined,
    windows: {
      async open() {
        throw new Error("C:\\private\\runtime-window");
      },
      async close() {},
    },
  });
  const result = await wrapped.execute(command);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(
      result.error.message,
      "The published system window could not be opened.",
    );
    assert.equal(JSON.stringify(result).includes("private"), false);
  }
  assert.deepEqual(actions, ["start", "stop"]);
});

test("stops the exact started revision when the published window closes", async () => {
  const commands: Array<{ action: string; expectedRevision: string }> = [];
  let onWindowClosed: (() => Promise<void>) | undefined;
  const lifecycle = {
    async execute(input: typeof command) {
      commands.push({
        action: input.action,
        expectedRevision: input.expectedRevision,
      });
      return systemDeploymentSuccess({
        schemaVersion: "1.0" as const,
        releaseId: input.releaseId,
        state:
          input.action === "start"
            ? ("running" as const)
            : ("active-stopped" as const),
        revision: input.action === "start" ? "revision-2" : "revision-3",
        eligibleActions:
          input.action === "start" ? ["stop" as const] : ["start" as const],
        health:
          input.action === "start" ? ("ready" as const) : ("stopped" as const),
        runtimeKind: "visual" as const,
        launchDescriptor: {
          schemaVersion: "1.0",
          kind: "trusted-declarative",
        } as never,
        diagnostics: [],
      });
    },
  };
  const wrapped = createDesktopPublishedSystemRuntimeLifecycle({
    lifecycle: lifecycle as never,
    controller: { open: async () => ({}) as never },
    prepareRuntime: async () => undefined,
    windows: {
      async open(_query, _controller, closeHandler) {
        onWindowClosed = closeHandler;
      },
      async close() {},
    },
  });

  assert.equal((await wrapped.execute(command)).ok, true);
  assert.ok(onWindowClosed);
  await onWindowClosed();

  assert.deepEqual(commands, [
    { action: "start", expectedRevision: "revision-1" },
    { action: "stop", expectedRevision: "revision-2" },
  ]);
});
