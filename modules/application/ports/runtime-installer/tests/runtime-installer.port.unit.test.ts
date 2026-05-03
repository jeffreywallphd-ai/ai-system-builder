import { describe, expectTypeOf, it } from "../../../../testing/node-test";

import type {
  RuntimeInstallRequest,
  RuntimeInstallResult,
  RuntimeInstallStatusRequest,
  RuntimeInstallStatusResult,
} from "../../../../contracts/runtime-installer";
import type { RuntimeInstallerPort } from "..";

describe("RuntimeInstallerPort", () => {
  it("exposes generic install status and ensure-install operations", () => {
    expectTypeOf<keyof RuntimeInstallerPort>().toEqualTypeOf<
      "getInstallStatus" | "ensureInstalled" | "repairInstall"
    >();

    expectTypeOf<Parameters<RuntimeInstallerPort["getInstallStatus"]>[0]>().toEqualTypeOf<RuntimeInstallStatusRequest>();
    expectTypeOf<Awaited<ReturnType<RuntimeInstallerPort["getInstallStatus"]>>>().toEqualTypeOf<RuntimeInstallStatusResult>();

    expectTypeOf<Parameters<RuntimeInstallerPort["ensureInstalled"]>[0]>().toExtend<RuntimeInstallRequest>();
    expectTypeOf<Awaited<ReturnType<RuntimeInstallerPort["ensureInstalled"]>>>().toEqualTypeOf<RuntimeInstallResult>();

    expectTypeOf<Parameters<NonNullable<RuntimeInstallerPort["repairInstall"]>>[0]>().toExtend<RuntimeInstallRequest>();
    expectTypeOf<Awaited<ReturnType<NonNullable<RuntimeInstallerPort["repairInstall"]>>>>().toEqualTypeOf<RuntimeInstallResult>();
  });
});
