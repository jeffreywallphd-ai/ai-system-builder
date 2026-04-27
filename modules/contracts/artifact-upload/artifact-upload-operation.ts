import { createTransportOperation } from "../transport";

const ARTIFACT_UPLOAD_OPERATION_SEGMENTS = ["artifact", "upload"] as const;
const ARTIFACT_UPLOAD_POLICY_READ_OPERATION_SEGMENTS = ["artifact", "upload-policy", "read"] as const;

export const ARTIFACT_UPLOAD_OPERATION = createTransportOperation(
  ...ARTIFACT_UPLOAD_OPERATION_SEGMENTS,
);

export const ARTIFACT_UPLOAD_POLICY_READ_OPERATION = createTransportOperation(
  ...ARTIFACT_UPLOAD_POLICY_READ_OPERATION_SEGMENTS,
);
