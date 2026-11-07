import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {JSDOM, VirtualConsole} from "jsdom";

const sheetPath="modules/ui/shared/styles/forced-colors.css";
const read=name=>fs.readFileSync(path.resolve(name),"utf8").replace(/\r\n/g,"\n");
function fixture() {
  const console=new VirtualConsole();console.on("jsdomError",error=>{throw error;});
  const dom=new JSDOM("<!doctype html><html><head></head><body></body></html>",{virtualConsole:console});
  const style=dom.window.document.createElement("style");style.textContent=read(sheetPath);dom.window.document.head.append(style);
  const roots=[...style.sheet.cssRules].filter(row=>row.type!==8);
  assert.equal(roots.length,1);assert.equal(roots[0].conditionText,"(forced-colors: active)");
  const rules=[...roots[0].cssRules];assert(rules.every(rule=>rule.type===1));
  return {dom,rules,document:dom.window.document,close:()=>dom.window.close()};
}
const value=(rule,property)=>rule.style.getPropertyValue(property).trim();
const matches=(rules,node)=>rules.filter(rule=>{
  // Pseudo-elements have no Element.matches target. Keep a closed inventory;
  // never catch and suppress an unsupported ordinary selector.
  const pseudo=[...rule.selectorText.matchAll(/::([a-z-]+)/g)];
  if(pseudo.length) {
    for(const entry of pseudo)assert(["before","after","placeholder","selection","file-selector-button"].includes(entry[1]));
    return false;
  }
  return node.matches(rule.selectorText);
});
function element(document,markup) {const holder=document.createElement("div");holder.innerHTML=markup;document.body.append(holder);return holder.firstElementChild;}

test("high-contrast overrides cannot change ordinary layout, hide content, opt out of system colors or load external inputs",()=>{
  const f=fixture();try {
    const allowed=new Set(["background","color","border","border-color","box-shadow","appearance","accent-color","content","opacity","outline","outline-offset","outline-color"]);
    for(const rule of f.rules)for(const property of Array.from(rule.style)) {
      const declaration=value(rule,property);
      assert(property.startsWith("--color-")||allowed.has(property),`Unexpected theme property ${property}`);
      assert(!/url\s*\(|expression\s*\(|!important/i.test(declaration));
      assert.equal(rule.style.getPropertyPriority(property),"");
      if(property==="opacity")assert.equal(declaration,"1");
      if(property==="content") {
        assert.equal(declaration,"none");
        assert.match(rule.selectorText,/input\[type="checkbox"\]/);assert.match(rule.selectorText,/input\[type="radio"\]/);
        assert(!/workflow|notification|^\s*\*/.test(rule.selectorText));
      }
    }
    assert(!/forced-color-adjust\s*:/.test(read(sheetPath)));
  } finally {f.close();}
});

test("both hosts load the forced palette after their local styles; startup keeps it after shared controls",()=>{
  for(const [name,reference]of[
    ["apps/desktop/src/renderer/styles/app.css","../../../../../modules/ui/shared/styles/forced-colors.css"],
    ["apps/thin-client/src/styles/app.css","../../../../modules/ui/shared/styles/forced-colors.css"],
    ["apps/desktop/src/renderer/styles/startup.css","../../../../../modules/ui/shared/styles/forced-colors.css"],
  ]) {
    const text=read(name),imports=[...text.matchAll(/@import\s+"([^"]+)"\s*;/g)];
    assert.equal(imports.filter(row=>row[1]===reference).length,1);assert.equal(imports.at(-1)[1],reference);
    assert.equal(path.resolve(path.dirname(name),reference),path.resolve(sheetPath));
    assert(!text.slice(imports.at(-1).index+imports.at(-1)[0].length).includes("@import"));
  }
  assert(!read("modules/ui/shared/styles/application.css").includes("forced-colors.css"));
});

test("selected real control states receive a complete pair while native and ARIA disabled states cannot inherit selection",()=>{
  const f=fixture();try {
    // These selectors model emitted product states. This is a selector contract,
    // not a browser cascade, native painting or real-host accessibility pass.
    const fixtures=[
      '<button class="ui-button" aria-pressed="true">Selected</button>',
      '<button class="ui-button" aria-current="page">Current</button>',
      '<button class="context-studio__mode-card context-studio__mode-card--selected"><span>Mode</span></button>',
      '<button class="ui-shell__sidebar-item" aria-current="page">Data</button>',
      '<button class="ui-tabbed-panel__tab ui-tabbed-panel__tab--active" role="tab" aria-selected="true">One</button>',
      '<div class="asset-library-tabs"><button role="tab" aria-selected="true">One</button></div>',
      '<div class="system-composer__modes"><button role="tab" aria-selected="true">One</button></div>',
      '<div class="system-composer-inspector__tabs"><button role="tab" aria-selected="true">One</button></div>',
      '<div class="system-composer__tree"><button role="treeitem" aria-selected="true">One</button></div>',
      '<div class="system-composition-preview__surface"><button aria-current="page">One</button></div>',
    ];
    const selected=f.rules.filter(rule=>value(rule,"background")==="Highlight"&&value(rule,"color")==="HighlightText");
    assert(selected.length>0);
    for(const markup of fixtures) {
      const host=element(f.document,markup),button=host.matches("button")?host:host.querySelector("button");
      assert(matches(selected,button).length>0,markup);
      for(const state of ["disabled","aria-disabled"]) {
        button.setAttribute(state,state==="disabled"?"":"true");
        assert.equal(matches(selected,button).length,0,`${state}: ${markup}`);
        assert(matches(f.rules,button).some(rule=>value(rule,"color")==="GrayText"&&value(rule,"background")==="ButtonFace"));
        button.removeAttribute(state);
      }
      host.remove();
    }
  } finally {f.close();}
});

test("native choices retain every checked, disabled and indeterminate state without deleting unrelated pseudo-element content",()=>{
  const f=fixture();try {
    for(const type of ["checkbox","radio"])for(const checked of [false,true])for(const disabled of [false,true]) {
      const input=element(f.document,`<input type="${type}">`);input.checked=checked;input.disabled=disabled;
      if(type==="checkbox")input.indeterminate=true;
      const matched=matches(f.rules,input);
      assert(matched.some(rule=>value(rule,"appearance")==="auto"&&value(rule,"accent-color")==="auto"));
      if(disabled)assert(matched.some(rule=>value(rule,"color")==="GrayText"&&value(rule,"background")==="Field"));
      assert.equal(input.checked,checked);assert.equal(input.disabled,disabled);if(type==="checkbox")assert.equal(input.indeterminate,true);
      input.remove();
    }
    assert(!f.rules.some(rule=>rule.selectorText.includes("workflow")&&value(rule,"content")));
  } finally {f.close();}
});

test("status, menu, notification and metric selectors refer to actual emitted reading surfaces",()=>{
  const f=fixture();try {
    for(const markup of [
      '<p class="ui-status ui-status--error" role="alert">Error</p>',
      '<p class="ui-feedback ui-feedback--error" role="alert">Image generation failed</p>',
      '<p class="ui-status ui-status--success">Saved</p>',
      '<div class="ui-shell__menu-panel">Menu</div>',
      '<div class="page-dashboard__metric">Count</div>',
      ...["panel","panel-header","item","toast"].map(part=>`<div class="ui-notification__${part}">Notice</div>`),
    ]) {
      const node=element(f.document,markup);assert(matches(f.rules,node).some(rule=>value(rule,"color")==="CanvasText"&&value(rule,"background")==="Canvas"),markup);node.remove();
    }
    const node=element(f.document,'<span class="ui-notification__badge">2</span>');
    assert(matches(f.rules,node).some(rule=>value(rule,"background")==="CanvasText"&&value(rule,"color")==="Canvas"));
  } finally {f.close();}
});

test("expanded workflow cards and their counters keep the system pair without changing numbered content",()=>{
  const f=fixture();try {
    const step=element(f.document,'<section class="ui-workflow__step" data-active="true"><button class="ui-panel__toggle" aria-expanded="true">Details</button></section>');
    const cards=matches(f.rules,step).filter(rule=>value(rule,"background")==="Canvas"&&value(rule,"color")==="CanvasText");
    assert(cards.some(rule=>rule.selectorText.includes(':has(.ui-panel__toggle[aria-expanded="true"])')&&value(rule,"border-color")==="CanvasText"&&value(rule,"box-shadow")==="none"));
    const counters=f.rules.filter(rule=>rule.selectorText.includes("::before")&&rule.selectorText.includes("ui-workflow__step"));
    assert(counters.some(rule=>rule.selectorText.includes(':has(.ui-panel__toggle[aria-expanded="true"])')&&value(rule,"background")==="Canvas"&&value(rule,"color")==="CanvasText"&&value(rule,"box-shadow")==="none"));
    for(const rule of counters)for(const property of ["content","counter-increment","counter-reset","z-index"])assert.equal(value(rule,property),"");
  } finally {f.close();}
});

test("focused selected tabs keep an inset ring that follows their own foreground",()=>{
  const f=fixture();try {
    for(const markup of [
      '<button class="ui-tabbed-panel__tab ui-tabbed-panel__tab--active" role="tab" aria-selected="true">One</button>',
      '<div class="asset-library-tabs"><button role="tab" aria-selected="true">One</button></div>',
      '<div class="system-composer__modes"><button role="tab" aria-selected="true">One</button></div>',
      '<div class="system-composer-inspector__tabs"><button role="tab" aria-selected="true">One</button></div>',
    ]) {
      const host=element(f.document,markup),tab=host.matches("button")?host:host.querySelector("button");tab.focus();
      assert.equal(f.document.activeElement,tab);
      assert(matches(f.rules,tab).some(rule=>value(rule,"outline-offset")==="-2px"&&value(rule,"outline-color")==="currentColor"));
      assert.equal(tab.getAttribute("aria-selected"),"true");host.remove();
    }
  } finally {f.close();}
});

test("ARIA-disabled current buttons declare a complete override for their authored hover state",()=>{
  const f=fixture();try {
    const button=element(f.document,'<button class="ui-button" aria-current="page" aria-disabled="true">Current</button>');
    assert(matches(f.rules,button).some(rule=>rule.selectorText.includes('[aria-disabled="true"][aria-current="page"]')&&
      value(rule,"background")==="ButtonFace"&&value(rule,"color")==="GrayText"&&value(rule,"border-color")==="GrayText"));
  } finally {f.close();}
});

test("active tab indicators follow the final parent foreground, including disabled states",()=>{
  const f=fixture();try {
    const indicators=f.rules.filter(rule=>rule.selectorText.includes("::after")&&rule.selectorText.includes("aria-selected"));
    assert(indicators.length>0);
    for(const rule of indicators)assert.equal(value(rule,"background"),"currentColor");
  } finally {f.close();}
});
