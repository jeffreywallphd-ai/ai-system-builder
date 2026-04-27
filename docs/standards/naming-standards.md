# Naming Standards

## Purpose

Names in `ai-system-builder` must reveal architectural role, not just implementation convenience.

Good naming should make it obvious:

- which layer owns the code,
- whether a unit is a use case, contract, adapter, host component, or UI element,
- what dependency direction is intended.

If a reviewer has to open a file to guess its role, the name is weak.

## General naming rules

- Prefer clear, explicit names over short or clever names.
- Use domain and use-case language consistently across domain, application, contracts, and adapters.
- Keep file names aligned with primary exported responsibility.
- Avoid catch-all names unless the scope is truly broad and intentional.

Discouraged by default:

- `utils`, `helpers`, `common`, `misc`, `manager`, `service`.

If one of these is unavoidable, narrow it with role + domain context (for example `agent-runtime-error-mapper.ts`, not `utils.ts`).

## Folder naming

- Use `kebab-case` for folders.
- Folder names should reflect architectural responsibility.
- Keep top-level and module folder names consistent with ADR-0001 and architecture docs.

Examples:

- `modules/adapters/persistence/postgres/`
- `modules/adapters/transport/express/`
- `modules/hosts/desktop/`

Do not create vague folder buckets such as `modules/common/` or `modules/misc/` to bypass boundary discipline.

## File naming

- Use `kebab-case` for TypeScript file names.
- Name files after their primary role.
- Prefer suffixes that signal role when helpful.

Examples:

- `create-project.use-case.ts`
- `project-repository.port.ts`
- `postgres-project-repository.adapter.ts`
- `http-create-project.presenter.ts`
- `project-contract.ts`

## TypeScript symbol naming

- Types, interfaces, classes, enums: `PascalCase`.
- Functions, variables, parameters: `camelCase`.
- Constants: `UPPER_SNAKE_CASE` for true constants; otherwise `camelCase`.

Use role-revealing suffixes where appropriate:

- `...UseCase`
- `...Port`
- `...Repository`
- `...Adapter`
- `...Mapper`
- `...Presenter`
- `...Request` / `...Response`

Avoid generic `Service` names when a more precise role exists (`UseCase`, `Repository`, `Adapter`, `Gateway`, `Presenter`).

## Application use case naming

Use action-oriented names in application layer.

- Preferred: verb + object (`CreateWorkspaceUseCase`, `ListProjectRunsUseCase`).
- File names should mirror symbol intent (`create-workspace.use-case.ts`).

Avoid passive or vague naming like `WorkspaceProcessor`, `WorkspaceManager`, or `WorkspaceService` when the behavior is a concrete use case.

## Port and adapter naming

Ports should describe required capability from the perspective of application/domain.

- `ProjectRepositoryPort`
- `ArtifactStoragePort`
- `RuntimeExecutionPort`

Adapters should identify both role and implementation.

- `PostgresProjectRepositoryAdapter`
- `LocalFsArtifactStorageAdapter`
- `ExpressProjectTransportAdapter`
- `ElectronIpcProjectTransportAdapter`

Do not name adapters only by technology (`PostgresAdapter`) or only by role (`RepositoryAdapter`).

## Contract naming

Contracts must communicate boundary usage explicitly.

- Request/response DTOs: `CreateProjectRequest`, `CreateProjectResponse`.
- Envelope/command/event names should be explicit and stable.
- Contract files should map to the contract surface (`project-runtime-contract.ts`, `project-http-contract.ts`).

Do not mix unrelated boundaries in a single generic `contracts.ts` file.

## Operation identity naming

Operation identifiers used in contract families must follow a shared format.

- Use lowercase dot-separated segments with at least two segments.
- Segment characters are limited to `a-z`, `0-9`, and internal hyphen (`-`).
- Prefer operation helpers (`create...Operation` / `normalize...Operation`) from contract families over ad hoc string assembly.

Examples:

- `workspace.create`
- `runtime.tool.run`
- `project-run.retry`

Operation identity is transport-neutral. Do not prefix operation names with transport namespaces such as `api.` or `ipc.`.

Avoid unconstrained operation strings such as `WorkspaceCreate`, `workspace_create`, or single-segment names like `workspace`.

## IPC channel naming

IPC channel identifiers must stay mechanically linked to operation identity.

- Use `ipc.<operation>.<kind>` as the only supported channel format.
- `<operation>` must be a valid operation identity from the shared operation helper rules.
- `<kind>` must be one of: `request`, `response`, `event`.
- Prefer IPC channel creation/parsing helpers over ad hoc channel string assembly.

Examples:

- `ipc.workspace.create.request`
- `ipc.runtime.tool.run.response`

Avoid channel values unrelated to operation identity such as:

- `desktop.workspace.create.request`
- `workspace.create.channel-a`

## UI component and hook naming

- React components: `PascalCase` (`ProjectListPanel.tsx`).
- Hooks: `camelCase` with `use` prefix (`useProjectList.ts`).
- Component file names should match component names.
- Shared UI should use names that remain valid across desktop/web when placed in `modules/ui/shared/`.

Avoid UI names tied to infrastructure details (for example `PostgresSettingsPanel`) unless the screen is explicitly infrastructure-facing.

## Test naming

- Test files should indicate unit under test and test level.
- Recommended patterns:
  - `*.unit.test.ts`
  - `*.integration.test.ts`
  - `*.ui.test.tsx`

Describe behavior in test titles with explicit expectation language.

- `returns not-found when project id is unknown`
- `maps runtime timeout to execution-timeout error`

Avoid ambiguous names like `should work` or `basic test`.

## Documentation and ADR naming

- ADR files: `ADR-XXXX-short-title.md` (zero-padded number).
- Standards/architecture docs: clear kebab-case names by topic.
- Keep document title aligned with filename.

Examples:

- `docs/standards/logging-standards.md`
- `docs/architecture/module-dependency-rules.md`
- `docs/adr/ADR-0004-persistence-and-storage-separation.md`

## Rename rule

When code responsibility changes, rename files/symbols to match new responsibility in the same change when practical.

Do not leave outdated names that preserve historical implementation artifacts but obscure current intent.
