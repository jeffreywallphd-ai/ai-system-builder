import type { SystemDeploymentRuntimePort } from "../../ports/system-deployment";
import type {
  InstallSystemDeploymentCommand,
  SystemDeploymentCompatibilityEvidence,
  SystemDeploymentDiagnostic,
  SystemRuntimeProfileId,
} from "../../../contracts/system-deployment";
import type { SystemRelease } from "../../../contracts/system-build";

const SANDBOX_RUNTIMES = new Set([
  "sandboxed-browser",
  "wasi-component",
  "isolated-worker",
]);

export class SystemDeploymentCompatibilityService {
  public constructor(private readonly runtime: SystemDeploymentRuntimePort) {}

  async evaluate(
    command: InstallSystemDeploymentCommand,
    release: SystemRelease,
    runtimeProfileId: SystemRuntimeProfileId,
    checkedAt: string,
  ): Promise<SystemDeploymentCompatibilityEvidence> {
    const diagnostics: SystemDeploymentDiagnostic[] = [];
    const runtimeKinds = [
      ...new Set(
        release.lock.resolvedImplementations.flatMap((item) =>
          item.facets.map((facet) => facet.runtimeKind),
        ),
      ),
    ].sort();
    const trustLevels = [
      ...new Set(
        release.lock.resolvedImplementations.map(
          (item) =>
            item.trustLevel ??
            (item.facets.every(
              (facet) =>
                facet.runtimeKind === "trusted-built-in" ||
                facet.runtimeKind === "declarative-engine",
            )
              ? "system-trusted"
              : "workspace-approved"),
        ),
      ),
    ].sort();
    const requiredCapabilities = [
      ...new Set(
        release.lock.resolvedImplementations.flatMap((item) =>
          item.facets.flatMap((facet) => facet.requiredCapabilities),
        ),
      ),
    ];
    const sandboxRequired =
      runtimeKinds.some((kind) => SANDBOX_RUNTIMES.has(kind)) ||
      trustLevels.some((level) => level !== "system-trusted");
    if (
      !release.compatibility.deploymentProfiles.includes(
        command.deploymentProfile,
      )
    )
      diagnostics.push(
        error(
          "deployment.profile.incompatible",
          "The release does not support this deployment profile.",
        ),
      );
    if (command.deploymentProfile === "thin-client")
      diagnostics.push(
        error(
          "deployment.thin-client.server-owned",
          "Thin clients cannot own privileged runtime execution.",
        ),
      );
    if (release.compatibility.hostApiVersion !== command.hostApiVersion)
      diagnostics.push(
        error(
          "deployment.host-api.incompatible",
          "The release host API version is incompatible.",
        ),
      );
    if (
      release.compatibility.runtimeAbiVersion &&
      release.compatibility.runtimeAbiVersion !== command.runtimeAbiVersion
    )
      diagnostics.push(
        error(
          "deployment.runtime-abi.incompatible",
          "The release runtime ABI version is incompatible.",
        ),
      );
    const hostCapabilities = new Set(command.hostCapabilities);
    if (
      requiredCapabilities.some(
        (capability) => !hostCapabilities.has(capability),
      )
    )
      diagnostics.push(
        error(
          "deployment.capability.unavailable",
          "A required host capability is unavailable.",
        ),
      );
    if (sandboxRequired && !command.sandboxQualified)
      diagnostics.push(
        error(
          "deployment.sandbox-unavailable",
          "A qualified sandbox is required for this release.",
        ),
      );
    if (!this.runtime.supportsRuntimeProfile(runtimeProfileId))
      diagnostics.push(
        error(
          "deployment.runtime.unavailable",
          "No qualified runtime mapping is available for this release.",
        ),
      );

    const preliminary: SystemDeploymentCompatibilityEvidence = {
      compatible: diagnostics.length === 0,
      deploymentProfile: command.deploymentProfile,
      hostApiVersion: command.hostApiVersion,
      ...(command.runtimeAbiVersion
        ? { runtimeAbiVersion: command.runtimeAbiVersion }
        : {}),
      runtimeKinds,
      trustLevels,
      sandboxRequired,
      sandboxQualified: command.sandboxQualified,
      checkedAt,
      diagnostics,
    };
    if (diagnostics.length === 0) {
      const runtime = await this.runtime.inspect({
        runtimeProfileId,
        deploymentProfile: command.deploymentProfile,
        compatibility: preliminary,
        policy: command.policy,
      });
      diagnostics.push(...runtime.diagnostics);
    }
    return {
      ...preliminary,
      compatible: diagnostics.every((item) => item.severity !== "error"),
      diagnostics,
    };
  }
}

const error = (code: string, message: string): SystemDeploymentDiagnostic => ({
  severity: "error",
  code,
  message,
});
