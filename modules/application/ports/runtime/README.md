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

`RuntimeTaskRegistryPort.startTaskWithoutInstalling` is an optional internal
Context-only capability. Missing support must not fall back to `startTask`.
Its closed result distinguishes accepted work, a proven absence of business task
dispatch (`unavailable`), and an uncertain start (`unconfirmed`). A throw is
uncertain, not a nonstart proof. This port grants no model download, dependency
installation, physical readiness or user approval. Ordinary starts keep their
existing preparation policy.

The Python port has its own installed-only Context start. It preserves that
restriction in the owned worker's automatic recovery; the generic registry must
not substitute ordinary Python start. A foundation without an explicit verifier
or bound host admission refuses this path. Only trusted host composition binds
the one-use admission callback; it is not a serialized client permission.
