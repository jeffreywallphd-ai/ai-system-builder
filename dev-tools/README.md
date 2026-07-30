> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Developer tools

Repository-owned scripts live under `dev-tools/scripts`. Portable contributor
helpers for recurring Codex and verification loops live under
`dev-tools/helpers`; see its README for configuration and safety boundaries.

User-invoked cross-agent workflows are different: their canonical definitions
live under `skills/`. The implementation-roadmap skill may describe when to
use a bounded helper, but its workflow state engine remains with the skill and
generic checks and patch transport remain here.

## Test orchestration

`npm test` runs the short unit and interaction loop. `npm run test:long` runs
integration, end-to-end, and explicitly marked long-duration files. Use
`npm run test:all` for both groups after all roadmap increments are implemented.
The Node and Vitest runners discover their owned files independently and write
duration-ranked JSON reports under `artifacts/test-reports/`.
