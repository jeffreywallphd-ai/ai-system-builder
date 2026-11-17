import type {
  PublishedSystemForm,
  PublishedSystemFormsInput,
  PublishedSystemFormSubmitInput,
  SystemBuilderResult,
  SystemFormSubmitResult,
} from "../../../contracts/system-builder";

export interface SystemPublishedFormClient {
  list(input: PublishedSystemFormsInput): Promise<SystemBuilderResult<readonly PublishedSystemForm[]>>;
  submit(input: PublishedSystemFormSubmitInput): Promise<SystemBuilderResult<SystemFormSubmitResult>>;
}
