import { describe, expect, it } from "../../../testing/node-test";
import { normalizeAcceptedArtifactUploadPolicy } from "../../../domain";
import { mapAcceptedArtifactUploadPolicyToContract } from "../artifact-upload/mapAcceptedArtifactUploadPolicyToContract";

describe("mapAcceptedArtifactUploadPolicyToContract", () => {
  it("maps the domain policy shape to contract policy shape", () => {
    const domainPolicy = normalizeAcceptedArtifactUploadPolicy({
      acceptedMediaTypes: [" image/png ", "text/plain"],
      acceptedExtensions: ["png", ".txt"],
    });

    const contractPolicy = mapAcceptedArtifactUploadPolicyToContract(domainPolicy);

    expect(contractPolicy).toEqual({
      acceptedMediaTypes: ["image/png", "text/plain"],
      acceptedExtensions: [".png", ".txt"],
    });
  });
});
