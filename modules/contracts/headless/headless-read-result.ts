import type { SystemBuilderRecord, SystemBuilderTemplateId } from "../system-builder";
import type { WorkspaceId } from "../workspace";
import {
  HEADLESS_CONTRACT_VERSION,
  type HeadlessHostIncarnationId,
  type HeadlessReadOperation,
  type HeadlessReadRequestParseResult,
} from "./headless-read-request";

export type HeadlessSystemSummary = Pick<
  SystemBuilderRecord, "systemId" | "name" | "status" | "revision" | "currentRevisionId"
>;

export type HeadlessReadResult =
  | {
      readonly ok: true;
      readonly operation: "host.describe";
      readonly value: {
        readonly version: typeof HEADLESS_CONTRACT_VERSION;
        readonly hostIncarnationId: HeadlessHostIncarnationId;
        readonly workspaces: readonly WorkspaceId[];
        readonly operations: readonly HeadlessReadOperation[];
      };
    }
  | { readonly ok: true; readonly operation: "workspaces.list"; readonly value: readonly {
      readonly workspaceId: WorkspaceId; readonly displayName: string;
    }[] }
  | { readonly ok: true; readonly operation: "systems.list"; readonly value: readonly HeadlessSystemSummary[] }
  | { readonly ok: true; readonly operation: "systems.read"; readonly value: HeadlessSystemSummary }
  | { readonly ok: true; readonly operation: "templates.list"; readonly value: readonly {
      readonly templateId: SystemBuilderTemplateId; readonly displayName: string;
    }[] }
  | {
      readonly ok: false;
      readonly code: Extract<HeadlessReadRequestParseResult, { ok: false }>["code"] |
        "headless.forbidden" | "headless.unavailable" | "headless.not-found" | "headless.result-too-large";
    };
