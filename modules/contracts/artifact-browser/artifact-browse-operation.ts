import { createTransportOperation } from "../transport";

const ARTIFACT_BROWSE_OPERATION_SEGMENTS = ["artifact", "browse"] as const;

export const ARTIFACT_BROWSE_OPERATION = createTransportOperation(
  ...ARTIFACT_BROWSE_OPERATION_SEGMENTS,
);
