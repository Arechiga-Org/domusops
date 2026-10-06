import type {
  TraceExtendedRecord,
  TraceStandardDocument,
} from "@domusops/schema";
import { finalize, measureRowsBytes } from "../../src/snapshot/ratio.js";
import { encodeStandard } from "../../src/trace/encode-standard.js";
import { resolveItems, type ItemResolver } from "../../src/trace/items.js";
import type { TraceFixture } from "../fixtures/generate-traces.js";

export const TIME_ZONE = "Europe/Madrid";

export function itemsOf(
  fixture: TraceFixture,
  untraceable: string[] = [],
): ItemResolver {
  return resolveItems({
    registry: (
      fixture.records.entity_registry as unknown as {
        entity_id: string;
        unique_id: string;
        platform: "automation" | "script";
      }[]
    ).map(({ entity_id, unique_id, platform }) => ({
      entity_id,
      unique_id,
      platform,
    })),
    untraceable,
  });
}

/** Encodes records as the tool does, minus redaction: the document and its serialised text. */
export function encodeRecords(
  records: readonly TraceExtendedRecord[],
  fixture: TraceFixture,
): { doc: TraceStandardDocument; text: string; rawBytes: number } {
  const doc = encodeStandard(records, {
    haVersion: fixture.haVersion,
    timeZone: TIME_ZONE,
    nowMs: fixture.windowEnd * 1000,
    selection: {},
    items: itemsOf(fixture),
    noRuns: null,
  });
  const rawBytes = measureRowsBytes(records);
  return { doc, text: finalize(doc, rawBytes), rawBytes };
}

/** Key order is not preserved by the format: compare with sorted keys. */
export const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [
              key,
              sortKeys((value as Record<string, unknown>)[key]),
            ]),
        )
      : value;
