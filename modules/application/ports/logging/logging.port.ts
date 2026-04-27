import type {
  StructuredLogData,
  StructuredLogEvent,
} from "../../../contracts/logging";

export interface LoggingPort {
  log<TData extends StructuredLogData = StructuredLogData>(
    event: StructuredLogEvent<TData>,
  ): void | Promise<void>;
}
