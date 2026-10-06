import type { RawRecords } from "@domusops/schema";

const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Size of the payloads exactly as the instance returned them: the sum of the UTF-8 length of each
 * retrieval's serialised result. Measured before redaction (research R7). The serialisation is
 * discarded, never emitted (spec FR-015).
 */
export function measureRawBytes(records: RawRecords): number {
  return (
    byteLength(JSON.stringify(records.config)) +
    byteLength(JSON.stringify(records.states)) +
    byteLength(JSON.stringify(records.entity_registry)) +
    byteLength(JSON.stringify(records.device_registry)) +
    byteLength(JSON.stringify(records.area_registry)) +
    byteLength(JSON.stringify(records.config_entries))
  );
}

/**
 * Size of the logbook rows a query selected, as returned by the instance: the UTF-8 length of
 * their serialisation, measured before redaction (data-model §6 of feature 002). Discarded, never
 * emitted.
 */
export function measureRowsBytes(rows: readonly unknown[]): number {
  return byteLength(JSON.stringify(rows));
}

/**
 * Serialises `doc` minified with its real `compression_ratio`. The ratio's own digits would change
 * the size it measures, so the emitted size is taken with the ratio set to 0 (research R7).
 */
export function finalize<T extends { compression_ratio: number }>(
  doc: T,
  rawBytes: number,
): string {
  const emittedBytes = byteLength(
    JSON.stringify({ ...doc, compression_ratio: 0 }),
  );
  const ratio = Math.round((rawBytes / emittedBytes) * 100) / 100;
  return JSON.stringify({ ...doc, compression_ratio: ratio });
}
