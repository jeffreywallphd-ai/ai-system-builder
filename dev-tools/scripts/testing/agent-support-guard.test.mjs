import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findAgentSupportFailures,
  scenarioMatchesPack,
} from "../agent-support/check-agent-support.mjs";

const createFixtureRoot = async () =>
  mkdtemp(path.join(tmpdir(), "agent-support-guard-"));
const roadmapSkillRoot = path.resolve(
  "skills",
  "manage-implementation-roadmaps",
);
const python =
  process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");

const filesUnder = async (directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name.endsWith(".pyc")) {
      continue;
    }
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesUnder(candidate)));
    } else if (entry.isFile()) {
      files.push(candidate);
    }
  }
  return files;
};
const writeFixture = async (root, relativePath, contents = "fixture\n") => {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
};

const buildInputs = () => ({
  catalog: {
    schemaVersion: 1,
    baselinePack: "docs/context/packs/index.pack.md",
    defaultAdditionalPackLimit: 2,
    packs: [
      {
        id: "testing",
        path: "docs/context/packs/testing.pack.md",
        description: "Testing",
        taskSignals: ["test"],
        pathSignals: ["tests/"],
        verification: ["npm test"],
      },
    ],
  },
  evaluationSuite: {
    schemaVersion: 1,
    scenarios: [
      {
        id: "test-change",
        task: "Add a focused test.",
        affectedPaths: ["tests/example.test.ts"],
        expectedPacks: ["testing"],
        forbiddenPacks: [],
        requiredSources: ["docs/source.md"],
        requiredChecks: ["npm test"],
        decisionExpectation: "proceed",
        acceptanceSignals: ["The test proves the behavior."],
      },
    ],
  },
  packageJson: { scripts: { test: "node test.mjs" } },
});

test("agent support matching uses task and affected-path signals", () => {
  const inputs = buildInputs();
  assert.equal(
    scenarioMatchesPack(
      inputs.evaluationSuite.scenarios[0],
      inputs.catalog.packs[0],
    ),
    true,
  );
});

test("agent support guard accepts a complete minimal catalog and scenario suite", async () => {
  const root = await createFixtureRoot();
  await writeFixture(root, "docs/context/packs/index.pack.md");
  await writeFixture(root, "docs/context/packs/testing.pack.md");
  await writeFixture(root, "docs/source.md");

  assert.deepEqual(
    findAgentSupportFailures({ repoRoot: root, ...buildInputs() }),
    [],
  );
});

test("agent support guard rejects unknown and over-budget pack expectations", async () => {
  const root = await createFixtureRoot();
  await writeFixture(root, "docs/context/packs/index.pack.md");
  await writeFixture(root, "docs/context/packs/testing.pack.md");
  await writeFixture(root, "docs/source.md");
  const inputs = buildInputs();
  inputs.evaluationSuite.scenarios[0].expectedPacks = [
    "testing",
    "missing",
    "extra",
  ];

  const failures = findAgentSupportFailures({ repoRoot: root, ...inputs });

  assert.ok(
    failures.some((failure) => failure.includes("expectedPacks must contain")),
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes("unknown expected pack 'missing'"),
    ),
  );
});

test("roadmap skill supports exact and natural-language routing", async () => {
  const [skill, agents, docs] = await Promise.all([
    readFile(path.join(roadmapSkillRoot, "SKILL.md"), "utf8"),
    readFile("AGENTS.md", "utf8"),
    readFile("docs/README.md", "utf8"),
  ]);
  assert.match(skill, /^name: manage-implementation-roadmaps$/m);
  assert.match(skill, /requests a skill for roadmap work without naming one/);
  assert.match(
    skill,
    /implement, continue, review, or resume roadmap increments/,
  );
  assert.match(skill, /explicit user approval/);
  assert.match(skill, /clickable report link/);
  for (const source of [agents, docs]) {
    assert.match(source, /skills\/manage-implementation-roadmaps\/SKILL\.md/);
    assert.match(
      source,
      /(?:without|does not need)\s+(?:the|an)\s+exact skill name/i,
    );
    assert.match(source, /implementation roadmap/i);
  }
});

test("roadmap test guidance keeps aggregate suites at the overall completion boundary", async () => {
  const sources = await Promise.all([
    readFile(path.join(roadmapSkillRoot, "SKILL.md"), "utf8"),
    readFile(path.join(roadmapSkillRoot, "references", "workflow.md"), "utf8"),
    readFile(
      path.join(roadmapSkillRoot, "references", "installation.md"),
      "utf8",
    ),
    readFile(path.join(roadmapSkillRoot, "agents", "openai.yaml"), "utf8"),
    readFile("docs/diagnostics/implementation-roadmap-skill.md", "utf8"),
    readFile("AGENTS.md", "utf8"),
  ]);
  for (const source of sources) {
    assert.match(source, /standard[\s\S]{0,80}end-to-end/i);
    assert.match(source, /AI-related/i);
    assert.match(
      source,
      /after\s+(?:all|every)(?: roadmap)? increments?\s+(?:are|is)\s+implemented/i,
    );
  }
  assert.match(sources[0], /only the completion tests and gates relevant/);
});

test("root scripts expose standard, end-to-end, AI, and aggregate test commands", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(packageJson.scripts.test, /test:standard/);
  assert.match(packageJson.scripts["test:e2e"], /--suite=e2e/);
  assert.match(packageJson.scripts["test:ai"], /--suite=ai/);
  assert.match(
    packageJson.scripts["test:standardande2e"],
    /--suite=standardande2e/,
  );
  assert.match(packageJson.scripts["test:all"], /--suite=all/);
});

test("security-by-design guidance and roadmap evidence stay synchronized", async () => {
  const [
    standard,
    agents,
    docs,
    baseline,
    routing,
    securityPack,
    securityDecision,
    skill,
    workflow,
    events,
    diagnostics,
  ] = await Promise.all([
    readFile("docs/standards/security-by-design-standards.md", "utf8"),
    readFile("AGENTS.md", "utf8"),
    readFile("docs/README.md", "utf8"),
    readFile("docs/context/packs/index.pack.md", "utf8"),
    readFile("docs/context/prompt-routing.md", "utf8"),
    readFile("docs/context/packs/security.pack.md", "utf8"),
    readFile(
      "docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md",
      "utf8",
    ),
    readFile(path.join(roadmapSkillRoot, "SKILL.md"), "utf8"),
    readFile(path.join(roadmapSkillRoot, "references", "workflow.md"), "utf8"),
    readFile(path.join(roadmapSkillRoot, "references", "events.md"), "utf8"),
    readFile("docs/diagnostics/implementation-roadmap-skill.md", "utf8"),
  ]);

  assert.match(standard, /Mandatory Security Impact Screen/);
  assert.match(standard, /Proportional Threat Review/);
  assert.match(standard, /not-security-relevant/);
  assert.match(standard, /security-relevant/);
  assert.match(standard, /npm run security:dependencies/);
  for (const source of [
    agents,
    docs,
    baseline,
    routing,
    securityDecision,
    skill,
  ]) {
    assert.match(source, /docs\/standards\/security-by-design-standards\.md/);
  }
  assert.match(securityPack, /security impact screen/i);
  assert.match(skill, /security-impact-reviewed/);
  assert.match(workflow, /Security cannot be excluded as a whole/);
  assert.match(events, /Security evidence convention/);
  assert.match(diagnostics, /per-increment security/i);
});

test("roadmap skill is portable and does not provide a command executor", async () => {
  const forbiddenLocalFragments = [
    ["C:", "\\Users\\"].join(""),
    ["GitHub", "Projects"].join(""),
    ["jef", "fr"].join(""),
  ];
  for (const file of await filesUnder(roadmapSkillRoot)) {
    const source = await readFile(file, "utf8");
    for (const fragment of forbiddenLocalFragments) {
      assert.equal(
        source.toLowerCase().includes(fragment.toLowerCase()),
        false,
        `${path.relative(roadmapSkillRoot, file)} contains ${fragment}`,
      );
    }
  }
  const engine = await readFile(
    path.join(roadmapSkillRoot, "scripts", "roadmap.py"),
    "utf8",
  );
  assert.doesNotMatch(engine, /\bsubprocess\b|\bos\.system\b|\bshell=True\b/);
});

test("roadmap state engine passes its Python regression suite", () => {
  const result = spawnSync(
    python,
    [
      "-m",
      "unittest",
      "discover",
      "-s",
      path.join(roadmapSkillRoot, "tests"),
      "-p",
      "test_*.py",
      "-v",
    ],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
    },
  );
  assert.equal(
    result.status,
    0,
    `Python skill tests failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
