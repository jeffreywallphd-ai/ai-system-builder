import { describe, expect, it } from "../../../testing/node-test";
import {
  MAX_SYSTEM_RUN_WORKFLOW_FIELDS,
  SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  normalizeSystemRunWorkflowProfile,
  normalizeSystemRunWorkflowSnapshot,
  normalizeSystemRunWorkflowValues,
  type SystemRunWorkflowProfileSummary,
  type SystemRunWorkflowSnapshot,
} from "..";

const profile = (): SystemRunWorkflowProfileSummary => ({
  schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  profileId: "builtin.workflow.records@1.0.0",
  source: {
    kind: "approved-release",
    sourceId: "release-1",
    sourceDigest: `sha256:${"a".repeat(64)}`,
    label: "Approved release",
  },
  title: "Manage records",
  description: "Create and review records through the approved release.",
  category: "data",
  availability: "available",
  blockers: [],
});

const snapshot = (): SystemRunWorkflowSnapshot => ({
  schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  profile: profile(),
  snapshotRevision: "snapshot-1",
  refreshedAt: "2026-07-29T00:00:00.000Z",
  blocks: [
    {
      blockId: "records",
      kind: "table",
      title: "Records",
      columns: [{ columnId: "name", label: "Name" }],
      rows: [{ rowId: "record-1", values: { name: "Request" } }],
    },
  ],
  actions: [
    {
      actionId: "create",
      label: "Create record",
      description: "Create one record.",
      intent: "mutate",
      emphasis: "normal",
      requiresConfirmation: true,
      enabled: true,
      fields: [
        {
          fieldId: "name",
          label: "Name",
          kind: "text",
          required: true,
          maximumLength: 240,
        },
      ],
    },
  ],
});

describe("system run workflow contracts", () => {
  it("normalizes a bounded profile and snapshot", () => {
    expect(normalizeSystemRunWorkflowProfile(profile())).toEqual(profile());
    expect(normalizeSystemRunWorkflowSnapshot(snapshot())).toEqual(snapshot());
  });

  it("requires confirmation for state-changing actions", () => {
    const value = snapshot();
    expect(() =>
      normalizeSystemRunWorkflowSnapshot({
        ...value,
        actions: [
          {
            ...value.actions[0]!,
            requiresConfirmation: false,
          },
        ],
      }),
    ).toThrow(/require confirmation/i);
  });

  it("rejects dynamic values and oversized input maps", () => {
    expect(() =>
      normalizeSystemRunWorkflowValues({
        handler: () => "execute",
      }),
    ).toThrow(/scalar/i);
    expect(() =>
      normalizeSystemRunWorkflowValues(
        Object.fromEntries(
          Array.from(
            { length: MAX_SYSTEM_RUN_WORKFLOW_FIELDS + 1 },
            (_, index) => [`field-${index}`, "value"],
          ),
        ),
      ),
    ).toThrow(/cannot contain more/i);
  });

  it("rejects unsafe identities, unknown versions, and inconsistent blockers", () => {
    expect(() =>
      normalizeSystemRunWorkflowProfile({
        ...profile(),
        profileId: "../runtime",
      }),
    ).toThrow(/safe identifier/i);
    expect(() =>
      normalizeSystemRunWorkflowProfile({
        ...profile(),
        schemaVersion: "2.0" as "1.0",
      }),
    ).toThrow(/version/i);
    expect(() =>
      normalizeSystemRunWorkflowProfile({
        ...profile(),
        availability: "blocked",
      }),
    ).toThrow(/require a blocker/i);
    expect(() =>
      normalizeSystemRunWorkflowProfile({
        ...profile(),
        source: {
          kind: "approved-release",
          sourceId: "release-1",
          label: "Release without digest",
        },
      }),
    ).toThrow(/require a digest/i);
  });
});
