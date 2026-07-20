import {
  createVisualComposerHostLaunchPlan,
  startVisualComposerHostLifecycle,
} from "./visual-composer-host-lifecycle.mjs";

export default async function visualComposerGlobalSetup() {
  const launchPlan = createVisualComposerHostLaunchPlan();
  const lifecycle = await startVisualComposerHostLifecycle({ launchPlan });
  process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID = lifecycle.runId;
  process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN =
    lifecycle.thinClientOrigin.origin;
  process.env.VISUAL_COMPOSER_SERVER_ORIGIN = lifecycle.serverOrigin.origin;
  process.env.VISUAL_COMPOSER_QUALIFICATION_ENVIRONMENT_ID = `local-${process.platform}-${process.arch}`;
  process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION =
    process.env.GITHUB_SHA?.trim() || "worktree";
  return async () => lifecycle.stop();
}
