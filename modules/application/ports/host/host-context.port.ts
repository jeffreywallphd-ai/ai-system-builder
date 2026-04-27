import type { HostContext } from "../../../contracts/host";
import type { ContractBoundaryContext } from "../../../contracts/shared";

export interface HostContextPort {
  getHostContext(context?: ContractBoundaryContext): HostContext;
}
