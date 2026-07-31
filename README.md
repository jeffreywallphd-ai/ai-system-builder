# AI System Builder

> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

AI System Builder is a TypeScript platform for composing, running, and managing AI-enabled systems. Its clean module boundaries support an Electron desktop application, a server host, and a browser thin client, with deployment designs for local, institution-managed, and cloud environments.

## Start here

- Contributors and coding agents: read [`AGENTS.md`](AGENTS.md), then the [`docs` map](docs/README.md).
- Cross-agent implementation roadmaps: use the
  [repository roadmap skill](skills/manage-implementation-roadmaps/SKILL.md);
  natural-language requests are sufficient and do not require its exact name.
- Architecture: start with the [system overview](docs/architecture/system-overview.md) and [module dependency rules](docs/architecture/module-dependency-rules.md).
- Task context: load the [baseline context pack](docs/context/packs/index.pack.md), then use [prompt routing](docs/context/prompt-routing.md).
- Decisions and implementation rules: use the [ADR index](docs/adr/README.md) and [repository standards](docs/standards/).
- Deployment delivery: use the [multi-shape implementation roadmap](docs/deployment-readiness-implementation-roadmap.md); SQLite is the local structured-data target and PostgreSQL is the campus/corporate/cloud target.
- Asset and System Builder delivery: use the [asset/system composition implementation roadmap](docs/asset-system-composition-implementation-roadmap.md) for executable assets, Catalog and Studio workflows, functional system-default assets, system composition, builds, releases, and multi-shape execution.
- Local structured persistence is active in desktop composition through SQLite;
  first-run identity is explicit and generated, while legacy JSON import and
  organization assignment are rollback-preserving and fail-closed.
- Managed server shapes actively select PostgreSQL with fail-closed production
  OIDC, pooled organization tenancy by default, premium dedicated placement,
  forced row security, tenant-scoped object paths, migrations, readiness, and
  graceful drain. See the [tenancy architecture](docs/architecture/organization-tenancy-and-identity.md), then start with
  the [deployment templates](deployments/server/README.md) and
  [qualification procedure](docs/operations/deployment-qualification.md).

## Repository shape

- `apps/`: Electron desktop, server, and thin-client delivery surfaces.
- `modules/`: domain, contracts, application, adapter, host, runtime, UI, and shared capabilities.
- `docs/`: canonical decisions, architecture, standards, security guidance, diagnostics, and downstream context packs.
- `dev-tools/`: repository checks, test orchestration, and development utilities.
- `skills/`: portable, user-invoked Agent Skills workflows with repository
  tests and cross-agent installation guidance.
- `deployments/`: reviewed server image and platform-neutral qualification
  templates; environment-specific approval remains an operator responsibility.

## Local validation

Install dependencies with Node 24 from the tracked lockfile using `npm ci`, then use:

- `npm run security:dependencies` — zero-advisory production and toolchain policy
  plus production SPDX SBOM validation.

- `npm run docs:check` — documentation and context drift checks.
- `npm run architecture:check` — enforced module dependency direction.
- `npm run agent-support:check` — context catalog and agent-evaluation integrity.
- `npm test` / `npm run test:standard` — standard unit and interaction
  feedback.
- `npm run test:e2e` — integration and end-to-end coverage.
- `npm run test:ai` — opt-in tests that load or run AI components; use only
  for AI-related changes or an explicit request.
- `npm run test:standardande2e` — standard and end-to-end coverage together.
- `npm run test:all` — standard, end-to-end, and AI coverage; use only for
  AI-related changes or an explicit request.
- `npm run test:visual-composer` — one-worker packaged Windows desktop and
  local Chrome System Composer qualification; run `npm run package` first.
- `npm run build:server` — server build.
- `npm run build:thin-client` — thin-client build.
- `npm run persistence:sqlite -- <health|backup|restore|export> ...` — local
  database maintenance through the Electron runtime.
- `npm run persistence:postgres -- <health|export> ...` — managed database
  diagnostics and portable export.
- `npm run dev:desktop`, `npm run dev:server`, or `npm run dev:thin-client` — start a delivery surface.

See the [documentation map](docs/README.md) for authoritative sources and deployment guidance.
