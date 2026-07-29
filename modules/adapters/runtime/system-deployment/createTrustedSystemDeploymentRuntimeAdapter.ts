import type { SystemDeploymentRuntimePort } from "../../../application/ports/system-deployment";
import type { SystemDeploymentReleaseBindingResolution } from "../../../application/services/system-deployment";
import type { AssetImplementationDeploymentProfile } from "../../../contracts/asset-implementation";
import {
  SYSTEM_RUNTIME_PROFILE_IDS,
  normalizeSystemDeploymentRuntimeIdentity,
  type SystemDeployment,
  type SystemDeploymentDiagnostic,
  type SystemDeploymentHealth,
  type SystemDeploymentRuntimeKind,
  type SystemRuntimeProfileId,
} from "../../../contracts/system-deployment";

const TRUSTED_RUNTIME_PROFILES = new Set<SystemRuntimeProfileId>([
  SYSTEM_RUNTIME_PROFILE_IDS.securedDataEntry,
  SYSTEM_RUNTIME_PROFILE_IDS.controlledChatbot,
  SYSTEM_RUNTIME_PROFILE_IDS.securedDataReview,
]);

export interface CreateTrustedSystemDeploymentRuntimeAdapterOptions {
  readonly deploymentProfiles: readonly AssetImplementationDeploymentProfile[];
  readonly now?: () => string;
  readonly verifyReferenceRelease?: (
    deployment: SystemDeployment,
  ) => Promise<boolean>;
  readonly resolveReleaseBindings?: (
    deployment: SystemDeployment,
  ) => Promise<SystemDeploymentReleaseBindingResolution>;
  readonly classifyRuntime?: (
    deployment: SystemDeployment,
  ) => SystemDeploymentRuntimeKind;
}

export function createTrustedSystemDeploymentRuntimeAdapter(
  options: CreateTrustedSystemDeploymentRuntimeAdapterOptions,
): SystemDeploymentRuntimePort {
  const now = options.now ?? (() => new Date().toISOString());
  const supportsProfile = (profile: AssetImplementationDeploymentProfile) =>
    options.deploymentProfiles.includes(profile) && profile !== "thin-client";
  const ready = (
    diagnostics: readonly SystemDeploymentDiagnostic[] = [],
  ): SystemDeploymentHealth => ({
    status: diagnostics.some((item) => item.severity === "error")
      ? "not-ready"
      : "ready",
    checkedAt: now(),
    diagnostics,
  });

  return {
    supportsRuntimeProfile: (profileId) =>
      TRUSTED_RUNTIME_PROFILES.has(profileId),
    async inspect(deployment) {
      const diagnostics: SystemDeploymentDiagnostic[] = [];
      let runtimeProfileId: SystemRuntimeProfileId | undefined;
      try {
        runtimeProfileId =
          normalizeSystemDeploymentRuntimeIdentity(deployment).runtimeProfileId;
      } catch {
        // The public diagnostic remains intentionally non-sensitive.
      }
      if (!runtimeProfileId || !TRUSTED_RUNTIME_PROFILES.has(runtimeProfileId))
        diagnostics.push(
          error(
            "deployment.runtime.unavailable",
            "Only product-compiled reference runtimes are available.",
          ),
        );
      if (!supportsProfile(deployment.deploymentProfile))
        diagnostics.push(
          error(
            "deployment.profile.unavailable",
            "This host does not own the selected deployment profile.",
          ),
        );
      if (deployment.compatibility.sandboxRequired)
        diagnostics.push(
          error(
            "deployment.sandbox-unavailable",
            "Imported or authored execution requires a separately qualified sandbox adapter.",
          ),
        );
      return {
        ready: diagnostics.length === 0,
        diagnostics,
      };
    },
    async activate(deployment) {
      let runtimeProfileId: SystemRuntimeProfileId | undefined;
      try {
        runtimeProfileId =
          normalizeSystemDeploymentRuntimeIdentity(deployment).runtimeProfileId;
      } catch {
        // Fail closed below.
      }
      if (
        !runtimeProfileId ||
        !TRUSTED_RUNTIME_PROFILES.has(runtimeProfileId) ||
        !supportsProfile(deployment.deploymentProfile) ||
        deployment.compatibility.sandboxRequired
      )
        return ready([
          error(
            "deployment.runtime.unavailable",
            "The deployment runtime is unavailable on this host.",
          ),
        ]);
      if (
        options.verifyReferenceRelease &&
        !(await options.verifyReferenceRelease(deployment))
      )
        return ready([
          error(
            "deployment.runtime.release-invalid",
            "The release-bound reference runtime could not verify its manifest.",
          ),
        ]);
      if (
        runtimeProfileId === SYSTEM_RUNTIME_PROFILE_IDS.controlledChatbot &&
        !options.resolveReleaseBindings
      )
        return ready([
          error(
            "deployment.runtime.binding-authority-unavailable",
            "The release-bound runtime configuration is unavailable.",
          ),
        ]);
      if (options.resolveReleaseBindings) {
        try {
          const bindings = await options.resolveReleaseBindings(deployment);
          if (bindings.status !== "ready")
            return ready([
              error(
                `deployment.runtime.${bindings.code}`,
                bindings.message,
              ),
            ]);
        } catch {
          return ready([
            error(
              "deployment.runtime.binding-unavailable",
              "The release-bound runtime configuration is unavailable.",
            ),
          ]);
        }
      }
      return ready([
        {
          severity: "info",
          code: "deployment.runtime.ready",
          message: "The release-bound trusted runtime is ready.",
        },
      ]);
    },
    async deactivate() {},
    async health(deployment) {
      return this.activate(deployment);
    },
    async start(deployment) {
      const health = await this.activate(deployment);
      if (health.status !== "ready")
        return { status: "failed", diagnostics: health.diagnostics };
      const runtimeProfileId =
        normalizeSystemDeploymentRuntimeIdentity(deployment).runtimeProfileId;
      const runtimeKind = options.classifyRuntime?.(deployment) ?? "visual";
      let bindings: SystemDeploymentReleaseBindingResolution | undefined;
      if (options.resolveReleaseBindings) {
        try {
          bindings = await options.resolveReleaseBindings(deployment);
        } catch {
          return {
            status: "failed",
            diagnostics: [
              error(
                "deployment.runtime.binding-unavailable",
                "The release-bound runtime configuration is unavailable.",
              ),
            ],
          };
        }
      }
      if (bindings?.status === "denied")
        return {
          status: "failed",
          diagnostics: [
            error(`deployment.runtime.${bindings.code}`, bindings.message),
          ],
        };
      return {
        status: "running",
        runtimeKind,
        ...(runtimeKind === "visual"
          ? {
              launchDescriptor: {
                schemaVersion: "1.0" as const,
                kind: "trusted-declarative" as const,
                releaseId: deployment.releaseId,
                releaseDigest: deployment.releaseDigest,
                runtimeProfileId,
                ...(bindings?.status === "ready"
                  ? {
                      runtimeResourceBindings: bindings.resourceBindings,
                      runtimeInteractionBindings: bindings.interactionBindings,
                    }
                  : {}),
              },
            }
          : {}),
        diagnostics: [
          {
            severity: "info",
            code: "deployment.runtime.session-running",
            message:
              "The trusted release-bound runtime session is running.",
          },
        ],
      };
    },
    async cancel() {},
  };
}

const error = (code: string, message: string): SystemDeploymentDiagnostic => ({
  severity: "error",
  code,
  message,
});
