import { describe, expect, it } from "../../../../testing/node-test";

import {
  INITIAL_NOTIFICATION_CENTER_STATE,
  NOTIFICATION_ACTIVE_LIMIT,
  NOTIFICATION_HISTORY_LIMIT,
  notificationCenterReducer,
  sanitizeNotificationMessage,
  sanitizeNotificationProgress,
  visibleNotificationRecords,
  type NotificationRecord,
} from "../notificationState";

function record(id: string, overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id,
    kind: "message",
    message: id,
    tone: "info",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    unread: true,
    ...overrides,
  };
}

describe("notification center state", () => {
  it("redacts secrets, paths, stack lines, controls, and bounds public copy", () => {
    const sanitized = sanitizeNotificationMessage(
      "token=super-secret C:\\Users\\someone\\models\\a.bin\n    at privateStack (/tmp/worker.js:1)\u0000",
      80,
    );
    expect(sanitized).toContain("token=[redacted]");
    expect(sanitized).toContain("[local path]");
    expect(sanitized).not.toContain("super-secret");
    expect(sanitized).not.toContain("privateStack");
    expect(sanitized.length <= 80).toBe(true);
  });

  it("bounds history and independently bounds active activity", () => {
    let state = INITIAL_NOTIFICATION_CENTER_STATE;
    for (let index = 0; index < NOTIFICATION_HISTORY_LIMIT + 10; index += 1) {
      state = notificationCenterReducer(state, {
        type: "publish",
        record: record(`message-${index}`),
      });
    }
    expect(state.records.length).toBe(NOTIFICATION_HISTORY_LIMIT);

    for (let index = 0; index < NOTIFICATION_ACTIVE_LIMIT + 5; index += 1) {
      state = notificationCenterReducer(state, {
        type: "upsert-activity",
        record: record(`activity-${index}`, {
          kind: "activity",
          status: "running",
        }),
      });
    }
    expect(
      state.records.filter(
        (item) => item.kind === "activity" && item.status === "running",
      ).length,
    ).toBe(NOTIFICATION_ACTIVE_LIMIT);
  });

  it("filters records by authoritative workspace and retains global records", () => {
    let state = notificationCenterReducer(INITIAL_NOTIFICATION_CENTER_STATE, {
      type: "publish",
      record: record("global"),
    });
    state = notificationCenterReducer(state, {
      type: "publish",
      record: record("workspace-a", { workspaceId: "workspace-a" }),
    });
    state = notificationCenterReducer(state, {
      type: "publish",
      record: record("workspace-b", { workspaceId: "workspace-b" }),
    });
    state = notificationCenterReducer(state, {
      type: "set-workspace",
      workspaceId: "workspace-a",
    });
    expect(visibleNotificationRecords(state).map((item) => item.id)).toEqual([
      "workspace-a",
      "global",
    ]);
  });

  it("does not regress terminal activity to a stale running update", () => {
    let state = notificationCenterReducer(INITIAL_NOTIFICATION_CENTER_STATE, {
      type: "upsert-activity",
      record: record("task-1", { kind: "activity", status: "succeeded" }),
    });
    state = notificationCenterReducer(state, {
      type: "upsert-activity",
      record: record("task-1", { kind: "activity", status: "running" }),
    });
    expect(state.records[0]?.status).toBe("succeeded");
  });

  it("clamps structured progress and removes invalid fields", () => {
    expect(
      sanitizeNotificationProgress({
        current: -1,
        total: Number.POSITIVE_INFINITY,
        percent: 140,
        unit: "bytes",
      }),
    ).toEqual({ percent: 100, unit: "bytes" });
  });
});
