import { createTransportOperation } from "../transport";

export const API_ASSET_PACKAGE_OPERATIONS = {
  inspect: createTransportOperation("asset-package", "inspect"),
  admit: createTransportOperation("asset-package", "admit"),
  list: createTransportOperation("asset-package", "list"),
  activate: createTransportOperation("asset-package", "activate"),
  disable: createTransportOperation("asset-package", "disable"),
  rollback: createTransportOperation("asset-package", "rollback"),
} as const;
