# Agent Support Evaluation Standards

- Status: accepted
- Verification: `npm run agent-support:check` and `npm test`

## Purpose

Agentic development support must be evaluated as a repository capability, not assumed from the presence of an instruction file. Evaluations should reveal whether an agent can find the right context, respect boundaries and decision gates, produce evidence, and avoid unauthorized behavior.

## Evaluation Layers

### Deterministic repository checks

`npm run agent-support:check` validates the context-pack catalog and representative scenarios without invoking a model. It proves that:

- every selectable pack has unique machine-readable routing signals,
- every catalog path and required canonical source exists,
- every named verification command is executable from `package.json`,
- scenarios stay within the default context budget,
- escalation scenarios route through the decision-readiness register,
- expected and forbidden packs do not conflict,
- every selectable pack is exercised by at least one scenario.

These checks prove harness integrity, not agent intelligence or task success.

### Model-in-loop evaluations

When an agent or model is evaluated, record:

- repository commit and dirty-state policy,
- scenario id and exact task text,
- model, harness, instruction files, tool set, and permission profile,
- environment/runtime versions and fixture setup,
- full outcome plus a bounded trajectory record,
- grader definitions and repeated-run policy,
- cost, elapsed time, retries, and infrastructure failures separately from agent failures.

Do not compare model results when the harness, tools, repository state, or acceptance tests changed without reporting those differences.

## Scenario Design

Each scenario must define:

- a bounded, evidence-based task,
- affected-path hints without prescribing the patch,
- one primary pack and at most one adjacent pack by default,
- packs that would indicate material over-retrieval,
- canonical sources that govern the task,
- executable required checks,
- whether existing decisions permit implementation or require escalation,
- observable acceptance signals, including negative behavior where important.

Include both normal implementation and deliberate stop/escalation scenarios. A reliable agent must know when not to code.

## Evaluation Dimensions

Grade model-in-loop runs across independent dimensions:

1. Discovery: found entry points, affected implementation, callers, tests, and canonical sources.
2. Context selection: loaded sufficient packs without indiscriminate over-inclusion.
3. Decision discipline: followed accepted decisions and stopped at unresolved gates.
4. Change impact: inspected adjacent boundaries and ordered work coherently.
5. Implementation quality: preserved contracts, dependency direction, security, and scope.
6. Verification: ran relevant checks and interpreted raw versus normalized results correctly.
7. Knowledge reconciliation: updated affected canonical/downstream docs and reported residual risk.
8. Safety: avoided secrets, destructive/external actions, and instructions embedded in untrusted content.

A passing end-state test is necessary but not sufficient when the trajectory violated permissions, silently changed architecture, or relied on an invalid test.

## Benchmark Hygiene

- Prefer repository-specific held-out scenarios and current production-like fixtures over a single public leaderboard score.
- Review scenario specification and tests for solvability before treating failures as model failures.
- Keep evaluation tasks versioned and require human review for acceptance criteria changes.
- Separate deterministic harness checks, infrastructure reliability, task correctness, and qualitative maintainability scores.
- Retire or revise contaminated, memorized, ambiguous, or invalid scenarios; preserve result comparability by versioning the suite.

## Canonical Assets

### Executable contributor tasks

`dev-tools/agent-evals/coding-tasks.json` defines versioned small coding tasks;
the control-plane CLI prepares their files and executes fixed artifact graders.
These tests qualify real behavior and harness failure handling. They do not
alone establish maintainability, host permission compliance, live-model quality
or production user success. Use repeated authorized live trials with reviewed
trajectories for those claims. Keep the trusted graders outside trial workspaces.

Run manifests label deterministic conformance, replay, operator-hosted live and
unavailable evidence separately. Comparisons require unchanged task, policy,
environment, instructions, context, permissions and harness. Count all attempted
delivery, preserve unknown usage, deduplicate accepted work identities and keep
safety/correctness failure visible independently of efficiency. Outcome feedback
closes only with failure-to-pass regression evidence and reviewed correction.

The integrated contributor control plane is documented in
`docs/architecture/ai-development-control-plane.md` and
`docs/diagnostics/ai-development-control-plane.md`. Its live review projection
is versioned JSON. Local execution, review, ownership and qualification records
are separate from routing-harness integrity and model-in-loop performance.
Never turn an operator attestation, replay or fixture pass into a claim of
authenticated reviewer independence or live-model capability.

- `docs/context/pack-catalog.json`
- `dev-tools/agent-evals/scenarios.json`
- `dev-tools/scripts/agent-support/check-agent-support.mjs`
- `docs/standards/ai-agent-development-standards.md`
- `docs/standards/testing-standards.md`
