# Runtime Port

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

Application runtime orchestration depends on this port, not concrete adapters.

- `RuntimeExecutionPort` consumes `RuntimeExecutionRequest`
- returns `RuntimeExecutionResult`
- can emit optional `RuntimeExecutionEvent` updates through handlers

Concrete Node/Python integrations belong in runtime adapters, which implement this port.
