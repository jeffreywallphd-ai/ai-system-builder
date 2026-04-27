export interface PlaywrightNavigationResponse {
  status(): number | null;
}

export interface PlaywrightPage {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<PlaywrightNavigationResponse | null>;
  content(): Promise<string>;
}

export interface PlaywrightBrowser {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

export interface PlaywrightChromiumLike {
  launch(options: { headless: boolean }): Promise<PlaywrightBrowser>;
}
