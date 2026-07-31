import { createOrganizationId, normalizeOrganizationRole } from "../../../modules/contracts/organization";
import { createExternalSubjectIdentity } from "../../../modules/contracts/security";
import { createInternalPrincipalId } from "../../../modules/adapters/security/oidc/createOidcBearerTokenVerifierAdapter";
import { openPostgresDatabase, resolvePostgresPoolConfig } from "../../../modules/adapters/persistence/postgres";
import { provisionOrganizationMembership } from "../../../modules/adapters/persistence/organization";

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const organizationId = createOrganizationId(required(flags, "organization-id"));
  if (required(flags, "confirm-organization") !== organizationId) {
    throw new Error("--confirm-organization must exactly match --organization-id.");
  }
  const identity = createExternalSubjectIdentity({
    issuer: required(flags, "issuer"),
    subject: required(flags, "subject"),
  });
  const principalId = createInternalPrincipalId(identity);
  const database = await openPostgresDatabase({
    config: resolvePostgresPoolConfig(process.env),
  });
  try {
    const result = await provisionOrganizationMembership({
      documents: database.documents,
      organizationId,
      organizationDisplayName: required(flags, "display-name"),
      principalId,
      role: normalizeOrganizationRole(flags.get("role") ?? "owner"),
    });
    process.stdout.write(`${JSON.stringify({
      operation: "organization.provision-membership",
      organizationId,
      principalId,
      outcome: "success",
      ...result,
    })}\n`);
  } finally {
    await database.close();
  }
}

function parseFlags(args: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("Tenancy arguments must be --name value pairs.");
    }
    flags.set(flag.slice(2), value);
  }
  return flags;
}

function required(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Tenancy administration failed."}\n`);
  process.exitCode = 1;
});
