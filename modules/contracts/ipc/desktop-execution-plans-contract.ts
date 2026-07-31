import { createIpcChannel } from "./ipc-channel";

export const DESKTOP_EXECUTION_PLANS_CREATE_PLAN_REQUEST_CHANNEL = createIpcChannel("execution-plans.create-plan", "request");
export const DESKTOP_EXECUTION_PLANS_VALIDATE_PLAN_REQUEST_CHANNEL = createIpcChannel("execution-plans.validate-plan", "request");
export const DESKTOP_EXECUTION_PLANS_ARCHIVE_PLAN_REQUEST_CHANNEL = createIpcChannel("execution-plans.archive-plan", "request");
export const DESKTOP_EXECUTION_PLANS_LIST_SUMMARIES_REQUEST_CHANNEL = createIpcChannel("execution-plans.list-summaries", "request");
export const DESKTOP_EXECUTION_PLANS_READ_DETAIL_REQUEST_CHANNEL = createIpcChannel("execution-plans.read-detail", "request");
export const DESKTOP_EXECUTION_PLANS_LIST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL = createIpcChannel("execution-plans.list-for-composition-plan", "request");
export const DESKTOP_EXECUTION_PLANS_READ_LATEST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL = createIpcChannel("execution-plans.read-latest-for-composition-plan", "request");
export const DESKTOP_EXECUTION_PLANS_LIST_FOR_RUNTIME_READINESS_BINDING_REQUEST_CHANNEL = createIpcChannel("execution-plans.list-for-runtime-readiness-binding", "request");
export const DESKTOP_EXECUTION_PLANS_READ_LATEST_FOR_RUNTIME_READINESS_BINDING_REQUEST_CHANNEL = createIpcChannel("execution-plans.read-latest-for-runtime-readiness-binding", "request");
export const DESKTOP_EXECUTION_PLANS_LIST_NEEDING_ATTENTION_REQUEST_CHANNEL = createIpcChannel("execution-plans.list-needing-attention", "request");
export const DESKTOP_EXECUTION_PLANS_SUMMARIZE_WORKSPACE_REQUEST_CHANNEL = createIpcChannel("execution-plans.summarize-workspace", "request");
