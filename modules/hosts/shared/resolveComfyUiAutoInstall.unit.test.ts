import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import test from "node:test";
import ts from "typescript";
import { createComfyUiRuntimeSupervisor } from "../../adapters/runtime/comfyui/createComfyUiRuntimeSupervisor";
import { requireManagedComfyUiInstall, resolveComfyUiAutoInstall } from "./resolveComfyUiAutoInstall";
import { DEFAULT_COMFYUI_REPOSITORY_URL } from "../../adapters/runtime/installer/comfyui/createComfyUiRuntimeInstaller";

test("ComfyUI host startup preserves the default and explicit enabled policy", () => {
  assert.equal(resolveComfyUiAutoInstall({}), true);
  assert.equal(resolveComfyUiAutoInstall({ COMFYUI_AUTO_INSTALL: "1" }), true);
  assert.equal(resolveComfyUiAutoInstall({ COMFYUI_AUTO_INSTALL: "0" }), false);
});

test("malformed host policy denies without echoing the supplied value", () => {
  for (const value of ["", " ", " 0", "0 ", "true", "false", "2", "0\n", "private-synthetic-value"]) {
    assert.throws(() => resolveComfyUiAutoInstall({ COMFYUI_AUTO_INSTALL: value }), {
      message: "COMFYUI_AUTO_INSTALL must be 0 or 1 when configured.",
    });
  }
});

test("a composed policy is a scalar snapshot, independent of later environment changes", () => {
  const environment = { COMFYUI_AUTO_INSTALL: "0" };
  const policy = resolveComfyUiAutoInstall(environment);
  environment.COMFYUI_AUTO_INSTALL = "1";
  assert.equal(policy, false);
  assert.equal(resolveComfyUiAutoInstall(environment), true);
});

for (const [file, functionName, argument] of [
  ["modules/hosts/desktop/composition/composeDesktopComfyUiImageRuntimeFeature.ts", "composeDesktopComfyUiImageRuntimeFeature", "process.env"],
  ["modules/hosts/server/composition/composeServerHost.ts", "composeServerHost", "options.env ?? process.env"],
] as const) {
  test(`${functionName} snapshots the policy before effects and forwards it to every image supervisor`, () => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === functionName);
    assert.ok(declaration?.body);
    const first = declaration.body.statements[0];
    assert.ok(ts.isVariableStatement(first));
    const variable = first.declarationList.declarations[0];
    assert.equal(variable.name.getText(source), "comfyUiAutoInstall");
    assert.ok(variable.initializer && ts.isCallExpression(variable.initializer));
    assert.equal(variable.initializer.expression.getText(source), "resolveComfyUiAutoInstall");
    assert.equal(variable.initializer.arguments.length, 1);
    assert.equal(variable.initializer.arguments[0].getText(source), argument);
    const imports = source.statements.filter(ts.isImportDeclaration);
    assert.ok(imports.some(node => node.moduleSpecifier.getText(source) === '"../../shared/resolveComfyUiAutoInstall"' &&
      node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some(element => element.name.text === "resolveComfyUiAutoInstall" && !element.propertyName)));
    let supervisors = 0, managedChecks = 0, admissionFactories = 0, creationFactories = 0;
    let managedCheckPosition = -1, supervisorPosition = -1;
    function visit(node: ts.Node): void {
      const factory = functionName === "composeServerHost" ? "createComfyUiInstallerForMode" : "createConfiguredComfyUiInstaller";
      let owner: ts.Node | undefined = node.parent;
      while (owner && !ts.isMethodDeclaration(owner) && !ts.isArrowFunction(owner) && !ts.isFunctionDeclaration(owner)) owner = owner.parent;
      const ownsStartup = owner && (ts.isMethodDeclaration(owner) && owner.name.getText(source) === "start" ||
        ts.isArrowFunction(owner) && ts.isVariableDeclaration(owner.parent) && owner.parent.name.getText(source) === "startMode");
      if (ownsStartup && ts.isCallExpression(node) && node.expression.getText(source) === factory) {
        assert.ok(ts.isAwaitExpression(node.parent));
        const expression = node.parent.parent;
        assert.ok(ts.isBinaryExpression(expression));
        assert.equal(expression.left.getText(source), "configuredInstaller");
        if (expression.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          admissionFactories++;
          const statement = expression.parent;
          assert.ok(ts.isExpressionStatement(statement) && ts.isBlock(statement.parent));
          const condition = statement.parent.parent;
          assert.ok(ts.isIfStatement(condition));
          assert.equal(condition.expression.getText(source), "!comfyUiAutoInstall");
        } else {
          creationFactories++;
          assert.equal(expression.operatorToken.kind, ts.SyntaxKind.QuestionQuestionToken);
          assert.ok(ts.isPropertyAssignment(expression.parent));
          assert.equal(expression.parent.name.getText(source), "installer");
        }
      }
      if (ts.isCallExpression(node) && node.expression.getText(source) === "requireManagedComfyUiInstall") {
        managedChecks++;
        managedCheckPosition = node.getStart(source);
        assert.ok(ts.isAwaitExpression(node.parent));
        const statement = node.parent.parent;
        assert.ok(ts.isExpressionStatement(statement) && ts.isBlock(statement.parent));
        const condition = statement.parent.parent;
        assert.ok(ts.isIfStatement(condition));
        assert.equal(condition.expression.getText(source), "!comfyUiAutoInstall");
        // Admission is outside the supervisor-creation branch, so a later restart
        // must recheck the managed install too.
        assert.ok(ts.isBlock(condition.parent));
        const owner = condition.parent.parent;
        assert.ok(ts.isMethodDeclaration(owner) || ts.isArrowFunction(owner));
        assert.deepEqual(node.arguments.map(item => item.getText(source)), ["configuredInstaller",
          functionName === "composeServerHost" ? "comfyUiInstallRoot" : "installRoot", "installSourceRef"]);
      }
      if (ts.isCallExpression(node) && node.expression.getText(source) === "createComfyUiRuntimeSupervisor") {
        supervisors += 1;
        supervisorPosition = node.getStart(source);
        assert.equal(node.arguments.length, 1);
        const options = node.arguments[0];
        assert.ok(ts.isObjectLiteralExpression(options));
        // No spread or duplicate property can silently override the restriction.
        assert.ok(options.properties.every(property => !ts.isSpreadAssignment(property)));
        const policies = options.properties.filter(property => property.name?.getText(source) === "autoInstall");
        assert.equal(policies.length, 1);
        assert.ok(ts.isPropertyAssignment(policies[0]));
        assert.equal(policies[0].initializer.getText(source), "comfyUiAutoInstall");
      }
      ts.forEachChild(node, visit);
    }
    visit(declaration.body);
    assert.equal(supervisors, 1);
    assert.equal(managedChecks, 1);
    assert.equal(admissionFactories, 1);
    assert.equal(creationFactories, 1);
    assert.ok(managedCheckPosition < supervisorPosition);
  });
}

test("disabled host policy starts only the owned child and never invokes installation or repair", async () => {
  let installs = 0, repairs = 0, spawns = 0;
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true,
  });
  const supervisor = createComfyUiRuntimeSupervisor({
    workingDirectory: "/synthetic-owned-comfyui", installRoot: "/synthetic-owned-comfyui",
    autoInstall: resolveComfyUiAutoInstall({ COMFYUI_AUTO_INSTALL: "0" }),
    installer: {
      ensureInstalled: async () => { installs++; throw new Error("unexpected install"); },
      repairInstall: async () => { repairs++; throw new Error("unexpected repair"); },
      getInstallStatus: async () => { throw new Error("unexpected install status"); },
    },
    spawnImplementation: (() => {
      spawns++;
      queueMicrotask(() => { child.stderr.write("ModuleNotFoundError: synthetic_dependency"); child.emit("exit", 1, null); });
      return child;
    }) as never,
    fetchImplementation: (async () => { throw new Error("synthetic unavailable"); }) as never,
    healthCheckIntervalMs: 1, startupTimeoutMs: 50,
  });
  await assert.rejects(supervisor.start());
  assert.equal(installs, 0);
  assert.equal(repairs, 0);
  assert.equal(spawns, 1);
  assert.equal(supervisor.isRunning(), false);
});

function installedStatus() {
  return { targetId: "comfyui", status: "installed" as const, installRoot: "/synthetic-owned-comfyui",
    source: { type: "git" as const, repositoryUrl: DEFAULT_COMFYUI_REPOSITORY_URL, ref: "fixed-test-ref" }, requestedRef: "fixed-test-ref" };
}

test("no-install admission reads only the exact managed target, root and official source", async () => {
  const requests: unknown[] = [];
  let installs = 0, repairs = 0;
  const installer = {
    getInstallStatus: async (request: unknown) => { requests.push(request); return installedStatus(); },
    ensureInstalled: async () => { installs++; throw new Error("unexpected install"); },
    repairInstall: async () => { repairs++; throw new Error("unexpected repair"); },
  };
  await requireManagedComfyUiInstall(installer, "/synthetic-owned-comfyui", " fixed-test-ref ");
  assert.deepEqual(requests, [{ targetId: "comfyui", installRoot: "/synthetic-owned-comfyui",
    source: { type: "git", repositoryUrl: DEFAULT_COMFYUI_REPOSITORY_URL, ref: "fixed-test-ref" } }]);
  assert.equal(installs, 0);
  assert.equal(repairs, 0);
});

test("missing, unconfirmed or mismatched managed metadata denies without starting or repairing", async () => {
  const base = installedStatus();
  const variants: unknown[] = [
    ...["not-installed", "unknown", "failed", "installing", "repairing"].map(status => ({ ...base, status })),
    { ...base, targetId: "python" }, { ...base, installRoot: "/different-private-root" },
    { ...base, installRoot: undefined }, { ...base, source: undefined },
    { ...base, source: { type: "local", repositoryUrl: DEFAULT_COMFYUI_REPOSITORY_URL } },
    { ...base, source: { type: "git", repositoryUrl: "https://synthetic.invalid/private" } },
    { ...base, requestedRef: "other-ref" }, { ...base, error: { code: "private", message: "private payload" } },
    undefined, null,
  ];
  let starts = 0;
  for (const status of variants) {
    const installer = { getInstallStatus: async () => status };
    await assert.rejects(async () => {
      await requireManagedComfyUiInstall(installer as never, "/synthetic-owned-comfyui", "fixed-test-ref");
      starts++;
    }, { message: "ComfyUI automatic setup is disabled. A matching managed installation is required before startup." });
  }
  assert.equal(starts, 0);
});

test("status read failures stay fixed and do not disclose provider errors", async () => {
  for (const failure of [new Error("private path and diagnostic"), { get message() { throw new Error("must not read"); } }]) {
    await assert.rejects(requireManagedComfyUiInstall({ getInstallStatus: async () => { throw failure; } }, "/synthetic-owned-comfyui"), {
      message: "ComfyUI automatic setup is disabled. A matching managed installation is required before startup.",
    });
  }
});
