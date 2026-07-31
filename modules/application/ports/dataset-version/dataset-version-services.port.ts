import type { DatasetVersionDigest } from "../../../contracts/dataset";

export interface DatasetVersionHasherPort {
  digest(content: string | Uint8Array): DatasetVersionDigest;
}
