// @vitest-environment jsdom
import { describe,it,expect,vi } from 'vitest';
import { createDesktopAssetAuthoringClient } from '../api/desktopAssetAuthoringClient';

describe('desktopAssetAuthoringClient',()=>{
  it('parses preload envelopes, preserves failure codes, and sends explicit workspace ids', async()=>{
    const listAuthoredAssets=vi.fn().mockResolvedValue({status:'success',payload:{assets:[]}});
    const listAssetDrafts=vi.fn().mockResolvedValue({status:'error',error:{code:'unavailable',message:'no'}});
    const listAssetOverrides=vi.fn().mockResolvedValue({status:'error',error:{code:'conflict',message:'conflict'}});
    (window as any).desktopApi={listAuthoredAssets,listAssetDrafts,listAssetOverrides};
    const c=createDesktopAssetAuthoringClient();
    expect((await c.listAuthoredAssets('w1')).ok).toBe(true);
    const d=await c.listDrafts('w1'); const o=await c.listOverrides('w1');
    expect(d.ok === true ? '' : d.error.code).toBe('unavailable');
    expect(o.ok === true ? '' : o.error.code).toBe('conflict');
    expect(listAuthoredAssets).toHaveBeenCalledWith({workspaceId:'w1'});
    expect(listAssetDrafts).toHaveBeenCalledWith({targetWorkspaceId:'w1'});
  });
  it('sends canonical draft editable command fields', async()=>{
    const createAssetDraft=vi.fn().mockResolvedValue({status:'success',payload:{}});
    const updateAssetDraft=vi.fn().mockResolvedValue({status:'success',payload:{}});
    (window as any).desktopApi={createAssetDraft,updateAssetDraft};
    const c=createDesktopAssetAuthoringClient();
    await c.createDraft({workspaceId:'w1',displayName:'Draft Name',summary:'Summary'});
    await c.updateDraft({workspaceId:'w1',draftId:'d1',summary:'Updated'});
    expect(createAssetDraft).toHaveBeenCalledWith({targetWorkspaceId:'w1',draftEditableValues:{'display-name':'Draft Name',summary:'Summary',description:undefined}});
    expect(updateAssetDraft).toHaveBeenCalledWith({targetWorkspaceId:'w1',draftId:'d1',draftEditablePatch:{'display-name':undefined,summary:'Updated',description:undefined}});
  });
  it('maps target detail and derived customization lifecycle operations',async()=>{
    const listAssetDerivedCustomizationTargets=vi.fn().mockResolvedValue({status:'success',payload:{targets:[{displayName:'Button'}]}});
    const readAssetDerivedCustomizationTarget=vi.fn().mockResolvedValue({status:'success',payload:{displayName:'Button',backingResources:[{path:'frontend/component.tsx',content:'source'}]}});
    const createAssetDerivedCustomization=vi.fn().mockResolvedValue({status:'success',payload:{customizationId:'customization-1'}});
    (window as any).desktopApi={listAssetDerivedCustomizationTargets,readAssetDerivedCustomizationTarget,createAssetDerivedCustomization};
    const c=createDesktopAssetAuthoringClient();
    const listed=await c.listCustomizationTargets({workspaceId:'w1',text:'button'});
    const target={kind:'asset-definition-version',id:'builtin.button',version:'1.0.0'} as any;
    const detail=await c.readCustomizationTarget({workspaceId:'w1',definitionRef:target,implementationReleaseId:'implementation-release.button.1'});
    await c.createDerivedCustomization({workspaceId:'w1',baseDefinitionRef:target,baseImplementationReleaseId:'implementation-release.button.1',derivedDefinitionRef:{...target,id:'workspace.button'},semanticPatch:{'display-name':'My Button'}});
    expect(listed.ok && listed.value.items[0]?.displayName).toBe('Button');
    expect(detail.ok && detail.value.backingResources[0]?.path).toBe('frontend/component.tsx');
    expect(createAssetDerivedCustomization.mock.calls[0][0]).toMatchObject({workspaceId:'w1',baseImplementationReleaseId:'implementation-release.button.1',semanticPatch:{'display-name':'My Button'}});
  });
});
