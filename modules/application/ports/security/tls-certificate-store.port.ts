export interface TlsCertificateStorePort {
  fileExists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  writeTextAtomic(path: string, text: string, mode?: number): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
}
