# ADR-0045: Optional Bounded Model Offloading

- Status: accepted
- Date: 2026-10-22
- Deciders: ai-system-builder maintainers
- Related: ADR-0010, ADR-0013, ADR-0015, ADR-0042, ADR-0043

## Context

Whole-model admission can deny local inference on a busy lightweight PC. The user
selected optional Accelerate offloading and approved its roadmap after review.
The managed Transformers/Accelerate dependencies already support parameter
dispatch. A separate AirLLM engine adds supplier and runtime work; its inspected
loading paths enable remote model code. It is not selected.

## Decision

Add the explicit, default-off `offload-v1` profile to the existing managed local
causal/chat generation adapter. Omitted and explicit `standard` preserve current
loading. An exact versioned capability must gate dispatch: an older worker may
ignore unknown fields and must never silently execute the requested profile.
This decision authorizes implementation; advertise support only after its actual
loader, lifecycle and readiness wiring exists.

The profile bounds parameter placement to 1 GiB CPU and 2 GiB accelerator and
all owned persistent/temporary staging to 12 GiB. Placement limits are not a
whole-process quota. Reserve the largest execution layer and bounded input,
batch, token, KV/activation and runtime headroom; unknown or insufficient resource
facts deny opt-in. Select only inspected CPU-plus-disk or CUDA/CPU/disk mappings;
unsupported all-disk maps, oversized layers, LoRA, seq2seq and quantized opt-in
combinations fail explicitly. Standard support for those combinations remains.

Use verified local safetensors with explicit dtype and device, no remote code,
pickle or network, and no implicit overflow, precision change or fallback.
Prefer verified original safe-weight references where the pinned loader supports
them. Avoid or explicitly own secondary state-dict temporary directories before
library writes; bound index/tensor counts and byte arithmetic. Do not redirect
process-global temporary directories or accept caller filesystem paths.

Private staging and source references belong to cached-generator leases, with
aggregate model/staging bounds and profile-aware reuse identity. Keep referenced
bytes live across task completion until the last generator lease releases.
Prove that selected-path teardown does not reconstruct the full model. Failed or
unconfirmed cleanup retains ownership for retry or confirmed process exit.
Preserve current queued cancellation and truthful unsupported running dataset
cancellation; this option does not authorize stopping the shared worker.

## Qualification and consequences

The reviewed roadmap requires default compatibility, old-worker denial,
containment, admission, model-cache lifecycle, failure/cleanup and automated UI
tests plus installed CPU/GPU quality/resource measurements. Freeze each profile's
precision, schema, prompts and oracle. A denied baseline supplies no paired
timing, memory or quality result. Current completed-output acceptance is the
user-approved 30 percent floor for 0.5B and 80 percent for 1.5B; resource-admission
denials have no accuracy outcome. Reuse the verified accepted quality evidence;
do not rerun accuracy for closure. Preserve the original 95 percent/no-lost-case
protocols and failed comparisons as history. Actual optional offload still needs
its own resource, delivery and lifecycle evidence: Standard results do not qualify
that feature or its native protection. Report slower disk streaming explicitly.
The new opt-in qualification's 4 GiB sampled RSS abort budget is not a hard
allocation guarantee; the historical generator's 6 GiB abort remains unchanged.

No new model acquisition, dependency/version change, human acceptance or
retroactive pass of another roadmap is authorized. Untested hardware and native
race/ACL guarantees remain separate. Withdraw only opt-in support if qualification
fails, retaining standard behavior, owned cleanup and all failed evidence.

## Guarded qualification restart direction

After clarification, the user approved preserving/protecting the exact retained
temporary qualification slot and counting it within the same 12 GiB domain. At
most one fresh lease may be admitted after genuine native protection and combined
capacity are proven. Unknown retained usage consumes the full ceiling; a new
process, root, marker or serialized calculation cannot restore capacity. Failure
to prove protection keeps actual restart and model qualification pending.

The first implementation component is a read-only readiness gate and immutable
budget arithmetic, explicitly non-authoritative. The current native identity
mechanism cannot fence tree growth, security changes through existing handles or
guardian-crash lifetime. Readiness therefore reports
`native-staging-protection-not-implemented` without old-slot access or new worker/
staging effects. The optional qualification plan includes this recovery status;
ordinary empty-root lease behavior remains unchanged. JSON snapshots grant no
native capability or durable/protected journal authority.

The full protection provider, protected journal, lifetime-bound owned-job
integration and actual optional resource/lifecycle measurements remain missing
implementation or qualification. Completed model accuracy is not reopened.
This direction does not authorize unknown-byte adoption/deletion,
quota reset, relaxed metrics, privilege enablement, a new service/driver/account,
or stronger claims for the completed read-only helper. The owning operations guide
distinguishes gate/accounting evidence from a functioning guarded restart.
