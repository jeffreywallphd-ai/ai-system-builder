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
function assertCurrentReviewSiteDrift(map, result) {
  const pending = map.source_baseline === pendingReviewDeliveryDefinition.baseline ? pendingReviewDeliveryDefinition : pendingReviewSiteDefinition;
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
function assertCurrentSourceDrift(map, result) {
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
  assert.equal(result.scenario_count,39);assert.equal(result.behavior_links,131);assert.equal(result.current_host_spec_files,29);
  assert.equal(result.inventory_groups,16);assert.equal(result.executed_tests,0);assert.equal(result.parent_qualification_granted,false);
  const map=JSON.parse(read("docs/operations/comprehensive-ui-automation-current-census.json"));
  assertSettingsNavigationSourceDrift(map,result);
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
      if(![...pendingSettingsNavigationDefinitions,...pendingSettingsEmptyDefinitions].some(p=>p.path===source.path&&source.facts.sha256!==source.committed_sha256))
      assert.equal(source.facts.sha256,source.committed_sha256,"Each new definition must already be committed after review.");
      assert(row.behavior_links.every(link=>link.assertion_sources.includes(source.path)));
    }
  }
  assert(!result.gaps.some(g=>g.kind==="host-definition-not-mapped"));
  assertCurrentSourceDrift(map,result);
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
      assert.notEqual(name,website,"Unchanged website definitions still bind to their actual committed source.");
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
      // The composed exact SHA/full-facts/Git guard above admits this one
      // prospective oracle definition; a pathname alone never exempts drift.
      assert(trainingDefinitionsFor(map).some(p=>p.path===source&&p.candidate===row.facts.sha256&&p.facts_sha256===sha(JSON.stringify(row.facts))));
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
  // One newly used, changed oracle has its own exact current source proof.
  // The eight old rows and their digests remain unchanged historical versions.
  assertReintroducedTrainingOracle(map,archive);
  const ledger=JSON.parse(read("docs/operations/comprehensive-ui-automation-coverage.json"));
  assert.equal(ledger.current_definition_census.historical_source_archive,"docs/operations/comprehensive-ui-automation-census-source-history.json");
  assert.equal(ledger.full_testing_status,"deferred-by-user");assert(ledger.scenarios.every(s=>s.actual_host_qualification==="pending"));
  assert.equal(CENSUS_LIMITS.files,192);assert.equal(CENSUS_LIMITS.documentBytes,512*1024);assert.equal(CENSUS_LIMITS.totalBytes,32*1024*1024);
});

test("reintroduced oracle coverage refuses old, missing, duplicate, future or unrelated versions",()=>{
  const map=JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-current-census.json"));
  const archive=JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-census-source-history.json"));
  const name="dev-tools/scripts/qualification/visual-composer/model-training-oracles.ts";
  const row=m=>m.sources.find(value=>value.path===name);
  assert.doesNotThrow(()=>assertReintroducedTrainingOracle(map,archive));
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
  ]){const current=structuredClone(map);mutate(current);assert.throws(()=>assertReintroducedTrainingOracle(current,archive));}
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
  assert.doesNotThrow(()=>assertCurrentSourceDrift(current,currentResult));
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
  assert.doesNotThrow(()=>assertCurrentSourceDrift(current,currentResult));
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
    ()=>JSON.parse(fs.readFileSync("docs/operations/comprehensive-ui-automation-current-census.json")),pendingContrastRegionDefinitions],
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
