# Host Context Contracts

Shared host context contracts for passing host metadata across boundaries without
leaking framework objects.

Current scope is intentionally small:

- host kind vocabulary (`host-kind`)
- host identity shape (`host-identity`)
- host context envelope for boundary metadata (`host-context`)

These contracts must stay host-agnostic and serialization-friendly.

Do not add Electron window objects, HTTP request objects, or session/auth models
to this contract family.

Guardrails enforced by this family:

- host ids are normalized to non-empty trimmed strings when provided
- host context metadata accepts only JSON-serializable values
- host context metadata rejects auth/session/request/window/framework semantics
