/** Snapshot format identifier. Every emitted document declares it (spec FR-021). */
export const FORMAT = "domusops.snapshot/0.1" as const;

export const DETAIL_LEVELS = ["summary", "standard", "full"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export type JsonObject = { [key: string]: unknown };

/** The six record kinds retrieved from an instance; also the key space of `RawRecords`. */
export type RecordKind =
  | "config"
  | "states"
  | "entity_registry"
  | "device_registry"
  | "area_registry"
  | "config_entries";

export type RawConfig = JsonObject;

export interface RawState extends JsonObject {
  entity_id: string;
  state?: string;
  attributes?: JsonObject;
}

export interface RawEntityRegistryEntry extends JsonObject {
  entity_id: string;
  platform?: string;
  config_entry_id?: string | null;
  device_id?: string | null;
  area_id?: string | null;
}

export interface RawDevice extends JsonObject {
  id: string;
}

export interface RawArea extends JsonObject {
  area_id: string;
}

export interface RawConfigEntry extends JsonObject {
  entry_id: string;
  domain?: string;
  title?: string;
}

/** Records as returned by the instance (data-model §1), one array or object per retrieval. */
export interface RawRecords {
  config: RawConfig;
  states: RawState[];
  entity_registry: RawEntityRegistryEntry[];
  device_registry: RawDevice[];
  area_registry: RawArea[];
  config_entries: RawConfigEntry[];
}

export interface Envelope {
  format: typeof FORMAT;
  detail: DetailLevel;
  ha_version: string;
  compression_ratio: number;
}

export interface Template {
  const: JsonObject;
  cols: string[];
}

/**
 * Rows grouped by template key. The reserved key "_" holds records without a shared shape, as
 * inline objects; every other key is a template key and holds positional rows.
 */
export type Groups = Record<string, unknown[]>;

/** `standard` and `full` share one structure; `full` only skips the omission list. */
export interface StandardDocument extends Envelope {
  detail: "standard" | "full";
  config: JsonObject;
  areas: Record<string, JsonObject>;
  entries: Record<string, JsonObject>;
  templates: Record<string, Template>;
  devices: Groups;
  /** integration -> entry group -> domain -> groups */
  integrations: Record<string, Record<string, Record<string, Groups>>>;
}

export interface SummaryDocument extends Envelope {
  detail: "summary";
  config: JsonObject;
  counts: {
    entities: number;
    devices: number;
    areas: number;
    integrations: number;
    entries: number;
    unregistered_entities: number;
    disabled_entities: number;
  };
  by_domain: Record<string, number>;
  by_integration: Record<
    string,
    {
      entities: number;
      devices: number;
      entries: number;
      domains: Record<string, number>;
    }
  >;
  areas: Record<
    string,
    { name: string | null; devices: number; entities: number }
  >;
  unassigned: { devices: number; entities: number };
}

export type SnapshotDocument = StandardDocument | SummaryDocument;
