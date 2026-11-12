import { normalizeAssetId } from "../../../contracts/asset";
import { normalizeSystemBuildDigest, normalizeSystemReleaseId } from "../../../contracts/system-build";
import {
  systemBuilderFailure, systemBuilderSuccess, type PublishedSystemForm, type PublishedSystemFormSubmitInput,
  type PublishedSystemFormsInput, type SystemBuilderResult, type SystemFormSubmitResult,
} from "../../../contracts/system-builder";
import { createWorkspaceId } from "../../../contracts/workspace";
import type { SystemDataReleaseDefinitionPort, SystemDataResolvedDefinition } from "../../ports/system-data";
import type { ResolveSystemFormReleaseService, SystemFormReleaseSelection } from "../../services/system-builder/resolve-system-form-release.service";
import type { SubmitReleasedSystemFormUseCase, SystemFormExecutionAuthority } from "./submit-released-system-form.use-case";

export interface PublishedSystemFormRuntimeDependencies {
  readonly releases: Pick<ResolveSystemFormReleaseService, "list">;
  readonly records: SystemDataReleaseDefinitionPort;
  readonly submissions: Pick<SubmitReleasedSystemFormUseCase, "execute">;
}

export class PublishedSystemFormRuntime {
  public constructor(private readonly dependencies: PublishedSystemFormRuntimeDependencies) {}

  public async list(input: PublishedSystemFormsInput, authority: SystemFormExecutionAuthority): Promise<SystemBuilderResult<readonly PublishedSystemForm[]>> {
    try {
      const selection = readSelection(input);
      const admitted = await authority.readPrincipal();
      if (!admitted?.authenticated || admitted.actorId !== authority.actorId) return accessDenied();
      const actions = await this.dependencies.releases.list(selection);
      const eligible: { readonly form: PublishedSystemForm; readonly policy: SystemDataResolvedDefinition }[] = [];
      for (const action of actions) {
        const policy = await this.dependencies.records.resolve(
          selection.workspaceId, selection.releaseId, action.entityType, { formInstanceId: action.form.id },
        );
        if (policy?.descriptor.targetWorkspaceId === selection.workspaceId && policy.descriptor.releaseId === selection.releaseId &&
            policy.descriptor.entityType === action.entityType) eligible.push({ form: action.form, policy });
      }
      const current = await authority.readPrincipal();
      if (!current?.authenticated || current.actorId !== authority.actorId) return accessDenied();
      return systemBuilderSuccess(eligible.filter(({ policy }) => current.roles.some((role) => policy.rolesByAction.create.includes(role)))
        .map(({ form }) => form));
    } catch {
      return systemBuilderFailure("system-form.unavailable", "Could not open forms for this published build.");
    }
  }

  public async submit(input: PublishedSystemFormSubmitInput, authority: SystemFormExecutionAuthority): Promise<SystemBuilderResult<SystemFormSubmitResult>> {
    try {
      const selection = readSelection(input);
      const formId = normalizeAssetId(input.formId);
      if (formId !== input.formId || formId.length > 160) return systemBuilderSuccess({ status: "invalid" });
      const result = await this.dependencies.submissions.execute({ ...selection, formId,
        submissionId: input.submissionId, answers: input.answers }, authority);
      return systemBuilderSuccess(result);
    } catch {
      return systemBuilderFailure("system-form.unavailable", "Could not submit this published form.");
    }
  }
}

function readSelection(input: PublishedSystemFormsInput): SystemFormReleaseSelection {
  if (typeof input.releaseId !== "string" || !/^system-release:[a-f0-9]{64}$/.test(input.releaseId)) throw new Error("Invalid release identity.");
  const workspaceId = createWorkspaceId(input.workspaceId);
  const releaseId = normalizeSystemReleaseId(input.releaseId);
  const releaseDigest = normalizeSystemBuildDigest(`sha256:${input.releaseId.slice("system-release:".length)}`);
  return { workspaceId, releaseId, releaseDigest };
}

function accessDenied(): SystemBuilderResult<never> {
  return systemBuilderFailure("system-form.forbidden", "You cannot open forms in this workspace.");
}
