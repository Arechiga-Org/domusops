import type { TraceStandardDocument } from "@domusops/schema";
import { byteLength } from "../snapshot/ratio.js";

/**
 * A number of bytes that the document emitted for any larger set of runs is never below, so a
 * partial result already above the size limit proves that the whole result is (spec 007 FR-004,
 * research R4).
 *
 * Adding runs adds content, but it can also move a string or subtree to a lower table index, and a
 * reference to a lower index can be shorter. A reference is at least as wide as `#0` and at most as
 * wide as the largest index, so no reference can shrink by more than the difference; that is taken
 * off once per reference counted here. A reference the larger set adds costs at least as much as
 * it can save. The document is measured with its ratio at 0, which is never longer than the one
 * finally emitted.
 */
export function sizeFloor(doc: TraceStandardDocument): number {
  const text = JSON.stringify({ ...doc, compression_ratio: 0 });
  const entries = Math.max(doc.strings?.length ?? 0, doc.values?.length ?? 0);
  const widest = String(Math.max(entries - 1, 0)).length;
  const references = (text.match(/"#\d+"|\{"\$":\d+\}/g) ?? []).length;
  return byteLength(text) - references * (widest - 1);
}
