// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import type { Page, TestInfo } from "@playwright/test";
const io = vi.hoisted(() => ({ calls: 0 }));
vi.mock("node:fs/promises", async () => {
  const original = await vi.importActual<Record<string, unknown>>("node:fs/promises");
  const guarded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(original)) guarded[key] = typeof value === "function"
    ? () => { io.calls++; throw new Error("Unexpected file operation before admission."); } : value;
  return { ...guarded, default: guarded };
});
import { qualifyIngestionSourceJourney, ingestionSourceEvidenceName } from "../visual-composer/e2e/ingestion-source-journey";
import { prepareProvidedVersions } from "../visual-composer/e2e/provided-dataset-version-journey";
import { prepareSavedRowReview } from "../visual-composer/e2e/saved-row-review-host-journey";
import { prepareSourceContext } from "../visual-composer/e2e/source-context-host-journey";
import { prepareManualContext } from "../visual-composer/e2e/manual-context-host-journey";
import { qualifyStructuredOutputControls } from "../visual-composer/e2e/structured-output-controls-journey";

type Invoke = (page: Page, info: TestInfo, host: "desktop" | "thin", mode: never) => Promise<unknown>;
const workflows: Array<{name: string; invoke: Invoke}> = [
  {name:"file import",invoke:(p,i,h,m)=>qualifyIngestionSourceJourney(p,i,h,m)},
  {name:"dataset versions",invoke:(p,i,h,m)=>prepareProvidedVersions(p,h,i,m)},
  {name:"saved row review",invoke:(p,i,h,m)=>prepareSavedRowReview(p,h,i,m)},
  {name:"source Context",invoke:(p,i,h,m)=>prepareSourceContext(p,h,i,m)},
  {name:"manual Context",invoke:(p,i,h,m)=>prepareManualContext(p,h,i,m)},
  {name:"output shapes",invoke:(p,i,h,m)=>qualifyStructuredOutputControls(p,i,h,async()=>{throw new Error("Unexpected reopen before admission.");},m)},
];
async function caught(action:()=>Promise<unknown>){try{await action();return undefined;}catch(error){return error;}}
beforeEach(()=>{io.calls=0;});
for(const workflow of workflows)describe(`${workflow.name} native admission`,()=>{
  it.each([null,{},()=>{},Symbol("unknown-mode"),"","native",4,false])("rejects unknown mode %# before metadata, Page or file effects",async mode=>{
    let pageReads=0,infoReads=0;
    const page=new Proxy({},{get(){pageReads++;throw new Error("Unexpected private Page read.");}}) as Page;
    const info=new Proxy({},{get(){infoReads++;throw new Error("Unexpected private metadata read.");}}) as TestInfo;
    const error=await caught(()=>workflow.invoke(page,info,"thin",mode as never));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Invalid critical accessibility mode.");
    expect(pageReads).toBe(0);expect(infoReads).toBe(0);expect(io.calls).toBe(0);
  });
  it.each([
    {host:"desktop",project:"thin-chrome"},{host:"thin",project:"packaged-desktop"},
    {host:"thin",project:"managed-thin-chrome"},{host:"desktop",project:"unknown"},
    {host:"unknown",project:"thin-chrome"},{host:"thin",project:undefined},{host:"desktop",project:undefined},
  ])("rejects unsupported native host/project %# before Page or files",async ({host,project})=>{
    let pageReads=0;const page=new Proxy({},{get(){pageReads++;throw new Error("Unexpected private Page read.");}}) as Page;
    const info=(project===undefined?undefined:{project:{name:project}}) as unknown as TestInfo;
    const error=await caught(()=>workflow.invoke(page,info,host as "desktop"|"thin","native400" as never));
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe("Unsupported native Data and Context host.");
    expect(pageReads).toBe(0);expect(io.calls).toBe(0);
  });
});

describe("ingestion result cohort identity",()=>{
  it("preserves both standard names and gives each native cohort a separate exclusive-create destination",()=>{
    const names=[ingestionSourceEvidenceName("desktop"),ingestionSourceEvidenceName("thin"),
      ingestionSourceEvidenceName("desktop","native400"),ingestionSourceEvidenceName("thin","native400")];
    expect(names).toEqual(["desktop.json","thin.json","desktop-native400.json","thin-native400.json"]);
    expect(new Set(names).size).toBe(4);expect(names.every(name=>/^(desktop|thin)(-native400)?\.json$/.test(name))).toBe(true);expect(io.calls).toBe(0);
  });
  it.each(["../escape","desktop/../escape","thin\\child","unknown",null,{},Symbol("host")])("rejects unsupported or path-like result host %#",host=>{
    expect(()=>ingestionSourceEvidenceName(host as never)).toThrow("Invalid ingestion evidence identity.");expect(io.calls).toBe(0);
  });
  it.each([null,{},"native",4,Symbol("mode")])("rejects unsupported result mode %#",mode=>{
    expect(()=>ingestionSourceEvidenceName("thin",mode as never)).toThrow("Invalid critical accessibility mode.");expect(io.calls).toBe(0);
  });
  it("does not coerce a result host object",()=>{
    let calls=0;const host={toString(){calls++;throw new Error("synthetic-private-host");}};
    expect(()=>ingestionSourceEvidenceName(host as never)).toThrow("Invalid ingestion evidence identity.");expect(calls).toBe(0);expect(io.calls).toBe(0);
  });
});

describe("actual owning Electron viewport wiring",()=>{
  const helper="prepareCriticalAccessibilityViewport";
  const fixtures=[
    {file:"packaged-desktop-operational-ui.e2e.spec.ts",owner:"runOperationalDesktop",mode:"mode",calls:1},
    {file:"packaged-desktop-ingestion.e2e.spec.ts",owner:"runDesktopImport",mode:"mode",calls:1},
    {file:"packaged-desktop-dataset-versions.e2e.spec.ts",owner:"runDesktopData",mode:"mode",calls:1},
    {file:"packaged-desktop-low-memory.e2e.spec.ts",owner:undefined,mode:"standard",calls:1},
    {file:"packaged-desktop-ocr.e2e.spec.ts",owner:"runDesktopOcr",mode:"mode",calls:1},
    {file:"packaged-desktop-structured-output.e2e.spec.ts",owner:"runDesktopOutputControls",mode:"mode",calls:2},
    {file:"packaged-desktop-visual-composer.e2e.spec.ts",owner:"runDesktopLifecycle",mode:"mode",calls:3},
  ] as const;
  type Fixture=typeof fixtures[number];
  const sources=new Map<string,string>();
  beforeAll(async()=>{
    const actual=await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    for(const fixture of fixtures) {
      const source=await actual.readFile(path.resolve(__dirname,"../visual-composer/e2e",fixture.file),"utf8");
      expect(Buffer.byteLength(source)).toBeLessThan(262144);sources.set(fixture.file,source);
    }
  });
  const need=(value:unknown)=>{if(!value)throw new Error("Invalid standard Desktop viewport wiring.");};
  function descendants(root:ts.Node,predicate:(node:ts.Node)=>boolean):ts.Node[] {
    const result:ts.Node[]=[];function visit(node:ts.Node){if(predicate(node))result.push(node);ts.forEachChild(node,visit);}visit(root);return result;
  }
  function parse(source:string,fixture:Fixture) {
    const file=ts.createSourceFile(fixture.file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
    const roots=fixture.owner ? descendants(file,node=>ts.isFunctionDeclaration(node)&&node.name?.text === fixture.owner) : [file];
    need(roots.length === 1);return {file,root:roots[0]!};
  }
  const isSetup=(node:ts.Node):node is ts.CallExpression=>ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text === helper;
  function requireSetup(statement:ts.Statement|undefined,pageName:string,fixture:Fixture) {
    need(statement&&ts.isExpressionStatement(statement)&&ts.isAwaitExpression(statement.expression));
    const expression=(statement as ts.ExpressionStatement).expression as ts.AwaitExpression;need(isSetup(expression.expression));
    const call=expression.expression as ts.CallExpression;need(call.arguments.length === 2&&ts.isIdentifier(call.arguments[0]!)&&(call.arguments[0] as ts.Identifier).text === pageName);
    const mode=call.arguments[1]!;need(fixture.mode === "standard" ? ts.isStringLiteral(mode)&&mode.text === "standard" : ts.isIdentifier(mode)&&mode.text === "mode");
  }
  function validate(source:string,fixture:Fixture) {
    const {file,root}=parse(source,fixture);
    need(file.statements.some(node=>ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text === "./critical-surface-accessibility"&&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings)&&node.importClause.namedBindings.elements.some(item=>item.name.text === helper&&!item.propertyName)));
    const acquired=descendants(root,node=>ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text === "page"&&!!node.initializer&&ts.isAwaitExpression(node.initializer)&&ts.isCallExpression(node.initializer.expression)&&ts.isPropertyAccessExpression(node.initializer.expression.expression)&&node.initializer.expression.expression.name.text === "firstWindow") as ts.VariableDeclaration[];
    need(acquired.length === 1);
    const statement=acquired[0]!.parent.parent;need(ts.isVariableStatement(statement)&&ts.isBlock(statement.parent));
    const block=statement.parent as ts.Block;requireSetup(block.statements[block.statements.indexOf(statement as ts.Statement)+1],"page",fixture);
    if(fixture.owner === "runDesktopLifecycle") {
      const runtime=descendants(root,node=>ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text === "runtimePage") as ts.VariableDeclaration[];need(runtime.length === 2);
      for(const captured of runtime) {
        const declaration=captured.parent.parent;need(ts.isVariableStatement(declaration)&&ts.isBlock(declaration.parent));
        const body=declaration.parent as ts.Block,index=body.statements.indexOf(declaration as ts.Statement),guard=body.statements[index+1];
        need(guard&&ts.isIfStatement(guard)&&ts.isPrefixUnaryExpression(guard.expression)&&guard.expression.operator === ts.SyntaxKind.ExclamationToken&&ts.isIdentifier(guard.expression.operand)&&guard.expression.operand.text === "runtimePage");
        requireSetup(body.statements[index+2],"runtimePage",fixture);
      }
    }
    if(fixture.owner === "runDesktopOutputControls") {
      const returned=descendants(root,node=>ts.isReturnStatement(node)&&!!node.expression&&ts.isIdentifier(node.expression)&&node.expression.text === "page") as ts.ReturnStatement[];need(returned.length === 1&&ts.isBlock(returned[0]!.parent));
      const body=returned[0]!.parent as ts.Block;requireSetup(body.statements[body.statements.indexOf(returned[0]!)-1],"page",fixture);
    }
    need(descendants(root,isSetup).length === fixture.calls);
  }
  it.each(fixtures)("prepares every owned standard Page in $file while retaining the actual mode",fixture=>{
    validate(sources.get(fixture.file)!,fixture);expect(io.calls).toBe(0);
  });
  it.each(["missing","wrong-page","wrong-mode","unawaited","late","dead-branch"] as const)("detects %s first-window wiring",mutation=>{
    const fixture=fixtures[0],source=sources.get(fixture.file)!,{root,file}=parse(source,fixture);
    const calls=descendants(root,isSetup) as ts.CallExpression[];expect(calls.length).toBe(1);
    const statement=calls[0]!.parent.parent as ts.ExpressionStatement;expect(ts.isExpressionStatement(statement)).toBe(true);
    const replacement=mutation === "missing" ? "" : mutation === "wrong-page" ? `await ${helper}(otherPage,mode);` : mutation === "wrong-mode" ? `await ${helper}(page,"standard");` : mutation === "unawaited" ? `${helper}(page,mode);` : mutation === "dead-branch" ? `if(false){${statement.getText(file)}}` : `await Promise.resolve();${statement.getText(file)}`;
    const changed=source.slice(0,statement.getStart(file))+replacement+source.slice(statement.getEnd());
    expect(()=>validate(changed,fixture)).toThrow("Invalid standard Desktop viewport wiring.");
  });
  it.each([{fixture:fixtures[5],index:1},{fixture:fixtures[6],index:1},{fixture:fixtures[6],index:2}])("detects missing reopened/runtime setup %#",({fixture,index})=>{
    const source=sources.get(fixture.file)!,{root,file}=parse(source,fixture),calls=descendants(root,isSetup) as ts.CallExpression[];
    expect(calls).toHaveLength(fixture.calls);const statement=calls[index]!.parent.parent;
    const changed=source.slice(0,statement.getStart(file))+source.slice(statement.getEnd());
    expect(()=>validate(changed,fixture)).toThrow("Invalid standard Desktop viewport wiring.");
  });
  it("uses exact feature coverage while unknown or incomplete impact retains the generic guard",()=>{
    const script=`from pathlib import Path
import copy,json,sys
from unittest.mock import patch
R=Path.cwd();sys.path.insert(0,str(R/'dev-tools/helpers'))
from control_plane import catalog
configuration=json.loads((R/'dev-tools/config/contributor-check-profiles.json').read_bytes())
profile=configuration['profiles']['operational-ui'];low='dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-low-memory.e2e.spec.ts';unit='dev-tools/scripts/qualification/tests/native-data-context-admission.unit.test.ts'
paths=json.loads(sys.argv[1]);required=['operational-ui','ocr-provider-contract','dataset-version-browser','documentation','agent-support']
selected=lambda affected:{row['id'] for row in catalog.plan(R,affected,required,'synthetic-viewport-routing')['selected']}
complete=selected(paths)
old=copy.deepcopy(configuration);position=old['profiles']['operational-ui']['source_paths'].index(low);old['profiles']['operational-ui']['source_paths'][position]=unit
previous=set(old['profiles']['operational-ui']['source_paths']+profile['test_paths']);current=set(profile['source_paths']+profile['test_paths'])
with patch.object(catalog,'read_json',return_value=old):incomplete=selected(paths)
unknown=selected(paths+['dev-tools/scripts/qualification/visual-composer/unknown-viewport-owner.ts'])
print(json.dumps({'selected':sorted(complete),'incomplete_generic':'focused-tests' in incomplete,'unknown_generic':'focused-tests' in unknown,'no_coverage_lost':previous<=current,'only_added_source':sorted(current-previous),'native_test_still_executed':unit in profile['test_paths'],'source_limit':len(profile['source_paths'])<=200,'test_limit':len(profile['test_paths'])<=100}))
`;
    const affected=[...fixtures.map(row=>"dev-tools/scripts/qualification/visual-composer/e2e/"+row.file),
      "dev-tools/scripts/qualification/visual-composer/e2e/critical-surface-accessibility.ts",
      "dev-tools/scripts/qualification/tests/critical-surface-accessibility.unit.test.ts",
      "dev-tools/scripts/qualification/tests/native-data-context-admission.unit.test.ts",
      "dev-tools/README.md","docs/diagnostics/system-builder-canvas-testing.md","dev-tools/config/contributor-check-profiles.json"];
    const environment={...process.env};
    for(const key of Object.keys(environment))if(/^(AISB_|VISUAL_COMPOSER_|NODE_|TSX_|TS_NODE_|PYTHONPATH$|PYTHONHOME$|PYTHONOPTIMIZE$)/i.test(key))delete environment[key];
    const result=spawnSync(process.env.PYTHON??"python",["-E","-s","-B","-c",script,JSON.stringify(affected)],{
      cwd:path.resolve(__dirname,"../../../.."),env:environment,encoding:"utf8",windowsHide:true,timeout:20_000,maxBuffer:65536,
    });
    expect(result.error).toBeUndefined();expect(result.status).toBe(0);expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({selected:["agent-support","dataset-version-browser","documentation","ocr-provider-contract","operational-ui"],
      incomplete_generic:true,unknown_generic:true,no_coverage_lost:true,only_added_source:["dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-low-memory.e2e.spec.ts"],native_test_still_executed:true,source_limit:true,test_limit:true});
    expect(io.calls).toBe(0);
  });
});
