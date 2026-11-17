import { ASSET_PACKAGE_DEFAULT_MAX_BYTES, type InspectAssetPackageCommand, type AdmitAssetPackageCommand, type SetAssetPackageActivationCommand } from "../../../contracts/asset-package";

const byteLengthOf = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;

/** Own the fixed request values before an asynchronous policy or feature boundary. */
export function capturePackageInspection(command: InspectAssetPackageCommand): InspectAssetPackageCommand {
  const { workspaceId, actorId, bytes } = command;
  if (!(bytes instanceof Uint8Array) || byteLengthOf.call(bytes) > ASSET_PACKAGE_DEFAULT_MAX_BYTES) {
    throw new Error("Package upload exceeds the inspection limit or is invalid.");
  }
  // Buffer.slice aliases its source. This constructor copies typed-array slots and ignores caller iterators.
  return { workspaceId, actorId, bytes: new Uint8Array(bytes) };
}

export function capturePackageAdmission(command: AdmitAssetPackageCommand): AdmitAssetPackageCommand {
  const { workspaceId, inspectionId, packageDigest, approvalScope, actorId, approvedCapabilities } = command;
  return { workspaceId, inspectionId, packageDigest, approvalScope, actorId, approvedCapabilities: [...approvedCapabilities] };
}

export function capturePackageActivation(command: SetAssetPackageActivationCommand): SetAssetPackageActivationCommand {
  const { workspaceId, recordId, actorId } = command;
  return { workspaceId, recordId, actorId };
}
