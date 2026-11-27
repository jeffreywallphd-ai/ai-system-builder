import path from "node:path";

export const BOUNDED_TRAINING_TEMP_PREFIX = "bt-";
/** Fixed child-only qualification policy. No product device defaults or ambient
 * process settings change. Transformers/Accelerate explicitly selects CPU. */
export const BOUNDED_TRAINING_CPU_ENVIRONMENT = Object.freeze({
  ACCELERATE_USE_CPU: "true", CUDA_VISIBLE_DEVICES: "-1", HIP_VISIBLE_DEVICES: "-1",
  OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1",
});
/** Windows Datasets cache locks repeat the cache path in their filename. Keep
 * this qualification root short without disabling locks or changing limits.
 * The caller must still verify every parent component and own the new root. */
export function boundedTrainingTempParent(localAppData: unknown): string {
  const unavailable = () => new Error("A short local Windows temporary folder is required for bounded training qualification.");
  if (typeof localAppData !== "string" || !/^[A-Za-z]:\\/.test(localAppData) ||
      /[\x00-\x1f\x7f]/.test(localAppData) || localAppData.slice(2).includes(":") || localAppData !== path.win32.normalize(localAppData)) throw unavailable();
  const parent = path.win32.join(localAppData, "Temp");
  // mkdtemp appends six characters; include its separator and fixed prefix.
  if (parent.length + 1 + BOUNDED_TRAINING_TEMP_PREFIX.length + 6 > 60) throw unavailable();
  return parent;
}
