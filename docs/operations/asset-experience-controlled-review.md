# Asset Experience Controlled Review

> AI documentation reminder: when Assets or Systems behavior changes, update this procedure, the related architecture and security documents, context packs, and nearest READMEs in the same change.

- Status: controlled-environment procedure; repository automation does not imply a manual pass
- Parent qualification: [Asset and System Support Qualification](asset-system-support-qualification.md)
- Security boundary: [Asset Authoring and Execution Security](../architecture/asset-authoring-and-execution-security.md)

Use this procedure for the exact product digest and named desktop or thin-client environment being qualified. Store completed evidence under the owning release-retention policy, not in source control. Evidence identifiers, digests, results, exceptions, owners, and expiry dates must be sanitized; never record credentials, source text, user data, host paths, provider payloads, prompts, stack traces, or command lines.

## Automated prerequisites

Before controlled review, record passing evidence for:

```text
npm test
npm run asset-system:check
npm run architecture:check
npm run agent-support:check
npm run docs:check
npm run security:dependencies
npm run build:server
npm run build:thin-client
npm run package
```

The automated matrix must cover System Foundation and admitted imported customization, from-scratch Studio save/reopen/review/publication, restart rediscovery, immutable bases, workspace denial, stale revisions, protected and unsafe paths, secrets, size limits, unavailable revocation truth, non-execution, shared modal focus/stacking, accessible status semantics, and responsive grids. Record this as `asset-experience-automated`; it does not replace either manual review.

## Accessibility review

Exercise Browse, Import Assets, Studio, Saved, Customizations, and the Systems tabbed surface on both desktop and thin client with representative content.

- Complete every task using keyboard only. Confirm visible focus, logical order, no keyboard trap, and focus return after closing asset details and confirmation dialogs.
- With a supported screen reader, confirm page and tab names, ordered workflow sections, field labels and descriptions, selected target state, loading/status/error announcements, modal names, and actionable button names.
- At 400-percent browser zoom and at a 320 CSS-pixel viewport, confirm reflow without horizontal page scrolling, clipped controls, overlapping tabs, hidden modal controls, or loss of content. Source editors may scroll internally.
- Verify text and non-text contrast, non-color status cues, pointer target size, reduced-motion behavior, error association, and timeout/cancellation behavior.

Record each surface and check as passed or failed. `accessibility-manual` remains `not-run` or failed while any required surface is untested or any exception lacks an owner and approval.

## Security review

Review desktop IPC/preload and server API paths against the same exact revision.

- Browse and package inspection must remain read-only and must not execute imported, authored, or customized source.
- Raw source stays inside authorized bounded artifact or detail boundaries; list records, diagnostics, logs, and readiness UI expose only safe descriptors.
- Cross-workspace reads and writes, stale revisions or pinned bases, protected definition resources, unsafe paths, secrets, oversized content, corrupt artifacts, revoked releases, and unavailable revocation truth fail closed with sanitized recoverable messages.
- Review and publication bind immutable source evidence, preserve the original base, and create distinct workspace-owned definitions and implementation drafts.
- Publication grants no build, installation, activation, deployment, capability, secret, network, or execution authority.
- Modal portals, renderer isolation, sender validation, route policy, optimistic revisions, immutable artifact verification, and storage containment remain enforced.

Record technique, result, residual risk, exception owner, approval, and expiry. `security-manual` remains `not-run` or failed until a qualified reviewer completes the controlled review; automated checks are necessary but insufficient.

## Evidence completion

Create the ordinary qualification envelope described by the parent procedure. A passed check requires an opaque evidence identifier and SHA-256 evidence digest. Assess the sanitized envelope with:

```text
npm run asset-system:check -- --evidence <qualification-evidence.json>
```

Do not mark the profile qualified unless the assessor returns `qualified`. Missing manual accessibility or security evidence is an `incomplete` profile, not a product pass and not a concealed failure.
