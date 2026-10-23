# ADR-0044: Qualified Desktop Vite Toolchain

- Status: accepted
- Date: 2026-10-21
- Deciders: ai-system-builder maintainers
- Related: ADR-0006, ADR-0015, ADR-0039, ADR-0042

## Context

The Forge webpack development stack retains an unpatched original-supplier
`braces` advisory through multiple transitive consumers. A webpack-dev-server
major override alone does not remove that chain and exceeds Forge's supported
range. The user approved migration to the official Forge Vite plugin after
compatibility qualification, preserving existing features and the original
supplier policy. Electron's downloader separately accepts patched Undici7.

## Decision

Use exactly Forge Vite8.0.1, Vite7.3.7 and React plugin5.2.0 for the desktop
dev/package path. Keep the existing commands and makers. The official plugin is
experimental; updates require explicit compatibility qualification rather than
automatic minor-version adoption. See the [official plugin documentation](https://www.electronforge.io/config/plugins/vite).

Build one self-contained CJS main and two independent, single-file CJS preloads.
Keep product and published-runtime renderers separate, with relative packaged
assets and no source maps. Preserve Python worker resources, context isolation,
runtime sandboxing, main-frame/session authorization and fail-closed IPC.
Development listeners use separate loopback ports with CORS disabled and a source
and dependency filesystem allowlist; private ignored evidence and runtime roots
are excluded. Runtime development uses ordinary Vite reload because its CSP
forbids React Refresh's inline preamble.
Give each renderer a separate dependency optimizer cache under the ignored
`node_modules/.vite/desktop/<renderer-name>` root. Concurrent servers with different
entry/plugin graphs must not overwrite a shared cache and invalidate modules
already referenced by the other window. This changes no listener, filesystem
allowlist, CSP, preload, credential or packaging authority.

Preserve the original guarded optional `pg-native` require; do not synthesize a
native implementation or make that optional peer mandatory during dev startup.
Keep the official Hugging Face clients lazy through bundler-visible imports so
installed packages do not depend on the repository's node_modules.

Scope the Undici7.29.1 override to `@electron/get`; compatible6.x consumers keep
their own supported major. Remove obsolete webpack dependencies and overrides.
Retain the reviewed brace-expansion compatibility adapter for its remaining
consumers. Install scripts remain disabled during dependency resolution.

## Qualification and consequences

Focused tests build and execute real main/preload/provider bundles while denying
ambient package resolution. HTTP tests check private-file, host and cross-origin
denial. Development startup, packaged product and runtime windows, worker assets,
useful mixed-component systems, locked audit/SBOM and completion suites qualify
the candidate. Configuration assertions alone do not establish installed behavior.
Non-Windows packaging, reference hardware and manual assistive-technology/user
qualification remain pending unless separately executed and recorded.

Preserve baseline configuration bytes and evidence for diagnosis. If an update
cannot preserve behavior, restore a coherent previously tested candidate for
investigation and keep release qualification blocked; never describe the known
vulnerable webpack baseline as an acceptable release or suppress its advisories.
