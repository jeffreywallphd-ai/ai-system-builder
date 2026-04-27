import {
  normalizeWebsiteHtmlAcquisitionRequest,
  normalizeWebsiteHtmlAcquisitionResult,
  type WebsiteHtmlAcquisitionRequest,
  type WebsiteHtmlAcquisitionResult,
} from "../../../contracts/ingestion";
import type {
  WebsiteHtmlAcquisitionPipeline,
  WebsiteHtmlAcquisitionStrategy,
} from "../../ports/ingestion/website-html-acquisition.pipeline";
import type { ApplicationRequestContext } from "../../ports/application-request-context";

export function isHtmlContentInsufficient(html: string): boolean {
  const normalized = html.trim();
  if (normalized.length === 0) {
    return true;
  }

  const lower = normalized.toLowerCase();
  const bodyMatch = lower.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, " ").trim() : "";

  if (bodyContent.length === 0) {
    return true;
  }

  const elementCount = (normalized.match(/<[^/!][^>]*>/g) ?? []).length;
  if (elementCount < 4) {
    return true;
  }

  const meaningfulNodeCount =
    (lower.match(/<(article|main|section|p|h1|h2|h3|li|table|pre|code|blockquote)\b/g) ?? []).length;

  return meaningfulNodeCount === 0;
}

export interface DefaultWebsiteHtmlAcquisitionPipelineDependencies {
  simple: WebsiteHtmlAcquisitionStrategy;
  advanced: WebsiteHtmlAcquisitionStrategy;
}

export class DefaultWebsiteHtmlAcquisitionPipeline implements WebsiteHtmlAcquisitionPipeline {
  private readonly simple: WebsiteHtmlAcquisitionStrategy;
  private readonly advanced: WebsiteHtmlAcquisitionStrategy;

  public constructor(dependencies: DefaultWebsiteHtmlAcquisitionPipelineDependencies) {
    this.simple = dependencies.simple;
    this.advanced = dependencies.advanced;
  }

  public async acquireWebsiteHtml(
    request: WebsiteHtmlAcquisitionRequest,
    context?: ApplicationRequestContext,
  ): Promise<WebsiteHtmlAcquisitionResult> {
    const normalizedRequest = normalizeWebsiteHtmlAcquisitionRequest(request);

    const simpleResult = normalizeWebsiteHtmlAcquisitionResult(
      await this.simple.acquireWebsiteHtml(normalizedRequest, context),
    );

    if (normalizedRequest.mode === "rendered" || isHtmlContentInsufficient(simpleResult.html)) {
      const advancedResult = normalizeWebsiteHtmlAcquisitionResult(
        await this.advanced.acquireWebsiteHtml(normalizedRequest, context),
      );

      return advancedResult;
    }

    return simpleResult;
  }
}
