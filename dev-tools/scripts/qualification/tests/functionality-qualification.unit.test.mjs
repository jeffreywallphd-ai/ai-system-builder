import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  assessFunctionalityQualification,
  readFunctionalityQualification,
  readFunctionalitySourceIdentity,
  readQualificationJson,
  repositoryFile,
} from "../functionality-qualification-core.mjs";

function fixture(outcome = "pending") {
  const crosswalk = {
    schema_version: "functionality-qualification-crosswalk-v1",
    scope: "ownership-and-qualification-readiness",
    environments: { operators: "Required operators" },
    owners: [
      {
        slug: "owner",
        criteria: [
          {
            increment_id: "increment",
            criterion_id: "controlled",
            environment_requirements: ["operators"],
            procedures: ["docs/procedure.md"],
            supporting_harnesses: ["dev-tools/probe.mjs"],
          },
        ],
      },
    ],
  };
  const owners = {
    owner: {
      digest: "b".repeat(64),
      value: {
        schemaVersion: 1,
        slug: "owner",
        increments: [
          {
            id: "increment",
            acceptanceCriteria: [
              { id: "controlled", qualification: "controlled-environment" },
            ],
          },
        ],
        evidence: [
          {
            incrementId: "increment",
            criterionId: "controlled",
            outcome,
            summary: "synthetic-private-sentinel",
          },
        ],
      },
    },
  };
  return {
    crosswalk,
    owners,
    assess: () =>
      assessFunctionalityQualification(
        crosswalk,
        owners,
        "a".repeat(64),
        "c".repeat(64),
      ),
  };
}

test("pending, missing and historical passed evidence never qualify release or mutate owners", () => {
  for (const outcome of ["pending", "passed", "failed", "missing"]) {
    const f = fixture(outcome);
    if (outcome === "missing") f.owners.owner.value.evidence = [];
    const before = JSON.stringify(f);
    const result = f.assess();
    assert.equal(result.release_readiness, "unqualified");
    assert.equal(result.controlled_criteria, 1);
    assert.equal(result.criteria[0].declared_outcome, outcome);
    assert.equal(
      result.criteria[0].qualification,
      outcome === "failed" ? "failed" : "pending",
    );
    assert.equal(JSON.stringify(f), before);
    assert.ok(!JSON.stringify(result).includes("synthetic-private-sentinel"));
  }
});

test("missing, extra, duplicate, malformed and substituted ownership fails closed", () => {
  const mutations = [
    (f) => {
      delete f.owners.owner;
    },
    (f) => {
      f.owners.owner.value.slug = "other";
    },
    (f) => {
      f.owners.owner.value.schemaVersion = 2;
    },
    (f) => {
      f.crosswalk.owners.push(f.crosswalk.owners[0]);
    },
    (f) => {
      f.crosswalk.owners[0].criteria.push(f.crosswalk.owners[0].criteria[0]);
    },
    (f) => {
      f.crosswalk.owners[0].criteria[0].criterion_id = "other";
    },
    (f) => {
      f.crosswalk.owners[0].criteria[0].environment_requirements = ["unknown"];
    },
    (f) => {
      f.owners.owner.value.increments[0].acceptanceCriteria.push({
        id: "new-criterion",
        qualification: "controlled-environment",
      });
    },
    (f) => {
      f.owners.owner.value.evidence[0].outcome = "approved-by-model";
    },
    (f) => {
      f.crosswalk.owners[0].slug = undefined;
    },
    (f) => {
      f.crosswalk.owners[0].criteria[0].procedures = ["../outside.md"];
    },
    (f) => {
      f.crosswalk.owners[0].criteria[0].supporting_harnesses = [
        "https://example.invalid/payload",
      ];
    },
  ];
  for (const mutation of mutations) {
    const f = fixture();
    mutation(f);
    assert.throws(f.assess);
  }
});

test("source and policy identities are mandatory", () => {
  const f = fixture();
  assert.throws(() =>
    assessFunctionalityQualification(
      f.crosswalk,
      f.owners,
      "unknown",
      "c".repeat(64),
    ),
  );
  assert.throws(() =>
    assessFunctionalityQualification(
      f.crosswalk,
      f.owners,
      "a".repeat(64),
      "unknown",
    ),
  );
});

test("source identity includes dirty and untracked Python and JavaScript; unsafe reads are denied", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "functionality-source-"));
  try {
    execFileSync("git", ["init", "--quiet"], {
      cwd: directory,
      stdio: "ignore",
    });
    mkdirSync(path.join(directory, "modules"));
    writeFileSync(path.join(directory, "modules/probe.py"), "baseline\n");
    const before = readFunctionalitySourceIdentity(directory);
    writeFileSync(path.join(directory, "modules/probe.py"), "candidate\n");
    const after = readFunctionalitySourceIdentity(directory);
    assert.notEqual(before, after);
    writeFileSync(path.join(directory, "modules/probe.mjs"), "export {};\n");
    assert.notEqual(after, readFunctionalitySourceIdentity(directory));
    for (const name of ["page.css", "page.html", "icon.svg"]) {
      const baseline = readFunctionalitySourceIdentity(directory);
      writeFileSync(path.join(directory, "modules", name), "baseline");
      const admitted = readFunctionalitySourceIdentity(directory);
      assert.notEqual(
        baseline,
        admitted,
        `untracked ${name} must affect source`,
      );
      writeFileSync(
        path.join(directory, "modules", name),
        "changed-contrast-and-reflow",
      );
      assert.notEqual(
        admitted,
        readFunctionalitySourceIdentity(directory),
        `changed ${name} must affect source`,
      );
    }
    for (const ref of [
      "../outside",
      "/outside",
      "C:/outside",
      "modules\\probe.py",
      "modules/../probe.py",
    ])
      assert.throws(() => repositoryFile(directory, ref));
    writeFileSync(
      path.join(directory, "large.json"),
      " ".repeat(1024 * 1024 + 1),
    );
    assert.throws(() => readQualificationJson(directory, "large.json"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("repository crosswalk resolves every actual controlled criterion and available harness", () => {
  const root = process.cwd();
  const result = readFunctionalityQualification(root);
  assert.equal(result.owner_states.length, 4);
  assert.equal(result.controlled_criteria, 11);
  // Live owner evidence may advance from pending to failed without changing
  // coverage. This assessor cannot qualify a pass from declarative evidence.
  assert.equal(result.pending_criteria + result.failed_criteria, result.controlled_criteria);
  assert.deepEqual(
    result.criteria
      .filter((c) => c.owner === "data-management-quality-and-usability")
      .map((c) => c.criterion_id)
      .sort(),
    [
      "controlled-advanced-capabilities-are-qualified",
      "controlled-ingestion-scale-is-qualified",
      "controlled-provider-publication-is-qualified",
    ],
  );
  for (const retired of [
    "guided-usability-is-qualified",
    "quality-review-usability-is-qualified",
    "exact-task-usability-is-qualified",
    "user-task-outcome-targets",
  ]) {
    assert.ok(!result.criteria.some((c) => c.criterion_id === retired));
  }
  const accessibility = result.criteria.find((c) =>
    c.owner === "functionality-optimization" && c.criterion_id === "accessibility-outcomes-qualified");
  assert.deepEqual(accessibility.environment_requirements, ["automated-accessibility-hosts"]);
  assert.equal(result.release_readiness, "unqualified");
  assert.match(result.source_identity, /^[a-f0-9]{64}$/u);
});

test("source identity follows deletion and rename independently of Git staging", () => {
  const root = mkdtempSync(path.join(tmpdir(), "functionality-deletion-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
    mkdirSync(path.join(root, "apps"));
    writeFileSync(path.join(root, "apps/retained.ts"), "export {};\n");
    const previous = path.join(root, "apps/previous.config.js");
    writeFileSync(previous, "export default {};\n");
    execFileSync("git", ["add", "--", "apps"], { cwd: root });
    const before = readFunctionalitySourceIdentity(root);
    rmSync(previous);
    const removed = readFunctionalitySourceIdentity(root);
    assert.notEqual(removed, before);
    // Only source enumeration admits a deletion; explicit evidence must exist.
    assert.throws(() => repositoryFile(root, "apps/previous.config.js"));
    assert.throws(() => readQualificationJson(root, "apps/previous.config.js"));
    writeFileSync(path.join(root, "apps/current.config.mjs"), "export default {};\n");
    const renamed = readFunctionalitySourceIdentity(root);
    assert.notEqual(renamed, removed);
    assert.notEqual(renamed, before);
    execFileSync("git", ["add", "--all"], { cwd: root });
    assert.equal(readFunctionalitySourceIdentity(root), renamed);
    writeFileSync(previous, "export default {};\n");
    assert.notEqual(readFunctionalitySourceIdentity(root), renamed);
    rmSync(previous);
    const unsafe = path.join(root, "apps/retained.ts");
    rmSync(unsafe);
    mkdirSync(unsafe);
    assert.throws(() => readFunctionalitySourceIdentity(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source identity rejects a candidate with no remaining files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "functionality-absent-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
    mkdirSync(path.join(root, "apps"));
    const file = path.join(root, "apps/only.ts");
    writeFileSync(file, "export {};\n");
    execFileSync("git", ["add", "--", "apps"], { cwd: root });
    rmSync(file);
    assert.throws(() => readFunctionalitySourceIdentity(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
