/**
 * @domusops/schema — public, stable contract.
 *
 * Paid packages depend on this package; it never depends on them.
 * See constitution §5.
 */

export type DetailLevel = "summary" | "standard" | "full";

/**
 * Placeholder for the ha_snapshot output contract.
 * Fill in during /speckit.plan for the ha-snapshot feature (see 01-SEED.md §5).
 */
export interface HaSnapshot {
  readonly schemaVersion: "0.0.0";
  readonly detail: DetailLevel;
  readonly compressionRatio: number;
  // entities, devices, integrations, areas, haVersion — TODO in first feature
}
