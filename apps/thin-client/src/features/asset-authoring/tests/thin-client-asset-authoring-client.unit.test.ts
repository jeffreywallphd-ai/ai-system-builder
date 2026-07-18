// @vitest-environment jsdom
import { describe,it,expect,vi } from 'vitest';
import { createThinClientAssetAuthoringClient } from '../api/thinClientAssetAuthoringClient';
const resp=(b:unknown)=>({status:200,json:vi.fn().mockResolvedValue(b)});

describe('thinClientAssetAuthoringClient',()=>{
  it('calls workspace routes and keeps route/body aligned',async()=>{
    const f=vi.fn()
      .mockResolvedValueOnce(resp({ok:true,value:{drafts:[]}}))
      .mockResolvedValueOnce(resp({ok:true,value:{}}));
    (globalThis as any).fetch=f;
    const c=createThinClientAssetAuthoringClient('/api');
    const result=await c.listDrafts('w1');
    await c.updateDraft({workspaceId:'w1',draftId:'d1',displayName:'N',summary:'S'});
    expect(result.ok).toBe(true);
    expect(String(f.mock.calls[0][0])).toContain('/asset-authoring/workspaces/w1/drafts');
    expect(String(f.mock.calls[1][0])).toContain('/asset-authoring/workspaces/w1/drafts/d1');
    expect(JSON.parse(String(f.mock.calls[1][1].body)).draftEditablePatch['display-name']).toBe('N');
  });
  it('uses exact customization target and lifecycle routes',async()=>{
    const f=vi.fn().mockResolvedValueOnce(resp({ok:true,value:{targets:[]}})).mockResolvedValueOnce(resp({ok:true,value:{displayName:'Button',backingResources:[]}})).mockResolvedValueOnce(resp({ok:true,value:{customizationId:'customization-1'}}));
    (globalThis as any).fetch=f;
    const c=createThinClientAssetAuthoringClient('/api');
    await c.listCustomizationTargets({workspaceId:'w1',text:'button'});
    const target={kind:'asset-definition-version',id:'builtin.button',version:'1.0.0'} as any;
    await c.readCustomizationTarget({workspaceId:'w1',definitionRef:target,implementationReleaseId:'implementation-release.button.1'});
    await c.createDerivedCustomization({workspaceId:'w1',baseDefinitionRef:target,baseImplementationReleaseId:'implementation-release.button.1',derivedDefinitionRef:{...target,id:'workspace.button'},semanticPatch:{}});
    expect(String(f.mock.calls[0][0])).toContain('/customization-targets?text=button');
    expect(String(f.mock.calls[1][0])).toContain('/customization-targets/implementation-release.button.1?definitionId=builtin.button&definitionVersion=1.0.0');
    expect(String(f.mock.calls[2][0])).toContain('/derived-customizations');
  });
});
