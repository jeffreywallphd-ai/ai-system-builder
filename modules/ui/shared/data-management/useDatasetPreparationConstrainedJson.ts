import { useEffect, useState } from "react";
import {
  resolveDatasetPreparationConstrainedJson,
  type DatasetPreparationConstrainedJsonResolution,
  type DatasetPreparationConstrainedJsonResolutionInput,
} from "../../../contracts/runtime";

/** A stable initial suggestion is not live runtime admission. */
export function useDatasetPreparationConstrainedJson(
  selectionKey: string,
  input: DatasetPreparationConstrainedJsonResolutionInput,
): { resolution: DatasetPreparationConstrainedJsonResolution; available: boolean } {
  const [initial, setInitial] = useState<{
    key: string;
    resolution: DatasetPreparationConstrainedJsonResolution;
  }>();
  const current = resolveDatasetPreparationConstrainedJson(input);
  const available = ![
    "snapshot-missing", "snapshot-stale", "decoder-unavailable", "schema-unsupported",
  ].includes(current.recommendationReason);
  const selected = initial?.key === selectionKey ? initial.resolution : undefined;
  useEffect(() => {
    if (!selected && available) {
      setInitial(previous => previous?.key === selectionKey ? previous : {
        key: selectionKey,
        resolution: { ...current },
      });
    }
  }, [selectionKey, selected, available, current.recommended, current.recommendationReason]);
  const recommendation = selected ?? current;
  // Readiness loss must never rewrite the intended mode. Each caller refuses
  // dispatch when enabled && !available; the runtime still rechecks admission.
  return { available, resolution: {
    ...recommendation,
    enabled: input.preference ?? recommendation.recommended,
    source: input.preference === undefined ? "adaptive" : "explicit",
  } };
}
