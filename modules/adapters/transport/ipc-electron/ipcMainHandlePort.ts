export type IpcMainHandleListener<
  TRequest = unknown,
  TResponse = unknown,
> = (event: unknown, request: TRequest) => Promise<TResponse>;

export interface IpcMainHandlePort {
  handle<TRequest = unknown, TResponse = unknown>(
    channel: string,
    listener: IpcMainHandleListener<TRequest, TResponse>,
  ): void;
}
