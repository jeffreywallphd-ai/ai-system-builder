import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {CENSUS_LIMITS, REQUIRED_CENSUS_INVENTORIES, censusPath, sourceFacts, literalInventory, validateCensus, repositoryReader} from "../ui_coverage_census.mjs";
const file = "dev-tools/example.unit.test.ts", host = "dev-tools/scripts/qualification/visual-composer/e2e/example.e2e.spec.ts";
const code = Buffer.from('import {test,expect} from "fixture"; test("retains scoped records",()=>{expect(1).toBe(1)});');
const inventoryFile = "modules/contracts/example.ts", inventory = Buffer.from('export const TYPES = ["first", "second"] as const;');
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
// Cache recent immutable Git witnesses without making the number of tested
// versions a memory limit. Never cache current working files.
const historicalGitBytes = new Map();
let historicalGitTotalBytes = 0;
function historicalSource(commit, source) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  censusPath(source);
  const key = JSON.stringify([commit, source]);
  let bytes = historicalGitBytes.get(key);
  if (bytes) {
    historicalGitBytes.delete(key);
  } else {
    const original = execFileSync("git", ["show", `${commit}:${source}`], { timeout: 5000, maxBuffer: CENSUS_LIMITS.sourceBytes });
    assert(original.length <= CENSUS_LIMITS.sourceBytes);
    while (historicalGitBytes.size >= 64 || historicalGitTotalBytes + original.length > CENSUS_LIMITS.totalBytes) {
      const oldest = historicalGitBytes.keys().next().value;
      assert(oldest !== undefined);
      historicalGitTotalBytes -= historicalGitBytes.get(oldest).length;
      historicalGitBytes.delete(oldest);
    }
    bytes = Buffer.from(original);
    historicalGitTotalBytes += bytes.length;
  }
  historicalGitBytes.set(key, bytes);
  return Buffer.from(bytes);
}

const pendingReviewSiteDefinition = Object.freeze({
  source: "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs",
  baseline: "79379e6d8618548c03c8eb45bf816c1be9c87080",
  committed: "e03398d6787cde22df737cfb9ba4baf48d4bf01e12a2646365e48ae0e9438a41",
  candidate: "40fd07429770fd83fdbb91efcf1a4f3794a9142103e86c5a81f86a1e34f23487",
  facts: "4009c77b0cab40280b350dcd33637a376e32f74ae8e1d353ab66949ce174fe18",
});
// This exact delivery display definition is prospective until its source commit.
// The original historical review binding above remains independently inspectable.
const pendingReviewDeliveryDefinition = Object.freeze({
  "source": "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs",
  "baseline": "bb895bef9cd95c2662cbe185c03ea69bda6d938d",
  "committed": "40fd07429770fd83fdbb91efcf1a4f3794a9142103e86c5a81f86a1e34f23487",
  "candidate": "e3b69488b90c33157905b797a3526a02a09185d9bab372ff4877236191022db9",
  "facts": "44c5caa7ff048359ed91abf3d712d0d6b57c8deead3a2acaec6684c166a7f747"
});
// Exact reference-transport assertions, still prospective at this real baseline.
// Older bindings remain historical; arbitrary future definitions stay refused.
const pendingReviewReferenceDefinition = Object.freeze({
  source: "dev-tools/scripts/testing/control-plane-guard.unit.test.mjs",
  baseline: "608679a6095ef5617921e504bf208858df6a7c49",
  committed: "e3b69488b90c33157905b797a3526a02a09185d9bab372ff4877236191022db9",
  candidate: "d7e8ae80ae01a66e8503a2433cfc3007910ed048e29826d37683fad54707c070",
  facts: "32af7011bfb62cece1a5eed254c781a5b7ded8f663f5a3c5f71e63914e81fa4c",
});
function assertCurrentReviewSiteDrift(map, result) {
  const pending = map.source_baseline === pendingReviewReferenceDefinition.baseline ? pendingReviewReferenceDefinition
    : map.source_baseline === pendingReviewDeliveryDefinition.baseline ? pendingReviewDeliveryDefinition : pendingReviewSiteDefinition;
  const rows = map.sources.filter(row => row.path === pending.source); assert.equal(rows.length, 1);
  const source = rows[0];
  assert.match(map.source_baseline, /^[a-f0-9]{40}$/);
  // Refuse a foreign prospective version before reading another Git object.
  if(source.facts.sha256 !== source.committed_sha256)assert.equal(map.source_baseline,pending.baseline);
  const committed = historicalSource(map.source_baseline,pending.source);
  assert.equal(source.committed_sha256, sha(committed), "The recorded committed pin must be a real blob at the declared baseline.");
  const expected = source.facts.sha256 === source.committed_sha256 ? [] : [{ kind: "unreviewed-source-drift", source: pending.source }];
  assert.deepEqual(result.gaps.filter(g => g.kind === "unreviewed-source-drift"), expected, "Only the exact pending review-source definition may retain a drift gap.");
  if (expected.length) {
    assert.equal(source.committed_sha256, pending.committed);
    assert.equal(source.facts.sha256, pending.candidate);
    assert.equal(sha(Buffer.from(JSON.stringify(source.facts))), pending.facts, "Future definition changes cannot inherit this pending binding.");
  }
}
const pendingTrainingDefinitions = Object.freeze([
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/model-training-journey.ts",
    "baseline": "0eacad6d0674bf2d2448a1b0cb5714e31f4a8893",
    "committed": "3f905b4d9b9a59e301957dc4874f2e2ed6250a4c1f29338694d0a39d7baa2fe7",
    "candidate": "c7d4d2e5caf96dcde6e318f1cfce5b3cf41675ce07ead27c82edf83fbac21ae0",
    "facts_sha256": "8120642b6e51c110d65171ca47637cc82c7954c4f2f7e7f5da08e387438a46c5"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/model-training-oracles.ts",
    "baseline": "0eacad6d0674bf2d2448a1b0cb5714e31f4a8893",
    "committed": "9c127b81bd0b43bcd14cac38268b5def5a87212c637736c19a8b9f76102115db",
    "candidate": "b2f0742d831acd7634d6317d7de8c3f7f4bf5596ea9d0e76e791c06758863666",
    "facts_sha256": "fe86eeaa9d320493e6a6c27f4e4f75985dfc783c849ca5a24f76ef27a6e299ca"
  },
  {
    "path": "dev-tools/scripts/qualification/tests/model-training-oracles.unit.test.ts",
    "baseline": "0eacad6d0674bf2d2448a1b0cb5714e31f4a8893",
    "committed": "de04843392e4c5de4f096d1ed30072e4f3a47046cc898fb9a9b76e6de2a0d163",
    "candidate": "5fe9d9e420cef992fc000f2aae7b1d2b1559b712c30c17733f2edf4a0b2adc2f",
    "facts_sha256": "28037645fbe059695542e93d9453edd33797d98657347427585799a2f441e0f8"
  }
].map(Object.freeze));

// Only these exact training diagnostic definitions remain prospective.
// The recorded baseline pins are real older Git blobs; complete candidate
// SHA and facts must match. Every other mapped source keeps its own guard.
const pendingTrainingFormDefinition = Object.freeze({
  "source": "apps/desktop/src/renderer/features/models/tests/model-training-observation.unit.test.tsx",
  "baseline": "fe6d35989619bf5da04e314ff07cf1cfa7fd2246",
  "committed": "d21f260fa8dc7dfdc18cd4613594e03f53b55e9c79879c0b3065c750165656ac",
  "candidate": "8c0112bb1a19b6ef5c633733ac4ef3e3b28bcc83c3c958981a4e25fde3e90bc6",
  "facts_sha256": "d2cf942819ff042a6eada4a7ff45322e4a01020f3d71d61ac09e851cfb4589cb"
});
function assertTrainingFormSourceDrift(map, result) {
  const pending = pendingTrainingFormDefinition;
  const rows = map.sources.filter(row => row.path === pending.source); assert.equal(rows.length,1);
  const row = rows[0]; assert.match(map.source_baseline,/^[a-f0-9]{40}$/);
  if(row.facts.sha256 !== row.committed_sha256)assert.equal(map.source_baseline,pending.baseline);
  const committed = historicalSource(map.source_baseline,pending.source);
  assert.equal(row.committed_sha256,sha(committed),"Training form pins must be real older Git blobs.");
  const expected = row.facts.sha256 === row.committed_sha256 ? [] : [{kind:"unreviewed-source-drift",source:pending.source}];
  if(expected.length) {
    assert.equal(row.committed_sha256,pending.committed);
    assert.equal(row.facts.sha256,pending.candidate);
    assert.equal(sha(JSON.stringify(row.facts)),pending.facts_sha256,"Future form assertions cannot inherit the prospective binding.");
  }
  assert.deepEqual(result.gaps.filter(g=>g.kind==="unreviewed-source-drift"&&g.source===pending.source),expected);
  return {...result,gaps:result.gaps.filter(g=>!(g.kind==="unreviewed-source-drift"&&g.source===pending.source))};
}

// These three exact candidate definitions retain real prior Git pins until
// their reviewed source is committed. Historical bindings stay inspectable.
const pendingTrainingStartDefinitions = Object.freeze([
  {
    "path": "dev-tools/scripts/qualification/visual-composer/model-training-oracles.ts",
    "baseline": "b3cfef49ea0f3a6cd016f502400b66e0835b339d",
    "committed": "b2f0742d831acd7634d6317d7de8c3f7f4bf5596ea9d0e76e791c06758863666",
    "candidate": "978be3739816cf39026eb9b199d5fa137dc3fe6a5818daabf7938e1c1e6cec6a",
    "facts_sha256": "0cb6786784b8340e8ab22a2d4960cb4e2bf4b6380b39a59caf8f14567803d618"
  },
  {
    "path": "dev-tools/scripts/qualification/tests/model-training-oracles.unit.test.ts",
    "baseline": "b3cfef49ea0f3a6cd016f502400b66e0835b339d",
    "committed": "5fe9d9e420cef992fc000f2aae7b1d2b1559b712c30c17733f2edf4a0b2adc2f",
    "candidate": "db83ebf95933804f06ef4898f7cf9e86b0bc5768049b9d184115867ba97d2ced",
    "facts_sha256": "bc35c6265a30389938d97e942eb42a6ba9a39182d5696950d8af52050fbc3b32"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-operational-ui.e2e.spec.ts",
    "baseline": "b3cfef49ea0f3a6cd016f502400b66e0835b339d",
    "committed": "2d52954a9d7cfc32073134b57e741bf8b8507b2160b06188b7453cc1e0ebf92b",
    "candidate": "82bb71003ac95c34c286b6d54023ca467e93bd87cbeff05ec4321087f09e59f8",
    "facts_sha256": "2ef88e6a94c53a4c48e6d8789111a1bc77e967f51538d68a2e54b90e8c787b1c"
  }
].map(Object.freeze));
// Exact current task diagnostics retain real older pins until their source commit.
// Historical U, form and C fixtures reconstruct their own Git facts below.
const pendingTrainingTaskDefinitions = Object.freeze([
  {
    "path": "dev-tools/scripts/qualification/visual-composer/model-training-oracles.ts",
    "baseline": "4ff4b0323640cff3e229995c552a8513f1b07551",
    "committed": "978be3739816cf39026eb9b199d5fa137dc3fe6a5818daabf7938e1c1e6cec6a",
    "candidate": "46306c8ff6fca94353247c5e163d69d3ef96aea89392720fe6be08f5dbb50b24",
    "facts_sha256": "52d8acad2eddd3a8b85ea79fa0d12d48727f580a863202e882ebe9c0af4ec51e"
  },
  {
    "path": "dev-tools/scripts/qualification/tests/model-training-oracles.unit.test.ts",
    "baseline": "4ff4b0323640cff3e229995c552a8513f1b07551",
    "committed": "db83ebf95933804f06ef4898f7cf9e86b0bc5768049b9d184115867ba97d2ced",
    "candidate": "bba9ff73a8f0f9dbfd0b1385dca30d7723349c2ed848a27a3f67e13c8ea753c5",
    "facts_sha256": "1540338a98b70faeeeb6126475c5514c6a630b4b12ff3192c2374e10d715cf65"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/model-training-journey.ts",
    "baseline": "4ff4b0323640cff3e229995c552a8513f1b07551",
    "committed": "c7d4d2e5caf96dcde6e318f1cfce5b3cf41675ce07ead27c82edf83fbac21ae0",
    "candidate": "853e3c1a55958154c3b6f37419dc4a6114032f1ede2d189ec4c4827303b84c32",
    "facts_sha256": "86916a3a88ef5d26c158dcafedc7c11d95c8a15010c3a84af44224e522b2ee35"
  }
].map(Object.freeze));
// Canonical adapter-format proof retains real older pins until its reviewed commit.
const pendingTrainingAdapterDefinitions=Object.freeze([
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/model-training-journey.ts",
    "baseline": "8bbc8aca6cfedc95aec0920f2fcf648b7fda6559",
    "committed": "853e3c1a55958154c3b6f37419dc4a6114032f1ede2d189ec4c4827303b84c32",
    "candidate": "d847a4eb19c454182c0606e7c5732f13cda018d1c392bed69f09d927f6c934c7",
    "facts_sha256": "e7f77bdf3e8f8f3da2ffba6f5c7b6a7ee617b2fdb4949d65ec7ce2468a23e0fe"
  },
  {
    "path": "dev-tools/scripts/qualification/tests/model-training-oracles.unit.test.ts",
    "baseline": "8bbc8aca6cfedc95aec0920f2fcf648b7fda6559",
    "committed": "bba9ff73a8f0f9dbfd0b1385dca30d7723349c2ed848a27a3f67e13c8ea753c5",
    "candidate": "c33950fff4c27f2e4e06dc8075a6a45bd7c16762db58a0aefff9db81c0e371b1",
    "facts_sha256": "fcca6e6584ea0c66eaaace645f2fc08d87458917e03a79df869276a9d07c3b9a"
  }
].map(Object.freeze));
function trainingDefinitionsFor(map) {
  if(map.source_baseline===pendingTrainingDefinitions[0].baseline)return pendingTrainingDefinitions;
  const replaced=new Set(pendingTrainingStartDefinitions.map(row=>row.path));
  const previous=[...pendingTrainingDefinitions.filter(row=>!replaced.has(row.path)),...pendingTrainingStartDefinitions];
  if([pendingTrainingStartDefinitions[0].baseline,pendingTrainingFormDefinition.baseline].includes(map.source_baseline))return previous;
  const updated=new Set(pendingTrainingTaskDefinitions.map(row=>row.path));
  const task=[...previous.filter(row=>!updated.has(row.path)),...pendingTrainingTaskDefinitions];
  if(map.source_baseline===pendingTrainingAdapterDefinitions[0].baseline){
    const adapter=new Set(pendingTrainingAdapterDefinitions.map(row=>row.path));
    return [...task.filter(row=>!adapter.has(row.path)),...pendingTrainingAdapterDefinitions];
  }
  return task;
}

// Exact Settings navigation definitions retain real older Git pins until
// their independently reviewed source checkpoint. This is not an execution pass.
const pendingSettingsNavigationDefinitions=Object.freeze([
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-operational-ui.e2e.spec.ts",
    "baseline": "5c32b9c4ea15a5229100edd1eb14d2dd1c339734",
    "committed": "82bb71003ac95c34c286b6d54023ca467e93bd87cbeff05ec4321087f09e59f8",
    "candidate": "a1b0dc3df57b063c9e40d58709ebf252db5b55bc7c578e455ec1ea92eeeac21f",
    "facts_sha256": "65d019e171591ad79b88cfa46f11dff7aec93c896cf63eaa44d98c85b7a7ef70"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts",
    "baseline": "5c32b9c4ea15a5229100edd1eb14d2dd1c339734",
    "committed": "98b66cd156a1338528280d03ae76c00e039108d00f6934a8df0840ce0024db7f",
    "candidate": "46f1d1db9960f951648a128f0b77b792a234f5d14bdb3f51969ee744ff6100b9",
    "facts_sha256": "8a88496d16199e0c4ee90d1b3a8605b40161205eaff7a3bdadfa1fd53410931e"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/settings-host-journey.ts",
    "baseline": "5c32b9c4ea15a5229100edd1eb14d2dd1c339734",
    "committed": "55820ad732c51f9e364cf52119ea2109517ca2373fdd7601f2ba5f5d990edcef",
    "candidate": "1123885b23b145587de35375abe9eb1566196bdcffa9f43fae6f1e8c1d5dee71",
    "facts_sha256": "ad669e1cd4f35edb9c06ceb085bacca657f3e70fe4da89469b70fe356c3b4c23"
  }
].map(Object.freeze));
// Exact saved-value oracle correction; old navigation bindings remain historical.
const pendingSettingsEmptyDefinitions=Object.freeze([
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/settings-host-journey.ts",
    "baseline": "d912fb70da8cda8b723187126c31a0e9da850955",
    "committed": "1123885b23b145587de35375abe9eb1566196bdcffa9f43fae6f1e8c1d5dee71",
    "candidate": "f678bd76d838cb5c541a9a87b5a4f0ac052b17909c905e6828366439b6258ffb",
    "facts_sha256": "c340afbd63d828ad340001bd9022af2c769adafa4f58f78b0ad9e72af3067187"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/settings-host-oracles.ts",
    "baseline": "d912fb70da8cda8b723187126c31a0e9da850955",
    "committed": "4f5bc720af17a7680cac25a374a3bdd43577184bd4f71d6f8c46d455aa3c8b90",
    "candidate": "4f35a506f0226de7ee0a1c283859ee60765c6cae8b33dd3263987c3c6f7a6260",
    "facts_sha256": "02715c9269a0a512217a2bbe69b3755eb0586987cdbb78aa1117ecd4b5bda23c"
  }
].map(Object.freeze));
function assertSettingsEmptySourceDrift(map,result){
  const expected=[];
  for(const pending of pendingSettingsEmptyDefinitions){
    const rows=map.sources.filter(row=>row.path===pending.path);assert.equal(rows.length,1);
    const row=rows[0];assert.equal(row.committed_sha256,sha(historicalSource(map.source_baseline,pending.path)));
    if(row.facts.sha256!==row.committed_sha256){
      assert.equal(map.source_baseline,pending.baseline);assert.equal(row.committed_sha256,pending.committed);
      assert.equal(row.facts.sha256,pending.candidate);assert.equal(sha(JSON.stringify(row.facts)),pending.facts_sha256);
      expected.push({kind:"unreviewed-source-drift",source:pending.path});
    }
  }
  const paths=new Set(pendingSettingsEmptyDefinitions.map(row=>row.path));
  const owns=g=>g.kind==="unreviewed-source-drift"&&paths.has(g.source);
  const ordered=rows=>[...rows].sort((a,b)=>a.source.localeCompare(b.source));
  assert.deepEqual(ordered(result.gaps.filter(owns)),ordered(expected));
  return {...result,gaps:result.gaps.filter(g=>!owns(g))};
}
function assertSettingsNavigationSourceDrift(map,result){
  const expected=[];
  for(const original of pendingSettingsNavigationDefinitions){
    const pending=map.source_baseline===pendingSettingsEmptyDefinitions[0].baseline ? pendingSettingsEmptyDefinitions.find(row=>row.path===original.path)??original : original;
    const rows=map.sources.filter(row=>row.path===pending.path);assert.equal(rows.length,1);
    const row=rows[0];assert.match(map.source_baseline,/^[a-f0-9]{40}$/);
    assert.equal(row.committed_sha256,sha(historicalSource(map.source_baseline,pending.path)),"Settings pins must be real Git blobs.");
    if(row.facts.sha256!==row.committed_sha256){
      assert.equal(map.source_baseline,pending.baseline);
      assert.equal(row.committed_sha256,pending.committed);
      assert.equal(row.facts.sha256,pending.candidate);
      assert.equal(sha(JSON.stringify(row.facts)),pending.facts_sha256,"Future Settings facts cannot inherit this exact binding.");
      expected.push({kind:"unreviewed-source-drift",source:pending.path});
    }
  }
  const paths=new Set(pendingSettingsNavigationDefinitions.map(row=>row.path));
  const isOwned=g=>g.kind==="unreviewed-source-drift"&&paths.has(g.source);
  const ordered=rows=>[...rows].sort((a,b)=>a.source.localeCompare(b.source));
  assert.deepEqual(ordered(result.gaps.filter(isOwned)),ordered(expected),"Missing or duplicate Settings drift is refused.");
  return {...result,gaps:result.gaps.filter(g=>!isOwned(g))};
}

const pendingContrastDiagnostics = Object.freeze([
  { path: "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts", baseline: "1e5fd6b76e30025b4571787573b09a3f8b413103",
    committed: "0274cd546eb8013c2987f66923c393847911fde9289af57833ee9d79549be265", candidate: "28926b89ee315867857d993dc228463869917681c87dceae7d48c71a6ae3c2cb", facts_sha256: "ce65218c756560acc1f83b3897f42a04848eae17472d262e2b45981e8ea6089e" },
  { path: "dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts", baseline: "1e5fd6b76e30025b4571787573b09a3f8b413103",
    committed: "076277eb0d7ccab6c401fbb3cc5c58286578c3ea2c9e32a8a722c66954692e9e", candidate: "2f59896ac35870defa416a74986d6974dda6e0d00fbca169be54fb3cf55a880a", facts_sha256: "1121c08ce872688e8401d8334f2aa2320e323d760dab821ef4cea3b9434655e9" },
  { path: "dev-tools/scripts/qualification/visual-composer/e2e/technical-accessibility.ts", baseline: "1e5fd6b76e30025b4571787573b09a3f8b413103",
    committed: "c08850f9ffbcc829abab3c9223bb04932cc347017348fa560cc7ea3d1d21d4ab", candidate: "4e704f91748a5a0f742075c7e166bc74df49525f5f3a960bffde45db5cf0bfd8", facts_sha256: "3faea20f8f8f2e79fb72d9822ac1de40e7a186bda825b5abbc71e4826f9bf22f" },
].map(Object.freeze));
const pendingContrastV2Diagnostics = Object.freeze([
  { path: "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts", baseline: "abdc24509d7cec4aa7013fe5ec369fecb5cf95f0",
    committed: "28926b89ee315867857d993dc228463869917681c87dceae7d48c71a6ae3c2cb", candidate: "6b2a80ecee2b8d140e0a9f5e36abd4ff442a1f7666a0a08720a775d7b4e4bb0a", facts_sha256: "2bb4ebe6e6648df4aa85dc5d7a1a35d58d7f92a15c09abc75a69ce0ce642e7d3" },
  { path: "dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts", baseline: "abdc24509d7cec4aa7013fe5ec369fecb5cf95f0",
    committed: "2f59896ac35870defa416a74986d6974dda6e0d00fbca169be54fb3cf55a880a", candidate: "95edaff0b97824d7ffce1bfdedb2b2fa973fc1c498d497a8f56b71d8528fedf4", facts_sha256: "40ac1c96fdd46bde3f719649b52b3fcd136456f2d66657fe7ba020a14d7d4a95" },
  { path: "dev-tools/scripts/qualification/visual-composer/e2e/technical-accessibility.ts", baseline: "abdc24509d7cec4aa7013fe5ec369fecb5cf95f0",
    committed: "4e704f91748a5a0f742075c7e166bc74df49525f5f3a960bffde45db5cf0bfd8", candidate: "1da80cf54e7f25a032ad3381549c37e16b7464e529f2bae63dd3f1752a013cea", facts_sha256: "472fe262d3356e392872f09387f98f3d969fae960c09f4c6a28494351956fe0f" },
].map(Object.freeze));
const pendingContrastRegionDefinitions = Object.freeze([
  {"path":"dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts","baseline":"6d0e47cdf158622844df28dc9583fe610c6ab096","committed":"6b2a80ecee2b8d140e0a9f5e36abd4ff442a1f7666a0a08720a775d7b4e4bb0a","candidate":"58755f977afe80b299dd54295588b4ad96968a87db0d295fa91d0aba7b8d1c31","facts_sha256":"5d46e18a141d40d1f2d14c6154bd2f95c26101248459dcca7b3228776fe65a2d"},
  {"path":"dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts","baseline":"6d0e47cdf158622844df28dc9583fe610c6ab096","committed":"95edaff0b97824d7ffce1bfdedb2b2fa973fc1c498d497a8f56b71d8528fedf4","candidate":"23c94fc3ab45639929a4d18ce137b775335c49d66abdda0969cfbf947a40ba09","facts_sha256":"d270d691741f71c4fe83f31b07a3600b5c454429ff326a965f87c2d571c13ed2"},
  {"path":"dev-tools/scripts/qualification/visual-composer/e2e/technical-accessibility.ts","baseline":"6d0e47cdf158622844df28dc9583fe610c6ab096","committed":"1da80cf54e7f25a032ad3381549c37e16b7464e529f2bae63dd3f1752a013cea","candidate":"a88771a6b8d8eb54502192149ded65efe2c10a610b7aa33f394d1940a582426e","facts_sha256":"4788d544ebe034e457f8d9c9f73353a678dc6403036d6c5bc170dc3f8581d756"},
].map(Object.freeze));
// The shell markers changed three definitions, with no change to host evidence.
const shellContrastBaseline = "51d299494bd217ac90c110a4fccc089cf8b945d8";
const pendingShellContrastDefinitions = Object.freeze([
  { path: "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts", baseline: shellContrastBaseline,
    committed: "58755f977afe80b299dd54295588b4ad96968a87db0d295fa91d0aba7b8d1c31", candidate: "dc0a02cd9c1fa62e818971385d85000494f4104c395e5f1e51139dd94c7a7470", facts_sha256: "274942525316e5a2873b0c9c090ff398d67ea88cc90680cd8632ae08fcf1907f" },
  { path: "dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts", baseline: shellContrastBaseline,
    committed: "23c94fc3ab45639929a4d18ce137b775335c49d66abdda0969cfbf947a40ba09", candidate: "0a03d828e46601b4c69c12907aa24853e120a0395e935bdd28f9c4d1730d5257", facts_sha256: "32d87b6162bd646fd1251903e76c011b2191deb64bd587f334fb2ed673fc1837" },
  { path: "dev-tools/scripts/qualification/visual-composer/e2e/technical-accessibility.ts", baseline: shellContrastBaseline,
    committed: "a88771a6b8d8eb54502192149ded65efe2c10a610b7aa33f394d1940a582426e", candidate: "ef3494be87437ea5ea96f84271330bf04887c2ac717cb2be7d6816571f99491c", facts_sha256: "178a4f3ded4c1dccf0ed8251f63e12c7746640d4f765cf8aa993532886553be2" },
].map(Object.freeze));
function assertContrastDiagnosticDrift(map,result,definitions=pendingContrastDiagnostics) {
  assert.equal(map.source_baseline,definitions[0].baseline);
  const expected=[];
  for(const pending of definitions) {
    const rows=map.sources.filter(row=>row.path===pending.path);assert.equal(rows.length,1);const row=rows[0];
    assert.equal(row.committed_sha256,sha(historicalSource(map.source_baseline,pending.path)));
    assert.equal(row.committed_sha256,pending.committed);assert.equal(row.facts.sha256,pending.candidate);
    assert.equal(sha(JSON.stringify(row.facts)),pending.facts_sha256,"Future diagnostic facts cannot inherit this exact binding.");
    assert.notEqual(row.facts.sha256,row.committed_sha256);expected.push({kind:"unreviewed-source-drift",source:pending.path});
  }
  const paths=new Set(definitions.map(row=>row.path)),owned=g=>g.kind==="unreviewed-source-drift"&&paths.has(g.source);
  const ordered=rows=>[...rows].sort((a,b)=>a.source.localeCompare(b.source));
  assert.deepEqual(ordered(result.gaps.filter(owned)),ordered(expected));
  return {...result,gaps:result.gaps.filter(g=>!owned(g))};
}
// Exact responsive-navigation and finite training fixture definitions; no execution pass.
const pendingResponsiveJourneyDefinitions = Object.freeze([
  {
    "path": "apps/desktop/src/renderer/features/models/tests/desktop-training-preload.ui.test.tsx",
    "baseline": "608679a6095ef5617921e504bf208858df6a7c49",
    "committed": "22452d5e28d03e26605aa5be1c186a1fb622b9927c1e6f49836eaa55d7b135af",
    "candidate": "235adf27c2e5b1b2120b3d15af98f7192addfc114304a4b37fcf9a8a5f6c2d74",
    "facts_sha256": "21a867309e86e8695300b0a7ce18fc23653b2c7de04f603dc39d7e4aae194332"
  },
  {
    "path": "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts",
    "baseline": "608679a6095ef5617921e504bf208858df6a7c49",
    "committed": "dc0a02cd9c1fa62e818971385d85000494f4104c395e5f1e51139dd94c7a7470",
    "candidate": "2b1691eb195e0478aff745af32d39802ef9470b9cedbbaa1f790540e1179c4d3",
    "facts_sha256": "963ce449f14934eecfe082fd2fbbaf91da9bb2cd052eacb47f3cf3523c6f14dd"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-dataset-versions.e2e.spec.ts",
    "baseline": "608679a6095ef5617921e504bf208858df6a7c49",
    "committed": "43a30f579f680cd402e3922b906d5adf36fa1b157780990877c5a0140cb801be",
    "candidate": "5efd9d07a41b128ec2a2c1d600443cb92df32316d91bc7faa61a995c4ce86cb2",
    "facts_sha256": "d95fbd6dc7acd4e5b429a1eb847aa33f5e0a096e0c0884bd862dd5bb67dfaa25"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-dataset-versions.e2e.spec.ts",
    "baseline": "608679a6095ef5617921e504bf208858df6a7c49",
    "committed": "2947ecc6d7eff93cbbfe4f500416db347c78393eb3a2f582b24904fdc13954bf",
    "candidate": "db47b2ad96970f22ebe60bb87077f89d496a85858ae0cac8d004dfba3d9fcb47",
    "facts_sha256": "a20ce4842cfcb64c9ba10c53d8c2c6fdc348a0fcffc15576d50fbc4875b101aa"
  }
].map(Object.freeze));
// Historical contrast bindings below retain their own original source versions.
const pendingDisclosureJourneyDefinitions = Object.freeze(pendingResponsiveJourneyDefinitions.map(row=>Object.freeze(
  row.path === "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts" ? {...row,
    candidate:"7dd5b0764c155983f6407a7bd147559aa99f64fc9bc8f08e6d794db48b5bef0c",
    facts_sha256:"8b4a8aa5b59c0f762b252289bd988d7aa7add895c25e4196015cf85e0ad6c8f0"} : {...row}
)));
const pendingStartupJourneyDefinitions = Object.freeze(pendingDisclosureJourneyDefinitions.map(row=>Object.freeze(
  row.path === "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts" ? {...row,
    candidate:"1dafcde36e373a8444b0236f24c3fb9db86b8d109c07603d4e3753107820bc88",
    facts_sha256:"3b5718b169a9bd8fd91da9b95dbad1bb4bffaa414bc683d4186cd3004e6f5be3"} : {...row}
)));
const pendingCurrentJourneyDefinitions = pendingStartupJourneyDefinitions;
// Current startup-report assertions are an explicit additional definition set.
// Historical fixtures keep their exact preceding facts and never opt into it.
const pendingModelStartupReportDefinitions = Object.freeze([
  {path:"apps/desktop/src/renderer/features/models/tests/desktop-model-download-preload.ui.test.tsx",
    baseline:"608679a6095ef5617921e504bf208858df6a7c49",committed:"a109963772541a400749dbbaa06307888a1440c75b5efed8237a0fdfe4b8806c",
    candidate:"238fa423bc56cdef9bbcd6feaf207a363e37ba40c28751cb4c2ceef778905abd",facts_sha256:"deb4382d1c1e2d45a47870950038dde52669d9ccc279bf3ac0bc693fd2cc411c"},
  {path:"apps/desktop/src/renderer/features/python-runtime/tests/desktop-python-runtime-client.unit.test.ts",
    baseline:"608679a6095ef5617921e504bf208858df6a7c49",committed:"0461d04977a6958768c694ea1bda292c1808d5cd3654f94180674eee881fe88b",
    candidate:"8ad89c8b89bf025756e7effc7038a357790b8b781faaf20f18506c03e26e6634",facts_sha256:"a4293db13b03c6a49a1c1f9b9604dcc10654c7cce1af559cb849e6e590615645"},
  {path:"apps/desktop/src/renderer/features/python-runtime/tests/python-runtime-controls.recovery.ui.test.tsx",
    baseline:"608679a6095ef5617921e504bf208858df6a7c49",committed:"1d36083da854d78f668e320d1b7871778e8e309ec80005370a0fbaf5ee96c355",
    candidate:"365bc8c8e66de96974ee658c9a2e006769e6b3cc5fb812d0a32a9d864806dded",facts_sha256:"53e0cf976299029ab375ce152ddf36ab571d835e5658800a848f36cf76db1091"},
  {path:"dev-tools/scripts/qualification/tests/native-data-context-admission.unit.test.ts",
    baseline:"608679a6095ef5617921e504bf208858df6a7c49",committed:"8fd3d3fb1ed30e2a381b8b966e213825eb68fca5438934cd87874f262069e7ab",
    candidate:"55ba55112ff98432a06a16dcd80acc9b96e1c1a83bf6d05607ce9f9b83df9cea",facts_sha256:"ddadf3ed9ba19a168ee12450493a3e42a16a2ed0ae75370043dff505d8278619"},
].map(Object.freeze));
// Only the current private-provider definition revision accepts these exact two facts.
const pendingPrivateProviderDefinitions = Object.freeze([
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-operational-ui.e2e.spec.ts",
    "baseline": "608679a6095ef5617921e504bf208858df6a7c49",
    "committed": "677cbba4637b13dbb4e9cb5125e3d6277cf2e43323e458b9f2cc321411cd9560",
    "candidate": "1a62f166e93b8519dff996dabfada0d7f64ac331b2c4d5961c9533e0d64394ca",
    "facts_sha256": "5ad129b702da68e8175a01c4f2308bcac5ded8a241337e89ed6492e4a97f3480"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts",
    "baseline": "608679a6095ef5617921e504bf208858df6a7c49",
    "committed": "46f1d1db9960f951648a128f0b77b792a234f5d14bdb3f51969ee744ff6100b9",
    "candidate": "721d0bcbf609ae7b1affb209a05f08af6de7ff5e4ad83766a63dd22bbca5db2c",
    "facts_sha256": "ca4614d822f4629d679d6263e9b06ef651fa54629a7080707ee79710a046c595"
  }
].map(Object.freeze));
function privateProviderLegacyView(map,result){
  const remaining=assertContrastDiagnosticDrift(map,result,pendingPrivateProviderDefinitions);
  const prior=JSON.parse(historicalSource("26000fe16c1eab3b1f071960493c40b30a264fc4","docs/operations/comprehensive-ui-automation-current-census.json"));
  const previousRows=new Map();
  for(const definition of pendingPrivateProviderDefinitions){
    const rows=prior.sources.filter(row=>row.path===definition.path);assert.equal(rows.length,1);
    assert.equal(rows[0].facts.sha256,definition.committed);assert.equal(rows[0].committed_sha256,definition.committed);
    previousRows.set(definition.path,rows[0]);
  }
  // Exact new facts were checked above. Legacy owners inspect their genuine
  // pre-revision rows, never future facts under an old baseline or a new pin.
  return{map:{...map,sources:map.sources.map(row=>previousRows.has(row.path)?structuredClone(previousRows.get(row.path)):row)},result:remaining};
}
function assertReferenceSourceDrift(map,result){
  const legacy=workspaceSwitchLegacyView(map,result);
  assertPrivateProviderSourceDrift(legacy.map,legacy.result);
}
const pendingReviewBrowserDefinitions=Object.freeze([
  {path:"dev-tools/scripts/qualification/visual-composer/e2e/review-site-journey.ts",baseline:"608679a6095ef5617921e504bf208858df6a7c49",committed:"e4d72c2cb6906928bf441ba3787e7adb0c03ef6d6eee294438bb496ecf0ff67a",candidate:"bc5bd6a1b736fd0196371ad532a3998edc3eff78fa9d7ef200b2881ab86bbafe",facts_sha256:"81c1bc2d5bcd004735b62d973a7fc44cd1585ca2821f4f2184efe12f6e44014e",added:false},
  {path:"dev-tools/scripts/qualification/visual-composer/review-site-oracles.ts",baseline:"608679a6095ef5617921e504bf208858df6a7c49",committed:"0935280e22c8feffae1356913b3f56fc28b629565a568e25ca9e57b070cc794e",candidate:"55681ac62036d60b180316aa424871ab39775c1c358b39e9e2a35e08b12b4538",facts_sha256:"789beb2e327687dc13ef16363df1a038e837c06f89b526a50895ee1ac9378761",added:true},
  {path:"dev-tools/scripts/qualification/tests/review-site-oracles.unit.test.ts",baseline:"608679a6095ef5617921e504bf208858df6a7c49",committed:"1568ceef4d7dce87f07ae552142231b1b5feab2f1c316a7a3659f1d8daf82bf5",candidate:"42e2cbdf99dc92d9cc4d89806138b71c2123157582be11ea0bc2d7419f9107f3",facts_sha256:"7c248169ff30a3004692c3fa92532a0cdcd4894c3f95ab6334db5ae5c601d812",added:false},
].map(Object.freeze));
function reviewBrowserLegacyView(map,result){
  const remaining=assertContrastDiagnosticDrift(map,result,pendingReviewBrowserDefinitions);
  const prior=JSON.parse(historicalSource("42179ebae1106046efaa035d8c3682b974237dfb","docs/operations/comprehensive-ui-automation-current-census.json"));
  const added="dev-tools/scripts/qualification/visual-composer/review-site-oracles.ts",previousRows=new Map();
  assert.deepEqual(map.sources.filter(row=>row.path!==added).map(row=>row.path),prior.sources.map(row=>row.path));
  for(const definition of pendingReviewBrowserDefinitions){
    const row=map.sources.find(row=>row.path===definition.path);
    assert.deepEqual(Object.keys(row).sort(),["path","facts","committed_sha256"].sort());
    const old=prior.sources.filter(row=>row.path===definition.path);
    if(definition.added){assert.equal(definition.path,added);assert.equal(old.length,0);}
    else{assert.equal(old.length,1);assert.equal(old[0].facts.sha256,definition.committed);assert.equal(old[0].committed_sha256,definition.committed);previousRows.set(definition.path,old[0]);}
  }
  const originals=prior.scenarios.filter(row=>row.id==="contributor-review-site"),current=map.scenarios.filter(row=>row.id==="contributor-review-site");
  assert.equal(originals.length,1);assert.equal(current.length,1);assert.equal(current[0].behavior_links.length,originals[0].behavior_links.length);
  const scenarios=map.scenarios.map(row=>row.id!=="contributor-review-site"?row:{...row,behavior_links:row.behavior_links.map((link,index)=>{
    const old=originals[0].behavior_links[index];assert.deepEqual(Object.keys(link).sort(),["behavior_index","assertion_sources"].sort());
    assert.equal(link.behavior_index,old.behavior_index);assert.deepEqual(link.assertion_sources,[...old.assertion_sources,added]);
    return{...link,assertion_sources:[...old.assertion_sources]};
  })});
  // Strip only the exact newly inventoried pure module and restore the two
  // authenticated pre-change definitions/links. Forward all other rows and
  // gaps unchanged so older guards still inspect their own current facts.
  return{map:{...map,scenarios,sources:map.sources.filter(row=>row.path!==added).map(row=>previousRows.has(row.path)?structuredClone(previousRows.get(row.path)):row)},result:remaining};
}
// Committed definitions are authenticated against one actual reviewed source
// checkpoint. This source-only transition executes and qualifies no host.
const committedCensusDefinition=Object.freeze({baseline:"be0a48e241ca94d1ad18fda89ffa8f095d98e56c",priorMap:"926343f38eab0c2b1ca4870461ea9ab72a26d46a78f4df6f948a35f6670e4fc8",currentMap:"cde1583cb3a8130985f6a161a6a729e732b7a82afab8eeffd853c7fbc26ce04e"});
const pendingNavigationDefinition=Object.freeze({priorCommit:"a35834b49a9e056d49973a1377b10f819fbaa8b9",map:"141005a58243c93574bdfc3e57d4beb486c689b06bc3507917ee27dde6830ccf",sources:Object.freeze([
  Object.freeze({path:"dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts",committed:"1dafcde36e373a8444b0236f24c3fb9db86b8d109c07603d4e3753107820bc88",candidate:"c1d39d11f709e596979f6015e0cc8e25dc43f1d7d44097d45b47ed13528ea55f",facts:"af83f6e49b0319db10af2dffbd1ef14a14991e06571fc310b454a82d672f9344"}),
  Object.freeze({path:"dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts",committed:"0a03d828e46601b4c69c12907aa24853e120a0395e935bdd28f9c4d1730d5257",candidate:"71f74976798b4f2a01a4a9d35d914e68854be021a3b7415b04c647f46570f7b7",facts:"8ca76ee742c063261967cdd83b0ea1ee356f93edbd0188f84b61b17a220a8a98"}),
  Object.freeze({path:"dev-tools/scripts/qualification/visual-composer/e2e/technical-accessibility.ts",committed:"ef3494be87437ea5ea96f84271330bf04887c2ac717cb2be7d6816571f99491c",candidate:"1e3d7265b8fe88ddd4b1744f2ea194a50d5312a448f3c1140a91d42b52812596",facts:"1d16dd5a2cf496422ea179b705da646dee73907d436b688109f07e46635bea7b"}),
])});
let navigationPriorCensus;
// Restore the authenticated navigation epoch for its existing guards. The
// published inventory keeps all three working gaps and grants no execution.
const pendingNotificationDefinition=Object.freeze({priorCommit:"6c785c91f117d816829a899428433e162accfde2",priorMap:"141005a58243c93574bdfc3e57d4beb486c689b06bc3507917ee27dde6830ccf",map:"180aa692d4c09b8d62e6a8d3bd4b57a541c595efa1b88092fbd75e64de7285f1",sources:Object.freeze([
  Object.freeze({path:"dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts",committed:"1dafcde36e373a8444b0236f24c3fb9db86b8d109c07603d4e3753107820bc88",candidate:"a33f115f3603ae7d9b68ee775205c648ac7874789f915e13c7de1b5a30867083",facts:"3f50c18ac8a35a52353d830ca7f364466ca55b10e2f098e0f7412d22ace2ebcd"}),
  Object.freeze({path:"dev-tools/scripts/qualification/tests/technical-accessibility-observation.unit.test.ts",committed:"0a03d828e46601b4c69c12907aa24853e120a0395e935bdd28f9c4d1730d5257",candidate:"9b768717518c039eecb04c9f2621f7b2840da282c50113a036408e660e583e72",facts:"080ee3f999c51e39f1535867b20431e91bc2894641f2431529b6ebc1b715e6a0"}),
  Object.freeze({path:"dev-tools/scripts/qualification/visual-composer/e2e/technical-accessibility.ts",committed:"ef3494be87437ea5ea96f84271330bf04887c2ac717cb2be7d6816571f99491c",candidate:"42e2be25e1614f2d0a300995cd422e0bb49323811ed5a1a03b4896bdf2ec6b36",facts:"e9b01755971643bfeacc6e3e51fc5cfb23fdb00fdacbf8acec784f783f873423"}),
])});
let notificationPriorCensus;
const currentPublishedFormCensus = Object.freeze({
  commit: "32af5968602acee6c6557ec1223b36577b161ac4",
  digest: "95ec37315234ea99f817ab81fe390f423eab7e8106167bbbf4130064f02b2128",
  previousCommit: "6b0b7b47748c0792dbacbef5c06cbf3b3e5d3ab2",
});
const censusDocument = "docs/operations/comprehensive-ui-automation-current-census.json";
const currentFormEditorAssertions = Object.freeze({
  path: "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
  before: "ab5102e343e21bee01236f0e599fbf43f8a5c98dc8ea8036243bf7f82f929025",
  after: "7c97f3111a178ee0179d7e973c8d6f4123fc4cf4c883184f54095752708b1b0f",
  previousCheckpoint: "4b98c44d38be7e85d6c7d5925d57d178eccfc2cb",
  picker: "bd8517b151ba313cfee36660feea59a717290246368e433470e424bf67e94261",
  pickerFacts: "70c161f39790ede73dc765ef535bc82706c9b7afdcd20a69c489ff800d0371cd",
});
const publishedFormTabInventory = [
  {source: "apps/desktop/src/renderer/pages/SystemBuilderPage.tsx",
    before: "9ee37f4843cc9bc324842a60a20861b3404109ef5ea346f86f977540aec60c2b",
    after: "18fa6e8023f6e607273455aab60c6a8dd2eab35ad68505d45d074ad61a101216"},
  {source: "apps/thin-client/src/pages/SystemBuilderPage.tsx",
    before: "8cd543871e43bde6c2ede266d2d0bb53207adda1f94270b7b1581f8a461cf5b9",
    after: "9db0bd657c3118ec5719603df1de739bf6b709f559e7aac2f88236a794870105"},
];
const sourceDrift = map => map.sources.filter(row => row.facts.sha256 !== row.committed_sha256)
  .map(row => ({kind: "unreviewed-source-drift", source: row.path}));
const pendingFormHostSources = Object.freeze([
  {path: "dev-tools/scripts/qualification/visual-composer/e2e/managed-reference-form-composer.e2e.spec.ts",
    source: "bbcc77ce568358bc14963920d8dfb67a7aead41aaf119b2b4d7b51583f1ebc82",
    facts: "4a522939ce09d1ef57d0cb0f00107911ac221c02e3e6373fa7dae08b1fe35969"},
  {path: "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-form-composer.e2e.spec.ts",
    source: "1653f05fe5047e6a8d8c49d1249e01e898ed3e5f1944a77e7a2ebb60d4a3643e",
    facts: "ee9e798d64978e92112ceeedf422ddeb522b9e0e0d740f562d8dd1f1f00bd9be"},
].map(Object.freeze));

const reviewedAssetUiCensus = Object.freeze({
  priorCommit: "c520852ea9b9d619775ff7beb803af49e56bc742",
  before: "7edfe4ce16613ce7c7e140be05794a1bf82ffe4ed2c075153fb4ad74af0975cc",
  after: "4febc48d2f06bc85f40206d117f6219e3c8f7d89552aab52fa1bcb2c6399418c",
  pins: Object.freeze([
    {
      "path": "apps/desktop/src/renderer/features/asset-library/tests/asset-library-feature.unit.test.tsx",
      "source": "d083c1cec6bac8c8975b2daf5ed4d5b05a624bbb67a49654212ff41eaa36e682",
      "facts": "ab9152cc0956af70b8497c7a9c386b2dfb699f12633635ad02b100b284d290b1"
    },
    {
      "path": "apps/thin-client/src/features/asset-library/tests/asset-library-feature.unit.test.tsx",
      "source": "67cd67ef6dd4f22420658607d6abda76ced1db8f5ee1b7e1201240dd70036b3a",
      "facts": "a689733e0c52fffe0962d21a33ccecc3dce45d0047e2c8509ab192f0e34a7ea0"
    },
    {
      "path": "dev-tools/scripts/qualification/tests/asset-authoring-journey-oracles.unit.test.ts",
      "source": "b70fa1edaee91a99d3bd512f7028cc76dcfb5fa6b04338edf53b17a3c8fc3ed6",
      "facts": "ec3efb95d8b77544a2c3e538219e2d5cb4710ca78c50c0d2b7133b92975d46fa"
    },
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/asset-authoring-journey.ts",
      "source": "b03b0186d618586c078917fdc3b9bd41b324c7e88a7a90fe9550b4b6f6bf103f",
      "facts": "44994d2b40f65916256401d309f82a44900cabe5e3efdf6b6746a111bba50331"
    },
    {
      "path": "modules/ui/shared/asset-authoring/tests/AssetDerivedCustomizationEditor.interaction.ui.test.tsx",
      "source": "40728424074f56c94f3b311b0e743e51814125cd60a0a68728b80b2124f312bb",
      "facts": "d5552d1a1eff38f4c5a9dbeb9864141e454f7ca59b72daaf6a2bf573d56edad3"
    }
  ].map(Object.freeze)),
});
const reviewedNativeAssetUiCensus = Object.freeze({
  priorCommit: "2846ac1eba4bc72b4a49e61a6bdcaddd6c937666",
  before: "4febc48d2f06bc85f40206d117f6219e3c8f7d89552aab52fa1bcb2c6399418c",
  after: "2251a101e0619aeb5a9460bb9a7076e94122186e5a90dce79b5cb638fd579523",
  pins: Object.freeze([
    {
      "path": "dev-tools/scripts/qualification/tests/asset-authoring-journey-oracles.unit.test.ts",
      "source": "5c06d7e51c36a989042a47eda14a797754a05c4966a95d1ed71aebe67f61907b",
      "facts": "974f501a206ffb649fde1b3a29d4427540b68f5d51ff3a9ef2360209b3030f28"
    },
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/asset-authoring-journey.ts",
      "source": "fc588ba839112e1e0abed3a3e7eb425a12bdbb28c5fceb0393460d45d7f380de",
      "facts": "84022e374c324f0e4159977e17749f4d688fa87f916c4e2dc756d4bf9c5d9e05"
    },
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/browse-authoring-journey.ts",
      "source": "ab24ff0332af2c0bec624cbea88ce5bd9d360856dd110c6ed7570d688284b408",
      "facts": "ba038fa14d25ad2fd7917d42230ec9328c1aa69202b0be883a56592f7bd5590a"
    },
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-browse.e2e.spec.ts",
      "source": "3db95d34eff5e2815dded5dba19e0416fd1b5e6a1f2b4d87e7a607d6562dc7e3",
      "facts": "508040b5f21116c90dbec1f54b0b6bf05cf7e62e17273389c8018a83c44a6c18"
    }
  ].map(Object.freeze)),
});
const reviewedSettledCanvasAuditCensus = Object.freeze({
  priorCommit: "2c2efdf11dd77a52360b845253c6d1798a5e4277",
  before: "2251a101e0619aeb5a9460bb9a7076e94122186e5a90dce79b5cb638fd579523",
  after: "7f283029bd5621bb230b3cddee4f92c4072ca469a5d262f39cd95581df728ae5",
  pins: Object.freeze([
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/browse-authoring-journey.ts",
      "source": "3bec8ccb8f7cff183c95fed621f3c940dadd8faa41f895f3fa592116b92ae10c",
      "facts": "d54764203d68de46a1b244ca4b81c030a6cb18243d895217951d63e4c3833852"
    }
  ].map(Object.freeze)),
});
const reviewedCanvasPreviewSummaryCensus = Object.freeze({
  priorCommit: "0b1893506fe23b72c336d596371669cd3f0f7bbd",
  before: "7f283029bd5621bb230b3cddee4f92c4072ca469a5d262f39cd95581df728ae5",
  after: "c59b5c45b668a7983005f106ab1bdbd0da43c0d069f4608fc81d0337d0613ba5",
  pins: Object.freeze([
    {
      "path": "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
      "source": "5af135a29d7f7eed4faca5a486dd8a660c55642faaed15f5dcb0e5aa26df8833",
      "facts": "54791c5ceba33e59ed2b1729b5babd8831150212452128363e6b905850c4471b"
    },
    {
      "path": "modules/ui/shared/system-builder/tests/SystemManagementWorkspace.interaction.ui.test.tsx",
      "source": "455fe02945d95f943385111e118e0b3da92abcf50874d96102c6f80c0f1ff2a4",
      "facts": "6494a9d8f9734ed4c7c5ada1cdc7daf6cba1a0a7e78d616d9601fa3d324b3b9e"
    }
  ].map(Object.freeze)),
});
const reviewedMeaningfulFormCensus = Object.freeze({
  priorCommit: "d01e1d2c893ef5dde84fa1a2f9afa1c29cb951e1",
  before: "c59b5c45b668a7983005f106ab1bdbd0da43c0d069f4608fc81d0337d0613ba5",
  after: "971177e7a71eb16ef68296af18c9b6db272c645f7a8d258dfdfe78a8d4d2a46c",
  pins: Object.freeze([
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/meaningful-system-journeys.ts",
      "source": "17ccca24be2abb4fdba4578a9563ae1bd348e1ef5dcd1226f0f3524d0f0e6ddc",
      "facts": "b83464f10404fd650c8070f8bc50517cbe2819d64e8a89989462e9e4b96b65e3"
    }
  ].map(Object.freeze)),
});
const reviewedMeaningfulDesktopRestartCensus = Object.freeze({
  priorCommit: "f4aa86c10f99a7404fa5dff08ede0f3d2caaeb9a",
  before: "971177e7a71eb16ef68296af18c9b6db272c645f7a8d258dfdfe78a8d4d2a46c",
  after: "904cc0d0a1848841d4cdc3c33e233948de4274ad81403d01039b3ab9d0749dd9",
  pins: Object.freeze([
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-meaningful-systems.e2e.spec.ts",
      "source": "93cb6728cd671c92c0555742f052384ae0ab91859eef3ca06a9133aab4b383a0",
      "facts": "92b214f12fcc279c038f0f4a9f18ae7716930b4a78b8673ac6054256d48ef409"
    }
  ].map(Object.freeze)),
});
const reviewedLayoutKeyboardCensus = Object.freeze({
  priorCommit: "2ee74ec3cba764a19e84e783a32ab4ea29ce69d1",
  before: "904cc0d0a1848841d4cdc3c33e233948de4274ad81403d01039b3ab9d0749dd9",
  after: "f3c2520dafe477830e1680fedf076f2e3a941ebc8f5b91e2886a7af21ad257a3",
  pins: Object.freeze([
  {
    "path": "dev-tools/scripts/qualification/tests/asset-authoring-journey-oracles.unit.test.ts",
    "source": "aae3ab02592df4ee2328d3356780b7df1be6efb17a94defdfc76afba7216b42c",
    "facts": "fa29e89265686b2591ef3a6d506f65852f7ae675eee2d3031ab6062fd42010b9"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/browse-authoring-journey.ts",
    "source": "070abb2b7e6a45e134a9d8b06acf759b2763e0b2a9356269ad8c309330db0f14",
    "facts": "d4577f9f7b1bb14d5d2ca4bde356626592f0b4e7e32a460986dbf07ba32387f5"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/managed-reference-browse.e2e.spec.ts",
    "source": "03d0ea02fad18b159befef4be20747469240f24f7e6186d81bb3a164e8c44de2",
    "facts": "34100ecd5e8fdb391b72e9e3b8f4dcec5ae0d56a2952c05427872b012152c2bc"
  },
  {
    "path": "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-browse.e2e.spec.ts",
    "source": "e1997dce6738202414d0d00736d01c52a40599b7e080a86f4e67750dc9edcacf",
    "facts": "858bccbc5c83b6a651dbf30d8ebfe7d075b25ef0ac6462dd4c75f3c004edb6a7"
  },
  {
    "path": "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
    "source": "d94ea9bd27cc2b6fac7aa7ed133b6a423a3874d38b675aacc7d40d3b945de8e5",
    "facts": "158c92ac7fded47d2ac337bc110282e19afd17566a40c2a961b2270f629088bd"
  },
  {
    "path": "modules/ui/shared/system-builder/tests/SystemComposerStructureEditor.interaction.ui.test.tsx",
    "source": "8e3d11b49c3d7ca439d4f1c03be49491bae085bf8df46035a52eb33dfd7d16f3",
    "facts": "5e80c4ed859f41c8f38ef052b0dcc73669fe473fd933d23f73945cb422b107ba"
  },
  {
    "path": "modules/ui/shared/system-builder/tests/systemComposerDraft.unit.test.ts",
    "source": "02cbd193085bcae9c133d1d40eba1878f2d02399a2c4eeba06aa8bfe6333fab6",
    "facts": "f4dac370da7566384357dc9bce43e18474cc3f5cdfef73c923ad62cf6a0d08de"
  }
].map(Object.freeze)),
});
const reviewedPageLayoutCensus = Object.freeze({
  priorCommit: "50d49d4ddaddd4e6b9603748ee0df30147289c21",
  before: "f3c2520dafe477830e1680fedf076f2e3a941ebc8f5b91e2886a7af21ad257a3",
  after: "0b6169539877044db013b76f713d218ce68022008f8004b1483dc3cf569c5fef",
  pins: Object.freeze([
    {
      "path": "dev-tools/scripts/qualification/tests/asset-authoring-journey-oracles.unit.test.ts",
      "source": "b9e53b60676b5d380dce81ff60c1b23e0929b2c38e7b7e85b9b1c82ff4926012",
      "facts": "93303688ee04fe05b735155b207e75f3cc377dbf1a2e913623c3919afeaf43aa"
    },
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/browse-authoring-journey.ts",
      "source": "962b64ab37f1b4f2322d98aa7f4e6f378ade32070dc1bd4f17456bc7ca91c227",
      "facts": "3344236ca1dbe7c2ec5c4dc2d61f3412a7300de7a1d405291fccd63fe5fe2e64"
    },
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/managed-reference-browse.e2e.spec.ts",
      "source": "a7296d6c7f98aebcabe60985e92930e09c506ce1d0e5acf225d096f2cbd2ddf7",
      "facts": "91fc394c346daab168c90c8f81abd2a010f5c6f50aad1ee009a933900b789b09"
    },
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-browse.e2e.spec.ts",
      "source": "765ccf69f3cce262e3ff4999b2910fdb88f4520e42c66058847f04e28a71c1b4",
      "facts": "ae5d551783dea5b5e9cb2c55e0f82284a897e3bfb6775d37625dbfa7c0c020e9"
    },
    {
      "path": "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-browse.e2e.spec.ts",
      "source": "34e0b1df458f4d336c5a83d4795aa4fb03aa3befb534dacc19d6599eb12527c0",
      "facts": "6de86da860d9fadda5bcb63bee91b344c73b6e185e2fb03db2166bb460515d52"
    }
  ].map(Object.freeze)),
});
function verifyExactLayoutCensus(map, result, witness) {
  if (sha(JSON.stringify(map)) !== witness.after) return {map, result};
  const previous = JSON.parse(historicalSource(witness.priorCommit, censusDocument));
  assert.equal(sha(JSON.stringify(previous)), witness.before);
  const expected = structuredClone(previous);
  for (const pin of witness.pins) {
    const [row] = map.sources.filter(item => item.path === pin.path);
    const original = expected.sources.find(item => item.path === pin.path);
    assert(row && original);
    assert.equal(row.committed_sha256, original.committed_sha256);
    assert.notEqual(row.facts.sha256, original.facts.sha256);
    assert.equal(row.facts.sha256, pin.source);
    assert.equal(sha(JSON.stringify(row.facts)), pin.facts);
    assert.notEqual(row.facts.sha256, row.committed_sha256);
    original.facts = structuredClone(row.facts);
  }
  assert.deepEqual(map, expected);
  assert.deepEqual(result.gaps.filter(row => row.kind === "unreviewed-source-drift"), sourceDrift(expected));
  return {map: previous, result: {...result, gaps: [
    ...result.gaps.filter(row => row.kind !== "unreviewed-source-drift"), ...sourceDrift(previous),
  ]}};
}

const reviewedConnectionsCensus = Object.freeze({
  priorCommit: "04f6e61e6addfd8740fee66aca24871e8612038d",
  before: "0b6169539877044db013b76f713d218ce68022008f8004b1483dc3cf569c5fef",
  after: "78a1db7a862ca910ae668b8a306262ba6475d309388f452a972b0f9759c5d8e1",
  pins: Object.freeze([
    {
      "path": "modules/ui/shared/system-builder/tests/SystemBuilderCanvasReliability.interaction.ui.test.tsx",
      "source": "b714f9655acb729e229d41d1acb16b4f72047bd43df5a7507a5497994750d9fd",
      "facts": "0f412e73a236739ce7eda9deabda6f0d0c4f9b48a8c822f6a11da4bb90996ee2"
    }
  ].map(Object.freeze)),
});

const reviewedResponsiveAssetDriverCensus = Object.freeze({
  priorCommit: "39eabfa0842b763d4f9e1f48e52b860bf7c857ed",
  before: "78a1db7a862ca910ae668b8a306262ba6475d309388f452a972b0f9759c5d8e1",
  after: "1b6e660ac8cb24906a82e57a168d998ffa9b98684ec10941d3582132f3206368",
  pins: Object.freeze([
    {
      path: "dev-tools/scripts/qualification/visual-composer/e2e/guided-system-lifecycle.ts",
      source: "c1a0090245be44d12a062a27b3c6eca1a7b213260a3a3b9a909a3df0e0cb00aa",
      facts: "6f9774cd2fe1cc3a168ab343d70c8286919082b1e87709adb610bbe8a81bda68",
    },
    {
      path: "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-visual-composer.e2e.spec.ts",
      source: "227ffb5966cd3d6785fba911effe35cb81498a7016d24f395e5ac4c453b5d595",
      facts: "d03152f77ef99c3fe78dc05c532702cb17336ab5b6f1f1af876126d099545c20",
    },
  ].map(Object.freeze)),
});

const reviewedDesktopImageLabelCensus = Object.freeze({
  priorCommit: "b4d280e827006803d8a4cbf072063d6fbbdfcaaa",
  before: "1b6e660ac8cb24906a82e57a168d998ffa9b98684ec10941d3582132f3206368",
  after: "42a1e63e5aeaf9eaaaf7021821b48b1e4932373b5f6ed91c2d967cc755218721",
  pins: Object.freeze([Object.freeze({
    path: "apps/desktop/src/renderer/features/image-generation/tests/desktop-image-ipc-storage.ui.test.tsx",
    source: "472100888add0d25862cf91549b6a14d2eae361d332a5b0b67df77a0e1575491",
    facts: "30ba714ae52db2d050e8ff7e0122c2b3c41bbb2e00ab6dce125be92784b4c5ba",
  })]),
});

const reviewedBrowserModalCensus = Object.freeze({
  after: "0da3b1ce8e4f4724a858e9846e5b5122247251fa5a71f58330008fbeb4c72655",
  pins: Object.freeze([Object.freeze({
    path: "dev-tools/scripts/qualification/visual-composer/e2e/thin-client-visual-composer.e2e.spec.ts",
    source: "400c7d837eb48b2a8da7336c37369c63f5eddf62a16e6d6e3b3e75ca447838d3",
    facts: "c36fb3ccb2a50da49ac5d0c34209ebfc5f0d7afe5b2545c6f26b68a55d0419ec",
  })]),
});

// The new Composer case changes an existing drift row only. Reconstruct the
// predecessor for the earlier witnesses; the published gap stays visible.
const reviewedHeadlessDraftCensus = Object.freeze({
  priorCommit: "9f1a77f5057652a891c00597d668aebab2fc8bb5",
  before: reviewedBrowserModalCensus.after,
  after: "2ffea6c2f0995a85712fe87c6eb57aa4c531ae7799f2ce4bf959f55d5e4de56b",
  pins: Object.freeze([Object.freeze({
    path: "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
    source: "8b09340db67d2b7a5bc212e3dca036ed02337ca322e865cd76aab8930bd78837",
    facts: "97f6a1fbc047da6b7e42a032cd01f5d448144798cae0b1a0f1a9d9fcb9d9cdec",
  })]),
});

const reviewedHeadlessPassiveRefreshCensus = Object.freeze({
  priorCommit: "52cdfb540cf922e1a18d23bea6be36edc1e3cdd1",
  before: reviewedHeadlessDraftCensus.after,
  after: "8a87cf9b4d77278592d2d5ce2e2bb198ce4b023d067210b4fe7cdadbac7ace5e",
  pins: Object.freeze([Object.freeze({
    path: "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx",
    source: "ed59a408278047f9c6909fb2f33127285ca0a81ffd08d48bcc19ffbf4798ef6a",
    facts: "ced3e1f7ce9edae9a2234e36ddbf4b7f84524335cc822621ad2f6e4ed294535e",
  })]),
});

function beforeDesktopImageLabelCensus(map, result) {
  ({map, result} = headlessPackagedCensusLegacyView(map, result));
  // This page changed how it refreshes, but its tabs and qualifications did not.
  if (sha(JSON.stringify(map)) === "0e3adf3631d4f9dc03f0021e75685037f343ec8f03fd297753665875e99149d7") {
    const previous = JSON.parse(historicalSource("507533ef743355842cb5ce4e4038d801926bf5df", censusDocument));
    assert.equal(sha(JSON.stringify(previous)), reviewedHeadlessPassiveRefreshCensus.after);
    const expected = structuredClone(previous);
    const row = expected.inventories.find(item => item.source === "apps/desktop/src/renderer/pages/SystemBuilderPage.tsx");
    assert.equal(row.sha256, "18fa6e8023f6e607273455aab60c6a8dd2eab35ad68505d45d074ad61a101216");
    row.sha256 = "b45ee0b19c41634bf3d912a950f1f24d699a358823e07470f5cefb910a11e0d0";
    const path = "modules/ui/shared/system-builder/tests/SystemManagementWorkspace.interaction.ui.test.tsx";
    const original = expected.sources.find(item => item.path === path);
    const actual = map.sources.find(item => item.path === path);
    assert.equal(actual.committed_sha256, original.committed_sha256);
    assert.equal(actual.facts.sha256, "a94eff0f66dc41d0fb446425aeabaf0564cbfd8bd3deebf80686cbe27f814f59");
    assert.equal(sha(JSON.stringify(actual.facts)), "199153abe35ff4fbfb5c4568a6f5f10c32ad6e7b9b857a24a7aab2f85f3aca9d");
    original.facts = structuredClone(actual.facts);
    assert.deepEqual(map, expected);
    assert.deepEqual(result.gaps.filter(item => item.kind === "unreviewed-source-drift"), sourceDrift(expected));
    map = previous;
    result = {...result, gaps: [...result.gaps.filter(item => item.kind !== "unreviewed-source-drift"), ...sourceDrift(previous)]};
  }
  ({map, result} = verifyExactLayoutCensus(map, result, reviewedHeadlessPassiveRefreshCensus));
  ({map, result} = verifyExactLayoutCensus(map, result, reviewedHeadlessDraftCensus));
  if (sha(JSON.stringify(map)) === reviewedBrowserModalCensus.after) {
    const previous = JSON.parse(historicalSource(reviewedDesktopImageLabelCensus.priorCommit, censusDocument));
    assert.equal(sha(JSON.stringify(previous)), reviewedDesktopImageLabelCensus.before);
    const expected = structuredClone(previous);
    for (const pin of [...reviewedDesktopImageLabelCensus.pins, ...reviewedBrowserModalCensus.pins]) {
      const [row] = map.sources.filter(item => item.path === pin.path);
      const original = expected.sources.find(item => item.path === pin.path);
      assert(row && original);
      assert.equal(row.committed_sha256, original.committed_sha256);
      assert.equal(row.facts.sha256, pin.source);
      assert.equal(sha(JSON.stringify(row.facts)), pin.facts);
      original.facts = structuredClone(row.facts);
    }
    assert.deepEqual(map, expected);
    assert.deepEqual(result.gaps.filter(row => row.kind === "unreviewed-source-drift"), sourceDrift(expected));
    return {map: previous, result: {...result, gaps: [...result.gaps.filter(row => row.kind !== "unreviewed-source-drift"), ...sourceDrift(previous)]}};
  }
  return verifyExactLayoutCensus(map, result, reviewedDesktopImageLabelCensus);
}

function pageLayoutLegacyView(map, result) {
  ({map, result} = beforeDesktopImageLabelCensus(map, result));
  ({map, result} = verifyExactLayoutCensus(map, result, reviewedResponsiveAssetDriverCensus));
  ({map, result} = verifyExactLayoutCensus(map, result, reviewedConnectionsCensus));
  return verifyExactLayoutCensus(map, result, reviewedPageLayoutCensus);
}

function layoutKeyboardLegacyView(map, result) {
  ({map, result} = pageLayoutLegacyView(map, result));
  return verifyExactLayoutCensus(map, result, reviewedLayoutKeyboardCensus);
}

function meaningfulDesktopRestartLegacyView(map, result) {
  ({map,result}=layoutKeyboardLegacyView(map,result));
  if (sha(JSON.stringify(map)) !== reviewedMeaningfulDesktopRestartCensus.after) return {map, result};
  const previous = JSON.parse(historicalSource(reviewedMeaningfulDesktopRestartCensus.priorCommit, censusDocument));
  assert.equal(sha(JSON.stringify(previous)), reviewedMeaningfulDesktopRestartCensus.before);
  const expected = structuredClone(previous);
  for (const pin of reviewedMeaningfulDesktopRestartCensus.pins) {
    const [row] = map.sources.filter(item => item.path === pin.path);
    const original = expected.sources.find(item => item.path === pin.path);
    assert(row && original);
    assert.equal(row.committed_sha256, original.committed_sha256);
    assert.notEqual(row.facts.sha256, original.facts.sha256);
    assert.equal(row.facts.sha256, pin.source);
    assert.equal(sha(JSON.stringify(row.facts)), pin.facts);
    assert.notEqual(row.facts.sha256, row.committed_sha256);
    original.facts = structuredClone(row.facts);
  }
  assert.deepEqual(map, expected);
  assert.deepEqual(result.gaps.filter(row => row.kind === "unreviewed-source-drift"), sourceDrift(expected));
  return {map: previous, result: {...result, gaps: [
    ...result.gaps.filter(row => row.kind !== "unreviewed-source-drift"), ...sourceDrift(previous),
  ]}};
}

function meaningfulFormLegacyView(map, result) {
  ({map,result}=meaningfulDesktopRestartLegacyView(map,result));
  if (sha(JSON.stringify(map)) !== reviewedMeaningfulFormCensus.after) return {map, result};
  const previous = JSON.parse(historicalSource(reviewedMeaningfulFormCensus.priorCommit, censusDocument));
  assert.equal(sha(JSON.stringify(previous)), reviewedMeaningfulFormCensus.before);
  const expected = structuredClone(previous);
  for (const pin of reviewedMeaningfulFormCensus.pins) {
    const [row] = map.sources.filter(item => item.path === pin.path);
    const original = expected.sources.find(item => item.path === pin.path);
    assert(row && original);
    assert.equal(row.committed_sha256, original.committed_sha256);
    assert.notEqual(row.facts.sha256, original.facts.sha256);
    assert.equal(row.facts.sha256, pin.source);
    assert.equal(sha(JSON.stringify(row.facts)), pin.facts);
    assert.notEqual(row.facts.sha256, row.committed_sha256);
    original.facts = structuredClone(row.facts);
  }
  assert.deepEqual(map, expected);
  assert.deepEqual(result.gaps.filter(row => row.kind === "unreviewed-source-drift"), sourceDrift(expected));
  return {map: previous, result: {...result, gaps: [
    ...result.gaps.filter(row => row.kind !== "unreviewed-source-drift"), ...sourceDrift(previous),
  ]}};
}

function canvasPreviewSummaryLegacyView(map, result) {
  ({map,result}=meaningfulFormLegacyView(map,result));
  if (sha(JSON.stringify(map)) !== reviewedCanvasPreviewSummaryCensus.after) return {map, result};
  const previous = JSON.parse(historicalSource(reviewedCanvasPreviewSummaryCensus.priorCommit, censusDocument));
  assert.equal(sha(JSON.stringify(previous)), reviewedCanvasPreviewSummaryCensus.before);
  const expected = structuredClone(previous);
  for (const pin of reviewedCanvasPreviewSummaryCensus.pins) {
    const [row] = map.sources.filter(item => item.path === pin.path);
    const original = expected.sources.find(item => item.path === pin.path);
    assert(row && original);
    assert.equal(row.committed_sha256, original.committed_sha256);
    assert.notEqual(row.facts.sha256, original.facts.sha256);
    assert.equal(row.facts.sha256, pin.source);
    assert.equal(sha(JSON.stringify(row.facts)), pin.facts);
    assert.notEqual(row.facts.sha256, row.committed_sha256);
    original.facts = structuredClone(row.facts);
  }
  assert.deepEqual(map, expected);
  assert.deepEqual(result.gaps.filter(row => row.kind === "unreviewed-source-drift"), sourceDrift(expected));
  return {map: previous, result: {...result, gaps: [
    ...result.gaps.filter(row => row.kind !== "unreviewed-source-drift"), ...sourceDrift(previous),
  ]}};
}

function settledCanvasAuditLegacyView(map, result) {
  ({map,result}=canvasPreviewSummaryLegacyView(map,result));
  if (sha(JSON.stringify(map)) !== reviewedSettledCanvasAuditCensus.after) return {map, result};
  const previous = JSON.parse(historicalSource(reviewedSettledCanvasAuditCensus.priorCommit, censusDocument));
  assert.equal(sha(JSON.stringify(previous)), reviewedSettledCanvasAuditCensus.before);
  const expected = structuredClone(previous);
  for (const pin of reviewedSettledCanvasAuditCensus.pins) {
    const [row] = map.sources.filter(item => item.path === pin.path);
    const original = expected.sources.find(item => item.path === pin.path);
    assert(row && original);
    assert.equal(row.committed_sha256, original.committed_sha256);
    assert.notEqual(row.facts.sha256, original.facts.sha256);
    assert.equal(row.facts.sha256, pin.source);
    assert.equal(sha(JSON.stringify(row.facts)), pin.facts);
    assert.notEqual(row.facts.sha256, row.committed_sha256);
    original.facts = structuredClone(row.facts);
  }
  assert.deepEqual(map, expected);
  assert.deepEqual(result.gaps.filter(row => row.kind === "unreviewed-source-drift"), sourceDrift(expected));
  return {map: previous, result: {...result, gaps: [
    ...result.gaps.filter(row => row.kind !== "unreviewed-source-drift"), ...sourceDrift(previous),
  ]}};
}

function nativeAssetUiCensusLegacyView(map, result) {
  ({map,result}=settledCanvasAuditLegacyView(map,result));
  if (sha(JSON.stringify(map)) !== reviewedNativeAssetUiCensus.after) return {map, result};
  const previous = JSON.parse(historicalSource(reviewedNativeAssetUiCensus.priorCommit, censusDocument));
  assert.equal(sha(JSON.stringify(previous)), reviewedNativeAssetUiCensus.before);
  const expected = structuredClone(previous);
  for (const pin of reviewedNativeAssetUiCensus.pins) {
    const [row] = map.sources.filter(item => item.path === pin.path);
    const original = expected.sources.find(item => item.path === pin.path);
    assert(row && original);
    assert.equal(row.committed_sha256, original.committed_sha256);
    assert.notEqual(row.facts.sha256, original.facts.sha256);
    assert.equal(row.facts.sha256, pin.source);
    assert.equal(sha(JSON.stringify(row.facts)), pin.facts);
    assert.notEqual(row.facts.sha256, row.committed_sha256);
    original.facts = structuredClone(row.facts);
  }
  assert.deepEqual(map, expected);
  assert.deepEqual(result.gaps.filter(row => row.kind === "unreviewed-source-drift"), sourceDrift(expected));
  return {map: previous, result: {...result, gaps: [
    ...result.gaps.filter(row => row.kind !== "unreviewed-source-drift"), ...sourceDrift(previous),
  ]}};
}

function assetUiCensusLegacyView(map, result) {
  ({map,result}=nativeAssetUiCensusLegacyView(map,result));
  if (sha(JSON.stringify(map)) !== reviewedAssetUiCensus.after) return {map, result};
  const previous = JSON.parse(historicalSource(reviewedAssetUiCensus.priorCommit, censusDocument));
  assert.equal(sha(JSON.stringify(previous)), reviewedAssetUiCensus.before);
  const expected = structuredClone(previous), newDrift = new Set();
  for (const pin of reviewedAssetUiCensus.pins) {
    const [row] = map.sources.filter(item => item.path === pin.path);
    const original = expected.sources.find(item => item.path === pin.path);
    assert(row && original && !newDrift.has(pin.path));
    assert.equal(row.committed_sha256, original.committed_sha256);
    assert.equal(original.facts.sha256, original.committed_sha256);
    assert.equal(row.facts.sha256, pin.source);
    assert.equal(sha(JSON.stringify(row.facts)), pin.facts);
    assert.notEqual(row.facts.sha256, row.committed_sha256);
    original.facts = structuredClone(row.facts);
    newDrift.add(pin.path);
  }
  assert.deepEqual(map, expected);
  assert.deepEqual(result.gaps.filter(row => row.kind === "unreviewed-source-drift"), sourceDrift(expected));
  // The published census keeps every gap. Only the historical validator sees
  // its own prior definitions; neither inventory asserts host execution.
  return {map: previous, result: {...result, gaps: result.gaps.filter(row =>
    !(row.kind === "unreviewed-source-drift" && newDrift.has(row.source)))}};
}

function formHostCensusLegacyView(map, result) {
  ({map,result}=assetUiCensusLegacyView(map,result));
  const editor = map.sources.find(row => row.path === currentFormEditorAssertions.path);
  if (editor?.facts.sha256 === currentFormEditorAssertions.picker) {
    assert.equal(sha(JSON.stringify(editor.facts)), currentFormEditorAssertions.pickerFacts);
    const previous = sourceFacts(editor.path, historicalSource(currentFormEditorAssertions.previousCheckpoint, editor.path));
    assert.equal(previous.sha256, currentFormEditorAssertions.after);
    map = {...map, sources: map.sources.map(row => row === editor ? {...row, facts: previous} : row)};
  }
  const paths = new Set(pendingFormHostSources.map(row => row.path));
  if (!map.host_spec_files.some(path => paths.has(path)) && !map.sources.some(row => paths.has(row.path))) {
    return {map, result};
  }
  for (const pending of pendingFormHostSources) {
    assert.equal(map.host_spec_files.filter(path => path === pending.path).length, 1);
    const rows = map.sources.filter(row => row.path === pending.path);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].committed_sha256, "0".repeat(64), "These definitions did not exist at the retained baseline.");
    assert.equal(rows[0].facts.sha256, pending.source);
    assert.equal(sha(JSON.stringify(rows[0].facts)), pending.facts);
    assert.equal(result.gaps.filter(row => row.kind === "unreviewed-source-drift" && row.source === pending.path).length, 1);
  }
  // Older assertions receive only the exact original census. New definitions
  // remain explicit gaps and do not change any scenario or execution status.
  const previous = {...map, sources: map.sources.filter(row => !paths.has(row.path)),
    host_spec_files: map.host_spec_files.filter(path => !paths.has(path))};
  assert.equal(sha(JSON.stringify(previous)), currentPublishedFormCensus.digest);
  return {map: previous, result: {...result,
    gaps: result.gaps.filter(row => !(row.kind === "unreviewed-source-drift" && paths.has(row.source)))}};
}
function currentPublishedFormCensusLegacyView(map, result) {
  ({map,result}=formHostCensusLegacyView(map,result));
  if (sha(JSON.stringify(map)) !== currentPublishedFormCensus.digest) return {map, result};
  const actual = JSON.parse(historicalSource(currentPublishedFormCensus.commit, censusDocument));
  // The tab inventories remain as previously reviewed. Only the editor
  // assertions changed, and their original committed drift must remain.
  for (const {source,after} of publishedFormTabInventory) {
    const rows = actual.inventories.filter(row => row.source === source && row.property === "label");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sha256, after);
  }
  const sourceRows = actual.sources.filter(row => row.path === currentFormEditorAssertions.path);
  assert.equal(sourceRows.length, 1);
  const [sourceRow] = sourceRows;
  assert.equal(sourceRow.facts.sha256, currentFormEditorAssertions.before);
  const facts = sourceFacts(sourceRow.path, historicalSource(currentFormEditorAssertions.previousCheckpoint, sourceRow.path));
  assert.equal(facts.sha256, currentFormEditorAssertions.after);
  assert.notEqual(sourceRow.committed_sha256, facts.sha256);
  sourceRow.facts = facts;
  assert.deepEqual(map, actual);
  assert.deepEqual(result.gaps.filter(row => row.kind === "unreviewed-source-drift"), sourceDrift(actual));
  const previous = JSON.parse(historicalSource(currentPublishedFormCensus.previousCommit, censusDocument));
  assert.equal(sha(JSON.stringify(previous)), pendingNotificationDefinition.map);
  // Only tests of earlier witnesses receive that immutable view. The actual
  // inventory and all its pending checks are left unchanged.
  return {map: previous, result: {...result, gaps: [
    ...result.gaps.filter(row => row.kind !== "unreviewed-source-drift"), ...sourceDrift(previous),
  ]}};
}
function notificationCensusLegacyView(map,result){
  ({map,result}=currentPublishedFormCensusLegacyView(map,result));
  const digest=sha(JSON.stringify(map));
  if(map.source_baseline!==committedCensusDefinition.baseline||digest===committedCensusDefinition.currentMap||digest===pendingNavigationDefinition.map)return{map,result};
  assert.equal(digest,pendingNotificationDefinition.map);
  assert.deepEqual(result.gaps.filter(row=>row.kind==="unreviewed-source-drift"),pendingNotificationDefinition.sources.map(row=>({kind:"unreviewed-source-drift",source:row.path})));
  if(!notificationPriorCensus){notificationPriorCensus=JSON.parse(historicalSource(pendingNotificationDefinition.priorCommit,"docs/operations/comprehensive-ui-automation-current-census.json"));assert.equal(sha(JSON.stringify(notificationPriorCensus)),pendingNotificationDefinition.priorMap);}
  const expected=structuredClone(notificationPriorCensus);
  for(const pending of pendingNotificationDefinition.sources){
    const rows=map.sources.filter(row=>row.path===pending.path);assert.equal(rows.length,1);const row=rows[0];
    assert.equal(row.committed_sha256,pending.committed);assert.equal(row.facts.sha256,pending.candidate);assert.equal(sha(JSON.stringify(row.facts)),pending.facts);
    const index=expected.sources.findIndex(item=>item.path===pending.path);assert(index>=0);assert.equal(expected.sources[index].committed_sha256,row.committed_sha256);expected.sources[index]=structuredClone(row);
  }
  assert.deepEqual(map,expected);
  return{map:structuredClone(notificationPriorCensus),result};
}
function navigationCensusLegacyView(map,result){
  ({map,result}=notificationCensusLegacyView(map,result));
  if(map.source_baseline!==committedCensusDefinition.baseline||sha(JSON.stringify(map))===committedCensusDefinition.currentMap)return{map,result};
  // Only this exact prospective definition set is admitted. Its three gaps
  // remain in published data; this view restores authentic rows for old guards.
  assert.equal(sha(JSON.stringify(map)),pendingNavigationDefinition.map);
  const expectedGaps=pendingNavigationDefinition.sources.map(row=>({kind:"unreviewed-source-drift",source:row.path}));
  assert.deepEqual(result.gaps.filter(row=>row.kind==="unreviewed-source-drift"),expectedGaps);
  if(!navigationPriorCensus){
    navigationPriorCensus=JSON.parse(historicalSource(pendingNavigationDefinition.priorCommit,"docs/operations/comprehensive-ui-automation-current-census.json"));
    assert.equal(sha(JSON.stringify(navigationPriorCensus)),committedCensusDefinition.currentMap);
  }
  const expected=structuredClone(navigationPriorCensus),names=new Set();
  for(const pending of pendingNavigationDefinition.sources){
    const rows=map.sources.filter(row=>row.path===pending.path);assert.equal(rows.length,1);const row=rows[0];
    assert.equal(row.committed_sha256,pending.committed);assert.equal(row.facts.sha256,pending.candidate);assert.equal(sha(JSON.stringify(row.facts)),pending.facts);
    const index=expected.sources.findIndex(item=>item.path===pending.path);assert(index>=0);assert.equal(expected.sources[index].committed_sha256,row.committed_sha256);expected.sources[index]=structuredClone(row);names.add(row.path);
  }
  assert.deepEqual(map,expected);
  return{map:structuredClone(navigationPriorCensus),result:{...result,gaps:result.gaps.filter(row=>!(row.kind==="unreviewed-source-drift"&&names.has(row.source)))}};
}
let committedCensusWitness;
const headlessPackagedSpec = "dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-headless.e2e.spec.ts";
function headlessPackagedCensusLegacyView(map, result) {
  if (sha(JSON.stringify(map)) === "d87c96feb11029c8e7f0f646d2fdf20ec704bc7658952a9ca99b6aeb110c0edd") {
    // The shell checkpoint changes the Composer witness and the declared desktop
    // Systems tab source. Preserve the previously recorded facts and all gaps.
    const saved = JSON.parse(historicalSource("0baea36a22df6de28d8759755ef77d69a38e92d3", censusDocument));
    assert.equal(sha(JSON.stringify(saved)), "5e9727914522e563808c3953caef4009d15f2e0ca6c69d73ee0ecfbd2220e1aa");
    const expected = structuredClone(saved);
    const path = "modules/ui/shared/system-builder/tests/SystemBuilderWorkspace.interaction.ui.test.tsx";
    const facts = map.sources.find(row => row.path === path).facts;
    assert.equal(facts.sha256, "8e359ed1b5d7759cdeb178241becea39c6eacf97d111d8359aa701c56bccb568");
    assert.equal(sha(JSON.stringify(facts)), "5b202bf97c51129092c27bb7ddfcfc789a40fa8b797e81581232ba5f02478feb");
    expected.sources.find(row => row.path === path).facts = facts;
    expected.inventories.find(row => row.source === "apps/desktop/src/renderer/pages/SystemBuilderPage.tsx").sha256 =
      "386ed64832e05e9ed43e0182e8c2447bea798a893d70b4c1c731177d8817591e";
    assert.deepEqual(map, expected);
    assert.deepEqual(result.gaps.filter(item => item.kind === "unreviewed-source-drift"), sourceDrift(expected));
    return headlessPackagedCensusLegacyView(saved, result);
  }
  const source = map.sources.find(row => row.path === headlessPackagedSpec);
  if (!source) return {map, result};
  if (sha(JSON.stringify(map)) === "5e9727914522e563808c3953caef4009d15f2e0ca6c69d73ee0ecfbd2220e1aa") {
    const saved = JSON.parse(historicalSource("a1894a3a13a013bfb25d12ddae1c074923216b34", censusDocument));
    assert.equal(sha(JSON.stringify(saved)), "e20baf59bdd2461036c73745b83bcad0566fae507541c9d9cd313b57c5962bc9");
    const expected = structuredClone(saved);
    expected.sources[expected.sources.findIndex(row => row.path === headlessPackagedSpec)].facts = source.facts;
    assert.equal(source.facts.sha256, "79c74599ccba86000973045e9b4f7cd89eb7e3e1381378b0a8f278c3d2be1f8a");
    assert.equal(sha(JSON.stringify(source.facts)), "e0bf28e6f84706bcf55d47457174fdc31946f415e5938ad852143556b38658de");
    assert.deepEqual(map, expected);
    assert.deepEqual(result.gaps.filter(item => item.kind === "unreviewed-source-drift"), sourceDrift(expected));
    return headlessPackagedCensusLegacyView(saved, result);
  }
  if (sha(JSON.stringify(map)) === "e20baf59bdd2461036c73745b83bcad0566fae507541c9d9cd313b57c5962bc9") {
    const commit = "6ce8b3255a935f3a02e65f902a2989b31a417bf6";
    const saved = JSON.parse(historicalSource(commit, censusDocument));
    assert.equal(sha(JSON.stringify(saved)), "3cca8c5a8478e7355c5b88e930875f2979f074d3e2fd9e1f89fbc788db2fc133");
    const prior = saved.sources.find(row => row.path === headlessPackagedSpec);
    const committed = sourceFacts(headlessPackagedSpec, historicalSource(commit, headlessPackagedSpec));
    assert.deepEqual(prior.facts, committed);
    assert.equal(prior.committed_sha256, committed.sha256);
    assert.equal(source.committed_sha256, committed.sha256);
    assert.equal(source.facts.sha256, "8f78b003b93d10cd55fa7a26045d9e9e7f1d64901e946fabbe22cc4e01634e38");
    assert.equal(sha(JSON.stringify(source.facts)), "205d01b56f5e64bfecd6d77f0efb5b8a5d4cea232522a3e587dfdd43de7d4ae9");
    const expected = structuredClone(saved);
    expected.sources[expected.sources.findIndex(row => row.path === headlessPackagedSpec)].facts = source.facts;
    assert.deepEqual(map, expected);
    const isPending = item => item.kind === "unreviewed-source-drift" && item.source === headlessPackagedSpec;
    assert.equal(result.gaps.filter(isPending).length, 1);
    const priorResult = {...result, gaps:result.gaps.filter(item => !isPending(item))};
    assert.deepEqual(priorResult.gaps.filter(item => item.kind === "unreviewed-source-drift"), sourceDrift(saved));
    return headlessPackagedCensusLegacyView(saved, priorResult);
  }
  const prior = JSON.parse(historicalSource("2ae9ccfd296d7dfa9c4f7465d81145a776081309", censusDocument));
  assert.equal(sha(JSON.stringify(prior)), "0e3adf3631d4f9dc03f0021e75685037f343ec8f03fd297753665875e99149d7");
  assert.equal(source.facts.sha256, "798835bf3f41179646d5bb79269f21ad9c7e9d116a967c0590db2d57598486dd");
  assert.equal(source.committed_sha256, source.facts.sha256);
  assert.equal(sha(JSON.stringify(source.facts)), "4af822bfed55376be4f7f81dd3924dd1ecc848726842ac8ce1ef0aa8582f8c93");
  const expected = structuredClone(prior);
  expected.sources.push(source);
  expected.host_spec_files = [...expected.host_spec_files, headlessPackagedSpec].sort();
  assert.deepEqual(map, expected);
  assert.deepEqual(result.gaps.filter(item => item.kind === "unreviewed-source-drift"), sourceDrift(prior));
  return {map: prior, result};
}
function committedCensusLegacyView(map,result){
  ({map,result}=headlessPackagedCensusLegacyView(map,result));
  ({map,result}=navigationCensusLegacyView(map,result));
  if(map.source_baseline!==committedCensusDefinition.baseline){
    assert.equal(map.source_baseline,"608679a6095ef5617921e504bf208858df6a7c49");
    return{map,result};
  }
  // Reject changed/future definitions before requesting any Git witness.
  assert.equal(sha(JSON.stringify(map)),committedCensusDefinition.currentMap);
  assert.deepEqual(result.gaps.filter(g=>g.kind==="unreviewed-source-drift"),[]);
  if(!committedCensusWitness){
    const prior=JSON.parse(historicalSource(committedCensusDefinition.baseline,"docs/operations/comprehensive-ui-automation-current-census.json"));
    assert.equal(sha(JSON.stringify(prior)),committedCensusDefinition.priorMap);
    assert.equal(prior.sources.length,181);const expected=structuredClone(prior);
    const names=prior.sources.map(row=>censusPath(row.path));assert.equal(new Set(names).size,names.length);
    const env={...process.env};for(const key of Object.keys(env))if(key.toUpperCase().startsWith("GIT_"))delete env[key];
    Object.assign(env,{GIT_CONFIG_NOSYSTEM:"1",GIT_NO_REPLACE_OBJECTS:"1",GIT_OPTIONAL_LOCKS:"0"});
    const bytes=execFileSync("git",["--no-optional-locks","cat-file","--batch"],{env,windowsHide:true,timeout:20000,maxBuffer:CENSUS_LIMITS.totalBytes+192*256,input:names.map(name=>committedCensusDefinition.baseline+":"+name).join("\n")+"\n"});
    let offset=0,total=0;const decoder=new TextDecoder("utf-8",{fatal:true});
    for(const row of expected.sources){
      const end=bytes.indexOf(10,offset);assert(end>=offset&&end-offset<=200);
      const header=/^[a-f0-9]{40,64} blob (0|[1-9][0-9]*)$/.exec(bytes.subarray(offset,end).toString("ascii"));assert(header);
      const size=Number(header[1]);assert(Number.isSafeInteger(size)&&size<=CENSUS_LIMITS.sourceBytes&&end+1+size<bytes.length&&bytes[end+1+size]===10);
      const source=bytes.subarray(end+1,end+1+size);total+=size;assert(total<=CENSUS_LIMITS.totalBytes);offset=end+size+2;
      assert.deepEqual(sourceFacts(row.path,source),row.facts);
      row.committed_sha256=sha(decoder.decode(source).replace(/\r\n/g,"\n"));assert.equal(row.committed_sha256,row.facts.sha256);
    }
    assert.equal(offset,bytes.length);expected.source_baseline=committedCensusDefinition.baseline;
    assert.equal(sha(JSON.stringify(expected)),committedCensusDefinition.currentMap);
    const gaps=prior.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}));assert.equal(gaps.length,17);
    committedCensusWitness={prior,expected,gaps};
  }
  assert.deepEqual(map,committedCensusWitness.expected);
  // Only this exact internal historical view reaches the unchanged older
  // validators. This never removes published working gaps or adds a host pass.
  return{map:structuredClone(committedCensusWitness.prior),result:{...result,gaps:[...result.gaps,...structuredClone(committedCensusWitness.gaps)]}};
}
function assertCompleteCurrentSourceDrift(map,result){
  const historical=committedCensusLegacyView(map,result);
  assertBrowserReferenceSourceDrift(historical.map,historical.result);
}

function assertBrowserReferenceSourceDrift(map,result){
  const legacy=reviewBrowserLegacyView(map,result);
  assertReferenceSourceDrift(legacy.map,legacy.result);
}
function assertPrivateProviderSourceDrift(map,result){
  const legacy=privateProviderLegacyView(map,result);
  assertCurrentSourceDrift(legacy.map,legacy.result,true);
}
// This current revision adds exactly three workspace-confirmation definitions.
// Historical validators receive only their authentic pre-revision rows.
const pendingWorkspaceSwitchDefinitions=Object.freeze([
  {path:"dev-tools/scripts/qualification/visual-composer/e2e/provider-source-host-journey.ts",baseline:"608679a6095ef5617921e504bf208858df6a7c49",committed:"9ddcfcbe620a754857065c4d28c7368d3bf4f870d0b0ce32771c8e87a0780662",candidate:"fb15317d72ee375047c5cb24e16d417a96e8fa7781fe2ba0839caa452575915a",facts_sha256:"50fea604b766b5546beb69be6efa047cebcb7b99817964f59f09354a2d85d9b5"},
  {path:"dev-tools/scripts/qualification/visual-composer/e2e/artifact-lifecycle-host-journey.ts",baseline:"608679a6095ef5617921e504bf208858df6a7c49",committed:"14225c5974a305f52ad7ff64dfdc4bbd0bc6a28836d58986859d3fa55c787dfd",candidate:"a2eb97b9689441fd53b5d3a8b1fecf2decf5cc84b66bb6bd507344b1552a4565",facts_sha256:"2bd02edb40f67f5d5d42bc507cc204b7723f59af45127da7f3d763fffc694770"},
  {path:"dev-tools/scripts/qualification/visual-composer/e2e/model-reference-host-journey.ts",baseline:"608679a6095ef5617921e504bf208858df6a7c49",committed:"890e4a512bc30ee63f50d27a6686e0c713869df3bfb42ff6bad6fc4a9aff1ae7",candidate:"f79ed0d780918fa0ac45b75439cd7d26d7e8b5190dd6e218492b9214c43d065a",facts_sha256:"4dc68fc764a67672c972fa02bb2c5878f7eb9c99495ff62816e5b40a5e720bc7"},
].map(Object.freeze));
function workspaceSwitchLegacyView(map,result){
  const remaining=assertContrastDiagnosticDrift(map,result,pendingWorkspaceSwitchDefinitions);
  const prior=JSON.parse(historicalSource("f62aa7176eccfb065eab27ea56edf6bbb1bc0dbc","docs/operations/comprehensive-ui-automation-current-census.json"));
  const previousRows=new Map();
  for(const definition of pendingWorkspaceSwitchDefinitions){
    const rows=prior.sources.filter(row=>row.path===definition.path);assert.equal(rows.length,1);
    assert.equal(rows[0].facts.sha256,definition.committed);assert.equal(rows[0].committed_sha256,definition.committed);
    previousRows.set(definition.path,rows[0]);
  }
  return{map:{...map,sources:map.sources.map(row=>previousRows.has(row.path)?structuredClone(previousRows.get(row.path)):row)},result:remaining};
}
function assertCurrentSourceDrift(map, result, includeStartupReport = false) {
  if(includeStartupReport)result=assertContrastDiagnosticDrift(map,result,pendingModelStartupReportDefinitions);
  if(map.source_baseline===pendingResponsiveJourneyDefinitions[0].baseline) {
    // Preserve the genuine preceding snapshot, not a future wildcard binding.
    // The current census also has to match actual source facts in validateCensus.
    const prior=pendingResponsiveJourneyDefinitions[1],row=map.sources.find(row=>row.path===prior.path);
    const disclosed=pendingDisclosureJourneyDefinitions[1];
    const definitions=row?.facts.sha256===prior.candidate?pendingResponsiveJourneyDefinitions:
      row?.facts.sha256===disclosed.candidate?pendingDisclosureJourneyDefinitions:pendingStartupJourneyDefinitions;
    result=assertContrastDiagnosticDrift(map,result,definitions);
  }
  if(map.source_baseline===shellContrastBaseline)result=assertContrastDiagnosticDrift(map,result,pendingShellContrastDefinitions);
  if(map.source_baseline===pendingContrastRegionDefinitions[0].baseline)result=assertContrastDiagnosticDrift(map,result,pendingContrastRegionDefinitions);
  if(map.source_baseline===pendingContrastV2Diagnostics[0].baseline)result=assertContrastDiagnosticDrift(map,result,pendingContrastV2Diagnostics);
  if(map.source_baseline===pendingContrastDiagnostics[0].baseline)result=assertContrastDiagnosticDrift(map,result);
  if(map.source_baseline===pendingSettingsEmptyDefinitions[0].baseline&&map.sources.some(row=>row.path===pendingSettingsEmptyDefinitions[1].path))result=assertSettingsEmptySourceDrift(map,result);
  const navigationPaths=new Set();
  if(map.source_baseline===pendingSettingsNavigationDefinitions[0].baseline&&map.sources.some(row=>row.path===pendingSettingsNavigationDefinitions[2].path)){
    result=assertSettingsNavigationSourceDrift(map,result);
    for(const pending of pendingSettingsNavigationDefinitions){
      const row=map.sources.find(row=>row.path===pending.path);
      if(row.facts.sha256!==row.committed_sha256)navigationPaths.add(pending.path);
    }
  }
  if(map.sources.some(row=>row.path===pendingTrainingFormDefinition.source)) result=assertTrainingFormSourceDrift(map,result);
  const expected = [];
  const trainingDefinitions=trainingDefinitionsFor(map).filter(row=>!navigationPaths.has(row.path));
  for (const pending of trainingDefinitions) {
    const rows = map.sources.filter(row => row.path === pending.path); assert.equal(rows.length, 1); const source = rows[0];
    assert.match(map.source_baseline, /^[a-f0-9]{40}$/);
    if(source.facts.sha256 !== source.committed_sha256)assert.equal(map.source_baseline,pending.baseline);
    const committed = historicalSource(map.source_baseline,pending.path);
    assert.equal(source.committed_sha256, sha(committed), "Training commit pins must reference real Git blobs.");
    if (source.facts.sha256 !== source.committed_sha256) {
      assert.equal(source.committed_sha256, pending.committed);
      assert.equal(source.facts.sha256, pending.candidate);
      assert.equal(sha(JSON.stringify(source.facts)), pending.facts_sha256, "Future training facts cannot inherit this pending binding.");
      expected.push({kind: "unreviewed-source-drift", source: pending.path});
    }
  }
  const paths = new Set(trainingDefinitions.map(pending => pending.path));
  const trainingGaps = result.gaps.filter(g => g.kind === "unreviewed-source-drift" && paths.has(g.source));
  const ordered = rows => [...rows].sort((a,b) => a.source.localeCompare(b.source));
  assert.deepEqual(ordered(trainingGaps), ordered(expected), "Missing, duplicate or extra training drift is refused.");
  assertCurrentReviewSiteDrift(map, {...result, gaps: result.gaps.filter(g => !(g.kind === "unreviewed-source-drift" && paths.has(g.source)))});
}

function fixture() {
  const scenarios = Array.from({length:39}, (_, index) => ({id:`family-${index}`, hosts:["desktop"], required_behavior:["Preserve exact state."], actual_host_qualification:"pending"}));
  const ledger = {schema_version:"comprehensive-ui-coverage-v1", full_testing_status:"deferred-by-user", scenarios, surface_census:{routes:["home"]}};
  const discovery = {scenarioMatrix:scenarios.map(s => ({id:s.id, hosts:s.hosts, expectedBehavior:s.required_behavior}))};
  const inventoryCode=new Map(), surfaces={routes:["home"]};
  const inventories=REQUIRED_CENSUS_INVENTORIES.map(([source,declaration,property,surface_key],index)=>{
    const values=["first","second"];
    const statement=declaration==="__labels__"?`const labels${index}=[{label:"first"},{label:"second"}];`
      :declaration.endsWith("PageKey")?`type ${declaration}="first"|"second";`
      :property?`const ${declaration}=[{${property}:"first"},{${property}:"second"}];`:`const ${declaration}=["first","second"] as const;`;
    inventoryCode.set(source,(inventoryCode.get(source)??"")+statement+"\n");
    if(surface_key)surfaces[surface_key]=values;
    return {source,declaration,property,values,sha256:"",surface_key};
  });
  for(const item of inventories)item.sha256=sha(inventoryCode.get(item.source));
  ledger.surface_census=surfaces;
  const map = {schema_version:"current-ui-definition-census-v1", roadmap_id:"comprehensive-ui-automation", scope:"definitions-only-no-execution-pass", source_baseline:"a".repeat(40), full_testing_status:"deferred-by-user",
    sources:[file,host].map(p => ({path:p, facts:sourceFacts(p,code), committed_sha256:sha(code)})),
    scenarios:scenarios.map(s => ({id:s.id,hosts:s.hosts,behavior_links:[{behavior_index:0,assertion_sources:[file]}],host_definitions:[host],execution_status:"not-asserted-by-census",pending_feature_checks:[]})),
    surfaces:ledger.surface_census,host_spec_files:[host],inventories};
  const bytes = new Map([[file,code],[host,code],...[...inventoryCode].map(([name,value])=>[name,Buffer.from(value)])]);
  return {map,ledger,discovery,bytes,hostSpecPaths:[host]};
}
const run = f => validateCensus({mapText:JSON.stringify(f.map),ledgerText:JSON.stringify(f.ledger),discoveryText:JSON.stringify(f.discovery),readSource:p=>{assert(f.bytes.has(p));return f.bytes.get(p);},hostSpecPaths:f.hostSpecPaths});
test("maps all approved behaviors and extracts exact assertions without executing inspected code", () => {
  const f=fixture(), result=run(f); assert.equal(result.scenario_count,39); assert.equal(result.behavior_links,39);
  assert.equal(result.executed_tests,0); assert.equal(result.actual_host_pass,false); assert.equal(result.parent_qualification_granted,false);
  assert.equal(result.gaps.length,39); assert(result.gaps.every(g=>g.kind==="actual-host-not-run-by-census"));
  const facts=sourceFacts(file,Buffer.from('throw Error("must not execute"); test.each([1])("row",()=>{assert.equal(1,1)}); test.skip("later",()=>{});'));
  assert.equal(facts.assertionCount,1); assert.equal(facts.cases.length,2); assert.equal(facts.modifiers[0].kind,"skip");
});
test("retains changed source, unimplemented host definitions and unrun outcomes as gaps", () => {
  const f=fixture();f.map.sources[0].committed_sha256="0".repeat(64);f.map.scenarios[0].host_definitions=[];
  const result=run(f); assert(result.gaps.some(g=>g.kind==="unreviewed-source-drift"));assert(result.gaps.some(g=>g.kind==="host-definition-not-mapped"));
  assert.equal(result.executed_tests,0);
});
for (const mutate of [f=>f.map.scenarios.pop(),f=>f.map.scenarios[1].id=f.map.scenarios[0].id,
  f=>f.ledger.scenarios[0].required_behavior=["Changed scope."],f=>f.map.scenarios[0].hosts=["foreign-host"],
  f=>f.map.scenarios[0].behavior_links=[],f=>f.map.scenarios[0].behavior_links[0].assertion_sources=["dev-tools/missing.ts"],
  f=>f.map.sources.push(f.map.sources[0]),f=>f.map.sources[0].facts.assertionCount++,f=>f.map.scenarios[0].execution_status="passed",
  f=>f.map.scenarios[0].host_definitions=[file],
  f=>f.ledger.scenarios[0].actual_host_qualification="passed",f=>f.map.full_testing_status="passed",f=>f.map.unknown=true,
  f=>f.map.inventories[0].values=["stale"],f=>f.map.inventories[0].property=false,f=>f.map.inventories.pop(),
  f=>f.map.inventories[1]=f.map.inventories[0],f=>f.hostSpecPaths.push("dev-tools/scripts/qualification/visual-composer/e2e/new.e2e.spec.ts")]) {
  test(`refuses invalid mapping ${String(mutate).split("=>")[1].slice(0,70)}`,()=>{
    const f=fixture();mutate(f);assert.throws(()=>run(f),/invalid|incomplete/);
  });
}
test("refuses malformed documents, unsafe paths and bounded source overflow",()=>{
  for(const p of ["../outside.ts","docs/../outside.ts","C:/private.ts","/private.ts","docs\\private.ts","docs//file.ts"]) assert.throws(()=>censusPath(p));
  assert.throws(()=>sourceFacts(file,Buffer.alloc(CENSUS_LIMITS.sourceBytes+1)));assert.throws(()=>sourceFacts(file,Buffer.from([255])));
  assert.throws(()=>sourceFacts(file,Buffer.from("const = ;")));assert.throws(()=>literalInventory(inventoryFile,inventory,"missing",null));
  const f=fixture();assert.throws(()=>validateCensus({mapText:"{",ledgerText:JSON.stringify(f.ledger),discoveryText:JSON.stringify(f.discovery)}));
  assert.throws(()=>validateCensus({mapText:" ".repeat(CENSUS_LIMITS.documentBytes+1)}));
  f.map.sources=Array(CENSUS_LIMITS.files+1).fill(f.map.sources[0]);assert.throws(()=>run(f));
});
test("requires assertions, not merely a named test file, and checks surface bindings",()=>{
  const f=fixture(),empty=Buffer.from('test("empty",()=>{});');
  f.bytes.set(file,empty);f.map.sources[0].facts=sourceFacts(file,empty);f.map.sources[0].committed_sha256=sha(empty);
  assert.throws(()=>run(f));const surface=fixture();surface.map.inventories[0].surface_key="routes";assert.throws(()=>run(surface));
});
test("caches and budgets every distinct test and inventory source together",()=>{
  const f=fixture(), calls=new Map();
  const result=validateCensus({mapText:JSON.stringify(f.map),ledgerText:JSON.stringify(f.ledger),discoveryText:JSON.stringify(f.discovery),hostSpecPaths:f.hostSpecPaths,
    readSource:p=>{calls.set(p,(calls.get(p)??0)+1);return f.bytes.get(p);}});
  assert.equal(result.unique_source_inputs,f.bytes.size);assert([...calls.values()].every(count=>count===1));
  for(let index=0;index<CENSUS_LIMITS.files-2;index++) {
    const name=`dev-tools/extra-${index}.ts`;f.map.sources.push({path:name,facts:sourceFacts(name,code),committed_sha256:sha(code)});f.bytes.set(name,code);
  }
  assert.throws(()=>run(f));
});
test("keeps free task text out of the safe summary",()=>{
  const f=fixture();f.map.scenarios[0].pending_feature_checks=["synthetic-private-token"];
  const result=run(f);assert.equal(JSON.stringify(result).includes("synthetic-private-token"),false);
  assert(result.gaps.some(g=>g.kind==="pending-feature-check"&&g.check_index===0&&g.scenario==="family-0"));
});
test("reads only bounded regular owned fixture bytes and refuses links, traversal and oversized files",()=>{
  const parent=fs.realpathSync(tmpdir());assert(fs.statSync(parent).isDirectory());const root=fs.mkdtempSync(path.join(parent,"ui-census-"));
  assert(root.startsWith(parent+path.sep));fs.mkdirSync(path.join(root,"docs"));const target=path.join(root,"docs/test.ts"),link=path.join(root,"docs/link.ts"),large=path.join(root,"docs/large.ts");
  try {
    fs.writeFileSync(target,code,{flag:"wx"});const read=repositoryReader(root);assert.deepEqual(read("docs/test.ts"),code);
    assert.throws(()=>read("docs/../test.ts"));fs.linkSync(target,link);assert.throws(()=>read("docs/test.ts"));assert.throws(()=>read("docs/link.ts"));fs.unlinkSync(link);
    fs.writeFileSync(large,Buffer.alloc(CENSUS_LIMITS.sourceBytes+1),{flag:"wx"});assert.throws(()=>read("docs/large.ts"));
  } finally {
    for(const p of [link,large,target])if(fs.existsSync(p))fs.unlinkSync(p);fs.rmdirSync(path.join(root,"docs"));fs.rmdirSync(root);
  }
});
test("checks the current repository map against original scope and actual source declarations",()=>{
  const read=repositoryReader(process.cwd()), folder="dev-tools/scripts/qualification/visual-composer/e2e/";
  const hostSpecPaths=fs.readdirSync(folder).filter(n=>n.endsWith(".e2e.spec.ts")).map(n=>folder+n).sort();
  const result=validateCensus({mapText:read("docs/operations/comprehensive-ui-automation-current-census.json").toString(),
    ledgerText:read("docs/operations/comprehensive-ui-automation-coverage.json").toString(),
    discoveryText:read("docs/operations/comprehensive-ui-automation-discovery.json").toString(),readSource:read,hostSpecPaths});
  assert.equal(result.scenario_count,39);assert.equal(result.behavior_links,131);assert.equal(result.current_host_spec_files,32);
  assert.equal(result.inventory_groups,16);assert.equal(result.executed_tests,0);assert.equal(result.parent_qualification_granted,false);
  const map=JSON.parse(read("docs/operations/comprehensive-ui-automation-current-census.json"));
  const committedHistory=committedCensusLegacyView(map,result);
  const workspaceLegacy=workspaceSwitchLegacyView(committedHistory.map,committedHistory.result);
  const legacy=privateProviderLegacyView(workspaceLegacy.map,workspaceLegacy.result);
  assertSettingsNavigationSourceDrift(legacy.map,legacy.result);
  const base="dev-tools/scripts/qualification/visual-composer/";
  const linkedFunctional={
    "settings-public-values":["e2e/settings-host-journey.ts","settings-host-oracles.ts"],
    "settings-secrets-and-model-defaults":["e2e/settings-host-journey.ts","settings-host-oracles.ts"],
    "provider-source-acquisition":["e2e/provider-source-host-journey.ts","functional-provider-oracles.ts"],
    "artifact-backing-publish-delete":["e2e/artifact-lifecycle-host-journey.ts","functional-artifact-oracles.ts","e2e/private-publication-host-journey.ts","functional-provider-oracles.ts"],
    "models-discover-and-reference":["e2e/model-reference-host-journey.ts","functional-host-oracles.ts"]
  };
  for(const [id,names] of Object.entries(linkedFunctional)){
    const row=map.scenarios.find(s=>s.id===id);
    assert.deepEqual(row.host_definitions,[base+"e2e/packaged-desktop-operational-ui.e2e.spec.ts",base+"e2e/thin-client-operational-ui.e2e.spec.ts"]);
    assert.deepEqual(row.pending_feature_checks,[]);
    for(const name of names){
      const source=map.sources.find(s=>s.path===base+name);
      assert(source,"Each body and oracle must be inventoried.");
      if(name.startsWith("e2e/"))assert(source.facts.assertionCount>0,"Each journey body contains meaningful assertions.");
      else assert(source.facts.functions.length>0,"Inert oracle guards are separate functions, not executed test assertions.");
      if(![...pendingSettingsNavigationDefinitions,...pendingSettingsEmptyDefinitions,...pendingWorkspaceSwitchDefinitions].some(p=>p.path===source.path&&source.facts.sha256!==source.committed_sha256))
      assert.equal(source.facts.sha256,source.committed_sha256,"Each new definition must already be committed after review.");
      assert(row.behavior_links.every(link=>link.assertion_sources.includes(source.path)));
    }
  }
  assert(!result.gaps.some(g=>g.kind==="host-definition-not-mapped"));
  assertCompleteCurrentSourceDrift(map,result);
  assert.equal(result.gaps.filter(g=>g.kind==="actual-host-not-run-by-census").length,39);
  assert.equal(result.actual_host_pass,false);
  assert.deepEqual(map.scenarios.find(s=>s.id==="security-status-and-auth-boundaries").host_definitions,["dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts"]);
  assert(!map.scenarios.find(s=>s.id==="runtime-status-and-explicit-controls").host_definitions.some(n=>n.includes("thin-client")));
  assert(map.scenarios.find(s=>s.id==="dashboard-counts").host_definitions.some(n=>n.endsWith("packaged-desktop-reference-performance.e2e.spec.ts")));
  assert(map.scenarios.find(s=>s.id==="notifications-all-task-families").host_definitions.some(n=>n.endsWith("packaged-desktop-owned-tasks.e2e.spec.ts")));

  assert.deepEqual(map.scenarios.find(s=>s.id==="contributor-review-site").host_definitions,["dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts"]);
  const website="dev-tools/scripts/qualification/visual-composer/e2e/thin-client-ingestion.e2e.spec.ts";
  assert.deepEqual(map.scenarios.find(s=>s.id==="website-acquisition-refresh").host_definitions,[website]);
  const websiteFacts=map.sources.find(s=>s.path===website).facts;
  assert(websiteFacts.cases.some(c=>c.name==="browser acquires an authorized website page and reopens isolated raw and readable artifacts"));
  assert(websiteFacts.modifiers.length>0,"Missing authorized fixture remains a declared conditional execution gap.");
  const training="dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-operational-ui.e2e.spec.ts";
  assert.deepEqual(map.scenarios.find(s=>s.id==="desktop-model-training").host_definitions,[training]);
  assert(map.sources.find(s=>s.path===training).facts.cases.some(c=>c.name==="packaged desktop trains one local adapter, reviews privately, saves and reopens it"));
  assert(map.sources.find(s=>s.path===training).facts.modifiers.length>0,"Unready real inputs keep training execution pending.");
  for(const name of [training,website,"dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts"]) {
    const source=map.sources.find(s=>s.path===name);
    if(source.facts.sha256!==source.committed_sha256){
      if(name===website) {
        // The later ingestion journey changed this definition. Bind it to the
        // exact archived source and retain the still-open inventory gap below.
        assert.deepEqual(sourceFacts(name,historicalSource(currentPublishedFormCensus.commit,name)),source.facts);
      }
      assert(result.gaps.some(g=>g.kind==="unreviewed-source-drift"&&g.source===name),"Changed OP definitions retain their real older Git binding and an explicit drift gap until reviewed source is committed.");
    }
    if(name!==website){
      const text=read(name).toString();
      assert(text.includes('["public-values","secret-defaults"]'));
      assert(text.includes("qualifySettingsHostJourney"));
      assert(text.includes("VISUAL_COMPOSER_SETTINGS_READY"));
    }
  }
  for(const [id,stem] of [["contributor-review-site","review-site"],["website-acquisition-refresh","website-acquisition"],["desktop-model-training","model-training"]]) {
    const source=`dev-tools/scripts/qualification/tests/${stem}-oracles.unit.test.ts`;
    const row=map.sources.find(s=>s.path===source);assert(row&&row.facts.assertionCount>0);
    if (row.facts.sha256 !== row.committed_sha256) {
      // Composed SHA/full-facts/Git guards admit only their exact prospective
      // definitions; a pathname alone never exempts an oracle from drift.
      assert([...trainingDefinitionsFor(map),...pendingReviewBrowserDefinitions].some(p=>p.path===source&&p.candidate===row.facts.sha256&&p.facts_sha256===sha(JSON.stringify(row.facts))));
      assert(result.gaps.some(g=>g.kind==="unreviewed-source-drift"&&g.source===source));
    } else assert.equal(row.facts.sha256,row.committed_sha256);
    assert(map.scenarios.find(s=>s.id===id).behavior_links.every(link=>link.assertion_sources.includes(source)));
  }
  for(const id of ["image-generation-create-and-register","image-generation-recovery"]){
    const row=map.scenarios.find(s=>s.id===id);
    assert.deepEqual(row.host_definitions,["dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-operational-ui.e2e.spec.ts","dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts"]);
    assert(row.behavior_links.every(link=>link.assertion_sources.includes("dev-tools/scripts/qualification/visual-composer/e2e/image-generation-host-journey.ts")));
  }
  const imageJourney=map.sources.find(s=>s.path==="dev-tools/scripts/qualification/visual-composer/e2e/image-generation-host-journey.ts");
  assert(imageJourney.facts.assertionCount>10);assert.equal(imageJourney.facts.sha256,imageJourney.committed_sha256,"Image definitions bind only after their real reviewed source commit.");
  const imageDraft=map.sources.find(s=>s.path==="apps/desktop/src/renderer/features/image-generation/tests/use-image-generation-feature.unit.test.tsx");
  assert(imageDraft.facts.cases.some(c=>c.name==="retains the same owned image form after a page remount without starting a task"));
  assert(imageDraft.facts.cases.some(c=>c.name==="isolates workspace and client drafts and refuses retired form callbacks"));
  for(const name of [imageDraft.path,"apps/desktop/src/renderer/features/image-generation/tests/image-generation-ownership.unit.test.tsx"]) {
    const row=map.sources.find(s=>s.path===name);assert.equal(row.facts.sha256,row.committed_sha256,"Reviewed image assertions bind to their actual commit.");
  }
  const managedStart="modules/hosts/shared/resolveComfyUiAutoInstall.unit.test.ts";
  const managedFacts=map.sources.find(s=>s.path===managedStart);
  assert(managedFacts.facts.cases.some(c=>c.name==="no-install admission reads only the exact managed target, root and official source"));
  assert(managedFacts.facts.cases.some(c=>c.name==="missing, unconfirmed or mismatched managed metadata denies without starting or repairing"));
  assert.equal(managedFacts.facts.sha256,managedFacts.committed_sha256);
  assert(map.scenarios.find(s=>s.id==="image-generation-recovery").behavior_links[2].assertion_sources.includes(managedStart));
  const providerDesktop=map.sources.find(s=>s.path===training),providerThin=map.sources.find(s=>s.path==="dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts");
  assert(providerDesktop.facts.cases.some(c=>c.name==="packaged desktop provider source registers an exact reference and optional localized bytes"));
  assert(providerDesktop.facts.cases.some(c=>c.name==="packaged desktop private artifact publication records local branch and remote commit"));
  assert(providerThin.facts.cases.some(c=>c.name==="thin client provider source registers an exact reference and optional localized bytes"));
  const cleanup=map.sources.find(s=>s.path==="dev-tools/scripts/qualification/tests/desktop-owned-cleanup-failures.unit.test.ts");
  assert(cleanup.facts.cases.some(c=>c.name==="admits a live real-worker shape through its launcher before closing the app"));
  assert(cleanup.facts.cases.some(c=>c.name==="does not downgrade refused live native admission to a PID-absence pass"));
  if(cleanup.facts.sha256!==cleanup.committed_sha256)assert(result.gaps.some(g=>g.kind==="unreviewed-source-drift"&&g.source===cleanup.path),"The extended cleanup assertions retain their actual older checkpoint and explicit source drift until reviewed and committed.");
  assert(cleanup.facts.cases.some(c=>c.name==="refuses an unlisted slot before observing or closing an app"));
  assert(cleanup.facts.cases.some(c=>c.name==="refuses a foreign journey stage before app effects"));
  for(const id of ["settings-public-values","settings-secrets-and-model-defaults"]){
    const row=map.scenarios.find(s=>s.id===id);
    for(const name of ["apps/thin-client/src/pages/tests/settings-recovery.ui.test.tsx","apps/thin-client/src/features/settings/tests/api-application-settings-client.unit.test.ts","modules/ui/shared/settings/tests/SettingField.unit.test.tsx"])assert(row.behavior_links.every(link=>link.assertion_sources.includes(name)));
  }
  for(const name of [training,"dev-tools/scripts/qualification/visual-composer/e2e/thin-client-operational-ui.e2e.spec.ts"]){
    const text=read(name).toString();
    assert(text.includes("model reference searches, saves and survives reload and workspace changes"));
    assert(text.includes("qualifyModelReferenceHostJourney"));
    assert(text.includes("VISUAL_COMPOSER_FUNCTIONAL_READY"));
    assert(text.includes("qualifyArtifactLifecycleHostJourney"));
    assert(text.includes("VISUAL_COMPOSER_FUNCTIONAL_LOCAL_ARTIFACT"));
    assert(text.includes("qualifyProviderSourceHostJourney"));
    assert(text.includes("VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_SOURCE"));
  }
});

test("pending review-source binding rejects forged commit pins, future facts and missing or extra drift",()=>{
  const pending = pendingReviewSiteDefinition;
  const map = { source_baseline: pending.baseline, sources: [{ path: pending.source,
    facts: sourceFacts(pending.source, historicalSource("bb895bef9cd95c2662cbe185c03ea69bda6d938d", pending.source)), committed_sha256: pending.committed }] };
  const result = { gaps: [{ kind: "unreviewed-source-drift", source: pending.source }] };
  assert.doesNotThrow(()=>assertCurrentReviewSiteDrift(map,result));
  for (const mutate of [
    (m,r)=>{m.sources[0].committed_sha256=pending.candidate;},
    (m,r)=>{m.sources[0].facts.sha256="0".repeat(64);},
    (m,r)=>{m.sources[0].facts.assertionCount++;},
    (m,r)=>{r.gaps=[];},
    (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/foreign.test.mjs"});},
    (m,r)=>{m.source_baseline="44232975e63b9d90144f4555d42a93ec5676978e";},
  ]) {
    const copy=structuredClone(map), observation=structuredClone(result);mutate(copy,observation);
    assert.throws(()=>assertCurrentReviewSiteDrift(copy,observation));
  }
});



test("pending tiny-training bindings reject forged, future, missing and unrelated source drift",()=>{
  const current = JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-current-census.json"));
  const paths = [...pendingTrainingDefinitions.map(p=>p.path), pendingReviewSiteDefinition.source];
  const map = {source_baseline: pendingTrainingDefinitions[0].baseline, sources: current.sources.filter(row=>paths.includes(row.path)).map(row=>{
    const pending=pendingTrainingDefinitions.find(p=>p.path===row.path);
    if(!pending){
      const original=historicalSource(pendingTrainingDefinitions[0].baseline,row.path);
      return {...row,facts:sourceFacts(row.path,original),committed_sha256:sha(original)};
    }
    const original=historicalSource("b3cfef49ea0f3a6cd016f502400b66e0835b339d",row.path);
    const facts=sourceFacts(row.path,original);assert.equal(facts.sha256,pending.candidate);assert.equal(sha(JSON.stringify(facts)),pending.facts_sha256);
    return {...row,facts,committed_sha256:pending.committed};
  })};
  // This fixture declares exactly the inspected current facts. It does not
  // execute the training journey, change its status or grant a parent pass.
  const result = {gaps: map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.doesNotThrow(()=>assertCurrentSourceDrift(map,result));
  const target = m=>m.sources.find(row=>row.path===pendingTrainingDefinitions[0].path);
  const mutations = [
    (m,r)=>{target(m).committed_sha256=pendingTrainingDefinitions[0].candidate;},
    (m,r)=>{target(m).facts.sha256="0".repeat(64);},
    (m,r)=>{target(m).facts.assertionCount++;},
    (m,r)=>{r.gaps=r.gaps.filter(g=>g.source!==pendingTrainingDefinitions[0].path);r.gaps.push({kind:"unreviewed-source-drift",source:pendingTrainingDefinitions[0].path});r.gaps.push({kind:"unreviewed-source-drift",source:pendingTrainingDefinitions[0].path});},
    (m,r)=>{r.gaps=r.gaps.filter(g=>g.source!==pendingTrainingDefinitions[0].path);},
    (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/foreign.test.mjs"});},
    (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pendingTrainingDefinitions[0].path);},
    (m,r)=>{m.source_baseline="6e8ef9d191fdd73f2d79c3b3744f17cf80f3757e";},
  ];
  for(const mutate of mutations){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertCurrentSourceDrift(m,r));}
});

function assertReintroducedTrainingOracle(map,archive) {
  const source="dev-tools/scripts/qualification/visual-composer/model-training-oracles.ts";
  const pending=trainingDefinitionsFor(map).find(row=>row.path===source);assert(pending);
  const old=archive.sources.filter(entry=>entry.row.path===source);assert.equal(old.length,1);
  const current=map.sources.filter(row=>row.path===source);assert.equal(current.length,1);
  const row=current[0],historical=old[0].row;
  assert.equal(row.facts.sha256,pending.candidate);
  assert.equal(sha(JSON.stringify(row.facts)),pending.facts_sha256);
  assert.notEqual(row.facts.sha256,historical.facts.sha256);
  assert.notEqual(row.committed_sha256,historical.committed_sha256);
  assert.match(map.source_baseline,/^[a-f0-9]{40}$/);
  const committed=historicalSource(map.source_baseline,source);
  assert.equal(row.committed_sha256,sha(committed));
  if(row.facts.sha256!==row.committed_sha256){
    assert.equal(map.source_baseline,pending.baseline);
    assert.equal(row.committed_sha256,pending.committed);
  }
  const links=[];
  for(const scenario of map.scenarios){
    assert(!scenario.host_definitions.includes(source));
    for(const link of scenario.behavior_links)if(link.assertion_sources.includes(source)){
      assert.equal(scenario.id,"desktop-model-training");
      assert.equal(link.assertion_sources.filter(name=>name===source).length,1);
      assert.equal(scenario.execution_status,"not-asserted-by-census");
      links.push(link.behavior_index);
    }
  }
  assert.deepEqual(links,[0,1,2,3]);
  assert.equal(map.full_testing_status,"deferred-by-user");
  assert(!map.host_spec_files.includes(source));assert(!map.inventories.some(row=>row.source===source));
  const referenced=new Set([...map.scenarios.flatMap(s=>[...s.host_definitions,...s.behavior_links.flatMap(l=>l.assertion_sources)]),...map.host_spec_files,...map.inventories.map(i=>i.source)]);
  for(const entry of archive.sources)if(entry.row.path!==source){
    assert(!referenced.has(entry.row.path));assert(!map.sources.some(row=>row.path===entry.row.path));
  }
}

function assertCurrentReintroducedSources(map,archive){
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  // The exact new browser definition has its own current proof. Only its
  // authenticated legacy view reaches the older single-training-source guard.
  // The archive itself and every unrelated archived-source refusal stay intact.
  const historical=committedCensusLegacyView(map,result);
  const legacy=reviewBrowserLegacyView(historical.map,historical.result);
  assertReintroducedTrainingOracle(legacy.map,archive);
}

test("preserves exact historical versions without inheriting their current coverage or qualification",()=>{
  const read=repositoryReader(process.cwd()),map=JSON.parse(read("docs/operations/comprehensive-ui-automation-current-census.json"));
  const bytes=read("docs/operations/comprehensive-ui-automation-census-source-history.json");
  assert(bytes.byteLength<=64*1024);const archive=JSON.parse(bytes);
  assert.equal(archive.schema_version,"historical-ui-census-sources-v1");
  assert.equal(archive.scope,"historical-only-not-current-coverage-or-execution");
  assert.equal(archive.roadmap_id,map.roadmap_id);assert.match(archive.prior_commit,/^[a-f0-9]{40}$/);
  assert.equal(archive.prior_census_path,"docs/operations/comprehensive-ui-automation-current-census.json");
  assert.match(archive.prior_census_sha256,/^[a-f0-9]{64}$/);
  assert.equal(archive.prior_pointer.pending_agent_work.length,5);
  assert.equal(archive.sources.length,8);assert.equal(new Set(archive.sources.map(v=>v.row.path)).size,8);
  for(const entry of archive.sources){
    censusPath(entry.row.path);
    assert.equal(sha(JSON.stringify(entry.row)),entry.prior_row_sha256);assert.match(entry.row.committed_sha256,/^[a-f0-9]{64}$/);
    assert.match(entry.row.facts.sha256,/^[a-f0-9]{64}$/);assert(entry.reason.length>0);
  }
  // Newly used, changed oracles have their own exact current source proofs.
  // The eight old rows and their digests remain unchanged historical versions.
  assertCurrentReintroducedSources(map,archive);
  const ledger=JSON.parse(read("docs/operations/comprehensive-ui-automation-coverage.json"));
  assert.equal(ledger.current_definition_census.historical_source_archive,"docs/operations/comprehensive-ui-automation-census-source-history.json");
  assert.equal(ledger.full_testing_status,"deferred-by-user");assert(ledger.scenarios.every(s=>s.actual_host_qualification==="pending"));
  assert.equal(CENSUS_LIMITS.files,195);assert.equal(CENSUS_LIMITS.documentBytes,512*1024);assert.equal(CENSUS_LIMITS.totalBytes,32*1024*1024);
});

test("reintroduced oracle coverage refuses old, missing, duplicate, future or unrelated versions",()=>{
  const map=JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-current-census.json"));
  const archive=JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-census-source-history.json"));
  const name="dev-tools/scripts/qualification/visual-composer/model-training-oracles.ts";
  const row=m=>m.sources.find(value=>value.path===name);
  assert.doesNotThrow(()=>assertCurrentReintroducedSources(map,archive));
  for(const mutate of [
    m=>{m.sources[m.sources.findIndex(value=>value.path===name)]=structuredClone(archive.sources.find(value=>value.row.path===name).row);},
    m=>{m.sources=m.sources.filter(value=>value.path!==name);},
    m=>{m.sources.push(structuredClone(row(m)));},
    m=>{row(m).facts.sha256="0".repeat(64);},
    m=>{row(m).facts.assertionCount++;},
    m=>{row(m).committed_sha256="0".repeat(64);},
    m=>{m.source_baseline="HEAD~1";},
    m=>{m.scenarios.find(value=>value.id==="desktop-model-training").behavior_links[0].assertion_sources=m.scenarios.find(value=>value.id==="desktop-model-training").behavior_links[0].assertion_sources.filter(value=>value!==name);},
    m=>{m.scenarios.find(value=>value.id!=="desktop-model-training").behavior_links[0].assertion_sources.push(name);},
    m=>{m.sources.push(structuredClone(archive.sources.find(value=>value.row.path!==name).row));},
    m=>{m.scenarios.find(value=>value.id==="desktop-model-training").execution_status="passed";},
  ]){const current=structuredClone(map);mutate(current);assert.throws(()=>assertCurrentReintroducedSources(current,archive));}
});

test("reintroduced review guard cannot replay archived facts or bypass the earlier archive owner",()=>{
  const map=JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-current-census.json"));
  const archive=JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-census-source-history.json"));
  const name="dev-tools/scripts/qualification/visual-composer/review-site-oracles.ts",old=archive.sources.filter(entry=>entry.row.path===name);
  assert.equal(old.length,1);assertCurrentReintroducedSources(map,archive);
  assert.throws(()=>assertReintroducedTrainingOracle(map,archive),"Historical authority cannot admit the newly used guard.");
  const replay=structuredClone(map);replay.sources[replay.sources.findIndex(row=>row.path===name)]=structuredClone(old[0].row);
  assert.throws(()=>assertCurrentReintroducedSources(replay,archive));
  const prior=JSON.parse(historicalSource("42179ebae1106046efaa035d8c3682b974237dfb","docs/operations/comprehensive-ui-automation-current-census.json"));
  assertReintroducedTrainingOracle(prior,archive);
});

test("prospective training form binding rejects forged future missing and extra drift",()=>{
  const current=JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-current-census.json"));
  const map=JSON.parse(historicalSource("9585fe7f30a89b616fc8c3121da3080d02ebf6d5","docs/operations/comprehensive-ui-automation-current-census.json")),pending=pendingTrainingFormDefinition;
  const target=m=>m.sources.find(row=>row.path===pending.source);
  target(map).committed_sha256=pending.committed;
  map.source_baseline=pending.baseline;
  for(const changed of new Map([...pendingTrainingStartDefinitions,...pendingTrainingTaskDefinitions].map(row=>[row.path,row])).values()){
    const row=map.sources.find(value=>value.path===changed.path);assert(row);
    const original=historicalSource(pending.baseline,row.path);
    row.facts=sourceFacts(row.path,original);row.committed_sha256=sha(original);
  }
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.doesNotThrow(()=>assertCurrentSourceDrift(map,result));
  for(const mutate of [
    (m,r)=>{target(m).committed_sha256=pending.candidate;},
    (m,r)=>{target(m).facts.sha256="0".repeat(64);},
    (m,r)=>{target(m).facts.assertionCount++;},
    (m,r)=>{m.source_baseline="8a9e94bb52e36e63934b24e6f081f26a0ca8985c";},
    (m,r)=>{r.gaps=r.gaps.filter(g=>g.source!==pending.source);},
    (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.source});},
    (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/foreign-form.test.mjs"});},
    (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.source);},
  ]) {
    const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertCurrentSourceDrift(m,r));
  }
  const missing=structuredClone(map);missing.sources=missing.sources.filter(row=>row.path!==pending.source);
  assert.throws(()=>assertTrainingFormSourceDrift(missing,{gaps:[]}));
});

test("pending training-start definitions reject forged missing duplicate and unrelated evidence",()=>{
  const map=JSON.parse(historicalSource("9585fe7f30a89b616fc8c3121da3080d02ebf6d5","docs/operations/comprehensive-ui-automation-current-census.json"));
  // Rebuild the preceding candidate from its real Git version, not current I facts.
  for(const changed of pendingTrainingTaskDefinitions){
    const row=map.sources.find(value=>value.path===changed.path);assert(row);
    const original=historicalSource(changed.baseline,row.path);
    row.facts=sourceFacts(row.path,original);row.committed_sha256=sha(original);
  }
  map.source_baseline=pendingTrainingStartDefinitions[0].baseline;
  for(const pending of pendingTrainingStartDefinitions)map.sources.find(row=>row.path===pending.path).committed_sha256=pending.committed;
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.doesNotThrow(()=>assertCurrentSourceDrift(map,result));
  for(const pending of pendingTrainingStartDefinitions){
    const target=m=>m.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},
      (m,r)=>{target(m).facts.sha256="0".repeat(64);},
      (m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{r.gaps=r.gaps.filter(g=>g.source!==pending.path);},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/foreign.test.mjs"});},
      (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},
      (m,r)=>{m.source_baseline="0cf2678091e936588b4dfdb5fd9a3911910af3da";},
    ]){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertCurrentSourceDrift(m,r));}
  }
});

test("pending asynchronous training diagnostics refuse forged future missing duplicate and extra facts",()=>{
  const current=JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-current-census.json"));
  const currentResult={gaps:current.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.doesNotThrow(()=>assertCompleteCurrentSourceDrift(current,currentResult));
  // Test pending-only denials against their own real history after legitimate binding.
  const map=JSON.parse(historicalSource("9585fe7f30a89b616fc8c3121da3080d02ebf6d5","docs/operations/comprehensive-ui-automation-current-census.json"));
  map.source_baseline=pendingTrainingTaskDefinitions[0].baseline;
  for(const pending of pendingTrainingTaskDefinitions){
    assert.equal(pending.baseline,map.source_baseline);
    const rows=map.sources.filter(row=>row.path===pending.path);assert.equal(rows.length,1);
    const committed=historicalSource(pending.baseline,pending.path);
    assert.equal(sha(committed),pending.committed,"Pending fixtures retain actual historical Git pins.");
    const reviewed=historicalSource("8bbc8aca6cfedc95aec0920f2fcf648b7fda6559",pending.path);
    assert.equal(sha(reviewed),pending.candidate,"Historical task candidates retain their real reviewed Git bytes.");
    rows[0].facts=sourceFacts(pending.path,reviewed);
    rows[0].committed_sha256=pending.committed;
  }
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.doesNotThrow(()=>assertCurrentSourceDrift(map,result));
  for(const pending of pendingTrainingTaskDefinitions){
    const target=m=>m.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},
      (m,r)=>{target(m).facts.sha256="0".repeat(64);},
      (m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{target(m).facts.extra="forged";},
      (m,r)=>{r.gaps=r.gaps.filter(g=>g.source!==pending.path);},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/foreign-task.test.mjs"});},
      (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},
      (m,r)=>{m.sources.push(structuredClone(target(m)));},
      (m,r)=>{m.source_baseline="0cf2678091e936588b4dfdb5fd9a3911910af3da";},
    ]){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertCurrentSourceDrift(m,r));}
  }
});

test("pending adapter-format definitions refuse forged future missing duplicate and extra facts",()=>{
  const current=JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-current-census.json"));
  const currentResult={gaps:current.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.doesNotThrow(()=>assertCompleteCurrentSourceDrift(current,currentResult));
  const map=JSON.parse(historicalSource("9585fe7f30a89b616fc8c3121da3080d02ebf6d5","docs/operations/comprehensive-ui-automation-current-census.json"));map.source_baseline=pendingTrainingAdapterDefinitions[0].baseline;
  for(const pending of pendingTrainingAdapterDefinitions){
    const rows=map.sources.filter(row=>row.path===pending.path);assert.equal(rows.length,1);
    const committed=historicalSource(pending.baseline,pending.path);
    assert.equal(sha(committed),pending.committed);rows[0].committed_sha256=pending.committed;
    assert.equal(sha(JSON.stringify(rows[0].facts)),pending.facts_sha256);
  }
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.doesNotThrow(()=>assertCurrentSourceDrift(map,result));
  for(const pending of pendingTrainingAdapterDefinitions){
    const target=m=>m.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},
      (m,r)=>{target(m).facts.sha256="0".repeat(64);},
      (m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{target(m).facts.extra="forged";},
      (m,r)=>{r.gaps=r.gaps.filter(g=>g.source!==pending.path);},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/foreign-adapter.test.mjs"});},
      (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},
      (m,r)=>{m.sources.push(structuredClone(target(m)));},
      (m,r)=>{m.source_baseline="0cf2678091e936588b4dfdb5fd9a3911910af3da";},
    ]){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertCurrentSourceDrift(m,r));}
  }
});

test("historical Git lookup keeps commit and path identity and returns defensive bytes",()=>{
  const first=pendingTrainingAdapterDefinitions[0],other=pendingTrainingAdapterDefinitions[1];
  const original=historicalSource(first.baseline,first.path);assert.equal(sha(original),first.committed);
  original.fill(0);
  const next=historicalSource(first.baseline,first.path);assert.notStrictEqual(next,original);assert.equal(sha(next),first.committed);
  assert.equal(sha(historicalSource(other.baseline,other.path)),other.committed);
  for(const commit of ["HEAD","HEAD~1","", "a".repeat(39)])assert.throws(()=>historicalSource(commit,first.path));
  for(const name of ["../private.ts","C:/private.ts","docs/../private.ts"])assert.throws(()=>historicalSource(first.baseline,name));
  assert(historicalGitBytes.size<=64);assert(historicalGitTotalBytes<=CENSUS_LIMITS.totalBytes);
});

test("pending Settings navigation definitions reject forged future missing duplicate and unrelated facts",()=>{
  // Freeze this older fixture to real historical facts, not later working edits.
  const map=JSON.parse(historicalSource("1e5fd6b76e30025b4571787573b09a3f8b413103","docs/operations/comprehensive-ui-automation-current-census.json"));
  map.source_baseline=pendingSettingsNavigationDefinitions[0].baseline;
  const review=map.sources.find(row=>row.path===pendingReviewSiteDefinition.source);assert(review);
  const originalReview=historicalSource(map.source_baseline,review.path);
  review.facts=sourceFacts(review.path,originalReview);review.committed_sha256=sha(originalReview);
  for(const pending of pendingSettingsNavigationDefinitions){
    const row=map.sources.find(row=>row.path===pending.path);assert(row);row.committed_sha256=pending.committed;row.facts=sourceFacts(pending.path,historicalSource("bb895bef9cd95c2662cbe185c03ea69bda6d938d",pending.path));
  }
  const result={gaps:pendingSettingsNavigationDefinitions.map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  const target=m=>m.sources.find(row=>row.path===pendingSettingsNavigationDefinitions[0].path);
  assertCurrentSourceDrift(map,result);
  for(const mutate of [
    (m,r)=>{target(m).committed_sha256=target(m).facts.sha256;},
    (m,r)=>{target(m).facts.sha256="f".repeat(64);},
    (m,r)=>{target(m).facts.bytes++;},
    (m,r)=>{m.source_baseline="9585fe7f30a89b616fc8c3121da3080d02ebf6d5";},
    (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pendingSettingsNavigationDefinitions[0].path);},
    (m,r)=>{m.sources.push(structuredClone(target(m)));},
    (m,r)=>{r.gaps.pop();},
    (m,r)=>{r.gaps.push(structuredClone(r.gaps[0]));},
    (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/example.unit.test.ts"});},
  ]){
    const m=structuredClone(map),r=structuredClone(result);mutate(m,r);
    assert.throws(()=>assertCurrentSourceDrift(m,r));
  }
});

for(const [title,readMap,definitions]of[
  ["pending contrast diagnostic facts reject forged future missing duplicate and unrelated drift",
    ()=>JSON.parse(historicalSource(pendingContrastV2Diagnostics[0].baseline,"docs/operations/comprehensive-ui-automation-current-census.json")),pendingContrastDiagnostics],
  ["pending v2 contrast diagnostic facts reject forged future missing duplicate and unrelated drift",
    ()=>JSON.parse(historicalSource(pendingContrastRegionDefinitions[0].baseline,"docs/operations/comprehensive-ui-automation-current-census.json")),pendingContrastV2Diagnostics],
  ["pending contrast region definitions reject forged future missing duplicate and unrelated drift",
    ()=>JSON.parse(historicalSource(shellContrastBaseline,"docs/operations/comprehensive-ui-automation-current-census.json")),pendingContrastRegionDefinitions],
  ["pending shell contrast definitions reject forged future missing duplicate and unrelated drift",
    ()=>JSON.parse(historicalSource("3e9873fb30238eb3446bc685c423005a4db09117","docs/operations/comprehensive-ui-automation-current-census.json")),pendingShellContrastDefinitions],
])test(title,()=>{
  const map=readMap();
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  // Qualify this three-row boundary on each real version. The whole current map
  // is authenticated separately; do not re-read unrelated old source families.
  const check=(m,r)=>assert.deepEqual(assertContrastDiagnosticDrift(m,r,definitions).gaps,[]);
  check(map,result);
  for(const pending of definitions) {
    const target=m=>m.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},
      (m,r)=>{target(m).facts.sha256="0".repeat(64);},
      (m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{target(m).facts.extra="forged";},
      (m,r)=>{m.source_baseline="0".repeat(40);},
      (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},
      (m,r)=>{m.sources.push(structuredClone(target(m)));},
      (m,r)=>{r.gaps=r.gaps.filter(g=>g.source!==pending.path);},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/unrelated.unit.test.ts"});},
    ]) {const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>check(m,r));}
  }
});

test("pending delivery display binding rejects forged future missing duplicate and unrelated drift",()=>{
  const pending=pendingReviewDeliveryDefinition;
  const map={source_baseline:pending.baseline,sources:[{path:pending.source,
    facts:sourceFacts(pending.source,historicalSource("d912fb70da8cda8b723187126c31a0e9da850955",pending.source)),committed_sha256:pending.committed}]};
  const result={gaps:[{kind:"unreviewed-source-drift",source:pending.source}]};
  assertCurrentReviewSiteDrift(map,result);
  for(const mutate of [
    (m,r)=>{m.sources[0].committed_sha256=pending.candidate;},
    (m,r)=>{m.sources[0].facts.sha256="f".repeat(64);},
    (m,r)=>{m.sources[0].facts.assertionCount++;},
    (m,r)=>{m.sources[0].facts.extra="forged";},
    (m,r)=>{m.source_baseline=pendingReviewSiteDefinition.baseline;},
    (m,r)=>{m.sources=[];},
    (m,r)=>{m.sources.push(structuredClone(m.sources[0]));},
    (m,r)=>{r.gaps=[];},
    (m,r)=>{r.gaps.push(structuredClone(r.gaps[0]));},
    (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/example.unit.test.ts"});},
  ]){
    const m=structuredClone(map),r=structuredClone(result);mutate(m,r);
    assert.throws(()=>assertCurrentReviewSiteDrift(m,r));
  }
});

test("saved-value oracle binding refuses stale forged missing duplicate and unrelated drift",()=>{
  const baseline=pendingSettingsEmptyDefinitions[0].baseline;
  const map={source_baseline:baseline,sources:pendingSettingsEmptyDefinitions.map(p=>({path:p.path,facts:sourceFacts(p.path,fs.readFileSync(p.path)),committed_sha256:p.committed}))};
  const result={gaps:pendingSettingsEmptyDefinitions.map(p=>({kind:"unreviewed-source-drift",source:p.path}))};
  assert.deepEqual(assertSettingsEmptySourceDrift(map,result).gaps,[]);
  for(const mutate of [
    (m,r)=>{m.sources[0].committed_sha256=m.sources[0].facts.sha256;},
    (m,r)=>{m.sources[0].facts.sha256="f".repeat(64);},
    (m,r)=>{m.sources[0].facts.assertionCount++;},
    (m,r)=>{m.sources[0].facts.extra="forged";},
    (m,r)=>{m.source_baseline=pendingSettingsNavigationDefinitions[0].baseline;},
    (m,r)=>{m.sources.pop();},(m,r)=>{m.sources.push(structuredClone(m.sources[0]));},
    (m,r)=>{r.gaps.pop();},(m,r)=>{r.gaps.push(structuredClone(r.gaps[0]));},
  ]){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertSettingsEmptySourceDrift(m,r));}
  const foreign={kind:"unreviewed-source-drift",source:"dev-tools/unrelated.unit.test.ts"};
  assert.deepEqual(assertSettingsEmptySourceDrift(map,{gaps:[...result.gaps,foreign]}).gaps,[foreign]);
});


test("pending responsive journey facts retain four exact drifts and refuse future or missing evidence",()=>{
  const map=JSON.parse(historicalSource("59545794f97ec030f2ef3484c7d07dda501bdd97","docs/operations/comprehensive-ui-automation-current-census.json"));
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.equal(pendingResponsiveJourneyDefinitions.length,4);assert.equal(pendingCurrentJourneyDefinitions.length,4);
  assert.equal(result.gaps.length,4);assertCurrentSourceDrift(map,result);
  for(const pending of pendingCurrentJourneyDefinitions) {
    const target=m=>m.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},
      (m,r)=>{target(m).facts.sha256="0".repeat(64);},
      (m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{target(m).facts.extra="forged";},
      (m,r)=>{m.source_baseline="0".repeat(40);},
      (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},
      (m,r)=>{m.sources.push(structuredClone(target(m)));},
      (m,r)=>{r.gaps=r.gaps.filter(row=>row.source!==pending.path);},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/unrelated.unit.test.ts"});},
    ]) {
      const changed=structuredClone(map),observation=structuredClone(result);mutate(changed,observation);
      assert.throws(()=>assertCurrentSourceDrift(changed,observation));
    }
  }
});

test("historical model startup report facts retain eight exact drifts and reject forged or unrelated evidence",()=>{
  const map=JSON.parse(historicalSource("26000fe16c1eab3b1f071960493c40b30a264fc4","docs/operations/comprehensive-ui-automation-current-census.json"));
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.equal(pendingModelStartupReportDefinitions.length,4);assert.equal(result.gaps.length,8);
  assertCurrentSourceDrift(map,result,true);
  assert.throws(()=>assertCurrentSourceDrift(map,result),"Historical-only guards cannot accept the new unrelated drift.");
  for(const pending of pendingModelStartupReportDefinitions) {
    const target=m=>m.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},
      (m,r)=>{target(m).facts.sha256="0".repeat(64);},
      (m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{target(m).facts.extra="forged";},
      (m,r)=>{m.source_baseline="0".repeat(40);},
      (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},
      (m,r)=>{m.sources.push(structuredClone(target(m)));},
      (m,r)=>{r.gaps=r.gaps.filter(row=>row.source!==pending.path);},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/unrelated.unit.test.ts"});},
    ]) {
      const changed=structuredClone(map),observation=structuredClone(result);mutate(changed,observation);
      assert.throws(()=>assertCurrentSourceDrift(changed,observation,true));
    }
  }
});

test("historical private-provider definitions bind two exact updates and retain every other source gap",()=>{
  const map=JSON.parse(historicalSource("f62aa7176eccfb065eab27ea56edf6bbb1bc0dbc","docs/operations/comprehensive-ui-automation-current-census.json"));
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.equal(map.sources.length,180);assert.equal(result.gaps.length,10);assert.equal(pendingPrivateProviderDefinitions.length,2);
  assertPrivateProviderSourceDrift(map,result);
  assert.throws(()=>assertCurrentSourceDrift(map,result,true),"Earlier history must not accept a later private definition revision.");
  for(const pending of pendingPrivateProviderDefinitions){
    const target=m=>m.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},
      (m,r)=>{target(m).facts.sha256="0".repeat(64);},
      (m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{target(m).facts.extra="forged";},
      (m,r)=>{m.source_baseline="0".repeat(40);},
      (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},
      (m,r)=>{m.sources.push(structuredClone(target(m)));},
      (m,r)=>{r.gaps=r.gaps.filter(row=>row.source!==pending.path);},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/unrelated.unit.test.ts"});},
    ]){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertPrivateProviderSourceDrift(m,r));}
  }
});

test("historical workspace-confirmation definitions bind exactly three updates without weakening earlier guards",()=>{
  const map=JSON.parse(historicalSource("75efdd2456f67757fd07b749dd398128af969e03","docs/operations/comprehensive-ui-automation-current-census.json"));
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.equal(map.sources.length,180);assert.equal(result.gaps.length,13);assert.equal(pendingWorkspaceSwitchDefinitions.length,3);
  assertReferenceSourceDrift(map,result);
  assert.throws(()=>assertPrivateProviderSourceDrift(map,result),"Earlier history must refuse the newer workspace definitions.");
  for(const pending of pendingWorkspaceSwitchDefinitions){
    const target=m=>m.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},
      (m,r)=>{target(m).facts.sha256="0".repeat(64);},
      (m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{target(m).facts.extra="forged";},
      (m,r)=>{m.source_baseline="0".repeat(40);},
      (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},
      (m,r)=>{m.sources.push(structuredClone(target(m)));},
      (m,r)=>{r.gaps=r.gaps.filter(row=>row.source!==pending.path);},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/unrelated.unit.test.ts"});},
    ]){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertReferenceSourceDrift(m,r));}
  }
});

test("historical review-reference definition binds exact new facts and preserves every earlier source guard",()=>{
  const map=JSON.parse(historicalSource("42179ebae1106046efaa035d8c3682b974237dfb","docs/operations/comprehensive-ui-automation-current-census.json"));
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.equal(map.sources.length,180);assert.equal(result.gaps.length,14);
  const pending=pendingReviewReferenceDefinition,target=m=>m.sources.find(row=>row.path===pending.source);
  assert.equal(map.source_baseline,pending.baseline);
  assert.equal(target(map).committed_sha256,pending.committed);
  assert.equal(target(map).facts.sha256,pending.candidate);
  assert.equal(sha(JSON.stringify(target(map).facts)),pending.facts);
  assertReferenceSourceDrift(map,result);
  for(const mutate of [
    (m,r)=>{target(m).committed_sha256=pending.candidate;},
    (m,r)=>{target(m).facts.sha256="0".repeat(64);},
    (m,r)=>{target(m).facts.assertionCount++;},
    (m,r)=>{target(m).facts.extra="forged";},
    (m,r)=>{m.source_baseline="0".repeat(40);},
    (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.source);},
    (m,r)=>{m.sources.push(structuredClone(target(m)));},
    (m,r)=>{r.gaps=r.gaps.filter(row=>row.source!==pending.source);},
    (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.source});},
    (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/unrelated.unit.test.ts"});},
  ]){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertReferenceSourceDrift(m,r));}
});

test("historical browser-reference definitions bind exact updates and one added pure guard without inheriting a pass",()=>{
  const map=JSON.parse(historicalSource("be0a48e241ca94d1ad18fda89ffa8f095d98e56c","docs/operations/comprehensive-ui-automation-current-census.json"));
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.equal(map.sources.length,181);assert.equal(result.gaps.length,17);assert.equal(pendingReviewBrowserDefinitions.length,3);
  assertBrowserReferenceSourceDrift(map,result);
  assert.throws(()=>assertReferenceSourceDrift(map,result),"Earlier reference history cannot qualify new browser definitions.");
  for(const pending of pendingReviewBrowserDefinitions){
    const target=m=>m.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},
      (m,r)=>{target(m).facts.sha256="0".repeat(64);},
      (m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{target(m).facts.extra="forged";},
      (m,r)=>{target(m).extra="forged";},
      (m,r)=>{m.source_baseline="0".repeat(40);},
      (m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},
      (m,r)=>{m.sources.push(structuredClone(target(m)));},
      (m,r)=>{r.gaps=r.gaps.filter(row=>row.source!==pending.path);},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/unrelated.unit.test.ts"});},
    ]){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertBrowserReferenceSourceDrift(m,r));}
  }
  for(const mutate of [
    m=>m.sources.push({path:"dev-tools/unrelated.unit.test.ts",facts:{},committed_sha256:"0".repeat(64)}),
    m=>m.scenarios.find(row=>row.id==="contributor-review-site").behavior_links[0].assertion_sources.pop(),
    m=>m.scenarios.find(row=>row.id==="contributor-review-site").behavior_links[0].assertion_sources.shift(),
    m=>m.scenarios.push(structuredClone(m.scenarios.find(row=>row.id==="contributor-review-site"))),
  ]){const current=structuredClone(map);mutate(current);assert.throws(()=>assertBrowserReferenceSourceDrift(current,structuredClone(result)));}
});

// Current source-only binding does not certify any of the39 host families.
test("committed census pins every definition to its actual reviewed checkpoint without passing hosts",()=>{
  const map=JSON.parse(historicalSource("a35834b49a9e056d49973a1377b10f819fbaa8b9","docs/operations/comprehensive-ui-automation-current-census.json"));
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  assert.equal(map.source_baseline,committedCensusDefinition.baseline);assert.equal(map.sources.length,181);assert.equal(result.gaps.length,0);assert.equal(map.scenarios.length,39);
  assertCompleteCurrentSourceDrift(map,result);assert.throws(()=>assertBrowserReferenceSourceDrift(map,result));
  for(const mutate of [
    m=>{m.source_baseline="0".repeat(40);},m=>{m.source_baseline="608679a6095ef5617921e504bf208858df6a7c49";},
    m=>{m.sources[0].committed_sha256="0".repeat(64);},m=>{m.sources[0].facts.sha256="0".repeat(64);},m=>{m.sources[0].facts.assertionCount++;},
    m=>{m.sources.pop();},m=>{m.sources.push(structuredClone(m.sources[0]));},m=>{m.sources[0].extra="forged";},
    m=>{m.scenarios[0].behavior_links[0].assertion_sources.pop();},m=>{m.scenarios[0].execution_status="passed";},m=>{m.full_testing_status="passed";},m=>{m.extra="forged";},
  ]){const changed=structuredClone(map);mutate(changed);assert.throws(()=>assertCompleteCurrentSourceDrift(changed,structuredClone(result)));}
  assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:[{kind:"unreviewed-source-drift",source:map.sources[0].path}]}));
});
test("pending navigation definitions retain exact working gaps and cannot weaken committed or older guards",()=>{
  const map=JSON.parse(historicalSource("6c785c91f117d816829a899428433e162accfde2","docs/operations/comprehensive-ui-automation-current-census.json"));
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  const before=JSON.stringify({map,result});assert.equal(result.gaps.length,3);assert.doesNotThrow(()=>assertCompleteCurrentSourceDrift(map,result));assert.equal(JSON.stringify({map,result}),before);
  const old=navigationCensusLegacyView(map,result);assert.equal(sha(JSON.stringify(old.map)),committedCensusDefinition.currentMap);assert.deepEqual(old.result.gaps,[]);assert.notEqual(old.map,map);
  for(const pending of pendingNavigationDefinition.sources){
    const target=value=>value.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},(m,r)=>{target(m).facts.sha256="0".repeat(64);},(m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{target(m).facts.extra="forged";},(m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},(m,r)=>{m.sources.push(structuredClone(target(m)));},
      (m,r)=>{r.gaps=r.gaps.filter(row=>row.source!==pending.path);},(m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/unrelated.unit.test.mjs"});},(m,r)=>{m.full_testing_status="passed";},
      (m,r)=>{m.scenarios[0].execution_status="passed";},(m,r)=>{m.source_baseline="0".repeat(40);},
    ]){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertCompleteCurrentSourceDrift(m,r));}
  }
});

test("pending notification definitions preserve raw gaps and every earlier source guard",()=>{
  const map=JSON.parse(historicalSource(currentPublishedFormCensus.previousCommit,censusDocument));
  const result={gaps:map.sources.filter(row=>row.facts.sha256!==row.committed_sha256).map(row=>({kind:"unreviewed-source-drift",source:row.path}))};
  const before=JSON.stringify({map,result});assert.equal(result.gaps.length,3);assert.doesNotThrow(()=>assertCompleteCurrentSourceDrift(map,result));assert.equal(JSON.stringify({map,result}),before);
  const old=notificationCensusLegacyView(map,result);assert.equal(sha(JSON.stringify(old.map)),pendingNavigationDefinition.map);assert.deepEqual(old.result.gaps,result.gaps);assert.notEqual(old.map,map);
  assert.doesNotThrow(()=>assertCompleteCurrentSourceDrift(old.map,old.result));
  for(const pending of pendingNotificationDefinition.sources){
    const target=value=>value.sources.find(row=>row.path===pending.path);
    for(const mutate of [
      (m,r)=>{target(m).committed_sha256=pending.candidate;},(m,r)=>{target(m).facts.sha256="0".repeat(64);},(m,r)=>{target(m).facts.assertionCount++;},
      (m,r)=>{target(m).facts.extra="forged";},(m,r)=>{m.sources=m.sources.filter(row=>row.path!==pending.path);},(m,r)=>{m.sources.push(structuredClone(target(m)));},
      (m,r)=>{r.gaps=r.gaps.filter(row=>row.source!==pending.path);},(m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:pending.path});},
      (m,r)=>{r.gaps.push({kind:"unreviewed-source-drift",source:"dev-tools/unrelated.unit.test.mjs"});},(m,r)=>{m.full_testing_status="passed";},
      (m,r)=>{m.scenarios[0].execution_status="passed";},(m,r)=>{m.source_baseline="0".repeat(40);},
    ]){const m=structuredClone(map),r=structuredClone(result);mutate(m,r);assert.throws(()=>assertCompleteCurrentSourceDrift(m,r));}
  }
});

test("current published form checkpoint preserves its complete source gaps and original notification witness",()=>{
  const map=JSON.parse(fs.readFileSync(censusDocument,"utf8"));
  const result={gaps:sourceDrift(map)};
  const before=JSON.stringify({map,result});
  assert.equal(result.gaps.length,32);
  const isPendingHeadless = row => row.kind === "unreviewed-source-drift" && row.source === headlessPackagedSpec;
  assert.equal(result.gaps.filter(isPendingHeadless).length,1);
  assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>!isPendingHeadless(row))}));
  const imageLabelPrior = beforeDesktopImageLabelCensus(map,result);
  assert.equal(imageLabelPrior.result.gaps.length,30);
  assert.equal(sha(JSON.stringify(imageLabelPrior.map)),reviewedDesktopImageLabelCensus.before);
  for (const pin of reviewedDesktopImageLabelCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  const responsivePrior = verifyExactLayoutCensus(imageLabelPrior.map,imageLabelPrior.result,reviewedResponsiveAssetDriverCensus);
  assert.equal(responsivePrior.result.gaps.length,28);
  assert.equal(sha(JSON.stringify(responsivePrior.map)),reviewedResponsiveAssetDriverCensus.before);
  for (const pin of reviewedResponsiveAssetDriverCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  const connectionsPrior = verifyExactLayoutCensus(responsivePrior.map,responsivePrior.result,reviewedConnectionsCensus);
  assert.equal(connectionsPrior.result.gaps.length,27);
  assert.equal(sha(JSON.stringify(connectionsPrior.map)),reviewedConnectionsCensus.before);
  for (const pin of reviewedConnectionsCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  const pagePrior = pageLayoutLegacyView(map,result);
  assert.equal(pagePrior.result.gaps.length,26);
  assert.equal(sha(JSON.stringify(pagePrior.map)),reviewedPageLayoutCensus.before);
  for (const pin of reviewedPageLayoutCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  const layoutPrior = layoutKeyboardLegacyView(map,result);
  assert.equal(layoutPrior.result.gaps.length,26);
  assert.equal(sha(JSON.stringify(layoutPrior.map)),reviewedLayoutKeyboardCensus.before);
  for (const pin of reviewedLayoutKeyboardCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  const desktopRestartPrior = meaningfulDesktopRestartLegacyView(map,result);
  assert.equal(desktopRestartPrior.result.gaps.length,25);
  assert.equal(sha(JSON.stringify(desktopRestartPrior.map)),reviewedMeaningfulDesktopRestartCensus.before);
  for (const pin of reviewedMeaningfulDesktopRestartCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  const meaningfulPrior = meaningfulFormLegacyView(map,result);
  assert.equal(meaningfulPrior.result.gaps.length,25);
  assert.equal(sha(JSON.stringify(meaningfulPrior.map)),reviewedMeaningfulFormCensus.before);
  for (const pin of reviewedMeaningfulFormCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  const summaryPrior = canvasPreviewSummaryLegacyView(map,result);
  assert.equal(summaryPrior.result.gaps.length,24);
  assert.equal(sha(JSON.stringify(summaryPrior.map)),reviewedCanvasPreviewSummaryCensus.before);
  for (const pin of reviewedCanvasPreviewSummaryCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  const settledPrior = settledCanvasAuditLegacyView(map,result);
  assert.equal(settledPrior.result.gaps.length,24);
  assert.equal(sha(JSON.stringify(settledPrior.map)),reviewedSettledCanvasAuditCensus.before);
  for (const pin of reviewedSettledCanvasAuditCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  const nativePrior = nativeAssetUiCensusLegacyView(map,result);
  assert.equal(nativePrior.result.gaps.length,23);
  assert.equal(sha(JSON.stringify(nativePrior.map)),reviewedNativeAssetUiCensus.before);
  for (const pin of reviewedNativeAssetUiCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  const prior = assetUiCensusLegacyView(map,result);
  assert.equal(prior.result.gaps.length,18);
  assert.equal(sha(JSON.stringify(prior.map)),reviewedAssetUiCensus.before);
  for (const pin of reviewedAssetUiCensus.pins) {
    assert(result.gaps.some(row=>row.kind==="unreviewed-source-drift"&&row.source===pin.path));
    assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.filter(row=>row.source!==pin.path)}));
  }
  assert.equal(formHostCensusLegacyView(map,result).result.gaps.length,16);
  assert.doesNotThrow(()=>assertCompleteCurrentSourceDrift(map,result));
  assert.equal(JSON.stringify({map,result}),before);
  const old=currentPublishedFormCensusLegacyView(map,result);
  assert.equal(sha(JSON.stringify(old.map)),pendingNotificationDefinition.map);
  assert.deepEqual(old.result.gaps,sourceDrift(old.map));
  assert.throws(()=>assertCompleteCurrentSourceDrift(map,{gaps:result.gaps.slice(1)}));
  const forged=structuredClone(map);
  forged.scenarios[0].execution_status="passed";
  assert.throws(()=>assertCompleteCurrentSourceDrift(forged,result));
  const stale=structuredClone(map);
  const [pin]=publishedFormTabInventory;
  stale.inventories.find(row=>row.source===pin.source&&row.property==="label").sha256=pin.before;
  assert.throws(()=>assertCompleteCurrentSourceDrift(stale,result));
});
