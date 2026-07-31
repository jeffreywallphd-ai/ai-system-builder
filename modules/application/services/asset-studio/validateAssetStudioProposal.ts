import { ASSET_STUDIO_LIMITS, type AssetStudioDiagnostic, type AssetStudioPatchProposal } from "../../../contracts/asset-studio";

const ALLOWED_FILE = /\.(?:ts|tsx|json|css|md)$/i;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"']{8,}["']/i,
  /\b(?:sk|ghp|github_pat|hf)_[A-Za-z0-9_-]{16,}\b/,
];

export interface AssetStudioProposalValidationInput {
  readonly proposal: AssetStudioPatchProposal;
  readonly allowedDependencies: readonly string[];
  readonly allowedCapabilities: readonly string[];
}

export function validateAssetStudioProposal(input: AssetStudioProposalValidationInput): readonly AssetStudioDiagnostic[] {
  const diagnostics: AssetStudioDiagnostic[] = [];
  const { proposal } = input;
  if (!proposal.summary.trim() || proposal.summary.length > 2_000) diagnostics.push(error("studio.summary.invalid", "Proposal summary is required and must be at most 2,000 characters."));
  if (proposal.plan.length === 0 || proposal.plan.length > ASSET_STUDIO_LIMITS.maxPlanSteps) diagnostics.push(error("studio.plan.invalid", `A proposal must contain 1-${ASSET_STUDIO_LIMITS.maxPlanSteps} bounded plan steps.`));
  if (proposal.files.length === 0 || proposal.files.length > ASSET_STUDIO_LIMITS.maxFiles) diagnostics.push(error("studio.files.invalid-count", `A proposal must contain 1-${ASSET_STUDIO_LIMITS.maxFiles} source files.`));
  if (proposal.dependencies.length > ASSET_STUDIO_LIMITS.maxDependencies) diagnostics.push(error("studio.dependencies.too-many", "The proposal requests too many dependencies."));
  if (proposal.requestedCapabilities.length > ASSET_STUDIO_LIMITS.maxCapabilities) diagnostics.push(error("studio.capabilities.too-many", "The proposal requests too many capabilities."));

  const seen = new Set<string>();
  let totalCharacters = 0;
  for (const file of proposal.files) {
    const path = file.path.trim().replace(/\\/g, "/");
    totalCharacters += file.content.length;
    if (!isSafePath(path)) diagnostics.push(error("studio.file.path-invalid", "Source file path is not a safe relative authoring path.", file.path));
    if (!ALLOWED_FILE.test(path)) diagnostics.push(error("studio.file.type-unsupported", "Only TypeScript, TSX, JSON, CSS, and Markdown source files are supported.", path));
    const folded = path.toLowerCase();
    if (seen.has(folded)) diagnostics.push(error("studio.file.duplicate", "Source file paths must be unique, including case-insensitive filesystems.", path));
    seen.add(folded);
    if (file.content.length > ASSET_STUDIO_LIMITS.maxFileCharacters) diagnostics.push(error("studio.file.too-large", "A source file exceeds the authoring size limit.", path));
    if (SECRET_PATTERNS.some((pattern) => pattern.test(file.content))) diagnostics.push(error("studio.file.secret-detected", "Potential credential material is not permitted in asset source.", path));
  }
  if (totalCharacters > ASSET_STUDIO_LIMITS.maxTotalSourceCharacters) diagnostics.push(error("studio.source.too-large", "The total source proposal exceeds the authoring size limit."));

  const allowedDependencies = new Set(input.allowedDependencies);
  for (const dependency of unique(proposal.dependencies)) if (!allowedDependencies.has(dependency)) diagnostics.push(error("studio.dependency.not-allowed", `Dependency is not allowlisted: ${dependency}.`));
  const allowedCapabilities = new Set(input.allowedCapabilities);
  for (const capability of unique(proposal.requestedCapabilities)) if (!allowedCapabilities.has(capability)) diagnostics.push(error("studio.capability.not-allowed", `Capability is not allowlisted: ${capability}.`));
  if (unique(proposal.dependencies).length !== proposal.dependencies.length) diagnostics.push(error("studio.dependency.duplicate", "Dependencies must be unique."));
  if (unique(proposal.requestedCapabilities).length !== proposal.requestedCapabilities.length) diagnostics.push(error("studio.capability.duplicate", "Capabilities must be unique."));
  return diagnostics;
}

export function validateAssetStudioRequest(input: { readonly intent: string; readonly context: readonly { readonly id: string; readonly content: string }[] }): readonly AssetStudioDiagnostic[] {
  const diagnostics: AssetStudioDiagnostic[] = [];
  if (!input.intent.trim() || input.intent.length > ASSET_STUDIO_LIMITS.maxIntentCharacters) diagnostics.push(error("studio.intent.invalid", `Intent is required and must be at most ${ASSET_STUDIO_LIMITS.maxIntentCharacters} characters.`));
  if (input.context.length > ASSET_STUDIO_LIMITS.maxContextItems) diagnostics.push(error("studio.context.too-many", "The bounded context contains too many items."));
  if (input.context.reduce((sum, item) => sum + item.content.length, 0) > ASSET_STUDIO_LIMITS.maxContextCharacters) diagnostics.push(error("studio.context.too-large", "The bounded context exceeds the character limit."));
  if (new Set(input.context.map((item) => item.id)).size !== input.context.length) diagnostics.push(error("studio.context.duplicate", "Context item identifiers must be unique."));
  return diagnostics;
}

function isSafePath(path: string): boolean {
  if (!path || path.length > 240 || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.includes("\0")) return false;
  const segments = path.split("/");
  return segments.every((segment) => SAFE_PATH_SEGMENT.test(segment) && segment !== "." && segment !== "..") && !segments.some((segment) => ["node_modules", ".git", ".env"].includes(segment.toLowerCase()));
}

const unique = (values: readonly string[]) => Array.from(new Set(values));
const error = (code: string, message: string, path?: string): AssetStudioDiagnostic => ({ severity: "error", code, message, ...(path ? { path } : {}) });
