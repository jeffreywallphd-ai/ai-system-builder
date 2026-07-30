import {
  RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY,
  type ApplicationSettingDefinition,
  type ApplicationSettingPrimitiveValue,
} from "../../../contracts/settings";

export function validateSettingUpdate(
  definition: ApplicationSettingDefinition,
  value: ApplicationSettingPrimitiveValue,
): void {
  switch (definition.valueKind) {
    case "secret":
      return;
    case "string":
    case "folder":
      requireType(definition, value, "string");
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) invalid(definition);
      break;
    case "boolean":
      requireType(definition, value, "boolean");
      break;
    case "select":
      requireType(definition, value, "string");
      if (!definition.options?.some((option) => option.value === value)) {
        throw new Error(`Setting "${definition.key}" must use one of its declared options.`);
      }
      break;
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) invalid(definition);
      break;
    default:
      invalid(definition);
  }

  if (definition.key === RUNTIME_TORCH_CUDA_WHEEL_INDEX_URL_SETTING_KEY) {
    validateTrustedTorchWheelIndex(value as string);
  }
}

function validateTrustedTorchWheelIndex(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Torch CUDA wheel index must be an absolute HTTPS URL.");
  }
  const trustedChannel = /^\/whl\/(?:cpu|cu\d{3,4}|rocm\d+(?:\.\d+)*)\/?$/i;
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "download.pytorch.org" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    !trustedChannel.test(url.pathname)
  ) {
    throw new Error(
      "Torch CUDA wheel index must use a supported channel on https://download.pytorch.org/whl/.",
    );
  }
}

function requireType(
  definition: ApplicationSettingDefinition,
  value: ApplicationSettingPrimitiveValue,
  expected: "string" | "boolean",
): void {
  if (typeof value !== expected) invalid(definition);
}

function invalid(definition: ApplicationSettingDefinition): never {
  throw new Error(
    `Setting "${definition.key}" requires a value matching kind "${definition.valueKind}".`,
  );
}

