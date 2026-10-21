import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  realpathSync,
  openSync,
  closeSync,
  fstatSync,
  readSync,
} from "node:fs";
import path from "node:path";

const hex = /^[a-f0-9]{64}$/u;
const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const validId = (value) =>
  typeof value === "string" && value.length <= 160 && identifier.test(value);
const fail = () => {
  throw new Error(
    "Qualification inputs are missing, changed, unsafe or inconsistent; no release qualification was granted.",
  );
};
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

function readBounded(file, maximum) {
  const descriptor = openSync(file, "r");
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.size > maximum) fail();
    const bytes = Buffer.alloc(info.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(
        descriptor,
        bytes,
        size,
        bytes.length - size,
        null,
      );
      if (!count) break;
      size += count;
    }
    // Growth is input drift; reject before allocating beyond the original bound.
    if (size !== info.size) fail();
    return bytes.subarray(0, size);
  } finally {
    closeSync(descriptor);
  }
}

export function repositoryFile(root, relative) {
  if (
    typeof relative !== "string" ||
    relative.length > 500 ||
    /[:\\\u0000]/u.test(relative) ||
    path.posix.isAbsolute(relative) ||
    relative.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail();
  const target = path.join(root, relative);
  const resolved = realpathSync(target);
  const inside = path.relative(realpathSync(root), resolved);
  if (
    inside.startsWith("..") ||
    path.isAbsolute(inside) ||
    lstatSync(target).isSymbolicLink() ||
    !lstatSync(target).isFile()
  )
    fail();
  return target;
}

export function readQualificationJson(root, relative) {
  const target = repositoryFile(root, relative);
  const bytes = readBounded(target, 1024 * 1024);
  return { value: JSON.parse(bytes.toString("utf8")), digest: sha256(bytes) };
}

export function readFunctionalitySourceIdentity(root) {
  const listed = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "apps",
      "modules",
      "dev-tools",
      "skills",
      "package.json",
      "package-lock.json",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  // UI assets and policy files affect qualification as much as executable code.
  const files = [...new Set(listed.split("\0").filter(Boolean))].sort();
  if (!files.length || files.length > 20000) fail();
  const hash = createHash("sha256");
  for (const name of files) {
    const file = repositoryFile(root, name);
    hash
      .update(name)
      .update("\0")
      .update(readBounded(file, 8 * 1024 * 1024))
      .update("\0");
  }
  return hash.digest("hex");
}

export function assessFunctionalityQualification(
  crosswalk,
  owners,
  sourceIdentity,
  crosswalkDigest,
) {
  if (
    crosswalk?.schema_version !== "functionality-qualification-crosswalk-v1" ||
    crosswalk.scope !== "ownership-and-qualification-readiness" ||
    !hex.test(sourceIdentity) ||
    !hex.test(crosswalkDigest) ||
    !Array.isArray(crosswalk.owners) ||
    !crosswalk.owners.length ||
    crosswalk.owners.length > 8
  )
    fail();
  const criteria = [];
  const ownerStates = [];
  const seen = new Set();
  for (const owner of crosswalk.owners) {
    if (
      !validId(owner.slug) ||
      seen.has(owner.slug) ||
      !Array.isArray(owner.criteria) ||
      !owner.criteria.length ||
      owner.criteria.length > 64
    )
      fail();
    seen.add(owner.slug);
    const input = owners[owner.slug];
    const state = input?.value;
    if (
      !hex.test(input?.digest ?? "") ||
      state?.schemaVersion !== 1 ||
      state.slug !== owner.slug ||
      !Array.isArray(state.increments) ||
      !Array.isArray(state.evidence)
    )
      fail();
    const actual = new Map();
    for (const increment of state.increments) {
      if (
        !validId(increment.id) ||
        !Array.isArray(increment.acceptanceCriteria)
      )
        fail();
      for (const criterion of increment.acceptanceCriteria) {
        if (criterion.qualification === "controlled-environment") {
          const key = `${increment.id}/${criterion.id}`;
          if (!validId(criterion.id) || actual.has(key)) fail();
          actual.set(key, true);
        }
      }
    }
    const mapped = new Set();
    for (const requirement of owner.criteria) {
      const key = `${requirement.increment_id}/${requirement.criterion_id}`;
      if (
        !actual.has(key) ||
        mapped.has(key) ||
        !Array.isArray(requirement.environment_requirements) ||
        !requirement.environment_requirements.length ||
        requirement.environment_requirements.some(
          (name) =>
            !validId(name) ||
            typeof crosswalk.environments?.[name] !== "string",
        )
      )
        fail();
      mapped.add(key);
      for (const field of ["procedures", "supporting_harnesses"]) {
        if (
          !Array.isArray(requirement[field]) ||
          !requirement[field].length ||
          requirement[field].length > 12 ||
          requirement[field].some(
            (ref) =>
              typeof ref !== "string" ||
              ref.length > 500 ||
              /[:\\\u0000]/u.test(ref) ||
              ref.startsWith("/") ||
              ref
                .split("/")
                .some((part) => !part || part === "." || part === ".."),
          )
        )
          fail();
      }
      const evidence = state.evidence
        .filter(
          (e) =>
            e.incrementId === requirement.increment_id &&
            e.criterionId === requirement.criterion_id,
        )
        .at(-1);
      if (
        evidence &&
        !["pending", "passed", "failed"].includes(evidence.outcome)
      )
        fail();
      const outcome = evidence?.outcome ?? "missing";
      criteria.push({
        owner: owner.slug,
        increment_id: requirement.increment_id,
        criterion_id: requirement.criterion_id,
        declared_outcome: outcome,
        qualification: outcome === "failed" ? "failed" : "pending",
        reason_code:
          outcome === "passed"
            ? "declaration-requires-current-source-and-environment-proof"
            : outcome === "failed"
              ? "declared-qualification-failed"
              : "controlled-evidence-unavailable",
        environment_requirements: [...requirement.environment_requirements],
        procedures: [...requirement.procedures],
        supporting_harnesses: [...requirement.supporting_harnesses],
      });
    }
    if (mapped.size !== actual.size) fail();
    ownerStates.push({ slug: owner.slug, state_digest: input.digest });
  }
  return {
    schema_version: "functionality-qualification-assessment-v1",
    assessment_kind: "read-only-ownership-and-source-assessment",
    source_identity: sourceIdentity,
    crosswalk_digest: crosswalkDigest,
    owner_states: ownerStates,
    criteria,
    release_readiness: "unqualified",
    controlled_criteria: criteria.length,
    pending_criteria: criteria.filter((c) => c.qualification === "pending")
      .length,
    failed_criteria: criteria.filter((c) => c.qualification === "failed")
      .length,
    limitation:
      "Historical declarations and automated conformance do not attest current controlled environments. This assessment never grants approval or mutates owner state.",
  };
}

export function readFunctionalityQualification(root) {
  const source = readFunctionalitySourceIdentity(root);
  const crosswalk = readQualificationJson(
    root,
    "docs/operations/functionality-qualification-crosswalk.json",
  );
  const owners = Object.create(null);
  if (
    !Array.isArray(crosswalk.value?.owners) ||
    crosswalk.value.owners.length > 8
  )
    fail();
  for (const owner of crosswalk.value.owners) {
    if (!validId(owner.slug)) fail();
    owners[owner.slug] = readQualificationJson(
      root,
      `.implementation-roadmaps/${owner.slug}/state.json`,
    );
  }
  const result = assessFunctionalityQualification(
    crosswalk.value,
    owners,
    source,
    crosswalk.digest,
  );
  const references = Object.create(null);
  for (const criterion of result.criteria) {
    for (const ref of [
      ...criterion.procedures,
      ...criterion.supporting_harnesses,
    ])
      references[ref] = sha256(
        readBounded(repositoryFile(root, ref), 1024 * 1024),
      );
  }
  if (
    readFunctionalitySourceIdentity(root) !== source ||
    readQualificationJson(
      root,
      "docs/operations/functionality-qualification-crosswalk.json",
    ).digest !== crosswalk.digest
  )
    fail();
  for (const owner of result.owner_states)
    if (
      readQualificationJson(
        root,
        `.implementation-roadmaps/${owner.slug}/state.json`,
      ).digest !== owner.state_digest
    )
      fail();
  for (const [ref, identity] of Object.entries(references)) {
    if (
      sha256(readBounded(repositoryFile(root, ref), 1024 * 1024)) !== identity
    )
      fail();
  }
  return { ...result, reference_digests: references };
}
