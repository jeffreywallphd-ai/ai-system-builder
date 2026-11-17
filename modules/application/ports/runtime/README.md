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
