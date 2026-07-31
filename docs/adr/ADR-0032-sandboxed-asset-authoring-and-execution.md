# ADR-0032: Sandboxed Asset Authoring and Execution

- Status: accepted
- Date: 2026-07-17
- Deciders: ai-system-builder maintainers
- Related: ADR-0003, ADR-0006, ADR-0010, ADR-0013, ADR-0015, ADR-0029, ADR-0030, `docs/architecture/asset-authoring-and-execution-security.md`

## Context

Imported code and coding-model output are untrusted even when a package is signed. Electron has privileged Node and operating-system access, while Node's permission model explicitly is not a security boundary against malicious code. Coding agents also face prompt injection, dependency hallucination, credential disclosure, excessive tool use, and repository-scope drift.

## Decision

- Never evaluate imported/authored code in the Electron main process, preload, product renderer, API server process, or database process. `eval`, `Function`, unrestricted `vm`, dynamic host imports, and Node's permission model alone are prohibited execution boundaries.
- Trusted built-ins are compiled with the product and selected by a closed implementation registry. They still use declared capabilities and shared contracts.
- Untrusted UI preview/runtime uses a separate browser origin or sandboxed frame with Node disabled, context isolation, process sandboxing, restrictive CSP, blocked navigation/window creation, default-deny permissions, and a versioned validated message protocol. UI code receives data and actions only through a capability broker.
- Untrusted backend logic and build tools run out of process in a replaceable sandbox adapter. The managed target is an ephemeral rootless container/worker with a read-only base, bounded scratch space, non-root identity, CPU/memory/time/process limits, default-deny network, explicit mounts, and no host credentials. A WASI Preview 2 component adapter is permitted for portable capability-limited logic where the selected runtime/toolchain is qualified. Local desktop must fail closed when the required sandbox is unavailable.
- Secrets are opaque broker references. A sandbox never receives general environment credentials or host paths. Network, storage, model, data, audit, and user-interaction access require declared capabilities plus application authorization at call time.
- Asset source workspaces are separate from the product repository and published package store. Paths are canonicalized and constrained to the assigned workspace.
- A provider-neutral coding-model use case receives a bounded context pack, produces a plan and patch, and may use only allowlisted tools in the isolated source workspace. Network is denied unless an approved dependency operation grants a scoped destination. Production secrets are never mounted.
- Coding-model output cannot publish, sign, activate, deploy, approve its own changes, or modify the AI System Builder repository. Humans review the complete diff and explicitly approve publication after independent type, format, test, security, dependency, and policy gates.
- Every tool call, capability decision, build, test, cancellation, timeout, and approval is audit-recorded with safe redaction. Repository/package content is treated as untrusted instruction data, never higher-priority authority.

## Consequences

### Positive

- A compromise in an asset has a bounded path to platform capabilities.
- Coding assistance cannot silently alter or publish product code.
- Desktop, server, and cloud use the same capability contracts with different sandbox adapters.

### Negative

- Local authored/imported execution depends on a qualified sandbox runtime.
- Sandboxed previews cannot use arbitrary browser or Node APIs.
- Capability brokerage and worker lifecycle add latency and operational cost.

### Follow-up

- Threat-model and test each adapter; do not advertise untrusted execution before escape, quota, egress, and credential tests pass.
- Re-evaluate WASI runtime selection during qualification; the contract must not depend on a specific engine.
