import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, fork, spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, realpath, lstat, readdir, writeFile } from "node:fs/promises";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import pg from "pg";
import { createLocalCaTlsCertificateProvider } from "../../../../modules/adapters/security/tls/createLocalCaTlsCertificateProvider";
import { createFilesystemTlsCertificateStore } from "../../../../modules/adapters/security/tls/createFilesystemTlsCertificateStore";
import { openPostgresDatabase, resolvePostgresPoolConfig } from "../../../../modules/adapters/persistence/postgres";
import { provisionOrganizationMembership } from "../../../../modules/adapters/persistence/organization";
import { createInternalPrincipalId } from "../../../../modules/adapters/security/oidc/createOidcBearerTokenVerifierAdapter";
import { createOrganizationId } from "../../../../modules/contracts/organization";
import { readAssetSystemSourceIdentity, assertAssetSystemSourceIdentity } from "../asset-system-source-identity.mjs";
import { stopVisualComposerOwnedProcess } from "./visual-composer-host-lifecycle.mjs";
import { seedReferenceBrowseFixture } from "./reference-browse-fixture";
import { createWorkspaceId } from "../../../../modules/contracts/workspace";
import { createLocalWorkspaceRepository } from "../../../../modules/adapters/persistence/workspace";
import { assertIsolatedPostgresInspection, assertOwnedWorkerObservation } from "./managed-reference-lifecycle.mjs";

const IMAGE = "postgres@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export async function ownedInput(root: string, relative: string, pattern: RegExp) {
  assert.match(relative, pattern);
  const target = path.resolve(root, relative);
  for (let current = target; current !== root; current = path.dirname(current)) {
    assert.notEqual(path.dirname(current), current);
    const stat = await lstat(current);
    assert.ok(!stat.isSymbolicLink());
    assert.equal(await realpath(current), current);
  }
  assert.ok((await lstat(target)).isFile());
  assert.ok((await lstat(target)).size <= 64 * 1024);
  return target;
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {server.once("error", reject); server.listen(0, "127.0.0.1", resolve);});
  const address = server.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert.ok(address.port >= 1024);
  return address.port;
}

export async function startManagedReferenceHost(databaseReference: string) {
  const root = path.resolve(process.cwd());
  const id = randomUUID().replaceAll("-", "");
  const runRoot = path.join(root, "artifacts/qualification/visual-composer/d", `managed-${id}`);
  await mkdir(runRoot, {recursive: false});
  const sourceRevision = await readAssetSystemSourceIdentity(root);
  const privatePath = await ownedInput(root, databaseReference, /^\.local-codex\/managed-reference\/[a-f0-9]{16}\/private-state\.json$/);
  const fixture = JSON.parse(await readFile(privatePath, "utf8"));
  assert.match(fixture.container, /^[a-f0-9]{64}$/);
  assert.match(fixture.id, /^[a-f0-9]{16}$/);
  assert.equal(fixture.name, `aisb-qualification-${fixture.id}`);
  assert.equal(fixture.image, IMAGE);
  const inspection = JSON.parse(execFileSync("docker", ["inspect", fixture.container], {encoding: "utf8", windowsHide: true, timeout: 10_000}))[0];
  assertIsolatedPostgresInspection(inspection,fixture,IMAGE);
  const adminEnv = await readFile(await ownedInput(root, path.relative(root, path.join(path.dirname(privatePath), "postgres.env")).replaceAll("\\", "/"), /^\.local-codex\/managed-reference\/[a-f0-9]{16}\/postgres\.env$/), "utf8");
  const password = /^POSTGRES_PASSWORD=([a-f0-9]{64})$/m.exec(adminEnv)?.[1]; assert.ok(password);
  const database = `aisb_q_${id}`;
  const role = `aisb_q_runtime_${id}`;
  const runtimePassword = randomBytes(32).toString("hex");
  const adminUrl = `postgresql://postgres:${password}@127.0.0.1:${fixture.port}/qualification_admin`;
  const admin = new pg.Pool({connectionString: adminUrl, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 30000});
  const children: ChildProcess[] = [];
  let issuer: https.Server | undefined;
  let stopped = false;
  let admitted = false;
  const workerScenario = process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO ?? "immediate";
  const checks: Record<string, unknown> = {};
  const report = {schema_version: "managed-reference-host-v1", run_id: id, source_revision: sourceRevision, profile: "windows-i5-14600kf-16g-rtx4060-reference", deployment: "controlled-campus-server-oidc-postgres", tls_verification: true, database_image: IMAGE, database_container_digest: digest(fixture.container), checks, status: "starting"};
  async function persist() {await writeFile(path.join(runRoot, "managed-host-evidence.json"), JSON.stringify(report, null, 2) + "\n");}
  async function stop() {
    if (stopped) return; stopped = true;
    const cleanupStarted = performance.now();
    const errors: unknown[] = [];
    try {
      const server = children[0];
      if (admitted && (!server?.connected || server.exitCode !== null)) throw new Error("Ready managed host exited before graceful shutdown.");
      if (server?.connected && server.exitCode === null && admitted) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Managed host graceful shutdown timed out.")), 15000);
          server.on("message", message => {if ((message as {type?: string})?.type === "closed") {clearTimeout(timer); checks.graceful_shutdown = true; resolve();}});
          server.send({type: "shutdown"});
        });
        await new Promise<void>((resolve, reject) => {
          if (server.exitCode !== null) return server.exitCode === 0 ? resolve() : reject(new Error("Managed shutdown exit failed."));
          const timer = setTimeout(() => reject(new Error("Managed shutdown did not exit.")), 5000);
          server.once("exit", code => {clearTimeout(timer); code === 0 ? resolve() : reject(new Error("Managed shutdown exit failed."));});
        });
        checks.graceful_exit = true;
      }
    } catch(error) {errors.push(error); checks.graceful_shutdown_failed = true;
    } finally {
      for (const child of [...children].reverse()) {try {await stopVisualComposerOwnedProcess(child);} catch(error) {errors.push(error);}}
      try {
        const cache=path.join(runRoot,"runtime/controlled-model-cache");
        const files=await readdir(cache).catch(error=>{if(error.code==="ENOENT")return [];throw error;});
        const identities=files.filter(name=>/^qualification-worker-identity-[0-9]+\.json$/.test(name));
        assertOwnedWorkerObservation(workerScenario,identities.length);
        for(const name of identities) {
          const target=path.join(cache,name);const stat=await lstat(target);
          assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1024);assert.equal(await realpath(target),target);
          const identity=JSON.parse(await readFile(target,"utf8"));
          assert.equal(identity.parentPid,children[0]?.pid);assert.equal(name,`qualification-worker-identity-${identity.pid}.json`);
          assert.ok(Number.isInteger(identity.pid)&&identity.pid>0);
          let alive=true;try {process.kill(identity.pid,0);} catch(error) {if((error as NodeJS.ErrnoException).code!=="ESRCH")throw error;alive=false;}
          assert.equal(alive,false,"Owned worker must physically exit after host shutdown.");
        }
        checks.physical_workers_observed=identities.length;checks.physical_workers_alive_after_shutdown=0;
        checks.owned_worker_cleanup_milliseconds=performance.now()-cleanupStarted;
      } catch(error) {errors.push(error);}
      try {if (issuer?.listening) {issuer.closeAllConnections(); await new Promise<void>((resolve, reject) => issuer!.close(error => error ? reject(error) : resolve()));}} catch(error) {errors.push(error);}
      try {await admin.end();} catch(error) {errors.push(error);}
      try {await assertAssetSystemSourceIdentity(root, sourceRevision);} catch(error) {errors.push(error);}
      checks.cleanup_error_count = errors.length;
      report.status = errors.length ? "failed" : admitted ? "completed" : report.status;
      try {await persist();} catch(error) {errors.push(error);}
    }
    if(errors.length) throw new Error("Managed qualification cleanup or source integrity failed.");
  }
  try {
    // Identifiers/password are generated finite hex, never request text. This
    // disposable database is separate from the fixture's original database.
    await admin.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`);
    await admin.query(`CREATE DATABASE ${database} OWNER postgres`);
    await admin.query(`REVOKE CONNECT ON DATABASE ${database} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
    const adminDatabaseUrl = adminUrl.replace(/\/qualification_admin$/, `/${database}`);
    const migration = await openPostgresDatabase({config: resolvePostgresPoolConfig({DATABASE_URL: adminDatabaseUrl, POSTGRES_SSL_MODE: "disable"})});
    let issuerPort: number, serverPort: number, frontendPort: number, workerPort: number;
    try {
      issuerPort = await unusedPort(); serverPort = await unusedPort(); frontendPort = await unusedPort(); workerPort = await unusedPort();
      assert.equal(new Set([issuerPort, serverPort, frontendPort, workerPort]).size, 4);
    } catch(error) {await migration.close(); throw error;}
    const issuerOrigin = `https://127.0.0.1:${issuerPort}`;
    const organizationId = createOrganizationId(`qualification.${id}`);
    const subject = "synthetic-reference-owner";
    try {
      await provisionOrganizationMembership({documents: migration.documents, organizationId, organizationDisplayName: "Managed reference fixture", principalId: createInternalPrincipalId({issuer: issuerOrigin, subject}), role: "operator"});
      const foreignOrganization = createOrganizationId(`foreign.${id}`);
      await createLocalWorkspaceRepository({rootDirectory: path.join(runRoot,"storage"), documents: migration.documents.forOrganization(foreignOrganization)}).saveWorkspace({workspaceId: createWorkspaceId(`workspace.foreign.${id}`), organizationId: foreignOrganization, displayName: "Foreign synthetic workspace", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()});
    } finally {await migration.close();}
    const setup = new pg.Pool({connectionString: adminDatabaseUrl, max: 1});
    try {
      await setup.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
      await setup.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
      await setup.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
    } finally {await setup.end();}
    const runtimeUrl = `postgresql://${role}:${runtimePassword}@127.0.0.1:${fixture.port}/${database}`;
    const runtime = new pg.Pool({connectionString: runtimeUrl, max: 1});
    try {
      const flags = (await runtime.query("SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
      assert.ok(Object.values(flags).every(value => value === false));
      const table = (await runtime.query("SELECT c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner)=current_user AS owns_table FROM pg_class c WHERE c.oid='organization_documents'::regclass")).rows[0];
      assert.deepEqual(table, {relrowsecurity: true, relforcerowsecurity: true, owns_table: false});
      const rows = await runtime.query("SELECT COUNT(*)::int AS count FROM organization_documents");
      assert.equal(rows.rows[0].count, 0);
      checks.runtime_role = {...flags, ...table, unbound_organization_rows: 0};
    } finally {await runtime.end();}
    const material = await createLocalCaTlsCertificateProvider(createFilesystemTlsCertificateStore()).resolveCertificateMaterial({httpsEnabled: true, httpsRequired: true, mode: "auto-local-ca", certificateDirectory: path.join(runRoot, "tls"), hosts: ["127.0.0.1", "localhost"], now: new Date()});
    assert.ok(material);
    const {privateKey, publicKey} = await generateKeyPair("RS256");
    const jwk = {...await exportJWK(publicKey), kid: id, alg: "RS256", use: "sig"};
    issuer = https.createServer({cert: material.certPem, key: material.keyPem}, (request, response) => {
      if (request.method !== "GET" || request.url !== "/jwks") {response.writeHead(404).end(); return;}
      response.writeHead(200, {"content-type": "application/json"}); response.end(JSON.stringify({keys: [jwk]}));
    });
    await new Promise<void>((resolve, reject) => {issuer!.once("error", reject); issuer!.listen(issuerPort, "127.0.0.1", resolve);});
    const token = await new SignJWT({roles: ["ignored-untrusted-token-role"]}).setProtectedHeader({alg: "RS256", kid: id}).setIssuer(issuerOrigin).setSubject(subject).setAudience("aisb-controlled-qualification").setIssuedAt().setExpirationTime("2h").sign(privateKey);
    const nonmemberToken = await new SignJWT({roles: ["operator"]}).setProtectedHeader({alg: "RS256", kid: id}).setIssuer(issuerOrigin).setSubject("synthetic-nonmember").setAudience("aisb-controlled-qualification").setIssuedAt().setExpirationTime("2h").sign(privateKey);
    const ca = path.join(runRoot, "tls/local-dev-ca.pem");
    const runtimeRoot = path.join(runRoot, "runtime");
    const base = {...process.env, NODE_EXTRA_CA_CERTS: ca};
    for (const key of ["HF_TOKEN", "HUGGING_FACE_TOKEN", "HUGGINGFACE_HUB_TOKEN", "NODE_TLS_REJECT_UNAUTHORIZED"]) delete base[key];
    const environment = {...base, NODE_ENV: "test", DEPLOYMENT_SHAPE: "campus-server", DATABASE_URL: runtimeUrl, POSTGRES_SSL_MODE: "disable", PORT: String(serverPort), SERVER_STORAGE_ROOT: path.join(runRoot, "storage"), SERVER_RUNTIME_ROOT: runtimeRoot,
      AI_SYSTEM_BUILDER_SECURITY_MODE: "oidc-bearer", AI_SYSTEM_BUILDER_HTTPS_ENABLED: "true", AI_SYSTEM_BUILDER_TLS_CERT_MODE: "manual", AI_SYSTEM_BUILDER_TLS_CERT_PATH: material.certificatePath!, AI_SYSTEM_BUILDER_TLS_KEY_PATH: material.keyPath!, AI_SYSTEM_BUILDER_OIDC_ISSUER: issuerOrigin, AI_SYSTEM_BUILDER_OIDC_AUDIENCE: "aisb-controlled-qualification", AI_SYSTEM_BUILDER_OIDC_JWKS_URI: `${issuerOrigin}/jwks`, AI_SYSTEM_BUILDER_OIDC_ALGORITHMS: "RS256", AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE: "dedicated", AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID: organizationId,
      PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: String(workerPort), PYTHON_RUNTIME_BASE_URL: `http://127.0.0.1:${workerPort}`, PYTHON_RUNTIME_COMMAND: process.execPath, PYTHON_RUNTIME_ARGS: "dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs", PYTHON_RUNTIME_WORKER_DIR: root, PYTHON_RUNTIME_STARTUP_TIMEOUT_MS: "15000", HF_HUB_CACHE: path.join(runtimeRoot, "controlled-model-cache")};
    const child = fork(path.join(root, "dev-tools/scripts/qualification/visual-composer/managed-reference-server-entry.ts"), [], {execArgv: ["--import", "tsx"], env: environment, silent: true, windowsHide: true});
    children.push(child);
    let log = "";
    for (const output of [child.stdout, child.stderr]) output?.on("data", bytes => {if (log.length < 64000) log += String(bytes).slice(0, 64000-log.length);});
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Managed reference startup timed out.")), 60000);
      child.once("exit", () => {clearTimeout(timer); reject(new Error("Managed reference exited before readiness."));});
      child.on("message", message => {
        if ((message as {type?: string})?.type === "ready") {clearTimeout(timer); resolve();}
        if ((message as {type?: string})?.type === "failed") {clearTimeout(timer); reject(new Error("Managed reference rejected startup."));}
      });
    }).catch(async error => {await writeFile(path.join(runRoot, "private-server-diagnostic.log"), log); throw error;});
    admitted = true;
    const serverOrigin = `https://127.0.0.1:${serverPort}`;
    const caPem = await readFile(ca);
    async function request(relative: string, options: {token?: string; method?: string; body?: unknown; organizationId?: string} = {}) {
      assert.ok(relative.startsWith("/api/") || relative === "/health");
      return new Promise<{status: number; body: any}>((resolve, reject) => {
        const req = https.request(new URL(relative, serverOrigin), {ca: caPem, method: options.method ?? "GET", headers: {"content-type": "application/json", ...(options.token ? {authorization: `Bearer ${options.token}`} : {}), ...(options.organizationId ? {"x-organization-id": options.organizationId} : {})}, timeout: 10000}, response => {
          let text = ""; response.on("data", bytes => {text += String(bytes); if (text.length > 2*1024*1024) req.destroy(new Error("Managed response exceeds bound."));});
          response.on("end", () => {try {resolve({status: response.statusCode!, body: JSON.parse(text)});} catch {reject(new Error("Managed response is not JSON."));}});
        });
        req.on("error", reject); req.on("timeout", () => req.destroy(new Error("Managed request timed out.")));
        req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
      });
    }
    for (const [name, credentials, expected] of [["missing_token", {}, 401], ["invalid_token", {token: "invalid"}, 401], ["nonmember", {token: nonmemberToken}, 403], ["foreign_organization", {token, organizationId: "qualification.foreign"}, 403]] as const) {
      const response = await request("/api/workspaces", credentials); assert.equal(response.status, expected); checks[name] = response.status;
    }
    assert.equal((await request("/api/workspaces", {token})).status, 200);
    const unsupported = await request("/api/qualification-unsupported", {token}); assert.ok([403,404].includes(unsupported.status)); checks.unsupported_route = unsupported.status;
    const positive = await request("/api/workspaces", {token, method: "POST", body: {command: {displayName: "Managed authority positive control"}, selectAfterCreate: false}});
    assert.equal(positive.status,201);
    const positiveSummary = await request(`/api/workspaces/summary?workspaceId=${positive.body.value.workspace.workspaceId}&page=home`,{token});
    assert.equal(positiveSummary.status,200); assert.equal(positiveSummary.body.ok,true); checks.authorized_summary = 200;
    const foreignSummary = await request(`/api/workspaces/summary?workspaceId=workspace.foreign.${id}&page=home`,{token});
    assert.equal(foreignSummary.status,503); assert.equal(foreignSummary.body.ok,false);
    assert.equal(foreignSummary.body.error.message,"Workspace summary is unavailable.");
    assert.ok(!JSON.stringify(foreignSummary.body).includes("Foreign synthetic workspace")); checks.existing_foreign_workspace = 503;
    let fixtureWorkspaceId: string | undefined;
    if (process.env.MANAGED_REFERENCE_LARGE_FIXTURE === "1") {
      const createdWorkspace = await request("/api/workspaces", {token, method: "POST", body: {command: {displayName: "Managed reference performance"}, selectAfterCreate: true}});
      assert.equal(createdWorkspace.status, 201);
      fixtureWorkspaceId = createdWorkspace.body.value.workspace.workspaceId;
      const seedDatabase = await openPostgresDatabase({config: resolvePostgresPoolConfig({DATABASE_URL: runtimeUrl, POSTGRES_SSL_MODE: "disable"}), migrate: false});
      try {
        checks.fixture = await seedReferenceBrowseFixture({documents: seedDatabase.documents.forOrganization(organizationId), definitionDocuments: seedDatabase.documents, rootDirectory: environment.SERVER_STORAGE_ROOT, workspaceId: createWorkspaceId(fixtureWorkspaceId!)});
      } finally {await seedDatabase.close();}
    }
    const frontend = spawn(process.execPath, [path.join(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], {cwd: path.join(root, "apps/thin-client"), env: {...base, NODE_ENV: "development", AI_SYSTEM_BUILDER_HTTPS_ENABLED: "false", AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "false", AI_SYSTEM_BUILDER_TLS_CERT_MODE: "manual", AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET: serverOrigin}, stdio: "ignore", windowsHide: true});
    children.push(frontend);
    const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
    let ready = false;
    for (let attempt=0; attempt<120; attempt++) {try {if ((await fetch(frontendOrigin)).ok) {ready=true;break;}} catch {} await new Promise(resolve=>setTimeout(resolve,250));}
    assert.ok(ready, "Managed frontend must become ready.");
    report.status = "ready"; await persist();
    return {runRoot, sourceRevision, token, serverOrigin, frontendOrigin, request, organizationId, fixtureWorkspaceId, workerCacheRoot: environment.HF_HUB_CACHE!, ownedHostPid: children[0]!.pid!, stop, report};
  } catch (error) {report.status = "failed"; await stop().catch(()=>{}); throw error;}
}
