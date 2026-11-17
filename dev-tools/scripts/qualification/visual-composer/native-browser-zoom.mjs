import assert from "node:assert/strict";
import { mkdir, mkdtemp, lstat, realpath, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

export function nativeZoomPreferences(factor) {
  assert.ok(factor === 1 || factor === 4, "Only declared native zoom factors are supported.");
  return {partition: {default_zoom_level: {x: Math.log(factor) / Math.log(1.2)}}};
}
export function assertNative400PercentZoom(value) {
  assert.ok(typeof value.dpr === "number" && Number.isFinite(value.dpr) && Math.abs(value.dpr - 4) < 1e-8);
  assert.equal(value.cssZoom, "1"); assert.equal(value.visualScale, 1);
  assert.ok(value.outerWidth >= 1400 && value.outerWidth <= 1460);
  assert.ok(value.innerWidth >= 320 && value.innerWidth <= 360);
}

/** Fresh local test profile only. This is cooperative test isolation, not hostile native tree protection. */
export async function launchOwnedNativeZoomContext(factor = 4) {
  const preferences = nativeZoomPreferences(factor); // reject before filesystem effects
  const parent = path.resolve("artifacts/qualification/visual-composer/zoom");
  await mkdir(parent, {recursive: true});
  const parentReal = await realpath(parent), parentStat = await lstat(parent);
  assert.equal(parentReal.toLowerCase(), parent.toLowerCase()); assert.equal(parentStat.isSymbolicLink(), false); assert.equal(parentStat.isDirectory(), true);
  const profile = await mkdtemp(path.join(parent, "native-"));
  let ownedStat, ownedReal, verified = false, launchAttempted = false;
  let context, browser, pid, retirementStarted = false;
  async function retire() {
    if (retirementStarted) throw new Error("Owned zoom retirement already attempted.");
    // Fence before awaiting close, including failed and concurrent retirement.
    retirementStarted = true;
    if (context) await context.close();
    if (launchAttempted) {
      assert.ok(browser && Number.isSafeInteger(pid) && pid > 0, "Native browser ownership is unproven; retain the profile.");
      assert.equal(browser.isConnected(), false);
      const deadline = Date.now() + 3000;
      let exited = false;
      while (Date.now() < deadline) {
        try {process.kill(pid, 0);} catch (error) {if (error.code === "ESRCH") {exited = true; break;} throw error;}
        await new Promise(done => setTimeout(done, 25));
      }
      assert.ok(exited, "Native browser exit is unproven; retain the profile.");
    }
    const currentParent = await lstat(parent), current = await lstat(profile);
    assert.equal(await realpath(parent), parentReal); assert.equal(currentParent.isSymbolicLink(), false); assert.equal(currentParent.isDirectory(), true);
    assert.equal(currentParent.dev, parentStat.dev); assert.equal(currentParent.ino, parentStat.ino);
    assert.equal(await realpath(profile), ownedReal); assert.equal(current.isSymbolicLink(), false); assert.equal(current.isDirectory(), true);
    assert.equal(current.dev, ownedStat.dev); assert.equal(current.ino, ownedStat.ino);
    const target = path.resolve(profile); assert.ok(target.startsWith(path.resolve(parent) + path.sep));
    await rm(target, {recursive: true, force: false});
    return {nativeExitObserved: launchAttempted, profileRemoved: true};
  }
  try {
    ownedStat = await lstat(profile); ownedReal = await realpath(profile);
    assert.equal(ownedStat.isSymbolicLink(), false); assert.equal(ownedStat.isDirectory(), true);
    assert.ok(ownedReal.toLowerCase().startsWith(parentReal.toLowerCase() + path.sep));
    verified = true;
    await mkdir(path.join(profile, "Default"));
    await writeFile(path.join(profile, "Default", "Preferences"), JSON.stringify(preferences), {flag: "wx", mode: 0o600});
    // A rejected launch can still have created a process. Never infer its absence.
    launchAttempted = true;
    // No caller-supplied flags, paths, extensions, persistent profile or credentials.
    context = await chromium.launchPersistentContext(profile, {channel: "chrome", headless: true, viewport: null, deviceScaleFactor: undefined, args: ["--window-size=1440,1000"]});
    browser = context.browser(); assert.ok(browser);
    const session = await browser.newBrowserCDPSession();
    let queryFailed = false, queryFailure;
    try {
      const processes = await session.send("SystemInfo.getProcessInfo");
      const owners = processes.processInfo.filter(process => process.type === "browser");
      assert.equal(owners.length, 1); pid = owners[0].id; assert.ok(Number.isSafeInteger(pid) && pid > 0);
    } catch (error) {queryFailed = true; queryFailure = error; throw error;}
    finally {
      try {await session.detach();}
      catch (error) {throw queryFailed ? new AggregateError([queryFailure, error], "Zoom inspection and session retirement failed.") : error;}
    }
    return {context, close: retire};
  } catch (error) {
    if (verified) {
      try {await retire();}
      catch (cleanup) {throw new AggregateError([error, cleanup], "Zoom setup failed; retirement is incomplete.");}
    }
    throw error;
  }
}
