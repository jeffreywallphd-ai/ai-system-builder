import type { WebsiteHtmlAcquisitionPort } from "../../application/ports/ingestion";
import type { WebsiteHtmlAcquisitionPipeline, WebsiteHtmlAcquisitionStrategy } from "../../application/ports/ingestion";
import { DefaultWebsiteHtmlAcquisitionPipeline } from "../../application/services/ingestion";

import {
  PlaywrightWebsiteHtmlAcquisitionAdapter,
  type PlaywrightWebsiteHtmlAcquisitionAdapterDependencies,
} from "./playwright/PlaywrightWebsiteHtmlAcquisitionAdapter";
import {
  SimpleHttpWebsiteHtmlAcquisitionAdapter,
  type SimpleHttpWebsiteHtmlAcquisitionAdapterDependencies,
} from "./simple-http/SimpleHttpWebsiteHtmlAcquisitionAdapter";

export interface CreateWebsiteHtmlAcquisitionPortOptions {
  simpleStrategy?: WebsiteHtmlAcquisitionStrategy;
  advancedStrategy?: WebsiteHtmlAcquisitionStrategy;
  pipelineFactory?: (strategies: {
    simple: WebsiteHtmlAcquisitionStrategy;
    advanced: WebsiteHtmlAcquisitionStrategy;
  }) => WebsiteHtmlAcquisitionPipeline;
  simpleAdapter?: SimpleHttpWebsiteHtmlAcquisitionAdapterDependencies;
  playwrightAdapter?: PlaywrightWebsiteHtmlAcquisitionAdapterDependencies;
}

export function createWebsiteHtmlAcquisitionPort(
  options: CreateWebsiteHtmlAcquisitionPortOptions = {},
): WebsiteHtmlAcquisitionPort {
  const simple = options.simpleStrategy ?? new SimpleHttpWebsiteHtmlAcquisitionAdapter(options.simpleAdapter);
  const advanced = options.advancedStrategy ?? new PlaywrightWebsiteHtmlAcquisitionAdapter(options.playwrightAdapter);

  return options.pipelineFactory
    ? options.pipelineFactory({ simple, advanced })
    : new DefaultWebsiteHtmlAcquisitionPipeline({ simple, advanced });
}
