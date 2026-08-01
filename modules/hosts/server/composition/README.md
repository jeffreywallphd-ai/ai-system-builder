# Server host composition

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`composeServerHost` wires server-host lifecycle dependencies while keeping transport setup thin.

Current composition includes:

- artifact-object storage via filesystem adapter,
- local artifact catalog for browse/detail/content metadata seams,
- artifact upload and artifact browser use cases,
- artifact-repo storage composition with provider dispatch,
- first artifact-repo provider registration: Hugging Face.

The server host keeps artifact-object and artifact-repo storage families as peer capabilities. It does not flatten them into a single universal storage abstraction.



Route composition now includes:

- artifact upload + artifact browser routes over artifact-object storage/catalog stack, and
- artifact-repo routes (`/api/artifact-repo/has`, `/api/artifact-repo/store`) via dedicated repo-storage use cases, and
- dataset-preparation start/read/approve/cancel routes backed by the shared application
  use case, runtime task registry, artifact storage/repository ports, and server
  runtime-readiness guard; the host also composes the default quality-policy
  provider so a requested review cannot fall back to an absent authority.
- Context Management read/write routes backed by the same generation, browser,
  retrieval, delete, task-registry, artifact, and authorization composition as
  desktop. SQLite/ZIP parsing and vector ranking remain in the managed Python
  runtime rather than the API process or thin client.

Current artifact-repo provider registration is Hugging Face only.

## Hugging Face token configuration

- Managed server composition resolves Hugging Face credentials through the
  active authenticated organization and the centralized authorization service.
  The generic Settings API uses the same credential service and cannot create a
  second process-global secret slot.
- Managed legacy/environment credentials are ignored unless
  `huggingFaceCredentialMigrationOrganizationId` explicitly assigns them to one
  organization. Migration writes the organization record atomically before
  retiring the legacy file.
- Deployment-local modes retain the single host-owned compatibility store.
- Thin-client artifact-repo operations run through this server host path, so thin-client access to private/gated Hugging Face repos depends on server-side token configuration.
- Public Hugging Face repos may work without a token; private/gated repos may return explicit auth-required (`unavailable`) errors for register/localize/publish/verify flows.

## Privileged policy composition

- Managed update/clear setting use cases authorize below transport. Ordinary
  members cannot mutate shared settings; PyTorch/CUDA source and shared model
  folder changes require an owner or administrator.
- Missing provider repositories remain missing unless the publish request
  carries explicit creation approval and visibility. Managed host composition
  then authorizes `provider-repository:create` for the active organization
  before the adapter performs any provider create request.
- Local/desktop hosts keep the same explicit approval contract without
  requiring a managed organization authorizer.

## Image generation FaceID behavior (thin-client/server)

- Thin-client image generation supports optional FaceID input with up to 3 face reference artifact IDs.
- The server/runtime adapter chooses the ComfyUI workflow shape from request inputs:
  - prompt + negative prompt only,
  - latent reference + prompts,
  - FaceID + prompts,
  - latent reference + FaceID + prompts.
- FaceID requests are prepared from workspace-owned catalog artifacts through
  the bounded viewer-media seam. Only signature-verified PNG, JPEG, or WebP
  inputs are staged under contained randomized ComfyUI input names, and staged
  files are cleaned after terminal or failed execution.
- The default server workflow avoids custom InstantID/InsightFace nodes so the feature remains usable with the managed ComfyUI install.
- When no explicit latent reference is provided, the first FaceID reference is used as the image-to-image latent source for facial retention.
