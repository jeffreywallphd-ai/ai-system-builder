export interface PlaywrightNavigationResponse {
  status(): number | null;
}

export interface PlaywrightPage {
  route(
    pattern: string,
    handler: (route: PlaywrightRoute) => Promise<void>,
  ): Promise<void>;
  routeWebSocket(
    pattern: string,
    handler: (route: PlaywrightWebSocketRoute) => Promise<void> | void,
  ): Promise<void>;
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<PlaywrightNavigationResponse | null>;
  content(): Promise<string>;
}

export interface PlaywrightBrowser {
  newPage(options?: { serviceWorkers?: "block" }): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface PlaywrightRouteRequest {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  isNavigationRequest(): boolean;
}

export interface PlaywrightRoute {
  request(): PlaywrightRouteRequest;
  abort(errorCode?: string): Promise<void>;
  fulfill(options: {
    status: number;
    headers?: Record<string, string>;
    body?: Uint8Array;
  }): Promise<void>;
}

export interface PlaywrightWebSocketRoute {
  close(options?: { code?: number; reason?: string }): void;
}

export interface PlaywrightChromiumLike {
  launch(options: { headless: boolean }): Promise<PlaywrightBrowser>;
}
