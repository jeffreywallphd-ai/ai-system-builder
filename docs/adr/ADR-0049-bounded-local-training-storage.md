# ADR-0049: Replaceable bounded local storage for approved training

- Status: accepted
- Date: 2026-11-26
- Authority: User directs a separate reusable protected-storage roadmap and
  completion of Headless Increment 7 using replaceable local storage.

The direction is accepted. Full profile implementation and qualification remain pending.

## Context

The approved Headless workflow needs actual bounded training, result review and
separately approved Save on Desktop and Managed hosts. Later implementation tasks
added strict Windows cross-process custody, protected global capacity and protected
restart recovery. Those stronger storage mechanisms remain unqualified. The user
has moved that work to the Reusable Protected Storage Service roadmap and selected
shared typed interfaces, with a protected service only where stronger custody is
needed. That service is not a prerequisite for the bounded local workflow.

## Decision

Implement an explicit bounded-local training storage profile behind the existing
application storage/task interfaces. Reuse contained filesystem operations, safe
local loading, original task ownership and current pinned dependencies. Keep
storage-specific creation, reads, retention and discard in adapters. The worker
and application use cases must not depend on a future service transport, service
identity, raw native handle or custom container format.

The local profile trusts the signed-in operating-system user and installed app
and training dependencies. It does not claim isolation from another hostile
process using that account. Safe model formats and disabled remote model code
remain mandatory; model files cannot supply an executable loader or callback.

Retain current actor/workspace/request/proposal/model/dataset bindings, exact
approval checks, safe local weights, offline/no-remote-code loading, finite file,
byte, metadata and duration limits, memory/process guards, available-disk checks,
allowlisted outputs, content hashes and explicit operation ownership. Track actual
local copies and retained results. Application limits and disk-headroom checks
are not an OS-enforced global physical quota or protected anti-rollback ledger.

Use only fresh task-owned staging, with contained paths and file identity/hash
checks. Stop new effects after cancellation or loss of authority. Await actual
original operations and worker/process retirement before cleanup. Unknown effects
remain retained and charged in the applicable local accounting; no retry, adoption,
Save or cleanup credit follows from a timeout, process ID or status string alone.
Read and save only the exact known candidate under separately current authority.
This profile does not authorize reading or changing historical protected trees.

The existing exclusive Native profile and its APIs remain unchanged, default-off
and unavailable until separately qualified. Never fall back from a requested
strict profile to bounded-local storage. Expose the selected profile and its
limits truthfully. Future protected-service adapters must satisfy their stronger
contract and qualify independently; sharing a port does not make guarantees equal.

## Deferred work

The Reusable Protected Storage Service roadmap owns the archived stronger physical
shared reservation, exclusive cross-process custody, protected retained accounting,
anti-rollback and protected crash/restart requirements. They remain pending there.
No service installation, privileged identity, administrator action or implementation
of that separate roadmap is approved by this decision.

## Verification

Increment 7 still requires real bounded fine-tuning, supported download/generation
and output import, progress, provenance, candidate review, separately approved Save,
resource refusal, cancellation/recovery and owned IO/worker/process cleanup on the
supported Desktop and Managed profiles. Test evaluation software with controlled
metrics. Do not repeat accepted model accuracy tests or score model quality for
this increment. Run feature-focused tests during implementation and combined final
qualification only after the roadmap implementation increments are complete.

Transferring requirements, selecting this profile, source tests and historical
component results supply no task, increment, Native, service or host pass. Preserve
all completed task definitions, original acceptance criteria, failed evidence and
separate final qualification requirements.

## References

- ADR-0043: Owned resource effects and private identities
- ADR-0047: Headless System Builder delegation
- Headless Skills UI Takeover implementation roadmap
- Reusable Protected Storage Service implementation roadmap and transfer map
