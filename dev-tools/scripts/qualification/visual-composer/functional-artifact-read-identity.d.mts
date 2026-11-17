import type {SettingsHostLaunchPlan} from "./settings-host-launch-plan.mjs";
/** Fixed prelaunch fixture identity with artifact:read and workspace:read only. */
export function prepareFunctionalArtifactReadIdentity(plan:SettingsHostLaunchPlan,identity:{bearerToken:string;credentialPath:string},sourceRevision:string):Readonly<{bearerToken:string;credentialPath:string}>;
