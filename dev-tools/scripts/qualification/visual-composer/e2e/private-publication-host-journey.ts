import {expect,type Page,type TestInfo} from "@playwright/test";
import {functionalHostIdentity} from "../functional-host-oracles";
import {ARTIFACT_SAMPLE_NAME} from "../functional-artifact-oracles";
import {FUNCTIONAL_PROVIDER_REPOSITORY,providerFixtureIdentity,providerPublicationPath} from "../functional-provider-plan.mjs";
import {beginProviderFixtureAdmission,openExecutingProviderFixture,type ExecutingProviderFixture} from "../functional-private-provider-fixture";
import {capturePrivatePublicationWitness,captureProviderBacking,captureProviderBytes,providerHostPhases} from "../functional-provider-oracles";
import {prepareIsolatedDesktopCase} from "./isolated-desktop-case";
import {readArtifactHostState} from "./artifact-host-browser-reads";
import {providerArtifactUi,publishProviderHostEvidence} from "./provider-source-host-journey";

/** No credential or network access unless this precise executing case is admitted. */
export async function prepareProviderDesktopCase(purpose:"provider-source"|"provider-publication"){
  const requested=purpose==="provider-source"?process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_SOURCE:process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_PUBLICATION;
  if(process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST!=="1"||process.env.VISUAL_COMPOSER_FUNCTIONAL_READY!=="1"||requested!=="1")throw new Error("The private provider case is not admitted.");
  const identity=providerFixtureIdentity(process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID,process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,"packaged-desktop",purpose),reference=process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG;
  if(typeof reference!=="string")throw new Error("The explicit private provider fixture is unavailable.");
  const admission=beginProviderFixtureAdmission(process.cwd(),identity),capsule=openExecutingProviderFixture({repoRoot:process.cwd(),manifestRef:reference,identity,executing:true});
  await capsule.observePrivateRepository();
  const isolated=prepareIsolatedDesktopCase(purpose==="provider-source"?"functional-provider-source":"functional-provider-publication"),credential=capsule.seedCredential(admission);
  return{isolated,capsule,credential};
}

export async function qualifyPrivatePublicationHostJourney(page:Page,info:TestInfo,capsule:ExecutingProviderFixture){
  const host="packaged-desktop" as const,run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID,source=process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  functionalHostIdentity(run,source,host);if(info.project.name!==host||capsule.identity.runId!==run||capsule.identity.sourceRevision!==source||capsule.identity.purpose!=="provider-publication"||capsule.identity.host!==host)throw new Error("The private publication case is misbound.");
  const ui=providerArtifactUi(page,host),phases:string[]=[],expected=providerHostPhases(host,"provider-publication",false);let workspace="",key="",failed=false,failure:unknown,witness:ReturnType<typeof capturePrivatePublicationWitness>|undefined;
  async function step(name:string,action:()=>Promise<void>){if(expected[phases.length]!==name)throw new Error("Unexpected private publication phase.");await action();phases.push(name);}
  async function localBacking(){captureProviderBacking(await readArtifactHostState(page,{host,workspaceId:workspace,key,mode:"backing"}),workspace,key,{publicationRun:capsule.identity.runId},true);}
  async function localBytes(){captureProviderBytes(await readArtifactHostState(page,{host,workspaceId:workspace,key,mode:"bytes"}),workspace,key,"local-inventory");}
  try{
    await step("owned-local-file-imported",async()=>{workspace=await ui.workspace("Private publication fixture");key=await ui.uploadInventory(workspace);await ui.open(workspace,key,ARTIFACT_SAMPLE_NAME);});
    await step("local-bytes-confirmed",localBytes);
    await step("private-target-admitted",async()=>{await capsule.admitPublicationPath();});
    await step("actual-publication-confirmed",async()=>{
      await ui.detail().getByRole("button",{name:"Publish to Hugging Face",exact:true}).click();await ui.detail().getByRole("textbox",{name:/^Dataset repository name\b/}).fill(FUNCTIONAL_PROVIDER_REPOSITORY);
      const prefix=providerPublicationPath(capsule.identity.runId).split("/").slice(0,-1).join("/");await ui.detail().getByRole("textbox",{name:/^Path prefix\b/}).fill(prefix);await ui.detail().getByRole("textbox",{name:/^Revision\b/}).fill("main");
      const creation=ui.detail().getByRole("checkbox",{name:"Create the repository if it does not exist",exact:true});await creation.uncheck();await expect(creation).not.toBeChecked();await expect(ui.detail().getByRole("combobox",{name:"New repository visibility",exact:true})).toHaveCount(0);
      await ui.detail().getByRole("button",{name:"Publish",exact:true}).click();await expect(ui.detail().getByRole("heading",{name:"Published Backing",exact:true})).toBeVisible({timeout:90_000});
    });
    await step("local-branch-confirmed",async()=>{await localBacking();await localBytes();});
    await step("remote-commit-bytes-confirmed",async()=>{witness=capturePrivatePublicationWitness(await capsule.observePublishedObject());});
    await step("reload-keeps-published-backing",async()=>{await ui.reload(workspace);await ui.open(workspace,key,ARTIFACT_SAMPLE_NAME);await expect(ui.detail().getByRole("heading",{name:"Published Backing",exact:true})).toBeVisible();await localBacking();await localBytes();});
  }catch(error){failed=true;failure=error;}
  return publishProviderHostEvidence(info,host,"provider-publication",false,phases,failed,failure,witness);
}
