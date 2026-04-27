# Runtime Port

Application runtime orchestration depends on this port, not concrete adapters.

- `RuntimeExecutionPort` consumes `RuntimeExecutionRequest`
- returns `RuntimeExecutionResult`
- can emit optional `RuntimeExecutionEvent` updates through handlers

Concrete Node/Python integrations belong in runtime adapters, which implement this port.
