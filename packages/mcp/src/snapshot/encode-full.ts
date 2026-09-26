import type { RawRecords, StandardDocument } from "@domusops/schema";
import { encodeStandard } from "./encode-standard.js";

/**
 * The `full` document (data-model §5): the same lossless encoding as `standard`, over records that
 * were projected without the omission list, so every retrieved field is present.
 */
export function encodeFull(
  projected: RawRecords,
  haVersion: string,
): StandardDocument {
  return encodeStandard(projected, haVersion, "full");
}
