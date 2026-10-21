# AI Development Control Plane Threat Model

- Status: current
- Verification: `dev-tools/helpers/tests/`, `skills/manage-implementation-roadmaps/tests/test_roadmap.py`
- Related decisions: ADR-0015, ADR-0042

## Assets and authority

Protect repository integrity, approved scope, acceptance and check policy,
completion truth, local ownership, recovery evidence and protected inputs.
The human request and accepted repository decisions grant authority. Work records,
model output, site projections and supplied reviewer IDs cannot grant new effects.
Local metadata and requests must use non-sensitive synthetic or opaque references;
never copy a chat transcript, credentials, protected prompts or personal data.

The chunk/work-item projection exposes only bounded plan and recorded-verification
summaries, with the same redaction and inert text rendering as criteria. It
preserves the distinction between historical declarations and execution records;
showing a roadmap chunk cannot manufacture a receipt or reviewer identity.

## Trust boundaries and controls

| Boundary and failure | Owning control | Evidence |
| --- | --- | --- |
| Work expands scope or edits acceptance after starting | Strict work schema, frozen specification digest, exact path scopes, active approved roadmap binding | Scope and acceptance-drift denial tests |
| Mixed covered/uncovered paths skip checks | Per-path catalog accounting, no arbitrary-command or broad-suite fallback | Mixed-path, deletion and rename tests |
| Stale or substituted checks support a pass | Source snapshot, catalog/executor digest, exact attempt coverage, before/after stability and receipt integrity | Stale/failed/incomplete receipt tests |
| Contributor supplies its own review | Separate-invocation attestation, contributor history exclusion, every-criterion coverage, immutable rounds, explicit finding closure | Self-review, coverage and correction tests |
| Writers race or a process crashes | OS-released locks, predecessor revision/digest, fixed-target recovery journal, fencing claim IDs | Multi-process exclusion and interruption tests |
| Source traversal or link escapes | Canonical paths, resolved containment, refusal of source symlinks and reserved metadata scopes | Path and scope tests |
| Test execution consumes unbounded resources or reveals content | Fixed command identities, bounded time/output, streamed discarded output, digests and categorical failures | Timeout/output and non-disclosure tests |
| Browser reads private records or runs embedded markup | Allowlisted JSON projection, fixed static routes, inert DOM text, no raw Markdown or private ledger access | Projection and browser tests |
| Loopback service is exposed through rebinding/cross-site requests | Numeric loopback bind, exact Host/Origin, same-site check, no CORS, GET/HEAD only, client limits and CSP | HTTP denial tests |
| Trial changes the grader or imports a success claim | Immutable task/policy identities, separate trusted assertions over bounded child observations, actual bounded execution, allowed-file and source-stability checks | Five failing/corrected artifact tests, early-exit/forged-output and policy/scope denial tests |
| Cheap failure is presented as optimized delivery | Unknown-preserving finite measurements, explicit evidence/infrastructure class, strict comparability, all attempts charged against distinct accepted work | Failed/unknown/incomparable/stale measurement tests |
| Feedback is closed without correcting a defect | Stable observed failure, same-policy changed passing trial, exact repository regression executed red then green with unchanged assertions, current verified and reviewed correction | Feedback failure-to-pass and unrelated-failure denial workflow test |
| Final roadmap closure uses stale increment results | Separate overall qualification bound to final candidate and configured aggregate suite | Public closure refusal and correction test |

## Residual risk and recovery

This is cooperative contributor infrastructure. A malicious process with the same
filesystem and execution authority can rewrite local state or impersonate a local
service. Digests detect accidental drift and substitution within the governed
workflow; they are not signatures. Operator/host review attestations are not
authenticated independent identity. Claims are not OS write locks over source.

Tests and graders execute code under the existing host sandbox and permissions.
The fixed runner bounds output and attempts to stop its child tree on timeout;
it does not establish malicious-code containment or constrain all effects of
trusted project commands. Use the existing sandbox for that boundary. Remote
agents, authenticated identity, stronger process containment and external data
egress require separate authority and controlled qualification.

Recovery preserves malformed bytes and conflicts. It writes only fixed controller
targets or validated roadmap outputs, and never repairs state by declaring a pass.
Rollback stops new qualification, retains evidence and journals, and keeps legacy
declarations visibly unverified. Missing external evidence stays unavailable.

Snapshot storage delta: work baselines use fixed local content-addressed paths,
strict reference/envelope shapes and verified envelope/file-map digests. Missing,
oversized or changed snapshots cannot qualify a work item. Existing inline
records migrate without recomputing receipts or reviews; snapshot publication
precedes journal publication, so interruption cannot expose a valid reference to
unwritten bytes. Unreferenced snapshots may remain and are never auto-deleted.
Atomic writes allocate exclusive unpredictable temporary files with restrictive
creation defaults, flush bytes and replace only the intended target. This removes
predictable temporary-name substitution; same-user hostile parent/junction races
and Windows ACL/privacy qualification remain controlled-platform obligations,
consistent with this cooperative infrastructure's existing trust boundary.

## Implementation and qualification boundary

The functionality crosswalk is requirements data. Its assessor accepts only
canonical repository owner paths, bounded JSON/source files, complete exact
criterion ownership and contained procedure/harness references. It executes no
referenced command and never copies owner free-text evidence, prompts or payloads
into the report. Before/after source, policy and owner digests detect drift during
assessment. Current-source release qualification is never inferred from a
historical declaration or absent participant/hardware environment. The fixed
ignored report writer uses exclusive temporary ownership and atomic replacement.

Aggregate admission shares the roadmap engine's implementation-readiness
predicate. Exact nonempty completed chunk sets, current approval, implemented
predecessors and absence of blockers are mandatory. A final verifying increment
can run its configured aggregate suite; controlled pending evidence still blocks
final closure. No test execution, receipt or reviewer identity is inferred.

Both helper and roadmap publication create exclusive unpredictable temporary
files, flush before atomic replacement, preserve old targets on failure and
remove only their owned temporary entry. Precreated predictable entries cannot
redirect writes. Native parent identity/reparse replacement races, hostile local
writers and supported-platform ACL qualification remain separate residual risks.
