import { createHash } from "node:crypto";

import { getVerifiedOidcCredentialBinding, matchVerifiedOidcClient,
  type VerifiedOidcCredentialBinding } from "../../../adapters/security/oidc/createOidcBearerTokenVerifierAdapter";
import { isOrganizationId, type OrganizationRequestContext } from "../../../contracts/organization";
import { isOidcAccessTokenClientId, type AuthContext } from "../../../contracts/security";

type Purpose = "agent" | "browser" | "plan-review";
type RegistrationIdentity = {
  readonly organizationId: OrganizationRequestContext["organizationId"];
  readonly principalId: string;
  readonly registeredClientId: string;
  readonly isCurrent: () => boolean;
};
export type ManagedHeadlessBrowserIdentity = RegistrationIdentity & {
  readonly purpose: "browser";
  readonly credentialBinding: VerifiedOidcCredentialBinding;
};
type Registration = (RegistrationIdentity & {readonly purpose: "agent"}) | ManagedHeadlessBrowserIdentity;
export type ManagedPlanReviewRegistration = RegistrationIdentity & { readonly purpose: "plan-review" };

/** An issuer-verified client binding distinguishes callers. Application policy still grants access. */
export function resolveManagedHeadlessClientPolicy(options: {
  readonly env: NodeJS.ProcessEnv;
  readonly oidcIssuer?: string;
  readonly now?: () => number;
}) {
  const agent = options.env.AI_SYSTEM_BUILDER_MANAGED_HEADLESS_AGENT_CLIENT_ID;
  const browser = options.env.AI_SYSTEM_BUILDER_MANAGED_HEADLESS_BROWSER_CLIENT_ID;
  const plan = options.env.AI_SYSTEM_BUILDER_MANAGED_HEADLESS_PLAN_REVIEW_CLIENT_ID;
  if (agent === undefined && browser === undefined && plan === undefined) return undefined;
  const { oidcIssuer, now = Date.now } = options;
  if (!oidcIssuer || !isOidcAccessTokenClientId(agent) || !isOidcAccessTokenClientId(browser) || agent === browser)
    throw new Error("Managed headless access requires two distinct OIDC client registrations.");
  if (plan !== undefined && (!isOidcAccessTokenClientId(plan) || plan === agent || plan === browser))
    throw new Error("Managed plan review requires its own OIDC client registration.");
  const registered = {
    agent: { clientId: agent, id: registrationId(oidcIssuer, agent) },
    browser: { clientId: browser, id: registrationId(oidcIssuer, browser) },
    "plan-review": plan === undefined ? undefined : { clientId: plan, id: registrationId(oidcIssuer, plan) },
  };
  return Object.freeze({
    planReviewAvailable: plan !== undefined,
    planReviewRegisteredClientId: registered["plan-review"]?.id,
    isPlanReviewCredential(auth?: AuthContext): boolean {
      return plan !== undefined && auth?.authenticated === true && auth.authMethod === "oidc-bearer" &&
        auth.principal.externalIdentity?.issuer === oidcIssuer && matchVerifiedOidcClient(auth, plan) !== undefined;
    },
    identify(input: {
      readonly purpose: Purpose;
      readonly auth?: AuthContext;
      readonly organization?: OrganizationRequestContext;
      readonly organizationHeader?: unknown;
    }): Registration | ManagedPlanReviewRegistration | undefined {
      const { purpose, auth, organization, organizationHeader } = input;
      if (purpose !== "agent" && purpose !== "browser" && purpose !== "plan-review") return undefined;
      const client = registered[purpose];
      const expiry = Date.parse(auth?.expiresAt ?? "");
      if (!client || !auth?.authenticated || auth.authMethod !== "oidc-bearer" || auth.principal.kind !== "user" ||
          auth.principal.externalIdentity?.issuer !== oidcIssuer || auth.oidcAccessTokenClientId !== client.clientId ||
          !organization || !isOrganizationId(organizationHeader) || organizationHeader !== organization.organizationId ||
          auth.principal.principalId !== organization.principalId || !nowBefore(now, expiry)) return undefined;
      let retired = false;
      const identity: RegistrationIdentity = {organizationId: organization.organizationId, principalId: organization.principalId,
        registeredClientId: client.id, isCurrent() {
          if (!retired && !nowBefore(now, expiry)) retired = true;
          return !retired;
        },
      };
      if (purpose === "agent") return Object.freeze({...identity, purpose});
      const credentialBinding = getVerifiedOidcCredentialBinding(auth);
      if (purpose === "plan-review") return credentialBinding && matchVerifiedOidcClient(auth, client.clientId) === "exact" ?
        Object.freeze({...identity, purpose}) : undefined;
      if (credentialBinding) return Object.freeze({...identity, purpose, credentialBinding});
    },
  });
}

function nowBefore(now: () => number, expiry: number): boolean {
  const observed = now();
  return Number.isFinite(observed) && Number.isFinite(expiry) && observed < expiry;
}

function registrationId(issuer: string, clientId: string): string {
  const bytes = createHash("sha256").update(JSON.stringify(["aisb-oidc-client-v1", issuer, clientId])).digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
