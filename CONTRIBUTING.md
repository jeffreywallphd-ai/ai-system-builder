# Contributing to AI System Builder

Start with `AGENTS.md` and `docs/README.md`; the same architecture and evidence standards apply to human and automated contributions.

Before editing:

1. Use `docs/context/prompt-routing.md` to load only relevant context.
2. Apply `docs/standards/change-impact-matrix.md` to the affected boundary.
3. Check `docs/adr/decision-readiness.md` before architecture-sensitive work.
4. Keep the change bounded and preserve unrelated work.

Before opening a pull request, run the applicable checks:

- `npm run docs:check`
- `npm run architecture:check`
- `npm test`
- `npm run build:server` or `npm run build:thin-client` when that delivery surface changes

Use `.github/PULL_REQUEST_TEMPLATE.md` to report the outcome, affected boundaries, exact verification, documentation impact, and unresolved decisions. Behavior and its canonical documentation belong in the same change.
