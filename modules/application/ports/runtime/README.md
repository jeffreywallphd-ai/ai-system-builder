# Runtime Port

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Application runtime orchestration depends on this port, not concrete adapters.

- `RuntimeExecutionPort` consumes `RuntimeExecutionRequest`
- returns `RuntimeExecutionResult`
- can emit optional `RuntimeExecutionEvent` updates through handlers

Concrete Node/Python integrations belong in runtime adapters, which implement this port.

`DatasetPreparationSourceHasherPort` verifies authorized OCR input bytes independently
of optional dataset-version storage. It returns canonical `sha256:` plus 64 lowercase
hexadecimal characters. The existing storage SHA adapter satisfies this thin role;
hashing does not authorize an artifact or permit a caller-supplied runtime map.
OCR stage owners remain private to application orchestration. Unconfirmed
allocation, cleanup or start effects retain their exact attempts and prevent
another OCR admission; no port exposes an arbitrary cleanup or reset operation.

`LocalDatasetPreparationAdmission` is trusted internal wiring for the separate
local provided-row start path. It is never serialized in a command or context.
The host must bind durable plan/actor/source identity and acknowledge one exact
issuance before runtime warming or dispatch. A callback is not user authority.
The profile verifies at most four 4 MiB structured sources, requires local JSONL
and quality review, and retains at most four pending attempts. Runtime-stop proof
and confirmed cleanup release unknown staging; timeout, lost permission and a
missing task record do not. Public Headless execution is not composed by this port.
