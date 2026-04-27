import { createTransportOperation } from "../transport";

const ARTIFACT_READ_OPERATION_SEGMENTS = ["artifact", "read"] as const;

export const ARTIFACT_READ_OPERATION = createTransportOperation(
  ...ARTIFACT_READ_OPERATION_SEGMENTS,
);
