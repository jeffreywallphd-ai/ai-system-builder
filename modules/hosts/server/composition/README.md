# Server host composition

Managed Data presentation routes exact source/version/accepted-task selections
through the shared Data metadata reader under current request organization,
workspace, principal and artifact-read policy. Existing consent/delivery owns
lease and document fences. Transient tasks require durable same-host/actor
acceptance before processor lookup. Separate window registration grants no
execution/status/review/save authority. Revocation removes display and context,
preserving owned tasks and immutable versions; no provider or model call starts.

## Restrict automatic ComfyUI setup

Set `COMFYUI_AUTO_INSTALL=0` in the server host environment to disable automatic
ComfyUI installation and dependency repair during image runtime startup. The
host snapshots this policy before composition effects. An unset value or `1`
preserves the existing automatic setup behavior. Other values stop composition
with a fixed configuration error. Restart the host after changing the setting.

Before every start with automatic setup disabled, the host reads managed install
metadata for the exact root, target and official Git source. Missing, unconfirmed
or mismatched metadata stops startup with a fixed error. No installation or repair
is attempted by this read-only check.

Explicit installer operations and Python runtime setup remain separate. This
setting does not prove file integrity or import readiness, block the launched runtime's
own network activity, or authorize model downloads. Qualification profiles must
still verify prerequisites and own the process and its runtime files.

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

`composeServerHost` wires server-host lifecycle dependencies while keeping transport setup thin.

The managed headless authoring service composes the shared System Builder
against the authenticated request organization. It checks the current
workspace and membership again inside the transaction that owns a save
and its durable retry receipt. It rechecks access before returning a
successful result. The service accepts only an already verified agent
registration. A transport route is a separate composition step.

The managed plan client uses its own verified registration. The server loads
the next approved change from the saved plan and commits it with its durable
receipt. It checks that permission and approval still apply before sending
the successful result. This uses exact row locks in PostgreSQL.

Each managed browser tab registers a short-lived proof. A different bearer
for the same user and registered browser client cannot reuse that proof.
Workspace policy governs registration. The existing takeover authority
still requires separate user consent for presentation.

The managed browser consent composition reuses the window authority for
request, consent, readiness and revoke. An application policy read and a
live browser document are required. A separate fence prevents a closed
request from creating a prompt or granting consent after a held policy read.

Browser presentation reuses the bounded delivery queue after the caller
proves its exact lease. The queue tracks a saved-resource command and its
separate receipt. A browser can provide current context only in response to
a short-lived, single-use challenge for the same lease.

Managed browser presentation resolves saved system revisions, components,
validation, run status and artifact catalog metadata through the existing
workspace repositories. A live matching lease gates delivery, receipts and
fresh context. Runs and artifacts require their existing read scopes. These
operations do not change saved resources or stop independent tasks.

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

## Managed saved-state replay

`AI_SYSTEM_BUILDER_MANAGED_SAVED_STATE=1` enables the bounded System Builder
snapshot and replay routes on PostgreSQL hosts with OIDC and organization
authorization. Existing editing paths in that composition write journal events in
the same transaction as the saved system. Each read uses current workspace policy
and the verified bearer lifetime. Omit the setting and restart to retire the routes
while preserving saved records and their journal. This slice supports scoped
polling and a header-authenticated server event stream. The window controls have
separate qualification.

The current OIDC verifier can expose the signed client ID of a typed access
token internally. This does not change ordinary authentication or activate
agent and interactive access.

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

Website ingestion receives the organization-scoped canonical artifact catalog
for compensation. The application removes exact new capture catalog entries
only after corresponding byte cleanup succeeds; existing authorization, object
storage and native recovery controls remain authoritative.

Managed Headless Context metadata reads require the verified plan-review client
and current organization/workspace artifact/model permissions. The shared
preview composition uses organization-partitioned saved repositories and a
recorded-only model registry. It resolves no Context runtime, extraction,
dependency installation or task. Strict reply readers keep private commands,
paths and source content out of HTTP and MCP results.

## Installed-only Context runtime

Managed composition configures the fixed async installed verifier, binds the
foundation to its owning task reconciler and separately guards restrictive
readiness and the Python business POST. Ordinary dependency preparation is not
used by this path. The foundation retains installation policy through shared
worker recovery and checks host admission at the actual spawn boundary. Source
configuration checks accompany focused foundation/Desktop causal tests; they do
not assert a live Managed Context journey, model execution or public plan wiring.

Managed Headless plan review composes the same source-derived Context-pack step
when the platform supplies stable publication. Current tenant/client/workspace
policy and exact source/license metadata fence reserve and one-use issue. The
shared installed-only owner runs outside the database transaction. Accepted-only
`context.task` lookup precedes lazy processor access and rechecks current policy.
HTTP/MCP and browser approval readers reconstruct exact v6 permissions. No raw
source, path, prompt or embedding is returned; review and save remain separate.

The internal Context owner composes the same saved-model application resolver
with the existing configured Hugging Face and Transformers cache roots. It uses
recorded metadata and bounded existing-file inspection after approval; there is
no discovery, installation or network download fallback. Current model/actor
authority surrounds resolution. Private runtime references are excluded from
portable manifests. These cooperative checks do not qualify a public RAG effect,
physical model resources or native custody.

The Managed plan and browser approval owners separately opt into version-7 local
RAG generation under stable publication. Approval/read/decision and execution
use the model/source/plan permissions for that exact RAG request; ordinary Data
and pack permissions keep their existing scope. Atomic issue recompiles the
saved-model witness, and bounded accepted-task review still needs separate save.
Fixture passes are not physical retrieval, resource, query/display or native proof.

Structured Managed composition supplies the same private Context result-byte
and owned-output ports. The publisher uses the existing captured organization
provider mapping; the task owner supplies private file selection. The shared
result-save metadata composition accepts only the platform root transaction and
a trusted exact-save policy/approval callback. It performs no runtime/provider
work in that transaction. This is internal support, not an advertised save
action or real provider/model/native qualification.
