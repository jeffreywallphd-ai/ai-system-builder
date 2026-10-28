import assert from "node:assert/strict";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { qualifyCriticalSurfaceAccessibility } from "./critical-surface-accessibility";
import { createPackageFixture } from "../../../../../modules/testing/fixtures/asset-package-fixture";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "../../../../../modules/application/services/asset-packs/system-packs";
import {
  AUTHORING_STEP_BUDGET_MS, BASE_FIELD_LABELS, createAuthoringExpectations,
  assertPackageObservation, assertStudioObservation, assertBaseUnchanged,
  assertPublishedHistory, assertPublishedDefinition, assertDocumentReplay, validateBaseObservation, createSingleRestartCheck,
  type AuthoringHost, type BaseObservation, type StudioObservation, type PublishedDefinitionObservation,
} from "../asset-authoring-oracles";

interface PublishedReadQuery {definitionId: string; version: string; workspaceId: string}
interface ReadClock {setTimeout: (callback: () => void, ms: number) => number; clearTimeout: (id: number) => void}
interface DesktopReadEnvironment extends ReadClock {desktopApi: {readAssetDefinitionVersion: (query: PublishedReadQuery) => Promise<unknown>}}
interface BrowserReadEnvironment extends ReadClock {localStorage: Pick<Storage, "getItem">; location: Pick<Location, "origin">; fetch: typeof fetch}

// Self-contained functions are serialized into the page by Playwright. Injected
// finite environments let the ordinary Node tests exercise all refusal paths.
export async function readDesktopPublishedDefinition(query: PublishedReadQuery, environment = globalThis as unknown as DesktopReadEnvironment): Promise<unknown> {
  let timer: number | undefined;
  try {
    const response = await Promise.race([environment.desktopApi.readAssetDefinitionVersion(query), new Promise<never>((_, reject) => {timer = environment.setTimeout(() => reject(new Error("Read timed out.")), 10_000);})]);
    const encoded = JSON.stringify(response);
    if (typeof encoded !== "string" || new TextEncoder().encode(encoded).byteLength > 262_144) throw new Error("Invalid response.");
    return response;
  } catch {throw new Error("Public definition metadata is unavailable.");}
  finally {if (timer !== undefined) environment.clearTimeout(timer);}
}
export async function readBrowserPublishedDefinition(query: PublishedReadQuery, environment = globalThis as unknown as BrowserReadEnvironment): Promise<unknown> {
  const controller = new AbortController(), timer = environment.setTimeout(() => controller.abort(), 10_000);
  try {
    const pairedToken = environment.localStorage.getItem("ai-system-builder.paired-device-token");
    if (!pairedToken) throw new Error("Paired read is unavailable.");
    const url = new URL(`/api/assets/definitions/${encodeURIComponent(query.definitionId)}/versions/${encodeURIComponent(query.version)}`, environment.location.origin);
    url.searchParams.set("workspaceId", query.workspaceId);
    const response = await environment.fetch(url, {method: "GET", headers: {"x-client-source": "thin-client", Authorization: `Bearer ${pairedToken}`}, signal: controller.signal, redirect: "error", credentials: "omit"});
    if (!response.ok || !response.body) throw new Error("Read failed.");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    for (;;) {const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 262_144) throw new Error("Response exceeds its bound."); chunks.push(part.value);}
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
  } catch {throw new Error("Public definition metadata is unavailable.");}
  finally {controller.abort(); environment.clearTimeout(timer);}
}

/** Public UI; synthetic inert resources. Document reload never proves process restart. */
export async function completeAssetAuthoringJourney(
  page: Page, host: AuthoringHost,
  replay: {kind: "document-reload"; reload: () => Promise<void>},
  readPublished: (input: PublishedReadQuery, currentPage: Page) => Promise<unknown>,
  info: TestInfo,
) {
  page.setDefaultTimeout(10_000); page.setDefaultNavigationTimeout(30_000);
  const workspace = () => page.getByLabel("Select current workspace").inputValue();
  const plan = createAuthoringExpectations(host, await workspace());
  assert(replay.kind === plan.replayKind, "Unsupported authoring replay scope.");
  const replayWorkspaces: string[] = [];
  let customizationAudited = false, detailAudited = false;
  const reload = async () => {
    assert(replayWorkspaces.length < plan.replayCount, "Unexpected additional replay.");
    await replay.reload();
    await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible();
    replayWorkspaces.push(await workspace());
    expect(replayWorkspaces[replayWorkspaces.length - 1]).toBe(plan.workspaceId);
  };
  const select = async (name: string) => {
    await page.getByRole("tablist", {name: "Assets sections"}).getByRole("tab", {name, exact: true}).click();
  };
  const baseSnapshots = new Map<string, BaseObservation>();
  const publishedDefinitions = new Map<string, PublishedDefinitionObservation>([[plan.studio.id, {
    definitionId: plan.studio.id, version: plan.studio.version, displayName: plan.studio.name,
    assetType: plan.studio.type, assetFamily: plan.studio.family, lifecycleStatus: "published", description: plan.studio.definition,
  }]]);
  async function selectBase(id: string, version: string) {
    await select("Customizations");
    const editor = page.locator(".asset-customizer");
    await editor.getByLabel("Search assets", {exact: true}).fill(id);
    await editor.getByRole("button", {name: "Search", exact: true}).click();
    await expect(editor.getByText("Loading customization targets...", {exact: true})).toBeHidden();
    const target = editor.locator(".asset-customizer__target:enabled").filter({has: page.getByText(`${id} - v${version}`, {exact: true})});
    await expect(target).toHaveCount(1);
    await target.click();
    const change = page.getByRole("dialog", {name: "Change customization target?"});
    if (await change.isVisible()) await change.getByRole("button", {name: "Change asset", exact: true}).click();
    await expect(editor.locator(".ui-status").filter({hasText: "Base:"})).toContainText(` - ${id} - v${version} - `);
    await expect(editor.locator(".asset-customizer__resources details").first()).toBeVisible();
    return editor;
  }
  async function readBase(): Promise<BaseObservation> {
    const editor = page.locator(".asset-customizer");
    const baseLabel = (await editor.locator(".ui-status").filter({hasText: "Base:"}).innerText()).trim();
    const identity = baseLabel.match(/ - (\S+) - v(\S+) - (\S+)$/);
    assert(identity, "Exact base identity is absent.");
    const selected = editor.locator('.asset-customizer__target[aria-pressed="true"]');
    await expect(selected).toHaveCount(1);
    const source = (await selected.locator("span").nth(1).innerText()).split(" - ")[0]!;
    const resources = await editor.locator(".asset-customizer__resources details").evaluateAll(elements => elements.map(element => {
      const summary = element.querySelector("summary"), path = summary?.querySelector("strong")?.textContent?.trim();
      const textarea = element.querySelector("textarea"), code = element.querySelector("pre code");
      if (!path || !summary?.textContent || (!textarea && !code)) throw new Error("Base resource observation is incomplete.");
      const declaration = summary.textContent.trim().slice(path.length).trim();
      if (!declaration.startsWith("- ")) throw new Error("Base resource media declaration is absent.");
      const editable = Boolean(textarea);
      return {path, mediaType: declaration.slice(2).replace(/ - read only$/, ""), content: textarea ? textarea.value : code!.textContent!, editable};
    }));
    const semantic: Record<string, string> = {};
    for (const label of BASE_FIELD_LABELS) semantic[label] = await editor.getByLabel(label, {exact: true}).inputValue();
    return {workspaceId: await workspace(), id: identity[1]!, version: identity[2]!, source, baseLabel, semantic, resources};
  }

  await test.step("Inspect and explicitly install the inert package", async () => {
    await select("Import Assets");
    const pack = await createPackageFixture();
    assert(pack.container.manifest.packageId === plan.package.id && pack.container.manifest.version === plan.package.version && pack.bytes.length < 64 * 1024, "Synthetic package identity or bound changed.");
    for (const copy of plan.copies) {
      const source = (copy.source === "system-owned-asset" ? SYSTEM_FOUNDATION_PACK_MANIFEST.assets : pack.container.manifest.semanticManifest.assets).find(entry => entry.definitionRef.id === copy.baseId && entry.definitionRef.version === copy.baseVersion)?.definition;
      assert(source, "Declared exact source definition is absent.");
      publishedDefinitions.set(copy.id, {definitionId: copy.id, version: "1.0.0", displayName: copy.name, assetType: source.assetType, assetFamily: source.assetFamily, lifecycleStatus: "published", description: plan.copyDescription, metadataSummary: plan.copyDescription});
    }
    const editor = page.locator(".asset-package-manager");
    await editor.locator('input[type="file"]').setInputFiles({name: "qualification.aisb-package", mimeType: "application/vnd.ai-system-builder.package.v1+json", buffer: pack.bytes});
    await expect(editor.getByRole("button", {name: "Install package", exact: true})).toBeEnabled();
    const summary = await editor.locator(".asset-package-manager__summary dd").allTextContents();
    assertPackageObservation(plan, {label: summary[0]?.replace(/\s+/g, " ").trim(), contents: summary[1]?.replace(/\s+/g, " ").trim()});
    await qualifyCriticalSurfaceAccessibility(page, info, "asset-import");
    await editor.getByRole("button", {name: "Install package", exact: true}).click();
    const installed = editor.locator(".asset-package-manager__installed li").filter({hasText: plan.package.id});
    await expect(installed).toHaveCount(1); await expect(installed).toContainText(`v${plan.package.version}`);
    await expect(installed.locator(".ui-type-badge")).toHaveText("INSTALLED");
    // Installation/publication grant no activation or execution authority.
  }, {timeout: AUTHORING_STEP_BUDGET_MS});

  for (const copy of plan.copies) await test.step(`Customize and rediscover the ${copy.source} copy`, async () => {
    const editor = await selectBase(copy.baseId, copy.baseVersion);
    const before = await readBase(); validateBaseObservation(plan, copy, before); baseSnapshots.set(copy.baseId, before);
    await editor.getByLabel("Relative path", {exact: true}).fill(plan.overlay.path);
    await editor.getByLabel("Role", {exact: true}).selectOption(plan.overlay.role);
    await editor.getByLabel("Media type", {exact: true}).fill(plan.overlay.mediaType);
    await editor.getByLabel("Resource content", {exact: true}).fill(plan.overlay.content);
    await editor.getByRole("button", {name: "Add resource to draft", exact: true}).click();
    await editor.getByLabel("Derived definition ID", {exact: true}).fill(copy.id);
    await editor.getByLabel("Display name", {exact: true}).fill(copy.name);
    await editor.getByRole("button", {name: "Create customization draft", exact: true}).click();
    const status = editor.locator(".ui-status").filter({hasText: "Status:"});
    await expect(status).toHaveText("Status: draft - revision 1");
    await editor.getByLabel("Description", {exact: true}).fill(plan.copyDescription);
    await editor.getByLabel("Summary", {exact: true}).fill(plan.copyDescription);
    if (!customizationAudited) {
      await qualifyCriticalSurfaceAccessibility(page, info, "asset-customization");
      customizationAudited = true;
    }
    await editor.getByRole("button", {name: "Save changes", exact: true}).click();
    await expect(status).toHaveText("Status: draft - revision 2");
    await editor.getByRole("button", {name: "Materialize review snapshot", exact: true}).click();
    await expect(status).toHaveText("Status: reviewed - revision 3");
    await editor.getByRole("button", {name: "Publish customized copy", exact: true}).click();
    await expect(status).toHaveText("Status: published - revision 4");
    await reload(); await selectBase(copy.baseId, copy.baseVersion);
    assertBaseUnchanged(plan, copy, before, await readBase());
    const rows = page.locator(".asset-customizer__history li").filter({hasText: copy.id});
    await expect(rows).toHaveCount(1); assertPublishedHistory(copy, await rows.allTextContents());
  }, {timeout: AUTHORING_STEP_BUDGET_MS});

  await test.step("Save, reopen, review and publish a three-resource Studio asset", async () => {
    await select("Studio");
    const editor = page.locator(".asset-studio--unified"), expected = plan.studio;
    for (const [label, value] of [["Asset ID", expected.id], ["Display name", expected.name], ["Definition", expected.definition], ["AI context", JSON.stringify(expected.aiContext)]]) await editor.getByLabel(label!, {exact: true}).fill(value!);
    await editor.getByLabel("Asset type", {exact: true}).selectOption(expected.type);
    await editor.getByLabel("Asset family", {exact: true}).selectOption(expected.family);
    const resources = editor.locator(".asset-studio__resource"); await expect(resources).toHaveCount(3);
    for (const [index, resource] of expected.resources.entries()) {
      const row = resources.nth(index);
      await row.getByLabel("Resource path", {exact: true}).fill(resource.path);
      await row.getByLabel("Media type", {exact: true}).fill(resource.mediaType);
      await row.getByLabel("Resource content", {exact: true}).fill(resource.content);
    }
    await qualifyCriticalSurfaceAccessibility(page, info, "asset-studio");
    await editor.getByRole("button", {name: "Save new draft", exact: true}).click();
    await expect(editor.locator(".ui-badge").first()).toHaveText(expected.status);
    await reload(); await select("Saved");
    await expect(page.locator(".asset-studio--saved")).toHaveAttribute("aria-busy", "false");
    const saved = page.locator(".asset-studio__saved-card").filter({hasText: expected.id});
    await expect(saved).toHaveCount(1);
    await qualifyCriticalSurfaceAccessibility(page, info, "asset-saved");
    await saved.getByRole("button", {name: "Open in Studio", exact: true}).click();
    await expect(editor.getByLabel("Asset ID", {exact: true})).toHaveValue(expected.id);
    await expect(editor.locator(".ui-badge").first()).toHaveText(expected.status);
    const observed: StudioObservation = {
      workspaceId: await workspace(), id: await editor.getByLabel("Asset ID", {exact: true}).inputValue(), name: await editor.getByLabel("Display name", {exact: true}).inputValue(),
      version: await editor.getByLabel("Version", {exact: true}).inputValue(), type: await editor.getByLabel("Asset type", {exact: true}).inputValue(), family: await editor.getByLabel("Asset family", {exact: true}).inputValue(),
      definition: await editor.getByLabel("Definition", {exact: true}).inputValue(), aiContext: JSON.parse(await editor.getByLabel("AI context", {exact: true}).inputValue()), status: await editor.locator(".ui-badge").first().innerText(),
      resources: [],
    };
    await expect(resources).toHaveCount(3);
    for (const row of await resources.all()) observed.resources.push({path: await row.getByLabel("Resource path", {exact: true}).inputValue(), mediaType: await row.getByLabel("Media type", {exact: true}).inputValue(), content: await row.getByLabel("Resource content", {exact: true}).inputValue(), section: await row.evaluate(element => element.closest(".ui-workflow__step")?.querySelector("h3")?.textContent?.trim() ?? "")});
    assertStudioObservation(expected, observed);
    await editor.getByRole("button", {name: "Review draft", exact: true}).click();
    await expect(editor.locator(".ui-badge").first()).toHaveText("reviewed - revision 2");
    await editor.getByRole("button", {name: "Publish asset", exact: true}).click();
    await expect(editor.locator(".ui-badge").first()).toHaveText("published - revision 3");
    await reload();
  }, {timeout: AUTHORING_STEP_BUDGET_MS});

  async function verifyPublishedState() {
    for (const asset of [...plan.copies, plan.studio]) {
      await select("Browse"); await page.getByLabel("Search assets", {exact: true}).fill(asset.id);
      const search = page.getByRole("button", {name: "Search", exact: true});
      if (await search.count()) await search.click();
      // Cards expose the name/version, while the query pins the declared ID.
      const card = page.locator(".asset-definition-card").filter({has: page.getByText(asset.name, {exact: true})});
      await expect(card).toHaveCount(1); await expect(card).toContainText(asset.name); await expect(card).toContainText("v1.0.0");
      await card.locator(".asset-definition-card__preview").click();
      const detail = page.getByRole("dialog", {name: asset.name, exact: true});
      await expect(detail).toContainText("v1.0.0"); await expect(detail.getByText("Published", {exact: true})).toBeVisible();
      await expect(detail).toContainText(asset === plan.studio ? plan.studio.definition : plan.copyDescription);
      if (!detailAudited) {
        await qualifyCriticalSurfaceAccessibility(page, info, "asset-detail");
        detailAudited = true;
      }
      await detail.getByRole("button", {name: "Close asset details", exact: true}).click();
      // Cards hide IDs. A separate existing public exact-version read verifies
      // publication metadata, not a hidden UI selection or source artifact.
      expect(await workspace()).toBe(plan.workspaceId);
      const envelope = await readPublished({definitionId: asset.id, version: "1.0.0", workspaceId: plan.workspaceId}, page);
      assertPublishedDefinition(publishedDefinitions.get(asset.id)!, envelope);
      expect(await workspace()).toBe(plan.workspaceId);
      // Publication creates an implementation draft, not an eligible new target.
      // Published overlay bytes/releases/activation remain separate qualification.
    }
    for (const copy of plan.copies) {
      await selectBase(copy.baseId, copy.baseVersion);
      assertBaseUnchanged(plan, copy, baseSnapshots.get(copy.baseId)!, await readBase());
      const rows = page.locator(".asset-customizer__history li").filter({hasText: copy.id});
      await expect(rows).toHaveCount(1); assertPublishedHistory(copy, await rows.allTextContents());
    }
  }
  await test.step("Rediscover exact published copies and unchanged originals", async () => {
    await verifyPublishedState();
    assertDocumentReplay(plan, {kind: replay.kind, count: replayWorkspaces.length, workspaceIds: replayWorkspaces});
  }, {timeout: AUTHORING_STEP_BUDGET_MS});
  await info.attach("asset-authoring-document-reload", {body: JSON.stringify({host, replayKind: replay.kind, replayCount: replayWorkspaces.length, syntheticAssets: 3, status: "passed", scope: "Public local fixture UI only. Process/server restart, durable storage, authorization/native and final qualification remain separate."}), contentType: "application/json"});
  return createSingleRestartCheck(page, async replacement => {
    // This callback does not close or start a process. The desktop caller must
    // first qualify owned shutdown, then supply its distinct replacement page.
    page = replacement;
    page.setDefaultTimeout(10_000); page.setDefaultNavigationTimeout(30_000);
    await test.step("Verify original publications and base bytes on the replacement page", async () => {
      await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible();
      expect(await workspace()).toBe(plan.workspaceId);
      await verifyPublishedState();
    }, {timeout: AUTHORING_STEP_BUDGET_MS});
    await info.attach("asset-authoring-replacement-observations", {body: JSON.stringify({host, syntheticAssets: 3, status: "passed", scope: "Exact original workspace, public definitions, base fields/resources and copy history on one replacement page. Caller-owned process exit/restart evidence is separate; no server or security qualification."}), contentType: "application/json"});
  });
}
