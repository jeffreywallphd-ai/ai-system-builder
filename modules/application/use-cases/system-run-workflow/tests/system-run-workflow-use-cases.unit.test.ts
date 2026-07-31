import { describe, expect, it } from "../../../../testing/node-test";
import type { SystemRunWorkflowHandlerPort } from "../../../ports/system-run-workflow";
import {
  SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  systemRunWorkflowFailure,
  systemRunWorkflowSuccess,
  type SystemRunWorkflowProfileSummary,
  type SystemRunWorkflowSnapshot,
} from "../../../../contracts/system-run-workflow";
import { createSystemRunWorkflowUseCases } from "..";

const digest = `sha256:${"a".repeat(64)}` as const;
const actor = {
  actorId: "actor-1",
  roles: ["owner"],
  authenticated: true,
} as const;
const profile = (): SystemRunWorkflowProfileSummary => ({
  schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  profileId: "builtin.workflow.records@1.0.0",
  source: {
    kind: "approved-release",
    sourceId: "release-1",
    sourceDigest: digest,
    label: "Release 1",
  },
  title: "Manage records",
  description: "Manage records for an approved release.",
  category: "data",
  availability: "available",
  blockers: [],
});
const snapshot = (): SystemRunWorkflowSnapshot => ({
  schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  profile: profile(),
  snapshotRevision: "snapshot-1",
  blocks: [],
  actions: [],
  refreshedAt: "2026-07-29T00:00:00.000Z",
});

const createHandler = () => {
  const calls = { discover: 0, prepare: 0, invoke: 0 };
  const handler: SystemRunWorkflowHandlerPort = {
    profileId: profile().profileId,
    async discover() {
      calls.discover += 1;
      return systemRunWorkflowSuccess([profile()]);
    },
    async prepare() {
      calls.prepare += 1;
      return systemRunWorkflowSuccess(snapshot());
    },
    async invoke() {
      calls.invoke += 1;
      return systemRunWorkflowSuccess(snapshot());
    },
  };
  return { calls, handler };
};

describe("system run workflow use cases", () => {
  it("discovers profiles without preparing or invoking handlers", async () => {
    const { calls, handler } = createHandler();
    const useCases = createSystemRunWorkflowUseCases({ handlers: [handler] });
    const result = await useCases.listProfiles.execute({
      workspaceId: "workspace-1",
    }, actor);
    expect(result.ok).toBe(true);
    expect(calls).toEqual({ discover: 1, prepare: 0, invoke: 0 });
  });

  it("rejects duplicate handlers at composition", () => {
    const { handler } = createHandler();
    expect(() =>
      createSystemRunWorkflowUseCases({ handlers: [handler, handler] }),
    ).toThrow(/duplicate/i);
  });

  it("fails closed for unsupported profiles and dynamic inputs", async () => {
    const { handler } = createHandler();
    const useCases = createSystemRunWorkflowUseCases({ handlers: [handler] });
    const unsupported = await useCases.prepare.execute({
      workspaceId: "workspace-1",
      profileId: "unknown.workflow@1.0.0",
      source: profile().source,
    }, actor);
    expect(unsupported).toEqual(
      systemRunWorkflowFailure(
        "workflow.unsupported",
        "The workflow profile is not supported by this host.",
        "profileId",
      ),
    );
    const invalid = await useCases.invoke.execute({
      workspaceId: "workspace-1",
      profileId: handler.profileId,
      source: profile().source,
      actionId: "create",
      operationId: "operation-1",
      values: { code: (() => "execute") as never },
    }, actor);
    expect(invalid.ok).toBe(false);
    expect(invalid.ok ? "" : invalid.error.code).toBe("workflow.validation");
  });

  it("rejects inconsistent handler sources", async () => {
    const { handler } = createHandler();
    const useCases = createSystemRunWorkflowUseCases({
      handlers: [
        {
          ...handler,
          async prepare() {
            return systemRunWorkflowSuccess({
              ...snapshot(),
              profile: {
                ...profile(),
                source: {
                  ...profile().source,
                  sourceId: "release-2",
                },
              },
            });
          },
        },
      ],
    });
    const result = await useCases.prepare.execute({
      workspaceId: "workspace-1",
      profileId: handler.profileId,
      source: profile().source,
    }, actor);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error.code).toBe("workflow.failed");
  });

  it("propagates handler denials without exposing implementation detail", async () => {
    const { handler } = createHandler();
    const useCases = createSystemRunWorkflowUseCases({
      handlers: [
        {
          ...handler,
          async invoke() {
            return systemRunWorkflowFailure(
              "workflow.unauthorized",
              "This workflow action is not authorized.",
            );
          },
        },
      ],
    });
    const result = await useCases.invoke.execute({
      workspaceId: "workspace-1",
      profileId: handler.profileId,
      source: profile().source,
      actionId: "create",
      operationId: "operation-1",
      values: {},
    }, actor);
    expect(result).toEqual(
      systemRunWorkflowFailure(
        "workflow.unauthorized",
        "This workflow action is not authorized.",
      ),
    );
  });
});
