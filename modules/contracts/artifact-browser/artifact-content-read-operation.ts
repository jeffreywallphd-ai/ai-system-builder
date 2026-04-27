import { createTransportOperation } from "../transport";

const ARTIFACT_CONTENT_READ_OPERATION_SEGMENTS = [
  "artifact",
  "content",
  "read",
] as const;

export const ARTIFACT_CONTENT_READ_OPERATION = createTransportOperation(
  ...ARTIFACT_CONTENT_READ_OPERATION_SEGMENTS,
);
