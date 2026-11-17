export const FUNCTIONAL_PROVIDER_REPOSITORY:"OpenFinAL/ai-system-builder-test";
export const FUNCTIONAL_PROVIDER_MANIFEST_BYTES:number;
export const FUNCTIONAL_PROVIDER_OBJECT_BYTES:number;
export const FUNCTIONAL_PROVIDER_METADATA_BYTES:number;
export const FUNCTIONAL_PROVIDER_TIMEOUT_MS:number;
export const FUNCTIONAL_PROVIDER_SAMPLE_NAME:"qualification-inventory.json";
export interface ProviderSourceFile {readonly path:string;readonly revision:string;readonly size_bytes:number;readonly sha256:string;readonly localize:boolean;}
export interface ProviderFixtureManifest {readonly schema_version:"functional-private-provider-v1";readonly repository:typeof FUNCTIONAL_PROVIDER_REPOSITORY;readonly credential_file:string;readonly source_file?:ProviderSourceFile;}
export interface ProviderFixtureIdentity {readonly runId:string;readonly sourceRevision:string;readonly host:"packaged-desktop"|"thin-chrome";readonly purpose:"provider-source"|"provider-publication";}
export interface ProviderFixturePlan {readonly manifest:ProviderFixtureManifest;readonly identity:ProviderFixtureIdentity;readonly sourceReferenceOnly:boolean;readonly publicationPath?:string;}
export function providerFixtureReference(value:unknown):string;
export function providerImmutableRevision(value:unknown):string;
export function validateProviderFixtureManifest(value:unknown):ProviderFixtureManifest;
export function parseProviderFixtureManifest(bytes:unknown):ProviderFixtureManifest;
export function providerFixtureIdentity(runId:unknown,sourceRevision:unknown,host:unknown,purpose:unknown):ProviderFixtureIdentity;
export function providerFixturePlan(manifest:unknown,identity:unknown):ProviderFixturePlan;
export function safeProviderFixturePlan(plan:ProviderFixturePlan):Readonly<{purpose:ProviderFixtureIdentity["purpose"];host:ProviderFixtureIdentity["host"];requiresExplicitTestCredential:true;sourceReferenceOnly:boolean;localizationRequested:boolean;repositoryCreation:false;remoteDeletion:false;credentialRead:false;networkRun:false;qualificationGranted:false}>;
export function providerPublicationPath(runId:unknown):string;
export function providerRepositoryInfoUrl():string;
export function providerPublicationObjectUrl(runId:unknown,revision:unknown):string;
